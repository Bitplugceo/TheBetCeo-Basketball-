
function isTrackerSupportedLeague(league) {
  return !!getTrackedLeagueApiBase(String(league || "").toLowerCase());
}

async function settleTrackedPick(signature, status) {
  let pick = AppState.tracker.state.activePicks.find((p) => p.signature === signature);
  if (!pick) pick = AppState.tracker.state.archivedPicks.find((p) => p.signature === signature);
  if (!pick) return;
  const _sA = pick.homeTeam && pick.homeTeam !== "—" ? pick.homeTeam : "A";
  const _sB = pick.awayTeam && pick.awayTeam !== "—" ? pick.awayTeam : "B";
  const score = prompt(
    `${status.toUpperCase()} — Enter final score:\n${_sA} vs ${_sB}\n(e.g. 110-105 — or leave blank)`,
    pick.actualScore || "",
  );
  if (score === null) return;
  if (score.trim()) pick.actualScore = score.trim();
  await applyManualSettlementToTrackedPick(signature, status);
}

async function settleTrackedPickManualFull(signature) {
  let pick = AppState.tracker.state.activePicks.find((p) => p.signature === signature);
  if (!pick) pick = AppState.tracker.state.archivedPicks.find((p) => p.signature === signature);
  if (!pick) return;

  const _tA = pick.homeTeam && pick.homeTeam !== "—" ? pick.homeTeam : "A";
  const _tB = pick.awayTeam && pick.awayTeam !== "—" ? pick.awayTeam : "B";
  const score = prompt(
    `Enter final score for ${_tA} vs ${_tB}\n(e.g. 110-105 — or leave blank to skip):`,
    pick.actualScore || "",
  );
  if (score === null) return;

  const _clvHint =
    pick.closingLine !== null && pick.closingLine !== undefined ? String(pick.closingLine) : "";
  const closingLineInput = prompt(
    `Optional — Closing line for CLV tracking (leave blank to skip).\nPick line was: ${pick.lineAtPick ?? pick.line}`,
    _clvHint,
  );
  if (closingLineInput !== null && closingLineInput.trim() !== "") {
    const _cl = parseFloat(closingLineInput.trim());
    if (isFinite(_cl) && _cl > 0) {
      pick.closingLine = _cl;
      const _lp = Number(pick.lineAtPick ?? pick.line);
      const _s = String(pick.side || "").toLowerCase();
      if (isFinite(_lp) && _lp > 0) {
        pick.clv =
          _s === "under"
            ? Math.round((_lp - _cl) * 100) / 100
            : Math.round((_cl - _lp) * 100) / 100;
      }
    }
  }

  const rawResult = prompt(
    "Type 'W' for Win, 'L' for Loss, 'P' for Push, or 'PENDING' to revert a mistake:",
    pick.resultStatus || "",
  );
  if (rawResult === null) return;
  const result = rawResult.toLowerCase();
  if (!result) return;

  const map = {
    w: "win",
    l: "loss",
    p: "push",
    win: "win",
    loss: "loss",
    push: "push",
    pending: "pending",
  };
  const finalStatus = map[result];
  if (!finalStatus) return alert("Invalid status.");

  pick.actualScore = score;
  await applyManualSettlementToTrackedPick(signature, finalStatus);
}

async function applyManualSettlementToTrackedPick(signature, resultStatus) {
  const normalizedStatus = String(resultStatus || "").toLowerCase();
  if (!signature || !["win", "loss", "push", "pending"].includes(normalizedStatus)) return false;

  const nowIso = new Date().toISOString();
  let touchedPick = null;

  const active = AppState.tracker.state.activePicks.filter((p) => {
    if (makeTrackedSignature(p) === signature) {
      touchedPick = p;
      return false;
    }
    return true;
  });
  const archived = AppState.tracker.state.archivedPicks.filter((p) => {
    if (makeTrackedSignature(p) === signature) {
      touchedPick = p;
      return false;
    }
    return true;
  });

  if (!touchedPick) return false;

  if (
    (normalizedStatus === "win" || normalizedStatus === "loss") &&
    !String(touchedPick.actualScore || "").trim()
  ) {
    return false;
  }

  const updatedPick = ensureTrackedPickKeys({
    ...touchedPick,
    resultStatus: normalizedStatus,
    engineResultStatus: normalizedStatus,
    settledAt: normalizedStatus === "pending" ? null : nowIso,
    updatedAt: nowIso,
    settlementSource: "manual",
    manualSettlement: true,
    manualSettledAt: nowIso,
  });

  if (normalizedStatus === "pending") {
    active.unshift(updatedPick);
  } else {
    archived.unshift(updatedPick);
  }

  AppState.tracker.state.activePicks = active.slice(0, TRACKED_PICKS_LIMIT);
  AppState.tracker.state.archivedPicks = archived.slice(0, TRACKER_ARCHIVED_LIMIT);
  AppState.tracker.state.updatedAt = nowIso;

  archiveExpiredTrackedPicks();

  const reconciled = reconcileTrackerBucketConflicts(
    AppState.tracker.state.activePicks,
    AppState.tracker.state.archivedPicks,
  );
  AppState.tracker.state.activePicks = reconciled.activePicks;
  AppState.tracker.state.archivedPicks = reconciled.archivedPicks;

  if (
    ["win", "loss", "push"].includes(normalizedStatus) &&
    typeof recordPickVariance === "function"
  ) {
    recordPickVariance(updatedPick);
  }

  rebuildTrackerStats();
  saveTrackerStateToLocal();
  trackerDebug("manual settle applied", {
    league: touchedPick?.league || "",
    eventId: touchedPick?.eventId || "",
    market: touchedPick?.marketKey || "",
    result: normalizedStatus,
    line: touchedPick?.line,
  });

  if (["win", "loss", "push"].includes(normalizedStatus) && updatedPick.snapshot) {
    try {
      const _rKey = "BB_RETRO_SETTLE_COUNT";
      const _rCount = (parseInt(localStorage.getItem(_rKey) || "0", 10) || 0) + 1;
      localStorage.setItem(_rKey, String(_rCount));
      if (_rCount % 5 === 0) {
        setTimeout(async () => {
          try {
            await runRetrospectiveAnalysis(updatedPick);
            const _oosResult2 = runOutOfSampleValidation(updatedPick.league);
            if (_oosResult2) engineDebug("Out-of-sample validation result", _oosResult2);
            if (typeof renderConfigsPanel === "function") renderConfigsPanel();
          } catch (err) {
            engineDebug("Retrospective analysis error", err.message);
          }
        }, 100);
      }
    } catch (_retroErr) {
      engineDebug("Retrospective analysis outer error", {
        error: _retroErr?.message || String(_retroErr),
      });
    }
  }

  if (g_trackerState.shadowPicks && touchedPick) {
    const shadowMatches = g_trackerState.shadowPicks.filter(
      (sp) => sp.eventId === touchedPick.eventId,
    );
    for (const sp of shadowMatches) {
      if (sp.resultStatus !== "pending") continue;
      sp.actualScore = updatedPick.actualScore;
      const side = sp.side;
      const marketLine = sp.line;
      const actual = (typeof parseFinalScore === 'function' ? parseFinalScore(sp.actualScore).total : parseFloat(sp.actualScore));

      if (String(side).toLowerCase() === "no_play") {
        sp.resultStatus = "no_play_settled";
        sp.settledAt = new Date().toISOString();
        continue;
      }
      if (isFinite(actual) && isFinite(marketLine)) {
        let shadowStatus = "push";
        if (actual > marketLine) shadowStatus = side === "over" ? "win" : "loss";
        else if (actual < marketLine) shadowStatus = side === "under" ? "win" : "loss";
        sp.resultStatus = shadowStatus;
        sp.settledAt = new Date().toISOString();
        if (typeof runRetrospectiveAnalysis === "function") {
          runRetrospectiveAnalysis(sp).catch((err) => engineDebug("Shadow retro error", err));
        }
      }
    }
  }

  if (
    touchedPick &&
    touchedPick.league &&
    touchedPick.league !== "nba" &&
    touchedPick.league !== "wnba" &&
    touchedPick.league !== "wnba_pre" &&
    touchedPick.league !== "ncaa"
  ) {
    setTimeout(() => {
      try {
        if (typeof window.runPhase2Simulator === "function") {
          window.runPhase2Simulator(touchedPick.league);
        }
      } catch (e) {
        engineDebug("Phase 2 simulator error (non-critical)", e.message);
      }
    }, 1000);
  }

  renderTrackedPicks();
  scheduleTrackerSave();

  Promise.resolve().then(async () => {
    try {
      scheduleTrackerSave();
    } catch (err) {
      console.error("[BB Engine] manual settle hard sync failed", err);
      trackerDebug("manual settle sync failed", {
        result: normalizedStatus,
        error: String(err?.message || err),
      });
    } finally {
      renderTrackedPicks();
    }
  });

  return true;
}

async function clearAllPendingTrackedPicks() {
  if (!AppState?.tracker?.state) return { removed: 0 };
  const active = Array.isArray(AppState.tracker.state.activePicks)
    ? AppState.tracker.state.activePicks
    : [];
  const pending = active.filter(
    (p) => String(p?.resultStatus || "pending").toLowerCase() === "pending",
  );
  if (!pending.length) return { removed: 0 };

  if (!Array.isArray(AppState.tracker.state.deletedSignatures)) {
    AppState.tracker.state.deletedSignatures = [];
  }
  pending.forEach((pick) => {
    const slotKey = makeTrackerActiveMergeKey(pick);
    const realSig = makeTrackedSignature(pick);
    [slotKey, realSig, pick.signature, pick.pickId].filter(Boolean).forEach((s) => {
      if (!AppState.tracker.state.deletedSignatures.includes(s)) {
        AppState.tracker.state.deletedSignatures.push(s);
      }
    });
  });

  const pendingKeys = new Set();
  pending.forEach((p) => {
    [makeTrackedSignature(p), makeTrackerActiveMergeKey(p), p.signature, p.pickId]
      .filter(Boolean)
      .forEach((k) => pendingKeys.add(k));
  });
  AppState.tracker.state.activePicks = active.filter((p) => {
    const keys = [
      makeTrackedSignature(p),
      makeTrackerActiveMergeKey(p),
      p.signature,
      p.pickId,
    ].filter(Boolean);
    return !keys.some((k) => pendingKeys.has(k));
  });

  AppState.tracker.state.updatedAt = new Date().toISOString();
  rebuildTrackerStats();

  await forceTrackerSaveNow();
  if (typeof renderTrackedPicks === "function") renderTrackedPicks();
  engineDebug("clearAllPendingTrackedPicks", { removed: pending.length });
  return { removed: pending.length };
}
window.clearAllPendingTrackedPicks = clearAllPendingTrackedPicks;

async function deleteTrackedPickBySignature(signature) {
  if (!signature) return false;
  let pick = AppState.tracker.state.activePicks.find(
    (p) => makeTrackedSignature(p) === signature || p.signature === signature,
  );
  if (!pick)
    pick = AppState.tracker.state.archivedPicks.find(
      (p) => makeTrackedSignature(p) === signature || p.signature === signature,
    );
  if (!pick)
    pick = AppState.tracker.state.shadowPicks?.find(
      (p) => makeTrackedSignature(p) === signature || p.signature === signature,
    );

  if (!pick) return false;

  const pickName = pick.predictionText || "this prediction";
  const matchName = `${pick.homeTeam && pick.homeTeam !== "—" ? pick.homeTeam : "A"} vs ${pick.awayTeam && pick.awayTeam !== "—" ? pick.awayTeam : "B"}`;
  if (!confirm(`Are you sure you want to permanently delete "${pickName}" for ${matchName}?`)) {
    return false;
  }

  if (!Array.isArray(AppState.tracker.state.deletedSignatures)) {
    AppState.tracker.state.deletedSignatures = [];
  }
  const slotKey = makeTrackerActiveMergeKey(pick);
  const realSig = makeTrackedSignature(pick);
  const pickSig = pick.signature;
  const pickId = pick.pickId;

  [signature, slotKey, realSig, pickSig, pickId].filter(Boolean).forEach((s) => {
    if (!AppState.tracker.state.deletedSignatures.includes(s)) {
      AppState.tracker.state.deletedSignatures.push(s);
    }
  });

  const isMatch = (p) => {
    const s1 = makeTrackedSignature(p);
    const s2 = makeTrackerActiveMergeKey(p);
    return (
      s1 === signature ||
      s2 === signature ||
      p.signature === signature ||
      p.pickId === signature ||
      AppState.tracker.state.deletedSignatures.includes(s1) ||
      AppState.tracker.state.deletedSignatures.includes(s2)
    );
  };

  AppState.tracker.state.activePicks = AppState.tracker.state.activePicks.filter(
    (p) => !isMatch(p),
  );
  AppState.tracker.state.archivedPicks = AppState.tracker.state.archivedPicks.filter(
    (p) => !isMatch(p),
  );
  if (AppState.tracker.state.shadowPicks) {
    AppState.tracker.state.shadowPicks = AppState.tracker.state.shadowPicks.filter(
      (p) => !isMatch(p),
    );
  }

  AppState.tracker.state.updatedAt = new Date().toISOString();
  rebuildTrackerStats();
  await saveTrackerStateToLocal();
  renderTrackedPicks();
  await forceTrackerSaveNow();
  trackerDebug("tracked pick deleted permanently", { signature, pickName, matchName });
  return true;
}

