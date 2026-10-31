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
4. Wait for the first deploy. The health check is `GET /api/v1/health`.
5. Suspend or let `skillstack-api-rnd` sleep; only the production service should be kept awake (see the 750-hour budget above).
6. Database and auth variables (Supabase) are added when the API starts using them; follow `docs/setup/supabase.md`. Never commit values.
7. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (both services; the production API refuses to start without them). The key lets the API delete the Supabase Auth user when someone deletes their account. It bypasses Row Level Security, so treat it like the database password: enter it only in the Render dashboard (`sync: false`), **never** in Vercel, in any `VITE_` variable, in the web app or in git. Where to find it and the exact menu names: `docs/setup/api-auth.md`, "Service key for account deletion".

## 3. Keep-warm GitHub Action

`.github/workflows/wakeup.yml` pings the production API during study hours.

1. Repository Settings > Secrets and variables > Actions > Variables > New repository variable: `API_HEALTH_URL` = `https://<your-skillstack-api>.onrender.com/api/v1/health`. (A secret with the same name also works; the workflow reads the variable first.)
2. Leave it unset to disable pinging; the workflow then exits silently.
3. The cron is `*/14 5-18 * * *` (UTC). A guard step lets the ping through only between 08:00 and 20:00 in Asia/Jerusalem, so daylight saving needs no change.
4. Scheduled workflows run only from the default branch and are disabled after 60 days of repository inactivity (public repos); re-enable them in the Actions tab if that happens.

## Environment variable names

| Where  | Names                                                                                                       |
| ------ | ----------------------------------------------------------------------------------------------------------- |
| Vercel | `VITE_APP_ENV`, `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`                              |
| Render | `NODE_VERSION`, `APP_ENV`, `HOST`, `CORS_ORIGINS`, `RATE_LIMIT_PER_MINUTE`, `TRUST_PROXY`, `NODE_ENV`, `SUPABASE_JWKS_URL`, `SUPABASE_JWT_ISSUER`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secret, Render only), `DATABASE_URL` (see `docs/setup/api-auth.md`) (`PORT`: needs check whether Render injects it) |
| GitHub | `API_HEALTH_URL` (repository variable or secret)                                                            |

See `.env.example` and `apps/web/.env.example` for what each one means.

---

# Option B: Cloudflare (instead of Vercel for the web app)

Use this if you prefer to host the frontend on Cloudflare. The API (Render) and database (Supabase) do not change. Pick one host per environment; do not run both for the same address. Facts below were read from the official Cloudflare docs on 2026-10-31; anything not stated there is marked **needs check**.

> **Card requirement.** Cloudflare's Workers pricing page lists a Free plan, and a web search summary of Cloudflare's pages said "no credit card required", but I could not confirm that wording by fetching the page. Treat "no card at sign-up" as **needs check**. If any Cloudflare screen asks for a card or payment method, stop and ask (project rule: $0, no card). Do not click any "Upgrade", "Workers Paid" or "Pro" button.

## Which Cloudflare product

