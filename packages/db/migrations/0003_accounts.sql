-- Accounts (spec 3.A and section 4): the user profile row, global settings and legal acceptances.
-- Owned by the owner role, RLS enabled on every table, a SELECT policy for the backup role.
-- RLS is enabled but not forced: the owner role is NOLOGIN and only runs migrations and the
-- explicit admin/background paths, which must be able to create and manage users (ADR 010).
set local role {{owner}};

-- One row per signed-in user; id is the Supabase Auth user id. The app can read its own row and
-- change only display_name, last_seen_at and support_access_until (column grants below).
-- Rows are created and role/status changed only through the admin path (the owner role).
create table {{schema}}.app_users (
  id uuid primary key,
  email text not null check (email = btrim(email) and email <> ''),
  display_name text check (display_name is null or display_name <> ''),
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'active' check (status in ('active', 'disabled', 'deleted')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  -- Support access is off when null (spec 3.B).
  support_access_until timestamptz
);
create unique index app_users_email_key on {{schema}}.app_users (lower(email));

alter table {{schema}}.app_users enable row level security;

create policy app_user_select on {{schema}}.app_users
  for select to {{app_user}} using (id = (select {{schema}}.current_user_id()));
create policy app_user_update on {{schema}}.app_users
  for update to {{app_user}}
  using (id = (select {{schema}}.current_user_id()))
  with check (id = (select {{schema}}.current_user_id()));
create policy backup_select on {{schema}}.app_users for select to {{backup}} using (true);

revoke insert, update, delete on {{schema}}.app_users from {{app_user}};
grant update (display_name, last_seen_at, support_access_until)
  on {{schema}}.app_users to {{app_user}};

-- Global configuration, one row per key. No user_id: it is not user data. Signed-in users can
-- read the keys flagged is_public; nobody can write through the app.
create table {{schema}}.app_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]*$'),
  value jsonb not null,
  is_public boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table {{schema}}.app_settings enable row level security;

create policy app_user_select_public on {{schema}}.app_settings
  for select to {{app_user}}
  using (is_public and (select {{schema}}.current_user_id()) is not null);
create policy backup_select on {{schema}}.app_settings for select to {{backup}} using (true);

revoke insert, update, delete on {{schema}}.app_settings from {{app_user}};

-- Spec 3.A: capacity default 25. Spec 12.3: feature flags, all off.
insert into {{schema}}.app_settings (key, value, is_public) values
  ('user_cap', '25', true),
  ('features.notifications', 'false', true),
  ('features.sharing', 'false', true);

-- Which version of the Terms or Privacy Policy a user accepted, and when. Append-only for the
-- app: the user can add an acceptance, never change or remove one. accepted_at is set by the
-- database (the insert grant does not include it).
create table {{schema}}.legal_acceptances (
  user_id uuid not null references {{schema}}.app_users (id) on delete cascade,
  document text not null check (document in ('terms', 'privacy')),
  version text not null check (version <> ''),
  accepted_at timestamptz not null default now(),
  primary key (user_id, document, version)
);

alter table {{schema}}.legal_acceptances enable row level security;

create policy app_user_select on {{schema}}.legal_acceptances
  for select to {{app_user}} using (user_id = (select {{schema}}.current_user_id()));
create policy app_user_insert on {{schema}}.legal_acceptances
  for insert to {{app_user}} with check (user_id = (select {{schema}}.current_user_id()));
create policy backup_select on {{schema}}.legal_acceptances for select to {{backup}} using (true);

revoke insert, update, delete on {{schema}}.legal_acceptances from {{app_user}};
grant insert (user_id, document, version) on {{schema}}.legal_acceptances to {{app_user}};
