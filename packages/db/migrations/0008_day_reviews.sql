-- End-of-day reviews and the adjustment suggestions the user decided on (spec 3.4, section 4).
--
-- day_reviews: one review per plan and date. The app can add and read its own reviews and can
-- re-save the ratings, note and outcomes of an existing one (a column grant: date, plan and
-- user can never change, and reviews are never deleted by the app). The API only allows the
-- edit while the plan's own "today" is the review date or the day after; the database cannot
-- know the plan's time zone clock, so that window lives in the API (docs/api-reviews.md).
--
-- adjustments: the user's accepted or rejected suggestions. Append-only like events: the app
-- can add and read its own rows, never change or remove them, so the evidence an accepted
-- suggestion used cannot be rewritten and reused. One row per plan and suggestion id.
-- Deleting a plan or an account removes both tables' rows (cascade through the foreign keys).
set local role {{owner}};

create table {{schema}}.day_reviews (
  user_id uuid not null,
  plan_id uuid not null,
  -- A local date in the plan's time zone.
  date date not null,
  difficulty smallint not null check (difficulty between 1 and 5),
  -- 1 = too light, 3 = just right, 5 = too much.
  density smallint not null check (density between 1 and 5),
  energy smallint not null check (energy between 1 and 5),
  note text not null default '' check (char_length(note) <= 2000),
  -- An array of the shared TaskOutcome shape (taskId, outcome, hours, reason), checked by the API.
  outcomes jsonb not null default '[]'
    check (case when jsonb_typeof(outcomes) = 'array' then jsonb_array_length(outcomes) <= 200
                else false end),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, plan_id, date),
  foreign key (user_id, plan_id) references {{schema}}.plans (user_id, id) on delete cascade
);

create table {{schema}}.adjustments (
  user_id uuid not null,
  plan_id uuid not null,
  -- The engine's deterministic id of the suggestion (a hash of its rule and evidence key).
  suggestion_id text not null check (btrim(suggestion_id) <> '' and char_length(suggestion_id) <= 100),
  rule text not null
    check (rule in ('density_too_high', 'density_too_low', 'estimate_drift', 'difficulty_practice')),
  key text not null check (btrim(key) <> '' and char_length(key) <= 1000),
  -- {reviewDates: [...], taskIds: [...]}: what the suggestion was based on. An accepted
  -- suggestion's evidence is never used for another suggestion of the same rule.
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  status text not null check (status in ('accepted', 'rejected')),
  -- Which option (0 = the recommended one) was applied; null for a rejection.
  option_index smallint check (option_index between 0 and 9),
  -- The change that was applied and the change summary shown to the user (accepted only).
  applied_change jsonb check (applied_change is null or jsonb_typeof(applied_change) = 'object'),
  summary jsonb check (summary is null or jsonb_typeof(summary) = 'object'),
  decided_at timestamptz not null default now(),
  primary key (user_id, plan_id, suggestion_id),
  foreign key (user_id, plan_id) references {{schema}}.plans (user_id, id) on delete cascade,
  check ((status = 'accepted') = (option_index is not null)),
  check ((status = 'accepted') = (applied_change is not null))
);
create index adjustments_plan_decided_idx on {{schema}}.adjustments (user_id, plan_id, decided_at);

alter table {{schema}}.day_reviews enable row level security;
alter table {{schema}}.adjustments enable row level security;

create policy app_user_select on {{schema}}.day_reviews
  for select to {{app_user}} using (user_id = (select {{schema}}.current_user_id()));
create policy app_user_insert on {{schema}}.day_reviews
  for insert to {{app_user}} with check (user_id = (select {{schema}}.current_user_id()));
create policy app_user_update on {{schema}}.day_reviews
  for update to {{app_user}}
  using (user_id = (select {{schema}}.current_user_id()))
  with check (user_id = (select {{schema}}.current_user_id()));
create policy backup_select on {{schema}}.day_reviews for select to {{backup}} using (true);

create policy app_user_select on {{schema}}.adjustments
  for select to {{app_user}} using (user_id = (select {{schema}}.current_user_id()));
create policy app_user_insert on {{schema}}.adjustments
  for insert to {{app_user}} with check (user_id = (select {{schema}}.current_user_id()));
create policy backup_select on {{schema}}.adjustments for select to {{backup}} using (true);

revoke update, delete on {{schema}}.day_reviews from {{app_user}};
grant update (difficulty, density, energy, note, outcomes, updated_at)
  on {{schema}}.day_reviews to {{app_user}};
revoke update, delete on {{schema}}.adjustments from {{app_user}};
