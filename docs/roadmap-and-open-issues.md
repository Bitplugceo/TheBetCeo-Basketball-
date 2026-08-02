BB Engine — Full-Parameter Backtest Roadmap

======================================================================
CURRENT STATUS
======================================================================
This section is the project's dashboard — read it first. Any AI or
person opening this file should be able to tell where the BB Engine
stands without reading the phase sections below. See "Maintenance
instructions" at the bottom of this section for the rule that keeps it
that way.

## Overall Progress
Phases fully verified complete: 3 of 10 (Phase 0, 1, 2)
Phases partially complete: 2 of 10 (Phase 3 is functionally complete but
superseded mid-build — see note below; Phase 4 has a real, safe search
loop running but deviates from the original spec's statistical method)
Phases not started: 5 of 10 (5, 6, 7, 8, 9, 10)
Rough completion: ~35-40% — a phase-count fraction, not a precision
metric. Phases vary hugely in size (4-6 are the actual search/lock loop;
9 is one button). Treat this as "more than a third of the way to a
working one-button sweep," not as a literal percentage of engineering
effort.
Status: 🟡 IN PROGRESS

## Active Work
Current Phase: Phase 4 — Grouped search. First real in-browser run
completed (1,231 games, 2025 season) and surfaced a real bug — see
"REAL BUG FOUND AND FIXED THIS SESSION" in Phase 4 below. Fixed, not
yet re-verified against real data.
Current Task: Get a fresh in-browser "Run Season Backtest" click
post-fix and confirm the numbers look plausible (smaller, more
believable baseline-vs-candidate gap; any group marked adopted:true
actually shows up in proposedDiff).
Next Task: Once that's confirmed, decide whether Phase 4's
Accuracy-Score-based gate (flat threshold + overfitting guard) is the
final design, or whether real statistical significance testing should
be layered on before Phase 5 (multi-pass re-validation) is built on top
of it.

## Verification Status
Phase 0 — Inventory:                        🟢 Substantively complete
Phase 1 — Fatigue/quarter-anchor tunable:    🟢 Complete
Phase 2 — True three-way split:              🟢 Complete
Phase 3 — Feature cache:                     🟢 Complete (rebuilt once — see note)
Phase 4 — Grouped search:                    🟡 Partially complete
Phase 5 — Cross-group re-validation loop:    🔴 Not started
Phase 6 — Final gate before lock:            🔴 Not started
Phase 7 — Per market/league breadth:         🔴 Not started
Phase 8 — Lock registry with paper trail:    🔴 Not started
Phase 9 — One button, one report:            🔴 Not started
Phase 10 — Time budget reality check:        🔴 Not started

Related, outside the roadmap phases:
Fatigue live-wiring (see Phase 1 note below): 🟢 Done, reviewed, default-safe

Note on Phase 3: two different sessions independently built a
buildBacktestFeatureCache during overlapping work — the version
documented below is the one that's actually in the code (built directly
against the repo, includes restDays and integrates with the fatigue
live-wiring and Phase 4). An earlier session's alternate implementation
(async, self-fetching, deliberately excluded restDays) was reconciled
away in favor of this one. See "Recent Changes" below and Phase 3's
section for why.

## Current Best Configuration
No sweep has been run against real season data yet. Phase 4's search
code exists and passed a synthetic-data smoke test (control flow,
safety guarantees), but "Current Best Configuration" only becomes
meaningful once someone clicks "Run Season Backtest" in-browser and
report.groupedSearch comes back with a real bestBundle. Until then:

Validation Accuracy (baseline, live config): Not yet measured against
  real data in this session — the season backtest has an existing
  accuracyScore/validationAccuracyScore field (Phase 2 infrastructure),
  but no one has read it off a real run recently enough to record here.
Best Challenger Found: None yet
Calibration Score: —
Paper Lock: Not available (Phase 8 doesn't exist yet)

## Parameter Sweep Status
Parameters Registered: 33 (TUNABLE_PARAM_REGISTRY, counted directly
  from the code this session)
Parameters Locked: 0 (Phase 8's unified lock registry doesn't exist yet;
  storeVerifiedConfig/logPromotionEvent/the NBA-core lock flag are
  pre-existing building blocks for it, not the thing itself)
Parameters Remaining: 33
Current Sweep: Not running (Phase 4's search runs synchronously inside
  every season-backtest call, not as a separate long-running sweep —
  Phase 9's "one button" is what will make this feel like a distinct
  "sweep" the way this section implies)
Last Successful Sweep: None recorded against real data

## Recent Changes
This session (see commit history for exact diffs):
- Verified Phases 0-2 against the actual code (not just in-file claims)
- Found that a concurrent session (same user, different tool/session)
  had independently pushed a different Phase 3 implementation, plus a
  working Phase 4 grouped-search loop, directly to the repo
- Reconciled: adopted the concurrent session's Phase 3/4 implementation
  as the base (more complete, already integrated with a related live
  fatigue-wiring change)
- Reviewed the live fatigue-wiring change for safety (confirmed it
  no-ops unless a team is on a real back-to-back — see Phase 1 note)
- Reviewed Phase 4's grouped search for safety (confirmed: never writes
  live values, never reads the test split, correctly restores the
  temporary getParam override after every candidate, has a train-val
  overfitting guard)
