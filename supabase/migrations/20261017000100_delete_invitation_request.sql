-- Permanently delete one accountless request and its retained status history.
-- The approval email outbox row is removed by its existing ON DELETE CASCADE FK.
create function public.delete_invitation_request(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from private.admin_users as admins
    where admins.user_id = auth.uid()
  ) then
    raise exception using errcode = '42501', message = 'Administrator access required';
  end if;

  if p_request_id is null then
    raise exception using errcode = '22023', message = 'Request ID is required';
  end if;

  -- Lock the selected request so status changes cannot race this deletion.
  perform 1
  from public.invitation_requests as requests
  where requests.request_id = p_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Request not found';
  end if;

  delete from private.invitation_request_audit as audit
  where audit.request_id = p_request_id;

  delete from public.invitation_requests as requests
  where requests.request_id = p_request_id;

  return true;
end;
$$;

revoke all on function public.delete_invitation_request(uuid)
  from public, anon, authenticated;
grant execute on function public.delete_invitation_request(uuid)
  to authenticated;

comment on function public.delete_invitation_request(uuid) is
  'Deletes one invitation request and its status audit history for an allowlisted admin. The approval email outbox is removed by cascade.';
