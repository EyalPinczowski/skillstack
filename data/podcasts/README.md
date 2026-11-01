# Podcast suggestions

A small, curated, versioned list behind the "Idea of the day" line in the day briefing. Source of truth for the shape: `packages/shared/src/podcasts.ts`.

## Rules

- These shows are about the **ideas around** a skill. They do not teach it. Never add a how-to or exam-prep show.
- Only entries whose Spotify show link and official page were both verified are listed. Each entry's links were opened or taken from the show's official page on its `checked_on` date.
- Price and free status are **unverified** unless an entry says otherwise. `free` is `unverified` for every entry today. The app never says a show is free.
- Never invent or edit a URL, description or claim. Copy them from the show's official page, and re-check before changing `checked_on`.
- `spotify_url` must be an `https://open.spotify.com/show/...` link. `skills` must be ids from `data/catalog/skills.json`. `id` is unique.
- A suggestion is a briefing line only. It is not a task, is not counted as study time and never changes the plan.
- Bump `version` and `updated` when the list changes. Skills with no entry simply get no podcast line.
