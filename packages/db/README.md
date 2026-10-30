# @skillstack/db

Database environments (`prod`, `rnd`) and the migration runner. Background: ADR 003 and SPEC sections 3.A, 5 and 6.

## Conventions

1. Only two environments exist: schemas `prod` and `rnd`. Every migration run names its schema explicitly; the runner refuses anything else (`public`, empty, `PROD`, injection text) before it connects.
2. Every table in an environment schema has **row-level security enabled** and a **SELECT policy for `backup_<schema>`** (`using (true)`). Policies for app users target `app_<schema>_user` and use `auth.uid()`.
3. Nothing has `BYPASSRLS`. Objects are created under `SET LOCAL ROLE {{owner}}` so `owner_<schema>` owns them.
4. Nothing is granted to `PUBLIC`, `anon`, `authenticated` or `service_role`. The shared Supabase `authenticated` role is not used.
5. Migrations are additive, named `NNNN_name.sql`, never edited after they were applied (the runner compares checksums and fails naming the file).
6. `findConventionViolations(client, schema)` (exported from `src/`) checks convention 2; call it in the tests of every migration branch.

SQL tokens: `{{schema}} {{owner}} {{app}} {{app_user}} {{backup}}`. Anything else in `{{ }}` is an error.

## How the roles fit together (per schema `s`)

| Role             | Login | Purpose                                                                                                                 |
| ---------------- | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| `owner_<s>`      | no    | Owns the schema and every object in it.                                                                                 |
| `app_<s>`        | yes   | The backend connects as this. NOINHERIT, so it has no privileges until it switches role. No password in any file.      |
| `app_<s>_user`   | no    | The backend runs `SET LOCAL ROLE app_<s>_user` and `set_config('request.jwt.claims', <json>, true)` in each request transaction. Holds the table privileges; RLS applies to it. |
| `backup_<s>`     | yes   | Read-only; sees rows only through explicit SELECT policies.                                                             |

`app_<s>` is a member of `app_<s>_user`. No role of one environment is a member of, or has USAGE on, anything of the other. All roles: NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS, NOINHERIT.

## Commands

```bash
DATABASE_URL=... pnpm --filter @skillstack/db migrate migrate --schema rnd --dry-run
pnpm --filter @skillstack/db migrate migrate --schema rnd
pnpm --filter @skillstack/db migrate status --schema rnd
APP_PASSWORD=... BACKUP_PASSWORD=... pnpm --filter @skillstack/db migrate set-passwords --schema rnd
```

`DATABASE_URL` is the admin connection (from a secret). Passwords must be at least 24 characters. Missing `--schema` or `DATABASE_URL` exits with code 2. The connection string and passwords are never printed.

## Running the tests locally

```bash
packages/db/scripts/test-postgres.sh start        # throwaway cluster on port 55432 (needs PG 16 binaries)
export TEST_DATABASE_URL=postgres://migrator@127.0.0.1:55432/skillstack_test
export TEST_SUPERUSER_URL=postgres://postgres@127.0.0.1:55432/skillstack_test   # same as: scripts/test-postgres.sh env
pnpm --filter @skillstack/db test
packages/db/scripts/test-postgres.sh stop         # stops the cluster and deletes its directory
```

Without `TEST_DATABASE_URL` the database tests are skipped with a warning; when `CI` is set they fail instead. The tests use a non-superuser admin (`migrator`) and a stub `auth.uid()` that exists only in `test/setup.sql`.

## Needs check (not provable with the local tests)

- Whether Supabase's default admin role (`postgres`) can do what `migrator` does here: CREATE ROLE, `GRANT owner_<s> TO current_user`, `ALTER ROLE ... NOBYPASSRLS`, `CREATE SCHEMA ... AUTHORIZATION owner_<s>`, `ALTER DEFAULT PRIVILEGES FOR ROLE owner_<s>`.
- That Supabase's role has the BYPASSRLS attribute (needed on PG16 to run `ALTER ROLE ... NOBYPASSRLS`). Finding from the tests: a non-superuser cannot run `NOSUPERUSER` or `NOREPLICATION` in `ALTER ROLE` (permission denied), so bootstrap omits them and fails the run if either attribute is present.
- Supabase's Postgres major version (tests use 16; the SQL avoids PG16-only syntax, but PG15 was not run).
- That Supabase's real `auth.uid()` reads `request.jwt.claims` the way the test stub does, and that `auth` is usable by `app_<s>_user` (the stub grants USAGE/EXECUTE to PUBLIC; the real grants are unverified).
- Whether Supabase has extra default privileges for new objects in other schemas, or grants on the `public` schema, that give `app_<s>` more than intended.
- The pooler: transaction mode keeps no session state, so `SET LOCAL ROLE` must be inside each request transaction; custom role names may need the `role.project-ref` form (ADR 003).
- Password authentication for the new login roles from the backend hosts (connection string flavour and IPv6/pooler question: see `docs/setup/database.md`).
