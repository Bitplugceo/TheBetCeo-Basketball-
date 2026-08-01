BB Engine — Full-Parameter Backtest Roadmap

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
decision this roadmap should respect, not override.

Two smaller items, dead code rather than missing features, worth a cleanup 
pass but not urgent: NBA_CORE_TUNER_KEYS also references 
"recencyStrength", which doesn't exist anywhere else in the file (stale 
reference); and MODEL_TUNING.h2hMaxWeight (0.30) is an unused duplicate — 
the real live H2H cap is the separate, correctly-wired 
h2hMaxWeight registry entry.

Deliverable: a single source-of-truth list (extend 
TUNABLE_PARAM_REGISTRY itself) so "sweep everything" has an actual 
enumerable "everything." Anything not on this list by the end of Phase 1 
does not get backtested — no shadow parameters.

---

Phase 1 — Make fatigue and the quarter anchor weight real, tunable inputs [NEW]

Can't backtest a blend rate that doesn't exist. Wiring only — no sweeping, 
no testing yet, exactly as agreed. Both changes are additive (getParam(key) ?? <old hardcoded value>), so live output is byte-identical until Phase 4+ 
actually promotes a different value.


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
Patches below.

---

Phase 2 — True three-way split, not two [EXISTS, extend]

The season backtest already does a chronological 70/30 train/holdout split 
with an overfitting-gap warning — that's real and stays.

What's missing: a final locked-away test slice that the search process 
never touches, not even for the significance test. Right now the 
holdout is the validation set the tuner optimizes against — which means 
"validated against holdout" and "safe to lock" aren't the same claim.

- Split: ~55% train / ~25% validation (search happens here) / ~20% final 
- test, chronological, per league.
- The final test slice gets touched exactly once, at the very end of a 
- run, right before a lock decision — never during search.

---

Phase 3 — Precompute once, sweep in memory [NEW]

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
feeds them does.

---

Phase 5 — Cross-group re-validation loop [NEW]

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

The full bundle that survives Phase 5 gets evaluated once against the 
untouched final test slice from Phase 2:

- Must beat the current live-locked config's win rate on that slice
- Must clear the significance test (z-test, same corrected threshold)
- Must not regress calibration (Brier gate, same as today)

Fails any of these → nothing changes, current lock stands, and the run says 
why. Passes → proceed to write the lock. No partial or "close enough" 
promotion — this is the one place in the whole pipeline where a false 
positive actually reaches your live engine, so it's the strictest gate.

---

Phase 7 — Repeat per market, per league, with sample gating [EXISTS pattern, extend]

The season backtest is NBA-only today. Extend Phases 2–6 across FT, H1, 
team totals, quarters, and other leagues — but reuse the existing 
minimum-sample idea (currently 125/250 settled picks for the live tuner) as 
a minimum games threshold per league/market before it's allowed into the 
sweep at all. Thin leagues don't get a "locked" config from 40 games.

---

Phase 8 — Lock registry with a paper trail [EXISTS pattern, extend]

storeVerifiedConfig / the NBA-core lock flag / logPromotionEvent already 
do parts of this. Unify into one lock record per parameter group per 
league/market: value, what it beat, z-score, sample size, date, and the 
full history of prior locks — not just the current one. A lock is only ever 
replaced by something that clears Phase 6, never edited by hand.

---

Phase 9 — One button, one report [NEW]

Single "Run Full Backtest" action that runs Phases 3–8 end to end and ends 
with a diff report: current live value vs proposed value, per parameter, 
with z / Brier / sample size / which phase changed it — for you to confirm 
before anything writes to the live registry. Nothing auto-applies, same 
convention the tuner already follows.

---

Phase 10 — Time budget reality check [NEW]

Once Phases 3–9 exist, actually measure it: combos evaluated per second 
after Phase 3's caching, total combos needed for Phase 4's group sizes, and 
whether 3–4 outer passes in Phase 5 fits inside 10–20 minutes. If it 
doesn't, the lever is the random-search sample size per group, not skipping 
the validation/final-test structure — that structure is what keeps a "9/10" 
from ever reaching your live engine.

---

Order of operations
Phase 0 → 1 → 2 → 3 are prerequisites (can't sweep what isn't tunable, can't 
trust a result without the split, can't fit the time budget without the 
cache). 4 → 6 is the actual search loop. 7 is breadth. 8–10 are what make it 
safe to run more than once.
