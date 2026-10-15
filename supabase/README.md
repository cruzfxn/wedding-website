# Supabase database design

This repository contains the original Auth-based security design in
`migrations/20261012000100_registration_rsvp_security.sql` and a later
accountless request flow in `migrations/20261014000100_guest_requests_without_accounts.sql`.
The migrations are version controlled. Do not assume either has been applied
to any Supabase project.

## Data model

- `public.registration_profiles` has one row per `auth.users.id`, a required
  full name, `created_at` / `updated_at`, and an eligibility state of `pending`,
  `eligible`, or `revoked`. New rows default to `pending`.
- `public.rsvps` has at most one row per profile, with an attendance response,
  attendee count, optional notes, and timestamps. For now, attending means one
  attendee and not attending means zero. The check constraint enforces the
  current one-person policy.
- `private.admin_users` is an inaccessible administrator allowlist.
- `private.eligibility_audit` records each eligibility state change without
  exposing the guest list to ordinary users.

The audit's `target_user_id` and `changed_by` are historical UUIDs without
foreign keys to `auth.users`. Deleting either Auth account therefore neither
erases its audit history nor gets blocked by an audit foreign key. The audit
stores no email address or name. These UUIDs remain pseudonymous identifiers
and may still be linkable to people if known elsewhere, so retain and access the
audit data only as long as the event's recordkeeping needs and applicable
privacy requirements justify.

Both public tables have RLS enabled. A user can read only their own profile and
RSVP, and can create only their own pending profile. Table-level grants restrict
profile edits to `full_name`; eligibility and ownership columns are not granted
for client updates. Authenticated users have no direct RSVP write grants.

`public.set_guest_eligibility` is a `SECURITY DEFINER` RPC that checks the
authenticated caller against `private.admin_users`, requires the target email
to be verified before marking it eligible, and records an audit entry. No
administrator account is seeded by this migration. After a project owner has
reviewed and applied the migration, they must add an explicitly selected admin
Auth user UUID to `private.admin_users` using the Supabase SQL Editor. Do not
grant admin membership based on user-submitted metadata or a client-side flag.

`public.save_my_rsvp` is the only authenticated RSVP write path. It derives the
guest ID from `auth.uid()`, checks `auth.users.email_confirmed_at` and the
profile's eligibility state, enforces the one-attendee rule and notes limit,
then inserts or updates only the caller's RSVP. That database check is
intentionally independent of browser validation. Invitation retrieval must
also be checked by a trusted server-side endpoint in a later stage; static HTML,
images, browser redirects, and session checks cannot protect public Netlify
files.

## Safe local review

No production connection or destructive operation is required to review this
SQL. Read the migration first, especially the table grants, RLS policies,
`SECURITY DEFINER` function bodies, and the one-attendee constraint. Use a
throwaway local Supabase stack only after installing the Supabase CLI and
Docker. From the repository root:

1. `supabase start` starts the local stack using this repository's config.
2. `supabase db reset` applies migrations to, and resets, the **local
   development database**. It is destructive to local development data; use it
   only when that local database is intended to be reset. Linking a remote
   project does not make `db reset` a remote reset.
3. Inspect the resulting schema and policies in local Studio or with local SQL.
4. Run the security cases in `tests/SECURITY_TEST_PLAN.md` against local Auth
   users with distinct verified/unverified and eligibility states.
5. Stop the local stack with `supabase stop` when finished.

Commands such as `supabase db push --linked` can apply migrations to a remote
project. Before any command that may affect a remote project, inspect the exact
command and target project reference in the CLI, verify the target in the
Supabase dashboard, review the SQL, take an appropriate backup, and obtain
explicit approval. Do not use production credentials for local review. Never
put service-role keys, database passwords, or other secrets in this repository.

## Auth and future application setup

The trusted application backend must continue to use Supabase-verified user
identity, protect invitation content and assets, and check email confirmation
and eligibility on every private invitation request. Configure Auth confirmation
and redirect URLs for the eventual production domain and chosen local origin
before accepting registrations. These external settings are not configured by
this database migration. Plus-one policy is also not approved; attendee count
remains fixed at one until a reviewed migration changes the constraint and RPC.

