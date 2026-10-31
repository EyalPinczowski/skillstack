# 011 – Accounts are created and deleted by database functions, not by app-role writes

**Status:** Accepted · built in v0.1 (migration 0006)

## Context
Spec 3.A: only approved emails can create an account, even through "Continue with Google", the beta has a user cap, and the app has no way to make anyone admin. Migration 0003 already denies `INSERT`/`DELETE` on `app_users` to the app role and denies changing `role` and `status`. The API still has to create the profile on a user's first request and delete it on "Delete my account". Doing those as the owner role from the API code would put an owner-level connection in the request path.

## Options
1. A second, privileged database connection in the API (owner or admin role) for these two operations. Simple, but the web-facing process then holds a credential that can write anything.
2. `SECURITY DEFINER` functions owned by the owner role that contain the rules, with `EXECUTE` limited to the roles that need them.

## Decision
Option 2.
- `provision_user(p_id, p_email)`: lower-cases the email, returns the existing row if the id exists, otherwise requires the email in `allowed_emails`, requires active users below `app_settings.user_cap` (a missing or non-numeric cap fails closed), and inserts with role `user`. `search_path` is pinned. `EXECUTE` only for the login role `app_<schema>`; the backend calls it before it switches role, because a request running as `app_<schema>_user` must not be able to create accounts. To call it the login gets `USAGE` on its own schema (bootstrap.sql); it still has no privilege on any table.
- `delete_account()`: takes no argument and deletes only `current_user_id()`, so even a backend bug cannot delete someone else. `EXECUTE` only for `app_<schema>_user`. It also removes the email from `allowed_emails`, so a token that is still valid cannot re-create the account; returning needs a new invite.
- `allowed_emails` has RLS on, a backup `SELECT` policy and no privilege for the app roles.
- `promote-admin --schema <s> --email <e>` (the db CLI, run with the admin connection) adds the email to the allowlist and sets `role = 'admin'` as the owner role. It is the only way to become admin.
- The API verifies the Supabase access token with `jose` against the project's JWKS (ES256/RS256 only, issuer and audience checked) and takes the user id only from `sub`. Unapproved, cap reached and disabled all answer the same generic `403`.

## Consequences
- The rules live in one place in the database and are tested against real Postgres, including that an unapproved email cannot create an account whatever the token says.
- The earlier wall test that the login role has no schema `USAGE` was relaxed to "no table privilege"; the schema ACL test now lists `app_<schema>` as a grantee.
- Supabase auth users can exist without an account here. That is harmless: every API call returns `403` for them.
- Update (owner decision after the v0.1 review): `DELETE /me` also deletes the Supabase Auth user, inside the same transaction right after `delete_account()`, with a server-only service key (`docs/setup/api-auth.md`). An Auth failure rolls the transaction back (502, retryable): committing first would make a retry impossible because the guard answers 403 once the allowlist entry is gone. This is the only place the API holds the service key.
- Needs check: that Supabase's admin role may create `SECURITY DEFINER` functions owned by `owner_<schema>` (the migration runs under `SET LOCAL ROLE owner_<schema>`, the same rights the earlier migrations already need).
