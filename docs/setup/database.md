# Database setup (owner guide)

What you do once the Supabase project exists. A separate guide will cover creating the project itself.

The migration runner lives in `packages/db` and runs only through the manual GitHub workflow **DB migrate**. No database credentials are stored in the repo.

## 1. GitHub Environments

In the repository settings, create two Environments named exactly `rnd` and `prod`. On `prod`, enable **Required reviewers** so every production run needs your approval.

## 2. Secrets (per Environment)

Add these three secrets to **each** Environment, with different values for `rnd` and `prod` where they differ:

| Secret            | Value                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------- |
| `DATABASE_URL`    | Admin connection string of the database (see "needs check" below for which flavour).   |
| `APP_PASSWORD`    | A new random password, at least 24 characters, for the backend login `app_<schema>`.   |
| `BACKUP_PASSWORD` | A new random password, at least 24 characters, for the backup login `backup_<schema>`. |

Generate the passwords with a password manager. Never paste them into issues, chat or files.

## 3. Run order

Run the **DB migrate** workflow (Actions tab, "Run workflow") for `rnd` first:

1. `schema: rnd`, `action: migrate`, `dry_run: true`: lists what would run.
2. `schema: rnd`, `action: migrate`, `dry_run: false`: applies it.
3. `schema: rnd`, `action: set-passwords`: sets the two passwords from the secrets.

Then check the output, and repeat the same three steps with `schema: prod` (approve the run as reviewer). Later releases: `migrate` on `rnd`, try it, then `migrate` on `prod`. The backends then connect as `app_rnd` / `app_prod` with the passwords above.

## Needs check (Supabase)

- Which connection string flavour works from GitHub-hosted runners: direct connections may be IPv6-only, so the pooler (session mode, for DDL) may be required. Not verified.
- Whether the project's default admin role may create roles, `GRANT` them to itself, set `NOBYPASSRLS`, and create a schema owned by another role. The tests use a stand-in role; see `packages/db/README.md`.
- The Postgres version of the project (tests run on 16).
- Whether login role names need the `role.project-ref` form on the pooler.