function handleTrackedPicksActionClick(event) {
  const target = event?.target;
  if (!target) return;

  const deleteBtn = target.closest?.(".tracker-delete-pick-btn");
  if (deleteBtn) {
    const encoded = deleteBtn.getAttribute("data-sig") || "";
    const sig = encoded ? decodeURIComponent(encoded) : "";
    if (sig) deleteTrackedPickBySignature(sig);
    return;
  }

  const dispToggle = target.closest?.(".tracker-disp-toggle");
  if (dispToggle) {
    const pid = dispToggle.dataset.pid;
    if (pid) {
      dispToggle.style.display = "none";
      const actEl = document.getElementById("act-" + pid);
      if (actEl) actEl.style.display = "flex";
    }
    return;
  }

  const customBtn = target.closest?.(".tracker-custom-settle-btn");
  if (customBtn) {
    const encoded = customBtn.getAttribute("data-sig") || "";
    const sig = encoded ? decodeURIComponent(encoded) : "";
    if (sig) settleTrackedPickManualFull(sig);
    return;
  }

  const settledEdit = target.closest?.(".tracker-settled-edit-btn");
  if (settledEdit) {
    const encoded = settledEdit.getAttribute("data-sig") || "";
    const sig = encoded ? decodeURIComponent(encoded) : "";
    if (sig) settleTrackedPickManualFull(sig);
    return;
  }

  const btn = target.closest?.(".tracker-settle-btn");
  if (!btn) return;

  const resultStatus = String(btn.getAttribute("data-manual-settle") || "").toLowerCase();
  const encodedSig = String(btn.getAttribute("data-sig") || "");
  const signature = encodedSig ? decodeURIComponent(encodedSig) : "";

  if (!signature || !["win", "loss", "push"].includes(resultStatus)) return;

  btn.disabled = true;

  const settle = async () => {
    if (g_trackerSaveInFlight) {
      engineDebug("Manual settle waiting for save to complete...");

      let waited = 0;
      while (g_trackerSaveInFlight && waited < 5000) {
        await new Promise((r) => setTimeout(r, 100));
        waited += 100;
      }
      if (g_trackerSaveInFlight) {
        engineDebug("Manual settle proceeding despite save still in flight (timeout)");
      }
    }
    await settleTrackedPick(signature, resultStatus);
  };

  settle()
    .catch((err) => {
      console.error("[BB Engine] manual settle failed", err);
      trackerDebug("manual settle failed", {
        error: String(err?.message || err),
        result: resultStatus,
      });
    })
    .finally(() => {
      btn.disabled = false;
    });
}

function isPickPeriodComplete(
  marketKey,
  currentPeriod,
  isHalfTime,
  isGameFinal,
  regulationPeriods,
) {
  if (isGameFinal) return true;
  const p = Number(currentPeriod || 0);
  const isNCAAStyle = regulationPeriods === 2;
  if (isNCAAStyle) {
    if (marketKey === "h1" || marketKey === "h1_team_a" || marketKey === "h1_team_b")
      return p >= 2 || isHalfTime;
    return isGameFinal;
  }
  switch (marketKey) {
    case "q1":
    case "q1_team_a":
    case "q1_team_b":
      return p >= 2;
    case "q2":
      return p >= 3 || isHalfTime;
    case "h1":
    case "h1_team_a":
    case "h1_team_b":
      return p >= 3 || isHalfTime;
    case "q3":
      return p >= 4;
    case "q4":
      return p >= 5 || isGameFinal;
    default:
      return isGameFinal;
  }
}

function settleTrackedPickFromCompetition(pick, competition, allowPartialSettlement = false) {
  if (!pick || !competition) return "pending";

  const oldStatus = pick.resultStatus;

  const completed = !!(
    competition?.status?.type?.completed ||
    competition?.status?.type?.state === "post" ||
    competition?.status?.type?.name === "STATUS_FINAL"
  );
  const state = String(competition?.status?.type?.state || "");
  const status = String(competition?.status?.type?.name || "");

  if (allowPartialSettlement && !completed) {
    const _curPeriod = Number(competition?.status?.period || 0);
    const _isHalfNow = String(status).toUpperCase().includes("HALFTIME");
    const _regP = LEAGUE_FETCH_RULES[pick.league || ""]?.regulationPeriods ?? 4;
    if (!isPickPeriodComplete(pick.marketKey, _curPeriod, _isHalfNow, false, _regP))
      return "pending";
  } else if (!allowPartialSettlement) {
    if (!completed && state !== "post" && status !== "STATUS_FINAL") return "pending";
  }

  const competitors = competition.competitors || [];
  const home = competitors.find((c) => c.homeAway === "home") || competitors[0];
  const away = competitors.find((c) => c.homeAway === "away") || competitors[1];

  if (!home || !away) return "pending";

  const getVal = (v) => {
    // FIX Issue 15: prefer NaN over manufactured 0 for missing linescore cells.
    if (v === null || v === undefined) return NaN;
    if (typeof v === "object") {
      const n = parseFloat(v.value ?? v.displayValue ?? NaN);
      return isFinite(n) ? n : NaN;
    }
    const n = parseFloat(v);
    return isFinite(n) ? n : NaN;
  };

  const sHome = getVal(home.score);
  const sAway = getVal(away.score);

  const lsHome = home.linescores || [];
  const lsAway = away.linescores || [];

  let h1Home = 0,
    h1Away = 0;
  let q1Home = 0,
    q1Away = 0,
    q2Home = 0,
    q2Away = 0,
    q3Home = 0,
    q3Away = 0,
    q4Home = 0,
    q4Away = 0;

  if (lsHome.length >= 2 && lsAway.length >= 2) {
    // FIX Issue 3 + 13: use regulation period rules, not an NBA-only allowlist.
    // Match ingest: when regulationPeriods >= 4, H1 = Q1+Q2 and fill q1-q4.
    const _regP =
      (typeof LEAGUE_FETCH_RULES !== "undefined" &&
        LEAGUE_FETCH_RULES[pick.league || ""] &&
        LEAGUE_FETCH_RULES[pick.league || ""].regulationPeriods) ||
      4;
    if (_regP >= 4) {
      q1Home = getVal(lsHome[0]);
      q1Away = getVal(lsAway[0]);
      q2Home = getVal(lsHome[1]);
      q2Away = getVal(lsAway[1]);
      h1Home = q1Home + q2Home;
      h1Away = q1Away + q2Away;
      if (lsHome.length >= 4 && lsAway.length >= 4) {
        q3Home = getVal(lsHome[2]);
        q3Away = getVal(lsAway[2]);
        q4Home = getVal(lsHome[3]);
        q4Away = getVal(lsAway[3]);
      }
    } else {
      // 2-period leagues (e.g. NCAA): first period is H1
      h1Home = getVal(lsHome[0]);
      h1Away = getVal(lsAway[0]);
    }
  }

  const market = pick.marketKey;
  const marketLine = parseFloat(pick.line);
  if (
    isNaN(marketLine) &&
    !["winner", "margin_team", "margin_any", "high_q", "low_q", "htft", "player"].includes(market)
  )
    return "pending";

  let actual = 0;
  const isTeamAHome =
    String(pick.homeId) === String(home.id) || pick.homeTeam === home.team?.displayName;

  if (market === "ft") {
    // FT totals: books are OT-inclusive; keep final score sum.
    actual = sHome + sAway;
  } else if (market === "h2") {
    // FIX Issue 5: H2 must be regulation second half (Q3+Q4), never FT-H1
    // which would include OT when the game went overtime.
    if (q3Home + q3Away + q4Home + q4Away > 0) {
      actual = q3Home + q3Away + q4Home + q4Away;
    } else if (((!isFinite(h1Home) || !isFinite(h1Away) || (h1Home === 0 && h1Away === 0))) || !isFinite(sHome + sAway)) {
      return "pending";
    } else {
      // Fallback only when quarter linescores missing; still prefer pending if OT likely.
      const _regPSettle =
        (typeof LEAGUE_FETCH_RULES !== "undefined" &&
          LEAGUE_FETCH_RULES[pick.league || ""] &&
          LEAGUE_FETCH_RULES[pick.league || ""].regulationPeriods) ||
        4;
      const _otLikely =
        (lsHome.length > _regPSettle || lsAway.length > _regPSettle);
      if (_otLikely) return "pending";
      actual = sHome + sAway - (h1Home + h1Away);
    }
  } else if (market === "winner") {
    if (sHome === sAway) {
      pick.actualScore = "Tie";
      pick.engineResultStatus = "push";
      return "push";
    }
    const actualWinnerSide = sHome > sAway ? "home" : "away";
    const predTxt = String(pick.predictionText || "").trim();
    const pickedHomeAtCreation =
      predTxt && pick.homeTeam && predTxt === String(pick.homeTeam).trim();
    const pickedAwayAtCreation =
      predTxt && pick.awayTeam && predTxt === String(pick.awayTeam).trim();
    const predictedTeamId = pickedHomeAtCreation
      ? pick.homeId
      : pickedAwayAtCreation
        ? pick.awayId
        : null;
    let predictedWinnerSide;
    if (predictedTeamId && String(predictedTeamId) === String(home.id))
      predictedWinnerSide = "home";
    else if (predictedTeamId && String(predictedTeamId) === String(away.id))
      predictedWinnerSide = "away";
    else {
      const predUp = predTxt.toUpperCase();
      const homeNameUp = String(home.team?.displayName || pick.homeTeam || "")
        .trim()
        .toUpperCase();
      const awayNameUp = String(away.team?.displayName || pick.awayTeam || "")
        .trim()
        .toUpperCase();
      if (predUp && homeNameUp && predUp === homeNameUp) predictedWinnerSide = "home";
      else if (predUp && awayNameUp && predUp === awayNameUp) predictedWinnerSide = "away";
      else if (String(pick.side || "").toLowerCase() === "away") predictedWinnerSide = "away";
      else if (String(pick.side || "").toLowerCase() === "home") predictedWinnerSide = "home";
      else {
        // FIX Issue 31: never default home on name mismatch — leave pending.
        pick.actualScore = actualWinnerSide === "home" ? "Home" : "Away";
        pick.engineResultStatus = "pending";
        return "pending";
      }
    }
    const isWin = actualWinnerSide === predictedWinnerSide;
    pick.actualScore = actualWinnerSide === "home" ? "Home" : "Away";
    pick.engineResultStatus = isWin ? "win" : "loss";
    return isWin ? "win" : "loss";
  } else if (market === "handicap" || market === "handicap_h1" || market === "handicap_h2") {
    let marginActual;
    let scoreHome = sHome;
    let scoreAway = sAway;
    if (market === "handicap") {
      marginActual = sHome - sAway;
    } else if (market === "handicap_h1") {
      marginActual = h1Home - h1Away;
      scoreHome = h1Home;
      scoreAway = h1Away;
    } else {
      // 2H margin = full-game margin minus 1H margin
      marginActual = sHome - sAway - (h1Home - h1Away);
      scoreHome = sHome - h1Home;
      scoreAway = sAway - h1Away;
    }
    if (!isFinite(marginActual) || !isFinite(marketLine)) return "pending";
    actual = marginActual;
    const pickSide = String(pick.side || "").toLowerCase();
    // FIX CRITICAL: sportsbook handicap is signed vs home. Cover = marginActual + marketLine.
    const netCover = marginActual + marketLine;
    let engineGrade = "push";
    if (netCover > 0) engineGrade = pickSide === "home" ? "win" : "loss";
    else if (netCover < 0) engineGrade = pickSide === "away" ? "win" : "loss";
    else engineGrade = "push";
    // Human-readable result: "87-80 · Home by +7" / "87-88 · Away by +1"
    const absM = Math.abs(marginActual);
    let marginLabel;
    if (marginActual > 0) marginLabel = "Home by +" + absM;
    else if (marginActual < 0) marginLabel = "Away by +" + absM;
    else marginLabel = "Tie";
    pick.actualScore =
      Math.round(scoreHome) + "-" + Math.round(scoreAway) + " · " + marginLabel;
    pick.engineResultStatus = engineGrade;
    return engineGrade;
  } else if (market === "h1") {
    if (!h1Home && !h1Away) return "pending";
    actual = h1Home + h1Away;
  } else if (market === "team_a") {
    actual = isTeamAHome ? sHome : sAway;
  } else if (market === "team_b") {
    actual = isTeamAHome ? sAway : sHome;
  } else if (market === "q1") {
    if (!q1Home && !q1Away) return "pending";
    actual = q1Home + q1Away;
  } else if (market === "q2") {
    if (!q2Home && !q2Away) return "pending";
    actual = q2Home + q2Away;
  } else if (market === "q3") {
    if (!q3Home && !q3Away) return "pending";
    actual = q3Home + q3Away;
  } else if (market === "q4") {
    if (!q4Home && !q4Away) return "pending";
    actual = q4Home + q4Away;
  } else if (market === "high_q_ou") {
    if (!q4Home && !q4Away) return "pending";
    const qs = [q1Home + q1Away, q2Home + q2Away, q3Home + q3Away, q4Home + q4Away];
    actual = Math.max(...qs);
  } else if (market === "low_q_ou") {
    if (!q4Home && !q4Away) return "pending";
    const qs = [q1Home + q1Away, q2Home + q2Away, q3Home + q3Away, q4Home + q4Away];
    actual = Math.min(...qs);
  } else if (market === "q1_team_a") {
    if (!q1Home && !q1Away) return "pending";
    actual = isTeamAHome ? q1Home : q1Away;
  } else if (market === "q1_team_b") {
    if (!q1Home && !q1Away) return "pending";
    actual = isTeamAHome ? q1Away : q1Home;
  } else if (market === "h1_team_a") {
    if (!h1Home && !h1Away) return "pending";
    actual = isTeamAHome ? h1Home : h1Away;
  } else if (market === "h1_team_b") {
    if (!h1Home && !h1Away) return "pending";
    actual = isTeamAHome ? h1Away : h1Home;
  } else if (market === "htft") {
    if ((!isFinite(h1Home) || !isFinite(h1Away) || (h1Home === 0 && h1Away === 0))) return "pending";
    const h1Lead = h1Home > h1Away ? "Home" : h1Home < h1Away ? "Away" : "Tie";
    const ftLead = sHome > sAway ? "Home" : sHome < sAway ? "Away" : "Tie";
    const actualStr = (h1Lead + "/" + ftLead).toUpperCase();
    pick.actualScore = actualStr;
    const isWin = actualStr === String(pick.predictionText).toUpperCase();
    pick.engineResultStatus = isWin ? "win" : "loss";
    return isWin ? "win" : "loss";
  } else if (market === "margin_any" || market === "margin_team") {
    const diff = Math.abs(sHome - sAway);
    const winner = sHome > sAway ? "Home" : sHome < sAway ? "Away" : "Tie";
    pick.actualScore = winner + " by " + diff;
    const pt = String(pick.predictionText).toUpperCase();
    if (market === "margin_team" && !pt.startsWith(winner.toUpperCase())) {
      pick.engineResultStatus = "loss";
      return "loss";
    }
    let isWin = false;
    const match = pt.match(/(\d+)-(\d+)/);
    if (match) {
      isWin = diff >= parseInt(match[1]) && diff <= parseInt(match[2]);
    } else if (pt.includes("31+")) {
      isWin = diff >= 31;
    }
    pick.engineResultStatus = isWin ? "win" : "loss";
    return isWin ? "win" : "loss";
  } else if (market === "high_q" || market === "low_q") {
    if (!q4Home && !q4Away) return "pending";
    const qs = [q1Home + q1Away, q2Home + q2Away, q3Home + q3Away, q4Home + q4Away];
    const target = market === "high_q" ? Math.max(...qs) : Math.min(...qs);
    const count = qs.filter((q) => q === target).length;
    const actualStr = count > 1 ? "Equal" : `Quarter ${qs.indexOf(target) + 1}`;
    pick.actualScore = qs.join(", ");
    const isWin = actualStr === String(pick.predictionText);
    pick.engineResultStatus = isWin ? "win" : "loss";
    return isWin ? "win" : "loss";
  } else {
    return "pending";
  }

  pick.actualScore = actual;

  if (String(pick.side).toLowerCase() === "no_play") {
    pick.engineResultStatus = "no_play_settled";
    return "no_play_settled";
  }
  const pickSide = String(pick.side).toLowerCase();

  let engineGrade = "push";
  if (actual > marketLine) engineGrade = pickSide === "over" ? "win" : "loss";
  else if (actual < marketLine) engineGrade = pickSide === "under" ? "win" : "loss";

  pick.engineResultStatus = engineGrade;

  const newStatus = engineGrade;
  if (
    newStatus !== oldStatus &&
    pick.snapshot &&
    (newStatus === "win" || newStatus === "loss" || newStatus === "push")
  ) {
    try {
      const _arKey = "BB_RETRO_SETTLE_COUNT";
      const _arCount = (parseInt(localStorage.getItem(_arKey) || "0", 10) || 0) + 1;
      localStorage.setItem(_arKey, String(_arCount));
      if (_arCount % 5 === 0) {
        (async () => {
          try {
            await runRetrospectiveAnalysis(pick);
          } catch (err) {
            engineDebug("Retrospective analysis error (auto-settle)", err.message);
          }
        })();
      }
    } catch (_e) {
      engineDebug("auto-settle retrospective dispatch failed", {
        error: _e?.message || String(_e),
      });
    }
  }

  return engineGrade;
}