- Found and fixed a stray leading "A" character before <!DOCTYPE html>
  (harmless in practice, not valid HTML — introduced and accidentally
  reintroduced across the concurrent session's commits)
- Ran a synthetic-data smoke test of the reconciled
  buildBacktestFeatureCache / evaluateFeatureCacheWithOverrides /
  runGroupedParamSearchPhase4 chain (see Phase 3/4 "Verification
  performed" below)
- Rewrote this Current Status dashboard and the per-phase notes below

Follow-up, same engagement, after a real in-browser run:
- User ran "Run Season Backtest" for real (1,231 games, 2025 season,
  78 skipped) — first real-data execution of Phase 3/4
- Result showed report.groupedSearch.proposedDiff was empty ({}) despite
  improved:true and groupsAdopted:["A_H2H"] — a contradiction worth
  investigating rather than accepting
- Traced it to a real bug: evaluateFeatureCacheWithOverrides never
  cleared AppState.context.data before evaluating candidates, so every
  game during Phase 4's search picked up one stale matchup's real venue
  data (via getFetchedSeries, which reads AppState.context.data
  directly) instead of its own — a constant, config-independent
  distortion. Full reasoning in Phase 4's section below.
- Fixed: added the same AppState.context.data reset
  runNbaSeasonBacktest's own loop already does. Verified the fix doesn't
  break control flow (updated smoke test); did not yet verify the fix's
  actual effect on real numbers — needs a fresh real run.
- The 51.0 → 59.3 result and the A_H2H adoption from that first run are
  flagged as untrustworthy — likely measuring the leaked venue data, not
  a real H2H effect

## Pending Work
Next Milestone: get a real in-browser season-backtest run recorded (see
"Active Work" above), then either extend Phase 4 or move to Phase 5's
multi-pass loop, depending on what that run shows.

## Last Updated
Date: 2026-08-02
Commit: (see repository log — this doc is committed alongside the code
  changes described above; check `git log -- docs/roadmap-and-open-issues.md`
  for the exact hash once pushed)
Author: Claude (Anthropic), reconciling with Bitplugceo's own concurrent
  session

## Maintenance instructions
This file is the project's permanent state file — the single source of
truth for where the BB Engine stands. Any AI picking up this project
should be able to continue by reading only this file, starting with
this Current Status section.

Rules for keeping it that way:
- At the start of a session, read this section first, then verify only
  what you're about to change — don't re-audit phases this doc already
  marks verified unless you have a specific reason to distrust them
  (code changed since, or something looks stale).
- Before making code changes, check whether another session has pushed
  changes since this doc was last updated (git fetch + compare) — this
  session hit exactly that situation; it's not hypothetical.
- After any completed or partially-completed phase work, update: Overall
  Progress, Active Work, the Verification Status table, Parameter Sweep
  Status, Recent Changes, Pending Work, and Last Updated (with a real
  commit hash once the work is committed).
- After every sweep that actually runs against real data (once Phase 4+
  produces one), record it under "Engine Configuration History" below —
  what changed, what it beat, by how much, and whether it was adopted.
  This doc doesn't auto-update itself; whoever runs or reviews a sweep
  is responsible for writing the entry.
- Don't remove phase detail to make this section shorter. Add status
  annotations and notes; the original phase write-ups stay as the
  historical record of intent.

======================================================================
Engine Configuration History
======================================================================
This section tracks what's actually locked in the live engine over
time, once Phase 8 exists to write to it. Until then it's empty by
design — populating it before a real lock decision would be fabricating
a paper trail for something that hasn't happened.

## Current Production Configuration
Status: Unlocked (no parameter has ever been through the full Phase
  0-6 pipeline and locked)
Backtest Accuracy: —
Calibration: —
Markets Passing: —
Sample Size: —

## Locked Parameters
(None)

## Recent Parameter Changes
(None via the roadmap's lock pipeline. Note: fatigueB2BPenalty's
*consumption* changed this session — see Phase 1 note — but its
*value* is still the original hardcoded default, -2.5. Wiring a
parameter's live effect is not the same as locking a new value for it;
this entry format is reserved for the latter.)

## Rollback Point
None (nothing has been locked, so there's nothing to roll back from)

## Entry format, for whoever writes the first real one:
  Parameter: <name>
  Old value: <value> → New value: <value>
  Validation delta: <+/-X.X% or points, whatever Phase 4/6 reports>
  Calibration delta: <same>
  Sample size: <games/picks>
  Status: LOCKED | REJECTED | ROLLED BACK
  Date, commit hash

======================================================================

Goal: one orchestrated run (10–20 min) that sweeps every parameter driving a 
projection, across every market, finds the configuration that beats the 
current live config on data it has never seen, and only then locks it — 
with a paper trail, and a way to re-challenge the lock later.

Non-goal: finding "the config that went 9/10." Ten games is not a sample 
size a lock decision can be based on. Every phase below exists to stop that 
from happening by accident.

Status tags: [EXISTS] = already in the code, reuse it. [GAP] = referenced 
in your description but not actually implemented yet. [NEW] = has to be 
built.

---

Phase 0 — Inventory: what actually drives a projection right now [EXISTS + GAP]

Status: ✅ Substantively complete (deliverable met via Phase 1). Two
non-urgent dead-code items remain — see below; neither blocks Phase 4+.
Re-verified this session: still true, unchanged by the concurrent
session's work.

Before touching search strategy, get an honest list of every input to a 
projection and whether it's currently tunable.

Tunable today (TUNABLE_PARAM_REGISTRY, ~28 params): H2H factor, H2H max 
weight, H2H lookback seasons, 4 H2H season-decay weights, recency weight 
vector, team-weight base (own-stats vs opponent-stats blend), venue min/strong 
game thresholds + weights, quarter-venue proxy factor, injury opponent-boost 
factor, under-edge factor, pace clamps (2 leagues groups), 3 confidence 
thresholds, volatility limit, team/quarter vol scale, 3 edge-point thresholds.

Referenced as tunable, not actually tunable yet:
- Fatigue — hardcoded −2.5 signal for back-to-backs. No weight, no 
- register entry, nothing a backtest can sweep. Confirmed real gap.
- Quarter anchor blend (applyQuarterAnchorBlendBT + its live twin) — 
- every Q1–Q4 projection gets pulled toward an H1/H2-anchored scale at a 
- hardcoded 0.7 weight (MODEL_TUNING.quarterAnchorBlendWeight). It's 
- listed in the tuner's own NBA_CORE_TUNER_KEYS — meaning someone already 
- intended this to be lockable — but it was never added to 
- TUNABLE_PARAM_REGISTRY and never read through getParam anywhere. A 
- live, high-impact quarter-market weight that the tuner believes it owns 
- but can't actually touch. Confirmed real gap.

Update: both gaps above are now closed — see Phase 1 (✅ complete).
TUNABLE_PARAM_REGISTRY now has 33 entries including fatigueB2BPenalty and
quarterAnchorBlendWeight (count re-verified this session, directly from
the code).

Correction from last message: I was wrong to call offense/defense 
blending a gap. On a closer read, advancedBlendWeight does exist and 
is a real tunable weight — but the ortg/drtg data that would feed it was 
deliberately deleted, and there's a comment dated 2026-08-01 (today) — 
BATCH 7 PERMANENT DECISION — NO PACE MODEL — recording that this was 
tested and dropped on evidence, not forgotten: the advanced path didn't 
beat the points-based projection, historical pace data isn't reliable 
enough for the backtest either, and the comment explicitly says not to 
revisit it without new multi-season pace data plus a controlled sweep 
proving a holdout gain. That's not an oversight to patch — it's a standing 
decision this roadmap should respect, not override. (Phase 3 respected
this too — the reconciled feature cache still excludes "ratings"; see
below.)

Two smaller items, dead code rather than missing features, worth a cleanup 
pass but not urgent: NBA_CORE_TUNER_KEYS also references 
"recencyStrength", which doesn't exist anywhere else in the file (stale 
reference); and MODEL_TUNING.h2hMaxWeight (0.30) is an unused duplicate — 
the real live H2H cap is the separate, correctly-wired 
h2hMaxWeight registry entry. Status: still present, still not urgent,
still not blocking anything — confirmed unchanged this session.

Deliverable: a single source-of-truth list (extend 
TUNABLE_PARAM_REGISTRY itself) so "sweep everything" has an actual 
enumerable "everything." Anything not on this list by the end of Phase 1 
does not get backtested — no shadow parameters. Status: done.

---

Phase 1 — Make fatigue and the quarter anchor weight real, tunable inputs [NEW]

Status: ✅ Complete. Verified directly against the code this session:
- fatigueB2BPenalty is registered in TUNABLE_PARAM_REGISTRY and both
  buildTotalMarketIntelSignal and buildTeamMarketIntelSignal read it via
  getParam("fatigueB2BPenalty", league) ?? -2.5.
- quarterAnchorBlendWeight is registered and read via getParam(...) ??
  0.7 in both applyQuarterAnchorBlendBT (backtest) and the live quarter
  block — same knob, same value, both places.

IMPORTANT UPDATE (found this session, not part of the original Phase 1
work, but directly relevant to it): a later, separate change — labeled
in its own comment as "FATIGUE LIVE-WIRING (reviewed change, separate
from the backtest roadmap phases)" — actually connected
fatigueB2BPenalty's output to live projections for the first time.
Before this: buildTotalMarketIntelSignal/buildTeamMarketIntelSignal were
registered and tunable (Phase 1), but their signal was never consumed —
applyDampedIntelSignal, the only function that reads it, was never
called anywhere in the live path. Confirmed dead code by both the
original Phase 1 work and independently re-confirmed this session. The
live-wiring change makes computeFTProjection actually call
applyDampedIntelSignal with the fatigue signal, for ft/team_a/team_b
only (matching the registry's appliesTo list — h1 and quarters
untouched).

This is a real behavior change to live betting projections, not just
plumbing — worth being explicit about rather than burying in a code
comment. Scope, verified this session: applyDampedIntelSignal returns
its input completely unchanged when the signal is exactly 0
(`if (!isFinite(rawSignal) || rawSignal === 0) return baseProj;`), and
buildTotalMarketIntelSignal/buildTeamMarketIntelSignal only produce a
non-zero signal when a team has under 1 day of rest — i.e., an actual
back-to-back. So this is dormant for the large majority of games and
only affects projections for teams on a real back-to-back, which is the
scenario the parameter was always meant to describe. The change is
tagged "reviewed" in its own comment, meaning whoever made it (see
Phase 3 note below — same session) treated it as a deliberate decision,
not an accident. Flagging it here so it's visible at the roadmap level,
not just in a code comment three thousand lines from this doc.

Known gap the same comment self-reports: the retrospective tuner
(evaluatePickWithParams / runCoordinateAscentTuner) does not thread a
historical restDays through config, so replays of past live picks will
use whatever AppState.context.data currently holds rather than the real
value at pick time. Explicitly deferred, not fixed — flagging here so
it doesn't get lost.

Can't backtest a blend rate that doesn't exist. Wiring only — no sweeping, 
no testing yet, exactly as agreed. Both changes are additive (getParam(key) ?? <old hardcoded value>), so live output is byte-identical until Phase 4+ 
actually promotes a different value. (The fatigue live-wiring change
above is the one exception to "byte-identical" — see note above for
why, and how bounded it is.)


- Fatigue: replace the two hardcoded signal -= 2.5 sites 
- (buildTotalMarketIntelSignal, buildTeamMarketIntelSignal) with a 
- registered fatigueB2BPenalty parameter.
- Quarter anchor: register quarterAnchorBlendWeight in 
- TUNABLE_PARAM_REGISTRY, and wire both the backtest function and the 
- live block to read it instead of the raw MODEL_TUNING constant, so 
- backtest and live are testing the same knob.
- Offense/defense: explicitly out of scope for this phase — see the 
- correction above.

Deliverable: both show up in Phase 0's registry with real ranges. 
Patches below. Status: done, confirmed present in TUNABLE_PARAM_REGISTRY.

---

Phase 2 — True three-way split, not two [EXISTS, extend]

Status: ✅ Complete. Verified in runNbaSeasonBacktest: allGames is split
chronologically into ~55% train / ~25% validation / ~20% test
(_btValidationFraction = 0.25, _btTestFraction = 0.20, both index-based
off allGames.length so the exact game counts move with the season). Every
result row is tagged split: "train" | "validation" | "test". The report
computes train/validation/test calibration and accuracy scores
separately; the overfitting-gap note compares train vs validation only.
testAccuracyScore is computed and returned for visibility, but nothing in
runNbaSeasonBacktest — or Phase 4's search (re-checked this session) —
reads results.split === "test" to filter, search, or tune against.
Confirmed again this session: Phase 4's evaluateFeatureCacheWithOverrides
takes an explicit includeTest option, hardcoded false at every call site
in the grouped search, with a comment noting it "must stay false for
Phase 4/5." That's correct — Phase 6 is still the only phase allowed to
spend the test slice, and it hasn't started.

The season backtest already does a chronological 70/30 train/holdout split 
with an overfitting-gap warning — that's real and stays. (This was true
before this phase; superseded by the 55/25/20 three-way split above.)

