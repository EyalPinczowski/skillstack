-- Practice (v0.3, plan section 2.1): the job description a user keeps per plan, practice
-- sessions on a practice task, their message transcript and the feedback each one ends with.
-- Everything here is Tier 2 (spec 3.B): the text never goes to events or logs.
--
-- practice_contexts: one row per plan. The app can add it, read it and change the text; it can
--   never delete it (an empty string clears the job description).
-- practice_sessions: a narrow update grant (status, end time, the pending-turn marker and the
--   list of providers used). The user, plan, task, kind, channel and prompt can never change.
--   At most one active session per task (a partial unique index).
-- practice_messages and practice_feedback: append-only like events. The app can add and read its
--   own rows, never change or remove them. One feedback per session.
-- No provider name is written into any constraint: provider ids are free text (checked in the
-- API), so changing the provider list never needs a migration.
-- Deleting a plan, a task or an account removes all four tables' rows (cascade).
set local role {{owner}};

create table {{schema}}.practice_contexts (
  user_id uuid not null,
  plan_id uuid not null,
  job_description text not null default '' check (char_length(job_description) <= 8000),
  updated_at timestamptz not null default now(),
  primary key (user_id, plan_id),
  foreign key (user_id, plan_id) references {{schema}}.plans (user_id, id) on delete cascade
);

create table {{schema}}.practice_sessions (
  user_id uuid not null,
  -- Chosen by the client, so a retried create is idempotent.
  id uuid not null,
  plan_id uuid not null,
  task_id text not null,
  practice_kind text not null check (btrim(practice_kind) <> '' and char_length(practice_kind) <= 100),
  persona text not null check (btrim(persona) <> '' and char_length(persona) <= 100),
  channel text not null check (channel in ('in_app', 'external', 'self')),
  status text not null default 'active' check (status in ('active', 'finished', 'abandoned')),
  planned_minutes integer not null check (planned_minutes between 1 and 1440),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  -- The built prompt, which has had personal details removed. Never the raw job description.
  prompt_used text not null check (char_length(prompt_used) <= 20000),
  -- Which inputs the prompt used (flags, counts and topic ids; no free text).
  prompt_inputs jsonb not null default '{}' check (jsonb_typeof(prompt_inputs) = 'object'),
  -- A model turn in flight: set before the provider call, cleared after it. Stale after 60 s
  -- (the API clears it); both or neither.
  pending_turn_id uuid,
  pending_since timestamptz,
  -- Ids of the providers that answered in this session (free text, validated in the API).
  providers_used text[] not null default '{}' check (cardinality(providers_used) <= 20),
  primary key (user_id, id),
  foreign key (user_id, plan_id, task_id) references {{schema}}.tasks (user_id, plan_id, id)
    on delete cascade,
  check ((status = 'active') = (ended_at is null)),
  check (ended_at is null or ended_at >= started_at),
  check ((pending_turn_id is null) = (pending_since is null))
);
create index practice_sessions_kind_idx
  on {{schema}}.practice_sessions (user_id, plan_id, practice_kind, started_at);
create unique index practice_sessions_one_active_idx
  on {{schema}}.practice_sessions (user_id, plan_id, task_id) where status = 'active';

create table {{schema}}.practice_messages (
  user_id uuid not null,
  session_id uuid not null,
  -- The client's id for a user turn, the server's for a reply.
  id uuid not null,
  seq integer not null check (seq >= 0),
  role text not null check (role in ('user', 'assistant', 'note')),
  content text not null check (char_length(content) <= 8000),
  provider_id text check (provider_id is null or char_length(provider_id) between 1 and 64),
  model text check (model is null or char_length(model) between 1 and 200),
  -- True when personal details were removed from this turn before any model saw it.
  redacted boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, session_id, id),
  unique (user_id, session_id, seq),
  foreign key (user_id, session_id) references {{schema}}.practice_sessions (user_id, id)
    on delete cascade
);

create table {{schema}}.practice_feedback (
  user_id uuid not null,
  session_id uuid not null,
  source text not null
    check (source in ('model_json', 'model_repaired', 'pasted_block', 'free_text', 'self_rubric')),
  score numeric check (score is null or (score >= 0 and score <= 10)),
  strengths text not null default '' check (char_length(strengths) <= 2000),
  improve text not null default '' check (char_length(improve) <= 2000),
  next_focus text not null default '' check (char_length(next_focus) <= 2000),
  raw text check (raw is null or char_length(raw) <= 20000),
  created_at timestamptz not null default now(),
  primary key (user_id, session_id),
  foreign key (user_id, session_id) references {{schema}}.practice_sessions (user_id, id)
    on delete cascade
);

alter table {{schema}}.practice_contexts enable row level security;
alter table {{schema}}.practice_sessions enable row level security;
alter table {{schema}}.practice_messages enable row level security;
alter table {{schema}}.practice_feedback enable row level security;

create policy app_user_select on {{schema}}.practice_contexts
  for select to {{app_user}} using (user_id = (select {{schema}}.current_user_id()));
create policy app_user_insert on {{schema}}.practice_contexts
  for insert to {{app_user}} with check (user_id = (select {{schema}}.current_user_id()));
create policy app_user_update on {{schema}}.practice_contexts
  for update to {{app_user}}
  using (user_id = (select {{schema}}.current_user_id()))
  with check (user_id = (select {{schema}}.current_user_id()));
create policy backup_select on {{schema}}.practice_contexts for select to {{backup}} using (true);

create policy app_user_select on {{schema}}.practice_sessions
  for select to {{app_user}} using (user_id = (select {{schema}}.current_user_id()));
create policy app_user_insert on {{schema}}.practice_sessions
  for insert to {{app_user}} with check (user_id = (select {{schema}}.current_user_id()));
create policy app_user_update on {{schema}}.practice_sessions
  for update to {{app_user}}
  using (user_id = (select {{schema}}.current_user_id()))
  with check (user_id = (select {{schema}}.current_user_id()));
create policy backup_select on {{schema}}.practice_sessions for select to {{backup}} using (true);

create policy app_user_select on {{schema}}.practice_messages
  for select to {{app_user}} using (user_id = (select {{schema}}.current_user_id()));
create policy app_user_insert on {{schema}}.practice_messages
  for insert to {{app_user}} with check (user_id = (select {{schema}}.current_user_id()));
create policy backup_select on {{schema}}.practice_messages for select to {{backup}} using (true);

create policy app_user_select on {{schema}}.practice_feedback
  for select to {{app_user}} using (user_id = (select {{schema}}.current_user_id()));
create policy app_user_insert on {{schema}}.practice_feedback
  for insert to {{app_user}} with check (user_id = (select {{schema}}.current_user_id()));
create policy backup_select on {{schema}}.practice_feedback for select to {{backup}} using (true);

revoke update, delete on {{schema}}.practice_contexts from {{app_user}};
grant update (job_description, updated_at) on {{schema}}.practice_contexts to {{app_user}};
revoke update, delete on {{schema}}.practice_sessions from {{app_user}};
grant update (status, ended_at, pending_turn_id, pending_since, providers_used)
  on {{schema}}.practice_sessions to {{app_user}};
revoke update, delete on {{schema}}.practice_messages from {{app_user}};
revoke update, delete on {{schema}}.practice_feedback from {{app_user}};