async function refreshTrackedPickResults() {
  try {
    const active = Array.isArray(g_trackerState.activePicks) ? g_trackerState.activePicks : [];
    const archived = Array.isArray(g_trackerState.archivedPicks)
      ? g_trackerState.archivedPicks
      : [];
    const shadow = Array.isArray(g_trackerState.shadowPicks) ? g_trackerState.shadowPicks : [];
    const allBuckets = [...active, ...archived, ...shadow];

    if (!allBuckets.length) {
      renderTrackedPicks();
      return;
    }

    let changed = false;
    const pendingPicks = allBuckets.filter(
      (p) =>
        p &&
        p.eventId &&
        (!p.resultStatus || p.resultStatus === "pending") &&
        isTrackerSupportedLeague(p.league),
    );

    if (pendingPicks.length) {
      const eventEntries = [
        ...new Map(
          pendingPicks
            .map((p) => {
              const base = getTrackedLeagueApiBase(p.league);
              if (!base) return null;
              return [`${p.league}:${p.eventId}`, { base, eventId: p.eventId }];
            })
            .filter(Boolean),
        ).values(),
      ];

      const eventResults = await Promise.all(
        eventEntries.map(async (entry) => {
          const url = `${entry.base}/summary?event=${entry.eventId}&_=${Date.now()}`;
          let data = null;
          try {
            const _directCtrl = new AbortController();
            const _directTimer = setTimeout(() => _directCtrl.abort(), 8000);
            try {
              const res = await fetch(url, {
                cache: "no-store",
                mode: "cors",
                signal: _directCtrl.signal,
              });
              if (res.ok) data = await res.json();
              else throw new Error("Direct fetch failed");
            } finally {
              clearTimeout(_directTimer);
            }
          } catch (err) {
            data = await proxyFetch(url, 4000).catch(() => null);
          }
          return [entry.eventId, data];
        }),
      );

      const eventMap = new Map(eventResults);

      pendingPicks.forEach((pick) => {
        const data = eventMap.get(pick.eventId);
        const competition = data?.header?.competitions?.[0];

        const _dbgKey = `${pick.league}:${pick.eventId}:${pick.marketKey}`;
        if (!data) {
          g_settlementDebugLog.set(_dbgKey, {
            pick: `${pick.homeTeam} vs ${pick.awayTeam} · ${pick.marketKey}`,
            eventId: pick.eventId,
            status: "❌ NO API RESPONSE",
            apiFinal: false,
            clock: null,
            period: null,
            settled: null,
            actual: null,
            line: pick.lineAtPick || pick.line,
            ts: new Date().toLocaleTimeString([], { hour12: false }),
          });
          return;
        }
        if (!competition) {
          g_settlementDebugLog.set(_dbgKey, {
            pick: `${pick.homeTeam} vs ${pick.awayTeam} · ${pick.marketKey}`,
            eventId: pick.eventId,
            status: "❌ NO COMPETITION IN RESPONSE",
            apiFinal: false,
            clock: null,
            period: null,
            settled: null,
            actual: null,
            line: pick.lineAtPick || pick.line,
            ts: new Date().toLocaleTimeString([], { hour12: false }),
          });
          return;
        }

        const apiFinal =
          competition?.status?.type?.completed ||
          competition?.status?.type?.state === "post" ||
          competition?.status?.type?.name === "STATUS_FINAL";
        const clock = competition?.status?.displayClock;
        const period = competition?.status?.period;
        const stateName = competition?.status?.type?.state;
        const statusName = competition?.status?.type?.name;
        const _regPeriodsForSettle = LEAGUE_FETCH_RULES[pick.league || ""]?.regulationPeriods ?? 4;
        // FIX Issue 5b: regulation clock 0.0 is NOT game-final for FT (OT may start).
        // Only force-settle period markets (H1/Q) via isPickPeriodComplete when available;
        // FT requires true final status.
        const _clockZero = clock === "0.0" || clock === "0:00";
        const _atRegEnd = _clockZero && period >= _regPeriodsForSettle;
        const _mk = String(pick.marketKey || "").toLowerCase();
        const _isPartialMkt =
          _mk === "h1" ||
          _mk === "h1_team_a" ||
          _mk === "h1_team_b" ||
          _mk.startsWith("q") ||
          _mk === "handicap_h1";
        const forceSettle =
          _atRegEnd &&
          _isPartialMkt &&
          (typeof isPickPeriodComplete !== "function" ||
            isPickPeriodComplete(pick, competition) !== false);

        if (apiFinal || forceSettle) {
          const settled = settleTrackedPickFromCompetition(pick, competition);
          g_settlementDebugLog.set(_dbgKey, {
            pick: `${pick.homeTeam} vs ${pick.awayTeam} · ${pick.marketKey}`,
            eventId: pick.eventId,
            status:
              settled && settled !== "pending"
                ? `✅ SETTLED: ${settled.toUpperCase()}`
                : `⚠️ GAME FINAL BUT SETTLED=${settled}`,
            apiFinal,
            clock,
            period,
            stateName,
            statusName,
            settled,
            actual: pick.actualScore,
            line: pick.lineAtPick || pick.line,
            ts: new Date().toLocaleTimeString([], { hour12: false }),
          });
          if (settled && settled !== "pending" && pick.resultStatus !== settled) {
            pick.resultStatus = settled;
            pick.settledAt = new Date().toISOString();
            pick.settlementSource = "api";
            pick.settledVersion = ENGINE_MODEL_VERSION;
            changed = true;
            g_liveGameStatus.delete(pick.eventId);
            trackerDebug("auto-settled pick", {
              eventId: pick.eventId,
              market: pick.marketKey,
              result: settled,
              actual: pick.actualScore,
              line: pick.lineAtPick || pick.line,
            });

            if (g_trackerState.shadowPicks) {
              const shadowMatches = g_trackerState.shadowPicks.filter(
                (sp) => sp.eventId === pick.eventId,
              );
              for (const sp of shadowMatches) {
                if (sp.resultStatus !== "pending") continue;
                const shadowSettled = settleTrackedPickFromCompetition(sp, competition);
                if (shadowSettled && shadowSettled !== "pending") {
                  sp.resultStatus = shadowSettled;
                  // FIX Issue 5c: do NOT copy parent market actualScore across markets.
                  // settleTrackedPickFromCompetition already wrote the correct sp.actualScore.
                  sp.settledAt = new Date().toISOString();
                  if (typeof runRetrospectiveAnalysis === "function") {
                    runRetrospectiveAnalysis(sp).catch((err) =>
                      engineDebug("Shadow retro error", err),
                    );
                  }
                }
              }
            }
          }
        } else {
          g_settlementDebugLog.set(_dbgKey, {
            pick: `${pick.homeTeam} vs ${pick.awayTeam} · ${pick.marketKey}`,
            eventId: pick.eventId,
            status: `⏳ NOT FINAL`,
            apiFinal,
            clock,
            period,
            stateName,
            statusName,
            settled: null,
            actual: null,
            line: pick.lineAtPick || pick.line,
            ts: new Date().toLocaleTimeString([], { hour12: false }),
          });
          const _isLiveNow =
            stateName === "in" ||
            String(statusName || "")
              .toUpperCase()
              .includes("PROGRESS") ||
            String(statusName || "")
              .toUpperCase()
              .includes("HALFTIME");
          if (_isLiveNow && pick.eventId) {
            const _isHalf = String(statusName || "")
              .toUpperCase()
              .includes("HALFTIME");
            const _existingLive = g_liveGameStatus.get(pick.eventId);
            const _rlCompetitors = competition?.competitors || [];
            const _rlHome = _rlCompetitors.find((c) => c.homeAway === "home");
            const _rlAway = _rlCompetitors.find((c) => c.homeAway === "away");
            const _rlHomeScore = _rlHome ? parseFloat(_rlHome.score) || 0 : null;
            const _rlAwayScore = _rlAway ? parseFloat(_rlAway.score) || 0 : null;
            const _rlHomeLS = (_rlHome?.linescores || []).map(
              (l) => parseFloat(l.value ?? l.displayValue ?? 0) || 0,
            );
            const _rlAwayLS = (_rlAway?.linescores || []).map(
              (l) => parseFloat(l.value ?? l.displayValue ?? 0) || 0,
            );
            const _rlQScores =
              _rlHomeLS.length && _rlAwayLS.length
                ? { home: _rlHomeLS, away: _rlAwayLS }
                : _existingLive?.qScores || null;
            if (!(
              _existingLive?._expiredAt && Date.now() - _existingLive._expiredAt > 5 * 60 * 1000
            )) {
              g_liveGameStatus.set(pick.eventId, {
                period: Number(period || 0),
                clock: _isHalf ? "HALF" : String(clock || ""),
                statusName: String(statusName || ""),
                league: pick.league || "",
                capturedAt: Date.now(),
                clockFrozen: false,
                homeScore: _rlHomeScore,
                awayScore: _rlAwayScore,
                qScores: _rlQScores,
                _expiredAt: _existingLive?._expiredAt ?? null,
              });
            }
            const _regPeriods = LEAGUE_FETCH_RULES[pick.league || ""]?.regulationPeriods ?? 4;
            const _periodDone = isPickPeriodComplete(
              pick.marketKey,
              Number(period || 0),
              _isHalf,
              false,
              _regPeriods,
            );
            const _isPeriodMarket = [
              "q1",
              "q2",
              "q3",
              "q4",
              "h1",
              "q1_team_a",
              "q1_team_b",
              "h1_team_a",
              "h1_team_b",
            ].includes(pick.marketKey);
            if (_periodDone && _isPeriodMarket) {
              const midSettled = settleTrackedPickFromCompetition(pick, competition, true);
              if (midSettled && midSettled !== "pending" && pick.resultStatus !== midSettled) {
                pick.resultStatus = midSettled;
                pick.settledAt = new Date().toISOString();
                pick.settlementSource = "api_period";
                pick.settledVersion = ENGINE_MODEL_VERSION;
                changed = true;
                g_liveGameStatus.delete(pick.eventId);
                g_settlementDebugLog.set(_dbgKey, {
                  pick: `${pick.homeTeam} vs ${pick.awayTeam} · ${pick.marketKey}`,
                  eventId: pick.eventId,
                  status: `✅ PERIOD SETTLED: ${midSettled.toUpperCase()}`,
                  apiFinal: false,
                  clock,
                  period,
                  settled: midSettled,
                  actual: pick.actualScore,
                  line: pick.lineAtPick || pick.line,
                  ts: new Date().toLocaleTimeString([], { hour12: false }),
                });
                trackerDebug("period-settled pick", {
                  eventId: pick.eventId,
                  market: pick.marketKey,
                  result: midSettled,
                  actual: pick.actualScore,
                });
              }
            }
            if (["high_q_ou", "low_q_ou"].includes(pick.marketKey) && Number(period || 0) >= 2) {
              const _qouEarly = settleTrackedPickFromCompetition(pick, competition, true);
              if (_qouEarly && _qouEarly !== "pending" && pick.resultStatus !== _qouEarly) {
                pick.resultStatus = _qouEarly;
                pick.settledAt = new Date().toISOString();
                pick.settlementSource = "api_early_qou";
                pick.settledVersion = ENGINE_MODEL_VERSION;
                changed = true;
                g_liveGameStatus.delete(pick.eventId);
                g_settlementDebugLog.set(_dbgKey, {
                  pick: `${pick.homeTeam} vs ${pick.awayTeam} · ${pick.marketKey}`,
                  eventId: pick.eventId,
                  status: `✅ EARLY QOU: ${_qouEarly.toUpperCase()}`,
                  apiFinal: false,
                  clock,
                  period,
                  settled: _qouEarly,
                  actual: pick.actualScore,
                  line: pick.lineAtPick || pick.line,
                  ts: new Date().toLocaleTimeString([], { hour12: false }),
                });
                trackerDebug("early qou settled", {
                  eventId: pick.eventId,
                  market: pick.marketKey,
                  result: _qouEarly,
                  actual: pick.actualScore,
                });
              }
            }
          }
        }

        if (g_settlementDebugLog.size > 200) {
          const keysToDelete = [...g_settlementDebugLog.keys()].slice(
            0,
            g_settlementDebugLog.size - 150,
          );
          keysToDelete.forEach((k) => g_settlementDebugLog.delete(k));
        }
      });
    }

    const archivedChanged = archiveExpiredTrackedPicks();

    if (changed || archivedChanged) {
      g_trackerState.updatedAt = new Date().toISOString();
      rebuildTrackerStats();
      await saveTrackerStateToLocal();

      try {
        const _ACCLOG = "bb_engine_accuracy_log";
        let _log = [];
        try {
          _log = JSON.parse(localStorage.getItem(_ACCLOG)) || [];
        } catch (_) {
          engineDebug("bb_engine_accuracy_log parse failed (settle path)", {
            error: _?.message || String(_),
          });
        }
        (g_trackerState.activePicks || [])
          .filter((p) => {
            const s = String(p.resultStatus || "").toLowerCase();
            return (
              (s === "win" || s === "loss" || s === "push") &&
              p.actualScore != null &&
              p.proj != null
            );
          })
          .forEach((p) => {
            const _proj = Number(p.proj),
              _actual = Number(p.actualScore);
            if (!isFinite(_proj) || !isFinite(_actual)) return;
            const _result = String(p.resultStatus || "").toLowerCase();
            const _outcome = _result === "win" ? 1 : _result === "loss" ? 0 : 0.5;
            const _wp = isFinite(Number(p.winProbability)) ? Number(p.winProbability) : null;
            _log.push({
              ts: new Date().toISOString(),
              league: p.league || "",
              market: p.marketKey || "",
              side: p.side || "",
              proj: _proj,
              actual: _actual,
              line: Number(p.lineAtPick || p.line || 0),
              error: _actual - _proj,
              result: _result,
              grade: p.confidenceGrade || "",
              winProb: _wp,
              brierContrib: _wp !== null ? Math.pow(_wp - _outcome, 2) : null,
              edgePct: isFinite(Number(p.edgePct)) ? Number(p.edgePct) : null,
            });
          });
        if (_log.length > 2000) _log = _log.slice(-2000);
        try {
          localStorage.setItem(_ACCLOG, JSON.stringify(_log));
        } catch (_) {
          engineDebug("bb_engine_accuracy_log save failed", { error: _?.message || String(_) });
        }

        try {
          const _bEntries = _log.filter((e) => e.brierContrib !== null && isFinite(e.brierContrib));
          if (_bEntries.length >= 20) {
            const _recent = _bEntries.slice(-100);
            const _brier = _recent.reduce((s, e) => s + e.brierContrib, 0) / _recent.length;
            const _bins = Array.from({ length: 10 }, () => ({ sp: 0, so: 0, n: 0 }));
            _recent.forEach((e) => {
              const bi = Math.min(9, Math.floor(e.winProb * 10));
              _bins[bi].sp += e.winProb;
              _bins[bi].so += e.result === "win" ? 1 : 0;
              _bins[bi].n++;
            });
            const _ece = _bins
              .filter((b) => b.n > 0)
              .reduce((s, b) => s + (b.n / _recent.length) * Math.abs(b.sp / b.n - b.so / b.n), 0);
            localStorage.setItem(
              "BB_CALIBRATION_METRICS",
              JSON.stringify({
                brierScore: parseFloat(_brier.toFixed(4)),
                ece: parseFloat(_ece.toFixed(4)),
                n: _recent.length,
                ts: new Date().toISOString(),
              }),
            );
          }
        } catch (_ce) {
          engineDebug("global calibration metrics computation failed", {
            error: _ce?.message || String(_ce),
          });
        }

        try {
          const CALIBRATION_MIN_SAMPLE = 20;
          const _byLeague = {};
          _log
            .filter((e) => e.brierContrib !== null && isFinite(e.brierContrib) && e.league)
            .forEach((e) => {
              const lk = String(e.league).toLowerCase();
              if (!_byLeague[lk]) _byLeague[lk] = [];
              _byLeague[lk].push(e);
            });

          const _perLeagueStore = {};
          try {
            const _existingRaw = localStorage.getItem("BB_CALIBRATION_METRICS_BY_LEAGUE");
            if (_existingRaw) Object.assign(_perLeagueStore, JSON.parse(_existingRaw));
          } catch (_readErr) {
            engineDebug("BB_CALIBRATION_METRICS_BY_LEAGUE read failed", {
              error: _readErr?.message || String(_readErr),
            });
          }

          Object.keys(_byLeague).forEach((lk) => {
            const entries = _byLeague[lk].slice(-100);
            if (entries.length < CALIBRATION_MIN_SAMPLE) {
              _perLeagueStore[lk] = {
                calibrationStatus: "provisional",
                brierScore: null,
                ece: null,
                n: entries.length,
                minRequired: CALIBRATION_MIN_SAMPLE,
                bins: null,
                ts: new Date().toISOString(),
              };
              return;
            }
            const brierL = entries.reduce((s, e) => s + e.brierContrib, 0) / entries.length;
            const binsL = Array.from({ length: 10 }, () => ({ sp: 0, so: 0, n: 0 }));
            entries.forEach((e) => {
              const bi = Math.min(9, Math.floor(e.winProb * 10));
              binsL[bi].sp += e.winProb;
              binsL[bi].so += e.result === "win" ? 1 : 0;
              binsL[bi].n++;
            });
            const eceL = binsL
              .filter((b) => b.n > 0)
              .reduce((s, b) => s + (b.n / entries.length) * Math.abs(b.sp / b.n - b.so / b.n), 0);
            _perLeagueStore[lk] = {
              calibrationStatus: "calibrated",
              brierScore: parseFloat(brierL.toFixed(4)),
              ece: parseFloat(eceL.toFixed(4)),
              n: entries.length,
              minRequired: CALIBRATION_MIN_SAMPLE,
              bins: binsL.map((b) => ({
                n: b.n,
                avgPredicted: b.n ? parseFloat((b.sp / b.n).toFixed(3)) : null,
                avgActual: b.n ? parseFloat((b.so / b.n).toFixed(3)) : null,
              })),
              ts: new Date().toISOString(),
            };
          });

          localStorage.setItem("BB_CALIBRATION_METRICS_BY_LEAGUE", JSON.stringify(_perLeagueStore));
        } catch (_ceLeague) {
          engineDebug(
            "per-league calibration computation failed: " +
              (_ceLeague?.message || String(_ceLeague)),
            { error: _ceLeague },
          );
        }

        try {
          updateEnginePerformanceScore();
        } catch (_pe) {
          engineDebug("updateEnginePerformanceScore failed (post-calibration)", {
            error: _pe?.message || String(_pe),
          });
        }

        try {
          const _ckpt = JSON.parse(localStorage.getItem("BB_RETRAIN_CHECKPOINT") || "{}");
          const _nowSettled = getAllSettledTrackedPicks().length;
          const _prevSettled = Number(_ckpt.settledCount || 0);
          let _retrainEvery = 25;
          try {
            const _perf = JSON.parse(localStorage.getItem("BB_ENGINE_PERFORMANCE") || "null");
            if (_perf && isFinite(_perf.score) && _perf.score < 60) _retrainEvery = 10;
          } catch (_pf) {
            engineDebug("BB_ENGINE_PERFORMANCE read failed (retrain interval check)", {
              error: _pf?.message || String(_pf),
            });
          }
          if (_nowSettled - _prevSettled >= _retrainEvery) {
            setTimeout(() => {
              try {
                calibrateConfidenceModel();
              } catch (e) {
                engineDebug("calibrateConfidenceModel failed during retrain", {
                  error: e?.message || String(e),
                });
              }

              try {
                calibrateEngineConstants();
              } catch (e) {
                engineDebug("calibrateEngineConstants failed during retrain", {
                  error: e?.message || String(e),
                });
              }
              try {
                const allPicks = getAllTrackedPicksForReport();

                runCoordinateAscentTuner(allPicks, null);

                const _curLg = document.getElementById("leagueSelect")?.value || "";
                if (_curLg) {
                  runCoordinateAscentTuner(allPicks, _curLg);
                }
              } catch (e) {
                engineDebug("Coordinate ascent retrospective failed during retrain", e);
              }
              try {
                const _oosLeague = document.getElementById("leagueSelect")?.value || "";
                const _oosResult = runOutOfSampleValidation(_oosLeague);
                if (_oosResult) engineDebug("Out-of-sample validation result", _oosResult);
              } catch (e) {
                engineDebug("runOutOfSampleValidation threw during retrain", {
                  error: e?.message || String(e),
                });
              }

              try {
                const _snapResult = refreshTrackerSignalSnapshot();
                if (_snapResult)
                  engineDebug("Tracker signal snapshot refresh result", {
                    frozenAt: _snapResult.frozenAt,
                    settledCountAtFreeze: _snapResult.settledCountAtFreeze,
                    validationZ: _snapResult.validationZ || null,
                  });
              } catch (e) {
                engineDebug(
                  "refreshTrackerSignalSnapshot threw during retrain",
                  e?.message || String(e),
                );
              }
              try {
                const _healthLg = document.getElementById("leagueSelect")?.value || "";
                if (_healthLg) checkModelHealth(_healthLg);
              } catch (e) {
                engineDebug("checkModelHealth threw during retrain", {
                  error: e?.message || String(e),
                });
              }
              localStorage.setItem(
                "BB_RETRAIN_CHECKPOINT",
                JSON.stringify({
                  settledCount: _nowSettled,
                  ts: new Date().toISOString(),
                }),
              );
              engineDebug("Retraining pipeline fired", {
                settled: _nowSettled,
                prev: _prevSettled,
              });
            }, 400);
          }
        } catch (_re) {
          engineDebug("retrain scheduling block failed", { error: _re?.message || String(_re) });
        }
      } catch (_e) {
        engineDebug("retrain pipeline outer block failed", { error: _e?.message || String(_e) });
      }
      renderTrackedPicks();
    }
  } catch (err) {
    console.error("[BB Engine] refresh failed", err);
  }
}