What's missing: a final locked-away test slice that the search process 
never touches, not even for the significance test. Right now the 
holdout is the validation set the tuner optimizes against — which means 
"validated against holdout" and "safe to lock" aren't the same claim.
(This is now built — see Status above.)

- Split: ~55% train / ~25% validation (search happens here) / ~20% final 
- test, chronological, per league.
- The final test slice gets touched exactly once, at the very end of a 
- run, right before a lock decision — never during search.

As of Phase 3, the split-boundary computation moved from inline in
runNbaSeasonBacktest into buildBacktestFeatureCache, since it's
config-independent (date-only) — same fractions, same logic, just
computed once per league/season instead of implicitly once per run.

---

Phase 3 — Precompute once, sweep in memory [NEW]

Status: ✅ Complete — but see the reconciliation note first, since this
phase was independently built twice.

RECONCILIATION NOTE: two sessions worked on this roadmap concurrently
without visibility into each other. One session (this one, initially)
built an async, self-fetching buildBacktestFeatureCache(league, season,
onProgress) that managed its own window.__bbFeatureCache and
deliberately excluded restDays as out-of-scope. A separate, concurrent
session (same user, different tool) built a synchronous
buildBacktestFeatureCache(gameLogs, allGames, splitBoundaries,
onProgress) that takes already-fetched data as arguments, includes
restDays, and — critically — is already integrated with a related live
fatigue-wiring change (Phase 1 note above) and a working Phase 4 search
loop. When reconciling, the second implementation was adopted as the
base: it's more complete, was already integrated with real downstream
consumers, and reverting it would have thrown away working Phase 4
progress. This doc now describes that version. If you're a future
session and find yet another mismatch between this doc and the code:
git fetch and diff before assuming either is stale — this has now
happened once for real, not just as a hypothetical warning.

