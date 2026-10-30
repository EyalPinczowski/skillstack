# Future ideas

The single list of deferred ideas, each with the seam it will use (spec sections 12.1 and 12.3). None of these are built; only the seams are.

| Idea | Why it waits | Seam to use |
|---|---|---|
| Sharing a plan or progress | Needs sharing permissions on top of row-level security | `user_id` on every table |
| Push notifications | Needs a push service and permission flows | `NotificationChannel`, subscribed to the event log |
| Native mobile app | A PWA installs with no store | The versioned `/api/v1` and the OpenAPI contract |
| Offline-first editing | Syncing offline edits is hard | One client layer (TanStack Query), idempotent writes |
| Course-platform integrations | No public progress APIs | `ProgressSource`, `external_ref` on tasks |
| Public plan templates | Needs moderation | `plan_id` on tasks |
| Analytics and exports | The dashboard answers "am I on track" | The append-only event log, `Exporter` |
| Outlook and Apple calendars | Google first | `CalendarProvider` (the write guard stays above it) |
| Gamification, social features | Honest tracking matters more | Event log |
| Job-search tracking | A separate concern | A new backend module |
| General AI assistant | Keeps the free quota for practice | `AIProvider` |
| Paid AI providers | The $0 rule | `costTier` guard |
| Import a profile from a CV or LinkedIn export | Needs file parsing and careful privacy | `ProfileSource` (never scraping) |

## Infrastructure and product follow-ups

- **Open sign-up** instead of invite-only: a config flag, once free limits and Google verification allow it.
- **A custom domain**, needed for Google verification (calendar sync for everyone) and for a custom email sender.
- **Email provider** for invite and request-access emails: a free SMTP option has to be verified first (needs check).
- **Content-Security-Policy** for the API's Swagger UI (security headers beyond `nosniff` and `Referrer-Policy`).
- **Idempotency store**: the header is parsed today; storage arrives with the write endpoints.
- **Legal review** of the privacy policy and terms before the app is opened to the public.
