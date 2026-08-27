
function safeParseDate(val) {
  if (!val) return 0;
  let ms = Date.parse(String(val));
  if (Number.isFinite(ms) && ms > 0) return ms;
  ms = Date.parse(String(val).replace(/-/g, "/").replace("T", " "));
  if (Number.isFinite(ms) && ms > 0) return ms;
  return 0;
}

function makeTrackedSignature(pick) {
  const _lineSegment =
    isFinite(Number(pick.line)) && Number(pick.line) > 0
      ? displayLine(pick.line)
      : pick.pickId || pick.side || "noline";
  return [
    pick.eventId || "",
    pick.eventDate || "",
    pick.league || "",
    normalizeTeamName(pick.homeTeam || ""),
    normalizeTeamName(pick.awayTeam || ""),
    pick.marketKey || "",
    _lineSegment,
    pick.side || "",
  ].join("|");
}

function getTrackedPickTimeMs(pick) {
  if (!pick) return 0;

  const candidates = [pick.eventDate, pick.createdAt, pick.settledAt];

  for (const raw of candidates) {
    if (!raw) continue;
    const ms = safeParseDate(raw);
    if (ms > 0) return ms;
  }

  return 0;
}

function isTrackedPickVisibleOnPage(pick) {
  if (!pick) return false;
  const status = String(pick.resultStatus || "pending").toLowerCase();
  const now = Date.now();

  const gameTs =
    safeParseDate(pick.eventDate) || safeParseDate(pick.createdAt) || safeParseDate(pick.settledAt);
  if (!gameTs) return false;

  if ((now - gameTs) / (1000 * 60 * 60 * 24) > 7) return false;

  if (status === "pending") {
    return (now - gameTs) / (1000 * 60 * 60) < 48;
  } else {
    return (now - gameTs) / (1000 * 60 * 60) < 13;
  }
}

function getCurrentFixtureMeta() {
  const fixtureSelect = document.getElementById("fixtureSelect");
  const selectedOpt =
    fixtureSelect && fixtureSelect.selectedIndex >= 0
      ? fixtureSelect.options[fixtureSelect.selectedIndex]
      : null;

  const allOpts = fixtureSelect ? [...fixtureSelect.options].filter((o) => o && o.value) : [];

  const teamAName = document.getElementById("teamAName")?.value.trim() || "";
  const teamBName = document.getElementById("teamBName")?.value.trim() || "";
  const normA = normalizeTeamName(teamAName);
  const normB = normalizeTeamName(teamBName);

  const matchedOpt = (() => {
    if (selectedOpt && selectedOpt.value) {
      const optHome = selectedOpt.dataset.home || "";
      const optAway = selectedOpt.dataset.away || "";

      const sameByIds =
        String(selectedOpt.dataset.homeId || "") !== "" &&
        String(selectedOpt.dataset.awayId || "") !== "" &&
        String(selectedOpt.dataset.homeId || "") === String(selectedTeamIds.A || "") &&
        String(selectedOpt.dataset.awayId || "") === String(selectedTeamIds.B || "");

      const sameByNames =
        normalizeTeamName(optHome) === normA && normalizeTeamName(optAway) === normB;

      if (sameByIds || sameByNames) return selectedOpt;
    }

    return (
      allOpts.find(
        (opt) =>
          normalizeTeamName(opt.dataset.home || "") === normA &&
          normalizeTeamName(opt.dataset.away || "") === normB,
      ) || null
    );
  })();

  const autoFetchMeta =
    !matchedOpt &&
    window.__autoFetchEventMeta &&
    String(selectedTeamIds.A || "") &&
    String(selectedTeamIds.B || "")
      ? window.__autoFetchEventMeta
      : null;

  // FIX: warn if schedule has the same matchup with home/away reversed vs typed names.
  let homeAwayReversedWarning = false;
  try {
    const reversedOpt = allOpts.find(
      (opt) =>
        normalizeTeamName(opt.dataset.home || "") === normB &&
        normalizeTeamName(opt.dataset.away || "") === normA,
    );
    if (reversedOpt && !matchedOpt) homeAwayReversedWarning = true;
  } catch (_r) {}
  if (homeAwayReversedWarning && typeof engineDebug === "function") {
    engineDebug("HOME/AWAY REVERSED WARNING: typed Team A/B appear swapped vs schedule", {
      teamAName,
      teamBName,
    });
  }
  return {
    eventId: matchedOpt
      ? matchedOpt.value || ""
      : autoFetchMeta?.eventId ||
        (normA || normB
          ? `manual-${normA}-vs-${normB}-${new Date().toISOString().slice(0, 10)}`
          : ""),
    eventDate: matchedOpt ? matchedOpt.dataset.eventDate || "" : autoFetchMeta?.eventDate || "",
    homeTeam: matchedOpt ? matchedOpt.dataset.home || teamAName : teamAName,
    awayTeam: matchedOpt ? matchedOpt.dataset.away || teamBName : teamBName,
    homeId: matchedOpt
      ? matchedOpt.dataset.homeId || String(selectedTeamIds.A || "")
      : String(selectedTeamIds.A || ""),
    awayId: matchedOpt
      ? matchedOpt.dataset.awayId || String(selectedTeamIds.B || "")
      : String(selectedTeamIds.B || ""),
    homeAwayReversedWarning: !!homeAwayReversedWarning,
  };
}

let g_trackerScrollLockY = 0;

function lockPageBehindTracker() {
  g_trackerScrollLockY = window.scrollY || window.pageYOffset || 0;
  document.body.classList.add("tracker-open");
  document.body.style.top = `-${g_trackerScrollLockY}px`;
}

function unlockPageBehindTracker() {
  const y = g_trackerScrollLockY || 0;
  document.body.classList.remove("tracker-open");
  document.body.style.top = "";
  window.scrollTo(0, y);
}

async function openTrackerModal() {
  const modal = document.getElementById("trackerModal");
  if (!modal) return;
  g_trackerModalView = "picks";
  window.__trackerRenderLimit = 50;
  lockPageBehindTracker();
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
  updateTrackerInsightsButton();
  syncTrackerModalView();
  await primeTrackerStateForRun();
  refreshTrackerInBackground(false);
  scheduleLiveClockPoll();
  startLiveClockTicker();
}

function closeTrackerModal() {
  const modal = document.getElementById("trackerModal");
  if (!modal) return;
  g_trackerModalView = "picks";
  clearTrackerFollowupRefresh();
  clearTimeout(_liveClockPollTimer);
  _liveClockPollTimer = null;
  stopLiveClockTicker();
  g_liveGameStatus.clear();
  modal.classList.remove("open");
  syncTrackerModalView();
  modal.setAttribute("aria-hidden", "true");
  unlockPageBehindTracker();
}

function renderTrackedPicks() {
  const summaryEl = document.getElementById("trackerSummary");
  const marketSummaryEl = document.getElementById("trackerMarketSummary");
  const emptyEl = document.getElementById("trackerEmpty");
  const wrapEl = document.getElementById("trackedPicksWrap");
  const bodyEl = document.getElementById("trackedPicksBody");

  if (!summaryEl || !marketSummaryEl || !emptyEl || !wrapEl || !bodyEl) return;

  const active = Array.isArray(AppState.tracker.state.activePicks)
    ? AppState.tracker.state.activePicks
    : [];
  const archived = Array.isArray(AppState.tracker.state.archivedPicks)
    ? AppState.tracker.state.archivedPicks
    : [];

  const allPicks = [...active];

  const uniquePicksMap = new Map();
  allPicks.forEach((p) => {
    const sig = makeTrackedSignature(p);
    if (
      !uniquePicksMap.has(sig) ||
      getTrackedPickTimeMs(p) > getTrackedPickTimeMs(uniquePicksMap.get(sig))
    ) {
      uniquePicksMap.set(sig, p);
    }
  });

  const visiblePicks = Array.from(uniquePicksMap.values()).filter(isTrackedPickVisibleOnPage);

  window.__trackerRenderLimit = window.__trackerRenderLimit || 50;
  const displayPicks = visiblePicks
    .sort((a, b) => {
      const aPending = String(a.resultStatus || "pending").toLowerCase() === "pending";
      const bPending = String(b.resultStatus || "pending").toLowerCase() === "pending";

      if (aPending && !bPending) return -1;
      if (!aPending && bPending) return 1;

      if (aPending) {
        const aCreated = Date.parse(a.createdAt) || 0;
        const bCreated = Date.parse(b.createdAt) || 0;
        if (aCreated !== bCreated) return bCreated - aCreated;
      } else {
        const aTime = getTrackedPickTimeMs(a);
        const bTime = getTrackedPickTimeMs(b);
        if (Math.abs(aTime - bTime) > 1000) return bTime - aTime;
      }

      const aGame = String(a.eventId || a.homeTeam || "");
      const bGame = String(b.eventId || b.homeTeam || "");
      if (aGame < bGame) return -1;
      if (aGame > bGame) return 1;

      const mktOrderMap = {
        ft: 1,
        h1: 2,
        q1: 3,
        q2: 4,
        q3: 5,
        q4: 6,
        q1_team_a: 7,
        q1_team_b: 8,
        h1_team_a: 9,
        h1_team_b: 10,
        team_a: 11,
        team_b: 12,
      };
      return (mktOrderMap[a.marketKey] || 99) - (mktOrderMap[b.marketKey] || 99);
    })
    .slice(0, window.__trackerRenderLimit);

  rebuildTrackerStats();
  renderTrackerAnalytics();
  renderTrackerDebugPanel();

  const stats = g_trackerState.stats || { total: 0, settled: 0, wins: 0, losses: 0, pushes: 0 };
  const pendingCount = active.filter(
    (p) => String(p?.resultStatus || "pending").toLowerCase() === "pending",
  ).length;

  const _divergenceSuffix =
    isFinite(stats.engineDivergenceRate) && stats.settled >= 10
      ? ` • ${stats.engineDivergenceRate}% engine/settled divergence (${stats.engineDivergenceCount})`
      : "";

  summaryEl.innerHTML = `${displayPicks.length} live/recent • ${pendingCount} pending • ${stats.wins} wins • ${stats.losses} losses${_divergenceSuffix}`;

  // Q-SPREAD: directional-only reference, never feeds a pick decision.
  // Gated at 20+ combined SUPPORT/CONTRA decisions so an empty or tiny
  // sample doesn't render a misleading number.
  try {
    const _qfStats = getQuarterFormBacktestStats();
    const _s = _qfStats.overall.SUPPORT,
      _c = _qfStats.overall.CONTRA;
    if (_s.n + _c.n >= 20) {
      const _qfLine = document.createElement("div");
      _qfLine.style.fontSize = "11px";
      _qfLine.style.opacity = "0.75";
      _qfLine.style.marginTop = "2px";
      _qfLine.textContent = `Quarter-form (settled Q1-Q4): SUPPORT ${_s.winRatePct ?? "—"}% (n=${_s.n}) vs CONTRA ${_c.winRatePct ?? "—"}% (n=${_c.n}) — directional only.`;
      summaryEl.appendChild(_qfLine);
    }
  } catch (_qfErr) {
    engineDebug("quarter-form backtest summary failed", { error: _qfErr?.message || String(_qfErr) });
  }

  // Market chip row removed (match football tracker — no Q2/Q4/Winner chips)
  marketSummaryEl.innerHTML = "";
  marketSummaryEl.style.display = "none";

  if (!displayPicks.length) {
    emptyEl.style.display = isTrackerPicksView() ? "block" : "none";
    emptyEl.textContent = "No live/recent picks. Older picks moved to record.";
    wrapEl.style.display = isTrackerPicksView() ? "none" : "block";
    bodyEl.innerHTML = "";
    return;
  }

  emptyEl.style.display = "none";
  wrapEl.style.display = "block";

  requestAnimationFrame(() => {
    bodyEl.innerHTML = displayPicks
      .map((p) => {
        const status = String(p.resultStatus || "pending").toLowerCase();
        const _liveInfo =
          status === "pending" && p.eventId ? g_liveGameStatus.get(p.eventId) : null;
        const statusClass =
          status === "win"
            ? "track-win"
            : status === "loss"
              ? "track-loss"
              : status === "push"
                ? "track-push"
                : _liveInfo
                  ? "pred-noplay"
                  : "track-pending";
        const edgeText =
          p.edgePct == null || isNaN(p.edgePct)
            ? "—"
            : (p.edgePct > 0 ? "+" : "") + Number(p.edgePct).toFixed(2) + "%";

        const grade = String(p.confidenceGrade || p.confidence || "—").toUpperCase();
        const gradeClass = getConfidenceClass(grade);
        const encSig = encodeURIComponent(p.signature);

        let statusHtml = "";
        if (status === "pending") {
          const pId = ((p.eventId || "") + p.signature).replace(/[^a-z0-9]/gi, "");
          const gameTs = safeParseDate(p.eventDate || p.createdAt);
          const isZombie = gameTs > 0 && Date.now() - gameTs > 36 * 60 * 60 * 1000;
          const _liveClockLabel = _liveInfo
            ? _liveInfo.clock === "HALF"
              ? "HALF"
              : (() => {
                  const _regP = LEAGUE_FETCH_RULES[_liveInfo.league || ""]?.regulationPeriods ?? 4;
                  const _p = Number(_liveInfo.period || 0);
                  if (_p === 0) return "LIVE";
                  const _pLabel =
                    _p <= _regP ? `Q${_p}` : _p - _regP === 1 ? "OT" : `OT${_p - _regP}`;
                  return `${_pLabel} ${_liveInfo.clock}`;
                })()
            : null;
          const _pendingLabel = isZombie ? "STALE" : _liveClockLabel ? "" : "PENDING";
          const _liveScoreStr =
            _liveInfo &&
            Number.isFinite(_liveInfo.homeScore) &&
            Number.isFinite(_liveInfo.awayScore)
              ? `${Math.round(_liveInfo.homeScore)} : ${Math.round(_liveInfo.awayScore)}`
              : "";
          const _liveBlock = _liveClockLabel
            ? (() => {
                const _regP2 = LEAGUE_FETCH_RULES[_liveInfo.league || ""]?.regulationPeriods ?? 4;
                const _curP2 = Number(_liveInfo.period || 0);
                const _qH2 = _liveInfo.qScores?.home || [];
                const _qA2 = _liveInfo.qScores?.away || [];
                const _maxQ2 = Math.min(_curP2, _regP2, 4);
                const _clockOnly =
                  _liveClockLabel === "HALF"
                    ? "HALF"
                    : _liveClockLabel.replace(/^(Q\d+|OT\d*)\s+/i, "");
                const safeClock = escapeHtml(_clockOnly);
                const _hasLiveScore =
                  Number.isFinite(_liveInfo.homeScore) && Number.isFinite(_liveInfo.awayScore);
                const homeTotal = _hasLiveScore ? Math.round(_liveInfo.homeScore) : null;
                const awayTotal = _hasLiveScore ? Math.round(_liveInfo.awayScore) : null;
                let _qRowsHtml = "";
                for (let _qi = 0; _qi < _maxQ2; _qi++) {
                  const _qHv = Number(_qH2[_qi]);
                  const _qAv = Number(_qA2[_qi]);
                  if (isFinite(_qHv) && isFinite(_qAv) && (_qHv > 0 || _qAv > 0)) {
                    _qRowsHtml += `<div style="font-size:7px;font-weight:900;line-height:1.25;color:var(--text);white-space:nowrap;letter-spacing:0;">Q${_qi + 1}<span style="display:inline-block;min-width:13px;text-align:right;">${Math.round(_qHv)}</span>:<span style="display:inline-block;min-width:13px;">${Math.round(_qAv)}</span></div>`;
                  }
                }
                return `<div style="color:var(--muted);font-size:8px;font-weight:900;line-height:1.0;letter-spacing:0.3px;margin-bottom:1px;">LIVE</div><div style="font-size:12px;font-weight:900;line-height:1.2;margin-bottom:2px;color:var(--tracker-strong);">${_hasLiveScore ? homeTotal + " : " + awayTotal : ""}</div><div style="font-size:6px;font-weight:800;line-height:1.1;margin-bottom:1px;color:var(--muted);white-space:nowrap;"><span style="font-size:5px;">⏰</span><span data-live-clk="${escapeHtml(p.eventId)}"> ${safeClock}</span></div>${_qRowsHtml}`;
              })()
            : "";
          statusHtml = `
        <div class="tracker-disp-toggle" data-pid="${pId}" style="font-weight:900; font-size:10px; cursor:pointer; text-decoration:underline dotted #ccc; ${isZombie ? "color:#ff9800;" : ""}" title="${isZombie ? "Game stale - manual check needed" : _liveClockLabel ? "Live game — click to settle" : "Click to settle"}">${_liveBlock}${_pendingLabel}</div>
        <div id="act-${pId}" style="display:none; flex-direction:column; align-items:center; gap:2px; margin-top:-2px;">
          <div style="font-size:8px; font-weight:900; opacity:0.6; margin-bottom:1px; color:var(--text);">SETTLE</div>
          <button class="tracker-manual-btn tracker-settle-btn" data-manual-settle="win" data-sig="${encSig}" style="padding:0 !important; width:28px !important; min-width:28px !important; height:16px !important; min-height:16px !important; font-size:9px !important; line-height:16px !important;">W</button>
          <button class="tracker-manual-btn tracker-settle-btn" data-manual-settle="loss" data-sig="${encSig}" style="padding:0 !important; width:28px !important; min-width:28px !important; height:16px !important; min-height:16px !important; font-size:9px !important; line-height:16px !important;">L</button>
          <button class="tracker-manual-btn tracker-settle-btn" data-manual-settle="push" data-sig="${encSig}" style="padding:0 !important; width:28px !important; min-width:28px !important; height:16px !important; min-height:16px !important; font-size:9px !important; line-height:16px !important;">P</button>
          <div class="tracker-custom-settle-btn" data-sig="${encSig}" style="font-size:8px; text-decoration:underline; cursor:pointer; margin-top:2px; font-weight:800; opacity:0.7;">CUSTOM</div>
        </div>`;
        } else {
          const encSig = encodeURIComponent(p.signature);
          statusHtml = `<div class="tracker-settled-edit-btn" data-sig="${encSig}" style="cursor:pointer;" title="Click to edit or revert">${status.toUpperCase()}</div>`;
          if (p.actualScore) {
            statusHtml += `<div class="tracker-status-score" style="font-size:9px; font-weight:800; line-height:1.15; margin-top:2px; color:inherit; opacity:0.95;">${safeText(String(p.actualScore))}</div>`;
          }
          if (p.engineResultStatus && p.engineResultStatus !== status) {
            statusHtml += `<div style="font-size:9px; color:#d91f26; margin-top:2px; font-weight:900;" title="The live in-game calculation disagreed with the final settled result">⚠ MID: ${p.engineResultStatus.toUpperCase()}</div>`;
          }
        }

        return `
      <tr>
        <td>${safeText(formatTrackedDate(p.eventDate || p.createdAt))}</td>
        <td style="font-weight:800; text-transform:uppercase; font-size:10px;">${safeText(String(p.league || "—").toUpperCase())}</td>
        <td style="font-weight:900; text-transform:uppercase;">${safeText((p.homeTeam && p.homeTeam !== "—" ? p.homeTeam : "A") + " vs " + (p.awayTeam && p.awayTeam !== "—" ? p.awayTeam : "B"))}</td>
        <td style="font-weight:800;">${safeText(
          String(p.marketName || "—")
            .split("<")[0]
            .trim(),
        )}</td>
        <td>${safeText(formatPickLine(p))}</td>
        <td style="white-space: nowrap; font-size: 11px;"><span class="tracker-delete-pick-btn" data-sig="${encSig}" style="cursor:pointer;" title="Click to permanently delete this pick">${safeText(p.predictionText || "—")}</span>${p.isLock ? ' <span class="lock">🔒</span>' : ""}</td>
        <td class="conf-none">${safeText(grade)}</td>
        <td class="${statusClass}"><div class="tracker-status-stack">${statusHtml}</div></td>
      </tr>
    `;
      })
      .join("");

    if (visiblePicks.length > window.__trackerRenderLimit) {
      bodyEl.innerHTML += `
      <tr>
        <td colspan="8" style="padding:10px; text-align:center;">
          <button onclick="window.__trackerRenderLimit += 50; renderTrackedPicks();" style="background:#3a404c; color:#fff; border:none; padding:8px 16px; font-weight:bold; cursor:pointer;">Load More</button>
        </td>
      </tr>
    `;
    }
  });
}

