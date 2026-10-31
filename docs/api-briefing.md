# Day briefing API (v1)

Base path `/api/v1`. Same rules as the other plan routes (`docs/api-plans.md`): `Authorization: Bearer <Supabase access token>`, the user is the token's `sub`, the current Terms must be accepted (403 `terms_not_accepted` otherwise), another user's plan answers 404 exactly like a missing one, and every error has the shape `{ "error": { "code", "message", "requestId" } }`. The live contract is `GET /api/v1/openapi.json`.

| Method and path                           | What it does                                       | Success | Errors             |
| ----------------------------------------- | -------------------------------------------------- | ------- | ------------------ |
| `GET /plans/:planId/days/:date/briefing`  | The briefing for a study day (spec 3.2)            | 200     | 400, 401, 403, 404, 422 |

## Which days

- `date` is a plan-local date (`YYYY-MM-DD`, in the plan's time zone).
- **Today**: planned by the scheduling engine from the tasks as they stood at the start of the day (the same input that freezes the day later), so logging hours during the day does not shrink the briefing.
- **A past day**: a day that was ended or rolled over uses its **stored blocks**, and the tasks as they stood at the start of that day, so its briefing does not change when the plan is edited later (task titles and lessons are read live). Reading first brings every missed past day up to date, like the other reads.
- **A future day**, a day before the plan began, or a past day older than the rollover limit (400 days) answers `422 unprocessable`.
- Nothing is written: no event, no stored day beyond the automatic rollover that every read does. Nothing is cached.

## Response

```jsonc
{
  "date": "2026-11-01",
  "source": "template",            // always "template" in v0.2: no AI model is called
  "overview": "Today is 6 hours 50 minutes of study: 1 admin task and 2 courses. This work leads toward ..., on 2026-11-24, in 17 study days.",
  "tasks": [
    {
      "taskId": "sql1", "title": "...", "type": "course",
      "provider": "Kaggle",        // only when the task has one
      "url": "https://...",        // only when the task has one
      "plannedMinutes": 180, "start": "09:30", "end": "12:40",
      "blocks": [{ "start": "09:30", "end": "11:00", "minutes": 90 }],
      "what": "Study \"...\" on Kaggle: 3 hours today. 3 hours remain in total.",
      "lessons": [{ "title": "...", "url": "...", "estMinutes": 30, "summary": "...", "needsCheck": false }],
      "howToSteps": ["..."],
      "promptTemplate": "..." ,    // null when the task has none
      "successCriteria": "...",    // practices only, otherwise null
      "carriedOver": false
    }
  ],
  "suggestedOrder": [{ "taskId": "sql1", "start": "09:30", "end": "11:00" }]   // one entry per block, in time order
}
```

- `overview` is two or three sentences from fixed templates, plus a **warning sentence** when the engine reports `anchor_at_risk` for a date on or after the day (live day only; a stored day has no warnings). A day with nothing scheduled gets a rest-day text.
- "Leads toward" is the soonest unfinished anchor that depends, directly or through other tasks, on one of the day's tasks; the study-day count is the number of study days after the day up to and including the anchor date. Without such an anchor the text names an earned certificate, the next fixed date, or the plan's finish date, whichever exists.
- `carriedOver` is true when the task was planned on earlier days for more minutes than has been logged.
- `lessons` are exactly the task's own lessons; `url` appears only when the lesson has one, and `needsCheck: true` means the link has not been confirmed on the provider's site. Nothing here is invented.
- `successCriteria` for a practice is the task's `notes` when set, otherwise a generic sentence.

## AI

The overview is template-only in v0.2. The `AIProvider` seam, its registry and the guard that refuses paid providers by default exist (`apps/api/src/ai/`, ADR 012) but have no implementation and are not called. `features.aiOverview` (`FEATURE_AI_OVERVIEW`) and `AI_ALLOW_PAID` default to off.

Tests: `packages/shared/src/briefing.test.ts` (unit and property tests), `apps/api/test/briefing.test.ts` (real Postgres), `apps/api/test/ai-provider.test.ts`.
