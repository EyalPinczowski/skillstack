-- The identity function every row-level security policy uses (ADR 010).
-- It reads the verified user's id from the claims the backend sets for each request
-- (set_config('request.jwt.claims', '{"sub": "<uuid>"}', true) inside the request transaction).
-- Without a user context it returns NULL, so `user_id = current_user_id()` is never true and a
-- query without a user sees no rows. An empty setting counts as "no claims": after a transaction
-- that used set_config(..., true) the setting stays defined as '' for the session, and casting ''
-- to json would raise an error instead of returning no rows.
set local role {{owner}};

create or replace function {{schema}}.current_user_id() returns uuid
  language sql stable
  as $$ select nullif(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub', '')::uuid $$;

revoke all on function {{schema}}.current_user_id() from public;
grant execute on function {{schema}}.current_user_id() to {{app_user}}, {{backup}};
