-- AI usage accounting (v0.3, plan sections 2.1 and 3.2). Nothing here names a provider: provider
-- ids are free text (a lower-case slug, validated again in the API), so a provider change never
-- needs a migration.
--
-- ai_usage_daily: per user, UTC day and purpose, how many model calls were reserved and how many
--   were avoided (cache, template, rubric). The API reserves atomically with
--   INSERT ... ON CONFLICT DO UPDATE ... WHERE requests < cap. No DELETE for the app.
-- ai_cache: the model text for an already-redacted request, per user (so nothing leaks between
--   users and RLS applies). Expired rows are pruned by the API on write, hence DELETE is allowed
--   on the user's own rows.
-- ai_provider_usage: the environment-wide counter per provider and UTC day. It belongs to no
--   user, so the app role has NO privilege and NO policy on it. It is reached only through two
--   SECURITY DEFINER functions (below), which need review: ai_reserve_provider and
--   ai_provider_usage_today.
-- Deleting an account removes ai_usage_daily and ai_cache (cascade from app_users).
set local role {{owner}};

create table {{schema}}.ai_usage_daily (
  user_id uuid not null references {{schema}}.app_users (id) on delete cascade,
  -- The UTC day.
  day date not null,
  purpose text not null check (purpose in ('practice_message', 'practice_feedback', 'day_overview')),
  requests integer not null default 0 check (requests >= 0),
  avoided integer not null default 0 check (avoided >= 0),
  primary key (user_id, day, purpose)
);

create table {{schema}}.ai_cache (
  user_id uuid not null references {{schema}}.app_users (id) on delete cascade,
  -- sha256 (hex) of the redacted request.
  key text not null check (key ~ '^[0-9a-f]{64}$'),
  purpose text not null check (purpose in ('practice_message', 'practice_feedback', 'day_overview')),
  text text not null check (char_length(text) <= 8000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, key),
  check (expires_at > created_at)
);
create index ai_cache_expiry_idx on {{schema}}.ai_cache (user_id, expires_at);

create table {{schema}}.ai_provider_usage (
  day date not null,
  provider_id text not null check (provider_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  requests integer not null default 0 check (requests >= 0),
  primary key (day, provider_id)
);

alter table {{schema}}.ai_usage_daily enable row level security;
alter table {{schema}}.ai_cache enable row level security;
alter table {{schema}}.ai_provider_usage enable row level security;

create policy app_user_select on {{schema}}.ai_usage_daily
  for select to {{app_user}} using (user_id = (select {{schema}}.current_user_id()));
create policy app_user_insert on {{schema}}.ai_usage_daily
  for insert to {{app_user}} with check (user_id = (select {{schema}}.current_user_id()));
create policy app_user_update on {{schema}}.ai_usage_daily
  for update to {{app_user}}
  using (user_id = (select {{schema}}.current_user_id()))
  with check (user_id = (select {{schema}}.current_user_id()));
create policy backup_select on {{schema}}.ai_usage_daily for select to {{backup}} using (true);

create policy app_user_select on {{schema}}.ai_cache
  for select to {{app_user}} using (user_id = (select {{schema}}.current_user_id()));
create policy app_user_insert on {{schema}}.ai_cache
  for insert to {{app_user}} with check (user_id = (select {{schema}}.current_user_id()));
create policy app_user_update on {{schema}}.ai_cache
  for update to {{app_user}}
  using (user_id = (select {{schema}}.current_user_id()))
  with check (user_id = (select {{schema}}.current_user_id()));
create policy app_user_delete on {{schema}}.ai_cache
  for delete to {{app_user}} using (user_id = (select {{schema}}.current_user_id()));
create policy backup_select on {{schema}}.ai_cache for select to {{backup}} using (true);

-- No app_user policy and no privilege on ai_provider_usage: only the functions below touch it.
create policy backup_select on {{schema}}.ai_provider_usage for select to {{backup}} using (true);

-- Counters only go up: the app cannot lower its own usage (a direct UPDATE of a smaller value).
create function {{schema}}.ai_usage_daily_monotonic() returns trigger
  language plpgsql
  set search_path = {{schema}}, pg_temp
  as $$
begin
  if new.requests < old.requests or new.avoided < old.avoided then
    raise exception 'ai_usage_daily counters cannot decrease';
  end if;
  return new;
end
$$;
create trigger ai_usage_daily_monotonic before update on {{schema}}.ai_usage_daily
  for each row execute function {{schema}}.ai_usage_daily_monotonic();

revoke update, delete on {{schema}}.ai_usage_daily from {{app_user}};
grant update (requests, avoided) on {{schema}}.ai_usage_daily to {{app_user}};
revoke update on {{schema}}.ai_cache from {{app_user}};
grant update (purpose, text, created_at, expires_at) on {{schema}}.ai_cache to {{app_user}};
revoke all on {{schema}}.ai_provider_usage from {{app_user}};

-- Reserves one call against a provider's environment budget for the current UTC day (computed
-- here; the caller cannot choose the day). Returns true and counts it when fewer than p_budget
-- calls were reserved so far; returns false (and changes nothing) when the budget is reached or
-- not positive. The single INSERT ... ON CONFLICT DO UPDATE ... WHERE takes the row lock, so
-- concurrent callers can never exceed the budget.
-- It needs a signed-in user context (so it is not a free counter for anyone), a budget of
-- 1..1000000 and a provider id slug. No dynamic SQL; search_path is pinned.
-- What it guarantees: an atomic counter. What it does not: protection against a caller who lies
-- about the budget. The only caller is the backend, and the budget comes from server config.
-- HOW TO CALL IT (requirement for the AI gateway): reserve in its own short, committed
-- transaction BEFORE the network call. Never inside a transaction that also makes the provider
-- call: the row lock would be held until commit, and a rollback would erase a call that really
-- happened.
create function {{schema}}.ai_reserve_provider(p_provider text, p_budget integer)
  returns boolean
  language plpgsql
  security definer
  set search_path = {{schema}}, pg_temp
  as $$
declare
  v_day date := (now() at time zone 'utc')::date;
  v_count integer;
begin
  if {{schema}}.current_user_id() is null or p_provider is null or p_budget is null then
    return false;
  end if;
  if p_provider !~ '^[a-z0-9][a-z0-9_-]{0,63}$'
     or p_budget < 1 or p_budget > 1000000 then
    return false;
  end if;
  insert into {{schema}}.ai_provider_usage as u (day, provider_id, requests)
  values (v_day, p_provider, 1)
  on conflict (day, provider_id) do update set requests = u.requests + 1
    where u.requests < p_budget
  returning u.requests into v_count;
  return v_count is not null;
end
$$;

-- Today's (UTC) counters per provider, for the usage meter. Read only; a signed-in user only.
-- Uses the same UTC day expression as ai_reserve_provider.
create function {{schema}}.ai_provider_usage_today()
  returns table (provider_id text, requests integer)
  language sql
  stable
  security definer
  set search_path = {{schema}}, pg_temp
  as $$
  select u.provider_id, u.requests
    from {{schema}}.ai_provider_usage u
   where {{schema}}.current_user_id() is not null
     and u.day = (now() at time zone 'utc')::date
   order by u.provider_id
$$;

revoke all on function {{schema}}.ai_reserve_provider(text, integer) from public;
grant execute on function {{schema}}.ai_reserve_provider(text, integer) to {{app_user}};
revoke all on function {{schema}}.ai_provider_usage_today() from public;
grant execute on function {{schema}}.ai_provider_usage_today() to {{app_user}};