function loadTrackedPicks() {
  return Array.isArray(AppState.tracker.state.activePicks)
    ? AppState.tracker.state.activePicks
    : [];
}

function saveTrackedPicks(picksArray) {
  AppState.tracker.state.activePicks = picksArray;
  saveTrackerStateToLocal();
}

function addTrackedPicks(newPicks) {
  if (!Array.isArray(newPicks) || !newPicks.length) {
    renderTrackedPicks();
    return;
  }

  const current = loadTrackedPicks();
  const archived = Array.isArray(g_trackerState.archivedPicks) ? g_trackerState.archivedPicks : [];
  let changed = false;
  let shadowChanged = false;

  if (!g_trackerState.shadowPicks) g_trackerState.shadowPicks = [];

  newPicks.forEach((raw) => {
    const p = { ...ensureTrackedPickKeys(raw) };
    if (p.diagnostics) {
      p.godsEyeMemory = {
        pace: p.diagnostics.pace,
        netA: p.diagnostics.netA,
        netB: p.diagnostics.netB,
        aVol: p.diagnostics.aVol,
        bVol: p.diagnostics.bVol,
        edgePct: p.edgePct,
        grade: p.confidenceGrade,

        sampleTier: p.diagnostics.ftSampleTier || p.diagnostics.sampleTier || null,
        trap: p.diagnostics.trap || false,
        paceGapRisk: p.diagnostics.paceGapRisk || false,
        hasH2H: p.diagnostics.ftHasH2H || false,

        volatilityRatio: isFinite(Number(p.diagnostics.aVol))
          ? Number(p.diagnostics.aVol) / getLeagueVolLimit(p.league)
          : null,
        possProjection: p.diagnostics.possProjection ?? null,
        anchorPull: p.diagnostics.anchorPull ?? null,
        league: p.league || null,
        marketKey: p.marketKey || null,
        winProbability: p.winProbability ?? null,
      };
      delete p.diagnostics;
      delete p.massacre;
      delete p.trackerFeedback;
      delete p.shadowTrackerFeedback;
      delete p.teamMemory;
    }
    if (!p.signature) p.signature = makeTrackedSignature(p);

    if (p.isShadow) {
      const existingShadowIdx = g_trackerState.shadowPicks.findIndex(
        (s) => s.eventId === p.eventId && s.marketKey === p.marketKey && s.side === p.side,
      );
      if (existingShadowIdx !== -1) {
        g_trackerState.shadowPicks[existingShadowIdx] = p;
        shadowChanged = true;
      } else {
        g_trackerState.shadowPicks.unshift(p);
        shadowChanged = true;
      }
      if (g_trackerState.shadowPicks.length > 500)
        g_trackerState.shadowPicks = g_trackerState.shadowPicks.slice(0, 500);
      return;
    }

    const prisonKey = makeTrackerActiveMergeKey(p);
    const exactIdx = current.findIndex((x) => makeTrackerActiveMergeKey(x) === prisonKey);

    if (exactIdx !== -1) {
      const existing = current[exactIdx];
      if (["win", "loss", "push"].includes(String(existing.resultStatus || "").toLowerCase())) {
        engineDebug("addTrackedPicks: settled pick holds slot, new pick not saved", {
          market: p.marketKey,
          eventId: p.eventId,
          existing: existing.resultStatus,
        });
        return;
      }

      current[exactIdx] = ensureTrackedPickKeys({
        ...existing,
        ...p,
        createdAt: existing.createdAt || p.createdAt,
        signature: p.signature,
      });
      changed = true;
      return;
    }

    const archivedIdx = archived.findIndex((x) => makeTrackerActiveMergeKey(x) === prisonKey);
    if (archivedIdx !== -1) return;

    current.unshift(p);
    changed = true;
  });

  if (changed) saveTrackedPicks(current);
  if (shadowChanged) saveTrackerStateToLocal();
  renderTrackedPicks();
}

