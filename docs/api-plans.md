# Plans and schedule API (v1)

Base path `/api/v1`. Every route needs `Authorization: Bearer <Supabase access token>`. The user is the token's `sub`; a `user_id` in a body, query or header is never read. A plan that belongs to someone else answers exactly like one that does not exist (404). All errors have one shape: `{ "error": { "code", "message", "requestId" } }`. The live contract is `GET /api/v1/openapi.json` (UI at `/api/v1/docs`).

| Method and path                       | What it does                                                                   | Success | Errors                  |
| ------------------------------------- | ------------------------------------------------------------------------------ | ------- | ----------------------- |
| `POST /plans/import`                  | Import a plan file (see below)                                                 | 201/200 | 400, 409, 413, 422      |
| `GET /plans`                          | Own plans as summaries (`taskCount`, `summary`)                                | 200     |                         |
| `GET /plans/:id`                      | Plan with `weekPattern`, `overrides`, `tasks`                                  | 200     | 400, 404                |
| `DELETE /plans/:id`                   | Delete the plan and everything it owns (tasks, logs, events, ...)              | 204     | 400, 404                |
| `PUT /plans/:id/week-pattern`         | Replace the weekly time settings (shared `WeekPatternSchema`, spec 3.7)        | 200     | 400, 404                |
| `PUT /plans/:id/day-overrides/:date`  | Set the exception for one date `{ isStudyDay, capacityHours? }` (max 1000)     | 200     | 400, 404, 422           |
| `DELETE /plans/:id/day-overrides/:date` | Remove it; succeeds when there is none                                       | 204     | 400, 404                |
| `GET /plans/:id/schedule?today=`      | Run the shared engine: `blocks`, `warnings`, `finishDate`. `today` defaults to the date in the plan's time zone | 200 | 400, 404, 422 |
| `POST /plans/:id/schedule/preview`    | `{ today?, pattern?, overrides?, removeOverrideDates? }` returns the change summary text and the proposed schedule. **Saves nothing.** | 200 | 400, 404, 422 |

## Import

Body: a plan file (`formatVersion: 1`, shared `PlanFileSchema`) plus

- `id`: a UUID the client generates. This is the idempotency key.
- `status`: optional, `draft` or `active` (default `active`).

The plan, week pattern, day overrides, tasks and a `plan.imported` event are written in one transaction. Sending the same `id` and content again returns **200** with the stored plan and creates nothing; the same `id` with different content returns **409**. Content is compared with a hash recorded in the `plan.imported` event, so a retry still returns 200 after the plan was edited. Limits: body 512 KiB (413), 500 tasks and 1000 overrides (422). Invalid plans (unknown time zone, duplicate task ids, unknown dependencies, blank names, end before start, duplicate override dates) answer 422 with the field paths in `message`.

## Notes

- The schedule uses the stored tasks only. CV-update tasks appear once the tasks module creates them (they are not projected here).
- Plan changes are suggestions until the user approves them: the UI previews with `schedule/preview` and then saves with the PUT endpoints.
- Tests: `apps/api/test/plans.test.ts` (real Postgres, see `packages/db/README.md` for the throwaway cluster).
