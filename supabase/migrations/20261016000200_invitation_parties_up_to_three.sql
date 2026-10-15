-- Store the names and database-derived party size for up to three attendees.
-- This migration is local work only and has not been applied remotely.
alter table public.invitation_requests
  add column third_guest_name text;

alter table public.invitation_requests
  drop constraint invitation_requests_count_valid,
  add constraint invitation_requests_count_valid check (
    (not attending and attendee_count = 0 and second_guest_name is null and third_guest_name is null)
    or (attending and attendee_count = 1 and second_guest_name is null and third_guest_name is null)
    or (attending and attendee_count = 2 and second_guest_name is not null
      and char_length(btrim(second_guest_name)) between 1 and 120 and third_guest_name is null)
    or (attending and attendee_count = 3 and second_guest_name is not null and third_guest_name is not null
      and char_length(btrim(second_guest_name)) between 1 and 120
      and char_length(btrim(third_guest_name)) between 1 and 120)
  );

drop function public.submit_guest_request(text, text, text, boolean, text, text);
create function public.submit_guest_request(
  p_full_name text,
  p_email text,
  p_phone text,
  p_attending boolean,
  p_second_guest_name text,
  p_third_guest_name text,
  p_receipt_hash text
)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_attendee_count smallint;
  v_second_guest_name text := nullif(btrim(coalesce(p_second_guest_name, '')), '');
  v_third_guest_name text := nullif(btrim(coalesce(p_third_guest_name, '')), '');
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
    if v_second_guest_name is not null or v_third_guest_name is not null then
      raise exception using errcode = '22023', message = 'A declined request cannot include additional guests';
    end if;
    v_attendee_count := 0;
  else
    if v_third_guest_name is not null and v_second_guest_name is null then
      raise exception using errcode = '22023', message = 'The second guest name is required when a third guest is provided';
    end if;
    if (v_second_guest_name is not null and char_length(v_second_guest_name) not between 1 and 120)
      or (v_third_guest_name is not null and char_length(v_third_guest_name) not between 1 and 120) then
      raise exception using errcode = '22023', message = 'Additional guest names must be between 1 and 120 characters';
    end if;
    v_attendee_count := case
      when v_third_guest_name is not null then 3
      when v_second_guest_name is not null then 2
      else 1
    end;
  end if;

  insert into public.invitation_requests
    (full_name, email, phone, attending, attendee_count, second_guest_name, third_guest_name, eligibility_status, receipt_hash)
  values
    (btrim(p_full_name), lower(btrim(p_email)), btrim(p_phone), p_attending, v_attendee_count,
     v_second_guest_name, v_third_guest_name, 'pending', p_receipt_hash)
  returning request_id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_guest_request(text, text, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_guest_request(text, text, text, boolean, text, text, text) to anon, authenticated;

drop function public.admin_list_invitation_requests();
create function public.admin_list_invitation_requests()
returns table (
  request_id uuid,
  full_name text,
  email text,
  phone text,
  attending boolean,
  attendee_count smallint,
  second_guest_name text,
  third_guest_name text,
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
      requests.third_guest_name, requests.eligibility_status, requests.created_at
    from public.invitation_requests requests
    order by requests.created_at desc;
end;
$$;
revoke all on function public.admin_list_invitation_requests() from public, anon, authenticated;
grant execute on function public.admin_list_invitation_requests() to authenticated;