function getH2HWeight(
  lenA,
  lenB,
  marketType = "ft",
  sampleTier = "thin",
  divergence = 0,
  league = "unknown",
  baselineForMarket = null,
  factor = 1.0,
  context = null,
) {
  const minLen = Math.min(Number(lenA) || 0, Number(lenB) || 0);
  if (minLen < 2) return 0;
  const _h2hCap = getParam("h2hMaxWeight", league) ?? 0.3;
  let weight = (Math.log1p(minLen - 1) / Math.log1p(9)) * _h2hCap;

  const tier = String(sampleTier || "thin").toLowerCase();
  const tierPenalty =
    tier === "insufficient"
      ? (getParam("h2hTierInsufficientPenalty", league) ?? 0.55)
      : tier === "thin"
        ? (getParam("h2hTierThinPenalty", league) ?? 0.85)
        : 1.0;
  weight *= tierPenalty;

  const relDiv =
    isFinite(divergence) && divergence > 0 && isFinite(baselineForMarket) && baselineForMarket > 0
      ? divergence / baselineForMarket
      : 0;
  const _divThresh = getParam("h2hDivergenceThreshold", league) ?? 0.12;
  const _divSlope = getParam("h2hDivergenceSlope", league) ?? 2.5;
  const divergencePenalty =
    relDiv > _divThresh ? Math.max(0.45, 1.0 - (relDiv - _divThresh) * _divSlope) : 1.0;

  let contextPenalty = 1.0;
  if (context) {
    const injA = context.injMultA ?? 1.0;
    const injB = context.injMultB ?? 1.0;
    const injuryGap = Math.abs(injA - injB);
    const volRatio = context.volRatio ?? 1.0;
    const blowoutGap = context.blowoutGap ?? 0;
    const paceGapRisk = context.paceGapRisk ?? false;
    const injuryRisk = Math.min(0.6, injuryGap * (getParam("h2hInjuryRiskSlope", league) ?? 1.5));
    const volatilityRisk = Math.min(
      0.4,
      Math.max(0, volRatio - 1) * (getParam("h2hVolRiskSlope", league) ?? 0.4),
    );
    const blowoutRisk =
      blowoutGap > (getParam("h2hBlowoutGapThreshold", league) ?? 15)
        ? (getParam("h2hBlowoutRisk", league) ?? 0.2)
        : 0;
    const paceRisk = paceGapRisk ? (getParam("h2hPaceRisk", league) ?? 0.15) : 0;
    // FIX MEDIUM: context floor was hard 0.4; make tunable (default 0.2).
    const _ctxFloor = (typeof getParam === "function" ? getParam("h2hContextFloor", league) : null) ?? 0.2;
    const _safeFloor = Number.isFinite(_ctxFloor) ? Math.min(0.5, Math.max(0.05, Number(_ctxFloor))) : 0.2;
    contextPenalty = Math.max(_safeFloor, 1.0 - injuryRisk - volatilityRisk - blowoutRisk - paceRisk);
  }

  weight *= divergencePenalty * contextPenalty;
  return Math.min(_h2hCap, weight * factor);
}

// A1 fix: volatility must NOT shrink the point projection — that was the
// original bug (pulling the mean toward a baseline conflates "uncertain"
// with "wrong"). The correct treatment of volatility is as the standard
// deviation of a predictive distribution built around this same unshifted
// mean (see distributionWinProbability/_normalCdf), not as a discount on
// the mean itself. This function is intentionally an identity on proj —
// the dead volRatio/baseline computation that used to sit here and never
// affect the output has been removed rather than left as misleading code.
// FIX: intentional identity. Volatility belongs in the predictive distribution
// (distributionWinProbability), NOT as a shrink of the point mean. Do not
// reintroduce mean-shrinkage here. Alias kept for call-site compatibility.
function applyVolatility(proj, series, leagueVolLimit, league, baselineOverride) {
  return proj;
}
function passThroughProjectionMean(proj) {
  return proj;
}

function getVolatilityRatioForSeries(series, leagueVolLimit) {
  const cleanSeries = Array.isArray(series) ? series.map(Number).filter((v) => isFinite(v)) : [];

  // FIX: n<3 is unknown uncertainty, not "exactly neutral 1.0".
  // Return a conservative prior ratio so thin samples cannot look stable.
  if (cleanSeries.length < 3) return 1.35;
  const sd = stdDev(cleanSeries);
  const limit = Number(leagueVolLimit) || 12;
  return Math.min(2.5, sd / limit);
}

// --- Golden math self-tests (Phase C seed) ---
// Run via: window.__BB_RUN_MATH_TESTS__() from console or a "Run math tests" button.

