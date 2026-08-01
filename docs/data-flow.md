# Data Flow

## Two ways data enters the engine

**1. Auto-fetch (ESPN) — NBA, WNBA, NCAA M/W, G-League, Summer League only**

Entry point: `fetchESPN()` → `fetchESPNCore(league, teamAName, teamBName)`, which pulls from `site.api.espn.com/apis/site/v2/sports/basketball/<slug>` (slugs: `nba`, `nba-g-league`, `nba-summer-las-vegas`, `wnba`, `mens-college-basketball`, `womens-college-basketball`). Supporting calls: `fetchLeagueTeamCatalog`, `fetchScheduleCore` / `fetchNcaaSchedule`, `fetchH2HCore` / `fetchNcaaH2H`, `fetchInjuryMeta`, `fetchRoster`, `fetchNbaTeamSeasonGameLog`. This path populates scored/allowed series, H2H games, and injury metadata automatically once team names resolve.

**2. Manual paste (Sofascore) — all other leagues (the bulk of the 116)**

The user pastes Sofascore JSON per side. Entry points: `parseSofascoreIndividual(side)` parses the paste, `ssProcessTeamEvents(events, teamId, label, fixtureTournamentId)` extracts per-game stats from the event list, `updateTeamUIFromStats(side, stats)` writes parsed values into the form fields. `extractH2HFromPastedEvents()` pulls head-to-head games from the same pasted data. `detectTournamentIdIntersection` / `detectPrimaryTournamentForEvents` / `validateTournamentSample` guard against pasting events from the wrong competition. `reprocessBothTeamsFromEvents()` re-derives both sides if the tournament ID or filters change after the initial paste.

Both paths converge on the same form fields (`aFTScored`, `aFTAllowed`, `aFTH2H`, etc.) — from that point on, the engine doesn't know or care whether the data was fetched or pasted.

## Running the engine

`runEngine()` is the single orchestration entry point (triggered by the Run button). On each run it:

1. Clears/rekeys `AppState.context.data` if the league changed since the last run.
2. Loads verified tuning config for the current league from `localStorage` (`BB_VERIFIED_TUNINGS_FT`, `BB_VERIFIED_TUNINGS_H1`, `BB_VERIFIED_TUNINGS`) and applies it as recency weights / pace adjustment for this run only (via `window.__phase2*` side-channel globals, restored in a `finally` block regardless of how the run exits).
3. Runs the projection pipeline (see below) for FT, H1, and quarter markets.
4. Runs the confidence model on each market.
5. Renders results and writes the full build to `window.__LAST_AUDIT_STATE`.

## The projection pipeline (per market: FT / H1 / quarters)

Each market's projection build proceeds through numbered, named steps (found via grep of `STEP\d+_\w+` keys in the projection build objects — exact step numbers/names vary slightly by market since FT/H1/quarters are separate code paths, but the shape is consistent):

1. `STEP1_rawSeries` / `STEP1_allowedSeries` / `STEP1_sampleSizes` — pull the raw scored/allowed series and sample sizes for each side.
2. `STEP2_averages` — compute recency-weighted averages (`weightedRecentAverage`, `trimmedAvg`).
3. `STEP3_anchorInputs` / `STEP3_leagueBase` — establish the baseline anchor for the projection.
4. `STEP4_volatilityAdjust` / `STEP4_advancedBlend` — adjust for volatility / blend in advanced stats.
5. `STEP5_advancedStatsBlend` — further advanced-stat blending.
6. `STEP6_intelligenceAdjust` / `STEP6_untetheredH` / `STEP6b_postIntelProj` — apply "intelligence" signal adjustments (damped via `applyDampedIntelSignal`).
7. `STEP7_h2hBlend` / `STEP7_finalProjections` — blend in H2H series (see `getMassacreH2HSeries` below), or finalize (market-dependent).
8. `STEP8_injuryMultApplication` / `STEP8_edgeCalc` — apply injury multipliers, or compute edge.
9. `STEP9_finalProjections` — finalized team/total projections.
10. `STEP10_edgeCalc` — edge vs. the market line.

This step object is exactly what the regression test suite (`docs/testing-debugging.md`) snapshots and diffs against a golden baseline — if you change pipeline math, expect (and check) a regression-suite diff.

## H2H series

`getMassacreH2HSeries(marketKey, fixtureMeta, parsed)` — despite the name (a naming holdover from the deleted Massacre Framework, see `docs/roadmap-and-open-issues.md`), this is the live H2H-series function used by the projection pipeline. It reads `AppState.context.data.h2hGames`, **sorts by `g.date`** (most recent first), and slices to the configured recency-weight window (`MODEL_TUNING.recencyWeights`). Falls back to `parsed.aFTH2H`/`bFTH2H`-style fields from manual paste if no fetched `h2hGames` are present.

## Confidence grading

After projection, `getConfidenceGrade()` — a logistic win-probability model — grades each market's pick. Confidence arbitration across signals is "strongest signal wins," not first-signal-wins. Injury/opponent-boost (`INJURY_OPPONENT_BOOST_FACTOR`) and under-specific edge weighting (`UNDER_EDGE_FACTOR`) are applied as tunable constants at this stage, not hardcoded.

## After a pick is made: tuning loop

Settled picks feed the tracker, which feeds `runCoordinateAscentTuner()` every 25 settled picks. The tuner does an out-of-sample gated search (70/30 train/validation split, z-score testing, Brier score check) over tunable constants and parameters, writing accepted changes to the `TUNABLE_PARAM_REGISTRY` / league overrides in `localStorage` — which is exactly what `runEngine()` reads back in on the next run (step 2 above). This is the closed loop: settle picks → tune → next run uses the tuned config.
