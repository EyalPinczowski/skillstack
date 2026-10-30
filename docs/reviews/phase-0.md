# Phase 0 review gate

Review of `rnd` at `318b13f` (Phase 0, environments) against `docs/SPEC.md` (sections 5, 6, 9 "Environments" and 11 "Phase 0") and the rules in `CLAUDE.md`. Reviewed on 2026-10-30 on branch `feature/infra-phase-0-review`.

## Summary

The Phase 0 code is in good shape. The database wall between `prod` and `rnd`, the migration runner, the API hardening (CORS, rate limit, `TRUST_PROXY`, error shape) and the workflows hold up, and the tests mostly test real behaviour. Every check passes, including the database tests against real PostgreSQL 16 and the backup and restore round trip.

The review found **one high-severity bug, now fixed**: the backup role could not read sequences. The first table with an identity or serial column would have made every backup fail. It also fixed two smaller bugs (duplicate migration numbers, unknown time zones) and four documentation errors.

What is still open is mostly setup only the owner can do (rulesets, Environments, Supabase, Render, Vercel, the private backup repo, the restore drill). There is also one **v0.1 blocker to check first**: whether the backend's per-environment role can call Supabase's `auth.uid()`. And there is a hardening point: the `rnd` GitHub Environment holds the project admin connection string, so it needs a deployment-branch rule.

Phase 0 is **not complete yet** in the spec's sense: branch protection, both deployments, the real schemas and roles, the R&D calendar and the daily backup action exist only as code and guides until the owner sets them up (checklist at the end).

## What was checked

| Area                                         | Files                                                                    | How                                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Secrets                                      | whole repo, `.gitignore`, `.gitleaksignore`, `.env.example` files        | pattern scan of tracked files (keys, tokens, JWTs, Postgres URLs with passwords, age secret keys); personal details scan                                             |
| Database roles, RLS convention, wall         | `packages/db/sql/bootstrap.sql`, `migrations/`, `src/`, `test/`          | read; ran all 51 db tests against a throwaway PG 16 cluster (`scripts/test-postgres.sh`); `pg_dump` as `backup_rnd` against a table with an identity column         |
| Migration runner                             | `packages/db/src/migrate.ts`, `cli.ts`, `passwords.ts`, `render.ts`      | read for schema validation, ledger checks, locking, transactions, secret redaction                                                                                   |
| Backup and restore                           | `packages/db/scripts/*.sh`, `docs/setup/backup.md`                       | read; ran `scripts/test-backup.sh` (passes)                                                                                                                            |
| API                                          | `apps/api/src/**`, tests                                                 | CORS, rate limit and health exemption, `TRUST_PROXY` hop logic, headers, error shape, request id, idempotency key, config validation, logging redaction              |
| Web                                          | `apps/web/src/**`, `vercel.json`, manifest                               | env parsing, R&D badge, API status states, headers, design rules (no gradients, no nested cards, no decorative emoji)                                                 |
| Shared engine                                | `packages/shared/src/**`                                                 | read engine, capacity, CV tasks, dates, zone, schemas, `.ics`/HTML/CSV exports; probed DST gaps and overlaps in `Asia/Jerusalem`, `America/New_York`, `Australia/Lord_Howe`, `America/Santiago` |
| Workflows                                    | `.github/workflows/*.yml`, `dependabot.yml`                              | permissions, `${{ }}` in `run:` (none), input handling, Environments, action pinning, schedules, cost                                                                 |
| Deploy config                                | `render.yaml`, `vercel.json`                                             | plan, branches, env var names, headers                                                                                                                                |
| Docs                                         | `README.md`, `CONTRIBUTING.md`, `docs/setup/*`, ADRs, `docs/legal/privacy-policy.md` | compared with the code and the spec                                                                                                                       |
| Catalog                                      | `data/catalog/catalog.json`, `README.md`                                 | counted verification flags against the README's claims; drift check passes                                                                                            |
| Cost ($0)                                    | workflows, Render, Vercel, Supabase guides                               | free-tier usage of each scheduled job and service                                                                                                                      |

Commands run (all pass): `pnpm install --frozen-lockfile && pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`, then `CI=1 pnpm --filter @skillstack/db test` against the throwaway cluster (51 tests, none skipped), and `packages/db/scripts/test-backup.sh`.

