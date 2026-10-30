# 001 – Dynamic scheduling as pure functions

**Status:** Accepted · built in `packages/shared/src/scheduling`

## Context
A study plan breaks on day two: something takes longer, an event appears, the user changes their hours. A fixed timetable ("on day X do Y") has to be rewritten by hand each time. The plan has to adapt, and the user has to be able to trust what changed.

## Options
1. **Fixed timetable** edited by hand. Simple, but every change is manual.
2. **Rescheduling inside the database or API handlers.** Hard to test; logic spreads across the code.
3. **A pure scheduling function** that takes the tasks, the weekly pattern, overrides and busy events, and returns the whole schedule.

## Decision
Option 3. The plan is an ordered task list with hour estimates and dependencies; each day has a capacity. `schedule()` is a pure function in `packages/shared`: no I/O, no clock, same input gives the same output. Every change triggers a reschedule from today onward. Past days never change (they are passed in as frozen blocks). Dates are local dates and times are minutes since midnight, so time zones and daylight saving only matter at the edges (exports and the calendar).

## Consequences
- The engine is tested directly: the scheduling and time-settings acceptance cases, property-based tests over random plans (blocks stay inside the window, never overlap, never exceed capacity, respect dependencies), and a performance check.
- The same code runs in the API, the web app and the in-browser demo.
- Reviews of the engine found real bugs (a block running past midnight, pinned tasks ignoring capacity); each got a test that fails without the fix.
- Tasks are taken in order, but a later task may use time an earlier one cannot fit into. This favours a full day over strict order; it is covered by tests and documented in the package README.
