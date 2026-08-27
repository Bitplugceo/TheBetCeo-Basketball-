
function promoteConfigToLock(league, market, fullConfig, evalResult, opts) {
  opts = opts || {};
  if (!league || !market || !fullConfig || typeof fullConfig !== "object") {
    return { ok: false, reason: "Missing league, market, or fullConfig" };
  }

  if (!opts.force) {
    const gate = validateLockEvidence(evalResult, opts);
    if (!gate.ok) return gate;
  }

  const meta = {
    lockedAt: new Date().toISOString(),
    searchVersion: "joint-v1",
    sampleSize: evalResult && evalResult.holdout ? evalResult.holdout.decisive : null,
    holdoutWinRate: evalResult && evalResult.holdout ? evalResult.holdout.winRate : null,
    holdoutFired: evalResult && evalResult.holdout ? evalResult.holdout.fired : null,
    holdoutAtsRate: evalResult && evalResult.holdout ? evalResult.holdout.atsRate : null,
    trainWinRate: evalResult && evalResult.train ? evalResult.train.winRate : null,
    trainDecisive: evalResult && evalResult.train ? evalResult.train.decisive : null,
    gap: evalResult ? evalResult.gap : null,
    overfitSuspect: evalResult ? !!evalResult.overfitSuspect : false,
    gamesUsed: evalResult ? (evalResult.trainGames || 0) + (evalResult.holdoutGames || 0) : null,
    forced: !!opts.force,
    note: opts.note || (opts.force ? "" : ""),
  };

  const saved = saveLockedConfig(league, market, fullConfig, meta);
  if (!saved) {
    return { ok: false, reason: "saveLockedConfig failed (storage error?)" };
  }

  if (typeof engineDebug === "function") {
    engineDebug("PHASE 6 LOCK PROMOTED", {
      league: league,
      market: market,
      holdoutWinRate: meta.holdoutWinRate,
      sampleSize: meta.sampleSize,
      forced: meta.forced,
    });
  }
  return { ok: true, meta: meta };
}

function promoteSearchReport(report, opts) {
  opts = opts || {};
  if (!report || report.error || !report.best || !report.best.config) {
    return { ok: false, reason: "Invalid search report" };
  }
  return promoteConfigToLock(
    report.league,
    report.market,
    report.best.config,
    report.best,
    Object.assign({ note: opts.note || "" }, opts),
  );
}

function addToLockShortlist(league, market, fullConfig, evalResult, label) {
  if (!league || !market || !fullConfig) return false;
  try {
    const raw = localStorage.getItem(BB_LOCK_SHORTLIST_KEY);
    const store = raw ? JSON.parse(raw) || {} : {};
    const lk = String(league).toLowerCase();
    const mk = String(market).toLowerCase();
    if (!store[lk]) store[lk] = {};
    if (!store[lk][mk]) store[lk][mk] = [];
    store[lk][mk].push({
      label: label || "candidate-" + Date.now(),
      params: Object.assign({}, fullConfig),
      holdoutWinRate: evalResult && evalResult.holdout ? evalResult.holdout.winRate : null,
      holdoutDecisive: evalResult && evalResult.holdout ? evalResult.holdout.decisive : null,
      searchScore: evalResult ? evalResult.searchScore : null,
      gap: evalResult ? evalResult.gap : null,
      addedAt: new Date().toISOString(),
    });

    if (store[lk][mk].length > 10) store[lk][mk] = store[lk][mk].slice(-10);
    localStorage.setItem(BB_LOCK_SHORTLIST_KEY, JSON.stringify(store));
    return true;
  } catch (e) {
    if (typeof engineDebug === "function") {
      engineDebug("addToLockShortlist failed: " + (e?.message || String(e)));
    }
    return false;
  }
}

function getLockShortlist(league, market) {
  try {
    const raw = localStorage.getItem(BB_LOCK_SHORTLIST_KEY);
    const store = raw ? JSON.parse(raw) || {} : {};
    const lk = String(league || "").toLowerCase();
    const mk = String(market || "").toLowerCase();
    if (lk && mk) return store[lk] && store[lk][mk] ? store[lk][mk].slice() : [];
    if (lk) return store[lk] || {};
    return store;
  } catch (e) {
    return league && market ? [] : {};
  }
}

function listLockedConfigs() {
  const store = typeof loadLockedConfigStore === "function" ? loadLockedConfigStore() : {};
  const out = [];
  Object.keys(store || {}).forEach(function (lk) {
    Object.keys(store[lk] || {}).forEach(function (mk) {
      const entry = store[lk][mk];
      if (!entry || !entry.params) return;
      out.push({
        league: lk,
        market: mk,
        meta: entry.meta || {},
        paramCount: Object.keys(entry.params).length,
      });
    });
  });
  return out;
}

function getLockStatus(league, market) {
  if (!league || !market) return { locked: false, reason: "missing league/market" };
  if (typeof hasLockedConfig !== "function" || !hasLockedConfig(league, market)) {
    return { locked: false, reason: "no lock present" };
  }
  const meta =
    typeof getLockedConfigMeta === "function" ? getLockedConfigMeta(league, market) : null;
  return {
    locked: true,
    meta: meta,
    summary: meta
      ? "LOCKED " +
        String(league).toUpperCase() +
        "/" +
        String(market).toUpperCase() +
        " · holdout " +
        ((meta.holdoutWinRate || 0) * 100).toFixed(1) +
        "%" +
        " on " +
        (meta.sampleSize || "?") +
        " decisive" +
        (meta.lockedAt ? " · " + String(meta.lockedAt).slice(0, 10) : "")
      : "LOCKED " + String(league).toUpperCase() + "/" + String(market).toUpperCase(),
  };
}

window.validateLockEvidence = validateLockEvidence;
window.promoteConfigToLock = promoteConfigToLock;
window.promoteSearchReport = promoteSearchReport;
window.addToLockShortlist = addToLockShortlist;
window.getLockShortlist = getLockShortlist;
window.listLockedConfigs = listLockedConfigs;
window.getLockStatus = getLockStatus;

function getLiveLockBanner(league) {
  if (!league || typeof hasLockedConfig !== "function") return "";
  const markets = ["ft", "h1", "team_a", "team_b", "q1", "q2", "q3", "q4"];
  const active = markets.filter(function (m) {
    return hasLockedConfig(league, m);
  });
  if (!active.length) return "";
  const parts = active.map(function (m) {
    const meta = typeof getLockedConfigMeta === "function" ? getLockedConfigMeta(league, m) : null;
    const wr =
      meta && isFinite(meta.holdoutWinRate) ? (meta.holdoutWinRate * 100).toFixed(0) + "%" : "?";
    return m.toUpperCase() + " " + wr;
  });
  return "🔒 LOCKED " + String(league).toUpperCase() + ": " + parts.join(" · ");
}
window.getLiveLockBanner = getLiveLockBanner;

function validateLockedConfig(league, market, games, opts) {
  opts = opts || {};
  if (!league || !market) {
    return { ok: false, reason: "Missing league or market" };
  }
  if (typeof hasLockedConfig !== "function" || !hasLockedConfig(league, market)) {
    return { ok: false, reason: "No lock present for " + league + "/" + market };
  }

  const store = typeof loadLockedConfigStore === "function" ? loadLockedConfigStore() : {};
  const lk = String(league).toLowerCase();
  const mk = String(market).toLowerCase();
  const entry = store[lk] && store[lk][mk];
  if (!entry || !entry.params) {
    return { ok: false, reason: "Lock entry missing params" };
  }

  let gameList = Array.isArray(games) ? games : null;
  if (!gameList) {
    gameList = (Array.isArray(g_historicalGamesStore) ? g_historicalGamesStore : []).filter(
      function (g) {
        return String(g.league || "nba").toLowerCase() === lk;
      },
    );
  }
  if (!gameList.length) {
    return { ok: false, reason: "No games available for validation" };
  }

  const evalResult = evaluateConfigOnGames(gameList, entry.params, market, opts);
  const gate = validateLockEvidence(evalResult, opts);

  return {
    ok: gate.ok,
    reason: gate.ok ? null : gate.reason,
    eval: evalResult,
    meta: entry.meta || {},
    lockedConfig: entry.params,
    gamesUsed: gameList.length,
  };
}

function freezeLockedConfig(league, market, validation, opts) {
  opts = opts || {};
  if (!league || !market) return { ok: false, reason: "Missing league or market" };
  if (typeof hasLockedConfig !== "function" || !hasLockedConfig(league, market)) {
    return { ok: false, reason: "No lock present — promote first" };
  }

  if (validation && validation.ok === false) {
    return {
      ok: false,
      reason: "Cannot freeze: validation failed — " + (validation.reason || "unknown"),
    };
  }

  const store = loadLockedConfigStore();
  const lk = String(league).toLowerCase();
  const mk = String(market).toLowerCase();
  const entry = store[lk] && store[lk][mk];
  if (!entry || !entry.params) return { ok: false, reason: "Lock entry missing" };

  entry.meta = entry.meta || {};
  entry.meta.frozen = true;
  entry.meta.frozenAt = new Date().toISOString();
  entry.meta.freezeNote = opts.note || "";
  if (validation && validation.eval && validation.eval.holdout) {
    entry.meta.freezeHoldoutWinRate = validation.eval.holdout.winRate;
    entry.meta.freezeHoldoutDecisive = validation.eval.holdout.decisive;
    entry.meta.freezeSearchScore = validation.eval.searchScore;
    entry.meta.freezeGap = validation.eval.gap;
  }

  const saved = saveLockedConfigStore(store);
  if (!saved) return { ok: false, reason: "Failed to persist freeze flag" };

  if (typeof engineDebug === "function") {
    engineDebug("PHASE 8 FREEZE", {
      league: lk,
      market: mk,
      holdoutWinRate: entry.meta.freezeHoldoutWinRate,
      decisive: entry.meta.freezeHoldoutDecisive,
    });
  }
  return { ok: true, meta: entry.meta };
}

function unfreezeLockedConfig(league, market, opts) {
  opts = opts || {};
  if (!league || !market) return { ok: false, reason: "Missing league or market" };
  if (!hasLockedConfig(league, market)) {
    return { ok: false, reason: "No lock present" };
  }
  const store = loadLockedConfigStore();
  const lk = String(league).toLowerCase();
  const mk = String(market).toLowerCase();
  const entry = store[lk] && store[lk][mk];
  if (!entry) return { ok: false, reason: "Lock entry missing" };

  entry.meta = entry.meta || {};
  entry.meta.frozen = false;
  entry.meta.unfrozenAt = new Date().toISOString();
  entry.meta.unfreezeNote = opts.note || "";
  const saved = saveLockedConfigStore(store);
  if (!saved) return { ok: false, reason: "Failed to persist unfreeze" };
  return { ok: true };
}

function isLockedConfigFrozen(league, market) {
  if (!league || !market || typeof getLockedConfigMeta !== "function") return false;
  const meta = getLockedConfigMeta(league, market);
  return !!(meta && meta.frozen);
}

const _promoteConfigToLockOriginal = promoteConfigToLock;
function promoteConfigToLockGuarded(league, market, fullConfig, evalResult, opts) {
  opts = opts || {};
  if (!opts.force && isLockedConfigFrozen(league, market)) {
    return {
      ok: false,
      reason:
        "Lock is FROZEN for " +
        league +
        "/" +
        market +
        ". Unfreeze first or pass force:true after a new full search with better holdout evidence.",
    };
  }
  return _promoteConfigToLockOriginal(league, market, fullConfig, evalResult, opts);
}

promoteConfigToLock = promoteConfigToLockGuarded;
window.promoteConfigToLock = promoteConfigToLockGuarded;

function validateAndFreeze(league, market, games, opts) {
  opts = opts || {};
  const validation = validateLockedConfig(league, market, games, opts);
  if (!validation.ok) {
    return { ok: false, reason: validation.reason, validation: validation };
  }
  const frozen = freezeLockedConfig(league, market, validation, {
    note: opts.note || "",
  });
  return {
    ok: frozen.ok,
    reason: frozen.reason || null,
    validation: validation,
    meta: frozen.meta || null,
  };
}

