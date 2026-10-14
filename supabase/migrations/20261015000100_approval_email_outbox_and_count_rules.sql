-- Derive the attendee count in trusted SQL, and queue one approval email per request.
-- Apply only to a disposable local project for validation; production approval is separate.

drop function public.submit_guest_request(text, text, text, boolean, smallint, text, text);

create function public.submit_guest_request(
  p_full_name text,
  p_email text,
  p_phone text,
  p_attending boolean,
  p_second_guest_name text,
  p_receipt_hash text
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_attendee_count smallint;
  v_second_guest_name text := nullif(btrim(coalesce(p_second_guest_name, '')), '');
begin
  if p_full_name is null or char_length(btrim(p_full_name)) not between 1 and 120
    or p_email is null or char_length(btrim(p_email)) not between 3 and 254
    or btrim(p_email) !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    or p_phone is null or char_length(btrim(p_phone)) not between 7 and 30
    or btrim(p_phone) !~ '^[+0-9() .-]{7,30}$' or btrim(p_phone) !~ '[0-9]'
    or p_attending is null
    or p_receipt_hash is null or p_receipt_hash !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Guest request details are invalid';
  end if;

  if not p_attending then
    if v_second_guest_name is not null then
      raise exception using errcode = '22023', message = 'A declined request cannot include a second guest';
    end if;
    v_attendee_count := 0;
  elsif v_second_guest_name is null then
    v_attendee_count := 1;
  else
    if char_length(v_second_guest_name) not between 1 and 120 then
      raise exception using errcode = '22023', message = 'Second guest name is invalid';
    end if;
    v_attendee_count := 2;
  end if;

  insert into public.invitation_requests
    (full_name, email, phone, attending, attendee_count, second_guest_name, eligibility_status, receipt_hash)
  values
    (btrim(p_full_name), lower(btrim(p_email)), btrim(p_phone), p_attending, v_attendee_count,
     v_second_guest_name, 'pending', p_receipt_hash)
  returning request_id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_guest_request(text, text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.submit_guest_request(text, text, text, boolean, text, text) to anon, authenticated;

create table private.approval_email_outbox (
  event_id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.invitation_requests(request_id) on delete cascade,
  state text not null default 'queued' check (state in ('queued', 'sending', 'accepted', 'failed', 'unknown')),
  attempt_count smallint not null default 0 check (attempt_count between 0 and 10),
  provider_message_id text,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz
);
alter table private.approval_email_outbox enable row level security;
revoke all on table private.approval_email_outbox from public, anon, authenticated;

create function private.set_approval_email_outbox_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.set_approval_email_outbox_updated_at() from public, anon, authenticated;
create trigger approval_email_outbox_set_updated_at
before update on private.approval_email_outbox
for each row execute function private.set_approval_email_outbox_updated_at();

create or replace function public.set_invitation_request_status(
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
    if p_status = 'approved' then
      insert into private.approval_email_outbox (request_id)
        values (p_request_id) on conflict (request_id) do nothing;
    end if;
  end if;
end;
$$;

create function public.is_invitation_admin()
returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from private.admin_users admins where admins.user_id = auth.uid()
  );
$$;

create function public.claim_approval_email(p_request_id uuid, p_retry_failed boolean default false)
returns table (event_id uuid, recipient_email text, recipient_name text, outbox_state text, claimed_now boolean, request_status public.invitation_request_status)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from private.admin_users admins where admins.user_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'Administrator access required';
  end if;
  return query
    update private.approval_email_outbox outbox
      set state = 'sending', attempt_count = outbox.attempt_count + 1, error_code = null
      from public.invitation_requests requests
      where outbox.request_id = p_request_id
        and requests.request_id = outbox.request_id
        and requests.eligibility_status = 'approved'
        and (outbox.state = 'queued' or (p_retry_failed and outbox.state = 'failed'))
        and outbox.attempt_count < 10
      returning outbox.event_id, requests.email, requests.full_name, outbox.state, true, requests.eligibility_status;
  if found then return; end if;
  return query
    select outbox.event_id, requests.email, requests.full_name, outbox.state, false, requests.eligibility_status
    from private.approval_email_outbox outbox
    join public.invitation_requests requests on requests.request_id = outbox.request_id
    where outbox.request_id = p_request_id;
end;
$$;

create function public.complete_approval_email(
  p_event_id uuid,
  p_state text,
  p_provider_message_id text default null,
  p_error_code text default null
)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from private.admin_users admins where admins.user_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'Administrator access required';
  end if;
  if p_state is null or p_state not in ('accepted', 'failed', 'unknown') then
    raise exception using errcode = '22023', message = 'Invalid email state';
  end if;
  update private.approval_email_outbox
    set state = p_state,
        provider_message_id = case when p_state = 'accepted' then p_provider_message_id else null end,
        error_code = case when p_state = 'accepted' then null else left(coalesce(p_error_code, 'unspecified'), 80) end,
        accepted_at = case when p_state = 'accepted' then now() else null end
    where event_id = p_event_id and state = 'sending';
  if not found then raise exception using errcode = 'P0002', message = 'Email event is not in sending state'; end if;
end;
$$;

revoke all on function public.is_invitation_admin() from public, anon, authenticated;
revoke all on function public.claim_approval_email(uuid, boolean) from public, anon, authenticated;
revoke all on function public.complete_approval_email(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.is_invitation_admin() to authenticated;
grant execute on function public.claim_approval_email(uuid, boolean) to authenticated;
grant execute on function public.complete_approval_email(uuid, text, text, text) to authenticated;

comment on table private.approval_email_outbox is
  'One approval-email event per request. State is private; sending/unknown events are never automatically retried.';