I did not re-check any external free-tier facts on the providers' sites in this review. Facts the guides mark as verified on 2026-10-30 are listed as stated there.

## Findings

Severity: **High** = breaks a Phase 0 promise (backups, isolation) or will break the next phase; **Medium** = a real risk or a misleading doc; **Low** = an edge case or hardening.

| #   | Severity | Area           | Finding                                                                                                                                                                                                                                                                                                       | Status                          | Evidence                                                                                          |
| --- | -------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | High     | db / backup    | `backup_<schema>` had no SELECT on sequences, so `pg_dump` fails with "permission denied for sequence" as soon as a table has an identity or serial column. Confirmed by running `pg_dump` as `backup_rnd`.                                                                                               | Fixed                           | `packages/db/sql/bootstrap.sql:80-82`                                                             |
| 2   | High     | db / RLS       | RLS policies will call `auth.uid()` as `app_<schema>_user`. On Supabase that role probably has no USAGE on schema `auth` or EXECUTE on `auth.uid()`. The test stub grants both to PUBLIC, so the tests cannot catch it. Every v0.1 user table depends on this. The README already lists it as needs check. | Open (v0.1 blocker, needs check) | `packages/db/test/setup.sql:27-28`, `packages/db/README.md` "Needs check"                         |
| 3   | Medium   | infra / CI     | The `rnd` GitHub Environment holds `DATABASE_URL`, the **project admin** connection, which can read and change `prod`. With no deployment-branch rule, any workflow on any branch that names `environment: rnd` gets it without review. That opens a CI-level hole in the `rnd`/`prod` wall.                 | Open (owner setting)            | `.github/workflows/db-migrate.yml:36,50`, `docs/setup/database.md:7-19`                        |
| 4   | Medium   | db             | Two migration files with the same number (two branches both picking `0002`): the ledger is keyed by version, so the second file was either treated as applied and silently skipped, or reported as "changed after it was applied".                                                                           | Fixed                           | `packages/db/src/migrate.ts:49-61`                                                                |
| 5   | Medium   | infra / CI     | Actions are pinned to moving major tags (`@v4`, `@v2`), not commit SHAs. This includes third-party actions (`pnpm/action-setup`, `gitleaks/gitleaks-action`) in jobs that receive the admin `DATABASE_URL`.                                                                                                | Open                            | `.github/workflows/db-migrate.yml:38-39`, `ci.yml:21,123`                                         |
| 6   | Medium   | web / api      | Every environment setting falls back to Operational: `APP_ENV` and `VITE_APP_ENV` default to `operational`, and `VITE_API_URL` defaults to `http://localhost:3000`. A Vercel preview without its variables shows no R&D badge (spec 9: "badge visible in R&D"). A production build without `VITE_API_URL` quietly calls localhost instead of failing loudly. | Open                            | `apps/api/src/config.ts:19`, `apps/web/src/env.ts:12-17`                                          |
| 7   | Medium   | docs / cost    | `supabase.md` said the health check touches the database, which keeps the free project from pausing. It doesn't, and nothing queries the database in Phase 0.                                                                                                                                                 | Fixed (doc)                     | `docs/setup/supabase.md:17`, `apps/api/src/modules/health/routes.ts`                              |
| 8   | Medium   | infra / backup | The daily backup action (a Phase 0 deliverable) is not in this repo. It is a template for the private repo, and the restore drill has not been run. This is by design (artifacts of a public repo are public), but until the owner sets it up there are no backups.                                          | Open (owner)                    | `docs/setup/backup.md:41-100`                                                                     |
| 9   | Medium   | test quality   | `scripts/test-backup.sh` (the only test of `backup.sh` and `restore.sh`) does not run in CI, so the backup path can break without a red build. It passes locally.                                                                                                                                           | Open                            | `.github/workflows/ci.yml:62-104`                                                                 |
| 10  | Low      | shared         | `timezone` accepted any string. A typo passed validation and crashed later in `Intl` during export.                                                                                                                                                                                                         | Fixed                           | `packages/shared/src/schemas.ts:106`, `zone.ts:4-11`                                              |
| 11  | Low      | shared / dates | Local times that don't exist (DST gap) resolve inconsistently. `Asia/Jerusalem` 2026-03-27 02:30 becomes 03:30 local, later, so a 02:30–03:00 block exports with DTEND before DTSTART. `America/New_York` 2026-03-08 02:30 becomes 01:30 EST, earlier. A study window rarely crosses 02:00.               | Open                            | `packages/shared/src/zone.ts:48-54`                                                               |
| 12  | Low      | shared / sec   | `z.url()` accepts any scheme (`javascript:`, `http:`) for task and lesson links. Once these are rendered as links, that becomes an XSS path. Spec 5 allows only `https` for the quick-add fetch.                                                                                                             | Open                            | `packages/shared/src/schemas.ts:24,39`                                                            |
| 13  | Low      | security       | No Content-Security-Policy on the web app or the API. API headers are `nosniff` and `no-referrer` only. Documented as a follow-up.                                                                                                                                                                          | Open                            | `apps/api/src/plugins/security-headers.ts:7-12`, `vercel.json:8-19`                               |
| 14  | Low      | db / secrets   | `set-passwords` runs `ALTER ROLE ... PASSWORD` through `EXECUTE`. If that statement fails, the server log's CONTEXT line can contain the formatted statement, password included. Client output is redacted.                                                                                                 | Open                            | `packages/db/src/passwords.ts:40-43`                                                              |
| 15  | Low      | db / backup    | `restore.sh` guards against a live target only by comparing the URL string with `BACKUP_DATABASE_URL`. The "create schema fails if it exists" check is the stronger guard.                                                                                                                                   | Open                            | `packages/db/scripts/restore.sh:69`                                                               |
| 16  | Low      | docs           | `CONTRIBUTING.md` said to add the `web` and `api` checks "when those jobs exist". They exist, and so does `db`.                                                                                                                                                                                              | Fixed (doc)                     | `CONTRIBUTING.md:30,53`                                                                           |
| 17  | Low      | docs / cost    | `deployments.md` said "about 64 runs per study day" for the wake-up job. The cron starts 80 runs a day, about 2,400 billed minutes a month: free for this public repo, but over the private-repo allowance (needs check).                                                                                     | Fixed (doc)                     | `docs/setup/deployments.md:29`, `.github/workflows/wakeup.yml:10`                                 |
| 18  | Low      | docs           | README status said "Phase 0 is next", and the layout was missing `packages/db`.                                                                                                                                                                                                                              | Fixed (doc)                     | `README.md:7,52-55`                                                                               |
| 19  | Low      | docs           | ADR 009 still says Vercel's and Render's limits are "needs check", while `deployments.md` lists them as verified on 2026-10-30. ADR 003 says the number of free Supabase projects is "needs check"; `supabase.md` verifies two.                                                                             | Open                            | `docs/decisions/009-hosting-on-free-tiers.md:6`, `docs/decisions/003-one-supabase-project-two-schemas.md:6` |
| 20  | Low      | infra          | Scheduled workflows (wake-up, weekly CodeQL) run only from the default branch `main`. Until the first release, nothing pings the API.                                                                                                                                                                       | Open (owner, release)           | `.github/workflows/wakeup.yml:8-11`                                                              |
| 21  | Low      | web / infra    | Vercel gives every PR a preview with `VITE_APP_ENV=rnd`, but only the stable R&D origin is in the R&D API's `CORS_ORIGINS`, so per-PR previews show "Can't reach the server".                                                                                                                              | Open                            | `docs/setup/deployments.md:38-48`, `apps/api/src/app.ts:56-63`                                    |
| 22  | Low      | test quality   | `packages/shared/src/index.test.ts` only checks two string constants. CI's `web` and `api` jobs don't run lint (only the `shared` and `db` jobs run the root lint), so lint depends on `shared` being a required check.                                                                                   | Open                            | `packages/shared/src/index.test.ts`, `.github/workflows/ci.yml:32-60`                             |

