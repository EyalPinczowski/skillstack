# @skillstack/shared

Shared by the API and the web app: data schemas (Zod), date helpers, and the **scheduling engine** as pure functions.

## Scheduling engine

`schedule(input)` places an ordered task list on days, according to each day's capacity, the task order and dependencies (spec sections 2 and 3.6). It has no I/O and no clock, so the same input always gives the same schedule.

| Rule | Where |
|---|---|
| Days before `today` never change (`frozenBlocks` pass through untouched) | `engine.ts` |
| Anchors (exams) keep their date and start time; pinned and locked blocks keep their time | `engine.ts` |
| A day's capacity = its hours (weekday, per-weekday override or one-off override) minus busy calendar events inside study time | `capacity.ts` |
| Blocks stay inside the daily window, outside lunch and busy events, with a short break after every N hours of continuous study | `engine.ts` |
| Splittable tasks may span days; non-splittable ones need one slot; no block below the minimum length except a task's final piece | `engine.ts` |
| Tasks go in `order`; a later task may use time an earlier one can't fit into | `engine.ts` |
| Warnings: exam at risk (with add hours / add a day / move the exam), task doesn't fit, exam date passed, dependency loop | `engine.ts` |
| The change summary shown before saving a reschedule | `changes.ts` |
| Automatic "Update CV and LinkedIn" task after a certificate | `cv.ts` |

Dates are local dates (`YYYY-MM-DD`) and times are minutes since local midnight; conversion to real instants happens only at the edges (`zone.ts`), so the engine is free of time-zone and daylight-saving bugs.

Tests cover the scheduling and time-settings acceptance cases from spec section 9, property-based invariants over random plans (`fast-check`), and a performance check.

## Exporting a plan

```
pnpm --filter @skillstack/shared export-plan --plan <plan.json> --out <dir> [--today YYYY-MM-DD]
```

Writes `schedule.ics` (import into any calendar), `schedule.html` (printable), `log-template.csv` (record actual hours) and `summary.json`. The plan file follows `PlanFileSchema`; it may carry optional `skillIds` (taxonomy skill ids, max 50) that the API stores for the briefing's podcast pick. Keep personal plans outside this repository.