What's actually in the code: buildBacktestFeatureCache(gameLogs,
allGames, splitBoundaries, onProgress), immediately before
runNbaSeasonBacktest. For every game, computes once:
- The 12 rolling scored/allowed windows (FT, H1, Q1-4, both sides) and
  12 H2H arrays (FT, H1, Q1-4, both sides) — the expensive,
  config-independent part (24 _btRollingWindow/_btH2HSeries calls per
  game).
- restDaysA/restDaysB, via a new _btRestDays helper — "days since last
  game, capped at 14, else 99 (unknown)," matching the same formula and
  sentinel the live restDays fetch already uses. This is what makes the
  fatigue live-wiring (Phase 1 note) actually exercisable in the
  backtest — previously undoable, since the backtest had no restDays
  source at all.
- The chronological train/validation/test split tag (Phase 2's
  boundaries, computed by the caller and passed in as
  splitBoundaries.validationStartMs/testStartMs).
Returns { features, stats } — features is an array aligned to allGames;
stats includes games/elapsedMs/gamesPerSecond/builtAt, so the 10-20 min
sweep budget is directly measurable, matching the original deliverable's
"progress readout" requirement (implemented as post-hoc stats here
rather than a live progress callback during the cache build itself,
since the loop is synchronous and fast — see Verification below for
actual measured throughput).

