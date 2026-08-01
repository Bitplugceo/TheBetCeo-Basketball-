# CLAUDE.md

This file orients any Claude (or other AI assistant) working in this repository. It is verified against the live codebase, not written from memory or assumption. Where something below turns out to be wrong, fix this file — don't just route around it.

## What this repository is

A single-page basketball betting prediction engine, deployed as a static site via GitHub Pages. It projects final scores, half/quarter totals, and win probabilities for basketball games across 116 leagues (NBA, WNBA, NCAA M/W, G-League, Summer League, and 100+ international leagues), and grades picks with a confidence score.

There is no build step, no bundler, and no package.json. The entire application — markup, styles, and ~19,000 lines of JavaScript — lives in one file: `index.html`. This is a deliberate architectural constraint, not technical debt: it keeps the app a single deployable artifact with zero build tooling, at the cost of everything living in one namespace.

## Repo layout

```
index.html      — the entire app: UI + engine + tests (~22,200 lines)
manifest.json   — PWA manifest ("Basketball Prediction Engine")
sw.js           — service worker: cache-first app shell, network fallback
<jpeg>           — app icon (192/512 referenced from the same file)
```

There is no `.github/workflows` directory in the current tree. If you're expecting CI (file-size canaries, script-tag balance checks), it isn't there right now — treat any reference to it elsewhere as historical, not current.

## The five `<script>` blocks, in order

`index.html` has 5 `<script>` tags (verify with `grep -c '<script'` before trusting this — it changes):

1. **~line 9** — empty placeholder tag in `<head>`.
2. **~line 21** — service worker registration only.
3. **~line 3012** — watchdog IIFE (`window.__BETCEO_WATCHDOG_LOADED`), loads before the engine to catch boot failures.
4. **~line 3101 → ~21100** — the main engine. This is the bulk of the file: ~18,000 lines, 668+ function declarations. Sofascore/ESPN parsing, the projection engine, confidence model, tunable-parameter system, tracker, and UI wiring all live here in one shared scope.
5. **~line 21100 → EOF** — debug/test tooling: `AFDB` (debug log buffer), an integration-pipeline test suite, and `window.REGRESSION_TEST_SUITE` (golden-baseline scenario tests).

Because it's one shared scope, there is no module system and no import/export. Naming collisions are the main real risk when adding code — grep for a function/variable name before introducing it.

## Core systems (see `docs/` for detail)

- **Prediction engine** — projects FT/H1/quarter totals per team from scored/allowed series, applies dynamic recency weighting (`getDynamicWeights`), H2H series, and injury/opponent-boost adjustments, then derives edges against the market line.
- **Confidence model** — `getConfidenceGrade()`, a logistic win-probability model (not a heuristic scorer — that was replaced).
- **Tunable parameter system** — `TUNABLE_PARAM_REGISTRY`, per-league overrides, and a coordinate-ascent tuner (`runCoordinateAscentTuner`) with out-of-sample gating, wired to fire every 25 settled picks.
- **Tracker** — records settled picks, feeds the tuner, persists to `localStorage`.
- **Auto-fetch** — ESPN API for NBA/WNBA/NCAA/G-League/Summer League; Sofascore via manual paste-and-parse for everything else (116 leagues total).

Read `docs/prediction-engine.md` before touching projection or confidence logic — several past bugs (double recency weighting, volatility cap inconsistencies, projection/confidence arbitration) were subtle and are documented there with their fixes so they aren't reintroduced.

## Storage

Almost everything persists to `localStorage` (100+ call sites) under `BB_*`-prefixed keys — tunable overrides, tuner proposals, tracker state, NBA core-lock flag. `indexedDB` is referenced only as an environment capability check inside the integrity shield, not as an actual storage backend — don't assume IndexedDB is where state lives.

## Before you patch anything

This project uses a strict patch format (Auto-Patcher V13). See `AGENTS.md` for the exact format — it is not optional, and free-form diffs or full-file rewrites will not be accepted as patches.

## Known drift between old notes and current code

A prior "Massacre Framework" (blowout-detection scoring) was deliberately deleted in a cleanup phase; only vestigial names survive (e.g. `g_massacreFetchContext` is now just a fetch-context object, unrelated to scoring). A prior dual-engine A/B comparison framework is also gone. If you see either referenced in old docs, discussions, or comments, treat it as historical — verify current behavior against the code, not against what it used to do. This is exactly the kind of drift this documentation set exists to prevent; keep it updated as the code changes.

## Maintaining this file

This is a single-file, single-developer, fast-iterating project (2,300+ commits since Feb 2026, commits daily). CLAUDE.md and `docs/` will drift from the code quickly if not re-checked. Before relying on a specific claim here for anything consequential, grep the current file to confirm it's still true.
