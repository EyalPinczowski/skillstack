# Practice API (v1), without a model

Spec 3.3. Base path `/api/v1/plans/:planId`. Every route sits behind the Terms guard (403 `terms_not_accepted` until the current terms and privacy are accepted). The same rules as the other plan routes: a bearer token, the user is the token's `sub`, a `user_id` in a body is rejected (400), another user's plan, task or session answers 404 exactly like a missing one, and every error has the shape `{ "error": { "code", "message", "requestId" } }`. Text containing U+0000 answers 422. The live contract is `GET /api/v1/openapi.json`.

This package has **no AI**. The in-app chat (channel `in_app`, messages, model feedback) comes in the chat package; the seams are the `channel` column, the empty `messages` list and the `model_json` / `model_repaired` feedback sources, which exist in the schema already.

| Method and path                         | What it does                                                                 | Success | Errors                  |
| --------------------------------------- | ---------------------------------------------------------------------------- | ------- | ----------------------- |
| `GET /practice/context`                 | The saved job description                                                    | 200     | 404                     |
| `PUT /practice/context`                 | Save it (`""` clears), returns `redactionsPreview`                           | 200     | 400, 404, 422           |
| `GET /tasks/:taskId/practice/prompt`    | The ready-made prompt and what went into it. Saves nothing                   | 200     | 404, 422                |
| `POST /tasks/:taskId/practice/sessions` | Start a session `{ id, channel: external \| self }`                          | 201/200 | 400, 404, 409, 422      |
| `GET /practice/sessions/:sessionId`     | Session, messages (empty for now), feedback                                  | 200     | 404                     |
| `POST /practice/sessions/:id/feedback`  | Paste feedback `{ text, markDone?, logHours? }` and finish                   | 201/200 | 400, 404, 409, 422      |
| `POST /practice/sessions/:id/finish`    | Finish with a rubric, an entered score or nothing `{ markDone, logHours?, rubric?, enteredScore? }` | 201/200 | 400, 404, 409, 422 |
| `POST /practice/sessions/:id/abandon`   | Give up: nothing logged, task untouched                                      | 200     | 404, 409                |
| `GET /practice/history?kind&from&to&limit` | Finished sessions, newest first, no text                                  | 200     | 400, 404                |
| `GET /practice/trends?from&to`          | Score points and `last`, `average`, `delta` per kind                         | 200     | 400, 404                |

## Rules

- **Done-marking.** A task is marked done only with `markDone: true`, and only through the tasks service (`completeTask`). Feedback of any kind never marks anything done on its own. `finish` requires `markDone` so the choice is always explicit; on the paste route it defaults to `false`. Logging hours also goes through the tasks service (`addLog`), which moves a `pending` task to `in_progress` as it does everywhere; the task is never closed by logging. A session is never moved from `finished` back to `active` (a database trigger enforces it); practising again means a new session. Marking a `skipped` task done answers 409 (reopen it first).
- **No cross-module SQL.** The practice SQL reads and writes only the four practice tables, events (through the plans repository) and the user's own name and email (to hide them from prompts). Facts about tasks (type, steps, estimate, status) come from the tasks service. The database still has the foreign key from a session to its task.
- **Job description (Tier 2).** Stored once per plan in `practice_contexts`. It is in the prompt returned by `GET .../practice/prompt` (for the user to copy) after personal details are removed, but **never** in a session's stored `prompt_used`, in an event or in a log line (`prompt_inputs.jobDescriptionIncluded` records only that it was used).
- **Personal details.** Prompts are built with the shared allowlist builder, with the user's email, its local part and name tokens as known identifiers. If something personal survives, the answer is 422 `pii_blocked`.

## Prompt

`GET /tasks/:taskId/practice/prompt` returns `{ persona, prompt, inputs, feedbackFormat }`. 422 when the task is not a practice. `inputs` says what was used, with no extra text:

