# Prediction Engine

Projection mechanics (the STEP1–10 pipeline) are covered in `docs/data-flow.md`. This file covers the confidence model, the tunable-parameter system, and the calibration loop that ties them together.

## Confidence model: `getConfidenceGrade()` → `getConfidenceWinProbability()`

The confidence grade is a genuine logistic regression, not a heuristic scorer (an earlier heuristic version was replaced). `getConfidenceGrade()` validates inputs (rejects `NO PLAY`, missing line, non-finite edge → returns `"NaN"`), computes `edgePct = |edge / line|` and a volatility ratio, then hands off to `getConfidenceWinProbability()`, which is the actual model:

```
logOdds = intercept
        + edgePct_coeff   * (edgePct - 0.060)
        + volRatio_coeff  * (volatilityRatio - 1.0)
        + sampleFull_coeff * (sampleTier === "full" ? 1 : 0)
        + h2h_coeff        * (hasH2H ? 1 : 0)
        + trap_coeff       * (trap ? 1 : 0)

winProb = clamp(1 / (1 + e^-logOdds), 0.10, 0.90)
```

Default coefficients (used until a league has real fitted values): `intercept=-0.2, edgePct=8.0, volRatio=-0.8, sampleFull=0.4, h2h=0.2, trap=-0.5`.

- Coefficients are looked up per-league from `localStorage["BB_CONFIDENCE_MODEL_COEFF"]`, falling back league → league-group (`nba` / `ncaa` / `other`) → trust tier → `global` → the hardcoded defaults above.
- `isConfidenceCoeffFitted(league)` tells you whether a league is running on real fitted coefficients or the hardcoded placeholder — check this before trusting a grade as calibrated.
- **History note:** the `trap` coefficient defaulted to `-1.2` — roughly double every other categorical term combined — which let a single volatile-trap flag override edge/sample/H2H evidence. It was lowered to `-0.5` to bring it in line with the other categorical coefficients. This is exactly the kind of single-term-dominance bug to watch for if you ever add a new categorical term here.
- Previously there were additional bolt-on multiplicative penalties (`blowoutGap`, `paceGapRisk`, `lineupQuality`, `siblingEdge`) stacked on top of this model. They were removed under a "one-method simplification" — only this logistic model votes on confidence now. The parameters are still accepted by `getConfidenceGrade()`'s signature (harmless no-ops) but not used.

## Tunable parameter registry

`TUNABLE_PARAM_REGISTRY` (const, ~line 4008) is the source of truth for engine constants that are meant to be tuned rather than hardcoded. Each entry has this shape:

```js
h2hFactor: {
  value: 1.0, min: 0.5, max: 1.0, type: "scalar",
  scope: "global", appliesTo: ["ft", "h1", "team_a", "team_b"],
  description: "...",
  lastVerifiedAt: null
}
```

Access through `getTunableParam(key, league)` / `setTunableParam(key, newValue, scopeLeague, verifiedAt)` — never read `TUNABLE_PARAM_REGISTRY[key].value` directly if a league-scoped override might apply. League overrides live separately (`g_tunableParamLeagueOverrides`, persisted via `saveTunableParamLeagueOverrides()`), and `pruneUnverifiedLeagueOverrideDrift()` guards against unverified overrides drifting the registry. `h2hFactor` and H2H decay weights specifically were previously hardcoded and were migrated into this registry — if you find a hardcoded constant that looks like it should scale by league or be tunable, that migration pattern is the template.

Separate from the registry: standalone tunable *constants* (`getTunableConstant` / `setTunableConstant`), including `INJURY_OPPONENT_BOOST_FACTOR` and `UNDER_EDGE_FACTOR`, each with its own candidate-scoring system (`updateConstantCandidateScore`, `selectBestConstantValue(constantName, minSamples=60)`) — these are calibrated by grid search (`calibrateEngineConstants()`, using `TUNABLE_CONSTANTS_GRID`), not by the coordinate-ascent tuner below.

## Calibration loop: coordinate-ascent tuner

`runCoordinateAscentTuner()` runs automatically every 25 settled picks (tracked via `getTotalSettledCountForLeagueMarket`). It:

- Splits settled picks 70/30 (train/validation).
- Searches tunable parameters via coordinate ascent (one dimension at a time).
- Gates any proposed change on out-of-sample performance: z-score testing plus a Brier score check, not just raw accuracy.
- Writes accepted proposals for review (`getStoredTunerProposal` / `applyTunerProposal`) — proposals are not auto-applied to the live registry; a separate apply step promotes them once verified. Same pattern for engine-constant proposals (`getStoredConstantProposal` / `applyEngineConstantProposal`) and Phase-2 simulator proposals (`getStoredPhase2Proposal` / `applyPhase2SimulatorProposal`).

`isNbaCoreLocked()` / `setNbaCoreLocked()` gates whether NBA's core parameters can still move — once locked (`localStorage["BB_NBA_CORE_LOCKED"] === "1"`), the tuner should not be silently changing NBA's core config out from under a stable, verified setup. Check lock state before assuming a tuning proposal for NBA will apply the way it would for an unlocked league.

## Naming holdovers to ignore

`g_massacreFetchContext`, `getMassacreH2HSeries`, `getMassacreTeamContext`, and `lockStrength`/`*MassacreBonus` variables are **not** part of a blowout-scoring "Massacre Framework" — that framework (MASSACRE_TUNING, calibrateMassacreCoefficients, getMassacreProfile) was deliberately deleted. These names now refer to unrelated live systems (H2H series fetching, and an edge-lock-strength score used in pick prioritization). Don't infer scoring behavior from the name; check what the function actually does. See `docs/roadmap-and-open-issues.md`.
