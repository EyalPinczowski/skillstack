# Extending Skillstack

Each extension point is meant to be **one new file plus a config entry, with no change to the core**. This guide is filled in as the interfaces are built (see `docs/decisions/`); until then it records the intended shape.

| Extension | Interface | Where | Status |
|---|---|---|---|
| A new calendar | `CalendarProvider` | `apps/api/src/modules/calendar` | Planned (v0.6) |
| A new AI model provider | `AIProvider` | `apps/api/src/modules/practice` | Planned (v0.3) |
| A new notification channel | `NotificationChannel` | `apps/api/src/modules/notifications` | Planned |
| A progress importer | `ProgressSource` | `apps/api/src/modules/progress` | Planned |
| A data exporter | `Exporter` | `apps/api/src/modules/export` | Planned |

## Rules every extension follows

- The calendar write guard sits above `CalendarProvider`, so a new provider cannot write to events the app did not create.
- An `AIProvider` declares `costTier`; paid providers are refused unless the owner enables them with a spending cap.
- No personal details (name, email, phone, links) are sent to a model.
- New features ship behind a feature flag (all off by default).
- Business logic stays in the API and in `packages/shared`; the web app only renders what the API returns.
