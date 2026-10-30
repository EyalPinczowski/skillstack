# 008 – Visual design: the "Blocks" direction and logo A

**Status:** Accepted · tokens and shell built in `apps/web`

## Context
A daily tool needs to be calm, readable and accessible (target WCAG 2.2 AA), and it should not look generic or machine-made.

## Options
Three directions were prototyped and compared with measured contrast: **Calm planner** (warm neutrals, teal), **Blocks** (indigo, a colour and icon per task type, a very readable typeface) and **Focus** (dark first, amber). Six logo variations of an "S" made of blocks were compared with logo A (three rising blocks).

## Decision
**Blocks** with **logo A**. Atkinson Hyperlegible is self-hosted (no font requests to third parties). Each task type has its own colour **and** icon and label, used the same way in task lists, plans and the calendar, so state never depends on colour alone. Light and dark themes follow the device setting, with a manual override. Craft rules: no gradients or glass effects, no decorative emoji, no cards inside cards, a 3 px focus ring with a 2 px offset, 44 px touch targets, reduced motion respected.

## Consequences
- Every text and background pair used is checked against 4.5:1 contrast.
- The "R&D environment" badge uses an icon and text, so the two environments cannot be confused.
- No design plugin is used; the craft rules are checked in code review.