let g_lastRenderedTrackerVersion = null;
let g_lastRenderedTrackerView = null;

function getEngineHealthSnapshot() {
  const league = document.getElementById("leagueSelect")?.value || "";
  const modelHealth = league ? checkModelHealth(league) : null;

  let calibration = null;
  try {
    calibration = JSON.parse(localStorage.getItem("BB_CALIBRATION_METRICS") || "null");
  } catch (e) {
    engineDebug(
      "getEngineHealthSnapshot failed to read calibration metrics: " + (e?.message || String(e)),
      { error: e },
    );
  }

  const recentDebugLines = (g_engineDebugLog || []).slice(0, 100);
  const errorCount = recentDebugLines.filter((line) => getDebugSeverity(line) === "error").length;
  const warnCount = recentDebugLines.filter((line) => getDebugSeverity(line) === "warn").length;

  let storageBytes = 0;
  try {
    Object.keys(localStorage).forEach((k) => {
      storageBytes += k.length + (localStorage.getItem(k) || "").length;
    });
  } catch (e) {
    engineDebug("getEngineHealthSnapshot failed to measure storage: " + (e?.message || String(e)), {
      error: e,
    });
  }

  const active = Array.isArray(g_trackerState?.activePicks) ? g_trackerState.activePicks.length : 0;
  const archived = Array.isArray(g_trackerState?.archivedPicks)
    ? g_trackerState.archivedPicks.length
    : 0;
  const settled = Number(g_trackerState?.stats?.settled || 0);
  const wins = Number(g_trackerState?.stats?.wins || 0);
  const losses = Number(g_trackerState?.stats?.losses || 0);

  let lastRetrain = null;
  try {
    lastRetrain = JSON.parse(localStorage.getItem("BB_RETRAIN_CHECKPOINT") || "null");
  } catch (e) {
    engineDebug(
      "getEngineHealthSnapshot failed to read retrain checkpoint: " + (e?.message || String(e)),
      { error: e },
    );
  }

  return {
    league,
    modelHealth,
    calibration,
    errorCount,
    warnCount,
    saveFailureCount: AppState.ui.saveFailureCount || 0,
    storageBytes,
    activeCount: active,
    archivedCount: archived,
    settled,
    wins,
    losses,
    lastRetrain,
  };
}

function renderHealthDashboardPanel() {
  const panel = document.getElementById("trackerAnalyticsPanel");
  if (!panel) return;

  syncTrackerModalView();
  panel.classList.remove("tracker-hidden");
  panel.style.display = "block";

  const snap = getEngineHealthSnapshot();
  const formatPctLocal = (v) => (isFinite(v) ? `${(v * 100).toFixed(1)}%` : "—");
  const kb = (snap.storageBytes / 1024).toFixed(1);

  let overallStatus = "unknown";
  let overallGood = false;
  if (snap.modelHealth) {
    overallStatus = snap.modelHealth.status;
    overallGood = overallStatus !== "degrading";
  } else if (snap.errorCount > 0) {
    overallStatus = "errors detected";
    overallGood = false;
  } else {
    overallStatus = "nominal";
    overallGood = true;
  }

  const html = `
    <div class="tracker-analytics-shell">
      <div class="tracker-analytics-topbar">
        <div class="tracker-analytics-heading">
          <div class="tracker-analytics-kicker">Engine Health</div>
          <div class="tracker-analytics-title">Check Engine Light</div>
          <div class="tracker-analytics-subtitle">Live diagnostics for the current league and overall tracker state. This is a system-status view, not a prediction-quality guarantee — pair it with the Engine Report.</div>
        </div>
      </div>

      <div class="tracker-summary-strip">
        <div class="tracker-summary-cell ${overallGood ? "primary" : ""}">
          <div class="tracker-summary-label">Overall Status</div>
          <div class="tracker-summary-value">${safeText(String(overallStatus).toUpperCase())}</div>
          <div class="tracker-summary-sub">${snap.league ? safeText(snap.league.toUpperCase()) : "No league selected"}</div>
        </div>
        <div class="tracker-summary-cell">
          <div class="tracker-summary-label">Recent Errors</div>
          <div class="tracker-summary-value">${snap.errorCount}</div>
          <div class="tracker-summary-sub">${snap.warnCount} warnings (last 100 log lines)</div>
        </div>
        <div class="tracker-summary-cell">
          <div class="tracker-summary-label">Storage Used</div>
          <div class="tracker-summary-value">${kb} KB</div>
          <div class="tracker-summary-sub">localStorage footprint</div>
        </div>
        <div class="tracker-summary-cell">
          <div class="tracker-summary-label">Save Failures</div>
          <div class="tracker-summary-value">${snap.saveFailureCount}</div>
          <div class="tracker-summary-sub">Consecutive tracker save errors</div>
        </div>
      </div>

      <div class="tracker-analytics-section">
        <div class="tracker-analytics-section-head">
          <div class="tracker-analytics-section-title">Recent Win Rate Drift</div>
          <div class="tracker-analytics-section-meta">${snap.league ? safeText(snap.league.toUpperCase()) : "—"}</div>
        </div>
        <div class="tracker-analytics-section-body">
          ${
            snap.modelHealth
              ? `
            <div class="tracker-mini-stat-grid">
              <div class="tracker-mini-stat">
                <div class="name">All-Time Win Rate</div>
                <div class="value">${formatPctLocal(snap.modelHealth.allWinRate)}</div>
                <div class="sub">${snap.modelHealth.n} settled picks</div>
              </div>
              <div class="tracker-mini-stat">
                <div class="name">Last 10 Win Rate</div>
                <div class="value">${formatPctLocal(snap.modelHealth.recentWinRate)}</div>
                <div class="sub">Drift: ${snap.modelHealth.drift >= 0 ? "+" : ""}${(snap.modelHealth.drift * 100).toFixed(1)} pts</div>
              </div>
            </div>
          `
              : `<div class="tracker-empty-note">Select a league with 10+ settled picks to see drift status.</div>`
          }
        </div>
      </div>

      <div class="tracker-analytics-section">
        <div class="tracker-analytics-section-head">
          <div class="tracker-analytics-section-title">Calibration Status</div>
          <div class="tracker-analytics-section-meta">${snap.calibration ? safeText(new Date(snap.calibration.ts).toLocaleDateString()) : "Not yet available"}</div>
        </div>
        <div class="tracker-analytics-section-body">
          ${
            snap.calibration
              ? `
            <div class="tracker-mini-stat-grid">
              <div class="tracker-mini-stat">
                <div class="name">Brier Score</div>
                <div class="value">${Number(snap.calibration.brierScore).toFixed(4)}</div>
                <div class="sub">Lower is better (0 = perfect)</div>
              </div>
              <div class="tracker-mini-stat">
                <div class="name">Calibration Error (ECE)</div>
                <div class="value">${Number(snap.calibration.ece).toFixed(4)}</div>
                <div class="sub">Based on ${snap.calibration.n} recent picks</div>
              </div>
            </div>
          `
              : `<div class="tracker-empty-note">Needs 20+ settled picks with recorded win probabilities before calibration metrics appear.</div>`
          }
        </div>
      </div>

      <div class="tracker-analytics-section">
        <div class="tracker-analytics-section-head">
          <div class="tracker-analytics-section-title">Tracker Volume</div>
          <div class="tracker-analytics-section-meta">All leagues combined</div>
        </div>
        <div class="tracker-analytics-section-body">
          <div class="tracker-mini-stat-grid">
            <div class="tracker-mini-stat">
              <div class="name">Active Picks</div>
              <div class="value">${snap.activeCount}</div>
              <div class="sub">${snap.archivedCount} archived</div>
            </div>
            <div class="tracker-mini-stat">
              <div class="name">Settled</div>
              <div class="value">${snap.settled}</div>
              <div class="sub">${snap.wins}W / ${snap.losses}L</div>
            </div>
          </div>
        </div>
      </div>

      <div class="tracker-analytics-section">
        <div class="tracker-analytics-section-head">
          <div class="tracker-analytics-section-title">Last Retraining Pass</div>
          <div class="tracker-analytics-section-meta">${snap.lastRetrain ? safeText(new Date(snap.lastRetrain.ts).toLocaleString()) : "Never run"}</div>
        </div>
        <div class="tracker-analytics-section-body">
          ${snap.lastRetrain ? `<div class="tracker-empty-note">Ran after ${snap.lastRetrain.settledCount} total settled picks. Fires automatically every 25 new settled picks.</div>` : `<div class="tracker-empty-note">Retraining pipeline has not run yet — needs 25+ settled picks.</div>`}
        </div>
      </div>
    </div>
  `;

  panel.innerHTML = html;
  updateTrackerInsightsButton();
}