function getFreezeStatus(league, market) {
  const base =
    typeof getLockStatus === "function" ? getLockStatus(league, market) : { locked: false };
  if (!base.locked) {
    return Object.assign({}, base, { frozen: false });
  }
  const meta = base.meta || {};
  return {
    locked: true,
    frozen: !!meta.frozen,
    frozenAt: meta.frozenAt || null,
    holdoutWinRate: meta.holdoutWinRate ?? meta.freezeHoldoutWinRate ?? null,
    sampleSize: meta.sampleSize ?? meta.freezeHoldoutDecisive ?? null,
    lockedAt: meta.lockedAt || null,
    summary: base.summary + (meta.frozen ? " · FROZEN" : " · unfrozen"),
  };
}

window.validateLockedConfig = validateLockedConfig;
window.freezeLockedConfig = freezeLockedConfig;
window.unfreezeLockedConfig = unfreezeLockedConfig;
window.isLockedConfigFrozen = isLockedConfigFrozen;
window.validateAndFreeze = validateAndFreeze;
window.getFreezeStatus = getFreezeStatus;

const TUNABLE_CONSTANTS_GRID = {
  INJURY_OPPONENT_BOOST_FACTOR: [0.1, 0.15, 0.2, 0.25, 0.3],
  UNDER_EDGE_FACTOR: [1.0, 1.1, 1.2, 1.3, 1.4],
};

function getLearnedConstantsStore() {
  try {
    const raw = localStorage.getItem("BB_LEARNED_CONSTANTS");
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    engineDebug("getLearnedConstantsStore failed to read: " + (e?.message || String(e)), {
      error: e,
    });
    return {};
  }
}

function getTunableConstant(constantName, defaultValue) {
  const store = getLearnedConstantsStore();
  const entry = store[constantName];
  return entry && isFinite(Number(entry.value)) ? Number(entry.value) : defaultValue;
}

function setTunableConstant(constantName, value, netDelta, sampleCount) {
  const store = getLearnedConstantsStore();
  store[constantName] = {
    value,
    netDelta,
    sampleCount,
    updatedAt: new Date().toISOString(),
    verified: true,
  };
  try {
    localStorage.setItem("BB_LEARNED_CONSTANTS", JSON.stringify(store));
    localStorage.removeItem(`BB_CONST_CANDIDATE_${constantName}`);
  } catch (e) {
    engineDebug("setTunableConstant failed to persist: " + (e?.message || String(e)), {
      constantName,
      error: e,
    });
  }
}

function updateConstantCandidateScore(constantName, value, delta) {
  const key = `BB_CONST_CANDIDATE_${constantName}`;
  let scores = {};
  try {
    const raw = localStorage.getItem(key);
    if (raw) scores = JSON.parse(raw);
  } catch (e) {
    engineDebug("updateConstantCandidateScore failed to read: " + (e?.message || String(e)), {
      constantName,
      error: e,
    });
  }
  const vKey = String(value);
  if (!scores[vKey]) scores[vKey] = { netDelta: 0, count: 0 };
  scores[vKey].netDelta += delta;
  scores[vKey].count++;
  try {
    localStorage.setItem(key, JSON.stringify(scores));
  } catch (e) {
    engineDebug("updateConstantCandidateScore failed to persist: " + (e?.message || String(e)), {
      constantName,
      error: e,
    });
  }
}

function selectBestConstantValue(constantName, minSamples = 60) {
  const key = `BB_CONST_CANDIDATE_${constantName}`;
  let scores = {};
  try {
    const raw = localStorage.getItem(key);
    if (raw) scores = JSON.parse(raw);
    else return null;
  } catch (e) {
    engineDebug("selectBestConstantValue failed to read: " + (e?.message || String(e)), {
      constantName,
      error: e,
    });
    return null;
  }
  const qualified = Object.entries(scores)
    .filter(([, d]) => (d.count || 0) >= minSamples)
    .map(([v, d]) => ({
      value: parseFloat(v),
      netDelta: d.netDelta || 0,
      count: d.count || 0,
      efficiency: (d.netDelta || 0) / Math.max(1, d.count || 1),
    }))
    .sort((a, b) => b.efficiency - a.efficiency);
  return qualified.length ? qualified[0] : null;
}

function calibrateEngineConstants() {
  const settled = getLearningTrackedPicks().filter(
    (p) =>
      p.snapshot &&
      p.actualScore != null &&
      (p.resultStatus === "win" || p.resultStatus === "loss"),
  );
  if (settled.length < 75) return;

  settled.forEach((pick) => {
    if (!["ft", "team_a", "team_b"].includes(pick.marketKey)) return;
    const { parsed, lines, league, injMultA, injMultB } = pick.snapshot;
    // FIX (CRITICAL #1): use the snapshot's own contextData for replay, never
    // the live global AppState, or calibration silently mixes this pick's
    // manual scores/lines with whatever game happens to be loaded right now.
    const _calibContextData = pick.snapshot?.contextData || pick.snapshot?.context || null;
    if (!(injMultA < 1 || injMultB < 1)) return;
    const numericActual = (typeof parseFinalScore === 'function' ? parseFinalScore(pick.actualScore).total : parseFloat(pick.actualScore));
    if (!isFinite(numericActual)) return;

    TUNABLE_CONSTANTS_GRID.INJURY_OPPONENT_BOOST_FACTOR.forEach((candidate) => {
      try {
        const calc = computeFTProjection({
          league,
          parsed,
          lines,
          injMultA,
          injMultB,
          contextData: _calibContextData,
          config: { injuryOppBoostFactor: candidate },
        });
        let edge, lineVal, marketKeyForPick;
        if (pick.marketKey === "ft") {
          edge = calc.ftEdge;
          lineVal = lines.ftLine;
          marketKeyForPick = "ft";
        } else if (pick.marketKey === "team_a") {
          edge = calc.aEdge;
          lineVal = lines.aLine;
          marketKeyForPick = "team_a";
        } else {
          edge = calc.bEdge;
          lineVal = lines.bLine;
          marketKeyForPick = "team_b";
        }
        const decision = getPick(edge, lineVal, league, marketKeyForPick, {});
        // FIX CRITICAL: full counterfactual matrix. Old logic required same side
        // then set delta=0 always. Now score transitions involving NO PLAY and side flips.
        const baselineWon = pick.resultStatus === "win";
        const baselineLost = pick.resultStatus === "loss";
        const candidatePlayed = decision !== "NO PLAY";
        let delta = 0;
        if (!candidatePlayed && baselineLost) delta = +1;      // avoided a loss
        else if (!candidatePlayed && baselineWon) delta = -1; // missed a win
        else if (candidatePlayed) {
          const candSide = getPickSideFromText(decision);
          let candidateWon = false;
          let candidatePush = false;
          if (isFinite(numericActual) && isFinite(lineVal) && numericActual === lineVal) {
            candidatePush = true;
          } else if (candSide === "over") candidateWon = numericActual > lineVal;
          else if (candSide === "under") candidateWon = numericActual < lineVal;
          const candidateLost = candidatePlayed && !candidateWon && !candidatePush;
          if (candSide !== pick.side) {
            if (candidateWon && baselineLost) delta = +2;
            else if (candidateLost && baselineWon) delta = -2;
            else if (candidateWon && baselineWon) delta = 0;
            else if (candidateLost && baselineLost) delta = 0;
          } else {
            // same side: no new information relative to baseline outcome
            delta = 0;
          }
        }
        if (delta !== 0)
          updateConstantCandidateScore("INJURY_OPPONENT_BOOST_FACTOR", candidate, delta);
      } catch (e) {
        engineDebug("INJURY_OPPONENT_BOOST_FACTOR candidate scoring failed", {
          error: e?.message || String(e),
        });
      }
    });
  });

  settled.forEach((pick) => {
    if (
      pick.side !== "under" ||
      !isFinite(pick.rawEdge ?? pick.edge) ||
      !isFinite(pick.lineAtPick ?? pick.line)
    )
      return;
    const numericActual = (typeof parseFinalScore === 'function' ? parseFinalScore(pick.actualScore).total : parseFloat(pick.actualScore));
    if (!isFinite(numericActual)) return;
    const edge = Number(pick.rawEdge ?? pick.edge);
    const lineVal = Number(pick.lineAtPick ?? pick.line);

    TUNABLE_CONSTANTS_GRID.UNDER_EDGE_FACTOR.forEach((candidate) => {
      const decision = getPick(edge, lineVal, pick.league, pick.marketKey, {
        underEdgeFactorOverride: candidate,
      });
      if (decision === "NO PLAY") return;
      const wouldWin = numericActual < lineVal;
      const isWin = pick.resultStatus === "win";
      const delta = wouldWin ? (isWin ? 0 : 1) : isWin ? -1 : 0;
      if (delta !== 0) updateConstantCandidateScore("UNDER_EDGE_FACTOR", candidate, delta);
    });
  });

  ["INJURY_OPPONENT_BOOST_FACTOR", "UNDER_EDGE_FACTOR"].forEach((constantName) => {
    const best = selectBestConstantValue(constantName, 60);

    const _gridSizeForConstant = (TUNABLE_CONSTANTS_GRID[constantName] || []).length || 1;
    const _correctedConstantMultiplier =
      2 * Math.sqrt(1 + Math.log(Math.max(2, _gridSizeForConstant)));

    const isSignificant =
      best &&
      isFinite(best.netDelta) &&
      isFinite(best.count) &&
      best.count > 0 &&
      best.netDelta > 0 &&
      Math.abs(best.netDelta) > _correctedConstantMultiplier * Math.sqrt(best.count);
    if (best && isSignificant) {
      try {
        localStorage.setItem(
          "BB_CONST_PROPOSAL_" + constantName,
          JSON.stringify({
            constantName,
            proposedValue: best.value,
            netDelta: best.netDelta,
            sampleCount: best.count,
            ts: new Date().toISOString(),
            applied: false,
          }),
        );
      } catch (e) {
        engineDebug(
          "calibrateEngineConstants failed to persist proposal: " + (e?.message || String(e)),
          { constantName, error: e },
        );
      }
      engineDebug("Engine constant proposed (not auto-applied — review in Configs panel)", {
        constantName,
        proposedValue: best.value,
        netDelta: best.netDelta,
        sampleCount: best.count,
      });
    }
  });
}

function getCandidateScoreKey(config) {
  const { h2hFactor, recencyProfile, paceDampening, edgeMult, injuryMult } = config;
  const recencyId =
    recencyProfile === TUNING_GRID.recencyProfiles[0]
      ? "std"
      : recencyProfile === TUNING_GRID.recencyProfiles[1]
        ? "agg"
        : "flat";
  return `h2h${h2hFactor}_rec${recencyId}_pace${paceDampening}_edge${edgeMult}_inj${injuryMult}`;
}

function updateCandidateScore(league, marketKey, config, delta, winProbability, outcome) {
  const key = getCandidateScoreKey(config);
  const storageKey = `BB_CANDIDATE_SCORES_${league}_${marketKey}`;
  let scores = {};
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) scores = JSON.parse(raw);
  } catch (e) {
    engineDebug(
      "updateCandidateScore failed to read candidate scores: " + (e?.message || String(e)),
      { league, marketKey, error: e },
    );
  }
  if (!scores[key]) scores[key] = { netDelta: 0, count: 0, brierSum: 0, brierCount: 0, deltas: [] };
  scores[key].netDelta += delta;
  scores[key].count++;
  // Keep raw per-pick deltas (bounded) so selectBestConfig can bootstrap-test
  // significance instead of relying only on the 2-sigma heuristic below.
  if (!Array.isArray(scores[key].deltas)) scores[key].deltas = [];
  if (scores[key].deltas.length < 2000) scores[key].deltas.push(delta);

  // Number.isFinite: isFinite(null)===true would corrupt Brier with 0 during unfitted phase
  if (Number.isFinite(winProbability) && (outcome === 0 || outcome === 1)) {
    if (!Number.isFinite(scores[key].brierSum)) scores[key].brierSum = 0;
    if (!Number.isFinite(scores[key].brierCount)) scores[key].brierCount = 0;
    scores[key].brierSum += Math.pow(winProbability - outcome, 2);
    scores[key].brierCount++;
  }
  try {
    localStorage.setItem(storageKey, JSON.stringify(scores));
  } catch (e) {
    engineDebug(
      "updateCandidateScore failed to persist candidate scores: " + (e?.message || String(e)),
      { league, marketKey, error: e },
    );
  }
}