Checked and fine:

- No secrets or personal contact details in tracked files.
- No `${{ }}` inside any `run:` script. `db-migrate.yml` passes its inputs through `env` and quotes them.
- Workflow permissions are `contents: read`.
- The DB roles have no BYPASSRLS and no cross-environment memberships or PUBLIC grants.
- The schema argument is validated before any connection.
- Concurrent migrations are serialized by an advisory lock.
- CORS uses an exact-match allow list.
- The rate limit runs before every hook, with the health route exempt.
- `TRUST_PROXY` is capped, and `0` ignores `X-Forwarded-For`.
- 5xx responses never leak details.
- The CSV export escapes formulas.
- The HTML export escapes text.
- `.ics` lines are folded on UTF-8 boundaries.
- The web app follows the design rules.

## Fixes made

| Commit                                                                                    | What                                                                                                                                                                                       | Test that fails without it                                                                                                                                                      |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fix(db): let backup role read sequences and reject duplicate migration versions`         | `bootstrap.sql`: `alter default privileges ... grant select on sequences to {{backup}}`. `migrate.ts`: duplicate version numbers are refused before connecting.                          | `packages/db/test/migrate.test.ts`: "lets the backup role read sequences of later tables" (got `backup: false`); "refuses two files with the same version number" (got the connection error). Both were run red before the fix and green after; `pg_dump` as `backup_rnd` also went from exit 1 to exit 0. |
| `fix(shared): reject unknown time zones in the week pattern`                              | `isTimeZone()` in `zone.ts`; `WeekPatternSchema.timezone` refines with it.                                                                                                                  | `packages/shared/src/schemas.test.ts`: "rejects a time zone the platform does not know" (red before, green after).                                                              |
| `docs: correct Phase 0 setup facts and required checks`                                   | Findings 7, 16, 17, 18.                                                                                                                                                                     | Docs only.                                                                                                                                                                      |

The bootstrap runs on every `migrate`, so an environment that was already created picks up the new default privilege on its next `migrate` run. No sequences exist yet, so there is nothing to grant on existing objects.

## Spec / data disagreements (not guessed; owner to decide)

1. **R&D calendar in Phase 0.** Section 11 lists "the R&D calendar" in Phase 0, but Google Calendar is v0.6 (and needs the OAuth setup from ADR 006). Nothing in the repo creates or configures it. Move it to v0.6, or create the empty "Skillstack (R&D)" calendar by hand now?
2. **Where the backup action lives.** Section 5 asks for a scheduled GitHub Action with a private artifact. The implementation puts it in a separate private repo (`docs/setup/backup.md`), because artifacts of this public repo would be downloadable by anyone. This is consistent with the spec's intent, but it is a different location from what section 11 implies ("the daily backup action").
3. **Restore target.** Section 9 says "the restore script recreates the data on `rnd`", and section 5 says "tested once on `rnd`". `restore.sh` refuses to restore into an existing schema and is documented for a scratch database only. Which one is intended?
4. **Phase order.** Section 11 says "Nothing else starts before this works", but `packages/shared` already has the scheduling engine and the `.ics`/HTML/CSV exports (v0.1 work, merged in #6). This isn't wrong in itself, but it is ahead of the phase gate.
5. **Branch areas.** Section 6 names the areas `api`, `web`, `shared`. `CLAUDE.md` adds `infra` and `catalog`, and `CONTRIBUTING.md` adds `demo` as well.
6. **Role model.** Section 6 describes two roles (`app_prod`, `app_rnd`). The code has four per environment (`owner_`, `app_`, `app_<s>_user`, `backup_`). This is explained in ADR 003 and the db README, and is stricter than the spec, but the spec text is out of date.
7. **CI per part.** Section 6 asks for lint, type-check and tests "separately for `web`, `api` and `shared`". Lint runs once for the whole repo in the `shared` and `db` jobs (finding 22).
8. **Sample plan.** Section 7 says the repo ships `data/sample-plans/demo-plan.json`. It doesn't exist yet. It is needed in v0.1, not Phase 0.
9. **What "verified" means in the catalog.** `CLAUDE.md` says to check official docs. `catalog.json` defines `url_verified`/`price_verified = true` as "confirmed from a source found during research", and the main sources listed in `data/catalog/README.md` are mostly third-party articles (KDnuggets, dev.to, open-exam-prep, Analytics Vidhya), not the providers' own pages. 62 of the 95 courses and exams have `url_verified: true`, and the counts match the README. Should `true` from a third-party source count as verified in the app?

## Unverified items (needs check)

Collected from the code and the guides. None were verified in this review.

- **Supabase:**
  - whether the default `postgres` role can create the roles and memberships and run `ALTER ROLE ... NOBYPASSRLS` the way `migrator` does in the tests;
  - the server's Postgres major version (tests use 16);
  - USAGE and EXECUTE on `auth` and `auth.uid()` for `app_<s>_user` (finding 2);
  - that the real `auth.uid()` reads `request.jwt.claims` like the stub;
  - extra default privileges or `public` grants;
  - the `role.project-ref` user form on the pooler for custom roles;
  - IPv6 from GitHub runners and Render;
  - whether creating the free project asks for a card;
  - whether a read-only query counts as activity against pausing;
  - the before-user-created hook, the built-in SMTP limits and Turnstile coverage (for v0.1 sign-in).
- **Render:**
  - the `TRUST_PROXY` hop count and the `X-Forwarded-For` format;
  - whether `NODE_VERSION` and `corepack` pick Node 22 and pnpm 10;
  - build-minute and bandwidth amounts;
  - whether `PORT` is injected;
  - whether a blank `RATE_LIMIT_PER_MINUTE` is allowed;
  - no card at sign-up.
- **Vercel:**
  - no card at Hobby sign-up;
  - a stable alias for the `rnd` preview;
  - whether the beta counts as non-commercial use.
- **GitHub:**
  - private-repo Actions minutes (2,000 a month assumed in finding 17) and artifact storage for 30 daily dumps;
  - the 60-day inactivity rule for scheduled workflows;
  - whether `gitleaks-action@v2` needs a licence (it needs one for organisation accounts; this repo is a personal account);
  - the SHAs to pin the actions to.
- **Backups:**
  - `pg_dump` version compared with the server's;
  - `age` and the right `postgresql-client` on `ubuntu-latest`;
  - session pooler versus direct connection for `pg_dump`.
- **Study hours** for the wake-up job: 07:00–22:00 `Asia/Jerusalem` is a placeholder; the spec does not define them.
- **Provider facts listed as verified on 2026-10-30** in `docs/setup/deployments.md` and `docs/setup/supabase.md` (Render's 750 h and 15-minute sleep, Vercel Hobby limits, Supabase's two projects, 500 MB and 50,000 MAU, the 2 emails an hour) were taken from the guides and not re-checked here.

## Suggested improvements for v0.1

1. Resolve finding 2 first. Either verify the Supabase grants and add them to the bootstrap, or define `{{schema}}.current_user_id()` (reading `request.jwt.claims`) and use it in policies. In both cases, remove the PUBLIC grants from `test/setup.sql` so the tests prove the real grant.
2. Make the health check read `environment_info` as `app_<s>_user` (this proves the role, the schema and RLS on every ping, and keeps Supabase from pausing). Have the web app warn when the API's environment differs from `VITE_APP_ENV`.
3. Fail production builds and production API starts without explicit `VITE_APP_ENV`, `VITE_API_URL` and `APP_ENV` (finding 6).
4. Run `scripts/test-backup.sh` in the `db` CI job, and include a table with an identity column in it (finding 9).
5. Pin all actions to full commit SHAs (Dependabot's `github-actions` updates keep them current), and set `persist-credentials: false` on checkouts that don't push (finding 5).
6. Restrict task and lesson URLs to `https` in the shared schema (finding 12). Add a CSP to `vercel.json` and to the API outside Swagger UI (finding 13).
7. Make DST-gap handling consistent: move forward, like Temporal's `compatible` (finding 11). Add a gap test.
8. A test that every migration file switches to `{{owner}}` before it creates anything, alongside `findConventionViolations`.
9. Back the idempotency store with a table keyed by `(user_id, key)` before the first write endpoint (the TODO in `apps/api/src/plugins/idempotency.ts`).
10. Bring ADRs 003 and 009 in line with the verified guides (finding 19), and update spec section 6 for the four-role model, once the owner agrees.

## What the owner must do before release

**GitHub repository**

- [ ] Ruleset `rnd` (branch `rnd`):
  - [ ] block deletions and force pushes;
  - [ ] require a PR with 0 approvals, squash merge only, conversation resolution;
  - [ ] required checks `shared`, **`web`**, **`api`**, **`db`**, `catalog-drift`, `gitleaks`, `analyze (javascript-typescript)`, `analyze (python)`;
  - [ ] no bypass actors.

  A check only appears in the picker after it has run once.
- [ ] Ruleset `main` (branch `main`):
  - [ ] the same checks, plus "require branch up to date";
  - [ ] merge commit only;
  - [ ] no bypass actors.
- [ ] Ruleset `release tags` (`v*`): only admins may create, update or delete them.
- [ ] Settings:
  - [ ] secret scanning with push protection;
  - [ ] Dependabot alerts;
  - [ ] private vulnerability reporting;
  - [ ] automatically delete head branches;
  - [ ] rebase merging off;
  - [ ] default workflow permissions "Read repository contents".
- [ ] Repository variable `API_HEALTH_URL` = `https://<skillstack-api>.onrender.com/api/v1/health`.

