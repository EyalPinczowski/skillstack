-- The plan data model (spec section 4, seams in 12.3): plans and everything a plan owns.
-- Every table has user_id. Client-generated ids are unique per user, not globally, so a retried
-- request is idempotent and nobody can probe whether an id exists for another user. Child rows
-- reference (user_id, plan_id) so a row can never be attached to another user's plan.
-- Dates are local `date` columns, times are `time` (HH:MM), instants are timestamptz.
set local role {{owner}};

-- study_weekdays must be 1-7 distinct values in 0-6 (0 = Sunday). A CHECK cannot contain a
-- subquery, so the distinctness test lives in a function.
create function {{schema}}.is_weekday_set(days smallint[]) returns boolean
  language sql immutable
  as $$ select days is not null
            and cardinality(days) between 1 and 7
            and days <@ array[0, 1, 2, 3, 4, 5, 6]::smallint[]
            and cardinality(days) = (select count(distinct d) from unnest(days) as d) $$;
revoke all on function {{schema}}.is_weekday_set(smallint[]) from public;
grant execute on function {{schema}}.is_weekday_set(smallint[]) to {{app_user}}, {{backup}};

create table {{schema}}.plans (
  user_id uuid not null references {{schema}}.app_users (id) on delete cascade,
  id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'active', 'archived', 'done')),
  created_from text not null check (created_from in ('builder', 'import')),
  name text not null check (btrim(name) <> ''),
  start_date date not null,
  end_date date,
  summary jsonb not null default '{}' check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  check (end_date is null or end_date >= start_date)
);
create index plans_user_status_idx on {{schema}}.plans (user_id, status);

-- At most one WeekPattern per plan.
create table {{schema}}.week_patterns (
  user_id uuid not null,
  plan_id uuid not null,
  study_weekdays smallint[] not null check ({{schema}}.is_weekday_set(study_weekdays)),
  default_hours numeric not null check (default_hours between 0 and 24),
  -- Keys "0".."6" to hours 0-24; the shape is validated by the API.
  hours_by_weekday jsonb not null default '{}' check (jsonb_typeof(hours_by_weekday) = 'object'),
  window_start time not null,
  window_end time not null,
  lunch_start time,
  lunch_end time,
  break_every_hours numeric not null default 2
    check (break_every_hours > 0 and break_every_hours <= 12),
  break_minutes integer not null default 10 check (break_minutes between 0 and 120),
  min_block_minutes integer not null default 30 check (min_block_minutes between 5 and 240),
  -- An IANA zone name such as Asia/Jerusalem. Whether the zone exists is checked by the API.
  timezone text not null check (btrim(timezone) <> ''),
  primary key (user_id, plan_id),
  foreign key (user_id, plan_id) references {{schema}}.plans (user_id, id) on delete cascade,
  check (window_end > window_start),
  check ((lunch_start is null) = (lunch_end is null)),
  check (lunch_end is null or lunch_end > lunch_start)
);

create table {{schema}}.day_overrides (
  user_id uuid not null,
  plan_id uuid not null,
  date date not null,
  is_study_day boolean not null,
  capacity_hours numeric check (capacity_hours between 0 and 24),
  primary key (user_id, plan_id, date),
  foreign key (user_id, plan_id) references {{schema}}.plans (user_id, id) on delete cascade
);

-- Task ids are the text ids of the shared schema (unique inside a plan).
create table {{schema}}.tasks (
  user_id uuid not null,
  plan_id uuid not null,
  id text not null check (id <> ''),
  title text not null check (btrim(title) <> ''),
  type text not null check (type in ('course', 'cert_exam', 'practice', 'admin', 'cv_update')),
  provider text,
  url text,
  est_hours numeric not null check (est_hours > 0 and est_hours <= 500),
  done_hours numeric not null default 0 check (done_hours >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'done', 'skipped')),
  -- "order" is a reserved word in SQL.
  sort_order integer not null check (sort_order >= 0),
  -- Task ids inside the same plan. Arrays cannot carry foreign keys; the API checks them.
  depends_on text[] not null default '{}',
  is_anchor boolean not null default false,
  anchor_date date,
  anchor_start_time time,
  pinned_start_date date,
  pinned_start_time time,
  not_before date,
  splittable boolean not null default true,
  is_certificate boolean not null default false,
  certificate_name text,
  lessons jsonb not null default '[]' check (jsonb_typeof(lessons) = 'array'),
  how_to_steps jsonb not null default '[]' check (jsonb_typeof(how_to_steps) = 'array'),
  prompt_template text,
  practice_kind text,
  notes text,
  source text not null default 'manual' check (source in ('manual', 'import', 'builder', 'auto')),
  external_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, plan_id, id),
  foreign key (user_id, plan_id) references {{schema}}.plans (user_id, id) on delete cascade,
  check (not (id = any (depends_on))),
  -- An anchor task needs a date and a start time, and must end by 23:59.
  constraint tasks_anchor_complete check (
    not is_anchor
    or (
      anchor_date is not null
      and anchor_start_time is not null
      and extract(epoch from anchor_start_time) / 60 + round(est_hours * 60) <= 1439
    )
  ),
  check ((pinned_start_date is null) = (pinned_start_time is null))
);
create index tasks_plan_order_idx on {{schema}}.tasks (user_id, plan_id, sort_order);
create index tasks_plan_status_idx on {{schema}}.tasks (user_id, plan_id, status);

-- Work logged against a task. Deleting a task or plan removes its logs.
create table {{schema}}.logs (
  user_id uuid not null,
  id uuid not null,
  plan_id uuid not null,
  task_id text not null,
  date date not null,
  hours numeric not null check (hours >= 0),
  result text,
  score numeric check (score >= 0),
  note text,
  created_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, plan_id) references {{schema}}.plans (user_id, id) on delete cascade,
  foreign key (user_id, plan_id, task_id)
    references {{schema}}.tasks (user_id, plan_id, id) on delete cascade
);
create index logs_task_date_idx on {{schema}}.logs (user_id, plan_id, task_id, date);
create index logs_plan_date_idx on {{schema}}.logs (user_id, plan_id, date);

-- Row-level security: a user sees and writes only rows with their own user_id.
do $$
declare t text;
begin
  foreach t in array array['plans', 'week_patterns', 'day_overrides', 'tasks', 'logs'] loop
    execute format('alter table {{schema}}.%I enable row level security', t);
    execute format(
      'create policy app_user_own on {{schema}}.%I for all to {{app_user}}
         using (user_id = (select {{schema}}.current_user_id()))
         with check (user_id = (select {{schema}}.current_user_id()))', t);
    execute format(
      'create policy backup_select on {{schema}}.%I for select to {{backup}} using (true)', t);
  end loop;
end
$$;
