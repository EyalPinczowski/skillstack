-- Append-only event log (spec 12.3): task.started, task.logged, certificate.earned, ...
-- The app can add and read its own events but never change or remove them: both the table
-- privileges and the policies leave out UPDATE and DELETE. Deleting a plan or an account
-- removes its events (cascade, done by the owner/admin path or the foreign key).
set local role {{owner}};

create table {{schema}}.events (
  user_id uuid not null references {{schema}}.app_users (id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  plan_id uuid,
  -- Dotted lower-case name, e.g. task.started or anchor.at_risk.
  type text not null check (type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  payload jsonb not null default '{}' check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, plan_id) references {{schema}}.plans (user_id, id) on delete cascade
);
create index events_user_created_idx on {{schema}}.events (user_id, created_at desc);
create index events_plan_created_idx on {{schema}}.events (user_id, plan_id, created_at desc);

alter table {{schema}}.events enable row level security;

create policy app_user_select on {{schema}}.events
  for select to {{app_user}} using (user_id = (select {{schema}}.current_user_id()));
create policy app_user_insert on {{schema}}.events
  for insert to {{app_user}} with check (user_id = (select {{schema}}.current_user_id()));
create policy backup_select on {{schema}}.events for select to {{backup}} using (true);

revoke update, delete on {{schema}}.events from {{app_user}};
