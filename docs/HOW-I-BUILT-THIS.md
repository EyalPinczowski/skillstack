# How I built this

A short, honest account of the working method behind Skillstack. It only describes what is visible in this repository. Nothing here is a benchmark: there are no measured speed-ups or cost figures, because none were recorded.

## Spec first

The project starts from [`docs/SPEC.md`](SPEC.md). `CLAUDE.md` tells the AI assistant to treat it as the source of truth and to say so when the spec, the catalog data and the code disagree, instead of guessing. The backup setup is an example: a first draft of [`docs/setup/backup.md`](setup/backup.md) differed from the spec (committed weekly files instead of short-lived artifacts), the mismatch was raised instead of silently chosen, and the owner decided to follow the spec: a daily encrypted dump kept as a private Actions artifact for 30 days, never committed.

## Phases with review gates

Section 11 of the spec splits the work into phases (Phase 0 for environments, then v0.1 to v1.0). Each phase ends with a stop: a review gate, a demonstration on the R&D environment, and approval before anything is released. The git flow supports that: feature branches go into `rnd` through pull requests, and only the owner merges `rnd` into `main`. The git history shows this as small, Conventional Commit pull requests (for example the scheduling engine, the database roles and migration runner, the deployment config).

## Planning and review versus coding

The work is split by model role, written down in `CLAUDE.md`:

- The larger model plans and reviews.
- Smaller coding subagents write the code, each from a precise brief (files, tests, acceptance criteria) in an isolated git worktree.
- Every diff is reviewed before it merges.

The split keeps the reviewing step separate from the writing step, so the code is read by something other than its author.

## Free tiers only

The rule is $0: free plans of Supabase, Vercel and Render, nothing that needs a credit card, and no paid AI provider. AI is an optional extra and the app has to work with it switched off, using template and rule-based fallbacks (ADR 004). Facts about free plans are not taken from memory: the docs mark anything unconfirmed as "needs check" (see [`docs/setup/supabase.md`](setup/supabase.md) and the ADRs), and the catalog data carries `url_verified` and `price_verified` flags so unverified items are never shown as verified.

## Privacy by design

- Two environments (`prod`, `rnd`) are separate schemas with separate database roles (ADR 003, [`packages/db/README.md`](../packages/db/README.md)). Every table has row-level security and an explicit read-only policy for the backup role. Nothing has `BYPASSRLS`.
- The API never accepts a `user_id` from the client.
- Personal details are not sent to AI models.
- The calendar integration uses the narrowest scopes and a write guard so the app only touches events it created (ADR 002).
- Secrets stay out of the repo (secret scanning with gitleaks runs in CI). The owner's personal data lives in a separate private repo, which also runs the backup job; backups are encrypted with `age`, kept as 30-day private artifacts, and the private key stays offline.

## Tests that fail without the fix

A fix is only accepted if its test fails without the fix. The database package tests run against a real throwaway PostgreSQL cluster ([`packages/db/scripts/test-postgres.sh`](../packages/db/scripts/test-postgres.sh)), including row-level-security tests run directly against the database and a check that every migration follows the table convention. The backup scripts have a local round-trip test ([`packages/db/scripts/test-backup.sh`](../packages/db/scripts/test-backup.sh)). In CI, the database tests fail instead of being skipped when no database is available.

## What is not here

This is a solo, spec-driven project with an AI assistant, not a team process. Several of the decisions are marked "Planned" in [`docs/decisions/`](decisions/README.md) because they describe the intended design and are not all built yet. The status column in that index is the honest record of what exists.