function getTotalSettledCountForLeagueMarket(league, marketKey) {
  const all = getLearningTrackedPicks();
  return all.filter(
    (p) =>
      p.league === league &&
      p.marketKey === marketKey &&
      (p.resultStatus === "win" || p.resultStatus === "loss" || p.resultStatus === "push"),
  ).length;
}

function selectBestConfig(league, marketKey) {
  const storageKey = `BB_CANDIDATE_SCORES_${league}_${marketKey}`;
  let scores = {};
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) scores = JSON.parse(raw);
    else return null;
  } catch (e) {
    engineDebug("selectBestConfig failed to read candidate scores: " + (e?.message || String(e)), {
      league,
      marketKey,
      error: e,
    });
    return null;
  }

  const baselineKey = getCandidateScoreKey({
    h2hFactor: getParam("h2hFactor", league) ?? 1.0,
    recencyProfile: TUNING_GRID.recencyProfiles[0],
    paceDampening: 0.35,
    edgeMult: 1.0,
    injuryMult: 1.0,
  });
  const baselineEntry = scores[baselineKey];
  const baselineBrier =
    baselineEntry && (baselineEntry.brierCount || 0) > 0
      ? baselineEntry.brierSum / baselineEntry.brierCount
      : null;

  const qualified = Object.entries(scores)
    .filter(([, d]) => (d.count || 0) >= 25 && (d.netDelta || 0) > 0)
    .map(([key, d]) => ({
      key,
      netDelta: d.netDelta || 0,
      count: d.count || 0,
      efficiency: (d.netDelta || 0) / Math.max(1, d.count || 1),
      brier: (d.brierCount || 0) > 0 ? d.brierSum / d.brierCount : null,
      deltas: Array.isArray(d.deltas) ? d.deltas : [],
    }))
    .filter((c) => baselineBrier === null || c.brier === null || c.brier <= baselineBrier + 0.002)
    .sort((a, b) => b.efficiency - a.efficiency);
  if (!qualified.length) return null;
  const best = qualified[0];
  return {
    configKey: best.key,
    netDelta: best.netDelta,
    sampleCount: best.count,
    deltas: best.deltas,
  };
}

function getVerifiedConfig(league, marketKey) {
  const verifiedKey = `BB_VERIFIED_CONFIG_${league}_${marketKey}`;
  try {
    const raw = localStorage.getItem(verifiedKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.verified) return parsed;
    }
  } catch (e) {
    engineDebug("getVerifiedConfig failed to read/parse", {
      league,
      marketKey,
      error: e?.message || String(e),
    });
  }
  return null;
}

function logPromotionEvent(league, paramKey, oldValue, newValue, bootstrapStats, brier) {
  try {
    const key = "BB_PROMOTION_HISTORY";
    let history = [];
    const raw = localStorage.getItem(key);
    if (raw) history = JSON.parse(raw) || [];

    const stats = bootstrapStats || {};
    history.push({
      ts: new Date().toISOString(),
      league: league || "global",
      paramKey,
      oldValue,
      newValue,
      bootstrapP: isFinite(stats.p) ? parseFloat(stats.p.toFixed(4)) : null,
      bootstrapCiLow: isFinite(stats.ciLow) ? parseFloat(stats.ciLow.toFixed(4)) : null,
      bootstrapCiHigh: isFinite(stats.ciHigh) ? parseFloat(stats.ciHigh.toFixed(4)) : null,
      brier: parseFloat(brier.toFixed(5)),
    });

    if (history.length > 100) history = history.slice(-100);
    localStorage.setItem(key, JSON.stringify(history));
  } catch (e) {
    engineDebug("logPromotionEvent failed", e);
  }
}

function testConfigurationSignificance(challengerRecord, baselineRecord, requiredZ = 1.0) {
  const nc = challengerRecord.wins + challengerRecord.losses;
  const nb = baselineRecord.wins + baselineRecord.losses;
  if (nc < 5 || nb < 5) return { significant: false, z: 0 };

  const pc = challengerRecord.wins / nc;
  const pb = baselineRecord.wins / nb;

  if (pc <= pb) return { significant: false, z: 0 };

  const pooledP = (challengerRecord.wins + baselineRecord.wins) / (nc + nb);
  if (pooledP <= 0 || pooledP >= 1) return { significant: false, z: 0 };

  const se = Math.sqrt(pooledP * (1 - pooledP) * (1 / nc + 1 / nb));
  const z = (pc - pb) / se;

  return { significant: z >= requiredZ, z, requiredZ };
}

function calculateCalibrationMetrics(evaluationResults) {
  const valid = evaluationResults.filter(
    (r) =>
      r &&
      !r.isNoPlay &&
      r.winProbability != null &&
      Number.isFinite(Number(r.winProbability)) &&
      (r.win || r.loss),
  );
  if (!valid.length) return { brier: 1.0, ece: 1.0 };

  let brierSum = 0;
  const bins = Array.from({ length: 10 }, () => ({ sp: 0, so: 0, n: 0 }));

  valid.forEach((r) => {
    const outcome = r.win ? 1 : 0;
    const wp = Number(r.winProbability);
    brierSum += Math.pow(wp - outcome, 2);

    const bi = Math.min(9, Math.floor(wp * 10));
    bins[bi].sp += wp;
    bins[bi].so += outcome;
    bins[bi].n++;
  });

  const brier = brierSum / valid.length;
  const ece = bins
    .filter((b) => b.n > 0)
    .reduce((sum, b) => sum + (b.n / valid.length) * Math.abs(b.sp / b.n - b.so / b.n), 0);

  return { brier, ece, count: valid.length };
}

/** Persist per-league/market ECE for grade dampening (resolveConfidenceGradeFromWinProbability). */
function recordMarketECE(league, marketKey, ece, n) {
  if (!Number.isFinite(ece) || !Number.isFinite(n) || n < 1) return;
  try {
    const map = JSON.parse(localStorage.getItem("BB_MARKET_ECE") || "{}");
    const lk = String(league || "unknown").toLowerCase();
    const mk = String(marketKey || "ft").toLowerCase();
    map[lk + ":" + mk] = { ece: Number(ece), n: Number(n), ts: new Date().toISOString() };
    localStorage.setItem("BB_MARKET_ECE", JSON.stringify(map));
  } catch (e) {
    if (typeof engineDebug === "function")
      engineDebug("recordMarketECE failed", { error: e?.message || String(e) });
  }
}

function refreshAllMarketECEFromTracker() {
  try {
    if (
      typeof getAllTrackedPicksForReport !== "function" ||
      typeof calculateCalibrationMetrics !== "function"
    )
      return;
    const all = getAllTrackedPicksForReport().filter(
      (p) =>
        (p.resultStatus === "win" || p.resultStatus === "loss") &&
        Number.isFinite(Number(p.winProbability)),
    );
    const groups = {};
    all.forEach((p) => {
      const lk = String(p.league || "unknown").toLowerCase();
      const mk = String(p.marketKey || p.marketName || "ft")
        .toLowerCase()
        .split("<")[0]
        .trim();
      const key = lk + "|" + mk;
      if (!groups[key]) groups[key] = [];
      groups[key].push({
        win: p.resultStatus === "win",
        loss: p.resultStatus === "loss",
        winProbability: Number(p.winProbability),
        isNoPlay: false,
      });
    });
    Object.entries(groups).forEach(([key, rows]) => {
      if (rows.length < 15) return;
      const [lk, mk] = key.split("|");
      const metrics = calculateCalibrationMetrics(rows);
      if (metrics && Number.isFinite(metrics.ece)) {
        recordMarketECE(lk, mk, metrics.ece, metrics.count);
      }
    });
  } catch (e) {
    if (typeof engineDebug === "function")
      engineDebug("refreshAllMarketECEFromTracker failed", { error: e?.message || String(e) });
  }
}

function updateEnginePerformanceScore() {
  try {
    try {
      refreshAllMarketECEFromTracker();
    } catch (_e) {
      /* non-fatal */
    }
    const MIN_N = 10;
    let log = [];
    try {
      log = JSON.parse(localStorage.getItem("bb_engine_accuracy_log")) || [];
    } catch (_) {
      engineDebug("bb_engine_accuracy_log parse failed", { error: _?.message || String(_) });
    }
    const decisive = log.filter((e) => e.result === "win" || e.result === "loss").slice(-100);
    const withProb = decisive.filter((e) => e.brierContrib !== null && isFinite(e.brierContrib));

    const badge = document.getElementById("enginePerfPct");
    const fill = document.getElementById("enginePerfFill");
    if (!badge || !fill) return null;

    const enginePerfWrap = document.getElementById("engineHealthBatteryWrap");

    if (decisive.length < MIN_N) {
      if (enginePerfWrap) enginePerfWrap.style.display = "none";
      badge.textContent = "—";
      fill.style.width = "0%";
      fill.style.background = "rgba(255,255,255,0.35)";
      badge.title = "Gathering data — needs " + MIN_N + "+ settled picks";
      return null;
    }

    const wins = decisive.filter((e) => e.result === "win").length;
    const winRate = wins / decisive.length;
    const brier =
      withProb.length >= MIN_N
        ? withProb.reduce((s, e) => s + e.brierContrib, 0) / withProb.length
        : null;

    const winComponent = Math.max(0, Math.min(1, (winRate - 0.45) / 0.2)) * 100;

    const brierComponent =
      brier === null ? winComponent : Math.max(0, Math.min(1, (0.3 - brier) / 0.15)) * 100;

    const score = Math.round(
      brier === null ? winComponent : 0.6 * winComponent + 0.4 * brierComponent,
    );

    if (enginePerfWrap) enginePerfWrap.style.display = "flex";
    const batteryColor = score < 50 ? "#e0433a" : score < 80 ? "#ffffff" : "#49d45f";

    badge.textContent = score + "%";
    fill.style.width = score + "%";
    fill.style.background = batteryColor;
    badge.title = `Rolling ${decisive.length}-pick performance · win rate ${(winRate * 100).toFixed(0)}% · Brier ${brier !== null ? brier.toFixed(3) : "n/a"}`;

    try {
      localStorage.setItem(
        "BB_ENGINE_PERFORMANCE",
        JSON.stringify({
          score,
          winRate: parseFloat(winRate.toFixed(3)),
          brier,
          n: decisive.length,
          ts: new Date().toISOString(),
        }),
      );
    } catch (_) {
      engineDebug("BB_ENGINE_PERFORMANCE save failed", { error: _?.message || String(_) });
    }

    return score;
  } catch (e) {
    engineDebug("updateEnginePerformanceScore failed", e);
    return null;
  }
}


/** FIX Issue 4: parse "110-105" / "110 – 105" / numeric totals into structured score. */
function parseFinalScore(raw) {
  if (raw == null || raw === "") return { home: NaN, away: NaN, total: NaN, raw: raw };
  if (typeof raw === "number" && isFinite(raw)) {
    return { home: NaN, away: NaN, total: raw, raw: raw };
  }
  const s = String(raw).trim();
  if (/^(tie|push)$/i.test(s)) return { home: NaN, away: NaN, total: NaN, raw: s, tie: true };
  if (/^(home|away)$/i.test(s)) return { home: NaN, away: NaN, total: NaN, raw: s, side: s.toLowerCase() };
  const m = s.match(/^(\d+(?:\.\d+)?)\s*[-–:]\s*(\d+(?:\.\d+)?)$/);
  if (m) {
    const home = parseFloat(m[1]);
    const away = parseFloat(m[2]);
    return { home, away, total: home + away, raw: s };
  }
  const n = parseFloat(s);
  if (isFinite(n)) return { home: NaN, away: NaN, total: n, raw: s };
  return { home: NaN, away: NaN, total: NaN, raw: s };
}

