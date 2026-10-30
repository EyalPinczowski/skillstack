-- One-time setup of the throwaway test database. Run as a superuser, for example:
--   psql -h 127.0.0.1 -U postgres -f packages/db/test/setup.sql
-- Used by scripts/test-postgres.sh (local) and the `db` job in .github/workflows/ci.yml.
-- Test infrastructure only: nothing here is applied to a real environment.
\set ON_ERROR_STOP on

-- `migrator` mimics the default admin role of a managed Postgres: NOT a superuser, but it can
-- create roles and databases and it bypasses RLS. Whether Supabase's `postgres` role has exactly
-- these rights is "needs check" (see packages/db/README.md). It has no password here; the
-- cluster's pg_hba (or the CI step) decides how it logs in.
select 'create role migrator login createrole createdb bypassrls nosuperuser'
where not exists (select from pg_roles where rolname = 'migrator')
\gexec

select 'create database skillstack_test owner migrator'
where not exists (select from pg_database where datname = 'skillstack_test')
\gexec

\connect skillstack_test

-- Stub of Supabase's `auth.uid()`. Supabase provides the real `auth` schema, so this stub must
-- never be part of a migration. It reads the same setting the backend sets per request.
create schema if not exists auth;
create or replace function auth.uid() returns uuid
  language sql stable
  as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
grant usage on schema auth to public;
grant execute on function auth.uid() to public;