**GitHub Environments**

- [ ] Environment `rnd`:
  - [ ] secrets `DATABASE_URL` (admin, session pooler), `APP_PASSWORD`, `BACKUP_PASSWORD` (24+ characters, from a password manager);
  - [ ] **deployment branches: selected, `rnd` only** (finding 3).
- [ ] Environment `prod`:
  - [ ] the same three secrets, with **different passwords**;
  - [ ] **required reviewers: you**;
  - [ ] **deployment branches: `main` only**.
- [ ] Consider required reviewers on `rnd` too, since its `DATABASE_URL` is the project admin.

**Supabase**

- [ ] Create the Free project. Stop if a card is requested.
- [ ] Store the database password in your password manager.
- [ ] Do **not** expose `prod` or `rnd` in the API settings.
- [ ] Copy the session-pooler connection strings into the Environments only.
- [ ] Run **DB migrate** in this order:
  1. `rnd` dry run
  2. `rnd` migrate
  3. `rnd` set-passwords
  4. the same three for `prod` (approve as reviewer)

  The first `rnd` run is the real test of the admin-role question. Run these after this review is merged, so the backup sequence fix is in the bootstrap.
- [ ] Check `select version();` and the `auth.uid()` grants for `app_rnd_user` (finding 2).

**Render**

