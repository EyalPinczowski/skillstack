-- Creates or repairs one environment: roles, schema, grants. Safe to run on every migrate.
-- Tokens: {{schema}} {{owner}} {{app}} {{app_user}} {{backup}} (see src/render.ts).
-- Run by an admin role that has CREATEROLE (it need not be a superuser).
--
--   {{owner}}     NOLOGIN. Owns the schema and every object in it. Nobody logs in as it.
--   {{app}}       The backend's login. Holds NO privileges of its own (NOINHERIT): it must
--                 SET LOCAL ROLE {{app_user}} inside each request transaction.
--   {{app_user}}  NOLOGIN. Gets the table privileges; row-level security policies target it.
--   {{backup}}    Read-only login for backups. Sees rows only through explicit SELECT policies.
--
-- No role here has BYPASSRLS, and nothing is granted to PUBLIC, anon, authenticated or
-- service_role. No role in this environment is a member of a role of the other environment.

-- Roles. Attributes are re-asserted by the ALTER ROLE statements on every run, so a role that
-- was changed by hand is repaired. No password is ever set here (see the set-passwords command).
do $$
begin
  if not exists (select from pg_roles where rolname = '{{owner}}') then
    create role {{owner}};
  end if;
  if not exists (select from pg_roles where rolname = '{{app}}') then
    create role {{app}};
  end if;
  if not exists (select from pg_roles where rolname = '{{app_user}}') then
    create role {{app_user}};
  end if;
  if not exists (select from pg_roles where rolname = '{{backup}}') then
    create role {{backup}};
  end if;
end
$$;

-- SUPERUSER and REPLICATION are left out on purpose: only a role that has those attributes may
-- change them, so a non-superuser admin gets "permission denied to alter role" for NOSUPERUSER.
-- CREATE ROLE already defaults to NOSUPERUSER NOREPLICATION; the check below fails the run if
-- either was ever granted by someone else.
alter role {{owner}} nologin nocreatedb nocreaterole nobypassrls noinherit;
alter role {{app_user}} nologin nocreatedb nocreaterole nobypassrls noinherit;
alter role {{app}} login nocreatedb nocreaterole nobypassrls noinherit;
alter role {{backup}} login nocreatedb nocreaterole nobypassrls noinherit;

do $$
declare r record;
begin
  for r in
    select rolname from pg_roles
    where rolname in ('{{owner}}', '{{app}}', '{{app_user}}', '{{backup}}')
      and (rolsuper or rolreplication)
  loop
    raise exception 'role % has SUPERUSER or REPLICATION; a superuser must remove it', r.rolname;
  end loop;
end
$$;

-- The backend can become {{app_user}} (SET ROLE) but does not inherit its privileges.
grant {{app_user}} to {{app}};

-- Lets a non-superuser admin SET ROLE {{owner}} to create objects as the owner.
grant {{owner}} to current_user;

-- The schema is owned by {{owner}}, not by the admin that runs this script.
create schema if not exists {{schema}} authorization {{owner}};
alter schema {{schema}} owner to {{owner}};

-- The wall: only this environment's roles can use the schema. Nothing for PUBLIC.
revoke all on schema {{schema}} from public;
revoke all on schema {{schema}} from {{app}};
grant usage on schema {{schema}} to {{app_user}}, {{backup}};
-- The login role needs USAGE (nothing else) to call provision_user(), the one function it may
-- execute directly (migration 0006). It still has no privilege on any table.
grant usage on schema {{schema}} to {{app}};

-- The login role has no way into the database objects except via {{app_user}}.
revoke all on all tables in schema {{schema}} from {{app}};

-- Privileges for objects {{owner}} creates later (and does not yet have).
alter default privileges for role {{owner}} in schema {{schema}}
  grant select, insert, update, delete on tables to {{app_user}};
alter default privileges for role {{owner}} in schema {{schema}}
  grant select on tables to {{backup}};
alter default privileges for role {{owner}} in schema {{schema}}
  grant usage, select on sequences to {{app_user}};
-- pg_dump reads every sequence (SELECT last_value ...), so the backup role needs SELECT on them.
alter default privileges for role {{owner}} in schema {{schema}}
  grant select on sequences to {{backup}};
-- Functions are executable by PUBLIC by default; take that away. This default cannot be
-- limited to one schema, it applies to every function {{owner}} creates.
alter default privileges for role {{owner}} revoke execute on functions from public;

-- The migration ledger lives here too. It is created under the owner role, like every object.
-- It follows the same convention as all tables: RLS on, and a SELECT policy for the backup role.
-- App users get no privileges on it.
set local role {{owner}};

create table if not exists {{schema}}.schema_migrations (
  version text primary key,
  name text not null,
  checksum text not null,
  applied_at timestamptz not null default now()
);

alter table {{schema}}.schema_migrations enable row level security;

drop policy if exists backup_select on {{schema}}.schema_migrations;
create policy backup_select on {{schema}}.schema_migrations
  for select to {{backup}} using (true);

revoke all on {{schema}}.schema_migrations from {{app_user}};

reset role;
