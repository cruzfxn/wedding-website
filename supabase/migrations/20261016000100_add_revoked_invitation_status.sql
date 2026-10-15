-- Keep revocation distinct from rejection so owners can revoke an approved request.
-- Apply to a disposable local database for validation; production deployment is separate.
alter type public.invitation_request_status add value if not exists 'revoked';
