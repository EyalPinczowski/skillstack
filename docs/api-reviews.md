# Day review and adjustment suggestions API (v1)

Spec 3.4. Base path `/api/v1/plans/:planId`. The same rules as the other plan routes: a bearer token, the user is the token's `sub`, a `user_id` or `plan_id` in a body or query is never read, another user's plan answers 404 exactly like a missing one, and every error has the shape `{ "error": { "code", "message", "requestId" } }`. The live contract is `GET /api/v1/openapi.json`.

| Method and path                       | What it does                                                                                       | Success | Errors             |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- | ------- | ------------------ |
| `PUT /days/:date/review`              | Submit or re-save the review of a day (body: shared `DayReviewInputSchema`)                        | 201/200 | 400, 404, 409, 422 |
| `GET /days/:date/review`              | One review (ratings, note, outcomes)                                                               | 200     | 400, 404           |
| `GET /reviews?from=&to=`              | Ratings per day for the trend charts, oldest first, latest 366 days at most, no notes or outcomes  | 200     | 400, 404           |
| `GET /suggestions`                    | The open suggestions, recomputed from the plan's current state                                     | 200     | 404, 422           |
| `POST /suggestions/:id/preview?option=n` | Change summary and new finish date for one option. **Saves nothing.**                           | 200     | 400, 404, 409, 422 |
| `POST /suggestions/:id/accept`        | Body `{ option? }` (default 0). Applies the suggestion, stores the adjustment                      | 201/200 | 400, 404, 409, 422 |
| `POST /suggestions/:id/reject`        | Body `{}` or none. Stores the rejection so the same evidence is not offered again                  | 201/200 | 400, 404, 409      |

## The review

- `date` in the body must equal the URL date (422 otherwise). "Today" is the date in the plan's time zone.
- Allowed for today or an earlier date, from the plan's first day on. A future date answers 422. A date that was not a study day (week pattern and overrides) answers 422 unless work was logged on it or the day was started.
- Every outcome's `taskId` must be a task of this plan (422). The ratings, the note length (2000), the reason length (500), one outcome per task and the hours of a partial outcome are checked by the shared schema (400).
- **The review never logs hours and never marks a task done.** For a `partial` outcome the response lists `missingLogs` (reported hours not yet logged) and for a `done` outcome `notMarkedDone` (tasks not marked done). The user logs and completes with the task endpoints.
- **One review per plan and date.** The first save answers 201 and writes a `review.submitted` event. The same content again answers 200 and writes nothing. Different content re-saves the review (200, `review.updated` event), allowed only while the plan's today is the review's date or the next date; after that it answers 409. Reviews are never deleted.
- Event payloads hold the date, the three ratings and the outcome count, never the note.
- The response also carries `suggestions`, the open suggestions after this review.

## Suggestions

The four transparent rules live in `packages/shared/src/scheduling/adjustments.ts` (density too high twice in a row, density too light, estimates off by more than 25% for a task type, high difficulty). The API only loads the stored reviews, logs, tasks, week pattern, overrides, the plan-local today and the earlier decisions, and calls `suggestAdjustments`.

- **Nothing is stored for a suggestion until it is decided.** `GET /suggestions` recomputes the list every time. The id is a stable hash of the rule and the evidence, so the same evidence gives the same id; new evidence gives a new id.
- **Preview** applies the option (`0` is the recommended change, then the alternatives) to a copy of the plan with `applySuggestion`, schedules both versions with the same frozen days as `GET /schedule`, and returns `summary` (the shared `summarizeChanges` result, e.g. "8 tasks moved, plan finish pushed back by 8 study days.") with `currentFinishDate` and `proposedFinishDate`. Nothing is written except the automatic freezing of days that have passed, as for every schedule read.
- **Accept** takes only the id and the option. Any other key in the body answers 400. The suggestion is recomputed from the stored state inside the transaction, so a client can never supply the change. It is applied in one transaction (week pattern, a day override, task estimates, or a new `source: auto` practice task and the tasks after it moved down), an `adjustments` row with the evidence, the applied change and the summary is inserted, and one `schedule.changed` event is written.
  - 201 when applied now. 200 with `replayed: true` and the stored summary when the same id was already accepted with the same option (nothing changes, no second event).
  - 409 when the id is not in the recomputed list (stale evidence, an unknown id), when it was rejected, or when it was accepted with another option.
  - 422 for an option the suggestion does not have, or a change that would break a task rule (for example an anchor task that would end after 23:59).
- **Reject** stores the decision with its evidence, so the same suggestion is not offered again; 200 on a repeat; 409 after an accept. A `suggestion.rejected` event is written.
- An accepted suggestion's evidence (review dates, task ids) is not used again by the same rule.
- Accept, reject and review writes lock the plan row (`FOR NO KEY UPDATE`) so two simultaneous requests are serialised; logging a task is not blocked by it.

## Database

Migration `0008_day_reviews.sql`: `day_reviews` (one row per user, plan and date; the app role can insert, select and update only the ratings, note, outcomes and `updated_at`) and `adjustments` (insert and select only, like `events`). Both have RLS, a backup `SELECT` policy and composite foreign keys to `plans` with cascade.

Tests: `apps/api/test/reviews.test.ts` (real Postgres) and `packages/db/test/data-model.test.ts`.

## Not built here

- The web screens (end-of-day window, suggestion cards, trend charts).
- A catalog-based "area" for the difficulty rule: without catalog skills the area of a task is its practice kind, else its provider, else its type.
- A NUL-character check on free text: it belongs to the validation hardening branch. Free text is bounded by length only (note 2000, reason 500); a NUL byte in a note currently ends in a 500 from the database.
