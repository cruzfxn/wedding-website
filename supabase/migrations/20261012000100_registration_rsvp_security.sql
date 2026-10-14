-- Registration and RSVP foundation for the Subuola Olaoluwa 2026 site.
-- New profiles are pending. A verified email is necessary, but not sufficient,
-- for invitation or RSVP access.

create type public.eligibility_status as enum ('pending', 'eligible', 'revoked');

create table public.registration_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  eligibility_status public.eligibility_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint registration_profiles_full_name_valid
    check (char_length(btrim(full_name)) between 1 and 120)
);

create index registration_profiles_eligibility_status_idx
  on public.registration_profiles (eligibility_status);

create table public.rsvps (
  user_id uuid primary key references public.registration_profiles (user_id) on delete cascade,
  attending boolean not null,
  attendee_count smallint not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rsvps_attendee_count_policy
    check (
      (attending and attendee_count = 1)
      or (not attending and attendee_count = 0)
    ),
  constraint rsvps_notes_length
    check (notes is null or char_length(notes) <= 1000)
);

create index rsvps_updated_at_idx on public.rsvps (updated_at desc);

-- Keep timestamps database-managed. Callers cannot set these via table grants.
create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;

create trigger registration_profiles_set_updated_at
before update on public.registration_profiles
for each row execute function public.set_updated_at();

create trigger rsvps_set_updated_at
before update on public.rsvps
for each row execute function public.set_updated_at();

alter table public.registration_profiles enable row level security;
alter table public.rsvps enable row level security;

-- Strip broad/default API grants first, then grant only the needed operations.
revoke all on table public.registration_profiles from public, anon, authenticated;
revoke all on table public.rsvps from public, anon, authenticated;
grant select on table public.registration_profiles to authenticated;
grant insert (user_id, full_name) on table public.registration_profiles to authenticated;
grant update (full_name) on table public.registration_profiles to authenticated;
grant select on table public.rsvps to authenticated;

create policy "users can read their own profile"
on public.registration_profiles for select to authenticated
using ((select auth.uid()) = user_id);

create policy "users can create only their own pending profile"
on public.registration_profiles for insert to authenticated
with check (
  (select auth.uid()) = user_id
  and eligibility_status = 'pending'
);

create policy "users can update only their own profile"
on public.registration_profiles for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "users can read only their own rsvp"
on public.rsvps for select to authenticated
using ((select auth.uid()) = user_id);

-- This private schema is intentionally not available through the Supabase API.
create schema private;
revoke all on schema private from public, anon, authenticated;

create table private.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table private.eligibility_audit (
  audit_id bigint generated always as identity primary key,
  -- Keep the target UUID as a historical identifier after Auth account deletion.
  -- Do not copy email/name into this audit table.
  target_user_id uuid not null,
  changed_by uuid not null,
  old_status public.eligibility_status not null,
  new_status public.eligibility_status not null,
  changed_at timestamptz not null default now()
);

alter table private.admin_users enable row level security;
alter table private.eligibility_audit enable row level security;

create index eligibility_audit_target_changed_at_idx
  on private.eligibility_audit (target_user_id, changed_at desc);

revoke all on table private.admin_users from public, anon, authenticated;
revoke all on table private.eligibility_audit from public, anon, authenticated;

-- The only eligibility mutation API. The allowlist is populated explicitly by
-- the project owner using the Supabase SQL Editor; users cannot add themselves.
create function public.set_guest_eligibility(
  p_user_id uuid,
  p_status public.eligibility_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_status public.eligibility_status;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if not exists (
    select 1 from private.admin_users as admins where admins.user_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'Administrator approval required';
  end if;

  if p_status is null then
    raise exception using errcode = '22023', message = 'Eligibility status is required';
  end if;

  if p_status = 'eligible' and not exists (
    select 1 from auth.users as users
    where users.id = p_user_id and users.email_confirmed_at is not null
  ) then
    raise exception using errcode = '23514', message = 'Guest email must be verified before approval';
  end if;

  select profiles.eligibility_status
    into v_old_status
    from public.registration_profiles as profiles
    where profiles.user_id = p_user_id
    for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Registration profile not found';
  end if;

  if v_old_status is distinct from p_status then
    update public.registration_profiles
      set eligibility_status = p_status
      where user_id = p_user_id;

    insert into private.eligibility_audit
      (target_user_id, changed_by, old_status, new_status)
    values
      (p_user_id, auth.uid(), v_old_status, p_status);
  end if;
end;
$$;

revoke all on function public.set_guest_eligibility(uuid, public.eligibility_status)
  from public, anon, authenticated;
grant execute on function public.set_guest_eligibility(uuid, public.eligibility_status)
  to authenticated;

-- RSVP writes go through this constrained RPC. It derives the user ID from the
-- verified Supabase JWT and checks Auth's server-owned email confirmation field.
create function public.save_my_rsvp(
  p_attending boolean,
  p_attendee_count smallint,
  p_notes text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if not exists (
    select 1 from auth.users as users
    where users.id = v_user_id and users.email_confirmed_at is not null
  ) then
    raise exception using errcode = '42501', message = 'Verified email required';
  end if;

  if not exists (
    select 1 from public.registration_profiles as profiles
    where profiles.user_id = v_user_id
      and profiles.eligibility_status = 'eligible'
  ) then
    raise exception using errcode = '42501', message = 'Eligible registration required';
  end if;

  if p_attending is null or p_attendee_count is null
    or (p_attending and p_attendee_count <> 1)
    or (not p_attending and p_attendee_count <> 0) then
    raise exception using errcode = '22023', message = 'Attendee count must be 1 when attending and 0 when not attending';
  end if;

  if p_notes is not null and char_length(p_notes) > 1000 then
    raise exception using errcode = '22023', message = 'Notes must be 1000 characters or fewer';
  end if;

  insert into public.rsvps (user_id, attending, attendee_count, notes)
  values (v_user_id, p_attending, p_attendee_count, p_notes)
  on conflict (user_id) do update
    set attending = excluded.attending,
        attendee_count = excluded.attendee_count,
        notes = excluded.notes;
end;
$$;

revoke all on function public.save_my_rsvp(boolean, smallint, text)
  from public, anon, authenticated;
grant execute on function public.save_my_rsvp(boolean, smallint, text)
  to authenticated;

comment on table public.registration_profiles is
  'One self-owned profile per Supabase Auth user. Eligibility is administrator-controlled.';
comment on table public.rsvps is
  'One RSVP per eligible Auth user; writes require the verified save_my_rsvp RPC.';
comment on function public.set_guest_eligibility(uuid, public.eligibility_status) is
  'Administrator-only eligibility transition with audit logging.';
comment on function public.save_my_rsvp(boolean, smallint, text) is
  'Saves only the caller RSVP after checking verified email and eligible status.';
