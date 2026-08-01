# TheBetCeo Basketball v2

A single-page basketball prediction engine — projects final scores, half/quarter totals, and win probabilities across 116 basketball leagues, and grades each pick with a confidence score.

**Live:** https://bitplugceo.github.io/TheBetCeo-Basketball-v2/

## What it does

- Pulls team data automatically (ESPN) for NBA, WNBA, NCAA men's/women's, G-League, and Summer League.
- For everything else — 100+ international men's and women's leagues — paste Sofascore data in and the engine parses it.
- Projects full-time, first-half, and quarter totals from recency-weighted scoring/allowed series, blended with head-to-head history, injury/opponent adjustments, and pace/advanced-stat signals.
- Grades every pick's confidence with a logistic win-probability model.
- Learns over time: settled picks feed a coordinate-ascent tuner that re-calibrates model parameters every 25 results, gated on out-of-sample performance so it can't overfit to noise.

## Architecture

The entire app — UI, engine, and tests — lives in one file, `index.html` (~22K lines). No build step, no bundler, no dependencies. That's a deliberate tradeoff: the whole thing is one deployable artifact that GitHub Pages serves as-is.

Also in the repo:
- `manifest.json`, `sw.js` — PWA manifest and service worker, so it installs and works offline-ish.
- `CLAUDE.md`, `AGENTS.md` — orientation and operating rules for AI coding assistants working in this repo.
- `docs/` — deeper documentation: architecture, data flow, and the prediction engine's internals (confidence formula, tunable parameters, calibration loop).

If you're an AI assistant reading this repo for the first time, start with `CLAUDE.md`.

## Status

Actively developed — commits land most days. `docs/roadmap-and-open-issues.md` tracks known gaps and open threads.

## License

No license file yet — all rights reserved by default until one is added.