window.__BB_RUN_MATH_TESTS__ = function __BB_RUN_MATH_TESTS__() {
  const fails = [];
  const assert = (cond, msg) => {
    if (!cond) fails.push(msg);
  };

  // --- A1 periodPoss / ORTG honesty ---
  if (typeof derivePeriodAdvanced === "function") {
    const full = { pace: 100, ortg: 110, drtg: 108, possessions: 100 };
    const ok = derivePeriodAdvanced(full, 55, 52, 0.5, "nba");
    assert(ok && Number.isFinite(ok.ortg), "derivePeriodAdvanced should return finite ortg");
    assert(ok && Math.abs(ok.possessions - 50) < 0.01, "periodPoss = gamePoss * fraction");
    assert(ok && Math.abs(ok.ortg - 110) < 0.5, "ORTG = 100 * pts / periodPoss");
    assert(ok && Math.abs(ok.drtg - 104) < 0.5, "DRTG = 100 * oppPts / periodPoss");
    const thin = derivePeriodAdvanced(full, 2, 2, 0.05, "nba");
    assert(thin === null, "thin periodPoss (<5) must reject");
    const badFrac = derivePeriodAdvanced(full, 55, 52, 0, "nba");
    assert(badFrac === null, "zero periodFraction must reject");
  }

  // --- A2 applyVolatility is identity ---
  if (typeof applyVolatility === "function") {
    assert(
      applyVolatility(100, [90, 100, 110], 12, "nba") === 100,
      "applyVolatility must be identity on proj",
    );
    assert(
      applyVolatility(88.5, [], 12, "ncaa") === 88.5,
      "applyVolatility identity with empty series",
    );
  }

  // --- A1 period series min sample + no FT leak ---
  if (typeof getPeriodAdvancedSeries === "function") {
    const thinCtx = {
      ortg10_h2: [110, 111, 112],
      drtg10_h2: [105, 106, 107],
      pace10_h2: [98, 99, 100],
      ortg10: [112],
      drtg10: [108],
      pace10: [100],
    };
    const r = getPeriodAdvancedSeries(thinCtx, "h2");
    assert(r.source === "none", "h2 with <5 samples must source=none (no FT leak)");
    const thinH1 = getPeriodAdvancedSeries(
      { ortg10_h1: [1, 2, 3, 4], drtg10_h1: [1, 2, 3, 4], ortg10: [110], drtg10: [105] },
      "h1",
    );
    assert(thinH1.source === "none", "h1 with <5 samples must source=none");
    const fullCtx = {
      ortg10_h2: [110, 111, 112, 113, 114],
      drtg10_h2: [105, 106, 107, 108, 109],
      pace10_h2: [98, 99, 100, 101, 102],
    };
    const r2 = getPeriodAdvancedSeries(fullCtx, "h2");
    assert(r2.source === "h2" && r2.ortg.length >= 5, "h2 with ≥5 samples must be period-native");
    const qThin = getPeriodAdvancedSeries(
      { ortg10_q1: [100, 101], drtg10_q1: [99, 98], ortg10: [110] },
      "q1",
    );
    assert(qThin.source === "none", "q1 thin must not fall back to FT");
  }

  // --- B5 feature parity train/serve ---
  if (typeof buildConfidenceFeatures === "function") {
    const fLive = buildConfidenceFeatures({
      edgePct: 0.08,
      volatilityRatio: 1.2,
      sampleTier: "full",
      hasH2H: true,
      trap: false,
      league: "nba",
    });
    const fFit = buildConfidenceFeatures({
      edgePct: 8.0,
      godsEyeMemory: { aVol: 14.4, bVol: 14.4, sampleTier: "full", hasH2H: true, trap: false },
      league: "nba",
      marketKey: "ft",
    });
    assert(
      Number.isFinite(fLive.edgePct) && Number.isFinite(fFit.edgePct),
      "features must be finite",
    );
    assert(
      Math.abs(fLive.edgePct - fFit.edgePct) < 1e-9,
      "live fraction and fit percent must normalize to same edgePct feature",
    );
    assert(
      fLive.sampleFull === 1 && fLive.h2h === 1 && fLive.trap === 0,
      "live flags sampleFull/h2h/trap",
    );
    assert(fFit.sampleFull === 1 && fFit.h2h === 1, "fit flags sampleFull/h2h");
    // pivot 0.060 only — edge 0.08 → feature 0.02
    assert(Math.abs(fLive.edgePct - 0.02) < 1e-9, "edge feature = edgeFrac - 0.060");
    const zero = buildConfidenceFeatures({
      edgePct: 0.06,
      sampleTier: "thin",
      hasH2H: false,
      trap: true,
    });
    assert(
      Math.abs(zero.edgePct) < 1e-9 && zero.sampleFull === 0 && zero.trap === 1,
      "pivot edge and thin/trap flags",
    );
  }

  // --- A3/D14 NaN grade sentinel, never fake D from null ---
  if (typeof resolveConfidenceGradeFromWinProbability === "function") {
    assert(
      resolveConfidenceGradeFromWinProbability(null, "nba") === "NaN",
      "null winProb → NaN grade, never fake D",
    );
    assert(
      resolveConfidenceGradeFromWinProbability(undefined, "nba") === "NaN",
      "undefined winProb → NaN",
    );
    assert(resolveConfidenceGradeFromWinProbability(NaN, "nba") === "NaN", "NaN winProb → NaN");
    assert(
      resolveConfidenceGradeFromWinProbability(-0.3, "nba") === "NaN",
      "negative winProb → NaN",
    );
    assert(resolveConfidenceGradeFromWinProbability(1.7, "nba") === "NaN", "winProb > 1 → NaN");
  }
  if (typeof getConfidenceGrade === "function") {
    assert(
      getConfidenceGrade({ pick: "NO PLAY", line: 220, edge: 5, league: "nba" }) === "NaN",
      "NO PLAY → NaN",
    );
    assert(
      getConfidenceGrade({ pick: "OVER", line: null, edge: 5, league: "nba" }) === "NaN",
      "null line → NaN",
    );
    assert(
      getConfidenceGrade({ pick: "OVER", line: 220, edge: NaN, league: "nba" }) === "NaN",
      "NaN edge → NaN",
    );
  }

  // --- distribution win prob ---
  if (typeof distributionWinProbability === "function") {
    const p = distributionWinProbability(3, 12, 1.0);
    assert(Number.isFinite(p) && p > 0.5 && p < 1, "positive edge → winProb > 0.5");
    const p0 = distributionWinProbability(0, 12, 1.0);
    assert(Number.isFinite(p0) && Math.abs(p0 - 0.5) < 0.02, "zero edge → ~0.5");
    assert(distributionWinProbability(NaN, 12, 1) === null, "NaN meanEdge → null");
  }

  // --- sample tier / quality ---
  if (typeof getSampleTier === "function") {
    assert(
      getSampleTier([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) === "full",
      "10+ → full",
    );
    assert(getSampleTier([1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6]) === "thin", "5–9 → thin");
    assert(getSampleTier([1, 2], [1, 2, 3]) === "insufficient", "<5 → insufficient");
  }

  // --- getMarketVolLimit present ---
  if (typeof getMarketVolLimit === "function") {
    const v = getMarketVolLimit("nba", "ft");
    assert(Number.isFinite(v) && v > 0, "getMarketVolLimit returns positive finite");
  }

  // --- Number.isFinite null trap regression ---
  assert(isFinite(null) === true, "document JS quirk isFinite(null)===true");
  assert(Number.isFinite(null) === false, "Number.isFinite(null)===false (required for grades)");

  const report = {
    ok: fails.length === 0,
    failCount: fails.length,
    fails: fails.slice(0, 40),
    message:
      fails.length === 0
        ? "All golden math tests passed"
        : fails.length + " golden math test(s) failed",
  };
  if (typeof engineDebug === "function") engineDebug("MATH_TESTS", report);
  try {
    var panel = document.getElementById("mathTestsPanel");
    if (panel) {
      var lines = [];
      lines.push(
        report.ok
          ? "✅ MATH TESTS PASSED"
          : "❌ MATH TESTS FAILED (" + (report.failCount || 0) + ")",
      );
      lines.push(report.message || "");
      if (report.fails && report.fails.length) {
        lines.push("---");
        report.fails.forEach(function (f, i) {
          lines.push(i + 1 + ". " + f);
        });
      }
      panel.style.display = "block";
      panel.style.borderColor = report.ok ? "#2f8f4a" : "#c91920";
      panel.style.color = report.ok ? "#1e6e39" : "#b11a20";
      panel.textContent = lines.join(String.fromCharCode(10));
    }
  } catch (_p) {}
  return report;
};

function getSampleTier(...arrays) {
  if (!arrays.length) return "insufficient";
  const lens = arrays.map((a) => (Array.isArray(a) ? a.length : 0));
  const minLen = Math.min(...lens);

  if (minLen <= 0) return "insufficient";
  // FIX: discrete labels are UI-only. Projection/H2H/confidence math should prefer
  // getSampleQuality(...arrays) continuous weight in [0,1]. Do not add new hard cliffs here.
  if (minLen >= 10) return "full";
  if (minLen >= 5) return "thin";
  return "insufficient";
}

/** Continuous 0..1 sample quality (smooth; no cliff at 5/10). */

/** Period-native advanced series from auto-fetch context; empty if unavailable. */
function getPeriodAdvancedSeries(ctx, marketKey) {
  // Temporal: advanced series must be built from asOf-filtered events upstream
  // (filterEventsAsOf / resolvePredictionAsOf / eventDate / predictionDate).
  // Temporal filter must be invoked with (events, asOf) — not merely referenced.
  // void-filterEventsAsOf removed (Issue 34: auditor must not treat a void ref as proof).
  const c = ctx || {};
  const mk = String(marketKey || "ft").toLowerCase();
  if (mk === "ft" || mk === "full") {
    return {
      ortg: Array.isArray(c.ortg10) ? c.ortg10 : [],
      drtg: Array.isArray(c.drtg10) ? c.drtg10 : [],
      pace: Array.isArray(c.pace10) ? c.pace10 : [],
      source: "ft",
    };
  }
  const o = c["ortg10_" + mk];
  const d = c["drtg10_" + mk];
  const p = c["pace10_" + mk];
  // Policy: min sample ≥5 for period-native advanced; never silently thin-leak FT ORTG into H2/Q.
  // FIX HIGH: never label full-game pace as period-native. Distinct source tags.
  if (Array.isArray(o) && o.length >= 5 && Array.isArray(d) && d.length >= 5) {
    const hasPeriodPace = Array.isArray(p) && p.length >= 5;
    return {
      ortg: o,
      drtg: d,
      pace: hasPeriodPace ? p : [],
      source: hasPeriodPace ? mk : mk + "_without_pace",
      periodNative: hasPeriodPace,
    };
  }
  return { ortg: [], drtg: [], pace: [], source: "none", periodNative: false };
}

function getSampleQuality(...arrays) {
  const lens = arrays.map((a) => (Array.isArray(a) ? a.length : 0));
  const minLen = Math.min(...(lens.length ? lens : [0]));
  if (minLen <= 0) return 0;
  // Smoothstep from 3 → 12 games
  const t = clampNumber((minLen - 3) / 9, 0, 1);
  return t * t * (3 - 2 * t);
}

function getEffectivePaceClamp(league) {
  const lk = String(league || "").toLowerCase();
  const wide = lk === "nba" || lk === "ncaa" || lk === "ncaaw" || lk === "nba_gl";

  return wide
    ? {
        min: getParam("paceClampMinNbaNcaa", lk) ?? 0.65,
        max: getParam("paceClampMaxNbaNcaa", lk) ?? 1.35,
      }
    : {
        min: getParam("paceClampMinOther", lk) ?? 0.7,
        max: getParam("paceClampMaxOther", lk) ?? 1.3,
      };
}

function getLineSanityBands(league) {
  const cfg = LEAGUE_CONFIG_MAP[String(league || "").toUpperCase()];
  if (cfg && isFinite(cfg.sanityMin) && isFinite(cfg.sanityMax)) {
    return {
      ft: [cfg.sanityMin, cfg.sanityMax],
      h1: [cfg.sanityMin * 0.46, cfg.sanityMax * 0.54],
      team: [cfg.sanityMin * 0.44, cfg.sanityMax * 0.56],
    };
  }

  const eb = LEAGUE_BASES[String(league || "").toLowerCase()] || LEAGUE_BASES.unknown;
  const sanityMin = eb * 0.72;
  const sanityMax = eb * 1.28;
  return {
    ft: [sanityMin, sanityMax],
    h1: [sanityMin * 0.46, sanityMax * 0.54],
    team: [sanityMin * 0.44, sanityMax * 0.56],
  };
}

function validateLines(league, ftLine, h1Line, aLine, bLine) {
  const errors = [];
  const bands = getLineSanityBands(league);
  const checkFt = (v, label) => {
    if (v == null || !isFinite(v)) return;
    if (v < bands.ft[0] || v > bands.ft[1])
      errors.push(
        label + " (" + v + ") is outside expected range " + bands.ft[0] + "–" + bands.ft[1],
      );
  };
  const checkH1 = (v, label) => {
    if (v == null || !isFinite(v)) return;
    if (v < bands.h1[0] || v > bands.h1[1])
      errors.push(label + " (" + v + ") outside expected range");
  };
  const checkTeam = (v, label) => {
    if (v == null || !isFinite(v)) return;
    if (v < bands.team[0] || v > bands.team[1])
      errors.push(label + " (" + v + ") outside expected range");
  };
  checkFt(ftLine, "FT Total");
  checkH1(h1Line, "1H Total");
  checkTeam(aLine, "Team A Total");
  checkTeam(bLine, "Team B Total");
  return errors;
}

function validateLinesFromExtracted(league, lines = {}) {
  return validateLines(league, lines.ftLine, lines.h1Line, lines.aLine, lines.bLine);
}

// Pure: takes plain arrays in, returns a plain array out. No DOM, no
// AppState, no localStorage — safe to unit-test with fixed inputs.
function resolveOverallSeries(manualSeries, fetchedSeries, limit) {
  // Temporal: inputs should already be asOf-filtered by getFetchedSeries /
  // filterEventsAsOf / resolvePredictionAsOf / eventDate / predictionDate.
  // Temporal filter must be invoked with (events, asOf) — not merely referenced.
  // void-filterEventsAsOf removed (Issue 34: auditor must not treat a void ref as proof).
  const n = Math.max(2, Math.min(Number(limit) || 25, 25));
  const manual = Array.isArray(manualSeries) ? manualSeries : [];
  if (manual.length >= 2) return manual.slice(0, n);
  const fetched = Array.isArray(fetchedSeries) ? fetchedSeries : [];
  return fetched.slice(0, n);
}

// Thin wrapper: only this part touches the DOM/AppState.
function getOverallSeries(side, limit, contextData = null, manualOverride = null) {
  const fieldId = side === "A" ? "aFTScored" : "bFTScored";
  // D3: prefer explicit manual series (from parsed/snapshot) over live DOM.
  const manual = Array.isArray(manualOverride)
    ? manualOverride
        .map(Number)
        .filter((v) => isFinite(v) && v > 0)
        .slice(0, 10)
    : readLooseSeries(fieldId);
  const root =
    contextData || (typeof AppState !== "undefined" ? AppState.context?.data : null) || {};
  const asOf = typeof resolvePredictionAsOf === "function"
    ? resolvePredictionAsOf(root?.predictionDate || root?.asOf || root?.eventDate, root)
    : null;
  const ctx = root?.[side]?.overall;
  let fetched = Array.isArray(ctx?.ftScored10)
    ? ctx.ftScored10.map(Number).filter((v) => isFinite(v) && v > 0)
    : [];
  // Temporal: apply filterEventsAsOf / parallel dates when available
  if (asOf && typeof filterNumericSeriesWithParallelDates === "function") {
    const dates = ctx?.ftScoredDates10 || root?.predictionDates || null;
    fetched = filterNumericSeriesWithParallelDates(fetched, dates, asOf);
  }
  return resolveOverallSeries(manual, fetched, limit);
}

function getPick(edge, line, league, marketKey, context = {}) {
  // FIX (HIGH #6): isNaN(Infinity) is false, so Infinity previously slipped
  // through this guard. Number.isFinite rejects NaN, Infinity, and -Infinity.
  if (!line || !Number.isFinite(edge) || !Number.isFinite(line) || line <= 0) return "NO PLAY";
  if (edge === 0) return "NO PLAY";

  const absEdge = Math.abs(edge);

  if (absEdge < 0.5) return "NO PLAY";

  let pointThreshold = getLeagueEdgePointThreshold(league, marketKey);
  const _underEdgeFactor = isFinite(context?.underEdgeFactorOverride)
    ? Number(context.underEdgeFactorOverride)
    : (getParam("underEdgeFactor", league) ?? UNDER_EDGE_FACTOR);

  if (edge < 0) pointThreshold *= _underEdgeFactor;

  // blowoutGap: computed by the caller (all FT/team_a/team_b/H1/H2/Q1-Q4
  // call sites now pass it) and, when it exceeds h2hBlowoutGapThreshold,
  // raises the required edge before a pick is issued, since blowout scoring
  // is noisier. If a caller omits it, this is a no-op (unchanged behavior).
  // NOTE: context.aSc/bSc/teamSc/aScScores/bScScores remain unused — no
  // defensible derivation from raw team scores alone was identified; flagging
  // rather than guessing at one.
  if (isFinite(context?.blowoutGap)) {
    const _blowoutGapThresh = getParam("h2hBlowoutGapThreshold", league) ?? 15;
    const _blowoutPickMult = getParam("pickBlowoutThresholdMult", league) ?? 1.15;
    if (context.blowoutGap > _blowoutGapThresh) pointThreshold *= _blowoutPickMult;
  }

  if (absEdge < pointThreshold) return "NO PLAY";

  return edge > 0 ? "OVER " + displayLine(line) : "UNDER " + displayLine(line);
}

// C2: true trap needs open→current line move against the side.
// Without movement, only a vol-risk caution (moderate edge + elevated vol).
// Boolean kept for confidence coefficients; use detectTrapMeta for labels.
function rememberMarketLine(league, marketType, line) {
  try {
    if (!isFinite(line) || line <= 0) return null;
    // C2 fix: key by the specific game, not just league+market. The old key
    // ("league|marketType") merged every simultaneous game in the same
    // league/market into one shared "opening line", so line-move detection
    // was comparing unrelated games against each other. eventId comes from
    // the same fixture resolver the rest of the engine already relies on.
    const eventId =
      (typeof getCurrentFixtureMeta === "function" ? getCurrentFixtureMeta()?.eventId || "" : "") ||
      "unmatched";
    const key =
      String(eventId) +
      "|" +
      String(league || "unk").toLowerCase() +
      "|" +
      String(marketType || "ft").toLowerCase();
    if (typeof g_engineLineMemory !== "object" || !g_engineLineMemory) g_engineLineMemory = {};
    const prev = g_engineLineMemory[key];
    if (!prev || !isFinite(prev.openLine)) {
      g_engineLineMemory[key] = {
        openLine: Number(line),
        lastLine: Number(line),
        updatedAt: Date.now(),
      };
    } else {
      g_engineLineMemory[key] = {
        openLine: Number(prev.openLine),
        lastLine: Number(line),
        updatedAt: Date.now(),
      };
    }
    // Persist so opening lines survive reloads — previously in-memory only,
    // so every reload reset "open" to whatever line was first seen after the
    // reload and adverse movement could never actually be detected.
    try {
      const entries = Object.entries(g_engineLineMemory);
      if (entries.length > 500) {
        entries.sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0));
        g_engineLineMemory = Object.fromEntries(entries.slice(0, 500));
      }
      localStorage.setItem(ENGINE_LINE_MEMORY_STORAGE, JSON.stringify(g_engineLineMemory));
    } catch (_persistErr) {
      /* non-fatal */
    }
    return g_engineLineMemory[key];
  } catch (_e) {
    return null;
  }
}

function getLineMoveAgainstSide(league, marketType, currentLine, side) {
  const mem = rememberMarketLine(league, marketType, currentLine);
  if (!mem || !isFinite(mem.openLine) || !isFinite(currentLine) || currentLine <= 0) {
    return { available: false, delta: null, adverse: false };
  }
  const delta = Number((currentLine - mem.openLine).toFixed(2));
  if (Math.abs(delta) < 0.25)
    return { available: true, delta: delta, adverse: false, openLine: mem.openLine };
  const s = String(side || "").toLowerCase();
  const adverse = s === "over" ? delta < -0.25 : s === "under" ? delta > 0.25 : false;
  return { available: true, delta: delta, adverse: adverse, openLine: mem.openLine };
}

function detectTrapMeta(edge, line, pick, league, marketType, vol) {
  const empty = { flag: false, kind: "none", label: "" };
  if (!pick || pick === "NO PLAY" || !isFinite(edge) || !isFinite(line) || line <= 0) return empty;
  const edgePct = Math.abs(edge / line);
  const volLimit = getMarketVolLimit(league, marketType) || 12;
  const volRatio = isFinite(vol) && volLimit > 0 ? vol / volLimit : 0;
  const _trapVolThresh = getParam("trapVolRatioThreshold", league) ?? 1.15;
  const _trapEdgeMin = getParam("trapEdgePctMin", league) ?? 0.02;
  const _trapEdgeMax = getParam("trapEdgePctMax", league) ?? 0.06;
  const volRisk = volRatio >= _trapVolThresh && edgePct > _trapEdgeMin && edgePct < _trapEdgeMax;
  const side = typeof getPickSideFromText === "function" ? getPickSideFromText(pick) : "";
  const move = getLineMoveAgainstSide(league, marketType, line, side);
  if (move.available && move.adverse) {
    return {
      flag: true,
      kind: "line_trap",
      label:
        "Line moved against this side (open " +
        move.openLine +
        " → now " +
        Number(line).toFixed(1) +
        ", Δ " +
        (move.delta > 0 ? "+" : "") +
        move.delta +
        ")",
    };
  }
  if (volRisk) {
    return {
      flag: true,
      kind: "vol_risk",
      label:
        "Vol-risk caution only (moderate edge + elevated volatility) — not a confirmed market trap",
    };
  }
  return empty;
}

function detectTrap(edge, line, pick, league, marketType, vol) {
  const meta = detectTrapMeta(edge, line, pick, league, marketType, vol);
  try {
    window.__lastTrapMeta = meta;
  } catch (_e) {}
  return !!meta.flag;
}

