# 005 – In-browser demo with a mocked API

**Status:** Planned · built in v1.0

## Context
The project is also a portfolio piece, so anyone should be able to try it without an account. A public demo must not be able to expose real data, the real API or the free AI quota.

## Options
1. A demo account on the real backend. Risky and costs quota.
2. Screenshots only. Not interactive.
3. A separate frontend build that never calls the real backend: a mocked API (for example Mock Service Worker) serves sample data, and the scheduling engine runs in the browser.

## Decision
Option 3, deployed as its own static site with a visible "Demo – sample data" banner. The mock uses the same OpenAPI contract and shared types as the real API, and CI fails if they drift. The plan builder runs on the rule-based builder over the sample catalog. Data lives in memory and resets on every visit.

## Consequences
- The demo cannot leak anything, because it has no access to anything.
- It only stays honest if the contract check stays in CI.
