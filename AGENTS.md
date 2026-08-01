# AGENTS.md

Operating rules for any AI agent (Claude or otherwise) making changes to this repository. Read this before proposing or applying any edit to `index.html`.

## 1. Patch format is mandatory: Auto-Patcher V13

This project delivers all code changes through a custom Auto-Patcher tool, not raw diffs or full-file pastes. Every patch must be a single continuous markdown block using:

```
---FIND---
<4-6 lines of exact, verbatim surrounding context>
---REPLACE---
<the replacement, with all unchanged context lines reproduced verbatim>
---END---
```

Hard requirements:
- **4–6 lines of exact context on both sides** of the change — not more, not less, and not paraphrased.
- **No ellipses, no `// ...`, no truncation** anywhere in a FIND or REPLACE block.
- **REPLACE must mirror every context line verbatim** — if a context line is reproduced with even whitespace differences, the patch will not apply.
- **One continuous markdown block** — do not split a single logical change across multiple patch blocks, and do not interleave prose inside the block.

If you cannot produce a patch in this exact format, say so explicitly rather than approximating it. A patch that "looks right" but breaks format is worse than no patch, because it fails silently against the actual tool.

## 2. This is one file, one shared scope

There is no module system. Before adding a function, constant, or global, grep `index.html` for the name first — collisions are a real risk (668+ top-level function-like declarations already exist as of this writing). Prefer extending an existing system (the tunable parameter registry, the tracker, the confidence model) over introducing a parallel one.

## 3. Comment convention — follow it

Changes in this codebase are tagged inline, in-place, explaining *why*, not just *what*:

- `// AUDIT FIX: ...` — a bug fix, with a one-line explanation of what was wrong.
- `// AUDIT REMOVAL: ...` — code deliberately deleted, with a note on why and what depended on it.
- `// AUDIT SIMPLIFICATION: ...` — behavior intentionally reduced/simplified, with the old behavior noted.
- `// PHASE N CLEANUP: ...` — part of a named, multi-step cleanup effort.

These tags are load-bearing documentation — they're how this single-developer project tracks its own history without a changelog. When you fix or remove something, tag it the same way. Don't strip existing AUDIT/PHASE comments when patching nearby code; they're intentional, not clutter, unless you were explicitly asked to remove all comments.

## 4. Test before claiming something works

Two self-contained test harnesses live at the end of `index.html` (last ~1,100 lines, after the final `<script>` tag around line 21100):

- An integration-pipeline test suite (`return { run }`).
- `window.REGRESSION_TEST_SUITE` — runs named scenarios (`SCENARIOS` array) through the real engine, diffs projection/confidence output against a stored golden baseline (`BB_REGRESSION_GOLDEN` in localStorage) within a fixed tolerance (`TOLERANCE = 0.15`), and reports pass/fail with `resetGolden()` available to intentionally rebase.

Run `window.REGRESSION_TEST_SUITE.run()` in the browser console after any change to projection, confidence, or weighting logic. A silent projection drift is exactly the failure mode this suite exists to catch — don't skip it because the change "looks isolated."

## 5. Debugging tools already in the file

- `AFDB` — an in-memory debug log buffer with level filtering (BOOT/NET/FETCH/FILL/PICK/H2H/SUCCESS/WARN/ERROR/INFO), capped at 600 entries.
- `ENGINE_INTEGRITY_SHIELD.audit()` — a startup self-check for missing globals (`MODEL_CONFIG`, `getDynamicWeights`, etc.) and expected fingerprints.
- `window.__LAST_AUDIT_STATE` — holds the most recent full projection/confidence build, used by the regression harness's `extractSnapshot()`.
- `spawnFatalTerminal(msg, file, line, col, stack)` — a visible fatal-error UI, not just a console throw.

Use these before adding new ad hoc `console.log` debugging — the logging and audit-state infrastructure already exists.

## 6. Don't reintroduce deleted systems

A "Massacre Framework" (blowout/streak scoring) and a dual-engine A/B comparison framework were deliberately removed. Vestigial names survive in a few places (`g_massacreFetchContext`, `lockStrength`) that are unrelated to the deleted scoring logic — don't assume their presence means the framework is still active. If a task references either by name, confirm with the person first rather than assuming it should be restored or that it still exists.

## 7. Storage

Persisted state goes to `localStorage` under `BB_*`-prefixed keys. `indexedDB` appears only as an environment capability check, not as a storage backend — don't write new persistence code against IndexedDB expecting existing state to be there.

## 8. Keep documentation in sync

If a change makes anything in `CLAUDE.md` or `docs/` inaccurate, update it in the same patch cycle. Stale docs in this repo have already caused at least one documented case of an AI assistant working from an incorrect premise (see `docs/roadmap-and-open-issues.md`) — don't add to that.
