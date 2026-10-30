# 002 – Minimal calendar scopes and a write guard

**Status:** Planned · built with the calendar feature (v0.6)

## Context
Syncing study blocks to Google Calendar is useful, but a bug that edits or deletes someone's real events would destroy trust.

## Options
1. Full `calendar` scope. Simple, and far too powerful.
2. Minimal scopes, with writes allowed anywhere those scopes reach.
3. Minimal scopes **plus** a single code path that refuses any write to an event the app did not create.

## Decision
Option 3. Scopes are `calendar.app.created` and `calendar.readonly` only. The app writes only to its own secondary calendar ("Skillstack"; "Skillstack (R&D)" in R&D), and every write goes through one function that checks the event is in that calendar and tagged as the app's own (`extendedProperties.private`), otherwise it throws. The guard lives above the `CalendarProvider` interface, so it applies to every future provider. Other events are read-only and count as busy only when accepted and marked busy.

## Consequences
- A unit test proves a write to a foreign event throws.
- If the user moves a study block in Google Calendar, the new time is kept and the rest is rescheduled around it.
- The app never depends on the calendar being reachable; a rejected token shows a "Reconnect calendar" banner.
