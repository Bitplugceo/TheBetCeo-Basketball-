# Roadmap & Open Issues

## Why this file exists

This project has been worked on across many separate AI assistant sessions without a persistent local checkout, which means prior "state of the project" notes can silently go stale. This file exists to record that explicitly, so the next session doesn't repeat a fixed bug or assume a removed system is still active.

## Confirmed drift found in this audit (Aug 2026)

These were previously recorded as current facts about the project. Direct inspection of the live repo (22,234-line `index.html`, 2,329 commits) showed otherwise:

| Previously recorded | Actual current state |
|---|---|
| "Massacre Framework" is a long-term foundation | Deliberately deleted (Phase 1 / streak-chasing removal). Only vestigial names remain (`g_massacreFetchContext`, `lockStrength`), attached to unrelated live systems. |
| Dual-engine A/B comparison framework, `simpleAverage()` Engine B | Not present in current code at all. |
| Golden-output regression harness (`GOLDEN_OUTPUT_TESTS`) | Present, but renamed/restructured to `window.REGRESSION_TEST_SUITE`. Functionally the same idea (scenario snapshots vs. a stored golden baseline, tolerance-based diff), different name and storage key (`BB_REGRESSION_GOLDEN`). |
| GitHub Actions CI (file-size canary, script-tag balance check) | No `.github/workflows` directory exists in the current repo. |
| H2H series recency alignment unresolved — no date data flows into `getMassacreH2HSeries` | Current implementation sorts `h2hGames` by `g.date` before slicing to the recency window — date data does flow in now. (Not independently verified: whether every `h2hGames` entry reliably has `date` populated end-to-end from both the ESPN and Sofascore paths.) |

**Takeaway:** treat any documentation, including this doc set, as a snapshot that needs re-verification against the code before being relied on for anything consequential — especially after a gap of weeks between sessions on a project that commits daily.

## Open threads (as of last recorded discussion — verify before acting)

- Adding basketball leagues visible in a sportsbook screenshot, using existing FIBA competition configs as a template. Not verified against current code in this audit — confirm which leagues (if any) from that list are already present among the 116 current `<option>` entries before adding duplicates.
- League edge-point thresholds were restructured across four tiers plus Summer League — current tier boundaries not re-verified in this audit; check `getLeagueTrustMeta()` / wherever tier thresholds are defined before assuming the four-tier structure is still exactly as last described.
- A recency-index alignment bug affecting scored/allowed series was "partially fixed" for H1 and quarters in a prior session — whether it's now fully resolved across all markets wasn't re-verified here.

## Suggested next documentation passes

Not yet written, in priority order:

1. `docs/configuration.md` — full catalog of `TUNABLE_PARAM_REGISTRY` entries, tunable constants, and league-tier thresholds (this requires walking the full registry, which is long — deliberately deferred rather than done partially).
2. `docs/testing-debugging.md` — dedicated deep dive on `AFDB`, `ENGINE_INTEGRITY_SHIELD`, the integration test suite, and `REGRESSION_TEST_SUITE`'s `SCENARIOS` list (currently only summarized in `AGENTS.md` and `docs/architecture.md`).
3. `README_AI.md` — a short orientation pointer file, once the above stabilizes.
4. Re-verification of the three "open threads" above against current code.