## Email uniqueness

The schema intentionally does not copy email addresses into a second registry.
`registration_profiles.user_id` is unique per Auth account; uniqueness of an
email across accounts is delegated to Supabase Auth. Before deployment, verify
the chosen project's email sign-up and confirmation settings and confirm that
Auth enforces unique email identities for the addresses your site accepts.
Check the actual project Auth configuration and test duplicate sign-up attempts
in a disposable local project; do not infer this guarantee from this migration.

## Accountless invitation requests (local change, not deployed)

The RSVP page now submits to `public.submit_guest_request`. It records the
attendee count and contact details, and the RPC always writes
`eligibility_status = 'pending'`. The guest cannot submit a status. Direct
table access is revoked and RLS is enabled. A guest receives a random 256-bit
receipt; the browser submits its SHA-256 hash, and the database stores only the
hash. The guest can revisit the private return link to check status. Status
lookup reveals only the state for a request when its receipt is known.

This is a bearer-link workflow, not guest authentication. The receipt is in the
URL fragment, which is not sent in the HTTP request; the page moves it into
tab-scoped session storage and removes it from the address bar. Navigation links
do not contain the receipt. Browser code hashes it before any Supabase request,
and only the hash is stored in the database or sent to the invitation function.
A person who obtains the private link can check the request and, after approval,
view the invitation. Screenshots, device sharing, browser extensions, XSS, or
manual forwarding can expose it. Names and email addresses are not used as
proof of identity.
Anyone needing stronger impersonation protection would need an authenticated
identity or an emailed one-time verification code.

Owner actions use `public.admin_list_invitation_requests()` and
`public.set_invitation_request_status(request_id, status)`. Both require the
caller to be in `private.admin_users`; ordinary authenticated users and guests
cannot list request details or change statuses. Add the selected owner/admin
Auth UUID to that private allowlist only after reviewing the target project.
The functions are database APIs; there is no owner dashboard in this site yet.

The protected invitation Edge Function validates the receipt hash through
`check_guest_request` on every content/image request, and serves the image from
its function-local static asset. `verify_jwt = false` is required for this
function to accept a request without a Supabase Auth JWT; the function checks
the high-entropy receipt hash and current approval before returning content.
The build script copies only the explicitly listed public images and does not
copy `supabase/functions/protected-invite/invite.png` into `dist`.

The follow-up migration `20261015000100_approval_email_outbox_and_count_rules.sql`
removes the client-supplied attendee count; the database derives 0, 1, or 2 from
the attendance answer and second guest name. Owner approval queues one email
event per request in a private outbox. The `approve-guest` Edge Function uses
the authenticated owner JWT and the admin allowlist; it sends only queued (or
explicitly retried, definitely failed) events. Repeated approval calls do not
create another event. Brevo's idempotency key is the event UUID. Ambiguous
network/5xx outcomes are marked `unknown` and are never automatically resent.
The outbox records `accepted` only when Brevo returns its success response and
message ID; that means accepted by Brevo, not confirmed delivered. No receipt is
included in approval email.

Configure local Edge Function values in the ignored
`supabase/functions/.env` using `.env.example` as a template. Keep
`BREVO_TEST_RECIPIENT` set to a designated test inbox and call the email
function with `mode: "test"` before any guest delivery. A test message does not
approve a request. Production secrets, migrations, or function deployments
have not been changed. The site has no owner dashboard; use the owner-only RPCs
or authenticated Edge Function tooling.

Brevo approval email code is prepared, but no credentials, verified sender, or
designated test recipient are present in this workspace. The delivery path has
not been tested against Brevo. A QR-code flow is intentionally not included:
there is no established attendee-validation scanner or single-use QR process,
and the private receipt must not be embedded in an email or QR code. The RSVP
page states that automated confirmation/QR delivery is not configured. Do not
put provider or service-role secrets in browser code.
