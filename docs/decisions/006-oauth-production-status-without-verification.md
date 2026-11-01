# 006 – OAuth in production status, without Google verification at first

**Status:** Planned · built with the calendar feature (v0.3b)

## Context
Calendar scopes are "sensitive". In Google's **Testing** status, refresh tokens expire after about a week (**needs check** on Google's current rules), which would silently break calendar sync. Google verification requires a domain the owner does not have yet.

## Options
1. Stay in Testing and reconnect weekly. Poor experience.
2. Verify the app now. Not possible without a domain and a review.
3. Publish to production status without verification, for the owner and a few testers.

## Decision
Option 3 for now. Users see a one-time "Google hasn't verified this app" warning and the number of users is limited (**needs check**). Calendar sync stays opt-in, with an `.ics` export as the free alternative for everyone. Before calendar sync is opened to the public, the app must pass verification.

## Consequences
- A rejected token shows a "Reconnect calendar" banner instead of failing silently.
- The calendar never blocks the rest of the app.
- Verification and a domain are tracked in `docs/FUTURE.md`.
