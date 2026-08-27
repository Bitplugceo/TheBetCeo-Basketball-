
function runOutOfSampleValidation(league) {
  const allPicks = getLearningTrackedPicks()
    .filter(
      (p) =>
        p.league === league &&
        (p.resultStatus === "win" || p.resultStatus === "loss") &&
        p.createdAt,
    )
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  if (allPicks.length < 75) return null;

  // Reserve a fixed calendar cutoff instead of a rolling percentage split, so the
  // OOS set is genuinely untouched data rather than "whatever the newest slice is".
  // The cutoff only rolls forward on a schedule (every 30 days), never on demand.
  const _oosCutoffKey = "BB_OOS_CUTOFF_" + String(league || "unknown");
  const _oosRolloverMs = 30 * 24 * 60 * 60 * 1000;
  let _cutoffTs = null;
  try {
    const _stored = JSON.parse(localStorage.getItem(_oosCutoffKey) || "null");
    if (
      _stored &&
      isFinite(_stored.cutoffTs) &&
      isFinite(_stored.setAt) &&
      Date.now() - _stored.setAt < _oosRolloverMs
    ) {
      _cutoffTs = _stored.cutoffTs;
    }
  } catch (e) {
    engineDebug("BB_OOS_CUTOFF load failed", { error: e?.message || String(e), league });
  }
  if (_cutoffTs === null) {
    const splitIdx = Math.floor(allPicks.length * 0.8);
    _cutoffTs = Date.parse(allPicks[splitIdx]?.createdAt) || Date.now();
    try {
      localStorage.setItem(
        _oosCutoffKey,
        JSON.stringify({ cutoffTs: _cutoffTs, setAt: Date.now() }),
      );
    } catch (e) {
      engineDebug("BB_OOS_CUTOFF save failed", { error: e?.message || String(e), league });
    }
  }
  const trainSet = allPicks.filter((p) => Date.parse(p.createdAt) < _cutoffTs);
  const testSet = allPicks.filter((p) => Date.parse(p.createdAt) >= _cutoffTs);
  if (testSet.length < 15) return null;
  const wins = testSet.filter((p) => p.resultStatus === "win").length;
  const result = {
    testSize: testSet.length,
    winRate: wins / testSet.length,
    trainSize: trainSet.length,
  };

  try {
    const store = JSON.parse(localStorage.getItem("BB_OOS_VALIDATION_RESULTS") || "{}");
    store[String(league || "unknown")] = {
      ...result,
      league: String(league || "unknown"),
      computedAt: new Date().toISOString(),
    };
    localStorage.setItem("BB_OOS_VALIDATION_RESULTS", JSON.stringify(store));
  } catch (e) {
    engineDebug("runOutOfSampleValidation failed to persist result: " + (e?.message || String(e)), {
      league,
      error: e,
    });
  }
  return result;
}

function checkModelHealth(league) {
  const allPicks = getLearningTrackedPicks().filter(
    (p) => p.league === league && (p.resultStatus === "win" || p.resultStatus === "loss"),
  );

  const MIN_N = 12;
  if (allPicks.length < MIN_N) return null;
  const recentWindow = Math.min(20, Math.max(8, Math.round(allPicks.length * 0.4)));
  const recentPicks = allPicks.slice(-recentWindow);
  const allWR = allPicks.filter((p) => p.resultStatus === "win").length / allPicks.length;
  const recentWR = recentPicks.filter((p) => p.resultStatus === "win").length / recentPicks.length;
  const drift = recentWR - allWR;
  const se = Math.sqrt(Math.max(allWR * (1 - allWR), 0.01) / recentWindow);
  const driftThreshold = Math.max(0.15, se * 2.0);
  const status =
    Math.abs(drift) > driftThreshold ? (drift < 0 ? "degrading" : "improving") : "stable";
  return {
    allWinRate: allWR,
    recentWinRate: recentWR,
    drift,
    status,
    n: allPicks.length,
    recentWindow,
    driftThreshold: Number(driftThreshold.toFixed(3)),
  };
}

function applyLeagueTrustToPicks(picks, league) {
  if (!Array.isArray(picks) || !picks.length) return;
  const trust = getLeagueTrustMeta(league);

  picks.forEach((p) => {
    if (!p) return;
    p.leagueTrust = trust;
  });

  if (trust.mode !== "full") {
    engineDebug("league trust info (non-mutating)", {
      league: normalizeLeagueTrustKey(league),
      trust: trust.label,
      mode: trust.mode,
    });
  }
}

function getTrackedInputSource(marketKey = "ft") {
  const bucket = marketKey === "h1" ? "h1" : marketKey === "h2" ? "h2" : "ft";

  const aSource = String(AppState.fetchMeta.A?.[bucket]?.source || "")
    .trim()
    .toLowerCase();
  const bSource = String(AppState.fetchMeta.B?.[bucket]?.source || "")
    .trim()
    .toLowerCase();
  const rawSources = [aSource, bSource].filter(Boolean);

  if (!rawSources.length) return "unknown";

  const normalized = rawSources.map((src) => {
    if (src === "espn") return "auto";
    if (src === "manual") return "manual";
    return src;
  });

  const unique = [...new Set(normalized)];
  if (unique.length === 1) return unique[0];
  if (unique.includes("auto") && unique.includes("manual")) return "mixed";
  return unique[0] || "unknown";
}

