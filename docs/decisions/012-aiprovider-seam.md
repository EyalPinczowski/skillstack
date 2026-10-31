# 012 – The AIProvider seam, and a template-only day briefing in v0.2

**Status:** Accepted · seam and guard built in v0.2 (`apps/api/src/ai/`); no provider implementation until v0.3

## Context
Spec 12.3 asks for an `AIProvider` interface with a `costTier` and a guard that refuses paid providers unless a setting enables them (acceptance test in spec 9). Spec 3.2 asks for a model-written day overview, with a template when the model is unavailable. ADR 004 sets "deterministic first, AI optional". The owner decided that in v0.2 the overview is template-only: rule-based, no external call. Providers (GitHub Models, Groq, Gemini) arrive in v0.3 with their free-tier limits **needs check** against each provider's own documentation.

## Options
1. Build the seam together with the first provider in v0.3. The guard would then be tested only against a real implementation, and the briefing code would have to be reworked.
2. Build the contract, the registry and the guard now, with no implementation; make the briefing independent of any model.

## Decision
Option 2.
- **Where:** `apps/api/src/ai/` (`provider.ts`: `AIProvider`, `CostTier`, `AISettings`, `assertProviderAllowed`, `PaidProviderRefusedError`; `registry.ts`: `createAIRegistry`). It is backend-only because a key must never reach the browser, and it is outside any one module because both the briefing and the practice window (v0.3) use it. Providers will be one new file each, registered by a config entry.
- **Contract:** `{ id, costTier: 'free' | 'paid', generate(request) }`. A request carries a purpose, prompts and a token cap; it never carries a name, email, phone number or link of the user.
- **Guard:** `register()` throws `PaidProviderRefusedError` for a `paid` provider unless `AISettings.allowPaid` is true (env `AI_ALLOW_PAID`, default `false`). It fails closed: anything that is not exactly `free` or `paid`, including a missing tier, counts as paid. The registry checks again whenever providers are listed, so a provider that changes tier after registering is not returned. Spec 12.2 also asks for a spending cap on any paid component; that belongs to the first paid provider and is **not** built here (needs the owner's decision before any paid provider exists).
- **Flag:** `features.aiOverview` (env `FEATURE_AI_OVERVIEW`), default off. In v0.2 nothing reads it: the briefing's `source` is always `template`.
- **Briefing:** `buildBriefing` in `packages/shared/src/briefing.ts` is a pure function. The overview is two or three sentences from fixed templates (hours and task types; the nearest anchor the day's work leads toward and its distance in study days, or an earned certificate, or the plan's finish date; carried-over tasks) plus a warning sentence when the engine reports `anchor_at_risk`. It never invents a link, provider, price or lesson title: those are copied from the task or left out. Nothing is cached (it is deterministic and cheap) and the route writes no events.
- **Carried over** means: planned on earlier frozen days for more minutes than the hours logged so far. A course that simply spans several days and is on schedule is not carried over. (This is stricter than the weekly view's `carriedOverFrom`, which lists every earlier planned day of a still-open task.)

## Consequences
- The app is fully usable with every AI provider absent, as ADR 004 requires.
- v0.3 adds a provider file, a registry entry, response caching (hash of the PII-free input) and, behind `features.aiOverview`, an optional model-written overview that falls back to the template, which stays the source of truth for the rest of the briefing.
- The spec 9 test "a paid AI provider registered in tests is refused while the setting is off" runs now, against the registry (`apps/api/test/ai-provider.test.ts`).
