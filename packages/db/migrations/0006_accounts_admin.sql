-- Closed beta access control (spec 3.A): the allowlist and the one place accounts are created.
-- The app role can never insert into app_users (migration 0003). The only way in is
-- provision_user(), a SECURITY DEFINER function owned by the owner role that checks the
-- allowlist and the user cap first. An email that is not on the list cannot create an
-- account, whichever sign-in method (email code, magic link, Google) produced the token.
set local role {{owner}};

-- Approved emails, stored lower-case. Written only through the owner/admin path (the
-- promote-admin command now, the admin console later). The app roles have no privilege on it.
create table {{schema}}.allowed_emails (
  email text primary key check (email = lower(btrim(email)) and email <> ''),
  -- Free text such as 'promote-admin' or an admin's email; it is not a foreign key on purpose.
  added_by text,
  created_at timestamptz not null default now()
);

alter table {{schema}}.allowed_emails enable row level security;
create policy backup_select on {{schema}}.allowed_emails for select to {{backup}} using (true);
revoke all on {{schema}}.allowed_emails from {{app_user}};

-- Creates the profile row of a verified user on their first request, or returns the existing
-- one. Runs with the owner's rights (RLS is not forced, so the owner can insert). search_path is
-- pinned so nothing can shadow the objects it uses. Failures use SQLSTATE P0001 with a stable
-- message: 'not_allowed' (email not on the list, or email already belongs to another account)
-- or 'cap_reached' (active users >= app_settings user_cap).
create function {{schema}}.provision_user(p_id uuid, p_email text) returns {{schema}}.app_users
  language plpgsql
  security definer
  set search_path = {{schema}}, pg_temp
  as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_cap integer;
  v_row {{schema}}.app_users;
begin
  if p_id is null or v_email = '' then
    raise exception 'not_allowed';
  end if;

  select * into v_row from {{schema}}.app_users where id = p_id;
  if found then
    return v_row;
  end if;

  if not exists (select from {{schema}}.allowed_emails where email = v_email) then
    raise exception 'not_allowed';
  end if;

  select (value #>> '{}')::integer into v_cap from {{schema}}.app_settings where key = 'user_cap';
  if v_cap is null then
    -- Fail closed when the setting is missing or not a number.
    raise exception 'cap_reached';
  end if;
  if (select count(*) from {{schema}}.app_users where status = 'active') >= v_cap then
    raise exception 'cap_reached';
  end if;

  begin
    insert into {{schema}}.app_users (id, email) values (p_id, v_email) returning * into v_row;
  exception when unique_violation then
    -- Either a concurrent first request created this id (return it) or the email is taken.
    select * into v_row from {{schema}}.app_users where id = p_id;
    if not found then
      raise exception 'not_allowed';
    end if;
  end;
  return v_row;
end
$$;

-- EXECUTE only for the backend's login role, which calls it before it switches to the user role.
-- Not PUBLIC, and not the app user role: a request running as a user cannot create accounts.
revoke all on function {{schema}}.provision_user(uuid, text) from public;
revoke all on function {{schema}}.provision_user(uuid, text) from {{app_user}};
grant execute on function {{schema}}.provision_user(uuid, text) to {{app}};