function buildTrackedPickPayload({
  pickRow,
  isLock,
  fixtureMeta: originalFixtureMeta,
  league,
  diagnostics,
}) {
  if (!pickRow) return null;

  const fixtureMeta = { ...originalFixtureMeta };

  const exoticNoLineMarkets = [
    "player",
    "w_ou",
    "race",
    "high_q",
    "low_q",
    "htft",
    "margin_team",
    "margin_any",
    "high_q_ou",
    "low_q_ou",
    "other",
    "winner",
  ];
  const isExoticNoLine = pickRow && exoticNoLineMarkets.includes(pickRow.marketKey);

  const isManualLeague =
    league !== "nba" &&
    league !== "wnba" &&
    league !== "wnba_pre" &&
    league !== "ncaa" &&
    league !== "ncaaw" &&
    league !== "nba_gl";

  if (!fixtureMeta.eventDate) {
    fixtureMeta.eventDate = new Date().toISOString();
  }

  const isSavablePick =
    pickRow &&
    pickRow.pick !== "NO PLAY" &&
    !String(pickRow.note || "").startsWith("Massacre gate") &&
    !String(pickRow.note || "").startsWith("Intel gate") &&
    !String(pickRow.note || "").startsWith("Grade gate");

  // A7 fix: a NO-PLAY caused by a plain insufficient-edge threshold (not an
  // internal safety gate) still has a valid snapshot + line, so it is worth
  // tracking as a shadow record purely so the tuner can later re-evaluate it
  // under candidate thresholds (closing the selection-bias gap where the
  // tuner only ever saw picks that were actually played). This must never
  // surface as a live pick, and it requires a matched event so it can be
  // auto-settled instead of sitting as dead weight in storage forever.
  const isCleanNoPlay =
    pickRow &&
    pickRow.pick === "NO PLAY" &&
    !String(pickRow.note || "").startsWith("Massacre gate") &&
    !String(pickRow.note || "").startsWith("Intel gate") &&
    !String(pickRow.note || "").startsWith("Grade gate");
  const isTrackableNoPlay = isCleanNoPlay && isFinite(pickRow.line) && !!fixtureMeta.eventId;

  const snapshot = (function () {
    if (!pickRow || !pickRow.marketKey) return null;
    const rawInputs = {};
    try {
      const parsedSnapshot = {
        aFTScored: readLooseSeries("aFTScored"),
        bFTScored: readLooseSeries("bFTScored"),
        a1HScored: readLooseSeries("a1HScored"),
        b1HScored: readLooseSeries("b1HScored"),
        aQ1Scored: readLooseSeries("aQ1Scored"),
        aQ2Scored: readLooseSeries("aQ2Scored"),
        aQ3Scored: readLooseSeries("aQ3Scored"),
        aQ4Scored: readLooseSeries("aQ4Scored"),
        bQ1Scored: readLooseSeries("bQ1Scored"),
        bQ2Scored: readLooseSeries("bQ2Scored"),
        bQ3Scored: readLooseSeries("bQ3Scored"),
        bQ4Scored: readLooseSeries("bQ4Scored"),
        aFTH2H: readLooseSeries("aFTH2H"),
        bFTH2H: readLooseSeries("bFTH2H"),
        a1HH2H: readLooseSeries("a1HH2H"),
        b1HH2H: readLooseSeries("b1HH2H"),
        aQ1H2H: readLooseSeries("aQ1H2H"),
        bQ1H2H: readLooseSeries("bQ1H2H"),
        aQ2H2H: readLooseSeries("aQ2H2H"),
        bQ2H2H: readLooseSeries("bQ2H2H"),
        aQ3H2H: readLooseSeries("aQ3H2H"),
        bQ3H2H: readLooseSeries("bQ3H2H"),
        aQ4H2H: readLooseSeries("aQ4H2H"),
        bQ4H2H: readLooseSeries("bQ4H2H"),
        aFTScoredHome: readLooseSeries("aFTScoredHome"),
        aFTAllowedHome: readLooseSeries("aFTAllowedHome"),
        aFTScoredAway: readLooseSeries("aFTScoredAway"),
        aFTAllowedAway: readLooseSeries("aFTAllowedAway"),
        bFTScoredHome: readLooseSeries("bFTScoredHome"),
        bFTAllowedHome: readLooseSeries("bFTAllowedHome"),
        bFTScoredAway: readLooseSeries("bFTScoredAway"),
        bFTAllowedAway: readLooseSeries("bFTAllowedAway"),
      };
      const linesSnapshot = {
        ftLine: parseMarketLine(document.getElementById("ftMarket")?.value || ""),
        h1Line: parseMarketLine(document.getElementById("h1Market")?.value || ""),
        aLine: parseMarketLine(document.getElementById("teamAMarket")?.value || ""),
        bLine: parseMarketLine(document.getElementById("teamBMarket")?.value || ""),

        handicapLine: parseHandicapLine(document.getElementById("handicapMarket")?.value || ""),
      };
      const fixtureMetaSnapshot = getCurrentFixtureMeta();

      const paramRegistryValues = {};
      Object.keys(TUNABLE_PARAM_REGISTRY).forEach((key) => {
        paramRegistryValues[key] = getParam(key, league);
      });
      // D3: freeze a compact context snapshot so evaluatePickWithParams can
      // replay without reading live AppState (pace/ortg/drtg/venue/h2h).
      let contextDataSnapshot = null;
      try {
        const _src = AppState.context?.data || {};
        const _slimSide = function (sideObj) {
          if (!sideObj || typeof sideObj !== "object") return {};
          return {
            overall: sideObj.overall
              ? {
                  ftScored10: Array.isArray(sideObj.overall.ftScored10)
                    ? sideObj.overall.ftScored10.slice(0, 10)
                    : [],
                  ftAllowed10: Array.isArray(sideObj.overall.ftAllowed10)
                    ? sideObj.overall.ftAllowed10.slice(0, 10)
                    : [],
                  h1Scored10: Array.isArray(sideObj.overall.h1Scored10)
                    ? sideObj.overall.h1Scored10.slice(0, 10)
                    : [],
                  h1Allowed10: Array.isArray(sideObj.overall.h1Allowed10)
                    ? sideObj.overall.h1Allowed10.slice(0, 10)
                    : [],
                }
              : null,
            venue: sideObj.venue
              ? {
                  ftScored10: Array.isArray(sideObj.venue.ftScored10)
                    ? sideObj.venue.ftScored10.slice(0, 10)
                    : [],
                  ftAllowed10: Array.isArray(sideObj.venue.ftAllowed10)
                    ? sideObj.venue.ftAllowed10.slice(0, 10)
                    : [],
                  h1Scored10: Array.isArray(sideObj.venue.h1Scored10)
                    ? sideObj.venue.h1Scored10.slice(0, 10)
                    : [],
                  h1Allowed10: Array.isArray(sideObj.venue.h1Allowed10)
                    ? sideObj.venue.h1Allowed10.slice(0, 10)
                    : [],
                }
              : null,
            ortg10: Array.isArray(sideObj.ortg10) ? sideObj.ortg10.slice(0, 10) : [],
            drtg10: Array.isArray(sideObj.drtg10) ? sideObj.drtg10.slice(0, 10) : [],
            pace10: Array.isArray(sideObj.pace10) ? sideObj.pace10.slice(0, 10) : [],
          };
        };
        contextDataSnapshot = {
          fixtureMeta: fixtureMetaSnapshot,
          league: _src.league || league,
          A: _slimSide(_src.A),
          B: _slimSide(_src.B),
          h2hGames: Array.isArray(_src.h2hGames)
            ? _src.h2hGames.slice(0, 12).map(function (g) {
                return {
                  eventId: g.eventId,
                  date: g.date,
                  scoreA: g.scoreA,
                  scoreB: g.scoreB,
                  h1A: g.h1A,
                  h1B: g.h1B,
                  h2A: g.h2A,
                  h2B: g.h2B,
                  q1A: g.q1A,
                  q1B: g.q1B,
                  q2A: g.q2A,
                  q2B: g.q2B,
                  q3A: g.q3A,
                  q3B: g.q3B,
                  q4A: g.q4A,
                  q4B: g.q4B,
                  teamAId: g.teamAId,
                  teamBId: g.teamBId,
                };
              })
            : [],
        };
      } catch (_ctxErr) {
        contextDataSnapshot = null;
      }
      return {
        league,
        marketKey: pickRow.marketKey,
        side:
          getPickSideFromText(pickRow.pick) ||
          (isFinite(pickRow.edge) && pickRow.edge !== 0
            ? pickRow.edge > 0
              ? "over"
              : "under"
            : "no_play"),
        parsed: parsedSnapshot,
        lines: linesSnapshot,
        fixtureMeta: fixtureMetaSnapshot,
        injMultA: AppState.injuries.A.scoringMult,
        injMultB: AppState.injuries.B.scoringMult,
        paramRegistryValues: paramRegistryValues,
        contextData: contextDataSnapshot,
        configSnapshot: {
          // FIX Issue 40: snapshot live knobs, not hardcoded 1.0 defaults.
          recencyWeights:
            (typeof getParam === "function" && getParam("recencyWeights", league)) ||
            MODEL_TUNING.recencyWeights,
          h2hFactor:
            Number(
              (typeof getParam === "function" ? getParam("h2hFactor", league) : null) ?? 1.0,
            ) || 1.0,
          paceDampening:
            Number(
              (typeof getParam === "function" ? getParam("paceDampening", league) : null) ?? 0.4,
            ) || 0.4,
          edgeMult:
            Number(
              (typeof getParam === "function" ? getParam("edgeMult", league) : null) ?? 1.0,
            ) || 1.0,
          injuryMult:
            Number(
              (typeof getParam === "function" ? getParam("injuryMult", league) : null) ?? 1.0,
            ) || 1.0,
        },
      };
    } catch (e) {
      engineDebug("Pick snapshot build failed — this pick will be untunable later", {
        error: e?.message || String(e),
      });
      return null;
    }
  })();

  const isActualPlay = !(
    !pickRow ||
    pickRow.pick === "NO PLAY" ||
    (pickRow.note && !isExoticNoLine && !isSavablePick) ||
    (!isFinite(pickRow.line) && !isExoticNoLine)
  );

  if (!isActualPlay && !isTrackableNoPlay) return null;

  const marketKey = pickRow.marketKey;
  let side = getPickSideFromText(pickRow.pick);
  if (!side) {
    if (isExoticNoLine) side = "exotic";
    else if (pickRow.pick === "NO PLAY") {
      // Literal "no_play" (not a guessed over/under) so the existing
      // no-play branch in settleTrackedPickFromCompetition grades this
      // as "no_play_settled" instead of a fabricated win/loss.
      side = "no_play";
    } else return null;
  }
  const grade = String(pickRow.confidence || "—").toUpperCase();
  const isABQualified = grade === "A" || grade === "B";

  function getSampleTierForMarket(market, dx = {}) {
    if (pickRow?.sampleTier) return pickRow.sampleTier;
    if (market === "ft" || market === "team_a" || market === "team_b")
      return dx.ftSampleTier || "unknown";
    if (
      market === "h1" ||
      market === "h1_team_a" ||
      market === "h1_team_b" ||
      market.startsWith("q")
    )
      return dx.h1SampleTier || "unknown";
    if (market === "h2") return dx.h2SampleTier || "unknown";
    return "unknown";
  }

  function getProjectionOnlyForMarket(market, dx = {}) {
    if (pickRow?.projectionOnly !== undefined) return !!pickRow.projectionOnly;
    if (market === "ft" || market === "team_a" || market === "team_b") return !!dx.ftProjectionOnly;
    if (market === "h1" || market === "h1_team_a" || market === "h1_team_b")
      return !!dx.h1ProjectionOnly;

    if (market === "winner" || market === "handicap") return !!dx.ftProjectionOnly;

    if (market === "h2" || market === "handicap_h2") return !!dx.h2ProjectionOnly;
    if (market === "handicap_h1") return !!dx.h1ProjectionOnly;
    return false;
  }

  function getHasH2HForMarket(market, dx = {}) {
    if (pickRow?.hasH2H !== undefined) return !!pickRow.hasH2H;
    if (market === "ft" || market === "team_a" || market === "team_b") return !!dx.ftHasH2H;
    if (market === "h1" || market === "h1_team_a" || market === "h1_team_b") return !!dx.h1HasH2H;
    if (market === "q1") return !!dx.q1HasH2H;
    if (market === "q2") return !!dx.q2HasH2H;
    if (market === "q3") return !!dx.q3HasH2H;
    if (market === "q4") return !!dx.q4HasH2H;

    if (market === "winner" || market === "handicap") return !!dx.ftHasH2H;
    return false;
  }

  function getVolatilityValueForMarket(market, dx = {}) {
    const _ftVolLimitForBucket = getMarketVolLimit(league, "ft") || 1;
    if (market === "ft")
      return Math.max(Number(dx.aVol || 0), Number(dx.bVol || 0)) / _ftVolLimitForBucket;
    if (market === "team_a") return Number(dx.aVol || 0) / _ftVolLimitForBucket;
    if (market === "team_b") return Number(dx.bVol || 0) / _ftVolLimitForBucket;
    if (market === "h1") return Math.max(Number(dx.aVol1 || 0), Number(dx.bVol1 || 0));
    if (market === "h1_team_a") return Number(dx.aVol1 || 0);
    if (market === "h1_team_b") return Number(dx.bVol1 || 0);
    if (market.startsWith("q") && pickRow && isFinite(Number(pickRow.volatility)))
      return Number(pickRow.volatility);

    if (
      (market === "winner" || market === "handicap") &&
      pickRow &&
      isFinite(Number(pickRow.volatility))
    ) {
      return Number(pickRow.volatility) / _ftVolLimitForBucket;
    }

    if (market === "h2" && pickRow && isFinite(Number(pickRow.volatility))) {
      return Number(pickRow.volatility) / (getMarketVolLimit(league, "h2") || 1);
    }
    if (market === "handicap_h1" && pickRow && isFinite(Number(pickRow.volatility))) {
      return Number(pickRow.volatility) / (getMarketVolLimit(league, "h1") || 1);
    }
    if (market === "handicap_h2" && pickRow && isFinite(Number(pickRow.volatility))) {
      return Number(pickRow.volatility) / (getMarketVolLimit(league, "h2") || 1);
    }
    return 0;
  }

  function getVolatilityBucket(value = 0) {
    const v = Number(value) || 0;
    if (v < 0.7) return "calm";
    if (v < 1.3) return "normal";
    if (v < 1.9) return "wild";
    return "extremely wild";
  }

  function getInjuryBucketForPayload(market, dx = {}) {
    const injA = Number(dx.injMultA ?? 1);
    const injB = Number(dx.injMultB ?? 1);

    const target = market === "team_a" ? injA : market === "team_b" ? injB : Math.min(injA, injB);

    if (target <= 0.75) return "severe";
    if (target <= 0.85) return "high";
    if (target <= 0.92) return "moderate";
    if (target < 0.99) return "light";
    return "clean";
  }

  function getEdgeBucket(edge, line) {
    if (!isFinite(edge) || !isFinite(line) || !line) return "unknown";
    const pct = Math.abs(edge / line);

    if (pct < 0.03) return "micro";
    if (pct < 0.05) return "small";
    if (pct < 0.075) return "medium";
    if (pct < 0.1) return "strong";
    return "extreme";
  }

  function getLineBucket(market, line) {
    if (!isFinite(line)) return "unknown";

    if (market === "ft") {
      if (line < 150) return "ft_low";
      if (line < 180) return "ft_mid";
      if (line < 210) return "ft_high";
      return "ft_very_high";
    }

    if (market === "h1") {
      if (line < 70) return "h1_low";
      if (line < 95) return "h1_mid";
      return "h1_high";
    }

    if (market === "h2") {
      if (line < 70) return "h2_low";
      if (line < 95) return "h2_mid";
      return "h2_high";
    }

    if (market === "team_a" || market === "team_b") {
      if (line < 70) return "team_low";
      if (line < 90) return "team_mid";
      if (line < 110) return "team_high";
      return "team_very_high";
    }

    return "unknown";
  }

  function getPaceRiskForMarket(market, dx = {}) {
    if (market === "h1" || market === "h1_team_a" || market === "h1_team_b")
      return !!dx.h1PaceGapRisk;
    return !!dx.paceGapRisk;
  }

  function getDefFloorForMarket(market, dx = {}) {
    if (market === "h1" || market === "h1_team_a" || market === "h1_team_b")
      return !!dx.h1DefensiveFloorFlag;
    return !!dx.defensiveFloorFlag;
  }

  const sampleTier = getSampleTierForMarket(marketKey, diagnostics);
  const projectionOnly = getProjectionOnlyForMarket(marketKey, diagnostics);
  const hasH2H = getHasH2HForMarket(marketKey, diagnostics);
  const volatilityValue = getVolatilityValueForMarket(marketKey, diagnostics);
  const volatilityBucket = getVolatilityBucket(volatilityValue);
  const injuryBucket = getInjuryBucketForPayload(marketKey, diagnostics);
  const edgeBucket = getEdgeBucket(pickRow.edge, pickRow.line);
  const lineBucket = getLineBucket(marketKey, pickRow.line);
  const gamePaceGapRisk = getPaceRiskForMarket(marketKey, diagnostics);
  const gameDefensiveFloorFlag = getDefFloorForMarket(marketKey, diagnostics);
  const gameBlowoutGap = Number(diagnostics?.blowoutGap || 0);
  const gameVolatilityBlock = !!diagnostics?.volatilityBlock;

  const trackedLine =
    pickRow.trackerLine == null && pickRow.line == null
      ? null
      : isFinite(pickRow.trackerLine)
        ? Number(pickRow.trackerLine)
        : isFinite(pickRow.line)
          ? Number(pickRow.line)
          : null;

  const trackedEdge = Number(pickRow.edge);

  const memoryProfileKey = [
    league || "unknown",
    marketKey || "other",
    side || "unknown",
    edgeBucket,
    lineBucket,
    sampleTier,
    projectionOnly ? "projection_only" : "normal_projection",
    volatilityBucket,
    injuryBucket,
  ].join("|");

  const environmentKey = [
    hasH2H ? "h2h" : "no_h2h",
    gamePaceGapRisk ? "pace_gap" : "pace_ok",
    gameDefensiveFloorFlag ? "def_floor" : "def_ok",
    gameBlowoutGap > 20 ? "blowout" : "balanced",
    gameVolatilityBlock ? "vol_block" : "vol_ok",
  ].join("|");

  const trackerImpactKey = getTrackerImpactKeyFromPickLike(pickRow);
  const trackerImpactLabel = getTrackerImpactLabel(trackerImpactKey);
  const nowIso = new Date().toISOString();

  if (snapshot) snapshot.capturedAt = nowIso;

  const payload = {
    pickId:
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `pick_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    snapshot: snapshot,
    eventId: fixtureMeta.eventId || "",
    eventDate: fixtureMeta.eventDate || "",
    league,
    homeTeam: fixtureMeta.homeTeam && fixtureMeta.homeTeam !== "—" ? fixtureMeta.homeTeam : "A",
    awayTeam: fixtureMeta.awayTeam && fixtureMeta.awayTeam !== "—" ? fixtureMeta.awayTeam : "B",
    homeId: fixtureMeta.homeId || "",
    awayId: fixtureMeta.awayId || "",
    fixtureLabel: `${fixtureMeta.homeTeam && fixtureMeta.homeTeam !== "—" ? fixtureMeta.homeTeam : "A"} vs ${fixtureMeta.awayTeam && fixtureMeta.awayTeam !== "—" ? fixtureMeta.awayTeam : "B"}`,
    marketKey,
    marketName: (pickRow.name || "Other").split("<")[0].trim(),
    projection: isFinite(pickRow.proj) ? Number(pickRow.proj) : null,
    line: trackedLine,
    lineAtPick: trackedLine,
    closingLine: null,
    clv: null,
    decisionLine: isFinite(pickRow.decisionLine)
      ? Number(pickRow.decisionLine)
      : Number(pickRow.line),
    rawLine: isFinite(pickRow.line) ? Number(pickRow.line) : null,
    smartLineApplied: false,
    smartLineMeta: null,
    side,
    predictionText: formatMarginPickForDisplay(
      pickRow.bufferedPickText || pickRow.displayPick || pickRow.pick,
      marketKey,
      fixtureMeta.homeTeam && fixtureMeta.homeTeam !== "—" ? fixtureMeta.homeTeam : "Team A",
      fixtureMeta.awayTeam && fixtureMeta.awayTeam !== "—" ? fixtureMeta.awayTeam : "Team B",
      pickRow.line,
    ),
    originalPredictionText: pickRow.shadowTrackerFeedback?.originalPick || pickRow.pick,
    inputSource: getTrackedInputSource(marketKey),
    edge: trackedEdge,
    rawEdge: isFinite(pickRow.edge) ? Number(pickRow.edge) : trackedEdge,

    edgePct:
      isFinite(trackedEdge) && isFinite(trackedLine) && trackedLine !== 0
        ? Math.abs((trackedEdge / trackedLine) * 100)
        : null,

    winProbability: isFinite(pickRow.winProbability)
      ? Number(pickRow.winProbability)
      : pickRow.winProbability || null,
    latestSeenLine: null,
    latestSeenAt: null,
    lineMoveProxy: null,
    trackerImpactKey,
    trackerImpactLabel,
    trackerSoftInfluence: pickRow.trackerSoftInfluence || null,
    trackerFeedback: pickRow.trackerFeedback || null,
    shadowTrackerFeedback: pickRow.shadowTrackerFeedback || null,

    lockRestricted: !!pickRow.lockRestricted,
    confidenceGrade: grade,
    originalConfidenceGrade: String(
      pickRow.shadowTrackerFeedback?.originalConfidence || grade || "",
    ).toUpperCase(),
    modelVersion: getCurrentModelVersion(),
    configFingerprint: getLiveConfigFingerprint(league),
    isLock,
    isABQualified,
    trackerBucket: "raw",

    sampleTier,
    projectionOnly,
    hasH2H,
    volatilityValue: isFinite(volatilityValue) ? Number(volatilityValue.toFixed(2)) : null,
    volatilityBucket,
    injuryBucket,
    edgeBucket,
    lineBucket,
    gamePaceGapRisk,
    gameDefensiveFloorFlag,
    gameBlowoutGap,
    gameVolatilityBlock,
    memoryProfileKey,
    environmentKey,
    resultStatus: "pending",
    // Q-SPREAD: kept top-level (not inside diagnostics) because
    // addTrackedPicks() compresses/deletes payload.diagnostics into a
    // whitelisted godsEyeMemory object on settlement — anything only stored
    // in diagnostics would be silently lost before it could ever be
    // backtested. This is the one field this whole feature needs preserved:
    // without it, getQuarterFormBacktestStats() has nothing to bucket by.
    quarterFormAgreement: pickRow.quarterFormAgreement || null,
    marginProjection: isFinite(pickRow.marginProjection) ? Number(pickRow.marginProjection) : null,
    // Q-SPREAD: pre-haircut edge, so it's always possible to see afterward
    // exactly how much (if any) the CONTRA haircut moved the edge that
    // actually got played (or didn't, if it dropped below pointThreshold).
    rawEdge: isFinite(pickRow.rawEdge) ? Number(pickRow.rawEdge) : null,
    // A7 fix: a trackable no-play must always land in the shadow bucket,
    // never the live tracked-picks list, regardless of whether the event
    // matched — it's training data, not a bet.
    isShadow: isTrackableNoPlay ? true : !fixtureMeta.eventId,
    diagnostics: {
      ...(diagnostics || {}),
      phase2Mode:
        diagnostics?.phase2Activation?.phase2Mode || (isPhase2ShadowMode() ? "shadow" : "live"),
      phase2Activation: diagnostics?.phase2Activation || null,
      trackerImpactKey,
      trackerImpactLabel,
      trackerSoftInfluence: pickRow.trackerSoftInfluence || null,
      trackerFeedback: pickRow.trackerFeedback || null,
      shadowTrackerFeedback: pickRow.shadowTrackerFeedback || null,
    },
    createdAt: nowIso,
  };

  return payload;
}

function recordLiveCalculationSnapshot(gameId, pick, state) {
  if (!gameId) return null;
  try {
    const rawId =
      gameId && typeof gameId === "object" ? (gameId.eventId ?? gameId.id ?? gameId) : gameId;
    const key = "snapshot_" + String(rawId).replace(/[^a-z0-9_]/gi, "");
    const payload = { gameId, pick, state, capturedAt: new Date().toISOString() };
    localStorage.setItem(key, JSON.stringify(payload));
    return payload;
  } catch (e) {
    return null;
  }
}

function buildResultRows({ table, finalPicks, lockIdx, fixtureMeta, league, diagnostics }) {
  const tracked = [];
  table.style.display = "table";
  table.innerHTML =
    "<tr><th>Pick</th><th>Projection</th><th>Edge</th><th>Model Grade</th><th>Prediction</th></tr>";

  finalPicks.forEach((p, idx) => {
    const isLock = idx === lockIdx && p.pick !== "NO PLAY" && p.pick !== "NaN";
    const isNoPlay = p.pick === "NO PLAY" || p.pick === "NaN" || !p.pick;
    const isLean =
      !isNoPlay &&
      (String(p.displayPick || p.pick || "").startsWith("LEAN ") ||
        p.recommendationTier === "lean");

    const marketKeyFromLogic = getMarketKeyFromName(p.name, p.marketKey);
    if (p.marketKey === "ft" && marketKeyFromLogic !== "ft") {
      console.warn("MARKET HIJACK ATTEMPT:", {
        name: p.name,
        original: p.marketKey,
        new: marketKeyFromLogic,
      });
    }
    const pickWithCorrectKey = { ...p, marketKey: marketKeyFromLogic };
    const payload = buildTrackedPickPayload({
      pickRow: pickWithCorrectKey,
      isLock: isLock && !isNoPlay,
      fixtureMeta,
      league,
      diagnostics,
    });
    if (payload) tracked.push(payload);

    if (!isNoPlay && !isLean && isFinite(p.line) && p.line > 0 && fixtureMeta?.eventId) {
      const _snapSide = getPickSideFromText(p.pick);
      if (_snapSide) {
        recordLiveCalculationSnapshot({
          eventId: fixtureMeta.eventId,
          league,
          marketKey: marketKeyFromLogic,
          side: _snapSide,
          line: Number(p.displayLineUsed ?? p.line),
          predictionText: p.bufferedPickText || p.displayPick || p.pick,
          confidence: p.confidence || "—",
          eventDate: fixtureMeta.eventDate || "",
          homeTeam: fixtureMeta.homeTeam || "",
          awayTeam: fixtureMeta.awayTeam || "",
        });
      }
    }

    const rawDisplayPickText = isLean
      ? String(p.bufferedPickText || p.displayPick || p.pick || "").replace(/^LEAN\s+/i, "")
      : p.bufferedPickText || p.displayPick || p.pick;
    const displayPickText = formatMarginPickForDisplay(
      rawDisplayPickText,
      p.marketKey,
      fixtureMeta?.homeTeam && fixtureMeta.homeTeam !== "—" ? fixtureMeta.homeTeam : "Team A",
      fixtureMeta?.awayTeam && fixtureMeta.awayTeam !== "—" ? fixtureMeta.awayTeam : "Team B",
      p.line,
    );

    const confText = isNoPlay
      ? "NaN"
      : p.confidence === "—" || p.confidence === "NaN"
        ? "NaN"
        : p.confidence || "D";

    const shownLine = p.line;
    const shownEdge = p.edge;

    const _isMarginMarket =
      p.marketKey === "winner" ||
      p.marketKey === "handicap" ||
      p.marketKey === "handicap_h1" ||
      p.marketKey === "handicap_h2";

    const row = table.insertRow();

    const tdPick = document.createElement("td");
    const _nameStr = String(p.name || "");
    const _badgeIdx = _nameStr.indexOf("<span");
    if (_badgeIdx !== -1) {
      tdPick.appendChild(document.createTextNode(_nameStr.slice(0, _badgeIdx)));
      const _badgeEl = document.createElement("span");
      _badgeEl.innerHTML = _nameStr.slice(_badgeIdx);
      tdPick.appendChild(_badgeEl);
    } else {
      tdPick.textContent = _nameStr;
    }
    if (p.usedMemory) tdPick.appendChild(document.createTextNode(" 🧠"));
    row.appendChild(tdPick);

    const tdProj = document.createElement("td");
    if (p.marketKey === "winner") {
      // Line equivalent: HOME / AWAY (team name stays in Prediction column)
      const _rawPick = String(p.pick || p.displayPick || "").trim().toUpperCase();
      let _sideLabel = "—";
      if (_rawPick.startsWith("HOME")) _sideLabel = "HOME";
      else if (_rawPick.startsWith("AWAY")) _sideLabel = "AWAY";
      else {
        const _home = String(fixtureMeta?.homeTeam || "").trim().toLowerCase();
        const _away = String(fixtureMeta?.awayTeam || "").trim().toLowerCase();
        const _pred = String(displayPickText || p.pick || "").trim().toLowerCase();
        if (_home && (_pred === _home || _pred.includes(_home) || _home.includes(_pred))) _sideLabel = "HOME";
        else if (_away && (_pred === _away || _pred.includes(_away) || _away.includes(_pred))) _sideLabel = "AWAY";
      }
      tdProj.textContent = _sideLabel;
    } else {
      tdProj.textContent = displayLine(p.proj);
    }
    row.appendChild(tdProj);

    const tdEdge = document.createElement("td");
    tdEdge.textContent = _isMarginMarket
      ? isFinite(shownEdge)
        ? (shownEdge > 0 ? "+" : "") + shownEdge.toFixed(1)
        : "NaN"
      : isFinite(shownEdge) && isFinite(shownLine) && shownLine > 0
        ? formatEdge(shownEdge, shownLine)
        : "NaN";
    row.appendChild(tdEdge);

    const tdConf = document.createElement("td");
    const _confDisplay = isNoPlay ? "NaN" : confText;
    tdConf.className = isNoPlay ? "conf-none" : getConfidenceClass(confText);
    tdConf.textContent = _confDisplay;
    row.appendChild(tdConf);

    const tdPred = document.createElement("td");
    if (isNoPlay) {
      tdPred.className = "pred-noplay";
      tdPred.style.whiteSpace = "nowrap";
      tdPred.style.fontSize = "11px";

      tdPred.textContent = p.note ? "NO PLAY \u24d8" : "NO PLAY";
      if (p.note) tdPred.title = p.note;

      tdPred.style.opacity = "0.55";
    } else {
      tdPred.className = getPredictionClass(p.pick);
      tdPred.style.whiteSpace = "nowrap";
      tdPred.style.fontSize = "11px";

      const predContainer = document.createElement("div");
      predContainer.style.display = "inline-block";

      const predSpan = document.createElement("span");
      predSpan.textContent = displayPickText;
      predSpan.style.cursor = "pointer";

      if (isLock) {
        const lockSpan = document.createElement("span");
        lockSpan.className = "lock";
        lockSpan.textContent = "🔒";
        predSpan.appendChild(document.createTextNode(" "));
        predSpan.appendChild(lockSpan);
      }

      const details = buildPickExplanationDetails(p, isLock);
      details.open = false;

      predSpan.addEventListener("click", function (e) {
        e.stopPropagation();
        details.open = !details.open;
      });
      predContainer.appendChild(predSpan);
      predContainer.appendChild(details);
      tdPred.appendChild(predContainer);
    }
    row.appendChild(tdPred);
  });

  return tracked;
}

function getMassacreTeamContext(side, parsed) {
  const data =
    side === "A"
      ? {
          ftScored: safeArr(parsed.aFTScored) || [],
          ftAllowed: [],
          h1Scored: safeArr(parsed.a1HScored) || [],
          h1Allowed: [],
          venueFTScored: [],
          venueFTAllowed: [],
          venueH1Scored: [],
          venueH1Allowed: [],
        }
      : {
          ftScored: safeArr(parsed.bFTScored) || [],
          ftAllowed: [],
          h1Scored: safeArr(parsed.b1HScored) || [],
          h1Allowed: [],
          venueFTScored: [],
          venueFTAllowed: [],
          venueH1Scored: [],
          venueH1Allowed: [],
        };

  const ctx = AppState.context.data?.[side] || {};
  const overall = ctx.overall || {};
  const venue = ctx.venue || {};

  return {
    ftScored10:
      Array.isArray(overall.ftScored10) && overall.ftScored10.length
        ? overall.ftScored10
        : data.ftScored,
    ftAllowed10:
      Array.isArray(overall.ftAllowed10) && overall.ftAllowed10.length
        ? overall.ftAllowed10
        : data.ftAllowed,
    h1Scored10:
      Array.isArray(overall.h1Scored10) && overall.h1Scored10.length
        ? overall.h1Scored10
        : data.h1Scored,
    h1Allowed10:
      Array.isArray(overall.h1Allowed10) && overall.h1Allowed10.length
        ? overall.h1Allowed10
        : data.h1Allowed,

    venueFTScored10:
      Array.isArray(venue.ftScored10) && venue.ftScored10.length
        ? venue.ftScored10
        : data.venueFTScored,
    venueFTAllowed10:
      Array.isArray(venue.ftAllowed10) && venue.ftAllowed10.length
        ? venue.ftAllowed10
        : data.venueFTAllowed,
    venueH1Scored10:
      Array.isArray(venue.h1Scored10) && venue.h1Scored10.length
        ? venue.h1Scored10
        : data.venueH1Scored,
    venueH1Allowed10:
      Array.isArray(venue.h1Allowed10) && venue.h1Allowed10.length
        ? venue.h1Allowed10
        : data.venueH1Allowed,

    ftScored5: data.ftScored,
    ftAllowed5: data.ftAllowed,
    h1Scored5: data.h1Scored,
    h1Allowed5: data.h1Allowed,
    venueFTScored5: data.venueFTScored,
    venueFTAllowed5: data.venueFTAllowed,
    venueH1Scored5: data.venueH1Scored,
    venueH1Allowed5: data.venueH1Allowed,

    restDays: ctx.restDays,
    lastGameDate: ctx.lastGameDate || "",
  };
}

function withErrorBoundary(fn, context) {
  return async function (...args) {
    try {
      return await fn.apply(this, args);
    } catch (err) {
      const msg = err?.message || String(err);
      if (typeof engineDebug === "function")
        engineDebug("ERROR BOUNDARY [" + context + "]: " + msg, { stack: err?.stack });
      if (typeof triggerGlobalEngineAlert === "function")
        triggerGlobalEngineAlert(context + " crashed: " + msg);
      const t = document.getElementById("results");

      if (t) {
        t.style.display = "table";
        const row = t.insertRow();
        row.innerHTML = `<td colspan="5" style="color:#ff6b6b;text-align:left;padding:8px;">⚠ <b>${escapeHtml(context)}</b> hit an error: ${escapeHtml(msg)}</td>`;
      }
      const rb = document.getElementById("runBtn");
      if (rb) rb.disabled = false;
      return null;
    }
  };
}

function extractInputs(league) {
  const isNbaOrNcaa =
    league === "nba" || league === "wnba" || league === "wnba_pre" || league === "ncaa";
  function readLine(id) {
    const v = parseMarketLine((document.getElementById(id)?.value || "").trim());
    return isFinite(v) ? v : null;
  }

  function readHandicapLine(id) {
    const v = parseHandicapLine((document.getElementById(id)?.value || "").trim());
    return isFinite(v) ? v : null;
  }
  function readSeries(id) {
    return (document.getElementById(id)?.value || "").trim() ? parseGames(id) : null;
  }
  const h1Line = readLine("h1Market");
  const ftLine = readLine("ftMarket");

  const h2Line = readLine("h2Market");
  const parsed = {
    aFTScored: readSeries("aFTScored"),
    aFTAllowed: readSeries("aFTAllowed"),
    bFTScored: readSeries("bFTScored"),
    bFTAllowed: readSeries("bFTAllowed"),
    a1HScored: readSeries("a1HScored"),
    a1HAllowed: readSeries("a1HAllowed"),
    b1HScored: readSeries("b1HScored"),
    b1HAllowed: readSeries("b1HAllowed"),
    aQ1Scored: readSeries("aQ1Scored"),
    aQ1Allowed: readSeries("aQ1Allowed"),
    aQ2Scored: readSeries("aQ2Scored"),
    aQ2Allowed: readSeries("aQ2Allowed"),
    aQ3Scored: readSeries("aQ3Scored"),
    aQ3Allowed: readSeries("aQ3Allowed"),
    aQ4Scored: readSeries("aQ4Scored"),
    aQ4Allowed: readSeries("aQ4Allowed"),
    bQ1Scored: readSeries("bQ1Scored"),
    bQ1Allowed: readSeries("bQ1Allowed"),
    bQ2Scored: readSeries("bQ2Scored"),
    bQ2Allowed: readSeries("bQ2Allowed"),
    bQ3Scored: readSeries("bQ3Scored"),
    bQ3Allowed: readSeries("bQ3Allowed"),
    bQ4Scored: readSeries("bQ4Scored"),
    bQ4Allowed: readSeries("bQ4Allowed"),
    aFTH2H: readSeries("aFTH2H"),
    bFTH2H: readSeries("bFTH2H"),
    a1HH2H: readSeries("a1HH2H"),
    b1HH2H: readSeries("b1HH2H"),
    aQ1H2H: readSeries("aQ1H2H"),
    bQ1H2H: readSeries("bQ1H2H"),
    aQ2H2H: readSeries("aQ2H2H"),
    bQ2H2H: readSeries("bQ2H2H"),
    aQ3H2H: readSeries("aQ3H2H"),
    bQ3H2H: readSeries("bQ3H2H"),
    aQ4H2H: readSeries("aQ4H2H"),
    bQ4H2H: readSeries("bQ4H2H"),
    aFTScoredHome: readSeries("aFTScoredHome"),
    aFTAllowedHome: readSeries("aFTAllowedHome"),
    aFTScoredAway: readSeries("aFTScoredAway"),
    aFTAllowedAway: readSeries("aFTAllowedAway"),
    bFTScoredHome: readSeries("bFTScoredHome"),
    bFTAllowedHome: readSeries("bFTAllowedHome"),
    bFTScoredAway: readSeries("bFTScoredAway"),
    bFTAllowedAway: readSeries("bFTAllowedAway"),
  };
  const lines = {
    ftLine,
    h1Line,

    h2Line,

    aLine: readLine("teamAMarket"),
    bLine: readLine("teamBMarket"),
    q1aLine: readLine("q1TeamAMarket"),
    q1bLine: readLine("q1TeamBMarket"),
    h1aLine: readLine("h1TeamAMarket"),
    h1bLine: readLine("h1TeamBMarket"),
    highQLine: readLine("highQTotalMarket"),
    lowQLine: readLine("lowQTotalMarket"),

    handicapLine: readHandicapLine("handicapMarket"),

    handicapH1Line: readHandicapLine("handicapH1Market"),
    handicapH2Line: readHandicapLine("handicapH2Market"),
  };
  return { parsed, lines };
}

function validateExtractedInputs(extracted, league) {
  const errors = [];
  if (!league) return { ok: false, errorHtml: "⚠ Select a league first." };
  const { parsed } = extracted;
  const normA = normalizeTeamName(document.getElementById("teamAName")?.value || "");
  const normB = normalizeTeamName(document.getElementById("teamBName")?.value || "");
  const tAId = String(selectedTeamIds?.A || "");
  const tBId = String(selectedTeamIds?.B || "");
  if ((tAId && tAId === tBId) || (normA && normA === normB))
    errors.push("Team A and Team B cannot be the same team.");
  function chk(s, lbl) {
    if (s?.err) errors.push(`<b>${lbl}:</b> ${s.err}`);
  }
  chk(parsed.aFTScored, "Team A FT Scored");
  chk(parsed.aFTAllowed, "Team A FT Allowed");
  chk(parsed.bFTScored, "Team B FT Scored");
  chk(parsed.bFTAllowed, "Team B FT Allowed");
  chk(parsed.a1HScored, "Team A 1H Scored");
  chk(parsed.a1HAllowed, "Team A 1H Allowed");
  chk(parsed.b1HScored, "Team B 1H Scored");
  chk(parsed.b1HAllowed, "Team B 1H Allowed");
  chk(parsed.aFTH2H, "FT H2H (A)");
  chk(parsed.bFTH2H, "FT H2H (B)");
  chk(parsed.a1HH2H, "1H H2H (A)");
  chk(parsed.b1HH2H, "1H H2H (B)");
  ["Q1", "Q2", "Q3", "Q4"].forEach((q) => {
    chk(parsed[`aQ${q}H2H`], q + " H2H (A)");
    chk(parsed[`bQ${q}H2H`], q + " H2H (B)");
  });
  const lineWarnings = validateLinesFromExtracted(league, extracted.lines || {});
  lineWarnings.forEach((w) => errors.push(w));

  if (errors.length)
    return { ok: false, errorHtml: "⚠ <b>Input Errors:</b><br>" + errors.join("<br>") };
  return { ok: true };
}
function captureAllInputs() {
  const inputs = {};

  const ids = [
    "leagueSelect",
    "teamAName",
    "teamBName",
    "aFTScored",
    "aFTAllowed",
    "bFTScored",
    "bFTAllowed",
    "a1HScored",
    "a1HAllowed",
    "b1HScored",
    "b1HAllowed",
    "aQ1Scored",
    "aQ1Allowed",
    "aQ2Scored",
    "aQ2Allowed",
    "aQ3Scored",
    "aQ3Allowed",
    "aQ4Scored",
    "aQ4Allowed",
    "bQ1Scored",
    "bQ1Allowed",
    "bQ2Scored",
    "bQ2Allowed",
    "bQ3Scored",
    "bQ3Allowed",
    "bQ4Scored",
    "bQ4Allowed",
    "aFTH2H",
    "bFTH2H",
    "a1HH2H",
    "b1HH2H",
    "aQ1H2H",
    "bQ1H2H",
    "aQ2H2H",
    "bQ2H2H",
    "aQ3H2H",
    "bQ3H2H",
    "aQ4H2H",
    "bQ4H2H",
    "aFTScoredHome",
    "aFTAllowedHome",
    "aFTScoredAway",
    "aFTAllowedAway",
    "bFTScoredHome",
    "bFTAllowedHome",
    "bFTScoredAway",
    "bFTAllowedAway",
    "ftMarket",
    "h1Market",
    "teamAMarket",
    "teamBMarket",
    "q1Market",
    "q2Market",
    "q3Market",
    "q4Market",
    "h1TeamAMarket",
    "h1TeamBMarket",
    "q1TeamAMarket",
    "q1TeamBMarket",
    "highQTotalMarket",
    "lowQTotalMarket",
    "ssTeamAName",
    "ssTeamAId",
    "ssTeamBName",
    "ssTeamBId",
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      if (el.type === "checkbox") inputs[id] = el.checked;
      else inputs[id] = el.value;
    } else {
      inputs[id] = null;
    }
  });

  ["useFTH2H", "use1HH2H", "useQ1H2H", "useQ2H2H", "useQ3H2H", "useQ4H2H"].forEach((id) => {
    inputs[id] = document.getElementById(id)?.checked || false;
  });
  return inputs;
}
// Forensic harness adapters: top-level function declarations are global in
// classic scripts, but explicit window binding guarantees auditor discovery
// and dynamic probes (computeFTProjection return shape: ftProj/projAFT/projBFT).
try {
  if (typeof computeFTProjection === "function") window.computeFTProjection = computeFTProjection;
  if (typeof compute1HProjection === "function") window.compute1HProjection = compute1HProjection;
  if (typeof compute2HProjection === "function") window.compute2HProjection = compute2HProjection;
  if (typeof getPick === "function") window.getPick = getPick;
  if (typeof getConfidenceGrade === "function") window.getConfidenceGrade = getConfidenceGrade;
  if (typeof getH2HWeight === "function") window.getH2HWeight = getH2HWeight;
  if (typeof applyVolatility === "function") window.applyVolatility = applyVolatility;
  if (typeof buildConfidenceFeatures === "function") window.buildConfidenceFeatures = buildConfidenceFeatures;
  if (typeof resolveConfidenceGradeFromWinProbability === "function")
    window.resolveConfidenceGradeFromWinProbability = resolveConfidenceGradeFromWinProbability;
  if (typeof filterEventsAsOf === "function") window.filterEventsAsOf = filterEventsAsOf;
} catch (_exposeErr) {}

async function runEngine() {
  window.__engineInvariantFailed = false;
  window.__engineInvariantFailure = null;
  const runBtn = document.getElementById("runBtn");
  const table = document.getElementById("results");

  const leagueSelectEl = document.getElementById("leagueSelect");
  const currentLeagueForRun = leagueSelectEl ? leagueSelectEl.value : "";

  if (AppState.context.data.league && AppState.context.data.league !== currentLeagueForRun) {
    engineDebug("runEngine: clearing stale massacre context", {
      old: AppState.context.data.league,
      new: currentLeagueForRun,
    });
    AppState.context.data = defaultMassacreFetchContext();
    AppState.context.data.league = currentLeagueForRun;
  }

  const _lockFt =
    typeof hasLockedConfig === "function" && currentLeagueForRun
      ? hasLockedConfig(currentLeagueForRun, "ft")
      : false;
  const _lockH1 =
    typeof hasLockedConfig === "function" && currentLeagueForRun
      ? hasLockedConfig(currentLeagueForRun, "h1")
      : false;
  window.__liveLockActive = { league: currentLeagueForRun, ft: _lockFt, h1: _lockH1 };

  if (_lockFt || _lockH1) {
    window.__phase2FTRecencyWeights = null;
    window.__phase2PaceAdjustment = "standard";
    window.__phase2H1RecencyWeights = null;
    if (typeof engineDebug === "function") {
      engineDebug("PHASE 7: using Lock Store", {
        league: currentLeagueForRun,
        ftLocked: _lockFt,
        h1Locked: _lockH1,
        ftMeta:
          _lockFt && typeof getLockedConfigMeta === "function"
            ? getLockedConfigMeta(currentLeagueForRun, "ft")
            : null,
        h1Meta:
          _lockH1 && typeof getLockedConfigMeta === "function"
            ? getLockedConfigMeta(currentLeagueForRun, "h1")
            : null,
      });
    }
  } else
    try {
      let ftSiloTunings = {},
        h1SiloTunings = {},
        allSiloTunings = {};
      try {
        ftSiloTunings = JSON.parse(localStorage.getItem("BB_VERIFIED_TUNINGS_FT")) || {};
        h1SiloTunings = JSON.parse(localStorage.getItem("BB_VERIFIED_TUNINGS_H1")) || {};
        allSiloTunings = JSON.parse(localStorage.getItem("BB_VERIFIED_TUNINGS")) || {};
      } catch (e) {
        engineDebug("runEngine failed to read verified tunings: " + (e?.message || String(e)), {
          error: e,
        });
      }

      const activeFTConfig =
        ftSiloTunings[currentLeagueForRun] || allSiloTunings[currentLeagueForRun];
      const activeH1Config =
        h1SiloTunings[currentLeagueForRun] || allSiloTunings[currentLeagueForRun];

      try {
        if (activeFTConfig && activeFTConfig.verified) {
          window.__phase2FTRecencyWeights = activeFTConfig.recencyWeights || [
            1.35, 1.2, 1.0, 0.85, 0.7,
          ];
          window.__phase2PaceAdjustment = activeFTConfig.paceAdjustment || "aggressive";
          window.__phase2H1RecencyWeights =
            activeH1Config && activeH1Config.verified
              ? activeH1Config.recencyWeights || window.__phase2FTRecencyWeights
              : null;
        } else {
          window.__phase2FTRecencyWeights = null;
          window.__phase2PaceAdjustment = "standard";
          window.__phase2H1RecencyWeights = null;
        }
      } catch (e) {
        engineDebug(
          "runEngine failed to apply verified config to tuning: " + (e?.message || String(e)),
          { error: e },
        );
        window.__phase2FTRecencyWeights = null;
        window.__phase2PaceAdjustment = "standard";
        window.__phase2H1RecencyWeights = null;
      }
    } catch (e) {
      engineDebug("runEngine failed during phase2 tuning setup: " + (e?.message || String(e)), {
        error: e,
      });
      window.__phase2FTRecencyWeights = null;
      window.__phase2PaceAdjustment = null;
      window.__phase2H1RecencyWeights = null;
    }

  g_engineDebugLog.unshift(
    `[${new Date().toLocaleTimeString([], { hour12: false })}] ══ NEW RUN ══`,
  );
  if (g_engineDebugLog.length > ENGINE_DEBUG_LIMIT) {
    g_engineDebugLog = g_engineDebugLog.slice(0, ENGINE_DEBUG_LIMIT);
  }
  acknowledgeGlobalEngineAlert();
  renderEngineDebugPanel();
  if (runBtn) runBtn.disabled = true;

  const _savedRecencyWeights = [...MODEL_TUNING.recencyWeights];
  engineDebug("run start", {
    trackerKey: getTrackerUserKey(),
    trackerState: getTrackerStateDebugScore(g_trackerState),
    build: APP_BUILD_VERSION,
  });

  try {
    const _localState = await loadTrackerStateFromLocal();
    if (_localState) {
      const _merged = mergeTrackerStates(g_trackerState, _localState);
      normalizeTrackerState(_merged);
    }

    engineDebug("tracker primed for run", {
      trackerState: getTrackerStateDebugScore(g_trackerState),
    });

    if (!table) return;

    table.style.display = "table";
    table.innerHTML =
      "<tr><th>Pick</th><th>Projection</th><th>Edge</th><th>Model Grade</th><th>Prediction</th></tr>";

    const league = document.getElementById("leagueSelect")?.value || "";
    const isNba = league === "nba";
    const isNbaOrNcaa = ["nba", "wnba", "wnba_pre", "ncaa", "ncaaw", "nba_gl"].includes(league);

    if (!league) {
      engineDebug("run blocked missing league");
      showRunError(table, "⚠ Select a league first.");
      return;
    }

    const teamAId = String(selectedTeamIds.A || "");
    const teamBId = String(selectedTeamIds.B || "");
    const teamANameNorm = normalizeTeamName(document.getElementById("teamAName")?.value || "");
    const teamBNameNorm = normalizeTeamName(document.getElementById("teamBName")?.value || "");

    const isDuplicate =
      (teamAId && teamAId === teamBId) || (teamANameNorm && teamANameNorm === teamBNameNorm);

    if (isDuplicate) {
      engineDebug("run blocked duplicate teams", { teamAId, teamBId, teamANameNorm });
      showRunError(table, "⚠ Team A and Team B cannot be the same.");
      return;
    }

    window.__engineRunInProgress = true;
    const _extracted = extractInputs(league);
    const validation = validateExtractedInputs(_extracted, league);
    if (!validation.ok) {
      engineDebug("validation failed", { league, errorHtml: validation.errorHtml });
      showRunError(table, validation.errorHtml);
      return;
    }

    const { parsed, lines } = _extracted;
    const fixtureMeta = getCurrentFixtureMeta();
    engineDebug("validation passed", {
      league,
      fixture: summarizeFixtureMetaForDebug(fixtureMeta),
      sourceMeta: summarizeFetchMetaForDebug(),
      rawLines: lines,
      parsed: summarizeParsedForDebug(parsed),
    });

    const baseLines = Object.freeze({
      ftLine: lines.ftLine,
      h1Line: lines.h1Line,
      aLine: lines.aLine,
      bLine: lines.bLine,
    });

    let verifiedFtConfig = getVerifiedConfig(league, "ft");
    let verifiedH1Config = getVerifiedConfig(league, "h1");

    const _runFTWeights =
      window.__phase2FTRecencyWeights || getLeagueRecencyDefaults(currentLeagueForRun);
    const _runH1Weights = window.__phase2H1RecencyWeights || _runFTWeights;
    MODEL_TUNING.recencyWeights = _runFTWeights;

    const baseFtCalc = computeFTProjection({
      league,
      parsed,
      lines: baseLines,
      injMultA: AppState.injuries.A.scoringMult,
      injMultB: AppState.injuries.B.scoringMult,
      contextData: AppState.context?.data || null,
    });

    MODEL_TUNING.recencyWeights = _runH1Weights;

    const baseH1Calc = compute1HProjection({
      league,
      parsed,
      lines: baseLines,
      injMultA: AppState.injuries.A.scoringMult,
      injMultB: AppState.injuries.B.scoringMult,
    });
    MODEL_TUNING.recencyWeights = _runFTWeights;

    const globalModelState = buildGlobalModelState({
      league,
      parsed,
      lines: baseLines,
      injMultA: AppState.injuries.A.scoringMult,
      injMultB: AppState.injuries.B.scoringMult,
    });

    engineDebug("projection pass 1", {
      ft: summarizeCalcForDebug(baseFtCalc),
      h1: summarizeCalcForDebug(baseH1Calc),
    });

    const finalLines = Object.freeze({
      ftLine: baseLines.ftLine,
      h1Line: baseLines.h1Line,

      h2Line: lines.h2Line,
      aLine: baseLines.aLine,
      bLine: baseLines.bLine,
      q1aLine: lines.q1aLine,
      q1bLine: lines.q1bLine,
      h1aLine: lines.h1aLine,
      h1bLine: lines.h1bLine,
      highQLine: lines.highQLine,
      lowQLine: lines.lowQLine,
      raceRange: lines.raceRange,

      handicapLine: lines.handicapLine,

      handicapH1Line: lines.handicapH1Line,
      handicapH2Line: lines.handicapH2Line,
    });

    const memoryFlags = {
      ft: false,
      h1: false,
      team_a: false,
      team_b: false,
    };

    function buildConfigFromVerifiedKey(configKey) {
      if (!configKey) return {};
      const parts = configKey.split("_");
      const result = {};
      for (const part of parts) {
        if (part.startsWith("h2h")) result.h2hFactor = parseFloat(part.slice(3));
        else if (part.startsWith("rec")) {
          const recType = part.slice(3);
          if (recType === "std") result.recencyProfile = TUNING_GRID.recencyProfiles[0];
          else if (recType === "agg") result.recencyProfile = TUNING_GRID.recencyProfiles[1];
          else if (recType === "flat") result.recencyProfile = TUNING_GRID.recencyProfiles[2];
        } else if (part.startsWith("pace")) result.paceDampening = parseFloat(part.slice(4));
        else if (part.startsWith("edge")) result.edgeMult = parseFloat(part.slice(4));
        else if (part.startsWith("inj")) result.injuryMult = parseFloat(part.slice(3));
      }
      return result;
    }

    let ftConfigOverride = {};
    let h1ConfigOverride = {};

    if (verifiedFtConfig && verifiedFtConfig.configKey) {
      ftConfigOverride = buildConfigFromVerifiedKey(verifiedFtConfig.configKey);
    }
    if (verifiedH1Config && verifiedH1Config.configKey) {
      h1ConfigOverride = buildConfigFromVerifiedKey(verifiedH1Config.configKey);
    }

    MODEL_TUNING.recencyWeights = ftConfigOverride.recencyProfile || _runFTWeights;

    const _dynWeights = getDynamicWeights(
      baseFtCalc.ftSampleTier,
      globalModelState?.volState?.combinedVolRatio ?? 0.5,
      league,
    );

    const ftCalc = computeFTProjection({
      league,
      parsed,
      lines: finalLines,
      injMultA: AppState.injuries.A.scoringMult,
      injMultB: AppState.injuries.B.scoringMult,
      config: {
        ...ftConfigOverride,
        teamWeight: _dynWeights.teamWeight,
        oppWeight: _dynWeights.oppWeight,
      },
      contextData: AppState.context?.data || null,
    });
    ftCalc.volatilityBlock = false;

    MODEL_TUNING.recencyWeights = h1ConfigOverride.recencyProfile || _runH1Weights;

    const _h1PreSampleA = getManualSeries("A", "h1", parsed);
    const _h1PreSampleB = getManualSeries("B", "h1", parsed);

    const _h1VolRatio = (function () {
      try {
        const volLim = getMarketVolLimit(league, "h1");
        // FIX (CRITICAL #9): sqrt(a^2+b^2), matching compute1HProjection's
        // own internal combined-volatility convention, instead of max().
        const aVol = getVolatilityRatioForSeries(_h1PreSampleA, volLim);
        const bVol = getVolatilityRatioForSeries(_h1PreSampleB, volLim);
        return clampNumber(
          Math.sqrt((isFinite(aVol) ? aVol : 0) ** 2 + (isFinite(bVol) ? bVol : 0) ** 2),
          0.5,
          2.5,
        );
      } catch (e) {
        return globalModelState?.volState?.combinedVolRatio ?? 0.5;
      }
    })();
    const _dynWeightsH1 = getDynamicWeights(
      getSampleTier(_h1PreSampleA, _h1PreSampleB),
      _h1VolRatio,
      league,
    );

    const h1Calc = compute1HProjection({
      league,
      parsed,
      lines: finalLines,
      injMultA: AppState.injuries.A.scoringMult,
      injMultB: AppState.injuries.B.scoringMult,
      config: {
        ...h1ConfigOverride,
        teamWeight: _dynWeightsH1.teamWeight,
        oppWeight: _dynWeightsH1.oppWeight,
      },
    });

    const _h2PreSampleA = getManualSeries("A", "h2", parsed);
    const _h2PreSampleB = getManualSeries("B", "h2", parsed);

    const _h2VolRatio = (function () {
      try {
        const volLim = getMarketVolLimit(league, "h2");
        const aVol = getVolatilityRatioForSeries(_h2PreSampleA, volLim);
        const bVol = getVolatilityRatioForSeries(_h2PreSampleB, volLim);
        // FIX (CRITICAL #9): sqrt(a^2+b^2), mirrors the H1 fix above.
        return clampNumber(
          Math.sqrt((isFinite(aVol) ? aVol : 0) ** 2 + (isFinite(bVol) ? bVol : 0) ** 2),
          0.5,
          2.5,
        );
      } catch (e) {
        return globalModelState?.volState?.combinedVolRatio ?? 0.5;
      }
    })();
    const _dynWeightsH2 = getDynamicWeights(
      getSampleTier(_h2PreSampleA, _h2PreSampleB),
      _h2VolRatio,
      league,
    );
    const h2Calc = compute2HProjection({
      league,
      parsed,
      lines: finalLines,
      injMultA: AppState.injuries.A.scoringMult,
      injMultB: AppState.injuries.B.scoringMult,
      config: { teamWeight: _dynWeightsH2.teamWeight, oppWeight: _dynWeightsH2.oppWeight },
    });

    const _h2ReconFT = isFinite(ftCalc.ftProj) ? ftCalc.ftProj : NaN;
    const _h2ReconH1 = isFinite(h1Calc.h1Proj) ? h1Calc.h1Proj : NaN;
    const _h2ReconH2 = isFinite(h2Calc.h2Proj) ? h2Calc.h2Proj : NaN;
    const _h2ReconGap =
      isFinite(_h2ReconFT) && isFinite(_h2ReconH1) && isFinite(_h2ReconH2)
        ? _h2ReconFT - (_h2ReconH1 + _h2ReconH2)
        : NaN;
    if (isFinite(_h2ReconGap) && typeof engineDebug === "function") {
      engineDebug("2H reconciliation diagnostic (FT − (H1+2H))", {
        ftProj: _h2ReconFT,
        h1Proj: _h2ReconH1,
        h2Proj: _h2ReconH2,
        gap: _h2ReconGap,
      });
    }

    engineDebug("line resolution", {
      resolvedLines: finalLines,
    });

    const { ftLine, h1Line, aLine, bLine } = finalLines;

    engineDebug("projection pass 2", {
      ft: summarizeCalcForDebug(ftCalc),
      h1: summarizeCalcForDebug(h1Calc),
      h2: {
        h2Proj: h2Calc.h2Proj,
        projA2H: h2Calc.projA2H,
        projB2H: h2Calc.projB2H,
        h2SampleTier: h2Calc.h2SampleTier,
        reconGap: _h2ReconGap,
      },
    });

    g_currentLiveComputeMarket = "ft";
    let ftPick = getPick(ftCalc.ftEdge, ftLine, league, "ft", {
      aSc: ftCalc.aS,
      bSc: ftCalc.bS,
      aScScores: ftCalc.aScores,
      bScScores: ftCalc.bScores,
      blowoutGap: ftCalc.blowoutGap,
    });
    g_currentLiveComputeMarket = "h1";
    let h1Pick = getPick(h1Calc.h1Edge, h1Line, league, "h1", {
      aSc: h1Calc.aS1,
      bSc: h1Calc.bS1,
      // FIX (MEDIUM): blowoutGap was computed for H1's confidence grade but
      // never passed to getPick, so the blowout-risk threshold escalation
      // that already applies to FT/team_a/team_b silently didn't apply here.
      blowoutGap: Math.abs((h1Calc.projA1H || 0) - (h1Calc.projB1H || 0)),
    });

    g_currentLiveComputeMarket = "h2";
    const h2Line = finalLines.h2Line;
    let h2Pick = getPick(h2Calc.h2Edge, h2Line, league, "h2", {
      aSc: h2Calc.aS2,
      bSc: h2Calc.bS2,
      // FIX (MEDIUM): mirrors the h1Pick fix above.
      blowoutGap: Math.abs((h2Calc.projA2H || 0) - (h2Calc.projB2H || 0)),
    });
    g_currentLiveComputeMarket = "team_a";
    let aPick = getPick(ftCalc.aEdge, aLine, league, "team_a", {
      teamSc: ftCalc.aS,
      blowoutGap: ftCalc.blowoutGap,
    });
    g_currentLiveComputeMarket = "team_b";
    let bPick = getPick(ftCalc.bEdge, bLine, league, "team_b", {
      teamSc: ftCalc.bS,
      blowoutGap: ftCalc.blowoutGap,
    });

    const marginProjectionFT = computeMarginProjection(ftCalc.projAFT, ftCalc.projBFT);
    const combinedMarginVolFT = computeCombinedMarginVolatility(ftCalc.aVol, ftCalc.bVol);
    const winnerEdge = marginProjectionFT;
    g_currentLiveComputeMarket = "winner";
    let winnerPick = getMarginPick(winnerEdge, league, "winner");
    const handicapEdge =
      isFinite(marginProjectionFT) && isFinite(finalLines.handicapLine)
        ? marginProjectionFT + finalLines.handicapLine
        : NaN;
    g_currentLiveComputeMarket = "handicap";
    let handicapPick = getMarginPick(handicapEdge, league, "handicap");

    const marginProjectionH1 = computeMarginProjection(h1Calc.projA1H, h1Calc.projB1H);
    const _h1VolLimitForMargin = getMarketVolLimit(league, "h1");
    const combinedMarginVolH1 = computeCombinedMarginVolatility(
      (h1Calc.aVol1 || 0) * _h1VolLimitForMargin,
      (h1Calc.bVol1 || 0) * _h1VolLimitForMargin,
    );
    const handicapH1Edge =
      isFinite(marginProjectionH1) && isFinite(finalLines.handicapH1Line)
        ? marginProjectionH1 + finalLines.handicapH1Line
        : NaN;
    g_currentLiveComputeMarket = "handicap_h1";
    let handicapH1Pick = getMarginPick(handicapH1Edge, league, "handicap_h1");
    const marginProjectionH2 = computeMarginProjection(h2Calc.projA2H, h2Calc.projB2H);
    const _h2VolLimitForMargin = getMarketVolLimit(league, "h2");
    const combinedMarginVolH2 = computeCombinedMarginVolatility(
      (h2Calc.aVol2 || 0) * _h2VolLimitForMargin,
      (h2Calc.bVol2 || 0) * _h2VolLimitForMargin,
    );
    const handicapH2Edge =
      isFinite(marginProjectionH2) && isFinite(finalLines.handicapH2Line)
        ? marginProjectionH2 + finalLines.handicapH2Line
        : NaN;
    g_currentLiveComputeMarket = "handicap_h2";
    let handicapH2Pick = getMarginPick(handicapH2Edge, league, "handicap_h2");
    g_currentLiveComputeMarket = "ft";
    const h1aEdge =
      isFinite(h1Calc.projA1H) && isFinite(finalLines.h1aLine) && finalLines.h1aLine > 0
        ? h1Calc.projA1H - finalLines.h1aLine
        : NaN;
    const h1bEdge =
      isFinite(h1Calc.projB1H) && isFinite(finalLines.h1bLine) && finalLines.h1bLine > 0
        ? h1Calc.projB1H - finalLines.h1bLine
        : NaN;

    let h1aPick = getPick(h1aEdge, finalLines.h1aLine, league, "h1", { teamSc: h1Calc.aS1 });
    let h1bPick = getPick(h1bEdge, finalLines.h1bLine, league, "h1", { teamSc: h1Calc.bS1 });

    const hasLevel2 =
      AppState.context.data.A.ortg10?.length >= 1 && AppState.context.data.B.ortg10?.length >= 1;
    const hasManual1H =
      safeArr(parsed.a1HScored)?.length >= 2 && safeArr(parsed.b1HScored)?.length >= 2;

    if (
      (league === "nba" ||
        league === "wnba" ||
        league === "wnba_pre" ||
        league === "ncaa" ||
        league === "ncaaw" ||
        league === "nba_gl") &&
      !hasLevel2 &&
      !hasManual1H
    ) {
      h1Pick = "NO PLAY";
      h1aPick = "NO PLAY";
      h1bPick = "NO PLAY";
      h1Calc.projA1H = NaN;
      h1Calc.projB1H = NaN;
    }

    const computeQ = (
      qKey,
      lineVal,
      injA = g_injA.scoringMult,
      injB = g_injB.scoringMult,
      config = {},
    ) => {
      g_currentLiveComputeMarket = qKey;

      const aS = getManualSeries("A", qKey, parsed);
      const bS = getManualSeries("B", qKey, parsed);

      const _dateAwareAvgAQ = getDateAwareOrFallbackAverage(aS, "A", qKey);
      const _dateAwareAvgBQ = getDateAwareOrFallbackAverage(bS, "B", qKey);

      const pKeyA = "a" + qKey.toUpperCase() + "Allowed";
      const pKeyB = "b" + qKey.toUpperCase() + "Allowed";
      const aA =
        parsed[pKeyA] && parsed[pKeyA].length
          ? parsed[pKeyA]
          : AppState.context.data.A[qKey + "Allowed"] || [];
      const bA =
        parsed[pKeyB] && parsed[pKeyB].length
          ? parsed[pKeyB]
          : AppState.context.data.B[qKey + "Allowed"] || [];

      const volLimit = getMarketVolLimit(league, qKey);
      const sampleSize = Math.min(aS.length, bS.length);

      const leagueBaseQ = getLeagueScoreBase(league) / 8;

      const ctxAQ = AppState.context.data?.A || {};
      const ctxBQ = AppState.context.data?.B || {};

      const hasAdvancedQ =
        isFinite(avgOrNaN(ctxAQ.ortg10)) &&
        isFinite(avgOrNaN(ctxAQ.drtg10)) &&
        isFinite(avgOrNaN(ctxBQ.ortg10)) &&
        isFinite(avgOrNaN(ctxBQ.drtg10)) &&
        isFinite(avgOrNaN(ctxAQ.pace10)) &&
        avgOrNaN(ctxAQ.pace10) > 0 &&
        isFinite(avgOrNaN(ctxBQ.pace10)) &&
        avgOrNaN(ctxBQ.pace10) > 0 &&
        (ctxAQ.ortg10 || []).length >= 5 &&
        (ctxBQ.ortg10 || []).length >= 5;

      const leaguePaceBaseQ =
        LEAGUE_PACE_BASES[league] ||
        LEAGUE_PACE_BASES.default ||
        74 * ((LEAGUE_BASES[league] || LEAGUE_BASES.unknown) / LEAGUE_BASES.unknown);
      const leagueRatingBaseQ =
        LEAGUE_RATING_BASES[league] ||
        LEAGUE_RATING_BASES.default *
          ((LEAGUE_BASES[league] || LEAGUE_BASES.unknown) / LEAGUE_BASES.unknown) ||
        110;

      const isEspnLeagueQ = Object.prototype.hasOwnProperty.call(ESPN_LEAGUE_SLUGS, league);

      let projA, projB;
      const _dynWeightsQ = getDynamicWeights(
        getSampleTier(aS, bS),
        globalModelState?.volState?.combinedVolRatio ?? 0.5,
        league,
      );
      const _twQ = isFinite(_dynWeightsQ?.teamWeight) ? Number(_dynWeightsQ.teamWeight) : 0.65;
      const _owQ = 1 - _twQ;
      const projA_pts = anchorProjection(
        _dateAwareAvgAQ * _twQ + avgOrNaN(bA) * _owQ,
        sampleSize,
        leagueBaseQ,
      );
      const projB_pts = anchorProjection(
        _dateAwareAvgBQ * _twQ + avgOrNaN(aA) * _owQ,
        sampleSize,
        leagueBaseQ,
      );

      // Quarter advanced: prefer auto-fetch period box series for this qKey;
      // else synthetic efficiency from this quarter's scored/allowed + game pace.
      {
        const _qRegMinutes = getLeagueRegulationMinutes(league) || 48;
        const qMins = _qRegMinutes / 4;
        const qDivisor = 400 * (48 / _qRegMinutes);
        const _advAQ =
          typeof getPeriodAdvancedSeries === "function"
            ? getPeriodAdvancedSeries(ctxAQ, qKey)
            : { ortg: [], drtg: [], pace: [], source: "none" };
        const _advBQ =
          typeof getPeriodAdvancedSeries === "function"
            ? getPeriodAdvancedSeries(ctxBQ, qKey)
            : { ortg: [], drtg: [], pace: [], source: "none" };
        let ortgA_q, drtgA_q, ortgB_q, drtgB_q, synPaceQ;

        if (_advAQ.source === qKey && _advBQ.source === qKey) {
          ortgA_q = avgOrNaN(_advAQ.ortg);
          drtgA_q = avgOrNaN(_advAQ.drtg);
          ortgB_q = avgOrNaN(_advBQ.ortg);
          drtgB_q = avgOrNaN(_advBQ.drtg);
          const pA = avgOrNaN(_advAQ.pace);
          const pB = avgOrNaN(_advBQ.pace);
          synPaceQ =
            isFinite(pA) && pA > 0 && isFinite(pB) && pB > 0
              ? (pA + pB) / 2
              : LEAGUE_PACE_BASES[league] || LEAGUE_PACE_BASES.default || 99.5;
        } else {
          // FIX Issue 11: match H1/H2 — do not invent quarter ORTG/pace from full-game series.
          // Points-only path is used when period-native advanced is thin.
          ortgA_q = NaN;
          drtgA_q = NaN;
          ortgB_q = NaN;
          drtgB_q = NaN;
          synPaceQ = NaN;
        }

        const hasNativeAdvQ =
          isFinite(ortgA_q) && isFinite(drtgA_q) && isFinite(ortgB_q) && isFinite(drtgB_q);

        if (hasNativeAdvQ) {
          const projRatingAQ = ortgA_q + drtgB_q - leagueRatingBaseQ;
          const projRatingBQ = ortgB_q + drtgA_q - leagueRatingBaseQ;
          const projA_adv = (synPaceQ * projRatingAQ) / qDivisor;
          const projB_adv = (synPaceQ * projRatingBQ) / qDivisor;
          const advTotalQ =
            (isFinite(projA_adv) ? projA_adv : 0) + (isFinite(projB_adv) ? projB_adv : 0);
          const advSaneQ =
            isFinite(advTotalQ) &&
            advTotalQ >= leagueBaseQ * 1.4 &&
            advTotalQ <= leagueBaseQ * 2.6 &&
            isFinite(projA_adv) &&
            isFinite(projB_adv);
          const _advWQ = isFinite(config?.advancedBlendWeight)
            ? Number(config.advancedBlendWeight)
            : isFinite(getParam("advancedBlendWeight", league))
              ? Number(getParam("advancedBlendWeight", league))
              : 0.45;
          if (advSaneQ && _advWQ > 0) {
            const w = Math.max(0, Math.min(1, _advWQ));
            projA = projA_pts * (1 - w) + projA_adv * w;
            projB = projB_pts * (1 - w) + projB_adv * w;
          } else {
            projA = projA_pts;
            projB = projB_pts;
          }
        } else {
          projA = projA_pts;
          projB = projB_pts;
        }
      }

      // No FT venue proxy on quarters — venue must come from quarter-level
      // data only (not implemented as FT/4).

      projA = applyVolatility(projA, aS, volLimit, league);
      projB = applyVolatility(projB, bS, volLimit, league);

      projA *= injA;
      projB *= injB;

      const _qInjOppBoostFactor =
        getParam("injuryOppBoostFactor", league) ?? INJURY_OPPONENT_BOOST_FACTOR;
      if (injA < 1) projB *= 1 + Math.min(0.2, (1 - injA) * _qInjOppBoostFactor);
      if (injB < 1) projA *= 1 + Math.min(0.2, (1 - injB) * _qInjOppBoostFactor);

      const aH2H = getH2HSeries("A", qKey, parsed);
      const bH2H = getH2HSeries("B", qKey, parsed);
      const hasH2H = maybeReadH2HEnabled(qKey) && aH2H.length >= 2 && bH2H.length >= 2;
      const tier = getSampleTier(aS, bS);

      const qFullModel = tier === "full";
      const qProjectionOnly = !hasH2H && tier === "thin";
      if (hasH2H) {
        const massacreH2HQ = getMassacreH2HSeries(qKey, getCurrentFixtureMeta(), parsed);
        const decayH2HA = massacreH2HQ.A.length >= 2 ? massacreH2HQ.A : aH2H;
        const decayH2HB = massacreH2HQ.B.length >= 2 ? massacreH2HQ.B : bH2H;

        const usedDecayA = massacreH2HQ.A.length >= 2;
        const usedDecayB = massacreH2HQ.B.length >= 2;
        // FIX: total-market vol is not SD of pooled team scores. Use Euclidean combination.
        const _qVolA = getVolatilityRatioForSeries(aS, volLimit);
        const _qVolB = getVolatilityRatioForSeries(bS, volLimit);
        const qVolRatio = Math.min(
          2.5,
          Math.sqrt(
            (Number.isFinite(_qVolA) ? _qVolA : 1) ** 2 + (Number.isFinite(_qVolB) ? _qVolB : 1) ** 2,
          ),
        );

        // FIX HIGH: compute H2H averages first, then divergence = |H2H total - model total|
        // (not |projA - projB| margin). Baseline for relative div is quarter total scale.
        const _qH2hW = massacreH2HQ.weights;
        const avgH2HA =
          _qH2hW && _qH2hW.length === decayH2HA.length
            ? (() => {
                let sv = 0,
                  sw = 0;
                for (let i = 0; i < decayH2HA.length; i++) {
                  const v = Number(decayH2HA[i]),
                    w = Number(_qH2hW[i]);
                  if (isFinite(v) && isFinite(w) && w > 0) {
                    sv += v * w;
                    sw += w;
                  }
                }
                return sw > 0 ? sv / sw : avgOrNaN(decayH2HA);
              })()
            : avgOrNaN(decayH2HA);
        const avgH2HB =
          _qH2hW && _qH2hW.length === decayH2HB.length
            ? (() => {
                let sv = 0,
                  sw = 0;
                for (let i = 0; i < decayH2HB.length; i++) {
                  const v = Number(decayH2HB[i]),
                    w = Number(_qH2hW[i]);
                  if (isFinite(v) && isFinite(w) && w > 0) {
                    sv += v * w;
                    sw += w;
                  }
                }
                return sw > 0 ? sv / sw : avgOrNaN(decayH2HB);
              })()
            : avgOrNaN(decayH2HB);
        const _qModelTotal = (isFinite(projA) ? projA : 0) + (isFinite(projB) ? projB : 0);
        const _qH2hTotal = (isFinite(avgH2HA) ? avgH2HA : 0) + (isFinite(avgH2HB) ? avgH2HB : 0);
        const _qH2hDivergence =
          isFinite(avgH2HA) && isFinite(avgH2HB) ? Math.abs(_qH2hTotal - _qModelTotal) : 0;
        const _qH2hFactor = isFinite(config?.h2hFactor) ? Number(config.h2hFactor) : 1.0;
        const hw = getH2HWeight(
          decayH2HA.length,
          decayH2HB.length,
          qKey,
          tier,
          _qH2hDivergence,
          league,
          leagueBaseQ * 2,
          _qH2hFactor,
          {
            enabled: hasH2H,
            injMultA: injA,
            injMultB: injB,
            volRatio: qVolRatio,
            blowoutGap: Math.abs(projA - projB),
            paceGapRisk:
              Math.abs((avgOrNaN(ctxAQ.pace10) || 74) - (avgOrNaN(ctxBQ.pace10) || 74)) > 6,
          },
        );
        projA = isFinite(avgH2HA) ? projA * (1 - hw) + avgH2HA * hw : projA;
        projB = isFinite(avgH2HB) ? projB * (1 - hw) + avgH2HB * hw : projB;

        const _aInjAdjBaselineQ =
          avgOrNaN(aS) * injA * (injB < 1 ? 1 + (1 - injB) * _qInjOppBoostFactor : 1);
        const _bInjAdjBaselineQ =
          avgOrNaN(bS) * injB * (injA < 1 ? 1 + (1 - injA) * _qInjOppBoostFactor : 1);
        projA = applyVolatility(projA, aS, volLimit, league, _aInjAdjBaselineQ);
        projB = applyVolatility(projB, bS, volLimit, league, _bInjAdjBaselineQ);
      }

      const teamANameForShape = document.getElementById("teamAName")?.value?.trim() || "";
      const teamBNameForShape = document.getElementById("teamBName")?.value?.trim() || "";
      const shapeSignalA = getTeamQuarterShapeSignal(league, teamANameForShape, qKey);
      const shapeSignalB = getTeamQuarterShapeSignal(league, teamBNameForShape, qKey);
      if (shapeSignalA && shapeSignalA.direction !== "neutral") {
        projA *= 1 + clampNumber(shapeSignalA.z, -3, 3) * 0.02;
      }
      if (shapeSignalB && shapeSignalB.direction !== "neutral") {
        projB *= 1 + clampNumber(shapeSignalB.z, -3, 3) * 0.02;
      }

      const qProj = projA + projB;
      const qEdge = lineVal ? qProj - lineVal : NaN;
      const qPick = getPick(qEdge, lineVal, league, qKey, { aSc: avgOrNaN(aS), bSc: avgOrNaN(bS) });

      const qTrap = detectTrap(qEdge, lineVal, qPick, league, qKey, stdDev(aS.concat(bS)));
      const qConf = getConfidenceGrade({
        pick: qPick,
        line: lineVal,
        edge: qEdge,
        sampleTier: tier,
        volatility: stdDev(aS.concat(bS)),
        volLimit,
        fullModel: qFullModel,
        projectionOnly: qProjectionOnly,
        trap: qTrap,

        paceGapRisk: Math.abs((avgOrNaN(ctxAQ.pace10) || 74) - (avgOrNaN(ctxBQ.pace10) || 74)) > 6,
        blowoutGap: Math.abs(projA - projB),

        marketKey: qKey,
        hasH2H: hasH2H,

        siblingEdge: qKey === "q1" || qKey === "q2" ? h1Calc.h1Edge : (h2Calc && isFinite(h2Calc.h2Edge) ? h2Calc.h2Edge : ftCalc.ftEdge),
        league,
      });

      const qPaceGapRisk =
        Math.abs((avgOrNaN(ctxAQ.pace10) || 74) - (avgOrNaN(ctxBQ.pace10) || 74)) > 6;

      return {
        proj: qProj,
        edge: qEdge,
        line: lineVal,
        pick: qPick,
        confidence: qConf,
        tier,
        projA,
        projB,
        hasH2H,
        volatility: stdDev(aS.concat(bS)),
        fullModel: qFullModel,
        projectionOnly: qProjectionOnly,
        paceGapRisk: qPaceGapRisk,
        preAnchorProjA: projA,
        preAnchorProjB: projB,
        preAnchorProjTotal: qProj,
      };
    };

    const q1 = computeQ(
      "q1",
      parseMarketLine(document.getElementById("q1Market")?.value),
      g_injA.scoringMult,
      g_injB.scoringMult,
      { h2hFactor: ftConfigOverride?.h2hFactor },
    );
    const q2 = computeQ(
      "q2",
      parseMarketLine(document.getElementById("q2Market")?.value),
      g_injA.scoringMult,
      g_injB.scoringMult,
      { h2hFactor: ftConfigOverride?.h2hFactor },
    );
    const q3 = computeQ(
      "q3",
      parseMarketLine(document.getElementById("q3Market")?.value),
      g_injA.scoringMult,
      g_injB.scoringMult,
      { h2hFactor: ftConfigOverride?.h2hFactor },
    );
    const q4 = computeQ(
      "q4",
      parseMarketLine(document.getElementById("q4Market")?.value),
      g_injA.scoringMult,
      g_injB.scoringMult,
      { h2hFactor: ftConfigOverride?.h2hFactor },
    );

    if (isFinite(_h2ReconH2) && _h2ReconH2 > 0 && q3 && q4) {
      const qSum = (isFinite(q3.proj) ? q3.proj : 0) + (isFinite(q4.proj) ? q4.proj : 0);
      if (qSum > 0 && Math.abs(qSum - _h2ReconH2) > 0.5) {
        // FIX Issue 21: do NOT mutate q3/q4 projections used for picks.
        // Record display-only reconciliation factor instead of overwriting model signal.
        const scale = _h2ReconH2 / qSum;
        if (q3) q3.reconScaleToH2 = scale;
        if (q4) q4.reconScaleToH2 = scale;
        if (q3) q3.reconNote = "Q3+Q4 vs H2 display recon only; pick uses unscaled proj";
        if (q4) q4.reconNote = "Q3+Q4 vs H2 display recon only; pick uses unscaled proj";
      }
    }

    if (
      q4 &&
      isFinite(q4.projA) &&
      isFinite(q4.projB) &&
      q4.line &&
      isFinite(ftCalc.blowoutGap) &&
      ftCalc.blowoutGap > 15
    ) {
      const isFavorA = ftCalc.projAFT > ftCalc.projBFT;
      q4.projA = isFavorA ? q4.projA * 0.85 : q4.projA * 1.1;
      q4.projB = isFavorA ? q4.projB * 1.1 : q4.projB * 0.85;
      q4.proj = q4.projA + q4.projB;
      q4.edge = q4.proj - q4.line;
      q4.pick = getPick(q4.edge, q4.line, league, "q4", {
        // FIX (MEDIUM): this branch only runs when ftCalc.blowoutGap > 15 is
        // already true; pass it through so getPick's blowout-risk threshold
        // escalation (already applied to FT/team_a/team_b) applies here too.
        blowoutGap: ftCalc.blowoutGap,
      });
    }

    // Q-SPREAD: ctxAQ/ctxBQ inside computeQ() are local to that closure and
    // out of scope here — same AppState.context.data object, just re-read
    // at this outer scope so quarter-form agreement can be computed before
    // each quarter's confidence re-grade below (not after, or it would be
    // too late to actually influence the grade).
    const ctxAQOuter = AppState.context.data?.A || {};
    const ctxBQOuter = AppState.context.data?.B || {};

    const rawQ12Sum = (q1?.proj || 0) + (q2?.proj || 0);
    const rawQ34Sum = (q3?.proj || 0) + (q4?.proj || 0);
    const h1Target = isFinite(h1Calc.h1Proj) && h1Calc.h1Proj > 0 ? h1Calc.h1Proj : rawQ12Sum;
    const h2Target = isFinite(ftCalc.ftProj) && h1Target > 0 ? ftCalc.ftProj - h1Target : rawQ34Sum;
    const _qAnchorW = getParam("quarterAnchorBlendWeight") ?? MODEL_TUNING.quarterAnchorBlendWeight;

    if (rawQ12Sum > 0 && isFinite(h1Target)) {
      const totalWeightedRaw = (q1?.proj || 0) + (q2?.proj || 0);
      const q1Scale = (h1Target * (q1?.proj || 0)) / (totalWeightedRaw || 1) / (q1?.proj || 1);
      const q2Scale = (h1Target * (q2?.proj || 0)) / (totalWeightedRaw || 1) / (q2?.proj || 1);

      if (q1 && isFinite(q1.proj) && isFinite(q1.line)) {
        q1.proj = q1.proj * (1 - _qAnchorW) + q1.proj * q1Scale * _qAnchorW;

        if (isFinite(q1.projA) && isFinite(q1.projB)) {
          const _preSum = q1.projA + q1.projB;
          if (_preSum > 0) {
            const _s = q1.proj / _preSum;
            q1.projA *= _s;
            q1.projB *= _s;
          }
        }

        // Q-SPREAD: computed from projA/projB right after the anchor
        // rescale, BEFORE edge/pick — margin projection has no dependency
        // on edge or pick, so this ordering is safe and lets the signal
        // actually reach the pick decision below, not just the confidence
        // grade after it.
        q1.marginProjection = computeMarginProjection(q1.projA, q1.projB);
        q1.quarterFormAgreement = getQuarterFormAgreement(
          ctxAQOuter.quarterSpreads,
          ctxBQOuter.quarterSpreads,
          "q1",
          q1.marginProjection,
          league,
        );

        q1.rawEdge = q1.proj - q1.line;
        q1.edge = applyQuarterFormEdgeHaircut(q1.rawEdge, q1.quarterFormAgreement, league);

        q1.pick = getPick(q1.edge, q1.line, league, "q1", {
          // FIX (MEDIUM): mirrors the FT/H1/H2 blowout-risk wiring — this
          // value is already computed identically for q1.confidence below.
          blowoutGap: Math.abs((q1.projA || 0) - (q1.projB || 0)),
        });

        const _q1VolSafe = isFinite(q1.volatility) ? q1.volatility : 0;
        const _q1TrapPostAnchor = detectTrap(q1.edge, q1.line, q1.pick, league, "q1", _q1VolSafe);
        q1.trap = _q1TrapPostAnchor;

        q1.confidence = getConfidenceGrade({
          pick: q1.pick,
          line: q1.line,
          edge: q1.edge,
          sampleTier: q1.tier,
          volatility: _q1VolSafe,
          volLimit: getMarketVolLimit(league, "q1"),
          marketKey: "q1",
          hasH2H: q1.hasH2H,
          fullModel: q1.fullModel,
          projectionOnly: q1.projectionOnly,
          trap: _q1TrapPostAnchor,
          paceGapRisk: q1.paceGapRisk,
          blowoutGap: Math.abs((q1.projA || 0) - (q1.projB || 0)),
          siblingEdge: h1Calc.h1Edge,
          quarterFormAgreement: q1.quarterFormAgreement,
          league,
        });
      }
      if (q2 && isFinite(q2.proj) && isFinite(q2.line)) {
        q2.proj = q2.proj * (1 - _qAnchorW) + q2.proj * q2Scale * _qAnchorW;

        // Q-SPREAD fix: q1's block above rescales projA/projB proportionally
        // to stay consistent with the anchored total; this block previously
        // didn't, leaving q2.projA/projB stale relative to q2.proj. Applying
        // the same rescale here so marginProjection below (and blowoutGap
        // above) reflect the anchored split, not the pre-anchor one.
        if (isFinite(q2.projA) && isFinite(q2.projB)) {
          const _preSumQ2 = q2.projA + q2.projB;
          if (_preSumQ2 > 0) {
            const _sQ2 = q2.proj / _preSumQ2;
            q2.projA *= _sQ2;
            q2.projB *= _sQ2;
          }
        }

        q2.marginProjection = computeMarginProjection(q2.projA, q2.projB);
        q2.quarterFormAgreement = getQuarterFormAgreement(
          ctxAQOuter.quarterSpreads,
          ctxBQOuter.quarterSpreads,
          "q2",
          q2.marginProjection,
          league,
        );

        q2.rawEdge = q2.proj - q2.line;
        q2.edge = applyQuarterFormEdgeHaircut(q2.rawEdge, q2.quarterFormAgreement, league);

        q2.pick = getPick(q2.edge, q2.line, league, "q2", {
          blowoutGap: Math.abs((q2.projA || 0) - (q2.projB || 0)),
        });

        const _q2VolSafe = isFinite(q2.volatility) ? q2.volatility : 0;
        const _q2TrapPostAnchor = detectTrap(q2.edge, q2.line, q2.pick, league, "q2", _q2VolSafe);
        q2.trap = _q2TrapPostAnchor;

        q2.confidence = getConfidenceGrade({
          pick: q2.pick,
          line: q2.line,
          edge: q2.edge,
          sampleTier: q2.tier,
          volatility: _q2VolSafe,
          volLimit: getMarketVolLimit(league, "q2"),
          marketKey: "q2",
          hasH2H: q2.hasH2H,
          fullModel: q2.fullModel,
          projectionOnly: q2.projectionOnly,
          trap: _q2TrapPostAnchor,
          paceGapRisk: q2.paceGapRisk,
          blowoutGap: Math.abs((q2.projA || 0) - (q2.projB || 0)),
          siblingEdge: h1Calc.h1Edge,
          quarterFormAgreement: q2.quarterFormAgreement,
          league,
        });
      }
    }

    if (rawQ34Sum > 0 && isFinite(h2Target) && h2Target > 0) {
      const totalWeightedRaw = (q3?.proj || 0) + (q4?.proj || 0);
      const q3Scale = (h2Target * (q3?.proj || 0)) / (totalWeightedRaw || 1) / (q3?.proj || 1);
      const q4Scale = (h2Target * (q4?.proj || 0)) / (totalWeightedRaw || 1) / (q4?.proj || 1);

      if (q3 && isFinite(q3.proj) && isFinite(q3.line)) {
        q3.proj = q3.proj * (1 - _qAnchorW) + q3.proj * q3Scale * _qAnchorW;

        if (isFinite(q3.projA) && isFinite(q3.projB)) {
          const _preSumQ3 = q3.projA + q3.projB;
          if (_preSumQ3 > 0) {
            const _sQ3 = q3.proj / _preSumQ3;
            q3.projA *= _sQ3;
            q3.projB *= _sQ3;
          }
        }

        q3.marginProjection = computeMarginProjection(q3.projA, q3.projB);
        q3.quarterFormAgreement = getQuarterFormAgreement(
          ctxAQOuter.quarterSpreads,
          ctxBQOuter.quarterSpreads,
          "q3",
          q3.marginProjection,
          league,
        );

        q3.rawEdge = q3.proj - q3.line;
        q3.edge = applyQuarterFormEdgeHaircut(q3.rawEdge, q3.quarterFormAgreement, league);

        q3.pick = getPick(q3.edge, q3.line, league, "q3", {
          blowoutGap: Math.abs((q3.projA || 0) - (q3.projB || 0)),
        });

        const _q3VolSafe = isFinite(q3.volatility) ? q3.volatility : 0;
        const _q3TrapPostAnchor = detectTrap(q3.edge, q3.line, q3.pick, league, "q3", _q3VolSafe);
        q3.trap = _q3TrapPostAnchor;

        q3.confidence = getConfidenceGrade({
          pick: q3.pick,
          line: q3.line,
          edge: q3.edge,
          sampleTier: q3.tier,
          volatility: _q3VolSafe,
          volLimit: getMarketVolLimit(league, "q3"),
          marketKey: "q3",
          hasH2H: q3.hasH2H,
          fullModel: q3.fullModel,
          projectionOnly: q3.projectionOnly,
          trap: _q3TrapPostAnchor,
          paceGapRisk: q3.paceGapRisk,
          blowoutGap: Math.abs((q3.projA || 0) - (q3.projB || 0)),
          siblingEdge: ftCalc.ftEdge,
          quarterFormAgreement: q3.quarterFormAgreement,
          league,
        });
      }
      if (q4 && isFinite(q4.proj) && isFinite(q4.line)) {
        q4.proj = q4.proj * (1 - _qAnchorW) + q4.proj * q4Scale * _qAnchorW;

        if (isFinite(q4.projA) && isFinite(q4.projB)) {
          const _preSumQ4 = q4.projA + q4.projB;
          if (_preSumQ4 > 0) {
            const _sQ4 = q4.proj / _preSumQ4;
            q4.projA *= _sQ4;
            q4.projB *= _sQ4;
          }
        }

        q4.marginProjection = computeMarginProjection(q4.projA, q4.projB);
        q4.quarterFormAgreement = getQuarterFormAgreement(
          ctxAQOuter.quarterSpreads,
          ctxBQOuter.quarterSpreads,
          "q4",
          q4.marginProjection,
          league,
        );

        q4.rawEdge = q4.proj - q4.line;
        q4.edge = applyQuarterFormEdgeHaircut(q4.rawEdge, q4.quarterFormAgreement, league);

        q4.pick = getPick(q4.edge, q4.line, league, "q4", {
          blowoutGap: Math.abs((q4.projA || 0) - (q4.projB || 0)),
        });

        const _q4VolSafe = isFinite(q4.volatility) ? q4.volatility : 0;
        const _q4TrapPostAnchor = detectTrap(q4.edge, q4.line, q4.pick, league, "q4", _q4VolSafe);
        q4.trap = _q4TrapPostAnchor;

        q4.confidence = getConfidenceGrade({
          pick: q4.pick,
          line: q4.line,
          edge: q4.edge,
          sampleTier: q4.tier,
          volatility: _q4VolSafe,
          volLimit: getMarketVolLimit(league, "q4"),
          marketKey: "q4",
          hasH2H: q4.hasH2H,
          fullModel: q4.fullModel,
          projectionOnly: q4.projectionOnly,
          trap: _q4TrapPostAnchor,
          paceGapRisk: q4.paceGapRisk,
          blowoutGap: Math.abs((q4.projA || 0) - (q4.projB || 0)),
          siblingEdge: ftCalc.ftEdge,
          quarterFormAgreement: q4.quarterFormAgreement,
          league,
        });
      }
    }

    if (ftCalc.ftSampleTier === "insufficient") {
      ftPick = "NO PLAY";
      aPick = "NO PLAY";
      bPick = "NO PLAY";

      ftCalc.ftProj = NaN;
      ftCalc.ftEdge = NaN;
      ftCalc.projAFT = NaN;
      ftCalc.aEdge = NaN;
      ftCalc.projBFT = NaN;
      ftCalc.bEdge = NaN;

      if (q1) {
        q1.proj = NaN;
        q1.edge = NaN;
        q1.pick = "NO PLAY";
      }
      if (q2) {
        q2.proj = NaN;
        q2.edge = NaN;
        q2.pick = "NO PLAY";
      }
      if (q3) {
        q3.proj = NaN;
        q3.edge = NaN;
        q3.pick = "NO PLAY";
      }
      if (q4) {
        q4.proj = NaN;
        q4.edge = NaN;
        q4.pick = "NO PLAY";
      }
    }
    if (h1Calc.h1SampleTier === "insufficient") {
      h1Pick = "NO PLAY";
      h1aPick = "NO PLAY";
      h1bPick = "NO PLAY";
      h1Calc.h1Proj = NaN;
      h1Calc.h1Edge = NaN;
    }

    if (h1Calc.h1SampleTier === "insufficient") h1Pick = "NO PLAY";

    // Q-SPREAD diagnostic only (not a hard constraint — OT sits outside the
    // four quarters, so an exact match isn't expected): does Q1+Q2's margin
    // reconcile with the H1 handicap projection, and Q3+Q4 with H2? Reads
    // q1-q4.marginProjection, which is now set earlier (before each
    // quarter's confidence re-grade, above) rather than recomputed here.
    const quarterMarginReconciliation = {
      h1: {
        fromQuarters:
          isFinite(q1?.marginProjection) && isFinite(q2?.marginProjection)
            ? Number((q1.marginProjection + q2.marginProjection).toFixed(2))
            : NaN,
        fromH1Model: isFinite(marginProjectionH1) ? Number(marginProjectionH1.toFixed(2)) : NaN,
      },
      h2: {
        fromQuarters:
          isFinite(q3?.marginProjection) && isFinite(q4?.marginProjection)
            ? Number((q3.marginProjection + q4.marginProjection).toFixed(2))
            : NaN,
        fromH2Model: isFinite(marginProjectionH2) ? Number(marginProjectionH2.toFixed(2)) : NaN,
      },
    };
    engineDebug("quarter spread reconciliation", quarterMarginReconciliation);

    engineDebug("pick decisions", {
      ft: summarizePickDecisionForDebug(
        "FT Total",
        ftPick,
        ftLine,
        ftCalc.ftEdge,
        "",
        ftCalc.ftNote || ftCalc.ftProjectionNote || null,
        false,
      ),
      h1: summarizePickDecisionForDebug(
        "1H Total",
        h1Pick,
        h1Line,
        h1Calc.h1Edge,
        "",
        h1Calc.h1Note || h1Calc.h1ProjectionNote || null,
        false,
      ),
      teamA: summarizePickDecisionForDebug(
        "Team A Total",
        aPick,
        aLine,
        ftCalc.aEdge,
        "",
        ftCalc.ftNote || ftCalc.ftProjectionNote || null,
        false,
      ),
      teamB: summarizePickDecisionForDebug(
        "Team B Total",
        bPick,
        bLine,
        ftCalc.bEdge,
        "",
        ftCalc.ftNote || ftCalc.ftProjectionNote || null,
        false,
      ),
    });

    const ftNote = ftCalc.ftNote || ftCalc.ftProjectionNote || null;
    const h1Note = h1Calc.h1Note || h1Calc.h1ProjectionNote || null;

    const sharedInjuryNotes = [];

    const lqA = computeLineupQuality(AppState.context.data?.A?.roster, g_injA);
    const lqB = computeLineupQuality(AppState.context.data?.B?.roster, g_injB);
    const _lqiShared = (lqA + lqB) / 2;

    const ftVolatilityForConf =
      ftCalc.ftVolRatio != null ? ftCalc.ftVolRatio * getMarketVolLimit(league, "ft") : 0;
    const ftTrapMeta =
      typeof detectTrapMeta === "function"
        ? detectTrapMeta(ftCalc.ftEdge, ftLine, ftPick, league, "ft", ftVolatilityForConf)
        : {
            flag: detectTrap(ftCalc.ftEdge, ftLine, ftPick, league, "ft", ftVolatilityForConf),
            kind: "vol_risk",
            label: "",
          };
    const ftTrap = !!ftTrapMeta.flag;
    const ftConfidence = getConfidenceGrade({
      pick: ftPick,
      note: ftNote,
      line: ftLine,
      edge: ftCalc.ftEdge,
      sampleTier: ftCalc.ftSampleTier,
      projectionOnly: ftCalc.ftProjectionOnly,
      fullModel: ftCalc.ftFullModel,
      trap: ftTrap,
      trapKind: ftTrapMeta.kind || "",
      trapLabel: ftTrapMeta.label || "",
      hasH2H: ftCalc.ftHasH2H,
      volatility: ftVolatilityForConf,
      volLimit: getMarketVolLimit(league, "ft"),
      injuryNotes: [],
      paceGapRisk: ftCalc.paceGapRisk,
      defensiveFloorFlag: ftCalc.defensiveFloorFlag,
      blowoutGap: ftCalc.blowoutGap,
      marketKey: "ft",

      q4Edge: q4?.edge,

      lineupQuality: _lqiShared,

      league,
    });

    // FIX (CRITICAL #4): reuse h1Calc.h1VolRatio (sqrt(sdA^2+sdB^2)/volLimit),
    // the same combined-volatility figure compute1HProjection already used
    // internally for H2H weighting, instead of recomputing max(aVol1,bVol1)
    // here, which understated uncertainty and inflated H1 confidence grades.
    const h1VolatilityForConf =
      (isFinite(h1Calc.h1VolRatio) ? h1Calc.h1VolRatio : Math.max(h1Calc.aVol1, h1Calc.bVol1)) *
      getMarketVolLimit(league, "h1");
    const h1Trap = detectTrap(h1Calc.h1Edge, h1Line, h1Pick, league, "h1", h1VolatilityForConf);
    const h1Confidence = getConfidenceGrade({
      pick: h1Pick,
      note: h1Note,
      line: h1Line,
      edge: h1Calc.h1Edge,
      sampleTier: h1Calc.h1SampleTier,
      projectionOnly: h1Calc.h1ProjectionOnly,
      fullModel: h1Calc.h1FullModel,
      trap: h1Trap,
      hasH2H: h1Calc.h1HasH2H,

      paceGapRisk: h1Calc.paceGapRisk,
      blowoutGap: Math.abs((h1Calc.projA1H || 0) - (h1Calc.projB1H || 0)),
      defensiveFloorFlag: h1Calc.defensiveFloorFlag,
      volatility: h1VolatilityForConf,
      volLimit: getMarketVolLimit(league, "h1"),
      marketKey: "h1",

      q2Edge: q2?.edge,

      lineupQuality: _lqiShared,

      league,
    });

    const h1ConfidenceFinal = h1Confidence;

    // FIX (CRITICAL #4): reuse h2Calc.h2VolRatio, mirrors the h1 fix above.
    const h2VolatilityForConf =
      (isFinite(h2Calc.h2VolRatio)
        ? h2Calc.h2VolRatio
        : Math.max(h2Calc.aVol2 || 0, h2Calc.bVol2 || 0)) * getMarketVolLimit(league, "h2");
    const h2Trap = detectTrap(h2Calc.h2Edge, h2Line, h2Pick, league, "h2", h2VolatilityForConf);
    const h2Confidence = getConfidenceGrade({
      pick: h2Pick,
      note: null,
      line: h2Line,
      edge: h2Calc.h2Edge,
      sampleTier: h2Calc.h2SampleTier,
      projectionOnly: h2Calc.h2ProjectionOnly,
      fullModel: h2Calc.h2FullModel,
      trap: h2Trap,
      hasH2H: h2Calc.h2HasH2H,
      paceGapRisk: h2Calc.paceGapRisk,
      blowoutGap: Math.abs((h2Calc.projA2H || 0) - (h2Calc.projB2H || 0)),
      defensiveFloorFlag: h2Calc.defensiveFloorFlag,
      volatility: h2VolatilityForConf,
      volLimit: getMarketVolLimit(league, "h2"),
      marketKey: "h2",
      lineupQuality: _lqiShared,
      league,
    });

    const aTrap = detectTrap(ftCalc.aEdge, aLine, aPick, league, "ft", ftCalc.aVol);
    const aConfidence = getConfidenceGrade({
      pick: aPick,
      note: ftNote,
      line: aLine,
      edge: ftCalc.aEdge,
      sampleTier: ftCalc.ftSampleTier,
      projectionOnly: ftCalc.ftProjectionOnly,
      fullModel: ftCalc.teamFullModel,
      trap: aTrap,
      hasH2H: ftCalc.ftHasH2H,

      paceGapRisk: ftCalc.paceGapRisk,
      blowoutGap: ftCalc.blowoutGap,
      volatility: ftCalc.aVol,
      volLimit: getMarketVolLimit(league, "ft"),
      injuryNotes: [],
      marketKey: "team_a",

      lineupQuality: lqA,
    });

    const bTrap = detectTrap(ftCalc.bEdge, bLine, bPick, league, "ft", ftCalc.bVol);
    const bConfidence = getConfidenceGrade({
      pick: bPick,
      note: ftNote,
      line: bLine,
      edge: ftCalc.bEdge,
      sampleTier: ftCalc.ftSampleTier,
      projectionOnly: ftCalc.ftProjectionOnly,
      fullModel: ftCalc.teamFullModel,
      trap: bTrap,
      hasH2H: ftCalc.ftHasH2H,

      paceGapRisk: ftCalc.paceGapRisk,
      blowoutGap: ftCalc.blowoutGap,
      volatility: ftCalc.bVol,
      volLimit: getMarketVolLimit(league, "ft"),
      injuryNotes: [],
      marketKey: "team_b",

      lineupQuality: lqB,
    });

    const h1aVolatilityForConf = h1Calc.aVol1 * getMarketVolLimit(league, "h1");
    const h1aTrap = detectTrap(
      h1aEdge,
      finalLines.h1aLine,
      h1aPick,
      league,
      "h1",
      h1aVolatilityForConf,
    );
    const h1aConfidence = getConfidenceGrade({
      pick: h1aPick,
      note: h1Note,
      line: finalLines.h1aLine,
      edge: h1aEdge,
      sampleTier: h1Calc.h1SampleTier,
      projectionOnly: h1Calc.h1ProjectionOnly,
      fullModel: h1Calc.h1FullModel,
      trap: h1aTrap,
      hasH2H: h1Calc.h1HasH2H,

      volatility: h1aVolatilityForConf,
      volLimit: getMarketVolLimit(league, "h1"),
      paceGapRisk: h1Calc.paceGapRisk,
      blowoutGap: Math.abs((h1Calc.projA1H || 0) - (h1Calc.projB1H || 0)),
      marketKey: "h1",

      league,
    });

    const h1bVolatilityForConf = h1Calc.bVol1 * getMarketVolLimit(league, "h1");
    const h1bTrap = detectTrap(
      h1bEdge,
      finalLines.h1bLine,
      h1bPick,
      league,
      "h1",
      h1bVolatilityForConf,
    );
    const h1bConfidence = getConfidenceGrade({
      pick: h1bPick,
      note: h1Note,
      line: finalLines.h1bLine,
      edge: h1bEdge,
      sampleTier: h1Calc.h1SampleTier,
      projectionOnly: h1Calc.h1ProjectionOnly,
      fullModel: h1Calc.h1FullModel,
      trap: h1bTrap,
      hasH2H: h1Calc.h1HasH2H,

      volatility: h1bVolatilityForConf,
      volLimit: getMarketVolLimit(league, "h1"),
      paceGapRisk: h1Calc.paceGapRisk,
      blowoutGap: Math.abs((h1Calc.projA1H || 0) - (h1Calc.projB1H || 0)),
      marketKey: "h1",

      league,
    });

    const phase2Activation =
      typeof getPhase2ActivationState === "function" ? getPhase2ActivationState() : null;

    const ctxA = getMassacreTeamContext("A", parsed);
    const ctxB = getMassacreTeamContext("B", parsed);

    const ftBadge = "";
    const h1Badge = "";
    const aBadge = "";
    const bBadge = "";

    const oA = avgOrNaN(AppState.context.data.A.ortg10);
    const dA = avgOrNaN(AppState.context.data.A.drtg10);
    const oB = avgOrNaN(AppState.context.data.B.ortg10);
    const dB = avgOrNaN(AppState.context.data.B.drtg10);

    const netA =
      isFinite(oA) && isFinite(dA) && (oA !== 0 || dA !== 0)
        ? oA - dA
        : isFinite(ftCalc.synNetA)
          ? ftCalc.synNetA
          : NaN;
    const netB =
      isFinite(oB) && isFinite(dB) && (oB !== 0 || dB !== 0)
        ? oB - dB
        : isFinite(ftCalc.synNetB)
          ? ftCalc.synNetB
          : NaN;

    const projDiff = ftCalc.projAFT - ftCalc.projBFT;

    const _coeffFitted = isConfidenceCoeffFitted(league);

    const winnerMarginInputs = getMarginConfidenceInputs(
      winnerEdge,
      ftCalc.ftProj,
      combinedMarginVolFT,
      getMarketVolLimit(league, "ft"),
    );
    const winnerTrap = detectMarginTrap(
      winnerEdge,
      ftCalc.ftProj,
      league,
      "winner",
      combinedMarginVolFT,
      getMarketVolLimit(league, "ft"),
    );
    const winnerConfidence = getMarginConfidenceGrade({
      pick: winnerPick,
      marginEdgePct: winnerMarginInputs.marginEdgePct,
      marginVolRatio: winnerMarginInputs.marginVolRatio,
      sampleTier: ftCalc.ftSampleTier,
      hasH2H: ftCalc.ftHasH2H,
      trap: winnerTrap,
      marketKey: "winner",
      league,
      marginEdgePts: winnerEdge,
      volLimitPts: getMarketVolLimit(league, "ft"),
    });

    const handicapMarginInputs = getMarginConfidenceInputs(
      handicapEdge,
      ftCalc.ftProj,
      combinedMarginVolFT,
      getMarketVolLimit(league, "ft"),
    );
    const handicapTrap = detectMarginTrap(
      handicapEdge,
      ftCalc.ftProj,
      league,
      "handicap",
      combinedMarginVolFT,
      getMarketVolLimit(league, "ft"),
    );
    const handicapConfidence = getMarginConfidenceGrade({
      pick: handicapPick,
      marginEdgePct: handicapMarginInputs.marginEdgePct,
      marginVolRatio: handicapMarginInputs.marginVolRatio,
      sampleTier: ftCalc.ftSampleTier,
      hasH2H: ftCalc.ftHasH2H,
      trap: handicapTrap,
      marketKey: "handicap",
      league,
      marginEdgePts: handicapEdge,
      volLimitPts: getMarketVolLimit(league, "ft"),
    });

    const handicapH1MarginInputs = getMarginConfidenceInputs(
      handicapH1Edge,
      h1Calc.h1Proj,
      combinedMarginVolH1,
      _h1VolLimitForMargin,
    );
    const handicapH1Trap = detectMarginTrap(
      handicapH1Edge,
      h1Calc.h1Proj,
      league,
      "handicap_h1",
      combinedMarginVolH1,
      _h1VolLimitForMargin,
    );
    const handicapH1Confidence = getMarginConfidenceGrade({
      pick: handicapH1Pick,
      marginEdgePct: handicapH1MarginInputs.marginEdgePct,
      marginVolRatio: handicapH1MarginInputs.marginVolRatio,
      sampleTier: h1Calc.h1SampleTier,
      hasH2H: h1Calc.h1HasH2H,
      trap: handicapH1Trap,
      marketKey: "handicap_h1",
      league,
      marginEdgePts: handicapH1Edge,
      volLimitPts: _h1VolLimitForMargin,
    });
    const handicapH2MarginInputs = getMarginConfidenceInputs(
      handicapH2Edge,
      h2Calc.h2Proj,
      combinedMarginVolH2,
      _h2VolLimitForMargin,
    );
    const handicapH2Trap = detectMarginTrap(
      handicapH2Edge,
      h2Calc.h2Proj,
      league,
      "handicap_h2",
      combinedMarginVolH2,
      _h2VolLimitForMargin,
    );
    const handicapH2Confidence = getMarginConfidenceGrade({
      pick: handicapH2Pick,
      marginEdgePct: handicapH2MarginInputs.marginEdgePct,
      marginVolRatio: handicapH2MarginInputs.marginVolRatio,
      sampleTier: h2Calc.h2SampleTier,
      hasH2H: h2Calc.h2HasH2H,
      trap: handicapH2Trap,
      marketKey: "handicap_h2",
      league,
      marginEdgePts: handicapH2Edge,
      volLimitPts: _h2VolLimitForMargin,
    });

    const picks = [
      {
        _idx: 0,
        name: "FT Total" + ftBadge,
        marketKey: "ft",
        marketType: "ft",
        league,
        context: { aSc: ftCalc.aS, bSc: ftCalc.bS },
        line: ftLine,
        proj: ftCalc.ftProj,
        edge: ftCalc.ftEdge,
        pick: ftPick,
        confidence: ftConfidence,
        note: ftNote,
        fullModel: ftCalc.ftFullModel,
        sampleTier: ftCalc.ftSampleTier,
        hasH2H: ftCalc.ftHasH2H,
        trap: ftTrap,

        volatility: ftVolatilityForConf,
        volLimit: getMarketVolLimit(league, "ft"),
        coeffFitted: _coeffFitted,

        aVenueEnabled: ftCalc.aVenueEnabled,
        bVenueEnabled: ftCalc.bVenueEnabled,
        aVenueAdjustment: ftCalc.aVenueAdjustment,
        bVenueAdjustment: ftCalc.bVenueAdjustment,
        netVenueEffect: ftCalc.netVenueEffect,
      },
      {
        _idx: 1,
        name: "1H Total" + h1Badge,
        marketKey: "h1",
        marketType: "h1",
        league,
        context: { aSc: h1Calc.aS1, bSc: h1Calc.bS1 },
        line: h1Line,
        proj: h1Calc.h1Proj,
        edge: h1Calc.h1Edge,
        pick: h1Pick,
        confidence: h1ConfidenceFinal,
        note: h1Note,
        fullModel: h1Calc.h1FullModel,
        sampleTier: h1Calc.h1SampleTier,
        hasH2H: h1Calc.h1HasH2H,
        trap: h1Trap,

        volatility: h1VolatilityForConf,
        volLimit: getMarketVolLimit(league, "h1"),
        coeffFitted: _coeffFitted,
        aVenueEnabled: h1Calc.aVenueEnabled,
        bVenueEnabled: h1Calc.bVenueEnabled,
        aVenueAdjustment: h1Calc.aVenueAdjustment,
        bVenueAdjustment: h1Calc.bVenueAdjustment,
      },

      {
        _idx: 2,
        name: "2H Total",
        marketKey: "h2",
        marketType: "h2",
        league,
        context: { aSc: h2Calc.aS2, bSc: h2Calc.bS2 },
        line: h2Line,
        proj: h2Calc.h2Proj,
        edge: h2Calc.h2Edge,
        pick: h2Pick,
        confidence: h2Confidence,
        note: null,
        fullModel: h2Calc.h2FullModel,
        sampleTier: h2Calc.h2SampleTier,
        hasH2H: h2Calc.h2HasH2H,
        trap: h2Trap,
        volatility: h2VolatilityForConf,
        volLimit: getMarketVolLimit(league, "h2"),
        coeffFitted: _coeffFitted,
      },

      {
        _idx: 10,
        name: "Q1 Total",
        marketKey: "q1",
        marketType: "h1",
        league,
        context: {},
        line: parseMarketLine(document.getElementById("q1Market")?.value),
        proj: q1?.proj,
        edge: q1?.edge,
        pick: q1?.pick || "NO PLAY",
        confidence: q1?.confidence || "NaN",
        note: null,
        fullModel: q1?.fullModel ?? false,
        sampleTier: q1?.tier,
        hasH2H: q1?.hasH2H,
        trap: q1?.trap ?? false,
        volatility: q1?.volatility,
        volLimit: getMarketVolLimit(league, "q1"),
        coeffFitted: _coeffFitted,
        projectionOnly: q1?.projectionOnly ?? false,
        // Q-SPREAD: read-only annotation, does not affect proj/edge/pick/confidence above.
        marginProjection: q1?.marginProjection,
        rawEdge: q1?.rawEdge,
        quarterFormAgreement: q1?.quarterFormAgreement,
      },
      {
        _idx: 11,
        name: "Q2 Total",
        marketKey: "q2",
        marketType: "h1",
        league,
        context: {},
        line: parseMarketLine(document.getElementById("q2Market")?.value),
        proj: q2?.proj,
        edge: q2?.edge,
        pick: q2?.pick || "NO PLAY",
        confidence: q2?.confidence || "NaN",
        note: null,
        fullModel: q2?.fullModel ?? false,
        sampleTier: q2?.tier,
        hasH2H: q2?.hasH2H,
        trap: q2?.trap ?? false,
        volatility: q2?.volatility,
        volLimit: getMarketVolLimit(league, "q2"),
        coeffFitted: _coeffFitted,
        projectionOnly: q2?.projectionOnly ?? false,
        marginProjection: q2?.marginProjection,
        rawEdge: q2?.rawEdge,
        quarterFormAgreement: q2?.quarterFormAgreement,
      },
      {
        _idx: 12,
        name: "Q3 Total",
        marketKey: "q3",
        marketType: "h1",
        league,
        context: {},
        line: parseMarketLine(document.getElementById("q3Market")?.value),
        proj: q3?.proj,
        edge: q3?.edge,
        pick: q3?.pick || "NO PLAY",
        confidence: q3?.confidence || "NaN",
        note: null,
        fullModel: q3?.fullModel ?? false,
        sampleTier: q3?.tier,
        hasH2H: q3?.hasH2H,
        trap: q3?.trap ?? false,
        volatility: q3?.volatility,
        volLimit: getMarketVolLimit(league, "q3"),
        coeffFitted: _coeffFitted,
        projectionOnly: q3?.projectionOnly ?? false,
        marginProjection: q3?.marginProjection,
        rawEdge: q3?.rawEdge,
        quarterFormAgreement: q3?.quarterFormAgreement,
      },
      {
        _idx: 13,
        name: "Q4 Total",
        marketKey: "q4",
        marketType: "h1",
        league,
        context: {},
        line: parseMarketLine(document.getElementById("q4Market")?.value),
        proj: q4?.proj,
        edge: q4?.edge,
        pick: q4?.pick || "NO PLAY",
        confidence: q4?.confidence || "NaN",
        note: null,
        fullModel: q4?.fullModel ?? false,
        sampleTier: q4?.tier,
        hasH2H: q4?.hasH2H,
        trap: q4?.trap ?? false,
        volatility: q4?.volatility,
        volLimit: getMarketVolLimit(league, "q4"),
        coeffFitted: _coeffFitted,
        projectionOnly: q4?.projectionOnly ?? false,
        marginProjection: q4?.marginProjection,
        rawEdge: q4?.rawEdge,
        quarterFormAgreement: q4?.quarterFormAgreement,
      },
      {
        _idx: 3,
        name: "Team A Total" + aBadge,
        marketKey: "team_a",
        marketType: "team",
        league,
        context: { teamSc: ftCalc.aS },
        line: aLine,
        proj: ftCalc.projAFT,
        edge: ftCalc.aEdge,
        pick: aPick,
        confidence: aConfidence,
        note: ftNote,
        fullModel: ftCalc.teamFullModel,
        sampleTier: ftCalc.ftSampleTier,
        hasH2H: ftCalc.ftHasH2H,

        trap: aTrap,
        volatility: ftCalc.aVol,
        volLimit: getMarketVolLimit(league, "ft"),
        coeffFitted: _coeffFitted,
        aVenueEnabled: ftCalc.aVenueEnabled,
        aVenueAdjustment: ftCalc.aVenueAdjustment,
      },
      {
        _idx: 4,
        name: "Team B Total" + bBadge,
        marketKey: "team_b",
        marketType: "team",
        league,
        context: { teamSc: ftCalc.bS },
        line: bLine,
        proj: ftCalc.projBFT,
        edge: ftCalc.bEdge,
        pick: bPick,
        confidence: bConfidence,
        note: ftNote,
        fullModel: ftCalc.teamFullModel,
        sampleTier: ftCalc.ftSampleTier,
        hasH2H: ftCalc.ftHasH2H,

        trap: bTrap,
        volatility: ftCalc.bVol,
        volLimit: getMarketVolLimit(league, "ft"),
        coeffFitted: _coeffFitted,
        bVenueEnabled: ftCalc.bVenueEnabled,
        bVenueAdjustment: ftCalc.bVenueAdjustment,
      },
      {
        _idx: 5,
        name: "Winner",
        marketKey: "winner",
        marketType: "winner",
        league,
        context: { aSc: ftCalc.aS, bSc: ftCalc.bS },
        line: null,
        proj: marginProjectionFT,
        edge: winnerEdge,
        pick: winnerPick,
        confidence: winnerConfidence,
        note: null,
        fullModel: ftCalc.ftFullModel,
        sampleTier: ftCalc.ftSampleTier,
        hasH2H: ftCalc.ftHasH2H,
        trap: winnerTrap,
        volatility: combinedMarginVolFT,
        volLimit: getMarketVolLimit(league, "ft"),
        coeffFitted: _coeffFitted,

        marginEdgePct: winnerMarginInputs.marginEdgePct,
      },
      {
        _idx: 6,
        name: "Handicap",
        marketKey: "handicap",
        marketType: "handicap",
        league,
        context: { aSc: ftCalc.aS, bSc: ftCalc.bS },
        line: finalLines.handicapLine,
        proj: marginProjectionFT,
        edge: handicapEdge,
        pick: handicapPick,
        confidence: handicapConfidence,
        note: null,
        fullModel: ftCalc.ftFullModel,
        sampleTier: ftCalc.ftSampleTier,
        hasH2H: ftCalc.ftHasH2H,
        trap: handicapTrap,
        volatility: combinedMarginVolFT,
        volLimit: getMarketVolLimit(league, "ft"),
        coeffFitted: _coeffFitted,
        marginEdgePct: handicapMarginInputs.marginEdgePct,
      },

      {
        _idx: 7,
        name: "1H Handicap",
        marketKey: "handicap_h1",
        marketType: "handicap_h1",
        league,
        context: { aSc: h1Calc.aS1, bSc: h1Calc.bS1 },
        line: finalLines.handicapH1Line,
        proj: marginProjectionH1,
        edge: handicapH1Edge,
        pick: handicapH1Pick,
        confidence: handicapH1Confidence,
        note: null,
        fullModel: h1Calc.h1FullModel,
        sampleTier: h1Calc.h1SampleTier,
        hasH2H: h1Calc.h1HasH2H,
        trap: handicapH1Trap,
        volatility: combinedMarginVolH1,
        volLimit: _h1VolLimitForMargin,
        coeffFitted: _coeffFitted,
        marginEdgePct: handicapH1MarginInputs.marginEdgePct,
      },

      {
        _idx: 8,
        name: "2H Handicap",
        marketKey: "handicap_h2",
        marketType: "handicap_h2",
        league,
        context: { aSc: h2Calc.aS2, bSc: h2Calc.bS2 },
        line: finalLines.handicapH2Line,
        proj: marginProjectionH2,
        edge: handicapH2Edge,
        pick: handicapH2Pick,
        confidence: handicapH2Confidence,
        note: null,
        fullModel: h2Calc.h2FullModel,
        sampleTier: h2Calc.h2SampleTier,
        hasH2H: h2Calc.h2HasH2H,
        trap: handicapH2Trap,
        volatility: combinedMarginVolH2,
        volLimit: _h2VolLimitForMargin,
        coeffFitted: _coeffFitted,
        marginEdgePct: handicapH2MarginInputs.marginEdgePct,
      },
      {
        _idx: 14,
        name: "Team A 1H",
        marketKey: "h1_team_a",
        marketType: "h1",
        league,
        context: { teamSc: h1Calc.aS1 },
        line: finalLines.h1aLine,
        proj: h1Calc.projA1H,
        edge: h1aEdge,
        pick: h1aPick,
        confidence: h1aConfidence,
        note: h1Note,
        fullModel: h1Calc.h1FullModel,
        sampleTier: h1Calc.h1SampleTier,
        hasH2H: h1Calc.h1HasH2H,
        coeffFitted: _coeffFitted,
      },
      {
        _idx: 15,
        name: "Team B 1H",
        marketKey: "h1_team_b",
        marketType: "h1",
        league,
        context: { teamSc: h1Calc.bS1 },
        line: finalLines.h1bLine,
        proj: h1Calc.projB1H,
        edge: h1bEdge,
        pick: h1bPick,
        confidence: h1bConfidence,
        note: h1Note,
        fullModel: h1Calc.h1FullModel,
        sampleTier: h1Calc.h1SampleTier,
        hasH2H: h1Calc.h1HasH2H,
        coeffFitted: _coeffFitted,
      },
    ];

    if (ftCalc.ftSampleTier === "insufficient") {
      picks.forEach((p) => {
        p.pick = "NO PLAY";
        p.edge = NaN;
        p.confidence = "NaN";
        p.note = "No data entered";
        p.lockStrength = 0;
      });
    }

    const h1ToFtRatioGuard =
      isFinite(h1Calc.h1Proj) && isFinite(ftCalc.ftProj) && ftCalc.ftProj > 0
        ? h1Calc.h1Proj / ftCalc.ftProj
        : null;
    if (h1ToFtRatioGuard !== null && h1ToFtRatioGuard > 0.58) {
      picks.forEach((p) => {
        if (p.marketKey === "h1" || p.marketKey === "h1_team_a" || p.marketKey === "h1_team_b") {
          p.pick = "NO PLAY";
          p.edge = NaN;
          p.confidence = "NaN";
          p.note = "H1 projection exceeds hallucination-guard ratio vs FT (h1Proj/ftProj > 0.58)";
          p.lockStrength = 0;
        }
      });
    }

    const isWnbaRun = league === "wnba" || league === "wnba_pre";
    const isManualLeagueRun = !isNbaOrNcaa;

    const wnbaAllowedMarkets = new Set([
      "ft",
      "h1",
      "team_a",
      "team_b",
      "q1",
      "q2",
      "q3",
      "q4",
      "winner",
      "handicap_h1",
      "handicap_h2",
    ]);
    const nbaAllowedMarkets = new Set([
      "ft",
      "h1",
      "h2",
      "team_a",
      "team_b",
      "q1",
      "q2",
      "q3",
      "q4",
      "h1_team_a",
      "h1_team_b",
      "winner",
      "handicap",
    ]);
    const manualAllowedMarkets = new Set([
      "ft",
      "h1",
      "h2",
      "team_a",
      "team_b",
      "q1",
      "q2",
      "q3",
      "q4",
      "h1_team_a",
      "h1_team_b",
      "winner",
      "handicap",
    ]);

    const finalPicks = picks.filter((p) => {
      if (isWnbaRun) return wnbaAllowedMarkets.has(p.marketKey);
      if (isNbaOrNcaa) return nbaAllowedMarkets.has(p.marketKey);
      if (isManualLeagueRun) return manualAllowedMarkets.has(p.marketKey);
      return ["ft", "team_a", "team_b"].includes(p.marketKey);
    });

    const mktOrderMap = {
      ft: 1,
      h1: 2,
      h2: 2.5,
      team_a: 3,
      team_b: 4,
      q1: 5,
      q2: 6,
      q3: 7,
      q4: 8,
      h1_team_a: 9,
      h1_team_b: 10,

      winner: 1.5,
      handicap: 4.5,
      handicap_h1: 4.6,
      handicap_h2: 4.7,
    };
    finalPicks.sort((a, b) => (mktOrderMap[a.marketKey] || 99) - (mktOrderMap[b.marketKey] || 99));

    const rawMarketInputs = getRawMarketInputMap();
    const finalPicksForDisplay = finalPicks
      .map((p) => applySmartLineToPick(p, rawMarketInputs[p.marketKey], league))
      .filter(Boolean);

    finalPicksForDisplay.forEach((p) => {
      p.smartLineNoPlay = p.displayPick === "NO PLAY" && p.pick !== "NO PLAY";
    });

    finalPicksForDisplay.forEach((p) => {
      if (p.pick === "NO PLAY") {
        p.displayPick = "NO PLAY";
        p.bufferedPickText = "NO PLAY";
      }
    });

    finalPicksForDisplay.forEach((p) => {
      if (!p || p.pick === "NO PLAY" || !isFinite(p.edge) || !p.marketKey) return;
      const threshold = getLeagueEdgePointThreshold(p.league || league, p.marketKey);
      if (!isFinite(threshold) || threshold <= 0) return;
      const edgeMultiple = Math.abs(p.edge) / threshold;
      p.highEdgeFlag = edgeMultiple >= 1.5;
      p.highEdgeMultiple = Number(edgeMultiple.toFixed(2));
      p.highEdgeFlagReason = p.highEdgeFlag
        ? `Edge (${p.edge.toFixed(1)}) is ${p.highEdgeMultiple}x the ${threshold} pt threshold for this market — verify the line before staking. Grade (${p.confidence}) reflects calibrated history, not this flag.`
        : null;
    });

    applySoftTrackerInfluenceToPicks(finalPicksForDisplay, fixtureMeta, phase2Activation);
    const intelligencePack = computeIntelligencePack(league, finalLines, parsed);
    applyIntelligenceLayerToPicks(finalPicksForDisplay, intelligencePack, league);
    applyLeagueTrustToPicks(finalPicksForDisplay, league);

    finalPicksForDisplay.forEach((p) => {
      if (memoryFlags[p.marketKey]) p.usedMemory = true;
    });

    finalPicksForDisplay.forEach((p) => {
      if (p.leagueTrust?.mode === "block") {
        p.pick = "NO PLAY";
        p.confidence = "—";
        p.displayPick = "NO PLAY";
        p.bufferedPickText = "NO PLAY";
        return;
      }

      if (
        p.leagueTrust?.mode === "advisory" &&
        p.pick !== "NO PLAY" &&
        p.confidence &&
        p.confidence !== "NaN" &&
        p.confidence !== "—"
      ) {
        if (p.smartLineNoPlay) {
          const advisoryGrade = String(p.confidence || "").toUpperCase();
          const advisoryIsStrongGrade = advisoryGrade === "A" || advisoryGrade === "B";
          if (advisoryIsStrongGrade) {
            p.note =
              (p.note ? p.note + " · " : "") +
              "Smart-line: edge fails at unfavourable end of entered range — treat as lean / verify actual line.";
            p.displayPick = p.pick;
            p.bufferedPickText = p.pick;
          } else {
            p.pick = "NO PLAY";
            p.confidence = "—";
            p.displayPick = "NO PLAY";
            p.bufferedPickText = "NO PLAY";
          }
          return;
        }

        return;
      }

      if (p.pick === "NO PLAY" && p.note) {
        p.confidence = "—";
        p.displayPick = "NO PLAY";
        p.bufferedPickText = "NO PLAY";
        return;
      }

      // FIX Issue 38: do not re-call getPick with empty context — that drops
      // blowoutGap / earlier context and can flip NO PLAY ↔ OVER after grading.
      // Keep the pick already decided for this market.
      if (p.smartLineNoPlay) {
        const grade = String(p.confidence || "").toUpperCase();
        const isStrongGrade = grade === "A" || grade === "B";
        if (isStrongGrade && p.pick !== "NO PLAY") {
          p.note =
            (p.note ? p.note + " · " : "") +
            "Smart-line: edge fails at unfavourable end of entered range — treat as lean / verify actual line.";
        } else {
          p.pick = "NO PLAY";
        }
      }

      if (p.pick !== "NO PLAY") {
        p.displayPick = p.pick;
        p.bufferedPickText = p.pick;
      } else {
        p.confidence = "—";
        p.displayPick = "NO PLAY";
        p.bufferedPickText = "NO PLAY";
      }
    });

    {
      finalPicksForDisplay.forEach((p) => {
        const _isMarginMarketForWinProb =
          p.marketKey === "winner" ||
          p.marketKey === "handicap" ||
          p.marketKey === "handicap_h1" ||
          p.marketKey === "handicap_h2";
        const _hasUsableScaleForWinProb = _isMarginMarketForWinProb
          ? isFinite(p.marginEdgePct)
          : isFinite(p.line) && p.line > 0;
        if (p.pick !== "NO PLAY" && isFinite(p.proj) && _hasUsableScaleForWinProb) {
          const grade = String(p.confidence || "D").toUpperCase();
          const edgePct = _isMarginMarketForWinProb ? p.marginEdgePct : Math.abs(p.edge / p.line);

          const marketVolLimit = isFinite(p.volLimit)
            ? p.volLimit
            : getMarketVolLimit(p.league || league, p.marketKey);
          const volRatio =
            isFinite(p.volatility) && isFinite(marketVolLimit) && marketVolLimit > 0
              ? Number(p.volatility) / marketVolLimit
              : 0.5;
          const sampleTier = p.sampleTier ?? "thin";
          const hasH2H = p.hasH2H ?? false;
          const trapFlag = p.trap ?? false;

          let _lockWinProb = getConfidenceWinProbability(
            grade,
            edgePct,
            volRatio,
            sampleTier,
            hasH2H,
            trapFlag,
            league,
            typeof newSignals !== "undefined" ? newSignals : p?.newSignals || {},
          );

          // FIX: mirror getConfidenceGrade's distribution-primary blend here.
          // Previously this stored the raw logistic-only probability, which is
          // null until the model is calibrated (>=150 settled picks, then a
          // manual promote). selectLock() only trusts m.winProbability directly,
          // so a null here made every pick ineligible and Lock could never fire.
          try {
            const _lockVolLimitPts = isFinite(marketVolLimit) ? marketVolLimit : 12;
            const _lockEdgePts = _isMarginMarketForWinProb
              ? isFinite(p.marginEdgePts)
                ? p.marginEdgePts
                : isFinite(p.edge)
                  ? p.edge
                  : NaN
              : isFinite(p.edge)
                ? p.edge
                : NaN;
            const _lockDistProb = distributionWinProbability(
              _lockEdgePts,
              _lockVolLimitPts,
              volRatio,
            );
            if (Number.isFinite(_lockDistProb)) {
              _lockWinProb = Number.isFinite(_lockWinProb)
                ? clampNumber(0.7 * _lockDistProb + 0.3 * _lockWinProb, 0.02, 0.98)
                : _lockDistProb;
            }
          } catch (_lockBlendErr) {
            engineDebug("Lock winProbability distribution blend failed", {
              error: _lockBlendErr?.message || String(_lockBlendErr),
              marketKey: p.marketKey,
            });
          }

          p.winProbability = _lockWinProb;
        }
      });
    }

    const paceIcon = ftCalc.pace > 100 ? "🔥" : "🧊";

    const paceDisplay = isFinite(ftCalc.pace) && ftCalc.pace > 0 ? ftCalc.pace.toFixed(1) : "—";

    const netADisplay = isFinite(netA) ? (netA >= 0 ? "+" : "") + netA.toFixed(1) : "—";
    const netBDisplay = isFinite(netB) ? (netB >= 0 ? "+" : "") + netB.toFixed(1) : "—";
    const netAColor = !isFinite(netA) ? "var(--muted)" : netA >= 0 ? "#3a9c35" : "#c91920";
    const netBColor = !isFinite(netB) ? "var(--muted)" : netB >= 0 ? "#3a9c35" : "#c91920";
    const dashHtml = `
        <div style="background: #333; color: #ffd700; padding: 8px 10px; font-weight: 800; font-size: 11px; display: flex; justify-content: space-between; border-bottom: 1px solid var(--panel-border);">
          <span>SYNDICATE INSIGHT (LEVEL 2)</span>
          <span style="color: ${ftCalc.ftFullModel ? "#4CAF50" : "#ffa500"}">${ftCalc.ftFullModel ? "🟢 FULL MODEL" : "🟡 LIMITED DATA"}</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; padding: 12px; text-align: center; gap: 5px;">
          <div><div style="font-size: 9px; color: var(--muted); margin-bottom: 3px; text-transform: uppercase;">Team A Net</div><div style="font-size: 18px; font-weight: 900; color: ${netAColor}">${netADisplay}</div></div>
          <div><div style="font-size: 9px; color: var(--muted); margin-bottom: 3px; text-transform: uppercase;">Pace</div><div style="font-size: 18px; font-weight: 900; color: var(--tracker-strong)">${paceIcon} ${paceDisplay}</div></div>
          <div><div style="font-size: 9px; color: var(--muted); margin-bottom: 3px; text-transform: uppercase;">Team B Net</div><div style="font-size: 18px; font-weight: 900; color: ${netBColor}">${netBDisplay}</div></div>
        </div>`;

    let existingDash = document.getElementById("syndicateDashboard");
    if (!existingDash) {
      existingDash = document.createElement("div");
      existingDash.id = "syndicateDashboard";
      existingDash.style.cssText =
        "background: var(--panel); border: 1px solid var(--panel-border); margin: 10px 0; padding: 0; box-shadow: var(--shadow); font-family: sans-serif; min-height: 85px;";
      table.parentNode.insertBefore(existingDash, table);
    }
    existingDash.innerHTML = dashHtml;

    if (window.__engineInvariantFailed) {
      const inv = window.__engineInvariantFailure || {};
      engineDebug("INVARIANT SAFETY GATE: forcing all picks to NO PLAY", inv);
      finalPicksForDisplay.forEach((p) => {
        if (!p) return;
        p.pick = "NO PLAY";
        p.displayPick = "NO PLAY";
        p.bufferedPickText = "NO PLAY";
        p.confidence = "—";
        p.isLock = false;
        p.lockRestricted = true;
        p.note = `Invariant safety gate: ${inv.label || "model invariant failed"}`;
      });
    }

    let lockIdx = selectLock(
      finalPicksForDisplay.map((p) => ({
        edge: isFinite(p.displayEdge) ? p.displayEdge : p.edge,
        line: isFinite(p.displayLineUsed) ? p.displayLineUsed : p.line,
        pick: p.pick,
        fullModel: p.fullModel,
        confidence: p.confidence,
        confidenceGrade: p.confidenceGrade || p.confidence,
        winProbability: p.winProbability,
        sampleTier: p.sampleTier,
        hasH2H: p.hasH2H,
        volatility: p.volatility,
        volLimit: p.volLimit,
        trap: p.trap,
        league: p.league || league,
        marketKey: p.marketKey,
        lockStrength: p.lockStrength,
        lockRestricted: !!p.lockRestricted,

        marginEdgePct: p.marginEdgePct,
      })),
    );

    // No lock hysteresis: the current output table is re-championed on every run.
    // A newly generated candidate may take the single Lock immediately if it wins
    // the World Cup ranking above. Historical tracker state must not override the
    // strongest candidate in the current table.

    const displayablePicks = finalPicksForDisplay;

    const trackedToSave = buildResultRows({
      table,
      finalPicks: finalPicksForDisplay,
      lockIdx,
      fixtureMeta,
      league,
      diagnostics: {
        phase2Activation,
        ftSampleTier: ftCalc.ftSampleTier,
        h1SampleTier: h1Calc.h1SampleTier,
        ftProjectionOnly: ftCalc.ftProjectionOnly,
        h1ProjectionOnly: h1Calc.h1ProjectionOnly,

        h2ProjectionOnly: h2Calc.h2ProjectionOnly,
        ftHasH2H: ftCalc.ftHasH2H,
        h1HasH2H: h1Calc.h1HasH2H,
        q1HasH2H: !!q1?.hasH2H,
        q2HasH2H: !!q2?.hasH2H,
        q3HasH2H: !!q3?.hasH2H,
        q4HasH2H: !!q4?.hasH2H,
        pace: ftCalc.pace,
        paceGapRisk: ftCalc.paceGapRisk,
        h1PaceGapRisk: h1Calc.paceGapRisk,
        defensiveFloorFlag: ftCalc.defensiveFloorFlag,
        h1DefensiveFloorFlag: h1Calc.defensiveFloorFlag,
        blowoutGap: ftCalc.blowoutGap,
        volatilityBlock: ftCalc.volatilityBlock,
        trap: ftTrap,
        h1Trap: h1Trap,
        coeffFitted: isConfidenceCoeffFitted(league),

        aVol: ftCalc.aVol,
        bVol: ftCalc.bVol,
        aVol1: h1Calc.aVol1,
        bVol1: h1Calc.bVol1,
        netA: typeof netA !== "undefined" ? Number(netA) : null,
        netB: typeof netB !== "undefined" ? Number(netB) : null,
        injMultA: g_injA.scoringMult,
        injMultB: g_injB.scoringMult,

        ftFullModel: ftCalc.ftFullModel,
        h1FullModel: h1Calc.h1FullModel,
        teamFullModel: ftCalc.teamFullModel,
        intelligencePackSummary: intelligencePack,
      },
    });

    engineDebug(
      "final picks for display",
      finalPicksForDisplay.map((p) =>
        summarizePickDecisionForDebug(
          p.name,
          p.pick,
          p.displayLineUsed ?? p.line,
          isFinite(p.displayEdge) ? p.displayEdge : p.edge,
          p.confidence,
          p.note,
          !!p.lockRestricted,
        ),
      ),
    );

    window.__lastRunParsed = parsed;
    window.__lastRunFinalLines = finalLines;
    window.__lastRunLeague = league;
    window.__lastRunFixtureMeta = fixtureMeta;

    const _aud_underEdgeFactorLive = getParam("underEdgeFactor", league) ?? UNDER_EDGE_FACTOR;
    const _aud_underRatio = getLeagueUnderBlockRatio(league);
    const _aud_ftThO = getLeagueEdgePointThreshold(league, "ft");
    const _aud_ftThU = _aud_ftThO * _aud_underEdgeFactorLive;
    const _aud_h1ThO = getLeagueEdgePointThreshold(league, "h1");
    const _aud_h1ThU = _aud_h1ThO * _aud_underEdgeFactorLive;
    const _aud_tmThO = getLeagueEdgePointThreshold(league, "team_a");
    const _aud_tmThU = _aud_tmThO * _aud_underEdgeFactorLive;
    const _aud_qThO = getLeagueEdgePointThreshold(league, "q1");
    const _aud_qThU = _aud_qThO * _aud_underEdgeFactorLive;
    const _aud_aFTRaw = getOverallSeries("A", 10);
    const _aud_bFTRaw = getOverallSeries("B", 10);
    const _aud_aFTAll = getManualAllowedSeries("A", "ft", parsed);
    const _aud_bFTAll = getManualAllowedSeries("B", "ft", parsed);
    const _aud_h2hFTA = getH2HSeries("A", "ft", parsed);
    const _aud_h2hFTB = getH2HSeries("B", "ft", parsed);
    const _aud_h2hH1A = getH2HSeries("A", "h1", parsed);
    const _aud_h2hH1B = getH2HSeries("B", "h1", parsed);

    const _aud_hasAdvA =
      Array.isArray(AppState.context.data?.A?.ortg10) && AppState.context.data.A.ortg10.length > 0;
    const _aud_hasAdvB =
      Array.isArray(AppState.context.data?.B?.ortg10) && AppState.context.data.B.ortg10.length > 0;
    const _aud_ortgA = avgOrNaN(AppState.context.data?.A?.ortg10 || []);
    const _aud_drtgA = avgOrNaN(AppState.context.data?.A?.drtg10 || []);
    const _aud_paceA = avgOrNaN(AppState.context.data?.A?.pace10 || []);
    const _aud_ortgB = avgOrNaN(AppState.context.data?.B?.ortg10 || []);
    const _aud_drtgB = avgOrNaN(AppState.context.data?.B?.drtg10 || []);
    const _aud_paceB = avgOrNaN(AppState.context.data?.B?.pace10 || []);
    const _aud_lPaceBase = LEAGUE_PACE_BASES[league] || 74;
    const _aud_lRatingBase = LEAGUE_RATING_BASES[league] || 110;
    const _aud_lBase = LEAGUE_BASES[league] || LEAGUE_BASES.unknown || 160;
    const _aud_volLimit = getMarketVolLimit(league, "ft");

    const _aud_ftH2HW = ftCalc.ftHasH2H
      ? isFinite(ftCalc.ftH2HWeight)
        ? ftCalc.ftH2HWeight
        : 0
      : 0;
    const _aud_intelSig = buildTotalMarketIntelSignal(intelligencePack).signal;

    const _aud_trust = getLeagueTrustMeta(league);
    const _aud_settledPicks =
      typeof g_trackerDerivedState !== "undefined" ? g_trackerDerivedState?.settledPicks || 0 : 0;

    const _aud_gradeThresholds = {
      aThresh: getParam("confidenceAThresh", league) ?? 0.66,
      bThresh: getParam("confidenceBThresh", league) ?? 0.58,
      cThresh: getParam("confidenceCThresh", league) ?? 0.51,
    };

    window.__LAST_AUDIT_STATE = {
      meta: {
        timestamp: new Date().toISOString(),
        sessionId: window.__BETCEO_SESSION_ID,
        buildVersion: APP_BUILD_VERSION,
        modelVersion: ENGINE_MODEL_VERSION,
        league,
        leagueTrustLevel: _aud_trust.level,
        leagueTrustMode: _aud_trust.mode,
        leagueTrustGuidance: _aud_trust.guidance,
        fixtureMeta,
        teamA: document.getElementById("teamAName")?.value?.trim() || "",
        teamB: document.getElementById("teamBName")?.value?.trim() || "",
        selectedTeamIds,
      },

      rawInputs: {
        userEntered: captureAllInputs(),
        teamA_parsedSeries: {
          ftScored: parsed.aFTScored,
          ftAllowed: parsed.aFTAllowed,
          h1Scored: parsed.a1HScored,
          h1Allowed: parsed.a1HAllowed,
          q1Scored: parsed.aQ1Scored,
          q1Allowed: parsed.aQ1Allowed,
          q2Scored: parsed.aQ2Scored,
          q2Allowed: parsed.aQ2Allowed,
          q3Scored: parsed.aQ3Scored,
          q3Allowed: parsed.aQ3Allowed,
          q4Scored: parsed.aQ4Scored,
          q4Allowed: parsed.aQ4Allowed,
          ftScoredHome: parsed.aFTScoredHome,
          ftAllowedHome: parsed.aFTAllowedHome,
          ftScoredAway: parsed.aFTScoredAway,
          ftAllowedAway: parsed.aFTAllowedAway,
          ftH2H: parsed.aFTH2H,
          h1H2H: parsed.a1HH2H,
          q1H2H: parsed.aQ1H2H,
          q2H2H: parsed.aQ2H2H,
          q3H2H: parsed.aQ3H2H,
          q4H2H: parsed.aQ4H2H,
        },
        teamB_parsedSeries: {
          ftScored: parsed.bFTScored,
          ftAllowed: parsed.bFTAllowed,
          h1Scored: parsed.b1HScored,
          h1Allowed: parsed.b1HAllowed,
          q1Scored: parsed.bQ1Scored,
          q1Allowed: parsed.bQ1Allowed,
          q2Scored: parsed.bQ2Scored,
          q2Allowed: parsed.bQ2Allowed,
          q3Scored: parsed.bQ3Scored,
          q3Allowed: parsed.bQ3Allowed,
          q4Scored: parsed.bQ4Scored,
          q4Allowed: parsed.bQ4Allowed,
          ftScoredHome: parsed.bFTScoredHome,
          ftAllowedHome: parsed.bFTAllowedHome,
          ftScoredAway: parsed.bFTScoredAway,
          ftAllowedAway: parsed.bFTAllowedAway,
          ftH2H: parsed.bFTH2H,
          h1H2H: parsed.b1HH2H,
          q1H2H: parsed.bQ1H2H,
          q2H2H: parsed.bQ2H2H,
          q3H2H: parsed.bQ3H2H,
          q4H2H: parsed.bQ4H2H,
        },
        marketLines: { raw: lines, base: baseLines, final: finalLines },
        h2hCheckboxStates: {
          useFTH2H: document.getElementById("useFTH2H")?.checked || false,
          use1HH2H: document.getElementById("use1HH2H")?.checked || false,
          useQ1H2H: document.getElementById("useQ1H2H")?.checked || false,
          useQ2H2H: document.getElementById("useQ2H2H")?.checked || false,
          useQ3H2H: document.getElementById("useQ3H2H")?.checked || false,
          useQ4H2H: document.getElementById("useQ4H2H")?.checked || false,
        },
        injuryMultipliers: {
          teamA: {
            scoringMult: g_injA.scoringMult,
            outCount: g_injA.outCount,
            dtdCount: g_injA.dtdCount,
            unknownImpactCount: g_injA.unknownImpactCount,
            highUncertainty: g_injA.highUncertainty,
            hasUnknownImpact: g_injA.hasUnknownImpact,
            notes: g_injA.notes,
          },
          teamB: {
            scoringMult: g_injB.scoringMult,
            outCount: g_injB.outCount,
            dtdCount: g_injB.dtdCount,
            unknownImpactCount: g_injB.unknownImpactCount,
            highUncertainty: g_injB.highUncertainty,
            hasUnknownImpact: g_injB.hasUnknownImpact,
            notes: g_injB.notes,
          },
        },
      },

      dataQuality: {
        teamA: {
          ft_scoredCount: safeArr(parsed.aFTScored)?.length || 0,
          ft_allowedCount: safeArr(parsed.aFTAllowed)?.length || 0,
          h1_scoredCount: safeArr(parsed.a1HScored)?.length || 0,
          h1_allowedCount: safeArr(parsed.a1HAllowed)?.length || 0,
          q_scoredCount: safeArr(parsed.aQ1Scored)?.length || 0,
          ftH2H_count: safeArr(parsed.aFTH2H)?.length || 0,
          advancedStatsAvailable: _aud_hasAdvA,

          ortg10_length: (AppState.context.data?.A?.ortg10 || []).length,
          pace10_length: (AppState.context.data?.A?.pace10 || []).length,
          ftSeriesActuallyUsed: _aud_aFTRaw,
          ftAllowedActuallyUsed: _aud_aFTAll,
          ftSeries_stdDev: stdDev(_aud_aFTRaw),
          ftSeries_avg: avgOrNaN(_aud_aFTRaw),

          venueEnabled: ftCalc.aVenueEnabled,
          venueAdjustment: ftCalc.aVenueAdjustment,

          venuePrePost: {
            offensiveAdj: ftCalc.aVenueAdjustment?.offensiveAdjustment ?? null,
            defensiveAdj: ftCalc.aVenueAdjustment?.defensiveAdjustment ?? null,
            enabled: !!ftCalc.aVenueEnabled,
          },
          missingFTScored: !safeArr(parsed.aFTScored)?.length,
          missingFTAllowed: !safeArr(parsed.aFTAllowed)?.length,
        },
        teamB: {
          ft_scoredCount: safeArr(parsed.bFTScored)?.length || 0,
          ft_allowedCount: safeArr(parsed.bFTAllowed)?.length || 0,
          h1_scoredCount: safeArr(parsed.b1HScored)?.length || 0,
          h1_allowedCount: safeArr(parsed.b1HAllowed)?.length || 0,
          q_scoredCount: safeArr(parsed.bQ1Scored)?.length || 0,
          ftH2H_count: safeArr(parsed.bFTH2H)?.length || 0,
          advancedStatsAvailable: _aud_hasAdvB,

          ortg10_length: (AppState.context.data?.B?.ortg10 || []).length,
          pace10_length: (AppState.context.data?.B?.pace10 || []).length,
          ftSeriesActuallyUsed: _aud_bFTRaw,
          ftAllowedActuallyUsed: _aud_bFTAll,
          ftSeries_stdDev: stdDev(_aud_bFTRaw),
          ftSeries_avg: avgOrNaN(_aud_bFTRaw),

          venueEnabled: ftCalc.bVenueEnabled,
          venueAdjustment: ftCalc.bVenueAdjustment,
          venuePrePost: {
            offensiveAdj: ftCalc.bVenueAdjustment?.offensiveAdjustment ?? null,
            defensiveAdj: ftCalc.bVenueAdjustment?.defensiveAdjustment ?? null,
            enabled: !!ftCalc.bVenueEnabled,
          },
          missingFTScored: !safeArr(parsed.bFTScored)?.length,
          missingFTAllowed: !safeArr(parsed.bFTAllowed)?.length,
        },
        shared: {
          ftSampleTier: ftCalc.ftSampleTier,
          h1SampleTier: h1Calc.h1SampleTier,
          insufficientDataBlock: ftCalc.ftSampleTier === "insufficient",
          ftHasH2H: ftCalc.ftHasH2H,
          h1HasH2H: h1Calc.h1HasH2H,

          h2hGamesInContext: Math.max(
            (AppState.context.data?.h2hGames || []).length,
            Math.min(safeArr(parsed.aFTH2H)?.length || 0, safeArr(parsed.bFTH2H)?.length || 0),
          ),
          ftH2HSeriesLenA: _aud_h2hFTA ? _aud_h2hFTA.length : safeArr(parsed.aFTH2H)?.length || 0,
          ftH2HSeriesLenB: _aud_h2hFTB ? _aud_h2hFTB.length : safeArr(parsed.bFTH2H)?.length || 0,
          h1H2HSeriesLenA: _aud_h2hH1A ? _aud_h2hH1A.length : safeArr(parsed.a1HH2H)?.length || 0,
          h1H2HSeriesLenB: _aud_h2hH1B ? _aud_h2hH1B.length : safeArr(parsed.b1HH2H)?.length || 0,
          missingMarkets: { ft: !ftLine, h1: !h1Line, teamA: !aLine, teamB: !bLine },
          fallbacksTriggered: {
            aFTSeriesFellBackToManual:
              !_aud_hasAdvA || !(AppState.context.data?.A?.overall?.ftScored10?.length >= 2),
            bFTSeriesFellBackToManual:
              !_aud_hasAdvB || !(AppState.context.data?.B?.overall?.ftScored10?.length >= 2),
          },
        },
      },

      engineConfig: {
        leagueBase: _aud_lBase,
        leaguePaceBase: _aud_lPaceBase,
        leagueRatingBase: _aud_lRatingBase,
        leagueVolLimit: _aud_volLimit,
        underEdgeFactor: _aud_underEdgeFactorLive,
        underBlockRatio: _aud_underRatio,
        edgeThresholds: {
          ft: { over: _aud_ftThO, under: _aud_ftThU },
          h1: { over: _aud_h1ThO, under: _aud_h1ThU },
          team: { over: _aud_tmThO, under: _aud_tmThU },
          q: { over: _aud_qThO, under: _aud_qThU },
        },
        leagueEdgePointThresholds: LEAGUE_EDGE_POINT_THRESHOLDS,
        modelConfig: MODEL_CONFIG,
        modelTuning: MODEL_TUNING,

        trackerSoftEffects: TRACKER_SOFT_EFFECTS,

        leagueTrustMeta: _aud_trust,

        h2hMaxWeightCap: getParam("h2hMaxWeight", league) ?? 0.3,
        recencyWeightsUsed: { ft: _runFTWeights, h1: _runH1Weights },
        verifiedFtConfig: verifiedFtConfig
          ? {
              configKey: verifiedFtConfig.configKey,
              netDelta: verifiedFtConfig.netDelta,
              sampleCount: verifiedFtConfig.sampleCount,
            }
          : null,
        verifiedH1Config: verifiedH1Config
          ? {
              configKey: verifiedH1Config.configKey,
              netDelta: verifiedH1Config.netDelta,
              sampleCount: verifiedH1Config.sampleCount,
            }
          : null,
        ftConfigOverrideKeys: Object.keys(ftConfigOverride),
        h1ConfigOverrideKeys: Object.keys(h1ConfigOverride),
        gradeThresholds: _aud_gradeThresholds,

        confidenceModelNote:
          "Live model is logistic getConfidenceWinProbability via shared buildConfidenceFeatures (edgePct pivot 0.060 only — no 0.055 abs boost; sampleFull/h2h/trap; optional Platt). Train/serve identical features. Grades A/B/C from winProb vs thresholds. NaN = NO PLAY.",
        phase2Control: PHASE2_CONTROL,
        trackerPolicy: TRACKER_POLICY,
        trackerLearningEnabled: TRACKER_LEARNING_ENABLED,
        leagueVolLimits: LEAGUE_VOL_LIMITS,
        leaguePaceBases: LEAGUE_PACE_BASES,
        leagueRatingBases: LEAGUE_RATING_BASES,
        leagueBases: LEAGUE_BASES,
      },

      projectionBuild: {
        FT_TOTAL: {
          STEP1_rawSeries: { teamA: _aud_aFTRaw, teamB: _aud_bFTRaw },
          STEP1_allowedSeries: { teamA: _aud_aFTAll, teamB: _aud_bFTAll },
          STEP1_sampleSizes: { teamA: _aud_aFTRaw.length, teamB: _aud_bFTRaw.length },
          STEP2_averages: {
            teamA_scoredAvg: avgOrNaN(_aud_aFTRaw),
            teamB_scoredAvg: avgOrNaN(_aud_bFTRaw),
            teamA_allowedAvg: avgOrNaN(_aud_aFTAll),
            teamB_allowedAvg: avgOrNaN(_aud_bFTAll),
            teamA_stdDev: stdDev(_aud_aFTRaw),
            teamB_stdDev: stdDev(_aud_bFTRaw),
          },
          STEP3_anchorInputs: {
            sampleSizeForAnchor: Math.min(_aud_aFTRaw.length, _aud_bFTRaw.length),
            leagueBasePerTeam: _aud_lBase / 2,
            formulaNote:
              "anchorProjection(avg, n, base): when n>=6 returns avg unchanged; otherwise blends toward base at (n/6)",
          },
          STEP4_volatilityAdjust: {
            teamA_stdDev: stdDev(_aud_aFTRaw),
            teamB_stdDev: stdDev(_aud_bFTRaw),
            leagueVolLimit: _aud_volLimit,
            // A1/A3 fix: this note used to describe the old mean-shrink formula,
            // which was removed — applyVolatility is now an identity on proj, so
            // the note was actively describing a formula that no longer runs.
            formulaNote:
              "applyVolatility(proj) is an identity — volatility no longer shrinks the mean. It is instead used as the SD of a Normal predictive distribution (see distributionWinProbability/_normalCdf), blended 70/30 with the logistic model to produce P(total beats line).",
          },
          STEP5_advancedStatsBlend: {
            used: ftCalc.usedAdvanced,
            inputs: {
              ortgA: _aud_ortgA,
              drtgA: _aud_drtgA,
              paceA: _aud_paceA,
              ortgB: _aud_ortgB,
              drtgB: _aud_drtgB,
              paceB: _aud_paceB,
            },
            syntheticPace: ftCalc.pace,
            leaguePaceBase: _aud_lPaceBase,
            leagueRatingBase: _aud_lRatingBase,
            projectedRatingA:
              isFinite(_aud_ortgA) && isFinite(_aud_drtgB)
                ? _aud_ortgA + _aud_drtgB - _aud_lRatingBase
                : null,
            projectedRatingB:
              isFinite(_aud_ortgB) && isFinite(_aud_drtgA)
                ? _aud_ortgB + _aud_drtgA - _aud_lRatingBase
                : null,

            formulaNote:
              "projA=(synPace*projectedRatingA)/(100*(48/regMinutes)); projB=(synPace*projectedRatingB)/(100*(48/regMinutes)) — divisor scales with getLeagueRegulationMinutes(league), not a flat 100; only equals /100 when regMinutes=48 (NBA, NBA G-League, NBA Summer League — WNBA, NCAA, NCAAW, and most international FIBA-rule leagues play 40-minute games, so their divisor is 100*1.2=120)",
          },
          STEP6_intelligenceAdjust: {
            signal: _aud_intelSig,
            restDaysA: intelligencePack.restDaysA,
            restDaysB: intelligencePack.restDaysB,
            backToBack: intelligencePack.backToBack,
            travelMiles: intelligencePack.travelMiles,
            formulaNote:
              "applyDampedIntelSignal: scaledSignal=sign(rawSignal)*log1p(abs(rawSignal))*1.5, dampening=max(0.3, 1-(opponentVolRatio||0.5)*0.5), result=baseProj+(scaledSignal*dampening) — NOT a flat aS+=signal/2",
          },
          STEP6b_postIntelProj: { teamA: ftCalc.aS, teamB: ftCalc.bS },
          STEP7_h2hBlend: {
            enabled: ftCalc.ftHasH2H,
            seriesA: _aud_h2hFTA,
            seriesB: _aud_h2hFTB,
            avgA: avgOrNaN(_aud_h2hFTA),
            avgB: avgOrNaN(_aud_h2hFTB),
            h2hWeight: _aud_ftH2HW,
            teamWeight: 1 - _aud_ftH2HW,
            formulaNote:
              'projA = projA*(1-hw) + avgH2HA*hw  (hw is dynamic via getH2HWeight: sample-size log-scaled, capped at 0.30 by default (getParam("h2hMaxWeight", league)), damped by injury/volatility/blowout/pace-gap — NOT a fixed constant)',
          },
          STEP8_injuryMultApplication: {
            multA: g_injA.scoringMult,
            multB: g_injB.scoringMult,
            noteA: "Applied inside computeFTProjection via injMultA param",
            noteB: "Applied inside computeFTProjection via injMultB param",
          },
          STEP9_finalProjections: {
            teamA: ftCalc.projAFT,
            teamB: ftCalc.projBFT,
            total: ftCalc.ftProj,
          },
          STEP10_edgeCalc: {
            marketLine: ftLine,
            edge: ftCalc.ftEdge,
            edgePct:
              isFinite(ftCalc.ftEdge) && ftLine
                ? (Math.abs(ftCalc.ftEdge / ftLine) * 100).toFixed(2) + "%"
                : null,
          },
          diagnostics: {
            blowoutGap: ftCalc.blowoutGap,
            synNetA: ftCalc.synNetA,
            synNetB: ftCalc.synNetB,
            netA,
            netB,
            ftFullModel: ftCalc.ftFullModel,
            ftProjectionOnly: ftCalc.ftProjectionOnly,
            aVenueEnabled: ftCalc.aVenueEnabled,
            bVenueEnabled: ftCalc.bVenueEnabled,
            volatilityBlock: ftCalc.volatilityBlock,
          },
        },

        H1_TOTAL: {
          STEP1_rawSeries: {
            teamA: safeArr(parsed.a1HScored) || [],
            teamB: safeArr(parsed.b1HScored) || [],
          },
          STEP1_allowedSeries: {
            teamA: safeArr(parsed.a1HAllowed) || [],
            teamB: safeArr(parsed.b1HAllowed) || [],
          },
          STEP1_sampleSizes: {
            teamA: safeArr(parsed.a1HScored)?.length || 0,
            teamB: safeArr(parsed.b1HScored)?.length || 0,
          },
          STEP2_averages: { teamA_scoredAvg: h1Calc.aS1, teamB_scoredAvg: h1Calc.bS1 },
          STEP3_leagueBase1H: _aud_lBase / 4,
          STEP4_advancedBlend: { used: ftCalc.usedAdvanced, pace: ftCalc.pace },
          STEP5_h2hBlend: {
            enabled: h1Calc.h1HasH2H,
            seriesA: _aud_h2hH1A,
            seriesB: _aud_h2hH1B,
            avgA: avgOrNaN(_aud_h2hH1A),
            avgB: avgOrNaN(_aud_h2hH1B),
          },
          STEP6_untetheredH1Calculation: {
            formulaNote:
              "h1Proj is calculated untethered from FT, based strictly on H1 scored/allowed averages and league base",
          },
          STEP7_finalProjections: {
            teamA: h1Calc.projA1H,
            teamB: h1Calc.projB1H,
            total: h1Calc.h1Proj,
          },
          STEP8_edgeCalc: { marketLine: h1Line, edge: h1Calc.h1Edge },
          diagnostics: {
            sampleTier: h1Calc.h1SampleTier,
            h1FullModel: h1Calc.h1FullModel,
            h1ProjectionOnly: h1Calc.h1ProjectionOnly,
            paceGapRisk: h1Calc.paceGapRisk,
            defensiveFloorFlag: h1Calc.defensiveFloorFlag,
            volA: h1Calc.aVol1,
            volB: h1Calc.bVol1,
            h1ToFTRatio:
              isFinite(h1Calc.h1Proj) && isFinite(ftCalc.ftProj)
                ? (h1Calc.h1Proj / ftCalc.ftProj).toFixed(4)
                : null,
          },
        },

        TEAM_A: {
          projection: ftCalc.projAFT,
          marketLine: aLine,
          edge: ftCalc.aEdge,
          edgePct:
            isFinite(ftCalc.aEdge) && aLine
              ? (Math.abs(ftCalc.aEdge / aLine) * 100).toFixed(2) + "%"
              : null,
          injMult: g_injA.scoringMult,
          sampleTier: ftCalc.ftSampleTier,
          h2hEnabled: ftCalc.ftHasH2H,
        },
        TEAM_B: {
          projection: ftCalc.projBFT,
          marketLine: bLine,
          edge: ftCalc.bEdge,
          edgePct:
            isFinite(ftCalc.bEdge) && bLine
              ? (Math.abs(ftCalc.bEdge / bLine) * 100).toFixed(2) + "%"
              : null,
          injMult: g_injB.scoringMult,
          sampleTier: ftCalc.ftSampleTier,
          h2hEnabled: ftCalc.ftHasH2H,
        },

        QUARTERS: {
          Q1: q1
            ? {
                preReconcile_projA: q1.preAnchorProjA ?? q1.projA,
                preReconcile_projB: q1.preAnchorProjB ?? q1.projB,
                preReconcile_total: q1.preAnchorProjTotal ?? q1.proj,
                postReconcile_total:
                  finalPicksForDisplay.find((x) => x.marketKey === "q1")?.proj ?? q1.proj,
                line: q1.line,
                edge: q1.edge,
                tier: q1.tier,
                hasH2H: q1.hasH2H,
                seriesA: safeArr(parsed.aQ1Scored) || [],
                seriesB: safeArr(parsed.bQ1Scored) || [],
                allowedA: safeArr(parsed.aQ1Allowed) || [],
                allowedB: safeArr(parsed.bQ1Allowed) || [],
              }
            : null,
          Q2: q2
            ? {
                preReconcile_projA: q2.preAnchorProjA ?? q2.projA,
                preReconcile_projB: q2.preAnchorProjB ?? q2.projB,
                preReconcile_total: q2.preAnchorProjTotal ?? q2.proj,
                postReconcile_total:
                  finalPicksForDisplay.find((x) => x.marketKey === "q2")?.proj ?? q2.proj,
                line: q2.line,
                edge: q2.edge,
                tier: q2.tier,
                hasH2H: q2.hasH2H,
                seriesA: safeArr(parsed.aQ2Scored) || [],
                seriesB: safeArr(parsed.bQ2Scored) || [],
                allowedA: safeArr(parsed.aQ2Allowed) || [],
                allowedB: safeArr(parsed.bQ2Allowed) || [],
              }
            : null,
          Q3: q3
            ? {
                preReconcile_projA: q3.preAnchorProjA ?? q3.projA,
                preReconcile_projB: q3.preAnchorProjB ?? q3.projB,
                preReconcile_total: q3.preAnchorProjTotal ?? q3.proj,
                postReconcile_total:
                  finalPicksForDisplay.find((x) => x.marketKey === "q3")?.proj ?? q3.proj,
                line: q3.line,
                edge: q3.edge,
                tier: q3.tier,
                hasH2H: q3.hasH2H,
                seriesA: safeArr(parsed.aQ3Scored) || [],
                seriesB: safeArr(parsed.bQ3Scored) || [],
                allowedA: safeArr(parsed.aQ3Allowed) || [],
                allowedB: safeArr(parsed.bQ3Allowed) || [],
              }
            : null,
          Q4: q4
            ? {
                preReconcile_projA: q4.preAnchorProjA ?? q4.projA,
                preReconcile_projB: q4.preAnchorProjB ?? q4.projB,
                preReconcile_total: q4.preAnchorProjTotal ?? q4.proj,
                postReconcile_total:
                  finalPicksForDisplay.find((x) => x.marketKey === "q4")?.proj ?? q4.proj,
                line: q4.line,
                edge: q4.edge,
                tier: q4.tier,
                hasH2H: q4.hasH2H,
                seriesA: safeArr(parsed.aQ4Scored) || [],
                seriesB: safeArr(parsed.bQ4Scored) || [],
                allowedA: safeArr(parsed.aQ4Allowed) || [],
                allowedB: safeArr(parsed.bQ4Allowed) || [],
              }
            : null,
        },

        reconciliation: {
          ftProjAnchor: ftCalc.ftProj,
          quarterScalingFormula:
            "q1/q2Scale = h1Target*qProj*qWeight/(totalWeightedRaw||1)/qProj (qWeight=1.0 for all quarters, h1Target=h1Calc.h1Proj or rawQ12Sum fallback); q3/q4Scale mirrors this against h2Target=ftProj-h1Target. Blended in via MODEL_TUNING.quarterAnchorBlendWeight (0.7), not a rawQSum>50 gate.",
          h1TetheredToQSumFormula:
            "REMOVED (FIX #39): h1Proj is authoritative from compute1HProjection and is no longer overwritten by q1.proj + q2.proj",
          finalH1Proj: h1Calc.h1Proj,
          finalFTProj: ftCalc.ftProj,
          h1FTRatio:
            isFinite(h1Calc.h1Proj) && isFinite(ftCalc.ftProj)
              ? (h1Calc.h1Proj / ftCalc.ftProj).toFixed(4)
              : null,
          hallucinationGuard:
            (finalPicksForDisplay.find((x) => x.marketKey === "h1")?.proj || 0) /
              (finalPicksForDisplay.find((x) => x.marketKey === "ft")?.proj || 1) >
            0.58
              ? "WARNING"
              : "Stable",
        },
      },

      confidenceBuild: {
        gradeThresholds: _aud_gradeThresholds,
        scoringFormula:
          "STALE-STRING FIX: the additive score system previously documented here (score += 2.0/1.0/-2/-4/-1.0, clamp(edgePct...), q4EdgeNorm, etc.) does not exist in the live code and never ran during this build. Actual live grading (getConfidenceGrade / resolveConfidenceGradeFromWinProbability): winProb = 0.7*distributionWinProbability(edge, marketVolLimit, volRatio) + 0.3*getConfidenceWinProbability(logistic) when both are finite, else whichever is finite, else NaN sentinel (NO PLAY). getConfidenceWinProbability itself returns null until BB_CONFIDENCE_MODEL_COEFF is fitted for the resolved scope AND that scope has >=40 settled picks (BB_CONFIDENCE_MODEL_COEFF_N) — so distribution CDF is the sole driver until then. Grade A is unreachable (capped at B) while isConfidenceCoeffFitted(league) is false, i.e. before calibration. Thresholds: winProb>=aThresh->A, >=bThresh->B, >=cThresh->C, else D; an ECE-based cap (D13) can further cap to B/C for poorly-calibrated market/league scopes with n>=30 tracked outcomes.",
        markets: {
          FT: {
            pick: ftPick,
            note: ftNote,
            line: ftLine,
            edge: ftCalc.ftEdge,
            edgePct: isFinite(ftCalc.ftEdge) && ftLine ? Math.abs(ftCalc.ftEdge / ftLine) : null,
            sampleTier: ftCalc.ftSampleTier,
            projectionOnly: ftCalc.ftProjectionOnly,
            fullModel: ftCalc.ftFullModel,
            trap: ftTrap,
            hasH2H: ftCalc.ftHasH2H,
            marketKey: "ft",
            finalGrade: ftConfidence,
          },
          H1: {
            pick: h1Pick,
            note: h1Note,
            line: h1Line,
            edge: h1Calc.h1Edge,
            edgePct: isFinite(h1Calc.h1Edge) && h1Line ? Math.abs(h1Calc.h1Edge / h1Line) : null,
            sampleTier: h1Calc.h1SampleTier,
            projectionOnly: h1Calc.h1ProjectionOnly,
            fullModel: h1Calc.h1FullModel,
            trap: h1Trap,
            hasH2H: h1Calc.h1HasH2H,
            marketKey: "h1",
            finalGrade: h1ConfidenceFinal,
          },
          TEAM_A: {
            pick: aPick,
            note: ftNote,
            line: aLine,
            edge: ftCalc.aEdge,
            edgePct: isFinite(ftCalc.aEdge) && aLine ? Math.abs(ftCalc.aEdge / aLine) : null,
            sampleTier: ftCalc.ftSampleTier,
            projectionOnly: ftCalc.ftProjectionOnly,
            fullModel: ftCalc.teamFullModel,
            trap: aTrap,
            hasH2H: ftCalc.ftHasH2H,
            marketKey: "team_a",
            finalGrade: aConfidence,
          },
          TEAM_B: {
            pick: bPick,
            note: ftNote,
            line: bLine,
            edge: ftCalc.bEdge,
            edgePct: isFinite(ftCalc.bEdge) && bLine ? Math.abs(ftCalc.bEdge / bLine) : null,
            sampleTier: ftCalc.ftSampleTier,
            projectionOnly: ftCalc.ftProjectionOnly,
            fullModel: ftCalc.teamFullModel,
            trap: bTrap,
            hasH2H: ftCalc.ftHasH2H,
            marketKey: "team_b",
            finalGrade: bConfidence,
          },
          Q1: {
            pick: q1?.pick || "NO PLAY",
            note: null,
            line: q1?.line,
            edge: q1?.edge,
            edgePct: isFinite(q1?.edge) && q1?.line ? Math.abs(q1.edge / q1.line) : null,
            sampleTier: q1?.tier,
            projectionOnly: q1?.projectionOnly ?? false,
            fullModel: q1?.fullModel ?? false,
            trap: q1?.trap ?? false,
            hasH2H: q1?.hasH2H,
            marketKey: "q1",
            finalGrade: q1?.confidence || "NaN",
          },
          Q2: {
            pick: q2?.pick || "NO PLAY",
            note: null,
            line: q2?.line,
            edge: q2?.edge,
            edgePct: isFinite(q2?.edge) && q2?.line ? Math.abs(q2.edge / q2.line) : null,
            sampleTier: q2?.tier,
            projectionOnly: q2?.projectionOnly ?? false,
            fullModel: q2?.fullModel ?? false,
            trap: q2?.trap ?? false,
            hasH2H: q2?.hasH2H,
            marketKey: "q2",
            finalGrade: q2?.confidence || "NaN",
          },
          Q3: {
            pick: q3?.pick || "NO PLAY",
            note: null,
            line: q3?.line,
            edge: q3?.edge,
            edgePct: isFinite(q3?.edge) && q3?.line ? Math.abs(q3.edge / q3.line) : null,
            sampleTier: q3?.tier,
            projectionOnly: q3?.projectionOnly ?? false,
            fullModel: q3?.fullModel ?? false,
            trap: q3?.trap ?? false,
            hasH2H: q3?.hasH2H,
            marketKey: "q3",
            finalGrade: q3?.confidence || "NaN",
          },
          Q4: {
            pick: q4?.pick || "NO PLAY",
            note: null,
            line: q4?.line,
            edge: q4?.edge,
            edgePct: isFinite(q4?.edge) && q4?.line ? Math.abs(q4.edge / q4.line) : null,
            sampleTier: q4?.tier,
            projectionOnly: q4?.projectionOnly ?? false,
            fullModel: q4?.fullModel ?? false,
            trap: q4?.trap ?? false,
            hasH2H: q4?.hasH2H,
            marketKey: "q4",
            finalGrade: q4?.confidence || "NaN",
          },
        },
      },

      trackerSoftImpacts: {
        settledTrackedCount: _aud_settledPicks,
        advisoryOnly:
          !!TRACKER_POLICY.advisoryOnly ||
          (phase2Activation
            ? !phase2Activation.trackerFeedbackLive && !phase2Activation.teamMemoryLive
            : true),
        picksAnalyzed: finalPicksForDisplay.map((p) => ({
          market: p.marketKey,
          side: getPickSideFromText(p.pick),
          originalPick: p.shadowTrackerFeedback?.originalPick || p.pick,
          influence: p.trackerSoftInfluence || "None",
        })),
      },

      reproducibility: {
        modelGradeA_Threshold: _aud_gradeThresholds.aThresh,
        modelGradeB_Threshold: _aud_gradeThresholds.bThresh,
        modelGradeC_Threshold: _aud_gradeThresholds.cThresh,
        calculatedWinProbabilities: finalPicksForDisplay.map((p) => ({
          market: p.marketKey,
          winProbability: p.winProbability || null,
        })),
      },
    };

    const actionablePicks = finalPicksForDisplay.filter(
      (p) =>
        p &&
        p.pick !== "NO PLAY" &&
        !p.note &&
        isFinite(p.displayLineUsed ?? p.line) &&
        (p.displayLineUsed ?? p.line) > 0,
    );

    engineDebug("run output prepared", {
      lockIdx,
      trackedToSave: trackedToSave.length,
      actionablePicks: actionablePicks.length,
      trackerStateBeforeSave: getTrackerStateDebugScore(g_trackerState),
    });

    if (trackedToSave.length) {
      addTrackedPicks(trackedToSave);
      scheduleTrackerSave();
      engineDebug("tracked picks saved", {
        trackedToSave: trackedToSave.length,
        trackerStateAfterSave: getTrackerStateDebugScore(g_trackerState),
      });
    } else if (actionablePicks.length) {
      engineDebug("actionable picks were not saved to tracker", {
        reason: "tracker payload validation rejected every actionable pick",
      });
    }

    engineDebug("run finished successfully", {
      trackerState: getTrackerStateDebugScore(g_trackerState),
      resultsShown: finalPicksForDisplay.length,
    });

    setTimeout(() => {
      const rect = table.getBoundingClientRect();
      const isInView = rect.top >= 0 && rect.bottom <= window.innerHeight;
      if (!isInView) {
        table.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 300);
  } catch (err) {
    if (err && err.name === "EngineInvariantError") {
      console.error("[BB Engine] invariant safety stop", err);
      engineDebug("CRITICAL: Engine invariant failed; prediction suppressed.", {
        error: String(err?.message || err),
      });
      if (table) {
        table.style.display = "table";
        table.innerHTML =
          "<tr><th>Pick</th><th>Projection</th><th>Edge</th><th>Model Grade</th><th>Prediction</th></tr>";
        showRunError(
          table,
          "NO PLAY — engine safety invariant failed. The prediction was suppressed.",
        );
      }
      return;
    }

    console.error("[BB Engine] runEngine failed", err);
    engineDebug("run failed", {
      error: String(err?.message || err),
      stack: err?.stack || "no stack",
    });
    if (table) {
      table.style.display = "table";
      table.innerHTML =
        "<tr><th>Pick</th><th>Projection</th><th>Edge</th><th>Model Grade</th><th>Prediction</th></tr>";

      showRunError(
        table,
        "⚠ Engine error: " +
          escapeHtml(String(err?.message || err)) +
          " — check 🔬 debug panel for stack trace.",
      );
    }

    throw err;
  } finally {
    window.__engineRunInProgress = false;
    MODEL_TUNING.recencyWeights = _savedRecencyWeights;
    engineDebug("run finally", { trackerState: getTrackerStateDebugScore(g_trackerState) });
    if (runBtn) runBtn.disabled = false;
  }
}
