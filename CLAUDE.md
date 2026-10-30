# CLAUDE.md – Skillstack

**The source of truth is [`docs/SPEC.md`](docs/SPEC.md).** Read it before changing anything. If the spec, the catalog data in `data/catalog/` or the code disagree, or the spec looks like a mistake, say so instead of guessing.

Skillstack turns a learning goal into a study plan and runs it day by day (PWA; React + TypeScript web app, Fastify API, shared package with the scheduling engine; Supabase + Vercel + Render on free plans).

## Rules to always follow

**Cost**
- **$0.** Free tiers only. If anything needs a credit card or could charge money, stop and ask.
- No paid AI providers (no Claude API). AI is an optional extra; the app must work with it off (template and rule-based fallbacks).

**Git flow**
- Feature branches `feature/<area>-<name>` (`api`, `web`, `shared`, `infra`, `catalog`) are created from `rnd`; PRs go into `rnd`. Release PRs go from `rnd` to `main`. Hotfixes go from `main` and are merged back into `rnd`.
- Never commit directly to `main` or `rnd`. Claude merges green feature PRs into `rnd` (squash). **Only the owner merges into `main`** (merge commit).
- Conventional Commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`), small and focused. Every PR says what changed, why, how to test, and has a screenshot for UI changes.
- Database migrations are additive and backward compatible, take the target schema explicitly (`rnd` first, then `prod`), and refuse to run without it.

**Facts**
- **Never invent facts:** no made-up course links, prices or free-tier limits. Check official docs and mark anything unverified as "needs check".
- Never present a catalog item with `url_verified: false` or `price_verified: false` as verified.

**Privacy and security**
- Row Level Security on every user-owned table, tested directly against the database. The API never accepts a `user_id` from the client.
- No secrets in the repo (`.env.example` has no real values). Check before every commit.
- No personal details (name, email, phone, links) are ever sent to AI models.
- The calendar write-guard (spec 3.8): the app only writes to events it created itself in its own calendar; scopes are `calendar.app.created` + `calendar.readonly` only.
- The owner's personal data (their real plan, the original spec) lives in a private repo, never here.

**Scope**
- Don't build anything from spec section 12.1. Build only the seams in 12.3. If something seems to need a deferred feature, ask.
- Plan changes are suggestions until the user approves them. The app never marks a task done on its own.

**Process**
- Stop at the end of every phase: run the review gate, show what works on the R&D environment, and wait for approval before releasing.
- When sending the owner a plan for approval, send only what is new.
- The whole project (UI, content, code, comments, commits, docs) is in English.

## Catalog data (`data/catalog/`)
- Read `data/catalog/README.md` first. Don't hand-edit the generated JSON/SQL: edit `build/catalog.py`, `taxonomy.py` or `questions.py` and run `python3 data/catalog/build/build.py` (run it from `data/catalog/build`). CI fails if generated files drift.
- `schema.sql` is a reference design, not something to run by hand; turn it into migrations (with RLS) and load data through the seed process.
- `questions.json` drives the guided intake; never hard-code the questions.

## Docs
- `docs/legal/` – privacy policy, terms and disclaimer drafts (placeholders in square brackets stay until the owner fills them; not legal advice).
- `docs/decisions/` – ADRs (to be added in Phase 0).
