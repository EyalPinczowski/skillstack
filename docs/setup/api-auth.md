# API sign-in and accounts (owner guide)

How the API knows who is calling, and what the owner must configure in Supabase and Render. Background: spec 3.A, ADR 010 and ADR 011. Facts from Supabase's documentation were read on 30 October 2026 ([Signing keys](https://supabase.com/docs/guides/auth/signing-keys), [JWTs](https://supabase.com/docs/guides/auth/jwts)); anything not confirmed there is marked **needs check**.

## How it works

1. The web app signs the user in with Supabase Auth (email code, magic link or Google) and sends the access token as `Authorization: Bearer <token>`.
2. The API verifies the token with the `jose` library: signature against the project's public keys (JWKS), issuer, audience `authenticated`, expiry. Only ES256 and RS256 are accepted; `alg: none` and shared-secret (HS256) tokens are refused.
3. The user id is the token's `sub`. It is the only identity the API uses; no route reads a user id from the query, a header or the body.
4. The first call to any `/api/v1/me` route creates the account through the database function `provision_user`, which fails unless the token's email is on the allowlist (`allowed_emails`) and the number of active users is below `user_cap`. This applies to every sign-in method, Google included.
5. Each request then runs in one transaction as `app_<schema>_user` with the user's claims set, so row-level security shows only that user's rows.

An unapproved email, a full beta and a disabled account all get the same `403` answer, so the API never tells anyone whether an email is on the list.

## Environment variables (Render)

| Name                  | Value                                                          |
| --------------------- | -------------------------------------------------------------- |
| `NODE_ENV`            | `production` (the API then refuses to start without the next three) |
| `SUPABASE_JWKS_URL`   | `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` |
| `SUPABASE_JWT_ISSUER` | `https://<project-ref>.supabase.co/auth/v1`                    |
| `DATABASE_URL`        | connection string of `app_prod` or `app_rnd` (see `docs/setup/supabase.md`), never the admin |

The JWKS path and the issuer format (`https://<project-ref>.supabase.co/auth/v1`) are shown in Supabase's documentation. The `aud` value `authenticated` is **needs check**: the documentation page read does not state it, so decode a real access token of the project once (for example at jwt.io, with a throwaway test account) and compare `iss` and `aud` before relying on it. If the project uses a custom domain, the issuer differs (**needs check**).

## Steps in the Supabase dashboard (all **needs check** for the exact menu names)

1. **Signing keys.** Open the project's JWT signing keys settings and make sure the project signs with an asymmetric key (ES256 recommended; RS256 works). The legacy HS256 shared secret publishes no public key, so tokens signed with it cannot be verified by this API and are rejected on purpose. Rotating from the legacy secret signs users out once. Needs check: the exact menu path and whether new projects already use asymmetric keys by default.
2. **JWKS URL.** Open `https://<project-ref>.supabase.co/auth/v1/.well-known/jwks.json` in a browser; it must list at least one key. Supabase's edge caches it for about 10 minutes, so a rotated key can take that long to appear. The API caches keys in memory and refetches when it sees an unknown key id (library behaviour, needs check under load).
3. **Email sign-in.** Enable the Email provider with one-time code / magic link; disable "Confirm email" settings that would allow password sign-up if passwords are not used. Needs check: the exact toggles. The built-in mailer only delivers to team addresses and is limited to 2 messages per hour (see `docs/setup/supabase.md`).
4. **Google provider.** Create a Google Cloud OAuth client and add it under Authentication, Providers, Google; see ADR 006. Needs check: the redirect URL to register.
5. **Turnstile (not wired in this branch).** Enable CAPTCHA protection with Cloudflare Turnstile. Needs check whether it covers one-time-code and Google sign-in. The API does not verify it yet.
6. **Do not rely on Supabase to block sign-ups.** Supabase may create an auth user for any email that completes sign-in. That is harmless: without an allowlist entry the API refuses to create an account and every `/me` call returns 403. Optionally disable open sign-ups (needs check) so strangers do not get auth users at all.

## The first admin

There is no way to become admin in the app. After the database is migrated:

```bash
DATABASE_URL=<admin connection> pnpm --filter @skillstack/db migrate promote-admin --schema rnd --email you@example.com
```

This adds the email to the allowlist and, if the account already exists, sets its role to `admin`. If you have not signed in yet, sign in once (the API creates the account), then run the command again. It refuses to run without `--schema`.

## Deleting an account

`DELETE /api/v1/me` with `{"confirmation": "delete my account"}` removes the user row and, through cascades, every row they own, then removes their email from the allowlist so a still-valid token cannot silently recreate the account. A new invite is needed to come back. Not part of this branch yet: revoking the calendar connection and deleting calendar events (the calendar does not exist yet) and the backup retention window (spec 3.A, privacy page).

## Not built here

Request access, invites, the admin console, Turnstile wiring and any web UI (v0.4). Until the admin console exists, approve an email by inserting it into `allowed_emails` as the owner role (or with `promote-admin` for admins).
