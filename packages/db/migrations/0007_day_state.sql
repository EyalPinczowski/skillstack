-- Day state (spec 3.2, 3.4): when a study day was started and ended, and the frozen snapshot of
-- the blocks that were planned for a past date, so a past day never changes after edits.
-- schedule_days is append-only like events: the app can add and read its own rows, never change
-- or remove them. day_sessions lets the app change only ended_at (a column grant).
-- Deleting a plan or an account removes both (cascade through the foreign keys).
set local role {{owner}};

create table {{schema}}.day_sessions (
  user_id uuid not null,
  plan_id uuid not null,
  -- A local date in the plan's time zone.
  date date not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  primary key (user_id, plan_id, date),
  foreign key (user_id, plan_id) references {{schema}}.plans (user_id, id) on delete cascade,
  check (ended_at is null or ended_at >= started_at)
);

create table {{schema}}.schedule_days (
  user_id uuid not null,
  plan_id uuid not null,
  date date not null,
  -- The blocks planned for this date (an array of the shared Block shape, possibly empty).
  blocks jsonb not null check (jsonb_typeof(blocks) = 'array'),
  frozen_at timestamptz not null default now(),
  source text not null check (source in ('day_end', 'auto_rollover')),
  primary key (user_id, plan_id, date),
  foreign key (user_id, plan_id) references {{schema}}.plans (user_id, id) on delete cascade
);

alter table {{schema}}.day_sessions enable row level security;
alter table {{schema}}.schedule_days enable row level security;

create policy app_user_select on {{schema}}.day_sessions
  for select to {{app_user}} using (user_id = (select {{schema}}.current_user_id()));
create policy app_user_insert on {{schema}}.day_sessions
  for insert to {{app_user}} with check (user_id = (select {{schema}}.current_user_id()));
create policy app_user_update on {{schema}}.day_sessions
  for update to {{app_user}}
  using (user_id = (select {{schema}}.current_user_id()))
  with check (user_id = (select {{schema}}.current_user_id()));
create policy backup_select on {{schema}}.day_sessions for select to {{backup}} using (true);

create policy app_user_select on {{schema}}.schedule_days
  for select to {{app_user}} using (user_id = (select {{schema}}.current_user_id()));
create policy app_user_insert on {{schema}}.schedule_days
  for insert to {{app_user}} with check (user_id = (select {{schema}}.current_user_id()));
create policy backup_select on {{schema}}.schedule_days for select to {{backup}} using (true);

revoke update, delete on {{schema}}.day_sessions from {{app_user}};
grant update (ended_at) on {{schema}}.day_sessions to {{app_user}};
revoke update, delete on {{schema}}.schedule_days from {{app_user}};