function evaluatePickWithParams(pick, paramOverrides) {
  if (!pick.snapshot || pick.actualScore == null) return null;
  const { parsed, lines, league, injMultA, injMultB, marketKey } = pick.snapshot;
  const numericActual = (typeof parseFinalScore === 'function' ? parseFinalScore(pick.actualScore).total : parseFloat(pick.actualScore));
  if (!isFinite(numericActual)) return null;

  const originalGetParam = window.getParam;
  window.getParam = function (key, lg) {
    if (paramOverrides && Object.prototype.hasOwnProperty.call(paramOverrides, key)) {
      return paramOverrides[key];
    }
    return originalGetParam ? originalGetParam(key, lg) : getTunableParam(key, lg);
  };

  try {
    let proj, lineVal, edge;
    const finalLines = lines;

    const _twOverride = isFinite(window.getParam("teamWeightBase", league))
      ? Number(window.getParam("teamWeightBase", league))
      : 0.65;
    const _h2hFactorOverride = {
      h2hFactor: paramOverrides?.h2hFactor,
      teamWeight: _twOverride,
      oppWeight: 1 - _twOverride,
    };
    // D3: replay uses snapshot.contextData when present so tuner does not
    // re-read live AppState/DOM (selection-bias / leakage risk).
    const _replayCtx = pick.snapshot?.contextData || pick.snapshot?.context || null;
    if (marketKey === "ft") {
      const calc = computeFTProjection({
        league,
        parsed,
        lines: finalLines,
        injMultA,
        injMultB,
        config: _h2hFactorOverride,
        contextData: _replayCtx,
      });
      proj = calc.ftProj;
      lineVal = finalLines.ftLine;
      edge = calc.ftEdge;
    } else if (marketKey === "h1") {
      const calc = compute1HProjection({
        league,
        parsed,
        lines: finalLines,
        injMultA,
        injMultB,
        config: _h2hFactorOverride,
        contextData: _replayCtx,
      });
      proj = calc.h1Proj;
      lineVal = finalLines.h1Line;
      edge = calc.h1Edge;
    } else if (marketKey === "team_a") {
      const calc = computeFTProjection({
        league,
        parsed,
        lines: finalLines,
        injMultA,
        injMultB,
        config: _h2hFactorOverride,
        contextData: _replayCtx,
      });
      proj = calc.projAFT;
      lineVal = finalLines.aLine;
      edge = calc.aEdge;
    } else if (marketKey === "team_b") {
      const calc = computeFTProjection({
        league,
        parsed,
        lines: finalLines,
        injMultA,
        injMultB,
        config: _h2hFactorOverride,
        contextData: _replayCtx,
      });
      proj = calc.projBFT;
      lineVal = finalLines.bLine;
      edge = calc.bEdge;
    } else if (marketKey === "h2") {
      // FIX Issue 39: route H2 through production compute2HProjection kernel.
      const calc = compute2HProjection({
        league,
        parsed,
        lines: finalLines,
        injMultA,
        injMultB,
        config: _h2hFactorOverride,
        contextData: _replayCtx,
      });
      proj = calc.h2Proj;
      lineVal = finalLines.h2Line;
      edge = calc.h2Edge;
    } else if (marketKey.startsWith("q")) {
      // Quarter parameter tuning is disabled until the tuner is routed through
      // the same live computeQ kernel. The previous branch used a separate
      // simplified formula and could therefore learn parameters for a model
      // different from the production quarter model.
      return {
        decision: "NO PLAY",
        side: null,
        win: false,
        push: false,
        loss: false,
        isNoPlay: true,
        tunerDisabled: true,
      };
    } else {
      return null;
    }

    const decision = getPick(edge, lineVal, league, marketKey, {
      underEdgeFactorOverride: paramOverrides?.underEdgeFactor,
    });
    if (decision === "NO PLAY") {
      return {
        decision: "NO PLAY",
        side: null,
        win: false,
        push: false,
        loss: false,
        isNoPlay: true,
      };
    }

    const side = getPickSideFromText(decision);
    let win = false,
      push = false,
      loss = false;
    if (numericActual === lineVal) {
      push = true;
    } else if (side === "over") {
      if (numericActual > lineVal) win = true;
      else loss = true;
    } else if (side === "under") {
      if (numericActual < lineVal) win = true;
      else loss = true;
    }

    const edgePct = Math.abs(edge / lineVal);
    const volLimit = getMarketVolLimit(league, marketKey);
    const volRatio =
      isFinite(pick.volatility) && isFinite(volLimit) && volLimit > 0
        ? Number(pick.volatility) / volLimit
        : 0.5;
    const sampleTier = pick.sampleTier || "thin";
    const hasH2H = pick.hasH2H || false;
    let winProbability = getConfidenceWinProbability(
      null,
      edgePct,
      volRatio,
      sampleTier,
      hasH2H,
      false,
      league,
    );
    try {
      const _distProb = distributionWinProbability(edge, volLimit || 12, volRatio);
      if (Number.isFinite(_distProb)) {
        // isFinite(null) is true in JS — must use Number.isFinite so unfitted null falls to dist-only
        winProbability = Number.isFinite(winProbability)
          ? clampNumber(0.7 * _distProb + 0.3 * winProbability, 0.02, 0.98)
          : _distProb;
      }
    } catch (_e) {
      /* keep logistic */
    }

    // A8: carry American price when present so ROI is real EV, not win-rate copy.
    const price = isFinite(Number(pick.price))
      ? Number(pick.price)
      : isFinite(Number(pick.americanOdds))
        ? Number(pick.americanOdds)
        : -110;

    return {
      decision,
      side,
      win,
      push,
      loss,
      isNoPlay: false,
      winProbability,
      proj,
      actual: numericActual,
      lineVal,
      price,
    };
  } catch (e) {
    engineDebug("evaluatePickWithParams failed", {
      league,
      marketKey: pick?.marketKey,
      error: e?.message || String(e),
    });
    return null;
  } finally {
    window.getParam = originalGetParam;
  }
}

function buildRecordFromEval(evalResults = []) {
  const base = { wins: 0, losses: 0, pushes: 0, roiSum: 0, staked: 0 };
  (Array.isArray(evalResults) ? evalResults : []).forEach((r) => {
    if (!r || r.isNoPlay) return;
    if (r.win) base.wins++;
    else if (r.loss) base.losses++;
    else if (r.push) base.pushes++;
    // ROI at the recorded price, falling back to flat -110 when no price is
    // attached (currently always, until a real odds field is wired in
    // upstream — this stays a strict monotonic transform of win rate until
    // then, so it changes nothing today but is ready once price data flows).
    if (r.win || r.loss) {
      const price = isFinite(Number(r.price)) ? Number(r.price) : -110;
      const payout = price > 0 ? price / 100 : 100 / Math.abs(price);
      base.staked += 1;
      base.roiSum += r.win ? payout : -1;
    }
  });
  return base;
}

