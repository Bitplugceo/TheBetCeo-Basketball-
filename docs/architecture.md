# Architecture

## Why single-file

`index.html` is the entire application: markup, CSS, and ~19,000 lines of JavaScript in one file, deployed as-is to GitHub Pages. There is no build step, bundler, or `package.json`. This is intentional — it keeps deployment to "commit, push, GitHub Pages serves it," at the cost of no module isolation and no automated bundling/minification.

## Files

| File | Role |
|---|---|
| `index.html` | Everything: UI, engine, tests (22,234 lines as of this audit) |
| `manifest.json` | PWA manifest — name "Basketball Prediction Engine", standalone display |
| `sw.js` | Service worker — cache-first app shell (`./`, `./index.html`, `manifest.json`), network-first fallback pattern, single cache version `bb-engine-v1` |
| icon `.jpeg` | 192×192 / 512×512 app icon, referenced from both manifest and `<link rel="icon">` |

No `.github/workflows` in the current tree — there is no CI running against this repo right now.

## The 5 `<script>` blocks

In document order:

1. **Head placeholder** (~line 9) — empty.
2. **Service worker registration** (~line 21) — registers `sw.js` if supported.
3. **Watchdog IIFE** (~line 3012) — sets `window.__BETCEO_WATCHDOG_LOADED`, loads before the main engine specifically to detect boot failures in the block that follows.
4. **Main engine** (~line 3101 → ~21100) — ~18,000 lines. Everything from Sofascore/ESPN parsing through projection math, confidence grading, the tunable-parameter system, the tracker, and UI event wiring lives here, in one shared top-level scope. 668+ top-level function-like declarations (verify with grep — this number moves).
5. **Debug/test tooling** (~line 21100 → EOF) — `AFDB` debug buffer, an integration-pipeline test suite, and `window.REGRESSION_TEST_SUITE` (golden-baseline regression tests). See `docs/testing-debugging.md`.

## Shared global scope

Because everything is one script (functionally — block 4 is where nearly all logic lives), there's no `import`/`export` and no encapsulation beyond function scope and a handful of IIFEs (the watchdog, `AFDB`, the two test suites). Global state is mostly namespaced through:

- `AppState` — central mutable state object (239 references), including `AppState.context.data` for the current fetch/paste context.
- `window.__BETCEO_*` — boot/session flags set once at load (`__BETCEO_ENGINE_BOOT_SEEN`, `__BETCEO_SESSION_ID`, etc.).
- `window.__LAST_AUDIT_STATE` — the full snapshot of the most recent engine run (projection build, confidence build), read by both the debug UI and the regression test harness.
- `g_*`-prefixed module-level variables (e.g. `g_massacreFetchContext`, `g_injA`/`g_injB`, `g_engineDebugLog`) for state that doesn't belong on `AppState`.

There is no dependency injection — functions reach directly into these globals. When adding new state, prefer extending `AppState` or an existing `g_*` variable over introducing a new global; grep for the name first regardless.

## Persistence

Almost all persistence is `localStorage`, under `BB_*`-prefixed keys (100+ call sites): tunable parameter registry and overrides, tuner proposals, NBA core-lock flag, regression golden baselines, tracker state. `indexedDB` is checked only as a browser-capability flag inside the startup integrity audit — it is not an active storage backend. Don't assume state written today will be readable from IndexedDB tomorrow; it's in `localStorage`.

## Coverage supported

116 leagues are selectable in the UI (`<option value="...">` count as of this audit), spanning NBA/WNBA/NCAA/G-League/Summer League plus 100+ international men's and women's leagues. See `docs/data-flow.md` for how each league's data gets into the engine.