What's deliberately NOT cached, versus the roadmap's illustrative list
above ("raw series, H2H arrays, rest days, ratings, line"):
- "ratings" (ortg/drtg/pace) — excluded by the BATCH 7 PERMANENT DECISION
  (Phase 0). Not a gap; a standing decision this phase respects.
- "line" — the backtest has no historical market-line data; every
  computeFTProjection/compute1HProjection call still passes lines: {}
  unchanged. Caching a value nothing downstream reads would be a shadow
  feature, which Phase 0 rules out.
- "rest days" IS now cached, unlike this doc previously stated — see
  above. That earlier statement was written against the
  now-superseded implementation and was accurate for it at the time;
  it's wrong for what's actually in the code now.

Verification performed (no browser available in this session, so this
is static + synthetic-data verification, not the in-browser
window.REGRESSION_TEST_SUITE.run()):
- Whole-file syntax check (node --check) after every edit, including
  after fixing the stray leading "A" character (see Recent Changes).
- Read buildBacktestFeatureCache, evaluateFeatureCacheWithOverrides, and
  runGroupedParamSearchPhase4 in full and traced every call site.
- Confirmed the fatigue live-wiring's default-safety directly from
  applyDampedIntelSignal's source (early-returns unchanged on
  signal === 0) and buildTotalMarketIntelSignal/buildTeamMarketIntelSignal's
  source (signal only goes non-zero on restDays < 1).
- Built a synthetic 6-team/192-game season and ran the real, extracted
  buildBacktestFeatureCache / evaluateFeatureCacheWithOverrides /
  runGroupedParamSearchPhase4 functions (not stubs — the actual code
  from the file) against it in a Node vm sandbox, with only the deep
  projection math (computeFTProjection etc.) stubbed. Confirmed: cache
  builds without error (192 features, realistic restDays distribution
  including real back-to-back cases); evaluateFeatureCacheWithOverrides
  correctly excludes the test split from its results; window.getParam
  is correctly restored to the original after both a single evaluation
  and a full grouped search; the grouped search runs all 4 groups
  without crashing and does not mutate the "live" parameter values.