- [ ] New Blueprint from `render.yaml`. Stop if a card is requested.
- [ ] Two Free services: `skillstack-api` on `main` and `skillstack-api-rnd` on `rnd`.
- [ ] Set `CORS_ORIGINS` to the exact Vercel origin(s).
- [ ] Set `TRUST_PROXY=0`.
- [ ] Confirm Node 22 and pnpm 10 in the first build log.
- [ ] Let the R&D service sleep (750-hour budget).

**Vercel**

- [ ] Hobby on your personal account. Stop if a card is requested.
- [ ] Import the repo with root `/`.
- [ ] Production branch `main`.
- [ ] Set **both** `VITE_APP_ENV` (`operational` for Production, `rnd` for Preview) and `VITE_API_URL` explicitly, because the defaults are `operational` and localhost (finding 6).
- [ ] Check the spec 9 test: the R&D badge shows on the `rnd` preview and not on production.

**Private repo and backups**

- [ ] Create a private repo (e.g. `skillstack-private`). It is also where your real plan and the original spec live.
- [ ] Generate the age key on your computer (`age-keygen`).
- [ ] Keep the private key **offline**, in your password manager plus a second independent copy. Never put it in GitHub.
- [ ] Add the secrets `AGE_RECIPIENT` (the public key) and `BACKUP_DATABASE_URL` (the `backup_prod` login).
- [ ] Add `backup.yml` from `docs/setup/backup.md`, with `PUBLIC_REF` pinned to the merge commit that contains this review's sequence fix.
- [ ] Do the restore drill on `rnd` into a scratch database (checklist in `docs/setup/backup.md`) and write down the result.

**Decisions and release**

- [ ] Answer the spec/data questions above (R&D calendar timing, restore target, catalog "verified" meaning).
- [ ] Look at the R&D environment, approve, and open the first release PR `rnd` → `main`. Scheduled workflows (wake-up, CodeQL) only start running once they are on `main`.
