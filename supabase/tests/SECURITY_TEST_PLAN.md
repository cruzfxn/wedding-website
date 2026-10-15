# Registration and RSVP security test plan

Run these cases only against a disposable local Supabase project. Create
separate Auth users for each case; do not use production guest data. This is a
manual plan and has not been run as part of Stage B.

## Registration ownership and eligibility

1. As authenticated user A, insert a profile with `user_id = auth.uid()` and a
   valid name. Confirm the status is `pending` and timestamps are populated.
2. As user A, try to insert a second profile with the same `user_id`; expect
   rejection by the primary key, with the original profile unchanged.
3. As user A, try to insert a profile for user B; expect denial from grants or
   RLS.
4. As user A, try to insert a profile with `eligibility_status = 'eligible'`;
   expect denial because status is not insertable and the policy requires
   pending.
5. As user A, update their own `full_name`; expect success and an updated
   timestamp. Try to update `eligibility_status`, `user_id`, or timestamps;
   expect permission denial.
6. As user A, select user B's profile; confirm no row is returned. Try direct
   eligibility changes; expect denial.
7. As an anonymous caller with no session, call `set_guest_eligibility`;
   expect rejection because `anon` has no execute privilege. As ordinary
   authenticated user A, call it for A and user B; expect rejection because A
   is not in the administrator allowlist.
8. As ordinary authenticated user A, separately try `INSERT`, `UPDATE`, and
   `DELETE` against `private.admin_users`; expect every operation to be rejected
   (schema usage and table privileges are revoked) and confirm the allowlist is
   unchanged.
9. As ordinary authenticated user A, separately try `INSERT`, `UPDATE`, and
   `DELETE` against `private.eligibility_audit`; expect every operation to be
   rejected and confirm the audit rows are unchanged.
10. Add a chosen user to `private.admin_users` as the local database owner, then
    verify the admin can approve a verified profile, cannot approve an
    unverified profile, and each changed status produces one private audit row.
    Confirm an ordinary user cannot read either private table.

## RSVP constraints and access

11. As an anonymous caller with no session, call `save_my_rsvp`; expect
    rejection because `anon` has no execute privilege.
12. With an unverified account, call `save_my_rsvp`; expect rejection.
13. With a verified but pending or revoked profile, call the RPC; expect
    rejection.
14. With a verified eligible profile, save attending with count 1 and save not
   attending with count 0; expect success and one row for the caller.
15. Try attending with count 0 or 2, not attending with count 1, null values,
    and notes longer than 1000 characters; expect rejection and no row change.
16. Save twice as the same eligible user; confirm an update to the same row,
    not a duplicate. Confirm creation/update timestamps behave as expected.
17. Try direct `INSERT`, `UPDATE`, and `DELETE` against `public.rsvps`; expect
    permission denial. Try to supply another user's ID to the RPC; its signature
    accepts no user ID, so the operation can affect only the caller's row.
18. As user A, select user B's RSVP; confirm no row is returned. Expire or
    remove A's session and retry; confirm there is no authenticated access.

## Review notes

- Verify grants as well as policies: RLS does not replace SQL privileges.
- Verify the two security-definer functions use an empty `search_path` and fully
  qualified object names.
- Invitation-content authorization and protection of the existing invitation
  image are not covered by this database-only stage. They require trusted
  server-side delivery and removal from public static assets in a later stage.

## Accountless invitation request migration

Run against a disposable local project after applying all migrations. Do not
run these steps against production data.

1. Call the latest `submit_guest_request` anonymously with valid details and a
   64-character receipt hash. It accepts no attendee-count parameter. Confirm
   it returns a request ID with status `pending`.
2. Try to pass an eligibility status, edit the status directly, or read the
   request table as anon/authenticated. Confirm each is denied or unavailable.
3. Confirm the database derives counts: decline with no companion names stores
   0; accept with no companion names stores 1; accept with a valid second name
   stores 2; accept with valid second and third names stores 3. Confirm the
   owner list returns every supplied attendee name and the matching count.
4. Try a third name without a second name, blank or overlong companion names,
   companion names on a declined request, and party sizes above 3. Confirm every
   invalid case is rejected by the RPC or database constraint.
5. Try malformed primary names, emails, phones, and receipt hashes; confirm rejection.
   Submit a repeated hash and confirm the unique constraint prevents duplicate
   receipt ownership.
6. Call `check_guest_request` with the correct receipt hash; confirm it returns
   only the request status. Try a wrong or malformed hash; confirm no guest
   data or invitation content is returned.
7. As anon and as authenticated non-admin, call `admin_list_invitation_requests`,
   `set_invitation_request_status`, and `is_invitation_admin`; confirm no guest
   details or status changes are exposed. As the allowlisted local owner,
   confirm the list works and approve/reject/revoke/reopen actions are audited.
8. Confirm pending, rejected, and revoked receipts receive HTTP 403 from the protected
   invitation function for both text and `asset=invite.png`; approved receipts
   receive both. Confirm the invitation image is absent from `dist/img`.
9. Inspect `dist` and verify no guest login/registration links,
   invitation image, or invitation text are included in public files.
10. As a non-admin, call `is_invitation_admin`, `claim_approval_email`, and
   `complete_approval_email`; confirm denial or false status. As an admin,
   approve a pending request twice and confirm there is one outbox event. Claim
   once and confirm a concurrent/repeated claim does not claim it again.
11. Retry a definitely failed event explicitly and confirm the same event UUID
    is reused. Confirm `unknown`, `sending`, and `accepted` events cannot be
    resent; a repeated approval does not queue another event.
12. Run `deno test supabase/functions/_shared/brevo_test.ts`. These mock tests
    verify the API key header, designated recipient payload, stable Brevo
    idempotency key, and handling of accepted, definite-failure, and ambiguous
    outcomes. Separately call `approve-guest` with `mode: "test"` and a
    designated test recipient only after local secrets and a local Supabase
    stack are configured. A 201/message ID means Brevo accepted the email, not
    that the recipient received it.
13. Confirm the test email action does not change any request's approval state.
