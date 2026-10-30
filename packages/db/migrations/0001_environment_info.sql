-- Lets the API ask "which environment am I on?" and is the reference example of the table
-- convention: owned by the owner role, RLS enabled, a SELECT policy for the backup role.
set local role {{owner}};

create table {{schema}}.environment_info (
  id boolean primary key default true check (id),
  name text not null
);

insert into {{schema}}.environment_info (name) values ('{{schema}}');

alter table {{schema}}.environment_info enable row level security;

-- Every signed-in user of this environment may read it; nobody can change it through the app
-- (there is no INSERT/UPDATE/DELETE policy, so those are denied under RLS).
create policy app_user_select on {{schema}}.environment_info
  for select to {{app_user}} using (true);

-- Convention: every table has a SELECT policy for the backup role.
create policy backup_select on {{schema}}.environment_info
  for select to {{backup}} using (true);