- The Cloudflare Pages docs say: "Start new projects with Workers." and "Workers supports most Pages use cases and offers a broader feature set." (https://developers.cloudflare.com/pages/). The docs I read do not say Pages is deprecated, so Pages still exists, but this guide uses **Workers with static assets** (no Worker code, only files).
- Cloudflare's Pages-to-Workers migration page compares the features (https://developers.cloudflare.com/workers/static-assets/migrate-from-pages/).
- The repository contains `wrangler.jsonc` (repo root: `name` `skillstack-web`, `assets.directory` `./apps/web/dist`, `not_found_handling` `single-page-application`) and `apps/web/public/_headers`. Vite copies everything in `public/` into `apps/web/dist`, which is where Cloudflare reads `_headers`. Vercel ignores both files.
- SPA fallback: with `not_found_handling = "single-page-application"` unmatched paths return `200` with `index.html` (https://developers.cloudflare.com/workers/static-assets/). That replaces the Vercel rewrite, so no `_redirects` file is needed.

## Verified free-plan facts (Cloudflare)

| Topic                         | Fact                                                                                                                                                                       | Source                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Static asset requests         | "Requests to static assets are free and unlimited."                                                                                                                        | https://developers.cloudflare.com/workers/platform/pricing/             |
| Workers requests              | Free plan: 100,000 requests per day to Worker code (not used by an assets-only Worker), 10 ms CPU per invocation.                                                          | https://developers.cloudflare.com/workers/platform/pricing/             |
| Bandwidth                     | No free-plan bandwidth cap is stated on the pricing page. Free-plan bandwidth: needs check.                                                                                | https://developers.cloudflare.com/workers/platform/pricing/             |
| Asset limits (Free)           | 20,000 files per Worker version, 25 MiB per file.                                                                                                                          | https://developers.cloudflare.com/workers/platform/limits/              |
| Builds (Workers Builds, Free) | 3,000 build minutes per month, 1 concurrent build, 20 minute build timeout.                                                                                                | https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/ |
| Pages builds (reference)      | 500 builds per month on Free. Not used by this guide.                                                                                                                      | https://developers.cloudflare.com/pages/platform/limits/                |
| `_headers`                    | Up to 100 rules, 2,000 characters per line; file goes in the assets directory (framework projects: `public/`).                                                              | https://developers.cloudflare.com/workers/static-assets/headers/        |
| Node version                  | Build image default is Node 24.22.1 (22.23.4 also preinstalled). Set with the `NODE_VERSION` build variable or a `.nvmrc` / `.node-version` file.                           | https://developers.cloudflare.com/workers/ci-cd/builds/build-image/     |
| pnpm                          | Run through Corepack; the version comes from the top-level `packageManager` field in `package.json` (this repo: `pnpm@10.28.0`).                                           | https://developers.cloudflare.com/workers/ci-cd/builds/build-image/     |
| Build image                   | Ubuntu 24.04 on x86_64.                                                                                                                                                    | https://developers.cloudflare.com/workers/ci-cd/builds/build-image/     |
| Branches                      | Production branch is set under Settings > Build > Branch control (defaults to the repo's default branch). "Enable Preview Builds" builds all other branches with a preview URL. | https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/  |
| Turnstile                     | Free plan exists: 20 widgets per account, unlimited verifications, 10 hostnames per widget.                                                                                | https://developers.cloudflare.com/turnstile/plans/                      |

## Needs check (Cloudflare)

- Whether sign-up or the first deploy asks for a card (see the box above).
- Commercial-use terms of the Free plan for Workers: the service-specific terms page I read does not cover them. It does say Cloudflare may limit use of the CDN to serve video or a disproportionate share of images or large files without a paid service (https://www.cloudflare.com/service-specific-terms-application-services/). A study-plan app serves small files, but read the terms yourself.
- Free-plan bandwidth limit (not stated, see table).
- Whether `_headers` rules are also applied to the `index.html` returned by the SPA fallback. The docs do not say. After the first deploy, open a deep link such as `/plan` and check the response headers in the browser (DevTools > Network > the document > Headers) for `x-frame-options: DENY`. If missing, report it; do not work around it with a Worker (Worker-generated responses do not get `_headers` at all).
- Which Wrangler version Workers Builds runs when the repo has no `wrangler` dependency (the docs say it uses the version in `package.json`). The first build log shows it. If the build fails on the config, report it instead of changing dependencies.
- Whether build variables can differ per branch (production vs preview). The docs list only one set of "Build variables and secrets". This matters for `VITE_APP_ENV` and `VITE_API_URL`, see step 7.
- A stable address for the `rnd` branch (step 7).
- Whether Workers Builds accepts a GitHub repo owned by an organization (not checked).

## Steps (click by click)

1. **Sign up.** Go to https://dash.cloudflare.com/sign-up. Enter your email and a password, or choose sign-in with GitHub if offered. Verify the email. Choose the **Free** plan if asked. If a screen asks for a card, stop.
2. **Create the project.** In the dashboard left menu choose **Workers & Pages**, then **Create application**, then **GitHub** (the path described at https://developers.cloudflare.com/workers/ci-cd/builds/). Authorise the Cloudflare GitHub app for the Skillstack repository only, not all repositories. Pick the repository.
3. **Project name.** Set the name to `skillstack-web`. It must match `name` in `wrangler.jsonc`, otherwise the build fails.
4. **Production branch.** `main`.
5. **Build settings** (Settings > Build):
   - Root directory: leave empty (repository root).
   - Build command: `corepack enable && pnpm install --frozen-lockfile && pnpm --filter @skillstack/web build`
   - Deploy command: leave the default `npx wrangler deploy` (it reads `wrangler.jsonc`).
   - Node version: add the build variable `NODE_VERSION` = `22` (the repo requires Node 22 or newer; the image default 24 also satisfies that, so this is optional).
6. **Build variables** (Settings > Build > Variables and secrets). Public values only. Never add a service key, `SUPABASE_SERVICE_ROLE_KEY` or a database password here.
   - `VITE_APP_ENV`: `operational` for the production site.
   - `VITE_API_URL`: the production Render API URL, no trailing slash.
   - `VITE_SUPABASE_URL`: `https://<project-ref>.supabase.co`.
   - `VITE_SUPABASE_ANON_KEY`: the anon / publishable key (public by design).

   These are baked into the files at build time, so a changed value needs a new build (retry the build or push a commit).

7. **R&D (`rnd` branch).** Under Settings > Build > Branch control tick **Enable Preview Builds**; each push to `rnd` then gets a preview URL (Worker's Previews section). Because build variables may not differ per branch (needs check), the safest setup is a second Worker connected to the same repo with production branch `rnd`, its own variables (`VITE_APP_ENV=rnd`, R&D API URL) and name `skillstack-web-rnd`. Its name must still match the config: set its deploy command to `npx wrangler deploy --name skillstack-web-rnd` (needs check that Workers Builds accepts this with the name check). If that does not work, stop and ask.
8. **Save and Deploy.** Watch the build log; confirm pnpm is 10.x and the build ends with the Vite output.
9. **Find the site address.** Open the Worker, Overview or Settings > Domains & Routes (exact menu name needs check). The address looks like `https://skillstack-web.<your-subdomain>.workers.dev`. Copy only the origin (no path, no trailing slash).
10. **Tell the API.** In Render, open `skillstack-api` > Environment and add the Cloudflare origin to `CORS_ORIGINS` (comma separated, exact origin, no wildcard); the R&D service gets the R&D origin. Save; Render redeploys.
11. **Tell Supabase.** In Supabase, Authentication > URL Configuration (see `docs/setup/supabase.md`), add the Cloudflare address to the Site URL / Redirect URLs, with the sign-in callback path the app uses. Without this, sign-in redirects fail.
12. **Check security headers.** Open the site, DevTools > Network > the document request > Headers: expect `x-content-type-options`, `x-frame-options: DENY`, `referrer-policy`, `permissions-policy`, `strict-transport-security` and `content-security-policy: frame-ancestors 'none'`. Reload a deep link (for example `/plan`) to confirm the SPA fallback works.

## Vercel vs Cloudflare (verified facts only)

|                           | Vercel Hobby                                                    | Cloudflare Workers (Free)                                                   |
| ------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Cost                      | Free                                                            | Free (card at sign-up: needs check)                                         |
| Commercial use            | "Restricted to non-commercial personal use only"                | Not stated in the pages read: needs check                                   |
| Static traffic            | 1,000,000 CDN requests and 100 GB Fast Data Transfer per month  | Static asset requests free and unlimited; bandwidth cap not stated (needs check) |
| Builds                    | 45 min per deployment, 1 concurrent, 100 deployments per day    | 3,000 build minutes per month, 1 concurrent, 20 min timeout                 |
| GitHub organization repos | Not on Hobby                                                    | needs check                                                                 |
| Config in this repo       | `vercel.json`                                                   | `wrangler.jsonc` + `apps/web/public/_headers`                               |
| Product status            | Current                                                         | Cloudflare docs tell new projects to start with Workers (Pages still documented) |

## Turnstile

Cloudflare Turnstile (bot protection planned for sign-in) lives in the same Cloudflare account, so the account created here is the one to use later. Its Free plan allows 20 widgets and unlimited verifications (source in the table above). Card requirement for Turnstile: needs check.