function renderConfigsPanel() {
  const panel = document.getElementById("trackerAnalyticsPanel");
  if (!panel) return;

  syncTrackerModalView();
  panel.classList.remove("tracker-hidden");
  panel.style.display = "block";

  const candidateMap = {};
  const verifiedMap = {};

  try {
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith("BB_CANDIDATE_SCORES_")) {
        const meta = k.slice("BB_CANDIDATE_SCORES_".length);
        try {
          const scores = JSON.parse(localStorage.getItem(k) || "{}");
          let best = null;
          Object.entries(scores).forEach(([ck, data]) => {
            if (!best || data.netDelta > best.netDelta) {
              best = { configKey: ck, netDelta: data.netDelta, count: data.count || 0 };
            }
          });
          if (best) candidateMap[meta] = best;
        } catch (e) {
          engineDebug(
            "renderConfigsPanel candidate JSON.parse error: " +
              (localStorage.getItem(k) || "").slice(0, 100),
            { key: k, error: e },
          );
        }
      }
      if (k.startsWith("BB_VERIFIED_CONFIG_")) {
        const meta = k.slice("BB_VERIFIED_CONFIG_".length);
        try {
          const data = JSON.parse(localStorage.getItem(k) || "{}");
          if (data && data.verified) verifiedMap[meta] = data;
        } catch (e) {
          engineDebug(
            "renderConfigsPanel verified JSON.parse error: " +
              (localStorage.getItem(k) || "").slice(0, 100),
            { key: k, error: e },
          );
        }
      }
    });
  } catch (e) {
    engineDebug(
      "renderConfigsPanel failed to enumerate localStorage keys: " + (e?.message || String(e)),
      { error: e },
    );
  }

  function describeConfig(ck) {
    if (!ck) return "—";
    const parts = [];
    ck.split("_").forEach((seg) => {
      if (seg.startsWith("h2h")) parts.push("H2H " + seg.slice(3) + "×");
      else if (seg.startsWith("rec")) parts.push("Recency:" + seg.slice(3));
      else if (seg.startsWith("pace")) parts.push("Pace " + seg.slice(4));
      else if (seg.startsWith("edge")) parts.push("Edge " + seg.slice(4) + "×");
      else if (seg.startsWith("inj")) parts.push("Inj " + seg.slice(3) + "×");
    });
    return parts.join(" · ") || ck;
  }

  const settledPicks = getAllTrackedPicksForReport()
    .filter((p) => p.resultStatus === "win" || p.resultStatus === "loss")
    .sort((a, b) => getTrackedPickTimeMs(b) - getTrackedPickTimeMs(a));

  const totalCombos =
    TUNING_GRID.h2hFactors.length *
    TUNING_GRID.recencyProfiles.length *
    TUNING_GRID.paceDampenings.length *
    TUNING_GRID.edgeMults.length *
    TUNING_GRID.injuryMults.length;

  const verifiedList = Object.entries(verifiedMap);
  const hasCandidates = Object.keys(candidateMap).length > 0;

  let html = `
    <div class="tracker-analytics-shell">
      <div class="tracker-analytics-topbar">
        <div class="tracker-analytics-heading" style="flex:1;">
          <div class="tracker-analytics-kicker">Configuration Lab</div>
          <div class="tracker-analytics-title">Pick-by-Pick Config Replay</div>
          <div class="tracker-analytics-subtitle">
            The engine silently tests ${totalCombos} parameter combos on every settled pick in
            the background. The best config locks in after 25+ settled picks per market and
            immediately improves future predictions.
          </div>
        </div>
      </div>
  `;

  if (verifiedList.length) {
    html += `
      <div class="tracker-analytics-card">
        <div class="tracker-analytics-card-head">
          <div class="tracker-analytics-card-title">✅ Locked & Active Configs</div>
          <div class="tracker-analytics-card-meta">${verifiedList.length} verified</div>
        </div>
        <div class="tracker-analytics-card-body">
          <div class="tracker-insight-list">
    `;
    verifiedList.forEach(([meta, data]) => {
      const deltaStr = isFinite(data.netDelta)
        ? (data.netDelta > 0 ? "+" : "") + data.netDelta
        : "—";
      html += `
        <div class="tracker-insight-item">
          <div class="tracker-insight-dot"></div>
          <div>
            <div class="tracker-insight-title">${safeText(meta)}</div>
            <div class="tracker-insight-text">${safeText(describeConfig(data.configKey))}</div>
            <div class="tracker-insight-text" style="color:var(--muted);">
              Net Δ ${safeText(deltaStr)} over ${safeText(String(data.sampleCount || "?"))} picks
              ${data.manualOverride ? " · Manual override" : " · Auto-verified"}
            </div>
          </div>
        </div>
      `;
    });
    html += `</div></div></div>`;
  }

  html += `
    <div class="tracker-analytics-card">
      <div class="tracker-analytics-card-head">
        <div class="tracker-analytics-card-title">🔬 Settled Pick Replay</div>
        <div class="tracker-analytics-card-meta">What the best alt-config would have done</div>
      </div>
      <div class="tracker-analytics-card-body">
  `;

  if (!settledPicks.length) {
    html += `<div class="tracker-empty-note">
      No settled picks yet. Settle picks going forward — the config grid runs automatically
      in the background after each settlement.
    </div>`;
  } else {
    html += `<div class="tracker-review-list">`;

    settledPicks.slice(0, 40).forEach((pick) => {
      const isWin = pick.resultStatus === "win";
      const market = String(pick.marketName || pick.marketKey || "—")
        .split("<")[0]
        .trim();
      const match = `${pick.homeTeam || "A"} vs ${pick.awayTeam || "B"}`;
      const pickTxt = pick.predictionText || "—";
      const line = isFinite(Number(pick.line)) ? pick.line : "—";
      const actual = pick.actualScore != null ? String(pick.actualScore) : "—";
      const metaKey = (pick.league || "") + "_" + (pick.marketKey || "");

      const verified = verifiedMap[metaKey];
      const candidate = candidateMap[metaKey];

      let configNote, dotClass;
      const _bestAlt = verified || (candidate && candidate.netDelta > 0 ? candidate : null);
      if (!isWin && _bestAlt) {
        const _altDelta = isFinite(Number(_bestAlt.netDelta))
          ? (Number(_bestAlt.netDelta) > 0 ? "+" : "") + Number(_bestAlt.netDelta)
          : "?";
        const _altSample = _bestAlt.sampleCount || _bestAlt.count || "?";
        const _altType = verified ? "🔒 Locked config" : "📈 Best candidate";
        configNote = `${_altType}: ${describeConfig(_bestAlt.configKey)} — net Δ${_altDelta} over ${_altSample} picks for ALL ${(pick.league || "?").toUpperCase()} ${(pick.marketKey || "?").toUpperCase()} bets (applies league-wide, not just this game)`;
        dotClass = "warn";
      } else if (verified) {
        configNote = `Using locked config: ${describeConfig(verified.configKey)}`;
        dotClass = "";
      } else if (candidate && candidate.netDelta > 0) {
        const deltaStr = (candidate.netDelta > 0 ? "+" : "") + candidate.netDelta;
        configNote =
          `Best candidate so far: ${describeConfig(candidate.configKey)} ` +
          `(Δ${deltaStr} across ${candidate.count} pick${candidate.count !== 1 ? "s" : ""})`;
        dotClass = "";
      } else if (!isWin && candidate && candidate.netDelta <= 0) {
        configNote = `⚠ LOSS — No alt-config found yet that improves on the default for ${pick.league || "?"} ${pick.marketKey || "?"}. Grid needs 25+ settled picks.`;
        dotClass = "warn";
      } else if (candidate && candidate.netDelta <= 0) {
        configNote = `No winning alt-config found yet for ${pick.league || "?"} ${pick.marketKey || "?"}`;
        dotClass = "warn";
      } else if (!isWin && pick.snapshot) {
        configNote = `⚠ LOSS — Config grid still running for ${pick.league || "?"} ${pick.marketKey || "?"}. Best config will surface after 25 settled picks.`;
        dotClass = "warn";
      } else if (pick.snapshot) {
        configNote =
          `Config grid queued — will surface after 25 settled picks for ` +
          `${pick.league || "?"} ${pick.marketKey || "?"}`;
        dotClass = "neutral";
      } else {
        configNote = `No snapshot captured (pick saved before snapshot tracking was active)`;
        dotClass = "neutral";
      }

      html += `
          <div class="tracker-review-row">
            <div class="tracker-review-top">
              <div class="tracker-review-area" style="font-size:10px;line-height:1.35;">
                ${safeText(match)}
                <br><span style="color:var(--muted);font-weight:700;">
                  ${safeText(market)} · ${safeText(String(pick.league || "").toUpperCase())}
                </span>
              </div>
              <div class="tracker-review-status ${isWin ? "confirmed" : "candidate"}">
                ${isWin ? "WIN" : "LOSS"}
              </div>
            </div>
            <div class="tracker-review-text">
              ${safeText(pickTxt)} @ ${safeText(String(line))} — Final: ${safeText(actual)}
            </div>
            <div style="display:flex; align-items:center; gap:6px; margin-top:4px;">
              ${dotClass ? `<span class="tracker-insight-dot ${dotClass}" style="flex-shrink:0; margin:0; display:inline-block;"></span>` : ""}
              <div class="tracker-review-action" style="flex:1;">
                ${safeText(configNote)}
              </div>
            </div>
          </div>
        `;
    });

    html += `</div>`;
  }

  const selectedLeagueKey = normalizeLeagueTrustKey(
    document.getElementById("leagueSelect")?.value || "unknown",
  );

  const _pendingGlobalProposal = getStoredTunerProposal(null);
  const _pendingLeagueProposal =
    selectedLeagueKey !== "unknown" ? getStoredTunerProposal(selectedLeagueKey) : null;
  const _pendingInjProposal = getStoredConstantProposal("INJURY_OPPONENT_BOOST_FACTOR");
  const _pendingUnderProposal = getStoredConstantProposal("UNDER_EDGE_FACTOR");
  if (
    _pendingGlobalProposal ||
    _pendingLeagueProposal ||
    _pendingInjProposal ||
    _pendingUnderProposal
  ) {
    html += `
      <div class="tracker-analytics-card" style="margin-top:12px; border-color:#4ea9ff;">
        <div class="tracker-analytics-card-head" style="background: linear-gradient(90deg, #1a2f4a 0%, #111 100%);">
          <div class="tracker-analytics-card-title" style="color:#4ea9ff;">🧪 Pending Tuning Suggestions</div>
          <div class="tracker-analytics-card-meta">Awaiting manual review</div>
        </div>
        <div class="tracker-analytics-card-body">
          <div class="tracker-review-list">
    `;
    [
      {
        proposal: _pendingGlobalProposal,
        label: "Global (all leagues)",
        onclick: "applyTunerProposalFromUI('')",
      },
      {
        proposal: _pendingLeagueProposal,
        label: safeText(selectedLeagueKey.toUpperCase()),
        onclick: `applyTunerProposalFromUI('${selectedLeagueKey}')`,
      },
    ].forEach((row) => {
      if (!row.proposal) return;
      html += `
        <div class="tracker-review-row">
          <div class="tracker-review-top">
            <div class="tracker-review-area">${row.label}</div>
            <div class="tracker-review-status candidate">${row.proposal.promotions.length} PARAM(S) PROPOSED</div>
          </div>
          <div class="tracker-review-text">${safeText(row.proposal.promotions.map((p) => `${p.key}: ${p.old}->${p.val} (bootstrap p=${(p.p ?? 1).toFixed(3)})`).join(", "))}</div>
          <div class="tracker-review-action" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span>Proposed ${safeText(new Date(row.proposal.ts).toLocaleString())}</span>
            <button onclick="${row.onclick}" style="background:#3a9c35; color:#fff; border:none; padding:4px 10px; font-weight:800; font-size:10px; cursor:pointer;">✅ Apply</button>
          </div>
        </div>
      `;
    });
    [
      { proposal: _pendingInjProposal, name: "INJURY_OPPONENT_BOOST_FACTOR" },
      { proposal: _pendingUnderProposal, name: "UNDER_EDGE_FACTOR" },
    ].forEach((row) => {
      if (!row.proposal) return;
      html += `
        <div class="tracker-review-row">
          <div class="tracker-review-top">
            <div class="tracker-review-area">${row.name}</div>
            <div class="tracker-review-status candidate">PROPOSED</div>
          </div>
          <div class="tracker-review-text">New value: ${row.proposal.proposedValue} (net Δ${row.proposal.netDelta} over ${row.proposal.sampleCount} picks)</div>
          <div class="tracker-review-action" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
            <span>Proposed ${safeText(new Date(row.proposal.ts).toLocaleString())}</span>
            <button onclick="applyConstantProposalFromUI('${row.name}')" style="background:#3a9c35; color:#fff; border:none; padding:4px 10px; font-weight:800; font-size:10px; cursor:pointer;">✅ Apply</button>
          </div>
        </div>
      `;
    });
    if (selectedLeagueKey !== "unknown") {
      ["BB_VERIFIED_TUNINGS_FT", "BB_VERIFIED_TUNINGS_H1", "BB_VERIFIED_TUNINGS"].forEach(
        (siloKey) => {
          const p2proposal = getStoredPhase2Proposal(siloKey, selectedLeagueKey);
          if (!p2proposal) return;
          html += `
          <div class="tracker-review-row">
            <div class="tracker-review-top">
              <div class="tracker-review-area">${safeText(siloKey)} · ${safeText(selectedLeagueKey.toUpperCase())}</div>
              <div class="tracker-review-status candidate">RECENCY WEIGHTS PROPOSED</div>
            </div>
            <div class="tracker-review-text">Config: ${safeText(p2proposal.config.bestConfig)} · score ${safeText(p2proposal.config.score)} · ${safeText(p2proposal.config.improvement)}</div>
            <div class="tracker-review-action" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
              <span>Proposed ${safeText(new Date(p2proposal.ts).toLocaleString())} · sample ${Number(p2proposal.config.sampleSize || 0)}</span>
              <button onclick="applyPhase2SimulatorProposalFromUI('${siloKey}','${selectedLeagueKey}')" style="background:#3a9c35; color:#fff; border:none; padding:4px 10px; font-weight:800; font-size:10px; cursor:pointer;">✅ Apply</button>
            </div>
          </div>
        `;
        },
      );
    }
    html += `
          </div>
        </div>
      </div>
    `;
  }

  const _pendingConfidenceProposal = getStoredConfidenceModelProposal();
  if (_pendingConfidenceProposal) {
    const _scopeList = _pendingConfidenceProposal.scopes
      .map((s) => `${safeText(s)} (n=${Number(_pendingConfidenceProposal.sampleSizes?.[s] || 0)})`)
      .join(", ");
    html += `
      <div class="tracker-analytics-card" style="margin-top:12px; border-color:#4ea9ff;">
        <div class="tracker-analytics-card-head" style="background: linear-gradient(90deg, #1a2f4a 0%, #111 100%);">
          <div class="tracker-analytics-card-title" style="color:#4ea9ff;">🧠 Pending Confidence Model + Calibration</div>
          <div class="tracker-analytics-card-meta">${_pendingConfidenceProposal.scopes.length} scope(s) proposed</div>
        </div>
        <div class="tracker-analytics-card-body">
          <div class="tracker-review-list">
            <div class="tracker-review-row">
              <div class="tracker-review-top">
                <div class="tracker-review-area">Win-probability model + Platt calibration</div>
                <div class="tracker-review-status candidate">REFIT PROPOSED</div>
              </div>
              <div class="tracker-review-text">Scopes: ${safeText(_scopeList)}</div>
              <div class="tracker-review-action" style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <span>Applies both the shrunk coefficients and their calibration correction together</span>
                <button onclick="applyConfidenceModelProposalFromUI()" style="background:#3a9c35; color:#fff; border:none; padding:4px 10px; font-weight:800; font-size:10px; cursor:pointer;">✅ Apply</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  html += `
    <div class="tracker-analytics-card" style="margin-top:12px; border-color:#2a2a2a;">
      <div class="tracker-analytics-card-head" style="background: linear-gradient(90deg, #333 0%, #111 100%);">
        <div class="tracker-analytics-card-title" style="color:#ffd700;">🔬 Tunable Parameter Registry</div>
        <div class="tracker-analytics-card-meta">Live global & league overrides</div>
      </div>
      <div class="tracker-analytics-card-body">
        <div class="param-registry-list">
  `;

  Object.entries(TUNABLE_PARAM_REGISTRY).forEach(([key, param]) => {
    const globalVal = param.value;
    const leagueOverride =
      selectedLeagueKey !== "unknown"
        ? (g_tunableParamLeagueOverrides?.[selectedLeagueKey]?.[key]?.value ?? "—")
        : "—";
    const range = param.min !== null ? `${param.min} to ${param.max}` : "Vector";

    const leagueVerifiedAt =
      selectedLeagueKey !== "unknown"
        ? g_tunableParamLeagueOverrides?.[selectedLeagueKey]?.[key]?.lastVerifiedAt
        : null;
    const lastChallenged =
      leagueVerifiedAt || param.lastVerifiedAt
        ? new Date(leagueVerifiedAt || param.lastVerifiedAt).toLocaleDateString()
        : "Never";
    const globalDisplay = Array.isArray(globalVal)
      ? "[" + globalVal.slice(0, 3).join(",") + ",...]"
      : String(globalVal);
    const leagueDisplay = Array.isArray(leagueOverride)
      ? "[" + leagueOverride.slice(0, 3).join(",") + ",...]"
      : String(leagueOverride);
    const hasLeagueOverride = leagueOverride !== "—";
    html += `
      <div class="param-registry-card">
        <div class="param-registry-name">${safeText(key)}</div>
        <div class="param-registry-grid">
          <div class="param-registry-stat">
            <strong>Global</strong>
            <span>${safeText(globalDisplay)}</span>
          </div>
          <div class="param-registry-stat">
            <strong>League</strong>
            <span style="${hasLeagueOverride ? "color:#49d45f;font-weight:900;" : ""}">${safeText(leagueDisplay)}</span>
          </div>
          <div class="param-registry-stat">
            <strong>Range</strong>
            <span>${safeText(range)}</span>
          </div>
          <div class="param-registry-stat">
            <strong>Last</strong>
            <span>${safeText(lastChallenged)}</span>
          </div>
        </div>
        <div class="param-registry-desc">${safeText(param.description)}</div>
      </div>
    `;
  });

  html += `
        </div>
      </div>
    </div>
  `;

  let history = [];
  try {
    const rawHist = localStorage.getItem("BB_PROMOTION_HISTORY");
    if (rawHist) history = JSON.parse(rawHist) || [];
  } catch (e) {
    engineDebug("BB_PROMOTION_HISTORY load failed", { error: e?.message || String(e) });
  }

  if (history.length) {
    html += `
      <div class="tracker-analytics-card" style="margin-top:12px;">
        <div class="tracker-analytics-card-head">
          <div class="tracker-analytics-card-title">📜 Auto-Tuner Promotion Log</div>
          <div class="tracker-analytics-card-meta">Last 10 parameter adaptations</div>
        </div>
        <div class="tracker-analytics-card-body">
          <div class="tracker-review-list">
    `;
    history
      .slice(-10)
      .reverse()
      .forEach((evt) => {
        const _evidenceText = isFinite(evt.bootstrapP)
          ? `bootstrap p = ${evt.bootstrapP.toFixed(3)}, 95% CI [${(evt.bootstrapCiLow ?? 0).toFixed(3)}, ${(evt.bootstrapCiHigh ?? 0).toFixed(3)}]`
          : isFinite(evt.zScore)
            ? `z-score = ${evt.zScore.toFixed(2)} (legacy)`
            : "evidence unavailable";
        html += `
        <div class="tracker-review-row" style="font-size:10px;">
          <div class="tracker-review-top">
            <strong style="color:var(--text);">${safeText(evt.paramKey)}</strong>
            <span class="tracker-review-status confirmed" style="font-size:8px; padding:2px 4px;">PROMOTED</span>
          </div>
          <div class="tracker-review-text" style="color:var(--text); margin-top:2px;">
            Value updated from <strong>${evt.oldValue}</strong> to <strong>${evt.newValue}</strong> for <strong>${safeText(String(evt.league || "").toUpperCase())}</strong>.
          </div>
          <div style="font-size:8px; color:var(--muted); margin-top:2px;">
            Evidence: ${safeText(_evidenceText)} (OOS) | Brier improvement | ${new Date(evt.ts).toLocaleString()}
          </div>
        </div>
      `;
      });
    html += `
          </div>
        </div>
      </div>
    `;
  }

  html += `</div>`;
  panel.innerHTML = html;
  updateTrackerInsightsButton();
}

function renderTrackerAnalytics() {
  const panel = document.getElementById("trackerAnalyticsPanel");
  if (!panel) return;

  const currentView = g_trackerModalView;

  if (currentView === "picks") {
    syncTrackerModalView();
    panel.classList.add("tracker-hidden");
    panel.style.display = "none";
    panel.innerHTML = "";
    g_lastRenderedTrackerView = currentView;
    return;
  }

  if (currentView === "configs") {
    renderConfigsPanel();
    syncTrackerModalView();
    panel.classList.remove("tracker-hidden");
    panel.style.display = "block";
    g_lastRenderedTrackerView = currentView;
    return;
  }

  if (currentView === "health") {
    renderHealthDashboardPanel();
    syncTrackerModalView();
    panel.classList.remove("tracker-hidden");
    panel.style.display = "block";
    g_lastRenderedTrackerView = currentView;
    return;
  }

  if (
    g_lastRenderedTrackerVersion === g_trackerState.updatedAt &&
    g_lastRenderedTrackerView === currentView
  ) {
    syncTrackerModalView();
    panel.classList.remove("tracker-hidden");
    panel.style.display = "block";
    return;
  }

  g_lastRenderedTrackerVersion = g_trackerState.updatedAt;
  g_lastRenderedTrackerView = currentView;

  const allReportPicks = getAllTrackedPicksForReport().map((p) => ensureTrackedPickKeys(p));

  const currentVersionSettledPicks = getLearningTrackedPicks()
    .map((p) => ensureTrackedPickKeys(p))
    .filter((p) => ["win", "loss", "push"].includes(String(p.resultStatus || "").toLowerCase()));
  const fallbackSettledPicks = allReportPicks.filter((p) =>
    ["win", "loss", "push"].includes(String(p.resultStatus || "").toLowerCase()),
  );
  const useFallbackReport = !currentVersionSettledPicks.length && fallbackSettledPicks.length > 0;

  const derived = useFallbackReport
    ? buildTrackerDerivedStateFromPicks(allReportPicks)
    : rebuildTrackerDerivedState();
  const learningPicks = useFallbackReport ? fallbackSettledPicks : currentVersionSettledPicks;

  const versionStates = buildTrackerVersionStates();
  const currentVersion = getCurrentModelVersion();
  const priorVersions = Object.keys(versionStates).filter((v) => v !== currentVersion);

  const settled = Number(derived?.settledPicks || 0);
  const trackerMin = Number(
    TRACKER_POLICY?.reviewCheckpointSettled ||
      PHASE2_ACTIVATION_RULES?.trackerFeedback?.minSettled ||
      20,
  );
  const activeCount = Array.isArray(g_trackerState?.activePicks)
    ? g_trackerState.activePicks.length
    : 0;

  function marketLabel(key) {
    const map = {
      ft: "FT Total",
      h1: "1H Total",
      q1: "Q1 Total",
      q2: "Q2 Total",
      q3: "Q3 Total",
      q4: "Q4 Total",
      team_a: "Team A Total",
      team_b: "Team B Total",
    };
    return map[String(key || "")] || String(key || "Other");
  }

  function formatPct(value) {
    return isFinite(value) ? `${Number(value).toFixed(1)}%` : "—";
  }

  function getLeagueActionMeta(trustMeta) {
    const mode = String(trustMeta?.mode || "advisory").toLowerCase();
    if (mode === "full") return { label: "Use", note: "Full plays allowed" };
    if (mode === "block") return { label: "Block", note: "Forced no-play" };
    return { label: "Advisory", note: "Lean only" };
  }

  function buildRecord(items = []) {
    const base = { settled: 0, wins: 0, losses: 0, pushes: 0, winPct: NaN };
    items.forEach((pick) => {
      const status = String(pick?.engineResultStatus || pick?.resultStatus || "").toLowerCase();
      if (!["win", "loss", "push"].includes(status)) return;
      base.settled++;

      if (status === "win") base.wins++;
      else if (status === "loss") base.losses++;
      else if (status === "push") base.pushes++;
    });
    const winEq = base.wins + base.pushes * 0.5;
    base.winPct = base.settled ? (winEq / base.settled) * 100 : NaN;
    return base;
  }

  function buildGroupedRows(
    items = [],
    keyFn = () => "other",
    labelFn = (key) => key,
    minSettled = 1,
  ) {
    const map = new Map();
    items.forEach((item) => {
      const key = String(keyFn(item) || "other");
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    });

    return [...map.entries()]
      .map(([key, bucketItems]) => {
        const rec = buildRecord(bucketItems);
        return { key, label: labelFn(key), ...rec };
      })
      .filter((row) => row.settled >= minSettled);
  }

  function statusFromTeamRow(row) {
    if (!row || Number(row.settled || 0) < 2) return "Building";
    if (Number((row.winPct != null ? row.winPct : row.winRate) || 0) >= 70) return "Strong";
    if (Number((row.winPct != null ? row.winPct : row.winRate) || 0) <= 50) return "Watch";
    return "Steady";
  }

  function getReviewStatusClass(status) {
    const key = String(status || "").toLowerCase();
    if (key.includes("confirmed")) return "confirmed";
    if (key.includes("candidate")) return "candidate";
    return "watching";
  }

  function makeReviewItem(area, decision, status, review, action) {
    return { area, decision, status, review, action };
  }

  const marketRows = buildGroupedRows(
    learningPicks,
    (pick) => pick.marketKey || "other",
    (key) => marketLabel(key),
    1,
  ).sort((a, b) => b.winPct - a.winPct || b.settled - a.settled);
  const leagueRows = buildGroupedRows(
    learningPicks,
    (pick) => pick.league || "unknown",
    (key) => String(key || "unknown").toUpperCase(),
    1,
  )
    .filter((row) => row.key !== "unknown")
    .sort((a, b) => b.winPct - a.winPct || b.settled - a.settled);
  const reportLeagueRows = buildGroupedRows(
    fallbackSettledPicks,
    (pick) => pick.league || "unknown",
    (key) => String(key || "unknown").toUpperCase(),
    1,
  )
    .filter((row) => row.key !== "unknown")
    .sort((a, b) => b.settled - a.settled || b.winPct - a.winPct);
  const confidenceRows = buildGroupedRows(
    learningPicks,
    (pick) => String(pick.confidenceGrade || pick.confidence || "—").toUpperCase() || "—",
    (key) => (key === "—" ? "Unrated" : `Grade ${key}`),
    1,
  ).sort((a, b) => getConfidenceRank(b.key) - getConfidenceRank(a.key) || b.settled - a.settled);
  const edgeRows = buildGroupedRows(
    learningPicks,
    (pick) => pick.edgeBucket || "unknown",
    (key) => getTrackedPickEdgeBucketLabel(key),
    1,
  ).sort(
    (a, b) => getEdgeBucketSortRank(a.key) - getEdgeBucketSortRank(b.key) || b.settled - a.settled,
  );
  const trackerImpactRows = buildGroupedRows(
    learningPicks,
    (pick) => getTrackerImpactKeyFromPickLike(pick),
    (key) => getTrackerImpactLabel(key),
    1,
  ).sort((a, b) => b.settled - a.settled || b.winPct - a.winPct);

  const lineMoveRows = buildGroupedRows(
    learningPicks.filter((pick) => getTrackedPickLineMoveProxy(pick).state !== "unknown"),
    (pick) => getTrackedPickLineMoveProxy(pick).state,
    (key) =>
      key === "favorable"
        ? "Favorable latest-line move"
        : key === "unfavorable"
          ? "Unfavorable latest-line move"
          : "Flat latest-line move",
    1,
  ).sort((a, b) => {
    const rank = { favorable: 0, flat: 1, unfavorable: 2 };
    return (rank[a.key] ?? 9) - (rank[b.key] ?? 9) || b.settled - a.settled;
  });

  const clvPicks = learningPicks.filter(
    (p) => p.closingLine !== null && p.closingLine !== undefined && isFinite(Number(p.closingLine)),
  );
  const clvPositive = clvPicks.filter((p) => isFinite(Number(p.clv)) && Number(p.clv) > 0);
  const clvNeutral = clvPicks.filter((p) => isFinite(Number(p.clv)) && Number(p.clv) === 0);
  const clvNegative = clvPicks.filter((p) => isFinite(Number(p.clv)) && Number(p.clv) < 0);
  const clvPositiveRecord = buildRecord(clvPositive);
  const clvNeutralRecord = buildRecord(clvNeutral);
  const clvNegativeRecord = buildRecord(clvNegative);
  const hasCLVData = clvPicks.length > 0;

  const bestPickShadow = buildBestPickOnlyShadowExperiment(learningPicks);

  const selectedLeagueKey = normalizeLeagueTrustKey(
    document.getElementById("leagueSelect")?.value || "unknown",
  );
  const trackedLeagueKeys = [
    ...new Set(
      allReportPicks
        .map((p) => normalizeLeagueTrustKey(p?.league || "unknown"))
        .filter((key) => key && key !== "unknown"),
    ),
  ];
  const trustLeagueKeys = [
    ...new Set([selectedLeagueKey, ...trackedLeagueKeys].filter((k) => k && k !== "unknown")),
  ];

  const leagueRecordMap = new Map(
    reportLeagueRows.map((row) => [normalizeLeagueTrustKey(row.key), row]),
  );
  const leagueTrustRows = trustLeagueKeys
    .map((key) => {
      const trust = getLeagueTrustMeta(key);
      const record = leagueRecordMap.get(key) || buildRecord([]);
      const action = getLeagueActionMeta(trust);
      return {
        key,
        label: String(key || "unknown").toUpperCase(),
        trust,
        action,
        settled: Number(record.settled || 0),
        wins: Number(record.wins || 0),
        losses: Number(record.losses || 0),
        pushes: Number(record.pushes || 0),
        winPct: isFinite(record.winPct) ? Number(record.winPct) : NaN,
      };
    })
    .sort((a, b) => {
      const trustDiff =
        getLeagueTrustSortRank(a.trust.level) - getLeagueTrustSortRank(b.trust.level);
      if (trustDiff !== 0) return trustDiff;
      const settledDiff = Number(b.settled || 0) - Number(a.settled || 0);
      if (settledDiff !== 0) return settledDiff;
      return String(a.label).localeCompare(String(b.label));
    });

  const teamRows = Object.entries(derived?.teams || {})
    .map(([key, bucket]) => ({ key, ...bucket }))
    .filter((row) => Number(row.settled || 0) >= 1)
    .sort((a, b) => {
      const settledDiff = Number(b.settled || 0) - Number(a.settled || 0);
      if (settledDiff !== 0) return settledDiff;
      return Number(b.winRate || -1) - Number(a.winRate || -1);
    });

  const lockSettled = learningPicks.filter((p) => !!p.isLock);
  const overallRecord = buildRecord(learningPicks);
  const lockRecord = buildRecord(lockSettled);

  const bestMarket = marketRows.find((row) => row.settled >= 2) || null;
  const weakMarket = [...marketRows].reverse().find((row) => row.settled >= 2) || null;
  const bestLeague = leagueRows.find((row) => row.settled >= 2) || null;
  const selectedLeagueTrust = getLeagueTrustMeta(selectedLeagueKey);

  const checkpointStatus = settled >= trackerMin ? "Review ready" : "Building";
  const checkpointLeft = Math.max(0, trackerMin - settled);
  const reviewVersionSub = useFallbackReport
    ? "Fallback: all tracked picks"
    : priorVersions.length
      ? `${priorVersions.length + 1} tracked versions`
      : "Current version only";

  const _oosSelectedLeague = String(
    document.getElementById("leagueSelect")?.value || "",
  ).toLowerCase();
  let _oosStored = null;
  try {
    const _oosStore = JSON.parse(localStorage.getItem("BB_OOS_VALIDATION_RESULTS") || "{}");
    _oosStored = _oosStore[_oosSelectedLeague] || null;
  } catch (e) {
    engineDebug("BB_OOS_VALIDATION_RESULTS load failed", {
      error: e?.message || String(e),
      league: _oosSelectedLeague,
    });
  }

  const reviewRows = [];

  if (selectedLeagueKey !== "unknown") {
    if (selectedLeagueTrust.level === "blocked") {
      reviewRows.push(
        makeReviewItem(
          "League trust",
          "NO PLAY",
          "Candidate review",
          `${String(selectedLeagueKey).toUpperCase()} is currently blocked from full plays.`,
          selectedLeagueTrust.guidance,
        ),
      );
    } else if (selectedLeagueTrust.level === "advisory") {
      reviewRows.push(
        makeReviewItem(
          "League trust",
          "ADVISORY ONLY",
          "Watching",
          `${String(selectedLeagueKey).toUpperCase()} is still in the retune bucket.`,
          selectedLeagueTrust.guidance,
        ),
      );
    } else {
      reviewRows.push(
        makeReviewItem(
          "League trust",
          "TRUSTED",
          "Watching",
          `${String(selectedLeagueKey).toUpperCase()} is allowed for full plays with ongoing review.`,
          selectedLeagueTrust.guidance,
        ),
      );
    }
  }

  if (settled >= trackerMin) {
    if (bestMarket && bestMarket.settled >= 4 && bestMarket.winPct >= 70) {
      reviewRows.push(
        makeReviewItem(
          "Best market",
          "KEEP",
          bestMarket.settled >= 6 ? "Confirmed strength" : "Candidate strength",
          `${bestMarket.label} is leading at ${formatPct(bestMarket.winPct)} with ${bestMarket.wins} wins and ${bestMarket.losses} losses.`,
          "Keep this market logic as it is. Do not weaken it from one bad day.",
        ),
      );
    }
    if (weakMarket && weakMarket.settled >= 4 && weakMarket.winPct <= 45) {
      reviewRows.push(
        makeReviewItem(
          "Weak market",
          "REVIEW",
          weakMarket.settled >= 6 ? "Candidate review" : "Watching",
          `${weakMarket.label} is the weakest market so far at ${formatPct(weakMarket.winPct)} with ${weakMarket.losses} losses.`,
          "Do not edit yet from this checkpoint alone. Keep it on review and only change if it repeats.",
        ),
      );
    }
    if (lockRecord.settled >= 5) {
      let decision = "NO CHANGE";
      let status = "Watching";
      let action =
        "Lock performance is acceptable. Keep monitoring instead of forcing a lock edit now.";
      if (lockRecord.winPct <= 50) {
        decision = "REVIEW";
        status = "Candidate review";
        action = "Lock performance is weak. Watch the next checkpoint before touching lock logic.";
      } else if (lockRecord.winPct >= 65) {
        decision = "KEEP";
        status = "Confirmed strength";
        action =
          "Lock performance is healthy. Keep the current lock behavior unless a later checkpoint says otherwise.";
      }
      reviewRows.push(
        makeReviewItem(
          "Lock icon",
          decision,
          status,
          `Locks are ${lockRecord.wins} wins, ${lockRecord.losses} losses, ${lockRecord.pushes} pushes for ${formatPct(lockRecord.winPct)} win rate.`,
          action,
        ),
      );
    }
    const eligibleTeams = [...teamRows].filter((row) => Number(row.settled || 0) >= 2);
    const weakTeam = [...eligibleTeams].sort(
      (a, b) => Number(a.winRate || 999) - Number(b.winRate || 999),
    )[0];
    const strongTeam = [...eligibleTeams].sort(
      (a, b) => Number(b.winRate || -1) - Number(a.winRate || -1),
    )[0];

    if (strongTeam && Number(strongTeam.winRate || 0) >= 70) {
      reviewRows.push(
        makeReviewItem(
          "Strong team signal",
          "KEEP",
          "Watching",
          `${strongTeam.label || strongTeam.key} is trending strong at ${formatPct(strongTeam.winRate)} across ${Number(strongTeam.settled || 0)} settled picks.`,
          "Treat this as a positive team note. Keep collecting more team-by-team evidence.",
        ),
      );
    }
    if (weakTeam && Number(weakTeam.winRate || 100) <= 45) {
      reviewRows.push(
        makeReviewItem(
          "Weak team signal",
          "WATCH",
          Number(weakTeam.settled || 0) >= 4 ? "Candidate review" : "Watching",
          `${weakTeam.label || weakTeam.key} is underperforming at ${formatPct(weakTeam.winRate)} across ${Number(weakTeam.settled || 0)} settled picks.`,
          "Keep this team on watch. Do not apply a global engine edit from one team alone.",
        ),
      );
    }
    if (bestLeague && bestLeague.settled >= 4) {
      reviewRows.push(
        makeReviewItem(
          "Best league",
          "KEEP",
          "Watching",
          `${bestLeague.label} is the strongest tracked league so far at ${formatPct(bestLeague.winPct)}.`,
          "Use this as context only. Do not add an automatic league boost.",
        ),
      );
    }
  } else {
    reviewRows.push(
      makeReviewItem(
        "Checkpoint",
        "COLLECT MORE",
        "Watching",
        `${settled}/${trackerMin} settled picks collected so far.`,
        `${checkpointLeft} more settled picks are needed before the tracker can give a full review.`,
      ),
    );
  }

  const teamDisplayRows = teamRows.slice(0, 8);
  const marketDisplayRows = marketRows.slice(0, 5);
  const leagueDisplayRows = leagueRows.slice(0, 5);
  const pendingActiveCount = Array.isArray(g_trackerState?.activePicks)
    ? g_trackerState.activePicks.filter(
        (p) => !["win", "loss", "push"].includes(String(p?.resultStatus || "").toLowerCase()),
      ).length
    : 0;

  const importantEngineLines = [];

  const rawImportantEngineLines = getVisibleDebugLines(AppState.debug.engineLog, "engine", 6);
  if (rawImportantEngineLines.length) importantEngineLines.push(...rawImportantEngineLines);

  const importantTrackerLines = [];
  const rawImportantTrackerLines = getVisibleDebugLines(AppState.debug.trackerLog, "tracker", 6);
  rawImportantTrackerLines.forEach((line) => {
    if (!importantTrackerLines.includes(line)) importantTrackerLines.push(line);
  });

  syncTrackerModalView();
  panel.classList.toggle("tracker-hidden", currentView === "picks");
  panel.style.display = currentView === "picks" ? "none" : "block";

  const reportBodyHtml = `
      <div class="tracker-kpi-grid">
        <div class="tracker-kpi-card featured">
          <div class="tracker-kpi-label">Overall</div>
          <div class="tracker-kpi-value">${overallRecord.wins}W</div>
          <div class="tracker-kpi-sub">Losses ${overallRecord.losses} • Pushes ${overallRecord.pushes} • Win rate ${formatPct(overallRecord.winPct)}</div>
        </div>
        <div class="tracker-kpi-card">
          <div class="tracker-kpi-label">Active picks</div>
          <div class="tracker-kpi-value">${activeCount}</div>
          <div class="tracker-kpi-sub">Current model ${safeText(currentVersion)}</div>
        </div>
        <div class="tracker-kpi-card">
          <div class="tracker-kpi-label">Settled picks</div>
          <div class="tracker-kpi-value">${settled}</div>
          <div class="tracker-kpi-sub">Checkpoint target ${trackerMin}</div>
        </div>
        <div class="tracker-kpi-card">
          <div class="tracker-kpi-label">Review status</div>
          <div class="tracker-kpi-value">${safeText(checkpointStatus)}</div>
          <div class="tracker-kpi-sub">${safeText(reviewVersionSub)}</div>
        </div>
      </div>

      <div class="tracker-analytics-card">
        <div class="tracker-analytics-card-head">
          <div class="tracker-analytics-card-title">Out-of-sample validation</div>
          <div class="tracker-analytics-card-meta">${_oosStored ? safeText(new Date(_oosStored.computedAt).toLocaleDateString()) : "Not yet available"}</div>
        </div>
        <div class="tracker-analytics-card-body">
          ${
            _oosStored
              ? `
            <div class="tracker-report-subtitle">Win rate on the most recent 30% of settled picks (held out from the training split), for ${safeText(_oosSelectedLeague.toUpperCase())}. This checks whether the model generalizes to games it wasn't tuned on, not just the picks used to calibrate it.</div>
            <div class="tracker-kpi-grid">
              <div class="tracker-kpi-card">
                <div class="tracker-kpi-label">Test win rate</div>
                <div class="tracker-kpi-value">${formatPct(_oosStored.winRate * 100)}</div>
                <div class="tracker-kpi-sub">${Number(_oosStored.testSize || 0)} held-out picks</div>
              </div>
              <div class="tracker-kpi-card">
                <div class="tracker-kpi-label">Training size</div>
                <div class="tracker-kpi-value">${Number(_oosStored.trainSize || 0)}</div>
                <div class="tracker-kpi-sub">Picks used to build the split</div>
              </div>
            </div>
          `
              : `<div class="tracker-empty-note">No out-of-sample check yet for ${safeText(_oosSelectedLeague || "this league")}. This runs automatically once enough settled picks exist (needs 30+ settled picks with a valid createdAt) and refreshes periodically during the retraining pipeline.</div>`
          }
        </div>
      </div>

      <div class="tracker-analytics-card">
        <div class="tracker-analytics-card-head">
          <div class="tracker-analytics-card-title">Checkpoint review</div>
          <div class="tracker-analytics-card-meta">${safeText(checkpointStatus)}</div>
        </div>
        <div class="tracker-analytics-card-body">
          <div class="tracker-review-list">
            ${reviewRows
              .map(
                (row) => `
              <div class="tracker-review-row">
                <div class="tracker-review-top">
                  <div class="tracker-review-area">${safeText(row.area)}</div>
                  <div class="tracker-review-status ${safeText(getReviewStatusClass(row.status))}">${safeText(row.status)}</div>
                </div>
                <div class="tracker-review-text"><strong>${safeText(row.decision)}</strong> — ${safeText(row.review)}</div>
                <div class="tracker-review-action">${safeText(row.action)}</div>
              </div>
            `,
              )
              .join("")}
          </div>
        </div>
      </div>

      <div class="tracker-analytics-card">
        <div class="tracker-analytics-card-head">
          <div class="tracker-analytics-card-title">Measurement lab</div>
          <div class="tracker-analytics-card-meta">Tracked-pick evidence only</div>
        </div>
        <div class="tracker-analytics-card-body">
          <div class="tracker-report-subtitle">This layer measures what the engine actually saved to tracker. "Latest-line move" is a proxy built from the most recent line the engine has seen for that exact event/market/side. It is useful, but it is not guaranteed closing-line truth.</div>
          <div class="table-wrap tracker-report-table-wrap">
            <table class="tracker-analytics-table">
              <thead>
                <tr>
                  <th>Experiment</th>
                  <th class="num">Games</th>
                  <th class="num">Settled</th>
                  <th class="num">Wins</th>
                  <th class="num">Losses</th>
                  <th class="num">Pushes</th>
                  <th class="rate">Win rate</th>
                  <th class="num">Net wins</th>
                </tr>
              </thead>
              <tbody>
                ${
                  bestPickShadow.rows.length
                    ? bestPickShadow.rows
                        .map(
                          (row) => `
                  <tr>
                    <td>${safeText(row.mode)}</td>
                    <td class="num">${Number(row.gameCount || 0)}</td>
                    <td class="num">${Number(row.settled || 0)}</td>
                    <td class="num">${Number(row.wins || 0)}</td>
                    <td class="num">${Number(row.losses || 0)}</td>
                    <td class="num">${Number(row.pushes || 0)}</td>
                    <td class="rate">${safeText(formatPct(row.winPct))}</td>
                    <td class="num">${isFinite(row.netWins) ? safeText(Number(row.netWins).toFixed(0)) : "—"}</td>
                  </tr>
                `,
                        )
                        .join("")
                    : `<tr><td colspan="8" class="note">Need settled tracked picks before the best-pick-only shadow test can say anything useful.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="tracker-analytics-grid two">
        <div class="tracker-analytics-card">
          <div class="tracker-analytics-card-head">
            <div class="tracker-analytics-card-title">Confidence performance</div>
            <div class="tracker-analytics-card-meta">Do higher grades actually win more?</div>
          </div>
          <div class="tracker-analytics-card-body">
            <div class="table-wrap tracker-report-table-wrap">
              <table class="tracker-analytics-table">
                <thead>
                  <tr>
                    <th>Grade</th>
                    <th class="num">Settled</th>
                    <th class="num">Wins</th>
                    <th class="num">Losses</th>
                    <th class="num">Pushes</th>
                    <th class="rate">Win rate</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    confidenceRows.length
                      ? confidenceRows
                          .map(
                            (row) => `
                    <tr>
                      <td>${safeText(row.label)}</td>
                      <td class="num">${Number(row.settled || 0)}</td>
                      <td class="num">${Number(row.wins || 0)}</td>
                      <td class="num">${Number(row.losses || 0)}</td>
                      <td class="num">${Number(row.pushes || 0)}</td>
                      <td class="rate">${safeText(formatPct(row.winPct))}</td>
                    </tr>
                  `,
                          )
                          .join("")
                      : `<tr><td colspan="6" class="note">No confidence-grade data yet.</td></tr>`
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="tracker-analytics-card">
          <div class="tracker-analytics-card-head">
            <div class="tracker-analytics-card-title">Edge bucket performance</div>
            <div class="tracker-analytics-card-meta">Check whether bigger edges are actually stronger</div>
          </div>
          <div class="tracker-analytics-card-body">
            <div class="table-wrap tracker-report-table-wrap">
              <table class="tracker-analytics-table">
                <thead>
                  <tr>
                    <th>Edge bucket</th>
                    <th class="num">Settled</th>
                    <th class="num">Wins</th>
                    <th class="num">Losses</th>
                    <th class="num">Pushes</th>
                    <th class="rate">Win rate</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    edgeRows.length
                      ? edgeRows
                          .map(
                            (row) => `
                    <tr>
                      <td>${safeText(row.label)}</td>
                      <td class="num">${Number(row.settled || 0)}</td>
                      <td class="num">${Number(row.wins || 0)}</td>
                      <td class="num">${Number(row.losses || 0)}</td>
                      <td class="num">${Number(row.pushes || 0)}</td>
                      <td class="rate">${safeText(formatPct(row.winPct))}</td>
                    </tr>
                  `,
                          )
                          .join("")
                      : `<tr><td colspan="6" class="note">No settled edge-bucket data yet.</td></tr>`
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="tracker-analytics-grid two">
        <div class="tracker-analytics-card">
          <div class="tracker-analytics-card-head">
            <div class="tracker-analytics-card-title">Tracker impact performance</div>
            <div class="tracker-analytics-card-meta">See whether tracker influence is helping</div>
          </div>
          <div class="tracker-analytics-card-body">
            <div class="table-wrap tracker-report-table-wrap">
              <table class="tracker-analytics-table">
                <thead>
                  <tr>
                    <th>Tracker action</th>
                    <th class="num">Settled</th>
                    <th class="num">Wins</th>
                    <th class="num">Losses</th>
                    <th class="num">Pushes</th>
                    <th class="rate">Win rate</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    trackerImpactRows.length
                      ? trackerImpactRows
                          .map(
                            (row) => `
                    <tr>
                      <td>${safeText(row.label)}</td>
                      <td class="num">${Number(row.settled || 0)}</td>
                      <td class="num">${Number(row.wins || 0)}</td>
                      <td class="num">${Number(row.losses || 0)}</td>
                      <td class="num">${Number(row.pushes || 0)}</td>
                      <td class="rate">${safeText(formatPct(row.winPct))}</td>
                    </tr>
                  `,
                          )
                          .join("")
                      : `<tr><td colspan="6" class="note">Tracker has not influenced any settled picks yet.</td></tr>`
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div class="tracker-analytics-card">
          <div class="tracker-analytics-card-head">
            <div class="tracker-analytics-card-title">Latest-line move check</div>
            <div class="tracker-analytics-card-meta">Proxy for line movement, not guaranteed CLV</div>
          </div>
          <div class="tracker-analytics-card-body">
            <div class="table-wrap tracker-report-table-wrap">
              <table class="tracker-analytics-table">
                <thead>
                  <tr>
                    <th>Line move</th>
                    <th class="num">Settled</th>
                    <th class="num">Wins</th>
                    <th class="num">Losses</th>
                    <th class="num">Pushes</th>
                    <th class="rate">Win rate</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    lineMoveRows.length
                      ? lineMoveRows
                          .map(
                            (row) => `
                    <tr>
                      <td>${safeText(row.label)}</td>
                      <td class="num">${Number(row.settled || 0)}</td>
                      <td class="num">${Number(row.wins || 0)}</td>
                      <td class="num">${Number(row.losses || 0)}</td>
                      <td class="num">${Number(row.pushes || 0)}</td>
                      <td class="rate">${safeText(formatPct(row.winPct))}</td>
                    </tr>
                  `,
                          )
                          .join("")
                      : `<tr><td colspan="6" class="note">The engine has not seen enough later line updates for a movement check yet.</td></tr>`
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      ${
        hasCLVData
          ? `
      <div class="tracker-analytics-card">
        <div class="tracker-analytics-card-head">
          <div class="tracker-analytics-card-title">CLV (Closing Line Value)</div>
          <div class="tracker-analytics-card-meta">${clvPicks.length} picks with closing line data</div>
        </div>
        <div class="tracker-analytics-card-body">
          <div class="tracker-report-subtitle">CLV = how your pick line compares to where the market closed. Positive CLV = you beat the closing line. This is the single strongest long-term edge signal. Enter closing lines via the CUSTOM settle button.</div>
          <div class="table-wrap tracker-report-table-wrap">
            <table class="tracker-analytics-table">
              <thead><tr><th>CLV Direction</th><th class="num">Picks</th><th class="num">Wins</th><th class="num">Losses</th><th class="num">Pushes</th><th class="rate">Win rate</th></tr></thead>
              <tbody>
                ${clvPositive.length ? `<tr><td>Positive (beat line)</td><td class="num">${clvPositive.length}</td><td class="num">${clvPositiveRecord.wins}</td><td class="num">${clvPositiveRecord.losses}</td><td class="num">${clvPositiveRecord.pushes}</td><td class="rate">${safeText(formatPct(clvPositiveRecord.winPct))}</td></tr>` : ""}
                ${clvNeutral.length ? `<tr><td>Flat (at line)</td><td class="num">${clvNeutral.length}</td><td class="num">${clvNeutralRecord.wins}</td><td class="num">${clvNeutralRecord.losses}</td><td class="num">${clvNeutralRecord.pushes}</td><td class="rate">${safeText(formatPct(clvNeutralRecord.winPct))}</td></tr>` : ""}
                ${clvNegative.length ? `<tr><td>Negative (missed line)</td><td class="num">${clvNegative.length}</td><td class="num">${clvNegativeRecord.wins}</td><td class="num">${clvNegativeRecord.losses}</td><td class="num">${clvNegativeRecord.pushes}</td><td class="rate">${safeText(formatPct(clvNegativeRecord.winPct))}</td></tr>` : ""}
              </tbody>
            </table>
          </div>
        </div>
      </div>`
          : `
      <div class="tracker-analytics-card">
        <div class="tracker-analytics-card-head"><div class="tracker-analytics-card-title">CLV (Closing Line Value)</div><div class="tracker-analytics-card-meta">No data yet</div></div>
        <div class="tracker-analytics-card-body"><div class="tracker-report-subtitle">Use the CUSTOM settle button on any pick and enter the closing line to start CLV tracking. Even 20 CLV data points gives stronger signal than 100 W/L results alone.</div></div>
      </div>`
      }

      <div class="tracker-analytics-grid two">
        <div class="tracker-analytics-card">
          <div class="tracker-analytics-card-head">
            <div class="tracker-analytics-card-title">Market win rates</div>
            <div class="tracker-analytics-card-meta">Top tracked markets</div>
          </div>
          <div class="tracker-analytics-card-body">
            <div class="tracker-line-list">
              ${
                marketDisplayRows.length
                  ? marketDisplayRows
                      .map(
                        (row) => `
                <div class="tracker-line-row">
                  <div class="tracker-line-top">
                    <div class="tracker-line-name">${safeText(row.label)}</div>
                    <div class="tracker-line-meta">${safeText(formatPct(row.winPct))}</div>
                  </div>
                  <div class="tracker-line-track"><div class="tracker-line-fill" style="width:${Math.max(6, Math.min(100, Number.isFinite(row.winPct) ? row.winPct : 0))}%"></div></div>
                  <div class="tracker-line-meta">Wins ${row.wins} • Losses ${row.losses} • Pushes ${row.pushes}</div>
                </div>
              `,
                      )
                      .join("")
                  : `<div class="tracker-empty-note">No settled market data yet.</div>`
              }
            </div>
          </div>
        </div>

        <div class="tracker-analytics-card">
          <div class="tracker-analytics-card-head">
            <div class="tracker-analytics-card-title">League performance</div>
            <div class="tracker-analytics-card-meta">Settled results by league</div>
          </div>
          <div class="tracker-analytics-card-body">
            <div class="table-wrap tracker-report-table-wrap">
              <table class="tracker-analytics-table">
                <thead>
                  <tr>
                    <th>League</th>
                    <th class="num">Wins</th>
                    <th class="num">Losses</th>
                    <th class="num">Pushes</th>
                    <th class="rate">Win rate</th>
                  </tr>
                </thead>
                <tbody>
                  ${
                    leagueDisplayRows.length
                      ? leagueDisplayRows
                          .map(
                            (row) => `
                    <tr>
                      <td>${safeText(row.label)}</td>
                      <td class="num">${Number(row.wins || 0)}</td>
                      <td class="num">${Number(row.losses || 0)}</td>
                      <td class="num">${Number(row.pushes || 0)}</td>
                      <td class="rate">${safeText(formatPct(row.winPct))}</td>
                    </tr>
                  `,
                          )
                          .join("")
                      : `<tr><td colspan="5" class="note">No settled league data yet.</td></tr>`
                  }
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div class="tracker-analytics-card">
        <div class="tracker-analytics-card-head">
          <div class="tracker-analytics-card-title">League trust board</div>
          <div class="tracker-analytics-card-meta">Usage labels for the selected and tracked leagues</div>
        </div>
        <div class="tracker-analytics-card-body">
          <div class="table-wrap tracker-report-table-wrap league-trust-desktop-table">
            <table class="tracker-analytics-table">
              <thead>
                <tr>
                  <th>League</th>
                  <th>Trust</th>
                  <th class="num">Settled</th>
                  <th class="num">Wins</th>
                  <th class="num">Losses</th>
                  <th class="num">Pushes</th>
                  <th class="rate">Win rate</th>
                  <th>Action</th>
                  <th>Guidance</th>
                </tr>
              </thead>
              <tbody>
                ${
                  leagueTrustRows.length
                    ? leagueTrustRows
                        .map(
                          (row) => `
                  <tr>
                    <td>${safeText(row.label)}</td>
                    <td><span class="league-trust-pill ${safeText(getLeagueTrustCssClass(row.trust.level))}">${safeText(row.trust.label)}</span></td>
                    <td class="num">${Number(row.settled || 0)}</td>
                    <td class="num">${Number(row.wins || 0)}</td>
                    <td class="num">${Number(row.losses || 0)}</td>
                    <td class="num">${Number(row.pushes || 0)}</td>
                    <td class="rate">${row.settled ? safeText(formatPct(row.winPct)) : "—"}</td>
                    <td><span class="league-trust-pill ${safeText(getLeagueTrustCssClass(row.trust.level))}">${safeText(row.action.label)}</span></td>
                    <td class="note">${safeText(row.trust.guidance)}</td>
                  </tr>
                `,
                        )
                        .join("")
                    : `<tr><td colspan="9" class="note">Pick a league or settle some results to start building the trust board.</td></tr>`
                }
              </tbody>
            </table>
          </div>
          <div class="league-trust-mobile-list">
            ${
              leagueTrustRows.length
                ? leagueTrustRows
                    .map(
                      (row) => `
              <div class="league-trust-mobile-card">
                <div class="league-trust-mobile-top">
                  <div class="league-trust-mobile-league">${safeText(row.label)}</div>
                  <span class="league-trust-pill ${safeText(getLeagueTrustCssClass(row.trust.level))}">${safeText(row.trust.label)}</span>
                </div>
                <div class="league-trust-mobile-grid">
                  <div class="league-trust-mobile-stat"><strong>Settled</strong><span>${Number(row.settled || 0)}</span></div>
                  <div class="league-trust-mobile-stat"><strong>Wins</strong><span>${Number(row.wins || 0)}</span></div>
                  <div class="league-trust-mobile-stat"><strong>Losses</strong><span>${Number(row.losses || 0)}</span></div>
                  <div class="league-trust-mobile-stat"><strong>Pushes</strong><span>${Number(row.pushes || 0)}</span></div>
                  <div class="league-trust-mobile-stat"><strong>Win rate</strong><span>${row.settled ? safeText(formatPct(row.winPct)) : "—"}</span></div>
                  <div class="league-trust-mobile-stat"><strong>Action</strong><span>${safeText(row.action.label)}</span></div>
                </div>
                <div class="league-trust-mobile-guidance">${safeText(row.trust.guidance)}</div>
              </div>
            `,
                    )
                    .join("")
                : `<div class="tracker-empty-note">Pick a league or settle some results to start building the trust board.</div>`
            }
          </div>
          <div class="league-trust-note">Trusted = full plays allowed. Needs retune = advisory-only. Do not use = blocked to no-play until recalibrated.</div>
          <div class="league-trust-note">Non-NBA / non-NCAA picks can now be settled manually from Tracked Picks so Report can learn from them too.</div>
        </div>
      </div>

      <div class="tracker-analytics-card">
        <div class="tracker-analytics-card-head">
          <div class="tracker-analytics-card-title">Teams one by one</div>
          <div class="tracker-analytics-card-meta">Team-by-team learning</div>
        </div>
        <div class="tracker-analytics-card-body">
          <div class="table-wrap tracker-report-table-wrap">
            <table class="tracker-analytics-table">
              <thead>
                <tr>
                  <th>Team</th>
                  <th class="num">Wins</th>
                  <th class="num">Losses</th>
                  <th class="num">Pushes</th>
                  <th class="rate">Win rate</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${
                  teamDisplayRows.length
                    ? teamDisplayRows
                        .map(
                          (row) => `
                  <tr>
                    <td>${safeText(row.label || row.key || "Unknown")}</td>
                    <td class="num">${Number(row.wins || 0)}</td>
                    <td class="num">${Number(row.losses || 0)}</td>
                    <td class="num">${Number(row.pushes || 0)}</td>
                    <td class="rate">${safeText(formatPct(row.winRate))}</td>
                    <td>${safeText(statusFromTeamRow(row))}</td>
                  </tr>
                `,
                        )
                        .join("")
                    : `<tr><td colspan="6" class="note">Tracker is checking teams one by one already. More settled picks will make this table stronger.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="tracker-analytics-card" style="margin-top: 10px; border-color: #2a2a2a;">
        <div class="tracker-analytics-card-head" style="background: linear-gradient(90deg, #333 0%, #111 100%);">
          <div class="tracker-analytics-card-title" style="color: #ffd700;">👁️ GOD'S EYE: POST-MORTEM LOG</div>
          <div class="tracker-analytics-card-meta">Game-by-game diagnostic archive</div>
        </div>
        <div class="tracker-analytics-card-body">
          <div class="table-wrap tracker-report-table-wrap">
            <table class="tracker-analytics-table tracker-gods-eye-table">
              <colgroup>
                <col class="ge-col-matchup">
                <col class="ge-col-pick">
                <col class="ge-col-result">
                <col class="ge-col-context">
              </colgroup>
              <thead>
                <tr>
                  <th>Matchup & Market</th>
                  <th>Pick</th>
                  <th>Result</th>
                  <th>Context</th>
                </tr>
              </thead>
                          <tbody>
                ${
                  fallbackSettledPicks.length
                    ? [...fallbackSettledPicks]
                        .sort((a, b) => getTrackedPickTimeMs(b) - getTrackedPickTimeMs(a))
                        .slice(0, 40)
                        .map((p) => {
                          const engineStatus = String(
                            p.engineResultStatus || p.resultStatus || "pending",
                          ).toLowerCase();
                          const statusClass =
                            engineStatus === "win"
                              ? "color: #3a9c35;"
                              : engineStatus === "loss"
                                ? "color: #c91920;"
                                : "color: #888;";
                          const diag = p.diagnostics || p.godsEyeMemory || {};
                          const pace = diag.pace ? diag.pace.toFixed(1) : "—";
                          const aVol = diag.aVol ? diag.aVol.toFixed(1) : "—";
                          const bVol = diag.bVol ? diag.bVol.toFixed(1) : "—";
                          const nA =
                            diag.netA !== undefined && diag.netA !== null && !isNaN(diag.netA)
                              ? (diag.netA > 0 ? "+" : "") + diag.netA.toFixed(1)
                              : "—";
                          const nB =
                            diag.netB !== undefined && diag.netB !== null && !isNaN(diag.netB)
                              ? (diag.netB > 0 ? "+" : "") + diag.netB.toFixed(1)
                              : "—";
                          const edge = p.edgePct
                            ? (p.edgePct > 0 ? "+" : "") + p.edgePct.toFixed(1) + "%"
                            : "—";
                          const _geSig = encodeURIComponent(p.signature);

                          return `
                    <tr>
                      <td>
                        <strong>${safeText(p.fixtureLabel || p.homeTeam + " vs " + p.awayTeam)}</strong><br>
                        <span style="color: var(--muted); font-size: 9px;">${safeText(p.marketName)} (Line: ${safeText(formatPickLine(p))})</span>
                      </td>
                      <td style="font-weight:bold; white-space: nowrap;">${safeText(p.predictionText)}</td>
                      <td onclick="settleTrackedPickManualFull(decodeURIComponent('${_geSig}'))" style="font-weight:900; text-transform:uppercase; cursor:pointer; ${statusClass}" title="Click to edit or revert mistake">
                        ${safeText(engineStatus)}
                        ${p.actualScore ? `<br><span style="font-size:9px; color:var(--muted);">Score: ${p.actualScore}</span>` : ""}
                      </td>
                                    <td style="font-size: 9px; color: var(--muted); line-height: 1.4;">
                        <strong>Edge:</strong> <span style="color:var(--text)">${edge}</span> | <strong>Grade:</strong> <span style="color:var(--text)">${p.confidenceGrade}</span><br>
                        <strong>Net:</strong> A:${nA} B:${nB}<br>
                        <strong>Data:</strong> ${p.sampleTier ? String(p.sampleTier).toUpperCase() : "—"}
                       </td>
                    </tr>
                  `;
                        })
                        .join("")
                    : `<tr><td colspan="4" class="note">No settled picks yet. The Eye is waiting.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
  `;

  if (currentView === "report") {
    panel.innerHTML = `
      <div class="tracker-analytics-shell">
        <div class="tracker-analytics-topbar">
          <div class="tracker-analytics-heading">
            <div class="tracker-analytics-kicker">Engine report</div>
            <div class="tracker-analytics-title">Tracked results and learning</div>
            <div class="tracker-analytics-subtitle">Pick record, feedback, and post-checkpoint suggestions live here.</div>
          </div>
        </div>
        ${reportBodyHtml}
      </div>
    `;
  } else if (currentView === "debug") {
    const engineLines = AppState.debug.engineLog
      .map((line) => `<li class="${getDebugSeverityClass(line)}">${safeText(line)}</li>`)
      .join("");
    const trackerLines = AppState.debug.trackerLog
      .map((line) => `<li class="${getDebugSeverityClass(line)}">${safeText(line)}</li>`)
      .join("");
    panel.innerHTML = `
      <div class="tracker-analytics-shell">
        <div class="tracker-analytics-topbar">
          <div class="tracker-analytics-heading">
            <div class="tracker-analytics-kicker">System Logs</div>
            <div class="tracker-analytics-title">Diagnostic Stream</div>
            <div class="tracker-analytics-subtitle">Live engine execution data and network sync events.</div>
          </div>
        </div>
        <div class="tracker-analytics-card">
          <div class="tracker-analytics-card-head"><div class="tracker-analytics-card-title">⚙️ Engine Activity</div></div>
          <div class="tracker-analytics-card-body">
            <ul class="tracker-debug-log">${engineLines || '<li class="note">No engine logs currently in memory.</li>'}</ul>
          </div>
        </div>
        <div class="tracker-analytics-card">
          <div class="tracker-analytics-card-head"><div class="tracker-analytics-card-title">📡 Network & Tracker</div></div>
          <div class="tracker-analytics-card-body">
            <ul class="tracker-debug-log">${trackerLines || '<li class="note">No tracker logs currently in memory.</li>'}</ul>
          </div>
        </div>
      </div>
    `;
  } else {
    panel.innerHTML = "";
  }
  updateTrackerInsightsButton();
}

function clampNumber(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function bumpConfidenceGrade(grade, shift = 0) {
  const ladder = ["D", "C", "B", "A"];
  const idx = ladder.indexOf(String(grade || "").toUpperCase());
  if (idx === -1) return grade || "—";
  const newIdx = idx + shift;
  return ladder[clampNumber(newIdx, 0, ladder.length - 1)];
}

const CONFIDENCE_SHIFT_TOTAL_CAP = 1;

function applyGuardedConfidenceShift(pickRow, requestedShift, source, strength) {
  if (!pickRow || !requestedShift) return;
  if (pickRow._baseGradeBeforeShift === undefined) {
    pickRow._baseGradeBeforeShift = pickRow.confidence || "D";
  }
  const requestedStrength = isFinite(strength) ? Math.abs(strength) : Math.abs(requestedShift);
  const priorStrength = Number(pickRow._cumulativeGradeStrength || 0);
  if (requestedStrength <= priorStrength) {
    engineDebug("confidence shift blocked by decorrelation cap (weaker signal)", {
      source,
      requestedShift,
      requestedStrength,
      priorStrength,
    });
    return;
  }
  const clampedRequested = clampNumber(
    requestedShift,
    -CONFIDENCE_SHIFT_TOTAL_CAP,
    CONFIDENCE_SHIFT_TOTAL_CAP,
  );
  pickRow._cumulativeGradeShift = clampedRequested;
  pickRow._cumulativeGradeStrength = requestedStrength;
  pickRow.confidence = bumpConfidenceGrade(pickRow._baseGradeBeforeShift, clampedRequested);
}

function createTrackerFeedbackBucket() {
  return { settled: 0, wins: 0, losses: 0, pushes: 0 };
}

function buildTrackerFeedbackProfile() {
  const all = getLearningTrackedPicks().filter((p) =>
    ["win", "loss", "push"].includes(String(p.resultStatus || "").toLowerCase()),
  );

  const buckets = new Map();
  function addResult(key, status) {
    if (!buckets.has(key)) buckets.set(key, createTrackerFeedbackBucket());
    const bucket = buckets.get(key);
    bucket.settled++;
    if (status === "win") bucket.wins++;
    else if (status === "loss") bucket.losses++;
    else if (status === "push") bucket.pushes++;
  }

  all.forEach((pick) => {
    const status = String(pick.engineResultStatus || pick.resultStatus || "").toLowerCase();
    const leagueKey = String(pick.league || "unknown");
    const marketKey = String(pick.marketKey || "other");
    const side = String(pick.side || "");

    addResult(`leagueMarket:${leagueKey}:${marketKey}`, status);

    if (side) {
      addResult(`leagueMarketSide:${leagueKey}:${marketKey}:${side}`, status);
      addResult(`side:${side}`, status);
    }
  });

  return { totalSettled: all.length, buckets };
}

function getEmpiricalPriorWinRate(side, broadPicks) {
  const relevant = broadPicks.filter(
    (p) =>
      String(p.side || "").toLowerCase() === side &&
      (p.resultStatus === "win" || p.resultStatus === "loss"),
  );
  if (relevant.length < 30) return 50;
  const wins = relevant.filter((p) => p.resultStatus === "win").length;
  return Math.min(60, Math.max(40, (wins / relevant.length) * 100));
}

const TRACKER_SIGNAL_SNAPSHOT_KEY = "BB_TRACKER_SIGNAL_SNAPSHOT_V1";
const TRACKER_SIGNAL_MIN_ELIGIBLE = 40;
const TRACKER_SIGNAL_MIN_VALIDATION = 15;
const TRACKER_SIGNAL_VALIDATION_Z = 0.5;

function loadTrackerSignalSnapshot() {
  try {
    const parsed = safeLocalStorageJSON(TRACKER_SIGNAL_SNAPSHOT_KEY, null);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (e) {
    engineDebug("loadTrackerSignalSnapshot failed: " + (e?.message || String(e)), {
      error: e && (e.message || String(e)),
    });
    return null;
  }
}

function saveTrackerSignalSnapshot(snapshot) {
  try {
    localStorage.setItem(TRACKER_SIGNAL_SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch (e) {
    engineDebug("saveTrackerSignalSnapshot failed to persist: " + (e?.message || String(e)), {
      error: e,
    });
  }
}

function computeTrackerSignalBuckets(eligiblePicks, priorGames = 12) {
  const buckets = {};
  const bySideGlobal = { over: [], under: [] };
  eligiblePicks.forEach((p) => {
    const side = String(p.side || "").toLowerCase();
    if (side === "over" || side === "under") bySideGlobal[side].push(p);
  });
  const globalPrior = {
    over: getEmpiricalPriorWinRate("over", eligiblePicks) / 100,
    under: getEmpiricalPriorWinRate("under", eligiblePicks) / 100,
  };

  const byLeagueSide = {};
  eligiblePicks.forEach((p) => {
    const side = String(p.side || "").toLowerCase();
    if (side !== "over" && side !== "under") return;
    const key = p.league + "|" + side;
    if (!byLeagueSide[key]) byLeagueSide[key] = [];
    byLeagueSide[key].push(p);
  });

  const byLeagueMarketSide = {};
  eligiblePicks.forEach((p) => {
    const side = String(p.side || "").toLowerCase();
    if (side !== "over" && side !== "under") return;
    const key = p.league + "|" + p.marketKey + "|" + side;
    if (!byLeagueMarketSide[key]) byLeagueMarketSide[key] = [];
    byLeagueMarketSide[key].push(p);
  });

  Object.keys(byLeagueMarketSide).forEach((key) => {
    const [league, marketKey, side] = key.split("|");
    const l3Picks = byLeagueMarketSide[key];
    const l2Picks = byLeagueSide[league + "|" + side] || [];
    const l2Wins = l2Picks.filter((p) => p.resultStatus === "win").length;
    const l2Total = l2Picks.length;
    const l2Posterior = (l2Wins + priorGames * globalPrior[side]) / (l2Total + priorGames);

    const l3Wins = l3Picks.filter((p) => p.resultStatus === "win").length;
    const l3Total = l3Picks.length;
    let posterior;
    if (l3Total < 15) {
      posterior = (l3Wins + priorGames * l2Posterior) / (l3Total + priorGames);
    } else {
      const l3Weight = clampNumber((l3Total - 15) / 35, 0, 1);
      posterior = (1 - l3Weight) * l2Posterior + l3Weight * (l3Wins / l3Total);
    }
    buckets[key] = { posterior: Number(posterior.toFixed(4)), sampleSize: l3Total };
  });

  return buckets;
}

function getTrackerPosteriorWinProbFromSnapshot(league, marketKey, side) {
  const snapshot = loadTrackerSignalSnapshot();
  if (!snapshot || !snapshot.buckets) return null;
  const key = String(league) + "|" + String(marketKey) + "|" + String(side || "").toLowerCase();
  const entry = snapshot.buckets[key];
  return entry ? entry.posterior : null;
}

function refreshTrackerSignalSnapshot() {
  const allSettled = getAllSettledTrackedPicks().filter((p) => p.createdAt);
  if (allSettled.length < TRACKER_SIGNAL_MIN_ELIGIBLE) {
    engineDebug(
      "refreshTrackerSignalSnapshot skipped: need " +
        TRACKER_SIGNAL_MIN_ELIGIBLE +
        "+ settled picks",
      { have: allSettled.length },
    );
    return null;
  }

  const prior = loadTrackerSignalSnapshot();
  const priorFreezeTs = prior ? Date.parse(prior.frozenAt || "") : 0;

  const eligible = prior
    ? allSettled.filter((p) => Date.parse(p.createdAt) <= priorFreezeTs)
    : allSettled;
  const validation = prior ? allSettled.filter((p) => Date.parse(p.createdAt) > priorFreezeTs) : [];

  if (eligible.length < TRACKER_SIGNAL_MIN_ELIGIBLE) {
    engineDebug(
      "refreshTrackerSignalSnapshot skipped: eligible slice too small after held-out split",
      { eligible: eligible.length, validation: validation.length },
    );
    return null;
  }

  const candidateBuckets = computeTrackerSignalBuckets(eligible);

  if (!prior) {
    const fresh = {
      buckets: candidateBuckets,
      frozenAt: new Date().toISOString(),
      settledCountAtFreeze: eligible.length,
    };
    saveTrackerSignalSnapshot(fresh);
    engineDebug(
      "refreshTrackerSignalSnapshot: initial snapshot frozen (no prior to validate against)",
      { eligible: eligible.length },
    );
    return fresh;
  }

  if (validation.length < TRACKER_SIGNAL_MIN_VALIDATION) {
    engineDebug(
      "refreshTrackerSignalSnapshot: not enough held-out picks yet, keeping prior snapshot",
      { validation: validation.length, need: TRACKER_SIGNAL_MIN_VALIDATION },
    );
    return prior;
  }

  let correctOverBaseline = 0,
    incorrectOverBaseline = 0;
  validation.forEach((p) => {
    const key = p.league + "|" + p.marketKey + "|" + String(p.side || "").toLowerCase();
    const entry = candidateBuckets[key];
    if (!entry || entry.sampleSize < 5) return;
    const predictedWin = entry.posterior >= 0.5;
    const actualWin = p.resultStatus === "win";
    if (predictedWin === actualWin) correctOverBaseline++;
    else incorrectOverBaseline++;
  });

  const sigTest = testConfigurationSignificance(
    { wins: correctOverBaseline, losses: incorrectOverBaseline },
    {
      wins: (correctOverBaseline + incorrectOverBaseline) / 2,
      losses: (correctOverBaseline + incorrectOverBaseline) / 2,
    },
    TRACKER_SIGNAL_VALIDATION_Z,
  );

  if (sigTest.significant) {
    const promoted = {
      buckets: candidateBuckets,
      frozenAt: new Date().toISOString(),
      settledCountAtFreeze: eligible.length,
      validationZ: sigTest.z,
      validationN: correctOverBaseline + incorrectOverBaseline,
    };
    saveTrackerSignalSnapshot(promoted);
    engineDebug("refreshTrackerSignalSnapshot: new snapshot PROMOTED after held-out validation", {
      z: sigTest.z,
      validationN: promoted.validationN,
    });
    return promoted;
  }

  engineDebug(
    "refreshTrackerSignalSnapshot: candidate FAILED held-out validation, keeping prior snapshot",
    { z: sigTest.z, correctOverBaseline, incorrectOverBaseline },
  );
  return prior;
}

function getAllSettledTrackedPicks() {
  return getLearningTrackedPicks().filter((p) => {
    const status = String(p.resultStatus || "").toLowerCase();
    return status === "win" || status === "loss";
  });
}

function getPickSideFromText(text) {
  const raw = String(text || "")
    .trim()
    .toUpperCase();
  const normalized = raw.startsWith("LEAN ") ? raw.slice(5).trim() : raw;
  if (normalized.startsWith("OVER")) return "over";
  if (normalized.startsWith("UNDER")) return "under";

  if (normalized.startsWith("HOME")) return "home";
  if (normalized.startsWith("AWAY")) return "away";
  return "";
}

function formatMarginPickForDisplay(pickText, marketKey, homeTeamName, awayTeamName, marketLine) {
  const raw = String(pickText || "").trim();
  const upper = raw.toUpperCase();
  const isMarginMarket =
    marketKey === "winner" ||
    marketKey === "handicap" ||
    marketKey === "handicap_h1" ||
    marketKey === "handicap_h2";
  if (!isMarginMarket) return pickText;
  if (upper === "NO PLAY" || upper === "NAN" || upper === "") return pickText;
  const isHome = upper.startsWith("HOME");
  const isAway = upper.startsWith("AWAY");
  if (!isHome && !isAway) return pickText;
  const teamLabel = isHome ? homeTeamName || "Home" : awayTeamName || "Away";
  if (marketKey === "winner") return teamLabel;
  const homeSignedLine = Number(marketLine);
  if (!isFinite(homeSignedLine)) return teamLabel;
  const sideSignedLine = isHome ? homeSignedLine : -homeSignedLine;
  const lineText = (sideSignedLine >= 0 ? "+" : "-") + displayLine(Math.abs(sideSignedLine));
  return teamLabel + " " + lineText;
}

function applySoftTrackerInfluenceToPicks(picks, fixtureMeta, phase2Activation = null) {
  if (!TRACKER_SOFT_EFFECTS.enabled || !Array.isArray(picks) || !picks.length) return;

  const derived = g_trackerDerivedState || defaultTrackerDerivedState();
  const settled = Number(derived?.settledPicks || 0);
  if (settled < Number(TRACKER_SOFT_EFFECTS.minSettled || 20)) return;

  const totalSettledPicks = getLearningTrackedPicks().filter(
    (p) => p.resultStatus !== "pending",
  ).length;
  if (totalSettledPicks === 0) return;

  const profile = buildTrackerFeedbackProfile();
  if (!profile || !profile.totalSettled) return;

  const activation = phase2Activation || getPhase2ActivationState();
  const advisoryOnly =
    !!TRACKER_POLICY.advisoryOnly ||
    (!activation?.trackerFeedbackLive && !activation?.teamMemoryLive);

  const mildMode = settled < Number(TRACKER_SOFT_EFFECTS.minSettledFull || 100);

  picks.forEach((p) => {
    if (!p || p.pick === "NO PLAY" || p.note) return;
    if (!isFinite(p.edge) || !isFinite(p.line) || p.line <= 0) return;

    const side = getPickSideFromText(p.pick);
    if (!side || !p.marketKey) return;

    const edgePct = Math.abs(p.edge / p.line);
    let confidenceShift = 0;
    let lockRestricted = false;
    let hypotheticalNoPlay = false;
    const reasons = [];

    const posteriorWinProb = getTrackerPosteriorWinProbFromSnapshot(p.league, p.marketKey, side);
    if (isFinite(posteriorWinProb)) {
      const priorProb = 0.5;
      const logOddsRatio =
        Math.log(posteriorWinProb / (1 - posteriorWinProb)) - Math.log(priorProb / (1 - priorProb));

      const effectiveFactor = 1 + clampNumber(logOddsRatio, -0.5, 0.5) * 0.3;
      const adjustedEdge = p.edge * effectiveFactor;

      p.trackerFeedback = {
        posteriorWinProb,
        factor: effectiveFactor,
        rawEdge: p.edge,
        adjustedEdge,
        advisoryOnly,
        mildMode,
      };

      if (posteriorWinProb >= 0.62) {
        reasons.push("tracker strong market (not applied — visibility only)");
      } else if (posteriorWinProb <= 0.44) {
        reasons.push("tracker weak market (not applied — visibility only)");
      }

      if (
        !mildMode &&
        posteriorWinProb <= 0.4 &&
        edgePct < Number(TRACKER_SOFT_EFFECTS.weakEdgeNoPlayPct || 0.055)
      ) {
        hypotheticalNoPlay = true;
        lockRestricted = true;
        reasons.push("tracker no-play caution");
      }
    }

    if (advisoryOnly) {
      p.trackerSoftInfluence = {
        applied: true,
        advisoryOnly: true,
        action: hypotheticalNoPlay
          ? "shadow_no_play"
          : confidenceShift > 0
            ? "shadow_boost"
            : confidenceShift < 0
              ? "shadow_downgrade"
              : lockRestricted
                ? "shadow_lock_restrict"
                : "shadow_keep",
        confidenceShift,
        lockRestricted,
        hypotheticalNoPlay,
        reasons,
      };
      if (lockRestricted) p.lockRestricted = true;
      return;
    }

    if (hypotheticalNoPlay) {
      p.pick = "NO PLAY";
      p.confidence = "—";
      p.note = reasons.includes("team no-play caution")
        ? "Tracker caution — weak team signal"
        : "Tracker caution — weak market signal";
      p.lockRestricted = true;
      p.trackerSoftInfluence = {
        applied: true,
        advisoryOnly: false,
        action: "no_play",
        confidenceShift,
        lockRestricted: true,
        hypotheticalNoPlay: true,
        reasons,
      };
      return;
    }

    if (p.pick === "NO PLAY") return;

    if (confidenceShift > 0) {
      applyGuardedConfidenceShift(p, 1, "trackerSoftInfluence", confidenceShift);
    } else if (confidenceShift < 0 && p.confidence && p.confidence !== "—") {
      applyGuardedConfidenceShift(p, -1, "trackerSoftInfluence", confidenceShift);
    }

    p.lockRestricted = !!lockRestricted;
    p.trackerSoftInfluence = {
      applied: true,
      advisoryOnly: false,
      action:
        confidenceShift > 0
          ? "boost"
          : confidenceShift < 0
            ? "downgrade"
            : lockRestricted
              ? "lock_restrict"
              : "keep",
      confidenceShift,
      lockRestricted,
      hypotheticalNoPlay: false,
      reasons,
    };
  });
}

function getTrackedLeagueApiBase(league) {
  const l = String(league || "").toLowerCase();
  const slug = getEspnLeagueSlug(l);
  return slug ? "https://site.api.espn.com/apis/site/v2/sports/basketball/" + slug : "";
}

window._espnStandingsCache = window._espnStandingsCache || {};

async function fetchLeagueStandings(league) {
  const lk = String(league || "").toLowerCase();
  const base = getTrackedLeagueApiBase(lk);
  if (!base) return;
  const existing = window._espnStandingsCache[lk];
  if (existing && existing.data && Date.now() - (existing.ts || 0) < 6 * 60 * 60 * 1000) return;
  try {
    const data = await proxyFetch(base + "/standings?_=" + Date.now(), 12000);
    const table = {};
    const groupEntries = Array.isArray(data?.children)
      ? data.children.flatMap((c) => c?.standings?.entries || [])
      : [];
    const flatEntries = Array.isArray(data?.standings?.entries) ? data.standings.entries : [];
    const entries = flatEntries.length ? flatEntries : groupEntries;
    entries.forEach((e) => {
      const teamId = String(e?.team?.id || "");
      if (!teamId) return;
      const stats = e?.stats || [];
      const pctStat = stats.find(
        (s) => s.name === "winPercent" || s.abbreviation === "PCT" || s.type === "winpercent",
      );
      const pct = pctStat ? parseFloat(pctStat.value ?? pctStat.displayValue ?? 0) : NaN;
      if (isFinite(pct)) table[teamId] = { pct };
    });
    window._espnStandingsCache[lk] = { data: table, ts: Date.now() };
    if (typeof engineDebug === "function") {
      engineDebug("fetchLeagueStandings cached", { league: lk, teams: Object.keys(table).length });
    }
  } catch (err) {
    if (typeof engineDebug === "function") {
      engineDebug("fetchLeagueStandings failed", {
        league: lk,
        error: err?.message || String(err),
      });
    }
  }
}
