-- Accountless guest request flow. Apply only after review, using a local database first.
create type public.invitation_request_status as enum ('pending', 'approved', 'rejected');

create table public.invitation_requests (
  request_id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text not null,
  attending boolean not null,
  attendee_count smallint not null,
  second_guest_name text,
  eligibility_status public.invitation_request_status not null default 'pending',
  receipt_hash text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitation_requests_name_valid check (char_length(btrim(full_name)) between 1 and 120),
  constraint invitation_requests_email_valid check (char_length(email) between 3 and 254 and email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  constraint invitation_requests_phone_valid check (char_length(phone) between 7 and 30 and phone ~ '^[+0-9() .-]{7,30}$' and phone ~ '[0-9]'),
  constraint invitation_requests_count_valid check (
    (not attending and attendee_count = 0 and second_guest_name is null)
    or (attending and attendee_count = 1 and second_guest_name is null)
    or (attending and attendee_count = 2 and second_guest_name is not null
      and char_length(btrim(second_guest_name)) between 1 and 120)
  ),
  constraint invitation_requests_receipt_hash_valid check (receipt_hash ~ '^[0-9a-f]{64}$')
);

create index invitation_requests_status_created_idx
  on public.invitation_requests (eligibility_status, created_at desc);

create function public.set_invitation_request_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.set_invitation_request_updated_at() from public, anon, authenticated;
create trigger invitation_requests_set_updated_at
before update on public.invitation_requests
for each row execute function public.set_invitation_request_updated_at();

alter table public.invitation_requests enable row level security;
revoke all on table public.invitation_requests from public, anon, authenticated;

-- Anyone may submit a new request. The only status accepted by this interface is pending.
create function public.submit_guest_request(
  p_full_name text,
  p_email text,
  p_phone text,
  p_attending boolean,
  p_attendee_count smallint,
  p_second_guest_name text,
  p_receipt_hash text
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_full_name is null or char_length(btrim(p_full_name)) not between 1 and 120
    or p_email is null or char_length(btrim(p_email)) not between 3 and 254
    or btrim(p_email) !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    or p_phone is null or char_length(btrim(p_phone)) not between 7 and 30
    or btrim(p_phone) !~ '^[+0-9() .-]{7,30}$' or btrim(p_phone) !~ '[0-9]'
    or p_attending is null or p_attendee_count is null
    or p_receipt_hash is null or p_receipt_hash !~ '^[0-9a-f]{64}$'
    or (not p_attending and (p_attendee_count <> 0 or p_second_guest_name is not null))
    or (p_attending and p_attendee_count = 1 and p_second_guest_name is not null)
    or (p_attending and p_attendee_count = 2 and char_length(btrim(coalesce(p_second_guest_name, ''))) not between 1 and 120)
    or (p_attending and p_attendee_count not in (1, 2)) then
    raise exception using errcode = '22023', message = 'Guest request details are invalid';
  end if;

  insert into public.invitation_requests
    (full_name, email, phone, attending, attendee_count, second_guest_name, eligibility_status, receipt_hash)
  values
    (btrim(p_full_name), lower(btrim(p_email)), btrim(p_phone), p_attending, p_attendee_count,
     nullif(btrim(coalesce(p_second_guest_name, '')), ''), 'pending', p_receipt_hash)
  returning request_id into v_id;
  return v_id;
end;
$$;

-- A guest who possesses the unguessable receipt can check only that request's state.
create function public.check_guest_request(p_receipt_hash text)
returns public.invitation_request_status
language plpgsql security definer set search_path = '' as $$
declare
  v_status public.invitation_request_status;
begin
  if p_receipt_hash is null or p_receipt_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid request receipt';
  end if;
  select eligibility_status into v_status
  from public.invitation_requests where receipt_hash = p_receipt_hash;
  if not found then raise exception using errcode = 'P0002', message = 'Request not found'; end if;
  return v_status;
end;
$$;

create table private.invitation_request_audit (
  audit_id bigint generated always as identity primary key,
  request_id uuid not null,
  changed_by uuid not null,
  old_status public.invitation_request_status not null,
  new_status public.invitation_request_status not null,
  changed_at timestamptz not null default now()
);
alter table private.invitation_request_audit enable row level security;
revoke all on table private.invitation_request_audit from public, anon, authenticated;

-- Guest details are visible only through this allowlisted owner/admin RPC.
create function public.admin_list_invitation_requests()
returns table (
  request_id uuid,
  full_name text,
  email text,
  phone text,
  attending boolean,
  attendee_count smallint,
  second_guest_name text,
  eligibility_status public.invitation_request_status,
  created_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from private.admin_users admins where admins.user_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'Administrator access required';
  end if;
  return query
    select requests.request_id, requests.full_name, requests.email, requests.phone,
      requests.attending, requests.attendee_count, requests.second_guest_name,
      requests.eligibility_status, requests.created_at
    from public.invitation_requests requests
    order by requests.created_at desc;
end;
$$;

-- Approval/rejection remains owner-controlled through the existing private admin allowlist.
create function public.set_invitation_request_status(
  p_request_id uuid,
  p_status public.invitation_request_status
)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_old_status public.invitation_request_status;
begin
  if auth.uid() is null or not exists (
    select 1 from private.admin_users admins where admins.user_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'Administrator approval required';
  end if;
  if p_status is null then raise exception using errcode = '22023', message = 'Status is required'; end if;
  select eligibility_status into v_old_status from public.invitation_requests
    where request_id = p_request_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Request not found'; end if;
  if v_old_status is distinct from p_status then
    update public.invitation_requests set eligibility_status = p_status where request_id = p_request_id;
    insert into private.invitation_request_audit (request_id, changed_by, old_status, new_status)
      values (p_request_id, auth.uid(), v_old_status, p_status);
  end if;
end;
$$;

revoke all on function public.submit_guest_request(text, text, text, boolean, smallint, text, text) from public, anon, authenticated;
revoke all on function public.check_guest_request(text) from public, anon, authenticated;
revoke all on function public.set_invitation_request_status(uuid, public.invitation_request_status) from public, anon, authenticated;
revoke all on function public.admin_list_invitation_requests() from public, anon, authenticated;
grant execute on function public.submit_guest_request(text, text, text, boolean, smallint, text, text) to anon, authenticated;
grant execute on function public.check_guest_request(text) to anon, authenticated;
grant execute on function public.set_invitation_request_status(uuid, public.invitation_request_status) to authenticated;
grant execute on function public.admin_list_invitation_requests() to authenticated;

comment on table public.invitation_requests is
  'Accountless guest requests. receipt_hash is a SHA-256 hash of a high-entropy bearer receipt; it is not identity verification.';
comment on column public.invitation_requests.eligibility_status is
  'Only an authorized admin may change request status; public submission always creates pending.';
