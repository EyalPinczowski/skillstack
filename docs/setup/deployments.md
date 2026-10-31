# Deployments: Vercel and Render

> **Card requirement.** No official page I checked says a payment method is required to create a Render Free web service or to use the Vercel Hobby plan (Render's free-instance page says a payment method is "not needed to create a Free instance"). Vercel's Hobby pages do not state sign-up requirements either way, so "no card at Vercel sign-up" is **needs check**. If either sign-up screen asks for a card, stop and ask (project rule: $0, no card).

Facts below were read from the official docs on 2026-10-30. Anything not stated there is marked **needs check**. Limits change, so re-check before relying on them.

## Verified free-plan facts

| Topic                       | Fact                                                                                                                                                                                                                                         | Source                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Render: sleep               | Free web service spins down after 15 minutes with no inbound traffic; spin-up takes "about one minute".                                                                                                                                     | https://render.com/docs/free                                                   |
| Render: hours               | 750 free instance hours per workspace per calendar month, no rollover. When used up, all Free web services are suspended until next month. (One service awake 24/7 is about 720-744 h, so two always-on services do not fit; R&D must sleep.) | https://render.com/docs/free                                                   |
| Render: payment             | Payment method not needed to create a Free instance. Without one, exceeding bandwidth suspends all Free services for the month and exceeding build minutes disables new builds.                                                              | https://render.com/docs/free                                                   |
| Render: other               | Single instance, no persistent disk (filesystem is lost on redeploy/restart/spin-down), may be restarted at any time, outbound SMTP ports 25/465/587 blocked.                                                                                 | https://render.com/docs/free                                                   |
| Render: Blueprint           | `plan: free`, `healthCheckPath`, `branch`, `autoDeployTrigger`, and `envVars` with `sync: false` (prompts for the value only on initial Blueprint creation; add later secrets manually).                                                     | https://render.com/docs/blueprint-spec                                         |
| Vercel Hobby: use           | Free; "restricted to non-commercial personal use only". Commercial means any deployment used for financial gain of anyone involved in producing it (payment, ads, paid work to build/host, affiliate sites). Donations are not commercial. | https://vercel.com/docs/plans/hobby, https://vercel.com/docs/limits/fair-use-guidelines |
| Vercel Hobby: limits        | Build time 45 min per deployment; 1 concurrent build; 100 deployments per day; 1,000,000 CDN requests, 100 GB Fast Data Transfer per month. Past a limit you may wait 30 days for that feature.                                              | https://vercel.com/docs/limits, https://vercel.com/docs/plans/hobby            |
| Vercel Hobby: Git           | A Hobby team cannot connect to repositories owned by a Git organization; the GitHub repo must belong to a personal account.                                                                                                                  | https://vercel.com/docs/limits                                                 |
| GitHub Actions: schedule    | Cron runs in UTC, shortest interval 5 minutes, may be delayed under load, runs only on the default branch, and is disabled after 60 days without repository activity in public repos.                                                        | https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows |

## Needs check

- Whether Vercel sign-up asks for a card (not stated in the Hobby or limits pages).
- Render's monthly build-pipeline minutes and bandwidth amounts (the Free page says they exist but gives no numbers; see the Billing page in your workspace).
- Whether Render honours the `NODE_VERSION` env var and `.nvmrc`; `render.yaml` sets `NODE_VERSION=22`. Confirm in the first build log that Node 22 is used.
- Whether `corepack enable` selects pnpm 10 from `packageManager` on Render. Confirm in the first build log.
- The `TRUST_PROXY` hop count on Render (see `.env.example`). Keep `0` until verified.
- Whether the Skillstack beta counts as "non-commercial personal use" for Vercel Hobby (no ads, no payments, invite-only: it appears to fit, but Vercel decides; contact Vercel support if unsure).
- GitHub Actions minutes for the wake-up workflow if the repo is private: the cron `*/14 5-18 * * *` starts 70 runs a day (5 an hour for 14 UTC hours), including the runs the local-time guard skips, and each run is billed per started minute, so about 2,100 minutes a month. That is more than the included minutes of GitHub Free for private repos (2,000 a month, needs check). Keep this repo public, or narrow the cron, before relying on it. Public repos: check GitHub's current billing page.
- Study hours: the spec does not define them. `wakeup.yml` uses 08:00-20:00 Asia/Jerusalem, chosen by the owner.

## 1. Frontend on Vercel Hobby

1. Sign in at vercel.com with GitHub. Use a personal account (Hobby), not an organization. Stop if a card is requested.
2. Add New > Project > import the Skillstack repository.
3. Leave the root directory as the repository root. `vercel.json` already sets the install command, build command (`pnpm --filter @skillstack/web build`), output directory (`apps/web/dist`), the SPA rewrite and security headers.
4. Set environment variables (Settings > Environment Variables), names only here:
   - `VITE_APP_ENV`: `operational` for Production, `rnd` for Preview. A separate demo project uses `demo`.
   - `VITE_API_URL`: the Render API base URL without trailing slash (Production: `skillstack-api`; Preview: `skillstack-api-rnd`).
   - `VITE_SUPABASE_URL`: the Supabase project URL, `https://<project-ref>.supabase.co`. One project serves both environments (ADR 003), so Production and Preview use the same value.
   - `VITE_SUPABASE_ANON_KEY`: the project's anon / publishable key (Supabase dashboard, Project Settings, API; exact menu name needs check). It is public by design because it ships in the browser bundle, but it still goes only into the Vercel settings and your own untracked `.env.local`, never into the repository. Vercel exposes only variables that start with `VITE_` to the build; tick Production and Preview (needs check: the exact checkboxes).
   - **Content-Security-Policy.** The web build writes a CSP `<meta>` tag into `index.html` (`apps/web/src/build/csp.ts`). Its `connect-src` is `'self'` plus the origins of `VITE_API_URL` and `VITE_SUPABASE_URL`, read at build time, so there is nothing else to configure: set both variables for each Vercel environment and rebuild when one changes. Everything else is `'self'` (no inline script or style). A browser ignores `frame-ancestors` in a meta tag, so `vercel.json` sends `Content-Security-Policy: frame-ancestors 'none'` as a header (the two policies add up). If a deployment cannot reach the API or Supabase and the browser console names `connect-src`, the variable was wrong or missing at build time. The policy is applied by `vite build` only, not by `vite dev`.
   - The build fails to start in the browser with a readable message ("Skillstack could not start") if either Supabase variable is missing or the URL is not http(s).
5. Production Branch is `main`. Deployments from the `rnd` branch are Preview deployments; assign them a stable alias if possible (needs check which stable preview URL Hobby offers for a branch).
6. Deploy. Copy the resulting `*.vercel.app` URLs for the next section.

## 2. API on Render Free

1. Sign in at render.com with GitHub. Stop if a card is requested.
2. New > Blueprint > pick the repository. Render reads `render.yaml` and proposes two Free web services: `skillstack-api` (branch `main`) and `skillstack-api-rnd` (branch `rnd`). If the Blueprint wizard insists on a branch, use `main` and create the second service from the dashboard on branch `rnd`.
3. Enter values when prompted (Blueprint creation is the only time `sync: false` values are asked):
   - `CORS_ORIGINS`: exact Vercel origin(s), comma separated, no wildcard. Production service gets the production Vercel URL; R&D service gets the preview URL.
   - `RATE_LIMIT_PER_MINUTE`: e.g. leave at the API default if blank is allowed (needs check) or set a number.
   - `TRUST_PROXY`: `0` until the hop count is verified.
4. Wait for the first deploy. Render's health check is `GET /api/v1/health`. It answers 200 as long as the process runs, with a `database` field of `ok`, `unavailable` or `not_configured`, so a database blip (or a paused Supabase project) does not make Render mark the service unhealthy and restart it. `GET /api/v1/health/ready` answers 503 when the database is not usable; use it for your own monitoring, not as Render's health check path. Both are open (no sign-in); only `/health` is exempt from the rate limit, and the database check is cached for 5 seconds.
5. Suspend or let `skillstack-api-rnd` sleep; only the production service should be kept awake (see the 750-hour budget above).
6. Database and auth variables (Supabase) are added when the API starts using them; follow `docs/setup/supabase.md`. Never commit values.

## 3. Keep-warm GitHub Action

`.github/workflows/wakeup.yml` pings the production API during study hours. The ping reaches the database too (the health route runs a `select 1`), so it also helps keep the free Supabase project from pausing (needs check: that this counts as activity, see `docs/setup/supabase.md`).

1. Repository Settings > Secrets and variables > Actions > Variables > New repository variable: `API_HEALTH_URL` = `https://<your-skillstack-api>.onrender.com/api/v1/health`. (A secret with the same name also works; the workflow reads the variable first.)
2. Leave it unset to disable pinging; the workflow then exits silently.
3. The cron is `*/14 5-18 * * *` (UTC). A guard step lets the ping through only between 08:00 and 20:00 in Asia/Jerusalem, so daylight saving needs no change.
4. Scheduled workflows run only from the default branch and are disabled after 60 days of repository inactivity (public repos); re-enable them in the Actions tab if that happens.

## Environment variable names

| Where  | Names                                                                                                       |
| ------ | ----------------------------------------------------------------------------------------------------------- |
| Vercel | `VITE_APP_ENV`, `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`                              |
| Render | `NODE_VERSION`, `APP_ENV`, `HOST`, `CORS_ORIGINS`, `RATE_LIMIT_PER_MINUTE`, `TRUST_PROXY`, `NODE_ENV`, `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`, `DATABASE_URL` (see `docs/setup/api-auth.md`) (`PORT`: needs check whether Render injects it) |
| GitHub | `API_HEALTH_URL` (repository variable or secret)                                                            |

See `.env.example` and `apps/web/.env.example` for what each one means.