- Did not verify the actual numeric quality of Phase 4's search (i.e.,
  whether it finds real improvements on real data) — that requires a
  real season and a real browser. See Phase 4 below.

For a future session: before relying on this further, run one real
"Run Season Backtest" click in-browser against actual season data and
confirm the totalGames/evaluated/skipped/accuracy-score numbers look
like what you'd expect (roughly consistent with pre-Phase-3 runs, modulo
the fatigue live-wiring's effect on back-to-back games specifically).

Original spec for this phase, preserved as the historical record of
intent (see "what's actually in the code" above for what was actually
built against it):

To fit a full joint sweep into 10–20 minutes, config evaluation can't re-fetch 
or re-derive per-game data per candidate. Precompute a per-game feature 
snapshot (raw series, H2H arrays, rest days, ratings, line) once per league, 
cache it in memory, and make every candidate config a pure function over that 
cache. This is the difference between "hundreds of configs" and "thousands."

Deliverable: a buildBacktestFeatureCache(league) pass that runs once, 
before any sweeping starts, and a progress readout so you know if the 
10–20 min budget is realistic before the sweep even begins.

---

Phase 4 — Grouped search, not exhaustive joint grid [NEW]

Status: 🟡 Partially complete. A real, working, integrated
implementation exists and runs automatically at the end of every
runNbaSeasonBacktest call — this is further than "not started," but it
deviates from this section's original spec in one material way (below),
had a real, confirmed bug (also below, now fixed), and hasn't been
re-run against real data since the fix, so it isn't marked ✅.

REAL BUG FOUND AND FIXED THIS SESSION: the first real in-browser run
(1,231 games, 2025 season) reported Phase 4 found a validation
improvement of 51.0 → 59.3 with Group A (H2H) adopted — but
report.groupedSearch.proposedDiff came back completely empty ({}),
even though an "adopted" H2H candidate should differ from the live
baseline in at least one parameter. Investigated: all 9 evaluated H2H
candidates (spanning h2hFactor 0.70-1.00, h2hMaxWeight 0.20-0.40, etc.)
scored bit-identical composite values (59.307912155721375, matching to
the full double-precision digit) — as did all 9 Threshold-group
candidates. That level of identical-to-15-digits agreement across
genuinely different parameter values is not "no real effect," it's a
sign the override isn't reaching the computation that should vary with
it.