- `nextFocus` / `nextFocusFrom`: the `next_focus` of the **newest finished session of the same kind in this plan that left a non-empty one**, and that session's id. Free-text feedback has no next focus, so it is skipped; an abandoned or active session never counts; another kind never contributes. A task without a `practiceKind` has the kind `general`.
- `topics`: titles of the **other** tasks the user logged time on in the last 7 plan-local days (today and the six before), newest first, at most 10. (Skill ids are not on tasks, so none are sent.)
- `jobDescriptionIncluded`, `redactions` (how many personal details were removed).

## Sessions

- **Create.** Idempotent on the client's `id`: the same id with the same task and channel answers 200 with the stored session; the same id for anything else is 409. A second **active** session on a task is 409 with code `practice_session_active` and the existing id in the message. Two simultaneous starts are serialised by the plan row lock, so exactly one wins. Writes `practice.started`. `planned_minutes` is the task estimate in minutes. The stored prompt is the one **without** the job description.
- **Abandon.** Active to `abandoned`, `ended_at` set, nothing else changes, no event. Repeating it is 200. A finished session is 409.

## Finishing: order and idempotency

A session finishes **exactly once**, through whichever of `feedback` or `finish` comes first.

1. **Feedback source, decided explicitly.** Pasted feedback and a self-check never combine: `POST .../feedback` finishes the session with the pasted result (`pasted_block`, or `free_text` for text that is not a block) and carries no rubric. `POST .../finish` takes **at most one** of `rubric` (source `self_rubric`, score `10 x ticked / total` from the task's steps, or four generic steps when it has none) or `enteredScore` (a score out of `max`, normalised to 0 to 10, source `self_rubric`), or neither (no feedback row, the session still finishes, for example to log time). Sending both is 400. A `finish` after a paste is a replay (below), not a way to add a rubric.
2. **Effects, then the commit point.** The hours log (one log per session, with an id derived from the session id) and, only with `markDone`, `completeTask` run first, each through the tasks service. Then one transaction writes the feedback, sets the session `finished` and writes `practice.finished`. If the process dies between the two, the session is still active, the user retries, and the fixed log id and the idempotent `completeTask` make the repeat harmless. The log is dated the plan-local day the session **started**.
3. **Replay.** A call on an already finished session answers **200** with `replayed: true` and applies nothing, if the feedback matches what was stored (pasted: the same text; rubric or score: the same result; `finish` with no feedback matches anything) **and** `markDone` and `logHours` equal what the first call used (they are kept, as numbers and booleans only, in the `practice.finished` event). Anything else is 409. Two simultaneous identical calls give one 201 and one 200, one log and one event. A call on an abandoned session is 409.
4. **Free text.** Text without a readable `===FEEDBACK===` block is saved as `free_text` (score null, `raw` holds the text) with a normal 201 and `parsed: false`. A pasted block that parses has `parsed: true`.

## Events (never any text)

- `practice.started { sessionId, taskId, kind, channel }`
- `practice.finished { sessionId, taskId, kind, source | null, score | null, minutes, markedDone, loggedHours | null }`

`kind` is the task's practice kind. Feedback text, the job description and transcripts are never in an event. The existing `task.logged` / `task.completed` events are written by the tasks service as usual.

## History and trends

- History lists **finished** sessions only: `{ id, taskId, kind, channel, startedAt, minutes, score | null, source | null }`, newest first. `from` and `to` are plan-local dates of the day the session started. `limit` defaults to 50, at most 200.
- Trends use scored finished sessions (free text and no-feedback sessions have no score), the newest 1000 in the range, oldest first. `points` carry the plan-local date, the score and the source so the client can tell a self-check from a pasted score; `last`, `average` and `delta` come from `trendsByKind` in the shared package.

## Data

Tables `practice_contexts`, `practice_sessions`, `practice_messages`, `practice_feedback` (migration 0009) are covered by the account export and by account deletion (checked by `accounts.test.ts`), and by the row-level-security tests in `packages/db`.

## Not tested here / follow-ups

- The chat (messages, provider fallback, JSON feedback) is the next package; `messages` is always empty today.
- The briefing still shows the raw `promptTemplate`; the dynamic prompt reaches it in its own package.
