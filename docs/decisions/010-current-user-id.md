# 010 – Row-level security reads the user from `current_user_id()`, not `auth.uid()`

**Status:** Accepted · built in v0.1 (migration 0002)

## Context
Spec 3.A says every user-owned row is readable only when `user_id = auth.uid()`. On Supabase, `auth.uid()` lives in the `auth` schema, which Supabase owns. The backend runs each request as `app_<schema>_user` (ADR 003), a role we create ourselves. Whether that role has USAGE on schema `auth` and EXECUTE on `auth.uid()` was never verified (phase 0 review, finding 2), and the test database could only stub it with grants to PUBLIC, so the tests could not have caught a missing grant. Every user table would have depended on that unverified fact.

## Options
1. Keep `auth.uid()` and grant `app_<schema>_user` access to the `auth` schema. Touches a schema we do not own; Supabase can change it, and the grants are unverified.
2. A function in our own schema, `<schema>.current_user_id()`, that reads the same setting the backend already sets per request.

## Decision
Option 2. Migration 0002 creates `<schema>.current_user_id()`: SQL, `STABLE`, `SECURITY INVOKER`, owned by the owner role, EXECUTE granted only to `app_<schema>_user` and `backup_<schema>`. It returns `nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid`. Without a user context (no setting, an empty setting, or claims without `sub`) it returns NULL, so `user_id = current_user_id()` is never true and a query sees no rows. The inner `nullif(..., '')` matters: after a transaction that used `set_config(..., true)`, the setting stays defined as an empty string for the rest of the session, and casting it to json would raise an error. Policies wrap the call as `(select current_user_id())` so Postgres evaluates it once per statement.

The test setup no longer contains a stub of the `auth` schema; the tests exercise the real function from the migrations.

## Consequences
- Behaviour is equivalent to `auth.uid()` for our use: both read `sub` from `request.jwt.claims`. The spec text still says `auth.uid()`; it should say `current_user_id()` the next time the spec is edited. The token is still the user's verified Supabase JWT subject, and the backend still never takes a user id from the client.
- Each environment has its own function in its own schema, so prod and rnd stay walled from each other.
- Admin and background paths do not use it: they run as the owner role (RLS is enabled but not forced, so the owner is not filtered) through separate, explicitly named code. Creating `app_users` rows, changing `role` and `status`, and deleting accounts are such paths.
- A non-UUID `sub` makes the query fail with a cast error instead of returning rows. That is fail-closed and intended.
- The remaining unverified Supabase facts (admin role rights, PG version, pooler behaviour) are listed in `packages/db/README.md`.