function selectLock(markets) {
  // GLOBAL LOCK CHAMPIONSHIP — only the candidates in the current output table
  // compete.  One table/run = one World Cup = exactly one champion.
  //
  // Modeled as a literal knockout bracket: every valid candidate takes a turn
  // challenging the reigning champion using playMatch() below. The champion
  // has to beat every single challenger, one match at a time, all the way
  // through to the final — exactly like a real World Cup run. The rules for
  // who wins a given head-to-head never change; only how we apply them does.
  const candidates = Array.isArray(markets) ? markets : [];

  function getLockWinProbability(m) {
    const direct = Number(m?.winProbability);
    if (isFinite(direct)) return direct;

    // Defensive fallback: reconstruct the same calibrated probability used by
    // the confidence layer when the value was not copied onto the selector row.
    const marginMarket = isFinite(m?.marginEdgePct);
    const edgePct = marginMarket
      ? Number(m.marginEdgePct)
      : Number(m?.line) > 0 && isFinite(Number(m?.edge))
        ? Math.abs(Number(m.edge) / Number(m.line))
        : NaN;
    if (!isFinite(edgePct)) return NaN;

    const volLimit = Number(m?.volLimit);
    const volatility = Number(m?.volatility);
    const volRatio =
      isFinite(volatility) && isFinite(volLimit) && volLimit > 0 ? volatility / volLimit : 0.5;

    const league = m?.league || "";
    let _reconstructed = getConfidenceWinProbability(
      m?.confidenceGrade || m?.confidence || null,
      edgePct,
      volRatio,
      m?.sampleTier || "thin",
      !!m?.hasH2H,
      !!m?.trap,
      league,
      m?.newSignals || m?.confidenceSignals || {},
    );

    // FIX: same distribution-primary blend as getConfidenceGrade/getConfidenceWinProbability
    // call sites elsewhere. Without this, the fallback returns NaN whenever the
    // logistic model is unfitted, and every candidate becomes ineligible.
    try {
      const _fallbackVolLimit = isFinite(volLimit) ? volLimit : 12;
      const _fallbackEdgePts = marginMarket
        ? isFinite(m?.marginEdgePts)
          ? Number(m.marginEdgePts)
          : isFinite(Number(m?.edge))
            ? Number(m.edge)
            : NaN
        : isFinite(Number(m?.edge))
          ? Number(m.edge)
          : NaN;
      const _fallbackDistProb = distributionWinProbability(
        _fallbackEdgePts,
        _fallbackVolLimit,
        volRatio,
      );
      if (Number.isFinite(_fallbackDistProb)) {
        _reconstructed = Number.isFinite(_reconstructed)
          ? clampNumber(0.7 * _fallbackDistProb + 0.3 * _reconstructed, 0.02, 0.98)
          : _fallbackDistProb;
      }
    } catch (_fallbackBlendErr) {
      engineDebug("selectLock fallback distribution blend failed", {
        error: _fallbackBlendErr?.message || String(_fallbackBlendErr),
      });
    }

    return Number(_reconstructed);
  }

  const valid = candidates.filter(
    (m) =>
      m &&
      m.pick !== "NO PLAY" &&
      m.pick !== "—" &&
      isFinite(Number(m.edge)) &&
      (Number(m.line) > 0 || isFinite(Number(m.marginEdgePct))) &&
      !m.lockRestricted &&
      isFinite(getLockWinProbability(m)),
  );

  if (!valid.length) return -1;
  if (valid.length === 1) return candidates.findIndex((m) => m === valid[0]);

  // Head-to-head match: given the reigning champion and the next challenger,
  // decide who advances. Same criteria/order as before, just applied one
  // match at a time instead of buried inside a single global sort.
  function playMatch(champion, challenger) {
    const champProb = getLockWinProbability(champion);
    const challProb = getLockWinProbability(challenger);

    // MATCH RULE #1: highest calibrated prediction probability wins.
    // This is deliberately above grade/edge so a lower-probability team
    // cannot automatically beat a materially stronger opponent.
    if (Math.abs(challProb - champProb) > 0.000001) {
      return challProb > champProb ? challenger : champion;
    }

    const champGrade = getConfidenceRank(champion.confidenceGrade || champion.confidence || "");
    const challGrade = getConfidenceRank(challenger.confidenceGrade || challenger.confidence || "");
    if (challGrade !== champGrade) return challGrade > champGrade ? challenger : champion;

    const champEdgePct = isFinite(Number(champion.marginEdgePct))
      ? Number(champion.marginEdgePct) * 100
      : Number(champion.line) > 0
        ? Math.abs(Number(champion.edge) / Number(champion.line)) * 100
        : 0;
    const challEdgePct = isFinite(Number(challenger.marginEdgePct))
      ? Number(challenger.marginEdgePct) * 100
      : Number(challenger.line) > 0
        ? Math.abs(Number(challenger.edge) / Number(challenger.line)) * 100
        : 0;
    if (Math.abs(challEdgePct - champEdgePct) > 0.0001) {
      return challEdgePct > champEdgePct ? challenger : champion;
    }

    // Championship tie-breakers only. These do not override probability.
    if (!!challenger.fullModel !== !!champion.fullModel)
      return challenger.fullModel ? challenger : champion;
    if (!!challenger.hasH2H !== !!champion.hasH2H) return challenger.hasH2H ? challenger : champion;

    const champVolRatio =
      isFinite(Number(champion.volatility)) &&
      isFinite(Number(champion.volLimit)) &&
      Number(champion.volLimit) > 0
        ? Number(champion.volatility) / Number(champion.volLimit)
        : Infinity;
    const challVolRatio =
      isFinite(Number(challenger.volatility)) &&
      isFinite(Number(challenger.volLimit)) &&
      Number(challenger.volLimit) > 0
        ? Number(challenger.volatility) / Number(challenger.volLimit)
        : Infinity;
    if (Math.abs(champVolRatio - challVolRatio) > 0.0001) {
      return challVolRatio < champVolRatio ? challenger : champion;
    }

    const champStrength = isFinite(Number(champion.lockStrength))
      ? Number(champion.lockStrength)
      : 0;
    const challStrength = isFinite(Number(challenger.lockStrength))
      ? Number(challenger.lockStrength)
      : 0;
    if (Math.abs(challStrength - champStrength) > 0.0001) {
      return challStrength > champStrength ? challenger : champion;
    }

    return Math.abs(Number(challenger.edge)) > Math.abs(Number(champion.edge))
      ? challenger
      : champion;
  }

  // Run the actual tournament: the first candidate opens as champion, then
  // every remaining candidate steps up as a challenger. Only one team is
  // left standing after the last match — that's the lock.
  const champion = valid.reduce((reigningChampion, challenger) =>
    playMatch(reigningChampion, challenger),
  );

  return candidates.findIndex((m) => m === champion);
}

function computeMarginProjection(teamAProj, teamBProj) {
  if (!isFinite(teamAProj) || !isFinite(teamBProj)) return NaN;
  return teamAProj - teamBProj;
}

function computeCombinedMarginVolatility(stdDevA, stdDevB) {
  const a = isFinite(stdDevA) ? stdDevA : 0;
  const b = isFinite(stdDevB) ? stdDevB : 0;
  return Math.sqrt(a * a + b * b);
}

function getMarginPick(edge, league, marketKey) {
  // FIX (HIGH #6): Number.isFinite rejects Infinity/-Infinity/NaN; isNaN alone let Infinity through.
  if (!Number.isFinite(edge)) return "NO PLAY";
  if (edge === 0) return "NO PLAY";

  const absEdge = Math.abs(edge);
  if (absEdge < 0.5) return "NO PLAY";

  const pointThreshold = getLeagueEdgePointThreshold(league, marketKey);

  if (absEdge < pointThreshold) return "NO PLAY";

  return edge > 0 ? "HOME" : "AWAY";
}

function getMarginConfidenceInputs(edge, referenceScale, combinedStdDev, marginVolLimit) {
  const safeScale = isFinite(referenceScale) && referenceScale > 0 ? referenceScale : NaN;
  const marginEdgePct = isFinite(edge) && isFinite(safeScale) ? Math.abs(edge) / safeScale : NaN;
  const safeLimit = isFinite(marginVolLimit) && marginVolLimit > 0 ? marginVolLimit : NaN;
  const marginVolRatio =
    isFinite(combinedStdDev) && isFinite(safeLimit) ? combinedStdDev / safeLimit : NaN;
  return { marginEdgePct, marginVolRatio };
}

function detectMarginTrap(edge, referenceScale, league, marketKey, combinedStdDev, marginVolLimit) {
  // FIX (HIGH #6): reject non-finite edge outright, not just NaN.
  if (!Number.isFinite(edge) || edge === 0) return false;
  const inputs = getMarginConfidenceInputs(edge, referenceScale, combinedStdDev, marginVolLimit);
  if (!isFinite(inputs.marginEdgePct) || !isFinite(inputs.marginVolRatio)) return false;

  return (
    inputs.marginVolRatio >= 1.15 && inputs.marginEdgePct > 0.02 && inputs.marginEdgePct < 0.06
  );
}

function computeLineupQuality(roster, injuryMeta) {
  let score = 1.0;
  const injImpact = isFinite(Number(injuryMeta?.scoringMult))
    ? 1 - Number(injuryMeta.scoringMult)
    : 0;
  score -= Math.min(0.25, injImpact);
  if (Array.isArray(roster) && roster.length) {
    const withPM = roster.filter(
      (p) => p?.plusMinus !== null && p?.plusMinus !== undefined && isFinite(Number(p.plusMinus)),
    );
    if (withPM.length) {
      const avgPM = withPM.reduce((s, p) => s + Number(p.plusMinus), 0) / withPM.length;
      const rosterFactor = clampNumber((avgPM + 5) / 10, 0.5, 1.0);
      score *= rosterFactor;
    }
  }
  return Math.max(0.3, Math.min(1.0, score));
}

// Real predictive distribution, run in parallel with the logistic model
// below for comparison/monitoring. sd is expressed in real point units
// (leagueVolLimit scaled by how volatile this matchup's series are), not
// the old 0-2.5 dimensionless ratio. Standard normal CDF via Abramowitz &
// Stegun 26.2.17 (accurate to ~7.5e-8, no external dependency).
function _normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}
function distributionWinProbability(meanEdge, leagueVolLimit, volRatio) {
  if (!isFinite(meanEdge) || !isFinite(leagueVolLimit) || leagueVolLimit <= 0) return null;
  const sd = leagueVolLimit * Math.max(0.5, isFinite(volRatio) ? volRatio : 1.0);
  if (!isFinite(sd) || sd <= 0) return null;
  // Side-agnostic win probability for the already-selected side.
  // Call sites pass edge = proj - line. After getPick, OVER has edge > 0 and
  // UNDER has edge < 0, so |edge| is the favorable distance from the line.
  // P(selected side wins) = Phi(|meanEdge| / sd), clamped.
  const z = Math.abs(meanEdge) / sd;
  return clampNumber(_normalCdf(z), 0.02, 0.98);
}

// Shared feature dictionary for train (calibrateConfidenceModel) and serve (live logistic).
// One path: edgePct is absolute fraction (e.g. 0.08 for 8%), already NOT percent.
// Pivot 0.060 is the sole edge centering; no second 0.055 abs boost.
const CONFIDENCE_EDGE_PIVOT = 0.06;
function buildConfidenceFeatures(pickOrArgs) {
  const p = pickOrArgs || {};
  // Live path passes plain args; fit path passes tracked pick objects.
  const edgePctRaw =
    p.edgePct != null && p.edgePct !== ""
      ? Number(p.edgePct)
      : p.godsEyeMemory && p.godsEyeMemory.edgePct != null
        ? Number(p.godsEyeMemory.edgePct)
        : NaN;
  // Tracked picks often store edgePct as percent (e.g. 8.0); live uses fraction (0.08).
  // Normalize: values > 1 treated as percent.
  let edgeFrac = edgePctRaw;
  if (Number.isFinite(edgeFrac) && Math.abs(edgeFrac) > 1) edgeFrac = edgeFrac / 100;
  if (!Number.isFinite(edgeFrac)) edgeFrac = 0;

  const league = p.league || "";
  const marketKey = String(p.marketKey || p.marketName || "ft").toLowerCase();
  const volBase =
    typeof getMarketVolLimit === "function"
      ? getMarketVolLimit(league, marketKey) ||
        (typeof getLeagueVolLimit === "function" ? getLeagueVolLimit(league) : 12) ||
        12
      : 12;

  let volRatioFeat;
  if (p.volatilityRatio != null && Number.isFinite(Number(p.volatilityRatio))) {
    volRatioFeat = Number(p.volatilityRatio) - 1.0;
  } else {
    const aVol = Number(p.godsEyeMemory?.aVol ?? p.aVol ?? 0);
    const bVol = Number(p.godsEyeMemory?.bVol ?? p.bVol ?? 0);
    const avgVol =
      Number.isFinite(aVol) || Number.isFinite(bVol)
        ? ((Number.isFinite(aVol) ? aVol : 0) + (Number.isFinite(bVol) ? bVol : 0)) / 2
        : volBase;
    volRatioFeat = avgVol / (volBase || 12) - 1.0;
  }

  const sampleTier = String(p.sampleTier || p.godsEyeMemory?.sampleTier || "").toLowerCase();
  const hasH2H = !!(p.hasH2H ?? p.godsEyeMemory?.hasH2H);
  const trap = !!(p.trap ?? p.godsEyeMemory?.trap);

  return {
    edgePct: clampNumber(edgeFrac - CONFIDENCE_EDGE_PIVOT, -0.06, 0.15),
    volRatio: clampNumber(volRatioFeat, -1, 2.5),
    sampleFull: sampleTier === "full" ? 1 : 0,
    h2h: hasH2H ? 1 : 0,
    trap: trap ? 1 : 0,
  };
}