function _seededRandom(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function seededShuffle(arr, seed) {
  const rnd = _seededRandom(seed);
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function empiricalBayesShrink(groupCoeff, groupN, pooledCoeff, tau = 40) {
  if (!groupCoeff || !pooledCoeff) return groupCoeff || pooledCoeff || null;
  const n = Math.max(0, Number(groupN) || 0);
  const w = n / (n + tau);
  const out = {};
  const keys = new Set([...Object.keys(groupCoeff), ...Object.keys(pooledCoeff)]);
  keys.forEach((k) => {
    const g = isFinite(groupCoeff[k]) ? groupCoeff[k] : pooledCoeff[k];
    const p = isFinite(pooledCoeff[k]) ? pooledCoeff[k] : g;
    if (!isFinite(g) || !isFinite(p)) return;
    out[k] = w * g + (1 - w) * p;
  });
  return out;
}

const BB_INVARIANT_FAILURES = [];
class EngineInvariantError extends Error {
  constructor(message = "Engine invariant failed") {
    super(message);
    this.name = "EngineInvariantError";
  }
}

function assertInvariant(condition, label, context) {
  if (condition) return true;
  const _label = label != null && label !== "" ? String(label) : "unnamed_invariant";
  window.__engineInvariantFailed = true;
  window.__engineInvariantFailure = { label: _label, context, ts: new Date().toISOString() };
  const entry = { label: _label, context, ts: new Date().toISOString() };
  BB_INVARIANT_FAILURES.push(entry);
  if (BB_INVARIANT_FAILURES.length > 200) BB_INVARIANT_FAILURES.shift();
  try {
    engineDebug("INVARIANT FAILED: " + _label, context || {});
  } catch (e) {
    console.error("[BB Engine] engineDebug failed while reporting invariant", _label, e);
  }
  try {
    localStorage.setItem("BB_INVARIANT_FAILURES", JSON.stringify(BB_INVARIANT_FAILURES.slice(-50)));
  } catch (e) {
    console.error("[BB Engine] Failed to persist BB_INVARIANT_FAILURES", e);
  }
  throw new EngineInvariantError(_label || "Engine invariant failed");
}

function getMetricForMarket(marketKey) {
  const key = String(marketKey || "").toLowerCase();
  if (key === "ft" || key === "h1" || key === "team_a" || key === "team_b" || key.startsWith("q")) {
    return { decision: "brier", projection: "rmse" };
  }

  return { decision: "brier", projection: null };
}
function computeRMSE(evalResults) {
  const valid = (evalResults || []).filter(
    (r) =>
      r &&
      !r.isNoPlay &&
      isFinite(r.proj) &&
      isFinite(r.actual) &&
      isFinite(r.lineVal) &&
      r.lineVal !== 0,
  );
  if (!valid.length) return null;

  const sq = valid.reduce((s, r) => s + Math.pow((r.proj - r.actual) / r.lineVal, 2), 0);
  return Math.sqrt(sq / valid.length);
}

function pairedBootstrapTest(baselineWins, challengerWins, iterations = 2000, seed = 1) {
  const n = Math.min(baselineWins.length, challengerWins.length);
  if (n < 8) return { significant: false, p: 1, ciLow: 0, ciHigh: 0, n, meanDelta: 0 };
  const deltas = new Array(n);
  for (let i = 0; i < n; i++) deltas[i] = challengerWins[i] - baselineWins[i];
  const meanDelta = deltas.reduce((s, v) => s + v, 0) / n;

  const rnd = _seededRandom(seed);
  const boot = new Array(iterations);
  for (let b = 0; b < iterations; b++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += deltas[Math.floor(rnd() * n)];
    boot[b] = sum / n;
  }
  boot.sort((a, c) => a - c);
  const ciLow = boot[Math.floor(iterations * 0.025)];
  const ciHigh = boot[Math.floor(iterations * 0.975)];
  const pctAtOrBelowZero = boot.filter((v) => v <= 0).length / iterations;
  return {
    significant: ciLow > 0,
    p: Math.max(1 / iterations, pctAtOrBelowZero),
    ciLow,
    ciHigh,
    n,
    meanDelta,
  };
}

function buildWalkForwardFolds(sortedPicks, numFolds = 4) {
  const n = sortedPicks.length;
  const minFoldVal = 15;
  const usableFolds = Math.max(2, Math.min(numFolds, Math.floor(n / (minFoldVal * 2))));
  const foldSize = Math.floor(n / (usableFolds + 1));
  const folds = [];
  for (let i = 1; i <= usableFolds; i++) {
    const trainEnd = foldSize * i;
    const valEnd = i === usableFolds ? n : foldSize * (i + 1);
    if (trainEnd < 10 || valEnd - trainEnd < minFoldVal) continue;
    folds.push({ train: sortedPicks.slice(0, trainEnd), val: sortedPicks.slice(trainEnd, valEnd) });
  }
  if (!folds.length) {
    const splitIdx = Math.floor(n * 0.7);
    folds.push({ train: sortedPicks.slice(0, splitIdx), val: sortedPicks.slice(splitIdx) });
  }
  return folds;
}

function benjaminiHochbergFilter(candidates, alpha = 0.05) {
  const m = candidates.length;
  if (!m) return [];
  const sorted = candidates.slice().sort((a, b) => a.p - b.p);
  let cutoffRank = -1;
  for (let i = 0; i < m; i++) {
    if (sorted[i].p <= ((i + 1) / m) * alpha) cutoffRank = i;
  }
  if (cutoffRank < 0) return [];
  const keep = new Set(sorted.slice(0, cutoffRank + 1).map((c) => c.id));
  return candidates.filter((c) => keep.has(c.id));
}

function persistTunerEvalLog(entry) {
  try {
    const key = "BB_TUNER_LOG";
    let log = [];
    try {
      log = JSON.parse(localStorage.getItem(key) || "[]");
    } catch (e) {
      engineDebug("BB_TUNER_LOG load failed", { error: e?.message || String(e) });
    }
    log.push({ ...entry, ts: new Date().toISOString(), modelVersion: getCurrentModelVersion() });
    if (log.length > 300) log = log.slice(-300);
    localStorage.setItem(key, JSON.stringify(log));
  } catch (e) {
    engineDebug("persistTunerEvalLog failed", { error: e?.message || String(e) });
  }
}

function _getCanaryHealth(league) {
  if (league) return checkModelHealth(league);
  const allPicks = getLearningTrackedPicks().filter(
    (p) => p.resultStatus === "win" || p.resultStatus === "loss",
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
function checkTunerCanaries() {
  let canaries = {};
  try {
    canaries = JSON.parse(localStorage.getItem("BB_TUNER_CANARIES") || "{}");
  } catch (e) {
    engineDebug("checkTunerCanaries failed to load canaries", { error: e?.message || String(e) });
    return;
  }
  Object.keys(canaries).forEach((scopeKey) => {
    const c = canaries[scopeKey];
    if (!c || c.resolved) return;
    const league = c.league || null;
    const health = _getCanaryHealth(league);
    if (!health) return;
    const newSettledSinceApply = Math.max(0, health.n - (c.nAtApply || 0));
    if (newSettledSinceApply < 8) return;
    if (health.status === "degrading") {
      c.promotions.forEach((p) => setTunableParam(p.key, p.old, league, new Date().toISOString()));
      c.resolved = true;
      c.outcome = "rolled_back";
      c.resolvedAt = new Date().toISOString();
      let rollbacks = [];
      try {
        rollbacks = JSON.parse(localStorage.getItem("BB_TUNER_ROLLBACKS") || "[]");
      } catch (e) {
        engineDebug("BB_TUNER_ROLLBACKS load failed", { error: e?.message || String(e), scopeKey });
      }
      rollbacks.push({ scopeKey, promotions: c.promotions, health, ts: c.resolvedAt });
      try {
        localStorage.setItem("BB_TUNER_ROLLBACKS", JSON.stringify(rollbacks.slice(-50)));
      } catch (e) {
        engineDebug("BB_TUNER_ROLLBACKS save failed", { error: e?.message || String(e), scopeKey });
      }
      engineDebug("Tuner canary auto-rolled-back due to win-rate drift", { scopeKey, health });
    } else if (newSettledSinceApply >= (c.canaryWindow || 20)) {
      c.resolved = true;
      c.outcome = "promoted";
      c.resolvedAt = new Date().toISOString();
      engineDebug("Tuner canary window closed clean — proposal stays live", { scopeKey, health });
    }
  });
  try {
    localStorage.setItem("BB_TUNER_CANARIES", JSON.stringify(canaries));
  } catch (e) {
    engineDebug("Tuner canary save failed", { error: e?.message || String(e) });
  }
}

function runCoordinateAscentTuner(allPicks, targetLeague) {
  checkTunerCanaries();

  const settledUniverse = allPicks
    .filter(
      (p) =>
        p &&
        p.snapshot &&
        p.actualScore != null &&
        (!targetLeague || String(p.league).toLowerCase() === String(targetLeague).toLowerCase()) &&
        (p.resultStatus === "win" ||
          p.resultStatus === "loss" ||
          p.resultStatus === "no_play_settled"),
    )
    .sort((a, b) => getTrackedPickTimeMs(a) - getTrackedPickTimeMs(b));

  // B3 fix: share the OOS validator's fixed calendar cutoff instead of a
  // fresh rolling 80/20 split computed from whatever the current array size
  // happens to be — otherwise the tuner's "pre-OOS" boundary silently drifts
  // forward as picks accumulate and can end up training on rows the OOS
  // report later scores as held-out. Falls back to the old rolling split
  // only when no cutoff has been established yet for this league, or for
  // global runs, which span multiple leagues and have no single cutoff.
  let settled;
  let _oosCutoffTs = null;
  if (targetLeague) {
    try {
      const _stored = JSON.parse(
        localStorage.getItem("BB_OOS_CUTOFF_" + String(targetLeague)) || "null",
      );
      if (_stored && isFinite(_stored.cutoffTs)) _oosCutoffTs = _stored.cutoffTs;
    } catch (e) {
      engineDebug("Tuner failed to read shared OOS cutoff", {
        error: e?.message || String(e),
        targetLeague,
      });
    }
  }
  if (_oosCutoffTs !== null) {
    settled = settledUniverse.filter((p) => Date.parse(p.createdAt) < _oosCutoffTs);
  } else {
    const _tunerCutIdx = Math.floor(settledUniverse.length * 0.8);
    settled = settledUniverse.slice(0, _tunerCutIdx);
  }

  const minRequired = targetLeague ? 250 : 125;
  if (settled.length < minRequired) {
    engineDebug(
      `Coordinate ascent tuner skipped for ${targetLeague || "global"}: needs ${minRequired} pre-OOS picks, has ${settled.length}`,
    );
    return null;
  }

  settled.sort((a, b) => getTrackedPickTimeMs(a) - getTrackedPickTimeMs(b));

  const _tunerSeed =
    Array.from(String(targetLeague || "global")).reduce(
      (s, ch) => (s * 31 + ch.charCodeAt(0)) >>> 0,
      7,
    ) ^ settled.length;
  const walkForwardFolds = buildWalkForwardFolds(settled, 4);
  const trainPicks = walkForwardFolds[0].train;
  const valPicks = walkForwardFolds[walkForwardFolds.length - 1].val;
  const keysToTune = [
    "teamWeightBase",
    "h2hFactor",
    "h2hMaxWeight",
    "h2hLookbackSeasons",
    "venueMinGames",
    "venueStrongGames",
    "venueModerateWeight",
    "venueStrongWeight",
    "underEdgeFactor",
    "injuryOppBoostFactor",
    "edgeFTPointThreshold",
    "edgeH1PointThreshold",
    "edgeTeamPointThreshold",
    "edgeQPointThreshold",
    "confidenceAThresh",
    "confidenceBThresh",
    "confidenceCThresh",
    "teamVolScale",
    "quarterVolScale",
    "h2hTierInsufficientPenalty",
    "h2hTierThinPenalty",
    "h2hDivergenceThreshold",
    "h2hDivergenceSlope",
    "h2hInjuryRiskSlope",
    "h2hVolRiskSlope",
    "h2hBlowoutGapThreshold",
    "h2hBlowoutRisk",
    "h2hPaceRisk",
  ];

  const candidateGrids = {
    teamWeightBase: [0.55, 0.6, 0.65, 0.7, 0.75],

    h2hFactor: [0.75, 1.0],
    h2hMaxWeight: [0.15, 0.2, 0.25, 0.3, 0.35, 0.4],
    h2hLookbackSeasons: [2, 3, 4, 5],
    venueMinGames: [4, 5, 6, 7, 8],
    venueStrongGames: [8, 9, 10, 11, 12],
    venueModerateWeight: [0.35, 0.4, 0.45, 0.5, 0.55, 0.6],
    venueStrongWeight: [0.55, 0.6, 0.65, 0.7, 0.75, 0.8],
    underEdgeFactor: [1.0, 1.1, 1.2, 1.3, 1.4],
    injuryOppBoostFactor: [0.1, 0.15, 0.2, 0.25, 0.3],
    edgeFTPointThreshold: [4.0, 5.0, 6.0, 7.0, 8.0],
    edgeH1PointThreshold: [5.0, 6.0, 7.0, 8.0, 9.0],
    edgeTeamPointThreshold: [6.0, 7.0, 8.0, 9.0, 10.0],
    edgeQPointThreshold: [2.0, 3.0, 4.0, 5.0, 6.0],
    confidenceAThresh: [0.6, 0.63, 0.66, 0.69, 0.72],
    confidenceBThresh: [0.52, 0.55, 0.58, 0.61, 0.64],
    confidenceCThresh: [0.45, 0.48, 0.51, 0.54, 0.57],
    teamVolScale: [0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    quarterVolScale: [0.25, 0.35, 0.45, 0.5, 0.6, 0.7],
    h2hTierInsufficientPenalty: [0.35, 0.45, 0.55, 0.65, 0.75],
    h2hTierThinPenalty: [0.65, 0.75, 0.85, 0.95, 1.0],
    h2hDivergenceThreshold: [0.08, 0.12, 0.16, 0.2, 0.25],
    h2hDivergenceSlope: [1.5, 2.0, 2.5, 3.0, 3.5],
    h2hInjuryRiskSlope: [0.75, 1.0, 1.5, 2.0, 2.5],
    h2hVolRiskSlope: [0.2, 0.3, 0.4, 0.6, 0.8],
    h2hBlowoutGapThreshold: [10, 12, 15, 18, 22],
    h2hBlowoutRisk: [0.1, 0.15, 0.2, 0.25, 0.3],
    h2hPaceRisk: [0.08, 0.12, 0.15, 0.2, 0.25],
  };

  const currentParams = {};
  keysToTune.forEach((key) => {
    currentParams[key] = getParam(key, targetLeague);
  });

  let pass = 0;
  let overallChanged = false;
  const promotions = [];

  const orderedKeys = seededShuffle(keysToTune, _tunerSeed);
  const allTestedCandidates = [];

  while (pass < 2) {
    let passChanged = false;

    for (const key of orderedKeys) {
      const originalValue = currentParams[key];
      const grid = candidateGrids[key] || [];
      if (!grid.length) continue;

      let bestValue = originalValue;
      let bestTrainROI = -Infinity;
      let bestTrainRecord = null;

      const baselineTrainResults = trainPicks
        .map((p) => evaluatePickWithParams(p, currentParams))
        .filter(Boolean);
      bestTrainRecord = buildRecordFromEval(baselineTrainResults);
      bestTrainROI =
        bestTrainRecord.staked > 0 ? bestTrainRecord.roiSum / bestTrainRecord.staked : 0;

      for (const candidateVal of grid) {
        const testParams = { ...currentParams, [key]: candidateVal };
        const testResults = trainPicks
          .map((p) => evaluatePickWithParams(p, testParams))
          .filter(Boolean);
        const record = buildRecordFromEval(testResults);
        const roi = record.staked > 0 ? record.roiSum / record.staked : 0;

        if (
          roi > bestTrainROI ||
          (roi === bestTrainROI && record.wins > (bestTrainRecord?.wins || 0))
        ) {
          bestTrainROI = roi;
          bestValue = candidateVal;
          bestTrainRecord = record;
        }
      }

      if (bestValue !== originalValue) {
        const baselineValParams = { ...currentParams };
        const challengerValParams = { ...currentParams, [key]: bestValue };

        let pooledBaseline = [],
          pooledChallenger = [];
        let baselineAllResults = [],
          challengerAllResults = [];
        walkForwardFolds.forEach((fold) => {
          const baseFoldResults = fold.val.map((p) => evaluatePickWithParams(p, baselineValParams));
          const chalFoldResults = fold.val.map((p) =>
            evaluatePickWithParams(p, challengerValParams),
          );
          for (let i = 0; i < fold.val.length; i++) {
            const b = baseFoldResults[i],
              c = chalFoldResults[i];
            // FIX HIGH: evaluate full fold including NO PLAY (return 0). Old filter
            // dropped exactly the threshold-disagreement cases the tuner needs.
            if (!b && !c) continue;
            const bRet = (!b || b.isNoPlay || b.push) ? 0 : (b.win ? 1 : 0);
            const cRet = (!c || c.isNoPlay || c.push) ? 0 : (c.win ? 1 : 0);
            pooledBaseline.push(bRet);
            pooledChallenger.push(cRet);
            if (b && !b.isNoPlay) baselineAllResults.push(b);
            if (c && !c.isNoPlay) challengerAllResults.push(c);
          }
        });

        const baselineValCalibration = calculateCalibrationMetrics(baselineAllResults);
        const challengerValCalibration = calculateCalibrationMetrics(challengerAllResults);

        const marketMetrics = getMetricForMarket(valPicks[0]?.snapshot?.marketKey);
        const baselineRMSE = marketMetrics.projection ? computeRMSE(baselineAllResults) : null;
        const challengerRMSE = marketMetrics.projection ? computeRMSE(challengerAllResults) : null;

        const boot = pairedBootstrapTest(
          pooledBaseline,
          pooledChallenger,
          2000,
          _tunerSeed + key.length,
        );

        const calibrationOk =
          challengerValCalibration.brier <= baselineValCalibration.brier + 0.002;
        const rmseOk =
          baselineRMSE === null || challengerRMSE === null || challengerRMSE <= baselineRMSE + 0.01;

        allTestedCandidates.push({ id: `${key}:${pass}`, p: boot.p, key, pass });

        if (boot.significant && calibrationOk && rmseOk) {
          currentParams[key] = bestValue;
          passChanged = true;
          overallChanged = true;
          const promo = {
            id: `${key}:${pass}`,
            key,
            old: originalValue,
            val: bestValue,
            p: boot.p,
            ciLow: boot.ciLow,
            ciHigh: boot.ciHigh,
            brier: challengerValCalibration.brier,
            rmse: challengerRMSE,
          };
          promotions.push(promo);

          logPromotionEvent(
            targetLeague,
            key,
            originalValue,
            bestValue,
            boot,
            challengerValCalibration.brier,
          );

          persistTunerEvalLog({
            type: "promotion_candidate",
            league: targetLeague || "global",
            key,
            old: originalValue,
            val: bestValue,
            seed: _tunerSeed,
            foldCount: walkForwardFolds.length,
            n: pooledBaseline.length,
            bootstrap: boot,
            baselineBrier: baselineValCalibration.brier,
            challengerBrier: challengerValCalibration.brier,
            baselineRMSE,
            challengerRMSE,
          });
        }
      }
    }

    if (!passChanged) break;
    pass++;
  }

  // BH critical values must use the full hypothesis count, not only promotions
  // that already passed other gates (otherwise FDR is far too permissive).
  const _bhUniverse = allTestedCandidates.map((c) => ({ id: c.id, p: c.p }));
  const survivors = benjaminiHochbergFilter(_bhUniverse, 0.05);
  const survivorIds = new Set(survivors.map((s) => s.id));
  const finalPromotions = [];
  promotions.forEach((p) => {
    if (survivorIds.has(p.id)) {
      finalPromotions.push(p);
    } else {
      currentParams[p.key] = p.old;
      engineDebug("Promotion reverted by Benjamini-Hochberg FDR correction", {
        key: p.key,
        p: p.p,
        totalTested: allTestedCandidates.length,
      });
    }
  });

  if (finalPromotions.length > 0) {
    try {
      const proposalKey = "BB_TUNER_PROPOSAL_" + (targetLeague || "global");
      localStorage.setItem(
        proposalKey,
        JSON.stringify({
          league: targetLeague || null,
          promotions: finalPromotions,
          seed: _tunerSeed,
          foldCount: walkForwardFolds.length,
          totalHypothesesTested: allTestedCandidates.length,
          ts: new Date().toISOString(),
          applied: false,
        }),
      );
    } catch (e) {
      engineDebug(
        "runCoordinateAscentTuner failed to persist proposal: " + (e?.message || String(e)),
        { error: e },
      );
    }
    engineDebug(
      `Coordinate ascent proposed changes for ${targetLeague || "global"} (not auto-applied — review in Configs panel): ${finalPromotions.map((p) => `${p.key}: ${p.old}->${p.val} (bootstrap p=${p.p.toFixed(3)})`).join(", ")}`,
    );
    return { params: currentParams, promotions: finalPromotions };
  }

  return null;
}

async function runRetrospectiveAnalysis(pick) {
  if (!pick.snapshot || !pick.actualScore) {
    engineDebug("Retrospective skipped: missing snapshot or actualScore");
    return;
  }
  const { league, marketKey, snapshot, actualScore, resultStatus, side } = pick;
  const isWin = resultStatus === "win";
  if (!isWin && resultStatus !== "loss") return;

  const _isBig5ForRetro = ["nba", "wnba", "wnba_pre", "ncaa", "ncaaw", "nba_gl"].includes(
    String(league || "").toLowerCase(),
  );
  const _retroMinSettled = _isBig5ForRetro ? 30 : 10;
  const _mktSettled = getTotalSettledCountForLeagueMarket(league, marketKey);
  if (_mktSettled < _retroMinSettled) {
    engineDebug("Retrospective skipped: need " + _retroMinSettled + "+ settled picks", {
      league,
      marketKey,
      have: _mktSettled,
      threshold: _retroMinSettled,
    });
    return;
  }

  const _lgSettledForGridSkip = getTotalSettledCountForLeague(league);
  if (_lgSettledForGridSkip >= 100) {
    engineDebug(
      "Retrospective TUNING_GRID sweep skipped: league qualifies for gated coordinate-ascent tuner",
      { league, marketKey, settled: _lgSettledForGridSkip },
    );
    return;
  }

  const { parsed, lines, fixtureMeta, injMultA, injMultB, configSnapshot } = snapshot;
  const numericActual = (typeof parseFinalScore === 'function' ? parseFinalScore(actualScore).total : parseFloat(actualScore));
  if (!isFinite(numericActual)) return;

  const { recencyProfiles, edgeMults } = TUNING_GRID;

  const h2hFactors = [getParam("h2hFactor", league) ?? 1.0];

  for (const h2hFactor of h2hFactors) {
    for (const recencyProfile of recencyProfiles) {
      for (const edgeMult of edgeMults) {
        const paceDampening = 0.35;
        const injuryMult = 1.0;
        for (const _unused of [0]) {
          const config = { h2hFactor, recencyProfile, paceDampening, edgeMult, injuryMult };

          const _savedRecencyWeightsForSweep = MODEL_TUNING.recencyWeights;
          if (Array.isArray(recencyProfile)) MODEL_TUNING.recencyWeights = recencyProfile;

          try {
            let proj, line, edge, pickDecision;
            try {
              if (marketKey === "ft") {
                const calc = computeFTProjection({
                  league,
                  parsed,
                  lines,
                  injMultA,
                  injMultB,
                  config: { h2hFactor, recencyProfile, edgeMult },
                });
                proj = calc.ftProj;
                line = lines.ftLine;
                edge = calc.ftEdge;
                pickDecision = getPick(edge, line, league, "ft", {});
              } else if (marketKey === "h1") {
                const calc = compute1HProjection({
                  league,
                  parsed,
                  lines,
                  injMultA,
                  injMultB,
                  config: { h2hFactor, recencyProfile, edgeMult },
                });
                proj = calc.h1Proj;
                line = lines.h1Line;
                edge = calc.h1Edge;
                pickDecision = getPick(edge, line, league, "h1", {});
              } else if (marketKey === "team_a") {
                const calc = computeFTProjection({
                  league,
                  parsed,
                  lines,
                  injMultA,
                  injMultB,
                  config: { h2hFactor, recencyProfile, edgeMult },
                });
                proj = calc.projAFT;
                line = lines.aLine;
                edge = calc.aEdge;
                pickDecision = getPick(edge, line, league, "team", { teamSc: calc.aS });
              } else if (marketKey === "team_b") {
                const calc = computeFTProjection({
                  league,
                  parsed,
                  lines,
                  injMultA,
                  injMultB,
                  config: { h2hFactor, recencyProfile, edgeMult },
                });
                proj = calc.projBFT;
                line = lines.bLine;
                edge = calc.bEdge;
                pickDecision = getPick(edge, line, league, "team", { teamSc: calc.bS });
              } else if (
                marketKey === "q1" ||
                marketKey === "q2" ||
                marketKey === "q3" ||
                marketKey === "q4"
              ) {
                // Quarter retrospective tuning disabled: this legacy branch is not
                // the live computeQ kernel and must not feed learned parameters.
                continue;
              } else {
                continue;
              }
            } catch (e) {
              engineDebug("runRetrospectiveAnalysis sweep iteration failed", {
                league,
                marketKey,
                error: e?.message || String(e),
              });
              continue;
            }

            if (pickDecision === "NO PLAY") continue;
            const pickSide = getPickSideFromText(pickDecision);
            if (pickSide !== side) continue;

            let wouldWin = false;
            if (side === "over") wouldWin = numericActual > line;
            else if (side === "under") wouldWin = numericActual < line;

            const delta = wouldWin ? (isWin ? 0 : 1) : isWin ? -1 : 0;
            if (delta !== 0) {
              const _edgePct = isFinite(edge) && isFinite(line) && line ? Math.abs(edge / line) : 0;
              const _volRatio =
                isFinite(pick.volatility) && isFinite(pick.volLimit) && pick.volLimit > 0
                  ? Number(pick.volatility) / Number(pick.volLimit)
                  : 0.5;
              const _sampleTier = pick.sampleTier || "thin";
              const _hasH2H = pick.hasH2H || false;
              const _winProbability = getConfidenceWinProbability(
                null,
                _edgePct,
                _volRatio,
                _sampleTier,
                _hasH2H,
                false,
                league,
              );
              updateCandidateScore(
                league,
                marketKey,
                config,
                delta,
                _winProbability,
                wouldWin ? 1 : 0,
              );
            }
          } finally {
            MODEL_TUNING.recencyWeights = _savedRecencyWeightsForSweep;
          }
        }
      }
    }
  }

  const _mktPicks = getTotalSettledCountForLeagueMarket(league, marketKey);
  const _lgPicks = getTotalSettledCountForLeague(league);
  const _lockReady = _mktPicks >= 250 || (_lgPicks >= 125 && _mktPicks >= 60);
  if (_lockReady) {
    const best = selectBestConfig(league, marketKey);
    const _bestPassesHeuristic =
      best &&
      isFinite(best.netDelta) &&
      isFinite(best.sampleCount) &&
      best.sampleCount > 0 &&
      Math.abs(best.netDelta) > 2 * Math.sqrt(best.sampleCount);
    // Heuristic alone clears too easily on small samples. Require a paired
    // bootstrap CI (reusing System 1's pairedBootstrapTest against a
    // zero-baseline, since these are already per-pick "would this candidate
    // have changed the outcome" deltas) to lower bound above zero too.
    const _bestDeltas = best && Array.isArray(best.deltas) ? best.deltas : [];
    const _bestBootstrap =
      _bestDeltas.length >= 8
        ? pairedBootstrapTest(new Array(_bestDeltas.length).fill(0), _bestDeltas, 2000, 11)
        : { significant: false, p: 1 };
    const _bestIsSignificant = _bestPassesHeuristic && _bestBootstrap.significant;
    if (best && _bestIsSignificant) {
      try {
        const learnedConfig = buildConfigFromVerifiedKey(best.configKey);
        if (Array.isArray(learnedConfig?.recencyProfile) && learnedConfig.recencyProfile.length) {
          // FIX Issue 41: do NOT auto-write live recency from retrospective.
          // Persist as a proposal only; operator must apply from Configs panel.
          try {
            const propKey =
              "BB_TUNER_PROPOSAL_RECENCY_" +
              String(league || "unknown") +
              "_" +
              String(marketKey === "h1" ? "h1" : "ft");
            localStorage.setItem(
              propKey,
              JSON.stringify({
                applied: false,
                weights: learnedConfig.recencyProfile,
                configKey: best.configKey,
                sampleCount: best.sampleCount,
                netDelta: best.netDelta,
                source: "retrospective_tuner",
                updatedAt: new Date().toISOString(),
              }),
            );
          } catch (_eProp) {}
          engineDebug("Learned recency profile proposed (not auto-applied)", {
            league,
            marketKey,
            weights: learnedConfig.recencyProfile,
            configKey: best.configKey,
          });
        }
      } catch (e) {
        engineDebug("Failed to persist learned recency profile", {
          league,
          marketKey,
          error: e?.message || String(e),
        });
      }
      engineDebug("Retrospective config proposed (not auto-applied — review in Configs panel)", {
        league,
        marketKey,
        configKey: best.configKey,
        netDelta: best.netDelta,
        sampleCount: best.sampleCount,
        bootstrapP: _bestBootstrap.p,
      });
    }
  }
}

function saveLearnedRecencyWeights(league, marketSilo, weights, metadata = {}) {
  if (
    !Array.isArray(weights) ||
    !weights.length ||
    weights.some((v) => !isFinite(Number(v)) || Number(v) <= 0)
  )
    return false;
  const clean = weights.map(Number).slice(0, 10);
  const scope = String(league || "default").toLowerCase();
  const silo = String(marketSilo || "global").toLowerCase();
  try {
    const payload = {
      weights: clean,
      league: scope,
      marketSilo: silo,
      updatedAt: new Date().toISOString(),
      ...metadata,
    };
    localStorage.setItem(`learned_recency_weights_${scope}_${silo}`, JSON.stringify(payload));
    if (silo === "global")
      localStorage.setItem(`learned_recency_weights_${scope}`, JSON.stringify(payload));
    return true;
  } catch (e) {
    engineDebug("saveLearnedRecencyWeights failed: " + (e?.message || String(e)), {
      league,
      marketSilo,
      error: e,
    });
    return false;
  }
}

function getLearnedRecencyWeights(league, marketSilo) {
  try {
    const scope = String(league || "default").toLowerCase();
    const silo = String(marketSilo || "global").toLowerCase();
    const keys = [`learned_recency_weights_${scope}_${silo}`, `learned_recency_weights_${scope}`];
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const weights = Array.isArray(parsed) ? parsed : parsed?.weights;
      if (
        Array.isArray(weights) &&
        (weights.length === 5 || weights.length === 10) &&
        weights.every((v) => isFinite(Number(v)) && Number(v) > 0)
      ) {
        return weights.map(Number);
      }
    }
  } catch (e) {
    engineDebug("getLearnedRecencyWeights failed: " + (e?.message || String(e)), {
      league,
      marketSilo,
      error: e,
    });
  }
  try {
    const configured = getParam("recencyWeights", league);
    if (Array.isArray(configured) && configured.length) return configured.slice(0, 10);
  } catch (e) {
    engineDebug("recencyWeights param load failed", { error: e?.message || String(e), league });
  }
  return Array.isArray(MODEL_TUNING?.recencyWeights)
    ? MODEL_TUNING.recencyWeights.slice(0, 10)
    : [1.35, 1.2, 1.0, 0.85, 0.7, 0.56, 0.44, 0.33, 0.24, 0.16];
}

const TRACKER_POLICY = {
  // FIX Issue 25/46: keep advisory until settlement/labels are clean.
  advisoryOnly: true,
  dailyWatchlistOnly: false,
  reviewCheckpointSettled: 50,
  policyVersion: "soft_tracker_advisory_v3",
};

const TRACKER_SOFT_EFFECTS = {
  enabled: true,

  minSettled: 100,
  minSettledFull: 200,

  weakEdgeNoPlayPct: 0.055,
  weakTeamNoPlayPct: 0.06,
  lockBoost: 0.2,
};

const PHASE2_CONTROL = {
  mode: "live",
  trackerFeedbackLive: true,
  teamMemoryLive: true,
};

const PHASE2_ACTIVATION_RULES = {
  trackerFeedback: {
    minSettled: 150,
    minMarketSideSignals: 2,
    minProfileSignals: 1,
  },
  teamMemory: {
    minSettled: 150,
    minTeamSignals: 2,
    minMatchupSignals: 1,
  },
};

function isPhase2ShadowMode() {
  return PHASE2_CONTROL.mode === "shadow";
}

function getPhase2ActivationState() {
  const derived = AppState.tracker.derived || defaultTrackerDerivedState();
  const settled = Number(derived?.settledPicks || 0);

  const marketSideSignals = Array.isArray(derived?.signalBoards?.marketSides)
    ? derived.signalBoards.marketSides
    : [];
  const profileSignals = Array.isArray(derived?.signalBoards?.profiles)
    ? derived.signalBoards.profiles
    : [];
  const teamSignals = Array.isArray(derived?.signalBoards?.teams) ? derived.signalBoards.teams : [];
  const matchupSignals = Array.isArray(derived?.signalBoards?.matchups)
    ? derived.signalBoards.matchups
    : [];

  const learningEnabled = !!TRACKER_LEARNING_ENABLED;
  const forcedShadow = PHASE2_CONTROL.mode === "shadow";
  const forcedLive = PHASE2_CONTROL.mode === "live";

  const trackerReady =
    settled >= PHASE2_ACTIVATION_RULES.trackerFeedback.minSettled &&
    marketSideSignals.length >= PHASE2_ACTIVATION_RULES.trackerFeedback.minMarketSideSignals &&
    profileSignals.length >= PHASE2_ACTIVATION_RULES.trackerFeedback.minProfileSignals;

  const teamReady =
    settled >= PHASE2_ACTIVATION_RULES.teamMemory.minSettled &&
    teamSignals.length >= PHASE2_ACTIVATION_RULES.teamMemory.minTeamSignals &&
    matchupSignals.length >= PHASE2_ACTIVATION_RULES.teamMemory.minMatchupSignals;

  const trackerFeedbackLive =
    learningEnabled &&
    !forcedShadow &&
    !!PHASE2_CONTROL.trackerFeedbackLive &&
    (forcedLive || trackerReady);

  const teamMemoryLive =
    learningEnabled &&
    !forcedShadow &&
    !!PHASE2_CONTROL.teamMemoryLive &&
    (forcedLive || teamReady);

  return {
    phase2Mode: !learningEnabled
      ? "frozen"
      : forcedShadow
        ? "shadow"
        : forcedLive
          ? "live"
          : "auto",
    settled,
    advisoryOnly: !!TRACKER_POLICY.advisoryOnly,
    dailyWatchlistOnly: !!TRACKER_POLICY.dailyWatchlistOnly,
    reviewCheckpointSettled: Number(
      TRACKER_POLICY.reviewCheckpointSettled ||
        PHASE2_ACTIVATION_RULES.trackerFeedback.minSettled ||
        20,
    ),
    trackerReady,
    teamReady,
    trackerCheckpointReady: trackerReady,
    teamCheckpointReady: teamReady,
    trackerFeedbackLive,
    teamMemoryLive,
    trackerReasons: [
      `settled:${settled}/${PHASE2_ACTIVATION_RULES.trackerFeedback.minSettled}`,
      `marketSideSignals:${marketSideSignals.length}/${PHASE2_ACTIVATION_RULES.trackerFeedback.minMarketSideSignals}`,
      `profileSignals:${profileSignals.length}/${PHASE2_ACTIVATION_RULES.trackerFeedback.minProfileSignals}`,
    ],
    teamReasons: [
      `settled:${settled}/${PHASE2_ACTIVATION_RULES.teamMemory.minSettled}`,
      `teamSignals:${teamSignals.length}/${PHASE2_ACTIVATION_RULES.teamMemory.minTeamSignals}`,
      `matchupSignals:${matchupSignals.length}/${PHASE2_ACTIVATION_RULES.teamMemory.minMatchupSignals}`,
    ],
  };
}

function getLeagueUnderBlockRatio(league) {
  const map = {
    nba: 0.82,
    ncaa: 0.75,
    ncaaw: 0.75,
    wnba: 0.8,
    wnba_pre: 0.8,
    nba_gl: 0.82,
    euroleague: 0.9,
    eurocup: 0.88,
    champions_league: 0.88,
    acb: 0.87,
    lba: 0.87,
    bbl: 0.85,
    turkey_bsl: 0.86,
    ausnbl: 0.83,
    bleague: 0.84,
    united_league: 0.86,
    proa: 0.85,
  };

  return map[String(league || "").toLowerCase()] || 0.82;
}

const LEAGUE_EDGE_POINT_THRESHOLDS = {
  nba: {
    ft: 5.5,
    h1: 5.0,
    team: 5.5,
    q: 3.5,
    h2: 5.0,
    winner: 4.5,
    handicap: 4.5,
    handicap_h1: 3.5,
    handicap_h2: 3.5,
  },
  wnba: {
    ft: 5.5,
    h1: 5.0,
    team: 5.5,
    q: 3.5,
    h2: 5.0,
    winner: 4.5,
    handicap: 4.5,
    handicap_h1: 3.5,
    handicap_h2: 3.5,
  },
  wnba_pre: {
    ft: 5.0,
    h1: 4.5,
    team: 5.0,
    q: 3.0,
    h2: 4.5,
    winner: 4.0,
    handicap: 4.0,
    handicap_h1: 3.0,
    handicap_h2: 3.0,
  },
  ncaa: {
    ft: 5.5,
    h1: 5.0,
    team: 5.5,
    q: 3.5,
    h2: 5.0,
    winner: 4.5,
    handicap: 4.5,
    handicap_h1: 3.5,
    handicap_h2: 3.5,
  },
  ncaaw: {
    ft: 5.0,
    h1: 4.5,
    team: 5.0,
    q: 3.0,
    h2: 4.5,
    winner: 4.0,
    handicap: 4.0,
    handicap_h1: 3.0,
    handicap_h2: 3.0,
  },
  euroleague: {
    ft: 5.5,
    h1: 5.0,
    team: 5.5,
    q: 3.5,
    h2: 5.0,
    winner: 4.5,
    handicap: 4.5,
    handicap_h1: 3.5,
    handicap_h2: 3.5,
  },
  eurocup: {
    ft: 5.5,
    h1: 5.0,
    team: 5.5,
    q: 3.5,
    h2: 5.0,
    winner: 4.5,
    handicap: 4.5,
    handicap_h1: 3.5,
    handicap_h2: 3.5,
  },
  acb: {
    ft: 5.5,
    h1: 5.0,
    team: 5.5,
    q: 3.5,
    h2: 5.0,
    winner: 4.5,
    handicap: 4.5,
    handicap_h1: 3.5,
    handicap_h2: 3.5,
  },
  lba: {
    ft: 5.5,
    h1: 5.0,
    team: 5.5,
    q: 3.5,
    h2: 5.0,
    winner: 4.5,
    handicap: 4.5,
    handicap_h1: 3.5,
    handicap_h2: 3.5,
  },
  turkey_bsl: {
    ft: 5.5,
    h1: 5.0,
    team: 5.5,
    q: 3.5,
    h2: 5.0,
    winner: 4.5,
    handicap: 4.5,
    handicap_h1: 3.5,
    handicap_h2: 3.5,
  },
  aba: {
    ft: 5.0,
    h1: 4.5,
    team: 5.0,
    q: 3.0,
    h2: 4.5,
    winner: 4.0,
    handicap: 4.0,
    handicap_h1: 3.0,
    handicap_h2: 3.0,
  },
  ausnbl: {
    ft: 5.0,
    h1: 4.5,
    team: 5.0,
    q: 3.0,
    h2: 4.5,
    winner: 4.0,
    handicap: 4.0,
    handicap_h1: 3.0,
    handicap_h2: 3.0,
  },
  bcl: {
    ft: 5.0,
    h1: 4.5,
    team: 5.0,
    q: 3.0,
    h2: 4.5,
    winner: 4.0,
    handicap: 4.0,
    handicap_h1: 3.0,
    handicap_h2: 3.0,
  },
  champions_league: {
    ft: 5.0,
    h1: 4.5,
    team: 5.0,
    q: 3.0,
    h2: 4.5,
    winner: 4.0,
    handicap: 4.0,
    handicap_h1: 3.0,
    handicap_h2: 3.0,
  },
  bnxt: {
    ft: 5.0,
    h1: 4.5,
    team: 5.0,
    q: 3.0,
    h2: 4.5,
    winner: 4.0,
    handicap: 4.0,
    handicap_h1: 3.0,
    handicap_h2: 3.0,
  },
  bbl: {
    ft: 5.0,
    h1: 4.5,
    team: 5.0,
    q: 3.0,
    h2: 4.5,
    winner: 4.0,
    handicap: 4.0,
    handicap_h1: 3.0,
    handicap_h2: 3.0,
  },
  bleague: {
    ft: 5.0,
    h1: 4.5,
    team: 5.0,
    q: 3.0,
    h2: 4.5,
    winner: 4.0,
    handicap: 4.0,
    handicap_h1: 3.0,
    handicap_h2: 3.0,
  },
  cba: {
    ft: 5.0,
    h1: 4.5,
    team: 5.0,
    q: 3.0,
    h2: 4.5,
    winner: 4.0,
    handicap: 4.0,
    handicap_h1: 3.0,
    handicap_h2: 3.0,
  },
  china_nbl: {
    ft: 5.0,
    h1: 4.5,
    team: 5.0,
    q: 3.0,
    h2: 4.5,
    winner: 4.0,
    handicap: 4.0,
    handicap_h1: 3.0,
    handicap_h2: 3.0,
  },
  korea_kbl: {
    ft: 5.0,
    h1: 4.5,
    team: 5.0,
    q: 3.0,
    h2: 4.5,
    winner: 4.0,
    handicap: 4.0,
    handicap_h1: 3.0,
    handicap_h2: 3.0,
  },
  pba: {
    ft: 5.0,
    h1: 4.5,
    team: 5.0,
    q: 3.0,
    h2: 4.5,
    winner: 4.0,
    handicap: 4.0,
    handicap_h1: 3.0,
    handicap_h2: 3.0,
  },
  lkl: {
    ft: 5.0,
    h1: 4.5,
    team: 5.0,
    q: 3.0,
    h2: 4.5,
    winner: 4.0,
    handicap: 4.0,
    handicap_h1: 3.0,
    handicap_h2: 3.0,
  },
  nba_gl: {
    ft: 5.0,
    h1: 4.5,
    team: 5.0,
    q: 3.0,
    h2: 4.5,
    winner: 4.0,
    handicap: 4.0,
    handicap_h1: 3.0,
    handicap_h2: 3.0,
  },

  nba_summer: { ft: 6.5, h1: 6.0, team: 6.5, q: 4.0 },
  bal: { ft: 5.0, h1: 4.5, team: 5.0, q: 3.0 },
  proa: { ft: 5.0, h1: 4.5, team: 5.0, q: 3.0 },
  brazil_nbb: { ft: 5.0, h1: 4.5, team: 5.0, q: 3.0 },
  plk: { ft: 5.0, h1: 4.5, team: 5.0, q: 3.0 },
  united_league: { ft: 5.0, h1: 4.5, team: 5.0, q: 3.0 },
  mexico_lnbp: { ft: 5.0, h1: 4.5, team: 5.0, q: 3.0 },
  puerto_rico_bsn: { ft: 5.0, h1: 4.5, team: 5.0, q: 3.0 },
  argentina_lnb: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  austria_superliga: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  belgium_top: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  cebl: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  croatia_premier: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  denmark_bliga: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  fiba_ac: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  fiba_asia_preq: { ft: 5.0, h1: 4.5, team: 5.0, q: 2.75 },
  fiba_eb: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  fiba_eb_q: { ft: 5.0, h1: 4.5, team: 5.0, q: 2.75 },
  fiba_u20eb_a: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  fiba_u20eb_b: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  fiba_wc: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  fiba_wc_q_africa: { ft: 5.0, h1: 4.5, team: 5.0, q: 2.75 },
  fiba_wc_q_americas: { ft: 5.0, h1: 4.5, team: 5.0, q: 2.75 },
  fiba_wc_q_asia: { ft: 5.0, h1: 4.5, team: 5.0, q: 2.75 },
  fiba_wc_q_europe: { ft: 5.0, h1: 4.5, team: 5.0, q: 2.75 },
  aba_pre: { ft: 6.5, h1: 6.0, team: 6.5, q: 4.0 },
  intl_friendly: { ft: 7.0, h1: 6.5, team: 7.0, q: 4.25 },
  club_friendly: { ft: 7.0, h1: 6.5, team: 7.0, q: 4.25 },
  finland_koris: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  france_lfb_w: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  germany_proa: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  hungary_nb1: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  isl: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  italy_a2: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  italy_a2_w: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  latvia_lbl: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  lebanon_1st: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  mexico_cibacopa: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  nbl_cz: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  nznbl: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  poland_1liga: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  portugal_lpb: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  portugal_taca: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  prob: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  romania_ln: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  serbia_kls: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  slovenia_1a: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  spain_primera: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  spain_segunda: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  sweden_sbl: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  swiss_sbl: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  taipei_tpbl: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  turkey_tbl: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  venezuela_sl: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  uruguay_lub: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  austria_zweite: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  bih_1st: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  brazil_lbf_w: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  bulgaria_nbl: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  cyprus_div_a: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  chile_lnb: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  chile_lnb2: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  el_salvador_lmb: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  england_slb: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  england_slb_w: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  estonia_kml: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  gb_super_league_w: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  georgia_super: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  iceland_1st: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  iceland_urvalsdeild: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  iceland_urvalsdeild_w: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  indonesia_ibl: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  italy_a1_w: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  italy_serb: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  phil_mpbl: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  portugal_lfb_w: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  portugal_proliga: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  rwanda: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  turkey_tb2l: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  uruguay_lfb_w: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  aus_big_v: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  aus_big_v_w: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  aus_nbl1_east: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  aus_nbl1_east_w: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  aus_nbl1_north: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  aus_nbl1_north_w: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  aus_nbl1_south: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  aus_nbl1_south_w: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  aus_nbl1_west: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  aus_nbl1_west_w: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  aus_nbl1_central: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  aus_nbl1_central_w: { ft: 4.0, h1: 3.5, team: 4.0, q: 2.5 },
  unknown: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
  default: { ft: 4.5, h1: 4.0, team: 4.5, q: 2.5 },
};

function getLeagueEdgePointThreshold(league, marketKey) {
  const lk = (league || "default").toLowerCase();
  let key = marketKey;

  if (marketKey === "team_a" || marketKey === "team_b") key = "team";
  else if (marketKey === "h1_team_a" || marketKey === "h1_team_b") key = "h1";
  else if (marketKey === "q1_team_a" || marketKey === "q1_team_b") key = "q";
  else if (marketKey && marketKey.startsWith("q")) key = "q";
  else if (marketKey === "h1") key = "h1";
  else if (marketKey === "h2") key = "h2";
  else if (marketKey === "winner") key = "winner";
  else if (marketKey === "handicap") key = "handicap";
  else if (marketKey === "handicap_h1") key = "handicap_h1";
  else if (marketKey === "handicap_h2") key = "handicap_h2";
  else key = "ft";

  const paramKey =
    key === "ft"
      ? "edgeFTPointThreshold"
      : key === "h1"
        ? "edgeH1PointThreshold"
        : key === "h2"
          ? "edgeH2PointThreshold"
          : key === "team"
            ? "edgeTeamPointThreshold"
            : key === "q"
              ? "edgeQPointThreshold"
              : key === "winner"
                ? "edgeWinnerPointThreshold"
                : key === "handicap"
                  ? "edgeHandicapPointThreshold"
                  : key === "handicap_h1"
                    ? "edgeHandicapH1PointThreshold"
                    : key === "handicap_h2"
                      ? "edgeHandicapH2PointThreshold"
                      : null;

  if (key === "winner" || key === "handicap" || key === "handicap_h1" || key === "handicap_h2") {
    const _routed = getParam(paramKey, lk);
    if (isFinite(_routed) && Number(_routed) > 0) return Number(_routed);
  }
  const staticRow = LEAGUE_EDGE_POINT_THRESHOLDS[lk] || LEAGUE_EDGE_POINT_THRESHOLDS.default;
  const staticVal = Number(staticRow?.[key]);

  const staticDefault =
    isFinite(staticVal) && staticVal > 0
      ? staticVal
      : paramKey &&
          TUNABLE_PARAM_REGISTRY[paramKey] &&
          isFinite(TUNABLE_PARAM_REGISTRY[paramKey].value)
        ? TUNABLE_PARAM_REGISTRY[paramKey].value
        : 5.0;

  const leagueOverride = paramKey ? g_tunableParamLeagueOverrides?.[lk]?.[paramKey] : null;
  if (
    leagueOverride &&
    isFinite(Number(leagueOverride.value)) &&
    Number(leagueOverride.value) > 0
  ) {
    return Number(leagueOverride.value);
  }
  return staticDefault;
}

let LEAGUE_BASES = {
  nba: 230,
  ncaa: 148,
  nba_gl: 228,
  ncaaw: 144,
  wnba: 168,
  wnba_pre: 164,
  nba_summer: 158,
  cebl: 176,
  pba: 196,
  phil_mpbl: 156,
  cba: 202,
  china_nbl: 188,
  taipei_tpbl: 176,
  bleague: 162,
  korea_kbl: 164,
  indonesia_ibl: 154,
  ausnbl: 176,
  aus_nbl1_east: 178,
  aus_nbl1_north: 178,
  aus_nbl1_south: 178,
  aus_nbl1_west: 178,
  aus_nbl1_central: 178,
  aus_nbl1_east_w: 152,
  aus_nbl1_north_w: 152,
  aus_nbl1_south_w: 152,
  aus_nbl1_west_w: 152,
  aus_nbl1_central_w: 152,
  aus_big_v: 154,
  aus_big_v_w: 148,
  nznbl: 176,
  puerto_rico_bsn: 182,
  mexico_cibacopa: 180,
  mexico_lnbp: 172,
  argentina_lnb: 160,
  brazil_nbb: 160,
  brazil_lbf_w: 142,
  chile_lnb: 158,
  chile_lnb2: 152,
  uruguay_lub: 164,
  uruguay_lfb_w: 138,
  venezuela_sl: 156,
  el_salvador_lmb: 154,
  euroleague: 162,
  eurocup: 160,
  champions_league: 160,
  acb: 166,
  lba: 162,
  bbl: 168,
  turkey_bsl: 168,
  proa: 162,
  bcl: 158,
  isl: 166,
  aba: 158,
  bnxt: 156,
  united_league: 162,
  spain_primera: 158,
  spain_segunda: 152,
  italy_a2: 156,
  italy_serb: 150,
  italy_a1_w: 144,
  italy_a2_w: 140,
  germany_proa: 160,
  prob: 156,
  france_lfb_w: 144,
  turkey_tbl: 160,
  turkey_tb2l: 154,
  lkl: 162,
  plk: 160,
  poland_1liga: 152,
  england_slb: 164,
  england_slb_w: 146,
  gb_super_league_w: 146,
  serbia_kls: 160,
  croatia_premier: 158,
  slovenia_1a: 156,
  bih_1st: 154,
  austria_superliga: 156,
  austria_zweite: 150,
  belgium_top: 158,
  bulgaria_nbl: 158,
  cyprus_div_a: 154,
  nbl_cz: 160,
  denmark_bliga: 164,
  estonia_kml: 156,
  finland_koris: 162,
  georgia_super: 158,
  hungary_nb1: 158,
  iceland_urvalsdeild: 178,
  iceland_urvalsdeild_w: 154,
  iceland_1st: 172,
  latvia_lbl: 158,
  lebanon_1st: 168,
  portugal_lpb: 160,
  portugal_proliga: 154,
  portugal_taca: 158,
  portugal_lfb_w: 142,
  romania_ln: 156,
  sweden_sbl: 162,
  swiss_sbl: 156,
  bal: 154,
  rwanda: 144,

  fiba_wc: 156,
  fiba_eb: 156,
  fiba_u20eb_a: 156,
  fiba_u20eb_b: 156,
  fiba_ac: 154,
  fiba_wc_q_africa: 158,
  fiba_wc_q_americas: 160,
  fiba_wc_q_asia: 156,
  fiba_wc_q_europe: 158,
  fiba_eb_q: 158,
  fiba_asia_preq: 162,
  intl_friendly: 168,
  club_friendly: 172,
  aba_pre: 168,
  unknown: 160,
};
