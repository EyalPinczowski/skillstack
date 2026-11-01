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

Optional fourth secret, only for the `promote-admin` action: `ADMIN_EMAIL` (see "Becoming the first admin" below).

Generate the passwords with a password manager. Never paste them into issues, chat or files.

## 3. Run order

Run the **DB migrate** workflow (Actions tab, "Run workflow") for `rnd` first:

1. `schema: rnd`, `action: migrate`, `dry_run: true`: lists what would run.
2. `schema: rnd`, `action: migrate`, `dry_run: false`: applies it.
3. `schema: rnd`, `action: set-passwords`: sets the two passwords from the secrets.

Then check the output, and repeat the same three steps with `schema: prod` (approve the run as reviewer). Later releases: `migrate` on `rnd`, try it, then `migrate` on `prod`. The backends then connect as `app_rnd` / `app_prod` with the passwords above.

### Becoming the first admin

Add the environment secret `ADMIN_EMAIL` (your address) to the `rnd` Environment, then run the workflow with `schema: rnd`, `action: promote-admin`. The address is a secret and not an input so it never shows on the public run page, and the output says `(email hidden)`. If the account does not exist yet, the first run only adds the email to the allowlist; after your first sign-in, run it again to set the admin role. Repeat for `prod` later with the secret in the `prod` Environment. Details: `docs/setup/api-auth.md`.

## Troubleshooting connection errors

The runner gives up connecting after 15 seconds and prints the underlying error codes (never the connection string or password).

- **`ENETUNREACH`, `ETIMEDOUT`, or a `timeout expired` message:** the runner could not reach the host. The direct Supabase host (`db.<ref>.supabase.co`) is IPv6-only and GitHub-hosted runners are likely IPv4-only (needs check). Use the **Session pooler** connection string instead: host `*.pooler.supabase.com`, user `postgres.<ref>`, port `5432`. Copy it from the project's connection settings in the Supabase dashboard (exact menu wording needs check).
- **`ECONNREFUSED` or `ENOTFOUND`:** wrong host or port in `DATABASE_URL`, or the project is paused (needs check).
- **`28P01` (password authentication failed):** wrong password or user. On the pooler the user is `postgres.<ref>`, not plain `postgres`.
- **Special characters in the password:** characters such as `@`, `:`, `/`, `?`, `#` or `%` must be percent-encoded inside the URL (for example `@` becomes `%40`), or the URL is parsed wrongly and authentication fails. Resetting the database password to one without special characters avoids this.

## Needs check (Supabase)

- Which connection string flavour works from GitHub-hosted runners: direct connections may be IPv6-only, so the pooler (session mode, for DDL) may be required. Not verified.
- Whether the project's default admin role may create roles, `GRANT` them to itself, set `NOBYPASSRLS`, and create a schema owned by another role. The tests use a stand-in role; see `packages/db/README.md`.
- The Postgres version of the project (tests run on 16).
- Whether login role names need the `role.project-ref` form on the pooler.