function getConfidenceWinProbability(
  grade,
  edgePct,
  volatilityRatio,
  sampleTier,
  hasH2H,
  trap,
  league,
  newSignals = {},
) {
  let coeff = {};
  let _resolvedScope = "global";
  try {
    const stored = localStorage.getItem("BB_CONFIDENCE_MODEL_COEFF");
    if (stored) {
      const models = JSON.parse(stored);
      // FIX: version-lock — if artifact carries modelVersion and it disagrees with
      // current engine model version, ignore coeffs (fail closed to unfitted).
      try {
        const _mv = models.modelVersion || models._modelVersion;
        const _cur = typeof getCurrentModelVersion === "function" ? getCurrentModelVersion() : null;
        if (_mv && _cur && String(_mv) !== String(_cur)) {
          coeff = {};
          _resolvedScope = "version_mismatch";
        }
      } catch (_ve) {}
      const leagueGroup =
        league === "nba" ? "nba" : league === "ncaa" || league === "ncaaw" ? "ncaa" : "other";

      const tierKey = "tier_" + getLeagueTrustMeta(league).level;
      if (_resolvedScope !== "version_mismatch" && models[league]) {
        coeff = models[league];
        _resolvedScope = league;
      } else if (_resolvedScope !== "version_mismatch" && models[leagueGroup]) {
        coeff = models[leagueGroup];
        _resolvedScope = leagueGroup;
      } else if (models[tierKey]) {
        coeff = models[tierKey];
        _resolvedScope = tierKey;
      } else {
        coeff = models["global"] || {};
        _resolvedScope = "global";
      }
    }
  } catch (e) {
    if (typeof engineDebug === "function")
      engineDebug("Confidence coefficient load failed", { error: e?.message || String(e), league });
  }

  const _requiredCoeffKeys = ["intercept", "edgePct", "volRatio", "sampleFull", "h2h", "trap"];
  const _coeffFitted = !!(coeff && _requiredCoeffKeys.every((k) => Number.isFinite(coeff[k])));
  if (!_coeffFitted) {
    return null;
  }
  // Require enough fit sample before trusting logistic coeffs.
  let _coeffN = 0;
  try {
    const nMap = JSON.parse(localStorage.getItem("BB_CONFIDENCE_MODEL_COEFF_N") || "{}");
    _coeffN = Number(nMap[_resolvedScope] || nMap.global || 0);
  } catch (_e) {
    _coeffN = 0;
  }
  const _minCoeffN = 40;
  if (!(_coeffN >= _minCoeffN)) {
    return null; // distribution-primary until calibration sample is large enough
  }

  // NEW/UNCALIBRATED (added [today's date], not part of any backtest/fit):
  // these five terms were previously computed at every call site and silently
  // dropped before reaching this function. They are wired in below as fixed
  // placeholder log-odds contributions, same override pattern as the fitted
  // terms above (coeff.xxx ?? default), but intentionally excluded from
  // _requiredCoeffKeys so they don't affect the fitted/unfitted gate and
  // don't invalidate any coefficient set already sitting in
  // BB_CONFIDENCE_MODEL_COEFF. If the fitting pipeline is ever extended to
  // learn these, populating coeff.lineupQuality/paceGapRisk/blowoutRisk/
  // siblingAgree/defensiveFloor will override the placeholders automatically.
  //   lineupQuality: 0.3-1.0 roster/injury quality score, 1.0 = full strength.
  //     Deviation below 1.0 reduces confidence (more missing/degraded signal
  //     in the projection inputs, not a directional bias toward either side).
  //   paceGapRisk: true when the two teams' pace differs by >6 poss/game.
  //     Larger unmodeled variance in the total -> reduces confidence.
  //   blowoutRisk: derived from blowoutGap vs the existing h2hBlowoutGapThreshold
  //     param (same threshold already used to discount H2H weight). Large
  //     projected margin -> garbage-time scoring noise -> reduces confidence.
  //   siblingAgree: does a related market's edge (siblingEdge for Q1-Q4,
  //     q4Edge for FT, q2Edge for H1) point the same direction as this pick?
  //     Agreement is a mild corroborating signal; disagreement is a caution.
  //     null/unavailable = no contribution.
  //   defensiveFloor: true when a defensiveFloorFlag was computed for this
  //     market. Placeholder assumes a stout scoring floor is mildly
  //     confidence-negative for OVER picks and neutral/positive for UNDER —
  //     this directional assumption has NOT been validated and is the
  //     single most likely one of these five to need revisiting.
  const _blowoutGapThresh = getParam("h2hBlowoutGapThreshold", league) ?? 15;
  const _blowoutRiskFlag =
    isFinite(newSignals.blowoutGap) && newSignals.blowoutGap > _blowoutGapThresh;
  const _lineupQualityVal = isFinite(newSignals.lineupQuality) ? newSignals.lineupQuality : 1.0;
  const _childEdge = isFinite(newSignals.siblingEdge)
    ? newSignals.siblingEdge
    : isFinite(newSignals.q4Edge)
      ? newSignals.q4Edge
      : isFinite(newSignals.q2Edge)
        ? newSignals.q2Edge
        : null;
  const _siblingAgree =
    _childEdge !== null && isFinite(newSignals.pickEdge) && newSignals.pickEdge !== 0
      ? Math.sign(_childEdge) === Math.sign(newSignals.pickEdge)
        ? 1
        : -1
      : 0;
  const _defFloorSideMult =
    newSignals.pickSide === "under" ? 1 : newSignals.pickSide === "over" ? -1 : 0;

  // Q-SPREAD: same signed +1/-1/0 shape as _siblingAgree above, sourced from
  // getQuarterFormAgreement's SUPPORT/CONTRA/NEUTRAL label instead of another
  // market's edge. Only ever non-null for q1-q4 — quarterFormAgreement is not
  // computed for ft/h1/h2/team markets, so this term is inert (0) there.
  const _quarterFormAgree =
    newSignals.quarterFormAgreement && newSignals.quarterFormAgreement.reliable
      ? newSignals.quarterFormAgreement.label === "SUPPORT"
        ? 1
        : newSignals.quarterFormAgreement.label === "CONTRA"
          ? -1
          : 0
      : 0;

  // Feature parity with calibrateConfidenceModel via buildConfidenceFeatures.
  // Single edge definition (pivot 0.060). Double-boost (0.055 abs) removed.
  const _feat = buildConfidenceFeatures({
    edgePct: edgePct,
    volatilityRatio: volatilityRatio,
    sampleTier: sampleTier,
    hasH2H: hasH2H,
    trap: trap,
    league: league,
  });
  // FIX (HIGH): these six terms are deliberately excluded from
  // _requiredCoeffKeys and were never fit against real outcomes -- they
  // previously carried nonzero guessed defaults (0.6, -0.15, -0.2, 0.15,
  // 0.1, 0.12) that silently shifted every win probability and confidence
  // grade the engine produced, with no validation behind the values or
  // even the direction of defensiveFloor (see comment above). Defaulted to
  // 0 (no effect) until the fitting pipeline is extended to learn real
  // values for these keys -- the override mechanism is unchanged, so
  // populating coeff.lineupQuality/paceGapRisk/blowoutRisk/siblingAgree/
  // defensiveFloor/quarterFormAgree via BB_CONFIDENCE_MODEL_COEFF will
  // still activate them automatically once genuinely calibrated.
  // FIX: unfitted defaults must not look institutional. Near-zero slopes so
  // distribution CDF / explicit fitted coeffs dominate; no fake A/B from defaults.
  const _unfitted = !(coeff && (coeff.edgePct != null || coeff._fitted === true));
  const logOdds =
    (coeff.intercept ?? (_unfitted ? 0 : -0.2)) +
    (coeff.edgePct ?? (_unfitted ? 0 : 0.5)) * _feat.edgePct +
    (coeff.volRatio ?? (_unfitted ? 0 : -0.3)) * _feat.volRatio +
    (coeff.sampleFull ?? (_unfitted ? 0 : 0.2)) * _feat.sampleFull +
    (coeff.h2h ?? (_unfitted ? 0 : 0.1)) * _feat.h2h +
    (coeff.trap ?? -0.5) * _feat.trap +
    (coeff.lineupQuality ?? 0) * (_lineupQualityVal - 1.0) +
    (coeff.paceGapRisk ?? 0) * (newSignals.paceGapRisk ? 1 : 0) +
    (coeff.blowoutRisk ?? 0) * (_blowoutRiskFlag ? 1 : 0) +
    (coeff.siblingAgree ?? 0) * _siblingAgree +
    (coeff.defensiveFloor ?? 0) * (newSignals.defensiveFloorFlag ? _defFloorSideMult : 0) +
    (coeff.quarterFormAgree ?? 0) * _quarterFormAgree;

  let _calibratedLogOdds = Math.min(10, Math.max(-10, logOdds));
  try {
    const plattStored = localStorage.getItem("BB_PLATT_CALIB");
    if (plattStored) {
      const platt = JSON.parse(plattStored)[_resolvedScope];
      if (platt && isFinite(platt.a) && isFinite(platt.b)) {
        _calibratedLogOdds = platt.a * _calibratedLogOdds + platt.b;
      }
    }
  } catch (e) {
    if (typeof engineDebug === "function")
      engineDebug("Platt calibration load failed", {
        error: e?.message || String(e),
        league: _resolvedScope,
      });
  }

  return Number(
    clampNumber(
      1 / (1 + Math.exp(-Math.min(10, Math.max(-10, _calibratedLogOdds)))),
      0.02,
      0.98,
    ).toFixed(3),
  );
}

function isConfidenceCoeffFitted(league) {
  try {
    const stored = localStorage.getItem("BB_CONFIDENCE_MODEL_COEFF");
    if (!stored) return false;
    const models = JSON.parse(stored);
    const leagueGroup =
      league === "nba" ? "nba" : league === "ncaa" || league === "ncaaw" ? "ncaa" : "other";
    const tierKey = "tier_" + getLeagueTrustMeta(league).level;
    let _resolvedScope = "global";
    let coeff;
    if (models[league]) {
      coeff = models[league];
      _resolvedScope = league;
    } else if (models[leagueGroup]) {
      coeff = models[leagueGroup];
      _resolvedScope = leagueGroup;
    } else if (models[tierKey]) {
      coeff = models[tierKey];
      _resolvedScope = tierKey;
    } else {
      coeff = models["global"];
      _resolvedScope = "global";
    }
    const _requiredCoeffKeys = ["intercept", "edgePct", "volRatio", "sampleFull", "h2h", "trap"];
    const _keysFitted = !!(coeff && _requiredCoeffKeys.every((k) => Number.isFinite(coeff[k])));
    if (!_keysFitted) return false;
    // FIX: previously this omitted the sample-size floor that
    // getConfidenceWinProbability enforces (N>=40), so the A-grade cap could
    // lift ("fitted") while the probability call still returned null for the
    // same scope. Both checks must now agree on what "fitted" means.
    let _coeffN = 0;
    try {
      const nMap = JSON.parse(localStorage.getItem("BB_CONFIDENCE_MODEL_COEFF_N") || "{}");
      _coeffN = Number(nMap[_resolvedScope] || nMap.global || 0);
    } catch (_e) {
      _coeffN = 0;
    }
    return _coeffN >= 40;
  } catch (e) {
    engineDebug("isConfidenceCoeffFitted failed", { league, error: e?.message || String(e) });
    return false;
  }
}

function getMarketECE(league, marketKey) {
  try {
    const raw = localStorage.getItem("BB_MARKET_ECE");
    if (!raw) return null;
    const map = JSON.parse(raw);
    const lk = String(league || "").toLowerCase();
    const mk = String(marketKey || "ft").toLowerCase();
    const entry = map[lk + ":" + mk] || map[mk] || map[lk] || null;
    if (entry && Number.isFinite(Number(entry.ece)))
      return { ece: Number(entry.ece), n: Number(entry.n) || 0 };
  } catch (e) {
    /* ignore */
  }
  return null;
}

function resolveConfidenceGradeFromWinProbability(winProb, league = "", marketKey = "") {
  // Number.isFinite: isFinite(null)===true would map unfitted null → grade D
  // Also reject out-of-range probabilities (e.g. -0.3 or 1.7) — never fabricate A–D from invalid input
  if (!Number.isFinite(winProb) || winProb < 0 || winProb > 1) return "NaN";
  let learnedThresholds = null;
  try {
    const storedThresholds = localStorage.getItem("BB_CONFIDENCE_THRESHOLDS");
    if (storedThresholds) learnedThresholds = JSON.parse(storedThresholds);
  } catch (e) {
    if (typeof engineDebug === "function")
      engineDebug("Confidence threshold load failed", { error: e?.message || String(e), league });
  }
  const threshA = getParam("confidenceAThresh", league) ?? learnedThresholds?.aThresh ?? 0.66;
  const threshB = getParam("confidenceBThresh", league) ?? learnedThresholds?.bThresh ?? 0.58;
  const threshC = getParam("confidenceCThresh", league) ?? learnedThresholds?.cThresh ?? 0.51;
  // D13: when market ECE is poor and sample is meaningful, soft-cap grade (never invent a grade from null).
  let gradeCap = null; // null = no cap; "B" = max B; "C" = max C
  const eceInfo = getMarketECE(league, marketKey);
  if (eceInfo && eceInfo.n >= 30) {
    if (eceInfo.ece > 0.12) gradeCap = "C";
    else if (eceInfo.ece > 0.08) gradeCap = "B";
  }
  const applyCap = (g) => {
    if (!gradeCap) return g;
    const order = { A: 3, B: 2, C: 1, D: 0, NaN: -1 };
    const capRank = order[gradeCap] ?? 3;
    return (order[g] ?? 0) > capRank ? gradeCap : g;
  };
  // FIX Issue 9/43: Grade A/B requires the STRICT fitted definition (six finite
  // coeffs + N>=40), not mere presence of edgePct on a leftover blob.
  let _hasFittedCoeff = false;
  try {
    if (typeof isConfidenceCoeffFitted === "function") {
      _hasFittedCoeff = !!isConfidenceCoeffFitted(league);
    }
  } catch (_e) { _hasFittedCoeff = false; }
  if (winProb >= threshA) return applyCap(_hasFittedCoeff ? "A" : "C");
  if (winProb >= threshB) return applyCap(_hasFittedCoeff ? "B" : "C");
  if (winProb >= threshC) return applyCap("C");
  return "D";
}