Root cause, confirmed by reading the code: evaluateFeatureCacheWithOverrides
saves AppState.context.data (to restore later) but never clears it to a
known-empty state, unlike runNbaSeasonBacktest's own loop, which
explicitly sets AppState.context.data = defaultMassacreFetchContext()
before it starts. By the time Phase 4's search runs (after
runNbaSeasonBacktest's own loop has finished and its finally block has
already restored AppState.context.data to whatever the live app had
loaded before the backtest button was clicked), AppState.context.data
holds one real matchup's real venue data — not each game's own context.
getFetchedSeries(), which computeFTProjection's venue-blend logic calls
internally, reads AppState.context.data directly (not the per-game
feature cache), so every game evaluated during Phase 4's search was
picking up that same one stale matchup's venue numbers instead of its
own. That's a constant, config-independent distortion applied
identically to every candidate — consistent with H2H/threshold
candidates (which don't touch venue blending) tying exactly, and with
Group B/C showing small real variation on top of it (teamWeightBase and
fatigueB2BPenalty are correctly threaded through and do have a small
real effect). It also explains why the "baseline" candidate inside the
search (which should reproduce the live config exactly) scored ~8
Accuracy Score points above the same config evaluated cleanly by the
main loop — the gap is the leaked venue data, not a measurement
difference in method.

Fix applied: added the same AppState.context.data =
defaultMassacreFetchContext() reset to evaluateFeatureCacheWithOverrides
that runNbaSeasonBacktest's own loop already does, restored via the
existing finally block exactly as before. This is what the function's
own pre-existing comment ("do not inherit leftover state from the
baseline run") already claimed happened — it just didn't, until now.

Practical implication: the 51.0 → 59.3 improvement and the
groupsAdopted: ["A_H2H"] result from that first run should not be
trusted — it's very likely measuring leaked venue data, not a genuine
H2H parameter effect. Needs a fresh in-browser run post-fix before any
Phase 4 output is treated as meaningful. Verified only that the fix
doesn't break the function's control flow (syntax check + a
stub-based smoke test, which can't exercise this specific bug since the
stub never calls the real getFetchedSeries/AppState path) — the real
confirmation is a fresh real-data run producing a smaller, more
plausible baseline-vs-candidate gap and groups whose adopted candidates
actually show up in proposedDiff when adopted:true.

What's actually in the code:
- BACKTEST_PARAM_GROUPS defines the four groups from this section
  (A_H2H, B_FORM_VENUE with recencyProfiles support, C_FATIGUE_ANCHOR,
  D_THRESHOLDS), each with explicit candidate value lists per parameter.
- evaluateFeatureCacheWithOverrides(features, allGames, paramOverrides,
  options) evaluates one candidate config: temporarily monkey-patches
  window.getParam to serve the override values (restored in a finally
  block no matter what), runs every train+validation game (test always
  excluded — includeTest hardcoded false at every call site, verified
  this session), and returns train/validation Accuracy Scores.
- runGroupedParamSearchPhase4(features, allGames, baselineValComposite,
  options) samples samplesPerGroup joint candidates per group (seeded
  RNG, deterministic), always includes the pure live-baseline candidate
  for that group so it can't regress by accident, evaluates each on
  validation, rejects any candidate whose train-validation gap exceeds
  maxTrainValGap (overfitting guard), and adopts a group's best
  candidate into the running bundle only if it beats the current best by
  at least minValGain. Runs groups in order A → B → C → D, carrying the
  running best bundle forward between groups (this is closer to Phase
  5's cross-group idea than a strict "test each group against the
  original baseline only" — see Phase 5 note below). Returns a report
  with proposedDiff (only the keys that actually changed vs. live) and
  bestBundle; writes nothing live, locks nothing — matching this
  section's "does not need to change, only what feeds it does" framing
  for the write side.
- runNbaSeasonBacktest calls this automatically after computing its own
  baseline report, attaches the result as report.groupedSearch, and adds
  a note about whether a validation improvement was found. Still nothing
  is applied live — it's report-only, exactly as intended at this stage.

Where this deviates from the original spec above: this section
originally said Phase 4 "reuses testConfigurationSignificance and
calculateCalibrationMetrics as-is." Checked this session: those two
functions expect settled-pick records (challengerRecord.wins/losses,
results with .winProbability/.win/.loss) — a win-rate z-test and a
Brier/ECE calculator built for real bets against a market line with a
known outcome. The season backtest has never produced that shape of
data (lines: {} throughout — no real market lines, no win/loss, no win
probability) — it evaluates raw projected-score-vs-actual-score
accuracy, the same "scores only" methodology Phase 2's train/validation/
test split already uses. So literal reuse wasn't actually possible; the
original spec's assumption was wrong on a technical level, not just
undone. What's implemented instead reuses calculateScoresOnlyCalibration
/ computeBacktestAccuracyScore (Phase 2's own methodology) plus a flat
minValGain threshold (default 0.5 Accuracy Score points) and the
maxTrainValGap overfitting guard, in place of a real significance test.
This is a reasonable substitute given the constraint, but it is not a
statistical significance test — there's no p-value or confidence bound
on whether a given improvement is distinguishable from noise, just a
fixed threshold. Flagging as a real open question for whoever picks up
Phase 5/6: is a flat validation-composite threshold sufficient before
Phase 6's final gate, or does Phase 5/6 need to add real significance
testing on top of the Accuracy Score (e.g., a paired bootstrap
comparison across games) before anything is allowed near a lock
decision?

Verification performed: see Phase 3's "Verification performed" above —
the same synthetic-data smoke test exercised this function directly (not
stubbed), confirming it runs all 4 groups without error, correctly
excludes the test split, restores getParam correctly, and does not
mutate live parameter values. Did not verify search quality against real
data — the synthetic dataset and stubbed projection math in that test
aren't sensitive enough to config changes to meaningfully test whether
the search finds real improvements, only that its control flow and
safety guarantees hold.

28+ parameters at ~5 candidate values each is 5^28 — not searchable, joint 
or otherwise. Group correlated parameters and search within a group:

- Group A — H2H: factor, max weight, lookback, 4 decay weights
- Group B — Form/venue: recency vector, team-weight base, venue 
- thresholds/weights
- Group C — Fatigue & off/def (new from Phase 1)
- Group D — Thresholds: edge points, confidence bands, volatility/pace 
- clamps

Within a group: random search or a modest grid over the joint space of 
that group's params (feasible at group size 4–7), evaluated on train, 
checked on validation with the existing z-test + grid-size correction + 
Brier gate. This reuses testConfigurationSignificance and 
calculateCalibrationMetrics as-is — they don't need to change, only what 
feeds them does. (See "Where this deviates" above — this specific
paragraph's assumption didn't hold up; the rest of the group design did.)

---

Phase 5 — Cross-group re-validation loop [NEW]

Status: Not started as a distinct multi-pass loop. Worth noting: Phase
4's implementation already carries the running best bundle forward
group-to-group within its single pass (A's winner becomes part of B's
baseline, etc.), which is a piece of what this phase wants — but it's
one pass, not the repeated "re-test everything against the new best
bundle" loop this section describes. The gap that's actually still open:
running the full group order again (2nd, 3rd, 4th outer pass) against
the new bundle, and stopping when nothing changes or after a fixed pass
count.

This is the exact failure mode you described — lock H2H, then wreck it by 
tuning offense/defense next. Fix: never test a group in isolation after the 
first pass.

- Pass 1: tune each group against the current live config as baseline.
- Pass 2+: tune each group again, but now the baseline is the best full 
- bundle found so far across all groups, not the original live config.
- Repeat for a fixed number of outer passes (3–4) or until no group changes 
- — same pass loop structure the coordinate-ascent tuner already uses, 
- extended from single-parameter to whole-group.

---

Phase 6 — One-shot final gate before lock [NEW]

Status: Not started.

The full bundle that survives Phase 5 gets evaluated once against the 
untouched final test slice from Phase 2:

- Must beat the current live-locked config's win rate on that slice
- Must clear the significance test (z-test, same corrected threshold)
- Must not regress calibration (Brier gate, same as today)

Fails any of these → nothing changes, current lock stands, and the run says 
why. Passes → proceed to write the lock. No partial or "close enough" 
promotion — this is the one place in the whole pipeline where a false 
positive actually reaches your live engine, so it's the strictest gate.

Note from Phase 4's status above: this gate as originally specified
assumes a win-rate/Brier evaluation (testConfigurationSignificance /
calculateCalibrationMetrics), the same assumption that turned out not to
match what the season backtest actually produces. Whoever builds this
phase needs to resolve that — either give the backtest a way to produce
real settled-pick outcomes (would need real historical market lines,
which don't currently exist in this pipeline), or define an equivalent
significance test on the Accuracy Score / MAE metrics Phase 2-4 actually
use.

---

Phase 7 — Repeat per market, per league, with sample gating [EXISTS pattern, extend]

Status: Not started.

The season backtest is NBA-only today. Extend Phases 2–6 across FT, H1, 
team totals, quarters, and other leagues — but reuse the existing 
minimum-sample idea (currently 125/250 settled picks for the live tuner) as 
a minimum games threshold per league/market before it's allowed into the 
sweep at all. Thin leagues don't get a "locked" config from 40 games.

---

Phase 8 — Lock registry with a paper trail [EXISTS pattern, extend]

Status: Not started. Building blocks confirmed present in code
(storeVerifiedConfig, logPromotionEvent, isNbaCoreLocked/setNbaCoreLocked)
but not yet unified into the single lock record this phase calls for.
The "Engine Configuration History" section at the top of this document
is where that unified record should eventually get written to (or
generated from) — it's set up and waiting, currently empty by design.

storeVerifiedConfig / the NBA-core lock flag / logPromotionEvent already 
do parts of this. Unify into one lock record per parameter group per 
league/market: value, what it beat, z-score, sample size, date, and the 
full history of prior locks — not just the current one. A lock is only ever 
replaced by something that clears Phase 6, never edited by hand.

---

Phase 9 — One button, one report [NEW]

Status: Not started.

Single "Run Full Backtest" action that runs Phases 3–8 end to end and ends 
with a diff report: current live value vs proposed value, per parameter, 
with z / Brier / sample size / which phase changed it — for you to confirm 
before anything writes to the live registry. Nothing auto-applies, same 
convention the tuner already follows.

---

Phase 10 — Time budget reality check [NEW]

Status: Not started.

Once Phases 3–9 exist, actually measure it: combos evaluated per second 
after Phase 3's caching, total combos needed for Phase 4's group sizes, and 
whether 3–4 outer passes in Phase 5 fits inside 10–20 minutes. If it 
doesn't, the lever is the random-search sample size per group, not skipping 
the validation/final-test structure — that structure is what keeps a "9/10" 
from ever reaching your live engine.

One early data point, from this session's synthetic (not real) smoke
test: buildBacktestFeatureCache processed a synthetic 192-game season at
roughly 1,200-1,500 games/second on ordinary Node, not in a browser and
not against real data — not a real budget estimate, just a sign the
approach isn't obviously going to blow the 10-20 min target before
Phase 4's search multiplies it by however many candidates get evaluated.

---

Order of operations
Phase 0 → 1 → 2 → 3 are prerequisites (can't sweep what isn't tunable, can't 
trust a result without the split, can't fit the time budget without the 
cache). 4 → 6 is the actual search loop. 7 is breadth. 8–10 are what make it 
safe to run more than once.

Status: Phase 0 → 1 → 2 → 3 prerequisite chain is complete. Phase 4 has
a real, safe implementation that needs a real-data validation run and a
decision on its scoring method before it's fully done. Phase 5 is next
after that.
