# Contributing

Skillstack is developed in the open. The history is part of the project, so please keep it tidy.

## Branches

| Branch | Purpose |
|---|---|
| `main` | Operational – the version in daily use. Never commit directly. |
| `rnd` | R&D – where features are built and tested. Never commit directly. |
| `feature/<area>-<name>` | One feature, created from `rnd`. Area is one of `api`, `web`, `shared`, `infra`, `catalog`, `demo`. |
| `fix/<name>` | A bug found on R&D, from `rnd` back into `rnd`. |
| `hotfix/<name>` | An urgent bug on Operational: from `main`, merged into `main`, then merged back into `rnd`. |

```
feature/<area>-<name> ──PR──▶ rnd ──release PR──▶ main
                               ▲                    │
                               └─── merge back ─────┘ (after hotfixes)
```

## Merging

- **Feature and fix PRs into `rnd`:** squash merge, once CI is green. The squash commit is one Conventional Commit whose body is the PR summary.
- **Release PRs `rnd` → `main`, and hotfix merge-backs:** merge commit (no squash), so the branches never diverge. Releases carry a version tag (`v0.1`, `v0.2`, …) and release notes. The owner approves and merges every release.

## Commits and pull requests

- [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`.
- A PR describes what changed, why, how to test it, and includes a screenshot for UI changes. It links its issue ("Closes #n").
- CI must pass: lint, type-check and tests for each of `web`, `api` and `shared`.

## Ready to release

- CI is green and the relevant acceptance tests from the spec pass.
- It has run on the R&D environment and been tried there.
- Database migrations are backward compatible (additive) and have run on the `rnd` schema first.
- Anything unfinished stays behind a feature flag that is off.
- Release notes are written.

## Rules

- **No secrets in the repo.** `.env.example` holds names only. Secret scanning runs in CI.
- **No invented facts** in catalog data or docs: unverified links and prices are marked "needs check".
- Don't build anything listed as deferred in `docs/SPEC.md` section 12.1; the seams in 12.3 are the only preparation.
