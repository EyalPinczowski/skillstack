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

-- Nothing else is needed: policies use <schema>.current_user_id() from the migrations (ADR 010),
-- not Supabase's auth.uid(), so no stub of the auth schema exists here.
