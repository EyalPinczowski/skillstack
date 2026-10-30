# Setting up Supabase (owner guide)

Supabase hosts the database and sign-in. This guide covers creating the project and what the app needs from it. Facts below come from Supabase's own documentation (linked) and were read on 30 October 2026; plans change, so anything marked **needs check** has not been confirmed.

## What the free plan gives (verified)

From [About billing on Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase):

- Two free projects (across all organizations you own or administer; paused projects don't count).
- 500 MB database per project, 50,000 monthly active users, 5 GB egress.

From [Project pausing](https://supabase.com/docs/guides/platform/free-project-pausing):

- A free project with low activity over a week is paused. A few database requests a day are typically enough to prevent it.
- A paused project is resumed from the dashboard, and the docs currently give a one-year restore window.

Skillstack plans for this: the keep-warm workflow pings the API, and the API's health check touches the database, so a project in daily use is not paused. The R&D schema shares the same project, so only one of the two free projects is used.

**Needs check:** whether the free plan asks for a credit card when creating the project. If it does, stop and tell the maintainer; the rule for this project is $0 and no card.

## Create the project

1. Sign in at supabase.com with the account you want to own the project.
2. Create a **new project** on the **Free** plan. Use a strong database password and keep it in a password manager (it is only needed to build connection strings; the app itself uses separate roles).
3. Pick a region close to where the backend will run. **Needs check:** which regions Render's free plan offers; choose the Supabase region after confirming.
4. Do **not** add the `prod` or `rnd` schemas to the project's exposed API schemas. They are reached only through the backend's database roles, never through Supabase's data API.

## Connection strings

Open the project and click **Connect** (top of the page), then copy the string and replace `[YOUR-PASSWORD]`, percent-encoding any reserved characters. From [Connecting to your database](https://supabase.com/docs/guides/database/connecting-to-postgres):

| Use | Connection | Port | User |
|---|---|---|---|
| Migrations from GitHub Actions | **Shared pooler, session mode** | 5432 | `postgres.[PROJECT-REF]` |
| The API on Render | Shared pooler, session mode (persistent backend on an IPv4 network) | 5432 | `app_<env>.[PROJECT-REF]` |
| Direct connection | `db.[PROJECT-REF].supabase.co` | 5432 | `postgres` |

- The direct connection is **IPv6-only on the Free plan**; the shared pooler is IPv4 on every plan. GitHub-hosted runners and Render may not reach IPv6 (**needs check**), so use the session-mode pooler unless that is confirmed.
- A custom role connects through the pooler as `[ROLE].[PROJECT-REF]`, for example `app_rnd.abcdefghij`.
- Transaction mode (port 6543) keeps no session state between transactions. Skillstack's API sets the user's role and claims with `SET LOCAL` inside each request's transaction, so it works there too; session mode is simply the documented choice for a persistent backend.

The connection strings are secrets. They go into GitHub Environments and Render's environment variables, never into the repository (see `docs/setup/database.md`).

## Sign-in settings (decided when the sign-in feature is built)

- **Email service:** the built-in sender delivers only to addresses on the project's team and is limited to 2 messages per hour ([Auth SMTP](https://supabase.com/docs/guides/auth/auth-smtp)). That is enough for the owner and a few testers, but not for inviting other people: a custom SMTP provider is needed first, and a free one that needs no card has to be found and checked (**needs check**).
- **Closed beta (allowlist):** Supabase offers a [before-user-created hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook) (a Postgres function or an HTTP endpoint) that can reject a sign-up. **Needs check:** whether it is available on the Free plan and whether it runs for one-time-code and Google sign-ups. If it does not, the fallback is to turn off open sign-ups and create approved users from the backend.
- **Bot protection:** Cloudflare Turnstile is supported ([CAPTCHA protection](https://supabase.com/docs/guides/auth/auth-captcha)). **Needs check:** whether it covers one-time-code and Google sign-in; if not, the request-access form (our own endpoint) verifies Turnstile itself.
- **Google sign-in** needs a Google Cloud OAuth client; see `docs/decisions/006-oauth-production-status-without-verification.md`.

## Checklist

- [ ] Project created on the Free plan, no card needed
- [ ] Database password stored in a password manager
- [ ] Connection strings copied (session-mode pooler) and kept out of the repo
- [ ] `prod` and `rnd` schemas **not** exposed in the API settings
- [ ] Next: follow `docs/setup/database.md` to create the environments
