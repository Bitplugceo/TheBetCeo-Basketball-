
function syncTrackerModalView() {
  const panel = document.querySelector(".tracker-panel");
  if (!panel) return;
  if (g_trackerModalView === "picks") {
    panel.classList.remove("analytics-view");
  } else {
    panel.classList.add("analytics-view");
  }
  panel.classList.toggle("health-view", g_trackerModalView === "health");
}

function setTrackerModalView(view) {
  const next = ["picks", "report", "debug", "configs", "health", ""].includes(String(view || ""))
    ? String(view)
    : "picks";
  AppState.ui.modalView = next;
  if (isTrackerDebugView()) acknowledgeGlobalEngineAlert();
  updateTrackerInsightsButton();
  syncTrackerModalView();
  renderTrackerAnalytics();
}

function toggleTrackerDebugView() {
  if (isTrackerDebugView()) setTrackerModalView("report");
  else setTrackerModalView("debug");
}

function toggleTrackerConfigsView() {
  if (isTrackerConfigsView()) setTrackerModalView("picks");
  else setTrackerModalView("configs");
}

function toggleTrackerHealthView() {
  if (isTrackerHealthView()) setTrackerModalView("picks");
  else setTrackerModalView("health");
}

let g_trackerSaveFailureCount = 0;
let g_fetchInputErrors = [];

let g_fetchAuditIssues = [];

function renderHeaderErrorState() {
  const btn = document.getElementById("headerErrorBtn");
  if (!btn) return;
  // User-facing error badge/popups disabled
  btn.classList.remove("active");
  btn.style.display = "none";
  btn.title = "";
}

function setFetchInputErrors(errors = []) {
  AppState.ui.inputErrors = [...new Set((errors || []).filter(Boolean))];
  renderHeaderErrorState();
}

function setFetchAuditIssues(issues = []) {
  AppState.ui.auditIssues = [...new Set((issues || []).filter(Boolean))];
  renderHeaderErrorState();
}

function getSelectedFixtureOption() {
  const select = document.getElementById("fixtureSelect");
  if (!select || select.selectedIndex < 0) return null;
  const opt = select.options[select.selectedIndex];
  return opt && opt.value ? opt : null;
}

function buildFetchAuditIssues({ league, teamAName, teamBName, aStats, bStats, h2hGames }) {
  const issues = [];
  const fixtureOpt = getSelectedFixtureOption();

  if (fixtureOpt) {
    const homeId = String(fixtureOpt.dataset.homeId || "");
    const awayId = String(fixtureOpt.dataset.awayId || "");
    const fixtureHome = String(fixtureOpt.dataset.home || "");
    const fixtureAway = String(fixtureOpt.dataset.away || "");

    const sameHomeById =
      homeId && String(selectedTeamIds.A || "") && String(selectedTeamIds.A) === homeId;

    const sameAwayById =
      awayId && String(selectedTeamIds.B || "") && String(selectedTeamIds.B) === awayId;

    const sameHomeByName =
      !!teamAName && normalizeTeamName(teamAName) === normalizeTeamName(fixtureHome);

    const sameAwayByName =
      !!teamBName && normalizeTeamName(teamBName) === normalizeTeamName(fixtureAway);

    if (!(sameHomeById || sameHomeByName)) {
      issues.push("Team A no longer matches the selected fixture.");
    }

    if (!(sameAwayById || sameAwayByName)) {
      issues.push("Team B no longer matches the selected fixture.");
    }
  }

  const requirePairSample = (scoredCount, allowedCount, need, label) => {
    const scored = Number(scoredCount || 0);
    const allowed = Number(allowedCount || 0);
    const minCount = Math.min(scored, allowed);

    if (!minCount) {
      issues.push(`${label} is missing.`);
      return;
    }

    if (minCount < need) {
      issues.push(
        `${label} has only ${minCount} game${minCount === 1 ? "" : "s"} — full model needs ${need}.`,
      );
    }
  };

  requirePairSample(
    aStats?.scored?.length,
    aStats?.allowed?.length,
    5,
    `${teamAName || "Team A"} overall FT sample`,
  );

  requirePairSample(
    bStats?.scored?.length,
    bStats?.allowed?.length,
    5,
    `${teamBName || "Team B"} overall FT sample`,
  );

  if (league === "nba" || league === "ncaa") {
    requirePairSample(
      aStats?.h1Scored?.length,

      aStats?.h1Allowed?.length,
      5,
      `${teamAName || "Team A"} overall 1H sample`,
    );

    requirePairSample(
      bStats?.h1Scored?.length,
      bStats?.h1Allowed?.length,
      5,
      `${teamBName || "Team B"} overall 1H sample`,
    );
  }

  if ((h2hGames?.length || 0) === 0) {
    issues.push("No 2022+ H2H games were found for this matchup.");
  } else if ((h2hGames?.length || 0) === 1) {
    issues.push("Only 1 H2H game was found, so H2H is not fully confirmed.");
  }

  return issues;
}

function validateFetchSection() {
  const league = document.getElementById("leagueSelect")?.value || "";
  const fetchBtn = document.getElementById("fetchBtn");
  const teamAName = document.getElementById("teamAName")?.value.trim() || "";
  const teamBName = document.getElementById("teamBName")?.value.trim() || "";

  const supported = true;
  const fixtureOpt = getSelectedFixtureOption();
  const hasActivity = !!teamAName || !!teamBName || !!fixtureOpt;

  if (!league) {
    if (fetchBtn) fetchBtn.disabled = true;
    setFetchInputErrors([]);
    return false;
  }

  const errors = [];

  if (hasActivity) {
    if (!teamAName) errors.push("Team A is empty.");
    if (!teamBName) errors.push("Team B is empty.");

    const sameById =
      AppState.selection.teamAId &&
      AppState.selection.teamBId &&
      String(AppState.selection.teamAId) === String(AppState.selection.teamBId);

    const sameByName =
      teamAName && teamBName && normalizeTeamName(teamAName) === normalizeTeamName(teamBName);

    if (sameById || sameByName) {
      errors.push("Team A and Team B cannot be the same team.");
    }

    if (fixtureOpt) {
      const homeId = String(fixtureOpt.dataset.homeId || "");
      const awayId = String(fixtureOpt.dataset.awayId || "");
      const fixtureHome = String(fixtureOpt.dataset.home || "");
      const fixtureAway = String(fixtureOpt.dataset.away || "");

      const sameHomeById =
        homeId && String(selectedTeamIds.A || "") && String(selectedTeamIds.A) === homeId;

      const sameAwayById =
        awayId && String(selectedTeamIds.B || "") && String(selectedTeamIds.B) === awayId;

      const sameHomeByName =
        !!teamAName && normalizeTeamName(teamAName) === normalizeTeamName(fixtureHome);

      const sameAwayByName =
        !!teamBName && normalizeTeamName(teamBName) === normalizeTeamName(fixtureAway);

      if (!(sameHomeById || sameHomeByName)) {
        errors.push("Team A no longer matches the selected fixture.");
      }

      if (!(sameAwayById || sameAwayByName)) {
        errors.push("Team B no longer matches the selected fixture.");
      }
    }
  }

  const isValid = errors.length === 0 && !!teamAName && !!teamBName;
  if (fetchBtn) fetchBtn.disabled = !isValid;

  setFetchInputErrors(hasActivity ? errors : []);
  if (isValid && !g_engineAlertNeedsReview) {
    acknowledgeGlobalEngineAlert();
  }
  return isValid;
}

function _parseMadeAttempted(raw) {
  if (raw == null || raw === "") return { made: NaN, attempted: NaN };
  const s = String(raw).trim();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*[-/]\s*(\d+(?:\.\d+)?)$/);
  if (m) {
    return { made: parseFloat(m[1]), attempted: parseFloat(m[2]) };
  }
  const n = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  return { made: NaN, attempted: isFinite(n) ? n : NaN };
}

function _readBoxStat(sMap, aliases) {
  if (!sMap || typeof sMap !== "object") return NaN;
  const keys = Object.keys(sMap);
  for (let i = 0; i < aliases.length; i++) {
    const a = aliases[i];
    if (sMap[a] != null && sMap[a] !== "") {
      const pair = _parseMadeAttempted(sMap[a]);
      if (isFinite(pair.attempted) && pair.attempted > 0) return pair.attempted;
      if (isFinite(pair.made)) return pair.made;
    }
  }
  for (let i = 0; i < aliases.length; i++) {
    const want = String(aliases[i]).toLowerCase();
    const found = keys.find(function (k) {
      return String(k).toLowerCase() === want;
    });
    if (found != null && sMap[found] != null && sMap[found] !== "") {
      const pair = _parseMadeAttempted(sMap[found]);
      if (isFinite(pair.attempted) && pair.attempted > 0) return pair.attempted;
      if (isFinite(pair.made)) return pair.made;
    }
  }

  for (let i = 0; i < aliases.length; i++) {
    const want = String(aliases[i]).toLowerCase();
    const found = keys.find(function (k) {
      return String(k).toLowerCase().indexOf(want.toLowerCase()) >= 0;
    });
    if (found != null && sMap[found] != null && sMap[found] !== "") {
      const pair = _parseMadeAttempted(sMap[found]);
      if (isFinite(pair.attempted) && pair.attempted > 0) return pair.attempted;
    }
  }
  return NaN;
}

function _extractTeamBoxStatMap(boxTeam) {
  const sMap = {};
  if (!boxTeam) return sMap;
  if (Array.isArray(boxTeam.statistics) && boxTeam.statistics.length > 0) {
    boxTeam.statistics.forEach(function (s) {
      if (s && s.name != null)
        sMap[String(s.name)] = s.displayValue != null ? s.displayValue : s.value;
    });
  }
  return sMap;
}

function _extractTeamBoxStatMapFromPlayers(boxscorePlayers, teamId) {
  const sMap = {};
  if (!Array.isArray(boxscorePlayers)) return sMap;
  const myPlayers = boxscorePlayers.find(function (p) {
    return matchesTeam(p, teamId);
  });
  if (!myPlayers || !Array.isArray(myPlayers.statistics) || !myPlayers.statistics[0]) return sMap;
  const block = myPlayers.statistics[0];
  if (!Array.isArray(block.athletes)) return sMap;

  const keys = block.names || block.labels || [];
  const iFg = keys.indexOf("FG") >= 0 ? keys.indexOf("FG") : keys.indexOf("FGA");
  const iFt = keys.indexOf("FT") >= 0 ? keys.indexOf("FT") : keys.indexOf("FTA");
  const iOrb = keys.indexOf("OREB");
  const iTov = keys.indexOf("TO");
  let fga = 0,
    fta = 0,
    orb = 0,
    tov = 0;
  block.athletes.forEach(function (ath) {
    const st = ath.stats || [];
    if (iFg >= 0) {
      const p = _parseMadeAttempted(st[iFg]);
      if (isFinite(p.attempted)) fga += p.attempted;
    }
    if (iFt >= 0) {
      const p = _parseMadeAttempted(st[iFt]);
      if (isFinite(p.attempted)) fta += p.attempted;
    }
    if (iOrb >= 0) orb += parseFloat(st[iOrb]) || 0;
    if (iTov >= 0) tov += parseFloat(st[iTov]) || 0;
  });
  sMap.fieldGoalsAttempted = fga;
  sMap.freeThrowsAttempted = fta;
  sMap.offensiveRebounds = orb;
  sMap.turnovers = tov;
  return sMap;
}

function calculateAdvancedMetrics(sMapMine, sMapOpp, ptsMine, ptsOpp, regMinutes, league) {
  const FGA_ALIASES = [
    "fieldGoalsMade-fieldGoalsAttempted",
    "fieldGoalsAttempted",
    "fieldGoals",
    "FGA",
    "avgFieldGoalsAttempted",
    "FG",
  ];
  const FTA_ALIASES = [
    "freeThrowsMade-freeThrowsAttempted",
    "freeThrowsAttempted",
    "freeThrows",
    "FTA",
    "avgFreeThrowsAttempted",
    "FT",
  ];
  const ORB_ALIASES = ["offensiveRebounds", "OREB", "offensiveRebound", "avgOffensiveRebounds"];
  const TOV_ALIASES = ["totalTurnovers", "turnovers", "TO", "TOV", "avgTurnovers"];

  const fgaM = _readBoxStat(sMapMine, FGA_ALIASES);
  const ftaM = _readBoxStat(sMapMine, FTA_ALIASES);
  const orbM = _readBoxStat(sMapMine, ORB_ALIASES);
  const tovM = _readBoxStat(sMapMine, TOV_ALIASES);
  const fgaO = _readBoxStat(sMapOpp, FGA_ALIASES);
  const ftaO = _readBoxStat(sMapOpp, FTA_ALIASES);
  const orbO = _readBoxStat(sMapOpp, ORB_ALIASES);
  const tovO = _readBoxStat(sMapOpp, TOV_ALIASES);

  if (!(isFinite(ptsMine) && ptsMine > 0 && isFinite(ptsOpp) && ptsOpp > 0)) return null;

  let pace, ortg, drtg, poss;
  if (isFinite(fgaM) && fgaM > 0 && isFinite(fgaO) && fgaO > 0) {
    const possM =
      fgaM +
      0.44 * (isFinite(ftaM) ? ftaM : 0) -
      (isFinite(orbM) ? orbM : 0) +
      (isFinite(tovM) ? tovM : 0);
    const possO =
      fgaO +
      0.44 * (isFinite(ftaO) ? ftaO : 0) -
      (isFinite(orbO) ? orbO : 0) +
      (isFinite(tovO) ? tovO : 0);
    if (possM > 40 && possO > 40) {
      poss = (possM + possO) / 2;
      const mins = isFinite(regMinutes) && regMinutes > 0 ? regMinutes : 48;
      pace = poss * (48 / mins);
      ortg = (100 * ptsMine) / poss;
      drtg = (100 * ptsOpp) / poss;
    }
  }

  if (!(isFinite(pace) && pace > 0 && isFinite(ortg) && isFinite(drtg))) {
    const LEAGUE_AVG_TOTAL =
      LEAGUE_BASES[String(league || "").toLowerCase()] || LEAGUE_BASES.unknown || 224;
    const LEAGUE_AVG_PACE =
      LEAGUE_PACE_BASES[String(league || "").toLowerCase()] || LEAGUE_PACE_BASES.default || 99.5;
    const totalPts = ptsMine + ptsOpp;
    const paceEst = LEAGUE_AVG_PACE * (totalPts / LEAGUE_AVG_TOTAL);
    poss = paceEst;
    pace = paceEst;
    ortg = (100 * ptsMine) / Math.max(poss, 1);
    drtg = (100 * ptsOpp) / Math.max(poss, 1);
  }

  if (!(isFinite(pace) && pace > 0 && isFinite(ortg) && ortg > 0 && isFinite(drtg) && drtg > 0))
    return null;
  if (pace < 70 || pace > 130) return null;
  if (ortg < 70 || ortg > 150 || drtg < 70 || drtg > 150) return null;

  return {
    pace: Number(pace.toFixed(2)),
    ortg: Number(ortg.toFixed(2)),
    drtg: Number(drtg.toFixed(2)),
    possessions: Number((poss || pace).toFixed(2)),
  };
}

/**
 * Period advanced from full-game box possessions + period points (linescores).
 * ESPN team box stats are full-game only; period FGA is not available.
 * possessions_period = possessions_game * periodFraction (time share).
 * pace stays the game rate (possessions per 48).
 */
function derivePeriodAdvanced(fullAdv, ptsMine, ptsOpp, periodFraction, league) {
  if (!fullAdv || !isFinite(periodFraction) || periodFraction <= 0 || periodFraction > 1)
    return null;
  if (!(isFinite(ptsMine) && ptsMine > 0 && isFinite(ptsOpp) && ptsOpp > 0)) return null;
  const gamePoss = Number(fullAdv.possessions);
  const pace = Number(fullAdv.pace);
  if (!(isFinite(gamePoss) && gamePoss > 0 && isFinite(pace) && pace > 0)) return null;
  // FIX CRITICAL: period possessions manufactured from full-game * fraction are synthetic.
  // Real period possessions are not uniform. Tag source so downstream can refuse full weight.
  const periodPoss = gamePoss * periodFraction;
  if (!(periodPoss > 5)) return null;
  const ortg = (100 * ptsMine) / periodPoss;
  const drtg = (100 * ptsOpp) / periodPoss;
  if (!(isFinite(ortg) && ortg > 0 && isFinite(drtg) && drtg > 0)) return null;
  if (ortg < 50 || ortg > 180 || drtg < 50 || drtg > 180) return null;
  return {
    pace: Number(pace.toFixed(2)),
    ortg: Number(ortg.toFixed(2)),
    drtg: Number(drtg.toFixed(2)),
    possessions: Number(periodPoss.toFixed(2)),
    periodFraction: periodFraction,
    source: "synthetic",
    synthetic: true,
  };
}

function logDebug(message, extra) {
  // Was: DEBUG-gated raw console.log. DEBUG is const false (see above),
  // so this was a silent, permanent no-op for all 10 call sites that use
  // it. Routed through engineDebug so these fetch-failure logs actually
  // land in the in-app debug panel (filterable, visible), consistent
  // with how the rest of the codebase logs.
  if (typeof engineDebug === "function") engineDebug(message, extra);
}

function cacheSet(map, key, val) {
  if (map.has(key)) map.delete(key);
  if (map.size >= CACHE_MAX) map.delete(map.keys().next().value);
  map.set(key, val);
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}

function safeText(str) {
  return escapeHtml(str);
}

function normalizeTeamName(name) {
  return String(name || "")
    .toLowerCase()

    .replace(/\ba&m\b/g, "a and m")
    .replace(/[.''()<>&"]/g, "")
    .replace(/\bsaint\b/g, "st")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDashes(str) {
  return String(str ?? "").replace(/[\u2013\u2014\u2212]/g, "-");
}

function readVal(p) {
  // FIX Issue 15: missing values are NaN (not 0) so incomplete linescores do not look real.
  if (p === null || p === undefined) return NaN;
  if (typeof p === "object") {
    const v = parseFloat(p.value ?? p.displayValue ?? NaN);
    return isFinite(v) ? v : NaN;
  }
  const v = parseFloat(p);
  return isFinite(v) ? v : NaN;
}

function extractFirstHalf(lm, lo) {
  if (!Array.isArray(lm) || !Array.isArray(lo) || lm.length === 0 || lo.length === 0) {
    return [NaN, NaN];
  }
  return [readVal(lm[0]), readVal(lo[0])];
}

function extractSecondHalf(lm, lo) {
  if (!Array.isArray(lm) || !Array.isArray(lo) || lm.length < 2 || lo.length < 2) {
    return [0, 0];
  }
  return [readVal(lm[1]), readVal(lo[1])];
}

function resetResultsTable() {
  const t = document.getElementById("results");
  if (!t) return;
  t.innerHTML =
    "<tr><th>Pick</th><th>Projection</th><th>Edge</th><th>Model Grade</th><th>Prediction</th></tr>";
  t.style.display = "none";
}

function invalidateFetchedAudit() {
  setFetchAuditIssues([]);
  resetResultsTable();
  acknowledgeGlobalEngineAlert();
}

function setStatusText(msg, type = "") {
  const el = document.getElementById("fetchStatus");
  if (!el) return;
  el.className = type || "";
  el.textContent = msg || "";
}

function setStatusHTML(html, type = "") {
  const el = document.getElementById("fetchStatus");
  if (!el) return;
  el.className = type || "";
  el.innerHTML = html || "";
}

function buildCompactFetchStatus(messages = [], fetchAuditIssues = []) {
  const clean = (messages || []).map((m) => String(m || "").trim()).filter(Boolean);
  const h2hOnly = clean.filter((m) => /^H2H:/i.test(m));
  let summary = h2hOnly.length ? h2hOnly[h2hOnly.length - 1] : clean[clean.length - 1] || "";

  if (!summary && fetchAuditIssues.length) {
    summary = "Fetch audit: tap ⚠️ to review";
  }

  if (summary && fetchAuditIssues.length) {
    summary += " • tap ⚠️";
  }

  return summary;
}

function unlockFetchBtn() {
  validateFetchSection();
}

function setManualSource(side, bucket) {
  if (bucket) {
    g_fetchMeta[side][bucket] = { source: "manual", venueReliable: true };
  } else {
    g_fetchMeta[side] = {
      ft: { source: "manual", venueReliable: true },
      h1: { source: "manual", venueReliable: true },
    };
  }
}

function normalizeId(raw) {
  if (raw === null || raw === undefined) return "";
  const s = String(raw);
  const tMatch = s.match(/t:(\d+)/);
  if (tMatch) return tMatch[1];
  const numMatch = s.match(/^(\d+)$/);
  if (numMatch) return numMatch[1];
  return s.replace(/\D/g, "") || s;
}

function matchesTeam(competitor, teamId) {
  const tid = String(teamId);
  if (!competitor) return false;
  if (normalizeId(competitor.team?.id) === tid) return true;
  if (normalizeId(competitor.team?.uid) === tid) return true;
  if (normalizeId(competitor.uid) === tid) return true;
  if (normalizeId(competitor.id) === tid) return true;
  return false;
}
const _proxyFetchCache = new Map();
async function proxyFetch(url, timeoutMs = 12000) {
  if (url == null || url === "" || String(url).includes("/undefined") || String(url).includes("/null/")) {
    const err = new Error("proxyFetch blocked — invalid URL (undefined/null path segment)");
    engineDebug("proxyFetch blocked invalid URL", { request: String(url) });
    throw err;
  }
  const fetchLabel = getEngineFetchLabel(url);
  const cacheKey = url;
  if (_proxyFetchCache.has(cacheKey)) {
    const { data, timestamp } = _proxyFetchCache.get(cacheKey);
    if (Date.now() - timestamp < 60 * 60 * 1000) {
      engineDebug("fetch cache hit", { request: fetchLabel });
      return data;
    } else {
      _proxyFetchCache.delete(cacheKey);
    }
  }

  engineDebug("fetch start", { request: fetchLabel, timeoutMs });

  async function fetchJson(requestUrl, label, extraHeaders) {
    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);
    let _proxyAbortHandler = null;
    if (window.__abortSignal && !window.__abortSignal.aborted) {
      _proxyAbortHandler = () => ctrl.abort();
      window.__abortSignal.addEventListener("abort", _proxyAbortHandler, { once: true });
    }
    try {
      const res = await fetch(requestUrl, {
        signal: ctrl.signal,
        cache: "no-store",
        headers: extraHeaders || undefined,
      });

      if (!res.ok) throw new Error(`${label} HTTP ${res.status}: ${res.statusText}`);

      const text = await res.text();
      try {
        return JSON.parse(text);
      } catch (e) {
        throw new Error(`${label} bad JSON (Length: ${text.length})`);
      }
    } catch (e) {
      if (e?.name === "AbortError" && timedOut) {
        const timeoutError = new Error(`${label} Timeout after ${timeoutMs / 1000}s`);
        timeoutError.name = "TimeoutError";
        timeoutError.cause = e;
        throw timeoutError;
      }
      throw e;
    } finally {
      clearTimeout(timer);
      if (window.__abortSignal && _proxyAbortHandler) {
        window.__abortSignal.removeEventListener("abort", _proxyAbortHandler);
        _proxyAbortHandler = null;
      }
    }
  }

  try {
    // D2: only proxy allowlisted sports hosts through the worker.
    var _uCheck = String(url || "");
    var _allowedHost =
      /site\.api\.espn\.com|site\.web\.api\.espn\.com|sports\.core\.api\.espn\.com/i.test(_uCheck);
    if (!_allowedHost && /https?:\/\//i.test(_uCheck)) {
      engineDebug("proxyFetch blocked non-allowlisted host", { request: fetchLabel });
      throw new Error("proxyFetch: target host not allowlisted");
    }
    const workerData = await fetchJson(WORKER_URL + "?url=" + encodeURIComponent(url), "Worker", {
      "X-Engine-Secret": WORKER_SHARED_SECRET,
    });
    if (String(url).includes("/summary?event=")) {
      trackerDebug("summary fetch ok via worker", {
        event: String(url).split("event=")[1]?.split("&")[0] || "",
        source: "worker",
      });
    }
    _proxyFetchCache.set(cacheKey, { data: workerData, timestamp: Date.now() });
    return workerData;
  } catch (workerErr) {
    // Worker miss is expected often (SW null response / offline worker). Direct ESPN is the normal recovery path —
    // do NOT log as ERROR per request (spams debug + false alarms). One quiet note per page load max.
    try {
      if (!window.__BB_WORKER_FALLBACK_NOTED__) {
        window.__BB_WORKER_FALLBACK_NOTED__ = true;
        engineDebug(
          "Worker path unavailable; using direct ESPN for allowlisted hosts (normal fallback)",
          {
            sampleRequest: fetchLabel,
            note: "Further worker misses this session are silent unless direct ESPN also fails",
          },
        );
      }
    } catch (_noteErr) {}
    try {
      // Direct fallback only for ESPN hosts — never open-relay arbitrary URLs.
      if (
        !/site\.api\.espn\.com|site\.web\.api\.espn\.com|sports\.core\.api\.espn\.com/i.test(
          String(url || ""),
        )
      ) {
        throw workerErr;
      }
      const directData = await fetchJson(url, "DirectESPN");
      _proxyFetchCache.set(cacheKey, { data: directData, timestamp: Date.now() });
      return directData;
    } catch (directErr) {
      engineDebug("Direct ESPN fetch failed — no unverified public proxy fallback", {
        request: fetchLabel,
        error: directErr?.message || String(directErr),
      });
      throw directErr || workerErr;
    }
  }
}

function openSection(id) {
  const el = document.getElementById(id);
  if (!el || el.classList.contains("locked")) return;
  el.classList.remove("collapsed");
}

function closeSection(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add("collapsed");
}

function lockSection(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add("locked");
  if (id !== "marketSection") el.classList.add("collapsed");
}

function unlockSection(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove("locked");
}

function accordionOpen(id, keepMarketOpen = false) {
  [
    "leagueSection",
    "espnSection",
    "marketSection",
    "teamASection",
    "teamBSection",
    "h2hSection",
  ].forEach((sectionId) => {
    if (sectionId !== id && !(keepMarketOpen && sectionId === "marketSection")) {
      closeSection(sectionId);
    }
  });
  openSection(id);
}

function lockFrom(startId) {
  const order = ["espnSection", "marketSection", "teamASection", "teamBSection", "h2hSection"];

  let locking = false;
  order.forEach((id) => {
    if (id === startId) locking = true;
    if (locking) lockSection(id);
  });
}

function parseMarketLine(val) {
  const meta = parseMarketRangeMeta(val);
  return meta ? meta.mid : null;
}

function applySmartLineToPick(pickRow, rawInput, league) {
  if (!pickRow) return pickRow;

  const meta = parseMarketRangeMeta(rawInput);
  const side = getPickSideFromText(pickRow.pick);

  if (!meta || !meta.isRange || !(side === "over" || side === "under") || !isFinite(pickRow.proj)) {
    return {
      ...pickRow,
      decisionLine: pickRow.line,
      trackerLine: pickRow.line,
      displayLineUsed: pickRow.line,
      displayEdge: pickRow.edge,
      displayPick: pickRow.pick,
      bufferedPickText: pickRow.pick,
      smartLineMeta: meta,
    };
  }

  const baseThresh = Number(getLeagueEdgePointThreshold(league, pickRow.marketKey)) || 0;
  const _underFactor =
    (typeof getParam === "function" ? getParam("underEdgeFactor", league) : null) ??
    (typeof UNDER_EDGE_FACTOR !== "undefined" ? UNDER_EDGE_FACTOR : 1.2);
  const thresh = side === "under" ? baseThresh * _underFactor : baseThresh;
  const halfWidth = (meta.high - meta.low) / 2;
  const widthCap = Math.max(thresh * 2, 6);

  if (halfWidth > widthCap) {
    return {
      ...pickRow,
      decisionLine: pickRow.line,
      trackerLine: pickRow.line,
      displayLineUsed: pickRow.line,
      displayEdge: pickRow.edge,
      displayPick: "NO PLAY",
      bufferedPickText: pickRow.pick,
      smartLineMeta: { ...meta, skipped: "range_too_wide", halfWidth, thresh, widthCap },
    };
  }

  const rawConservativeLine = side === "over" ? meta.high : meta.low;
  const conservativeLine =
    side === "over"
      ? Math.min(rawConservativeLine, meta.mid + thresh)
      : Math.max(rawConservativeLine, meta.mid - thresh);
  const conservativeEdge = pickRow.proj - conservativeLine;
  const stillQualifies = side === "over" ? conservativeEdge >= thresh : conservativeEdge <= -thresh;

  return {
    ...pickRow,
    decisionLine: conservativeLine,
    trackerLine: pickRow.line,
    displayLineUsed: conservativeLine,
    displayEdge: conservativeEdge,
    displayPick: stillQualifies ? pickRow.pick : "NO PLAY",
    bufferedPickText: pickRow.pick,
    smartLineMeta: { ...meta, conservativeLine, thresh, stillQualifies },
  };
}

function parseMarketRangeMeta(val) {
  if (!val || !String(val).trim()) return null;
  const raw = normalizeDashes(String(val).trim());
  const normalizeLine = (num) => Math.round(num * 2) / 2;

  const rangeMatch = raw.match(/^(\d{1,3}(?:\.\d+)?)\s*-\s*(\d{1,3}(?:\.\d+)?)$/);
  if (rangeMatch) {
    const a = parseFloat(rangeMatch[1]);
    const b = parseFloat(rangeMatch[2]);
    if (!isFinite(a) || !isFinite(b) || a <= 0 || b <= 0 || b < a) return null;
    return {
      raw,
      low: normalizeLine(a),
      high: normalizeLine(b),
      mid: normalizeLine((a + b) / 2),
      isRange: true,
    };
  }

  const singleMatch = raw.match(/^(\d{1,3}(?:\.\d+)?)$/);
  if (singleMatch) {
    const x = parseFloat(singleMatch[1]);
    if (!isFinite(x) || x <= 0) return null;
    const line = normalizeLine(x);
    return {
      raw,
      low: line,
      high: line,
      mid: line,
      isRange: false,
    };
  }

  return null;
}

function parseHandicapLine(val) {
  if (!val || !String(val).trim()) return null;
  const raw = normalizeDashes(String(val).trim());
  const normalizeLine = (num) => Math.round(num * 2) / 2;
  const match = raw.match(/^([+-]?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const x = parseFloat(match[1]);
  if (!isFinite(x)) return null;
  return normalizeLine(x);
}

function getRawMarketInputMap() {
  return {
    ft: document.getElementById("ftMarket")?.value || "",
    h1: document.getElementById("h1Market")?.value || "",

    h2: document.getElementById("h2Market")?.value || "",
    h1_team_a: document.getElementById("h1TeamAMarket")?.value || "",
    h1_team_b: document.getElementById("h1TeamBMarket")?.value || "",

    team_a: document.getElementById("teamAMarket")?.value || "",
    team_b: document.getElementById("teamBMarket")?.value || "",
    q1: document.getElementById("q1Market")?.value || "",
    q2: document.getElementById("q2Market")?.value || "",
    q3: document.getElementById("q3Market")?.value || "",
    q4: document.getElementById("q4Market")?.value || "",

    handicap: document.getElementById("handicapMarket")?.value || "",
    handicap_h1: document.getElementById("handicapH1Market")?.value || "",
    handicap_h2: document.getElementById("handicapH2Market")?.value || "",
  };
}

function parseGames(id) {
  const el = document.getElementById(id);
  const raw = el ? el.value.trim() : "";
  if (el) el.style.borderColor = "";
  if (!raw) return null;

  const parts = raw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  if (parts.length > 10) return { err: "maximum 10 values allowed" };

  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const v = parseFloat(parts[i]);
    if (isNaN(v)) return { err: '"' + parts[i] + '" at position ' + (i + 1) + " is not a number" };

    if (v <= 0)
      return { err: "value at position " + (i + 1) + " must be greater than 0 (" + v + ")" };
    if (v > 300) return { err: "value at position " + (i + 1) + " is too high (" + v + ")" };
    out.push(v);
  }
  return out;
}

function avg(arr) {
  if (!arr || arr.length === 0) return NaN;
  const clean = arr.filter((v) => isFinite(v));
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : NaN;
}

function weightedRecentAverage(arr, weights) {
  const activeWeights = weights || getParam("recencyWeights") || MODEL_TUNING.recencyWeights;
  const clean = Array.isArray(arr) ? arr.map(Number).filter((v) => isFinite(v)) : [];
  if (!clean.length) return NaN;
  if (!Array.isArray(activeWeights) || activeWeights.length === 0) return avg(clean);

  const truncated = clean.slice(0, activeWeights.length);
  let weightedSum = 0,
    weightTotal = 0;
  for (let i = 0; i < truncated.length; i++) {
    weightedSum += truncated[i] * activeWeights[i];
    weightTotal += activeWeights[i];
  }
  return weightTotal ? weightedSum / weightTotal : avg(truncated);
}

function trimmedAvg(arr) {
  const work = Array.isArray(arr) ? arr.map(Number).filter((v) => isFinite(v)) : [];
  if (!work.length) return NaN;
  if (work.length < 5) return weightedRecentAverage(work);

  const sorted = [...work].sort((a, b) => a - b);
  const minVal = sorted[0];
  const maxVal = sorted[sorted.length - 1];

  const weights =
    (typeof getParam === "function" ? getParam("recencyWeights") : null) ||
    (typeof MODEL_TUNING !== "undefined" ? MODEL_TUNING.recencyWeights : null);
  // Lower return value = lower recency weight = preferred candidate to drop
  // on a tie. Falls back to index order (higher index = older = lower
  // priority to keep) if no weight table is available.
  const dropPriority = (idx) =>
    Array.isArray(weights) && isFinite(Number(weights[idx])) ? Number(weights[idx]) : -idx;

  // FIX (MEDIUM #9): drop one min and one max by VALUE, but when several
  // entries tie at that value, drop the one with the lowest recency weight
  // (oldest), not simply the first one encountered while scanning from
  // index 0 (which, under this codebase's recency convention, is always
  // the most recent / highest-weight entry). Previously a tie at an
  // extreme always cost the most-recent tied game its weight slot.
  let minDropIdx = -1;
  for (let i = 0; i < work.length; i++) {
    if (work[i] === minVal && (minDropIdx === -1 || dropPriority(i) < dropPriority(minDropIdx))) {
      minDropIdx = i;
    }
  }
  let maxDropIdx = -1;
  for (let i = 0; i < work.length; i++) {
    if (i === minDropIdx) continue;
    if (work[i] === maxVal && (maxDropIdx === -1 || dropPriority(i) < dropPriority(maxDropIdx))) {
      maxDropIdx = i;
    }
  }

  const trimmed = [];
  for (let i = 0; i < work.length; i++) {
    if (i === minDropIdx || i === maxDropIdx) continue;
    trimmed.push({ value: work[i], originalIndex: i });
  }

  if (!Array.isArray(weights) || !weights.length) {
    return trimmed.reduce((s, item) => s + item.value, 0) / (trimmed.length || 1);
  }

  let weightedSum = 0;
  let weightTotal = 0;
  for (const item of trimmed) {
    const w = Number(weights[item.originalIndex]);
    if (isFinite(w) && w > 0) {
      weightedSum += item.value * w;
      weightTotal += w;
    }
  }
  if (weightTotal > 0) return weightedSum / weightTotal;
  return trimmed.reduce((s, item) => s + item.value, 0) / (trimmed.length || 1);
}

function weightedRecentAverageByDate(
  items,
  weights = (typeof getParam === "function" ? getParam("recencyWeights", "nba") : null) ||
    MODEL_TUNING.recencyWeights,
) {
  const clean = Array.isArray(items)
    ? items
        .filter((it) => it && it.date != null && isFinite(Number(it.value)))
        .map((it) => ({ date: new Date(it.date), value: Number(it.value) }))
        .filter((it) => !isNaN(it.date.getTime()))
    : [];
  if (!clean.length) return NaN;
  clean.sort((a, b) => b.date - a.date);
  if (!Array.isArray(weights) || weights.length === 0) {
    return clean.reduce((s, it) => s + it.value, 0) / clean.length;
  }
  const truncated = clean.slice(0, weights.length);
  let weightedSum = 0,
    weightTotal = 0;
  for (let i = 0; i < truncated.length; i++) {
    weightedSum += truncated[i].value * weights[i];
    weightTotal += weights[i];
  }
  return weightTotal
    ? weightedSum / weightTotal
    : truncated.reduce((s, it) => s + it.value, 0) / truncated.length;
}

function getDateAwareOrFallbackAverage(series, side, marketKey) {
  // Temporal: asOf / eventDate / predictionDate / filterEventsAsOf / filterNumericSeriesWithParallelDates
  let clean = Array.isArray(series) ? series.map(Number).filter((v) => isFinite(v)) : [];
  if (!clean.length) return NaN;
  let dates = getStashedSeriesDates(side, marketKey);
  let asOf = null;
  try {
    asOf =
      (typeof resolvePredictionAsOf === "function" && resolvePredictionAsOf(null, null)) ||
      (document.getElementById("eventDate") && document.getElementById("eventDate").value) ||
      null;
    if (!asOf && typeof getCurrentFixtureMeta === "function") {
      const m = getCurrentFixtureMeta();
      asOf = (m && (m.eventDate || m.predictionDate || m.asOf || m.date)) || null;
    }
  } catch (_eAs) {}
  if (asOf && dates && dates.length && typeof filterNumericSeriesWithParallelDates === "function") {
    clean = filterNumericSeriesWithParallelDates(clean, dates, asOf);
    // Re-pair dates after filter (filter keeps parallel indices)
    const paired = [];
    const raw = Array.isArray(series) ? series.map(Number) : [];
    for (let i = 0; i < raw.length && i < dates.length; i++) {
      if (!isFinite(raw[i])) continue;
      const t = Date.parse(dates[i]);
      const cut = Date.parse(asOf);
      if (Number.isFinite(cut) && Number.isFinite(t) && t > cut) continue;
      paired.push({ value: raw[i], date: dates[i] });
    }
    if (paired.length) {
      const dateAware = weightedRecentAverageByDate(paired);
      if (isFinite(dateAware)) return dateAware;
    }
    if (!clean.length) return NaN;
  }
  if (dates && dates.length === clean.length) {
    const dateAware = weightedRecentAverageByDate(
      clean.map((v, i) => ({ value: v, date: dates[i] })),
    );
    if (isFinite(dateAware)) return dateAware;
  }
  return weightedRecentAverage(clean);
}

function stdDev(arr) {
  const clean = Array.isArray(arr) ? arr.map(Number).filter((v) => isFinite(v)) : [];
  if (clean.length < 2) return 0;
  const mean = clean.reduce((a, b) => a + b, 0) / clean.length;
  const variance = clean.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / (clean.length - 1);
  return Math.sqrt(variance);
}

function safeArr(a) {
  return a && !a.err ? a : null;
}

function displayLine(val) {
  if (val === null || val === undefined || isNaN(val) || !isFinite(val)) return "NaN";
  const rounded = Math.round(val * 2) / 2;

  return rounded.toFixed(1);
}

// Winner-market picks have no numeric line (marketKey "winner", line: null) —
// the "line" for that market is just which team was picked. Every table or
// report that renders a pick's line should route through this so those rows
// show the picked team's name instead of a stray "NaN"/"null" leaking through
// (isFinite(null) === true is the trap that let that happen before — bare
// isFinite coerces null to 0, so the old ternary guards let it pass through
// into displayLine(), which then correctly saw null and returned "NaN").
function formatPickLine(p) {
  if (String((p && p.marketKey) || "").toLowerCase() === "winner") {
    // Line column shows HOME / AWAY side, not the team name (team is already in Pick)
    const pred = String((p && p.predictionText) || "").trim().toLowerCase();
    if (!pred) return "—";
    if (pred === "home" || pred.startsWith("home ")) return "HOME";
    if (pred === "away" || pred.startsWith("away ")) return "AWAY";
    const home = String((p && p.homeTeam) || "").trim().toLowerCase();
    const away = String((p && p.awayTeam) || "").trim().toLowerCase();
    const norm = (s) => s.replace(/\s+/g, " ").trim();
    const np = norm(pred);
    if (home && (np === norm(home) || np.includes(norm(home)) || norm(home).includes(np))) return "HOME";
    if (away && (np === norm(away) || np.includes(norm(away)) || norm(away).includes(np))) return "AWAY";
    // Fallback: side field if engine stored it
    const side = String((p && p.side) || "").toLowerCase();
    if (side === "home") return "HOME";
    if (side === "away") return "AWAY";
    return "—";
  }
  return isFinite(p && p.line) ? displayLine(p.line) : "—";
}

function formatTrackedDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function makeTrackedMatchupKey(pick) {
  const home = normalizeTeamName(pick?.homeTeam || "");
  const away = normalizeTeamName(pick?.awayTeam || "");
  if (!home && !away) return "";
  return [home, away].sort().join(" vs ");
}

function ensureTrackedPickKeys(pick = {}) {
  const next = { ...pick };

  next.homeTeam = next.homeTeam || "—";
  next.awayTeam = next.awayTeam || "—";
  next.homeTeamKey = next.homeTeamKey || normalizeTeamName(next.homeTeam);
  next.awayTeamKey = next.awayTeamKey || normalizeTeamName(next.awayTeam);
  next.matchupKey = next.matchupKey || makeTrackedMatchupKey(next);

  next.marketKey = next.marketKey || "other";
  next.marketName = next.marketName || "—";
  next.side = next.side || "";
  next.inputSource = next.inputSource || "unknown";
  next.isLock = !!next.isLock;
  next.confidence = next.confidence || "";
  next.confidenceGrade = String(
    next.confidenceGrade || next.confidence || next?.diagnostics?.confidenceGrade || "",
  ).toUpperCase();
  next.originalConfidenceGrade = String(
    next.originalConfidenceGrade ||
      next?.diagnostics?.shadowTrackerFeedback?.originalConfidence ||
      next.confidenceGrade ||
      "",
  ).toUpperCase();
  next.projection = isFinite(Number(next.projection))
    ? Number(next.projection)
    : isFinite(Number(next.proj))
      ? Number(next.proj)
      : null;
  next.lineAtPick = isFinite(Number(next.lineAtPick))
    ? Number(next.lineAtPick)
    : isFinite(Number(next.line))
      ? Number(next.line)
      : null;
  next.closingLine =
    next.closingLine !== undefined &&
    next.closingLine !== null &&
    isFinite(Number(next.closingLine))
      ? Number(next.closingLine)
      : null;
  next.clv = (() => {
    if (
      next.closingLine !== null &&
      isFinite(Number(next.closingLine)) &&
      isFinite(Number(next.lineAtPick ?? next.line))
    ) {
      const cl = Number(next.closingLine);
      const lp = Number(next.lineAtPick ?? next.line);
      const s = String(next.side || "").toLowerCase();
      if (s === "under") return Math.round((lp - cl) * 100) / 100;
      if (s === "over") return Math.round((cl - lp) * 100) / 100;
    }
    return null;
  })();
  next.edge = isFinite(Number(next.edge)) ? Number(next.edge) : null;

  next.edgePct =
    next.edgePct !== null && next.edgePct !== undefined && isFinite(Number(next.edgePct))
      ? Math.abs(Number(next.edgePct))
      : isFinite(Number(next.edge)) && isFinite(Number(next.lineAtPick)) && Number(next.lineAtPick)
        ? Math.abs((Number(next.edge) / Number(next.lineAtPick)) * 100)
        : null;
  // A8: normalize American odds / price so buildRecordFromEval ROI is not a
  // pure win-rate transform once upstream fills this field. Default -110 is
  // explicit (standard juice) rather than leaving the key undefined.
  next.price = isFinite(Number(next.price))
    ? Number(next.price)
    : isFinite(Number(next.americanOdds))
      ? Number(next.americanOdds)
      : -110;
  next.americanOdds = isFinite(Number(next.americanOdds)) ? Number(next.americanOdds) : next.price;
  next.trackerSoftInfluence =
    next.trackerSoftInfluence || next?.diagnostics?.trackerSoftInfluence || null;
  next.trackerFeedback = next.trackerFeedback || next?.diagnostics?.trackerFeedback || null;
  next.shadowTrackerFeedback =
    next.shadowTrackerFeedback || next?.diagnostics?.shadowTrackerFeedback || null;

  next.lockRestricted = !!next.lockRestricted;
  next.trackerImpactKey =
    next.trackerImpactKey ||
    next?.diagnostics?.trackerImpactKey ||
    getTrackerImpactKeyFromPickLike(next);
  next.trackerImpactLabel =
    next.trackerImpactLabel ||
    next?.diagnostics?.trackerImpactLabel ||
    getTrackerImpactLabel(next.trackerImpactKey);

  next.resultStatus = String(next.resultStatus || "pending").toLowerCase();
  if (["win", "loss", "push"].includes(next.resultStatus) && !next.settledAt) {
    next.settledAt = next.eventDate || next.createdAt || new Date().toISOString();
  }

  next.modelVersion = normalizeModelVersion(next.modelVersion);
  next.createdAt = next.createdAt || new Date().toISOString();
  next.signature = next.signature || makeTrackedSignature(next);
  next.pickId = next.pickId || next.signature;

  return next;
}

function getConfidenceRank(grade = "") {
  const raw = String(grade || "").toUpperCase();
  if (raw === "A") return 4;
  if (raw === "B") return 3;
  if (raw === "C") return 2;
  if (raw === "D") return 1;
  return 0;
}

function getTrackedPickEdgeAbsPoints(pick = {}) {
  const edge = Number(pick?.edge);
  if (isFinite(edge)) return Math.abs(edge);
  const line = Number(pick?.lineAtPick ?? pick?.line);
  const pct = Number(pick?.edgePct);
  if (isFinite(pct) && isFinite(line) && line > 0) return Math.abs((pct / 100) * line);
  return NaN;
}

function getEdgeBucketSortRank(key = "") {
  const map = {
    micro: 0,
    small: 1,
    medium: 2,
    strong: 3,
    extreme: 4,
    unknown: 9,
  };
  return map[String(key || "unknown").toLowerCase()] ?? 9;
}

function getTrackedPickEdgeBucketLabel(key = "") {
  const clean = String(key || "unknown").toLowerCase();
  if (clean === "micro") return "0–3% edge";
  if (clean === "small") return "3–5% edge";
  if (clean === "medium") return "5–7.5% edge";
  if (clean === "strong") return "7.5–10% edge";
  if (clean === "extreme") return "10%+ edge";
  return "Unknown edge";
}

function getTrackerImpactKeyFromPickLike(pick = {}) {
  const action = String(pick?.trackerSoftInfluence?.action || "").toLowerCase();
  const advisoryOnly =
    !!pick?.trackerSoftInfluence?.advisoryOnly ||
    String(pick?.shadowTrackerFeedback?.mode || "").toLowerCase() === "advisory";

  if (action === "no_play" || action === "shadow_no_play") return "blocked";
  if (action.includes("downgrade")) return "downgraded";
  if (action.includes("boost")) return "boosted";
  if (action.includes("lock_restrict") || pick?.lockRestricted) return "restricted";
  if (advisoryOnly && (pick?.trackerFeedback || pick?.teamMemory || pick?.shadowTrackerFeedback))
    return "shadow";
  if (pick?.trackerFeedback || pick?.teamMemory || pick?.shadowTrackerFeedback) return "observed";
  return "none";
}

function getTrackerImpactLabel(key = "") {
  const clean = String(key || "none").toLowerCase();
  if (clean === "blocked") return "Blocked";
  if (clean === "downgraded") return "Downgraded";
  if (clean === "boosted") return "Boosted";
  if (clean === "restricted") return "Lock restricted";
  if (clean === "shadow") return "Shadow only";
  if (clean === "observed") return "Observed";
  return "No tracker change";
}

function getLatestSeenLineForTrackedPick(pick = {}) {
  const cl = Number(pick?.closingLine);
  return isFinite(cl) && cl > 0 ? cl : null;
}

function getTrackedPickLineMoveProxy(pick = {}) {
  const lineAtPick = Number(pick?.lineAtPick ?? pick?.line);
  const latestLine = getLatestSeenLineForTrackedPick(pick);
  const side = String(pick?.side || getPickSideFromText(pick?.predictionText || "")).toLowerCase();

  if (
    !isFinite(lineAtPick) ||
    lineAtPick <= 0 ||
    !isFinite(latestLine) ||
    !["over", "under"].includes(side)
  ) {
    return {
      state: "unknown",
      delta: null,
      latestLine: isFinite(latestLine) ? latestLine : null,
      favorable: null,
    };
  }

  const delta = Number((latestLine - lineAtPick).toFixed(2));
  if (Math.abs(delta) < 0.24) {
    return {
      state: "flat",
      delta,
      latestLine,
      favorable: null,
    };
  }

  const favorable = side === "over" ? latestLine > lineAtPick : latestLine < lineAtPick;
  return {
    state: favorable ? "favorable" : "unfavorable",
    delta,
    latestLine,
    favorable,
  };
}

function buildSettledPickRecord(items = []) {
  const base = { settled: 0, wins: 0, losses: 0, pushes: 0, winPct: NaN, netWins: 0 };
  (Array.isArray(items) ? items : []).forEach((pick) => {
    const status = String(pick?.engineResultStatus || pick?.resultStatus || "").toLowerCase();
    if (!["win", "loss", "push"].includes(status)) return;
    base.settled++;

    if (status === "win") base.wins++;
    else if (status === "loss") base.losses++;
    else if (status === "push") base.pushes++;
  });
  const winEq = base.wins + base.pushes * 0.5;
  base.winPct = base.settled ? (winEq / base.settled) * 100 : NaN;
  base.netWins = Number((base.wins - base.losses).toFixed(2));
  return base;
}

function getBestPickShadowSortScore(pick = {}) {
  const lockScore = pick?.isLock ? 1000 : 0;
  const confidenceScore = getConfidenceRank(pick?.confidenceGrade || pick?.confidence) * 100;
  // Points edge (not edge%) so quarters don't outrank FT on % alone.
  const edgeScore = isFinite(getTrackedPickEdgeAbsPoints(pick))
    ? getTrackedPickEdgeAbsPoints(pick)
    : 0;
  return lockScore + confidenceScore + edgeScore;
}

function buildBestPickOnlyShadowExperiment(items = []) {
  const settledItems = (Array.isArray(items) ? items : []).filter((pick) => {
    const status = String(pick?.resultStatus || "").toLowerCase();
    return ["win", "loss", "push"].includes(status);
  });

  const grouped = new Map();
  settledItems.forEach((pick) => {
    const eventKey = String(
      pick?.eventId ||
        pick?.matchupKey ||
        `${pick?.homeTeam || "—"}_${pick?.awayTeam || "—"}_${pick?.eventDate || ""}`,
    );
    const groupKey = [String(pick?.league || "unknown"), eventKey].join("|");
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey).push(pick);
  });

  const bestOnly = [];
  grouped.forEach((rows) => {
    const winner = rows.slice().sort((a, b) => {
      const aScore = getBestPickShadowSortScore(a) || 0;
      const bScore = getBestPickShadowSortScore(b) || 0;
      const scoreDiff = bScore - aScore;
      if (scoreDiff !== 0) return scoreDiff;
      return (
        Number(getTrackedPickEdgeAbsPoints(b) || 0) - Number(getTrackedPickEdgeAbsPoints(a) || 0)
      );
    })[0];
    if (winner) bestOnly.push(winner);
  });

  const allRecord = buildSettledPickRecord(settledItems);
  const bestRecord = buildSettledPickRecord(bestOnly);

  return {
    gameCount: grouped.size,
    rows: [
      { mode: "All tracked picks", gameCount: grouped.size, ...allRecord },
      { mode: "Best pick only", gameCount: grouped.size, ...bestRecord },
    ],
  };
}

function rebuildTrackerStats() {
  const active = Array.isArray(AppState.tracker.state.activePicks)
    ? AppState.tracker.state.activePicks
    : [];
  const archived = Array.isArray(AppState.tracker.state.archivedPicks)
    ? AppState.tracker.state.archivedPicks
    : [];
  const all = [...active, ...archived];

  const _settledForDivergence = all.filter((p) =>
    ["win", "loss", "push"].includes(String(p.resultStatus || "").toLowerCase()),
  );
  const _divergent = _settledForDivergence.filter(
    (p) =>
      p.engineResultStatus &&
      String(p.engineResultStatus).toLowerCase() !== String(p.resultStatus).toLowerCase(),
  );

  AppState.tracker.state.stats = {
    total: all.length,
    settled: all.filter((p) => p.resultStatus && p.resultStatus !== "pending").length,
    wins: all.filter((p) => p.resultStatus === "win").length,
    losses: all.filter((p) => p.resultStatus === "loss").length,
    pushes: all.filter((p) => p.resultStatus === "push").length,
    engineDivergenceCount: _divergent.length,
    engineDivergenceRate: _settledForDivergence.length
      ? parseFloat(((_divergent.length / _settledForDivergence.length) * 100).toFixed(1))
      : null,
  };

  rebuildTrackerDerivedState();

  try {
    const _settledSorted = all
      .filter((p) => ["win", "loss", "push"].includes(String(p.resultStatus || "").toLowerCase()))
      .sort((a, b) => getTrackedPickTimeMs(b) - getTrackedPickTimeMs(a));
    const _recentWindow = _settledSorted.slice(0, 30);
    if (_recentWindow.length >= 30) {
      const _recentWins = _recentWindow.filter((p) => p.resultStatus === "win").length;
      const _recentDecisive = _recentWindow.filter(
        (p) => p.resultStatus === "win" || p.resultStatus === "loss",
      ).length;
      const _recentWinRate = _recentDecisive > 0 ? (_recentWins / _recentDecisive) * 100 : null;
      if (isFinite(_recentWinRate) && _recentWinRate < 48) {
        if (!window.g_winRateAlertFired) {
          window.g_winRateAlertFired = true;
          engineDebug("WARN: Win rate below 48% over last 30 settled picks", {
            winRatePct: _recentWinRate.toFixed(1),
            decisive: _recentDecisive,
          });
        }
      } else {
        window.g_winRateAlertFired = false;
      }
    }
  } catch (_alertErr) {
    engineDebug("win-rate alert check failed", { error: _alertErr?.message || String(_alertErr) });
  }

  return AppState.tracker.state.stats;
}

// ============================================================================
// Q-SPREAD: self-backtest. This is the actual mechanism for "backtest before
// it touches a live pick" — it reads SETTLED q1-q4 tracked picks (win/loss
// only, pushes excluded) and buckets them by what quarterFormAgreement.label
// said at the moment the pick was made (SUPPORT / NEUTRAL / CONTRA), so you
// can see, with your own real results, whether recent quarter-margin form
// actually correlates with hitting or missing — before ever wiring it into
// getConfidenceGrade or a real pick decision.
//
// Every bucket carries its own sample size. Treat any bucket under ~20
// decisions as too small to act on — that's a starting point, not a
// statistically rigorous cutoff; this function reports counts precisely so
// you can apply your own standard rather than trusting a label blindly.
function getQuarterFormBacktestStats() {
  const active = Array.isArray(AppState.tracker.state.activePicks)
    ? AppState.tracker.state.activePicks
    : [];
  const archived = Array.isArray(AppState.tracker.state.archivedPicks)
    ? AppState.tracker.state.archivedPicks
    : [];
  const all = [...active, ...archived];

  const buckets = {
    SUPPORT: { wins: 0, losses: 0 },
    NEUTRAL: { wins: 0, losses: 0 },
    CONTRA: { wins: 0, losses: 0 },
  };
  function freshBucketSet() {
    return {
      SUPPORT: { wins: 0, losses: 0 },
      NEUTRAL: { wins: 0, losses: 0 },
      CONTRA: { wins: 0, losses: 0 },
    };
  }
  const byQuarter = { q1: freshBucketSet(), q2: freshBucketSet(), q3: freshBucketSet(), q4: freshBucketSet() };

  all.forEach((p) => {
    if (!p || !p.marketKey || !p.marketKey.startsWith("q")) return;
    if (!["win", "loss"].includes(String(p.resultStatus || "").toLowerCase())) return;
    const fa = p.quarterFormAgreement;
    if (!fa || !fa.reliable || !buckets[fa.label]) return;

    const isWin = String(p.resultStatus).toLowerCase() === "win";
    buckets[fa.label][isWin ? "wins" : "losses"]++;

    const qKey = p.marketKey;
    if (byQuarter[qKey]) {
      byQuarter[qKey][fa.label][isWin ? "wins" : "losses"]++;
    }
  });

  function summarize(bucketSet) {
    const out = {};
    Object.entries(bucketSet).forEach(([label, rec]) => {
      const n = rec.wins + rec.losses;
      out[label] = {
        n,
        wins: rec.wins,
        losses: rec.losses,
        winRatePct: n > 0 ? Number(((rec.wins / n) * 100).toFixed(1)) : null,
        sampleWarning: n < 20 ? "Below 20 decisions — treat as directional only, not conclusive." : null,
      };
    });
    return out;
  }

  return {
    overall: summarize(buckets),
    byQuarter: {
      q1: summarize(byQuarter.q1),
      q2: summarize(byQuarter.q2),
      q3: summarize(byQuarter.q3),
      q4: summarize(byQuarter.q4),
    },
    note:
      "Directional-only reference. This never feeds getConfidenceGrade or any pick decision automatically — read it, decide for yourself whether the gap between SUPPORT/CONTRA win rates is large enough and the sample large enough to act on.",
  };
}
window.getQuarterFormBacktestStats = getQuarterFormBacktestStats;

function repairMisclassifiedNoPlayTrackedPicks(activeList, archivedList) {
  // FIX Issue 29: do not rewrite historical/settled tickets on hydrate.
  // Only touch never-settled active rows from the current session intent.
  const marginMarkets = new Set(["winner", "handicap", "handicap_h1", "handicap_h2"]);
  let repaired = 0;
  const lists = [activeList]; // intentionally skip archivedList
  lists.forEach((list) => {
    if (!Array.isArray(list)) return;
    list.forEach((p) => {
      if (!p || p.predictionText !== "NO PLAY") return;
      const res = String(p.resultStatus || p.engineResultStatus || "").toLowerCase();
      if (res === "win" || res === "loss" || res === "push") return; // never rewrite settled
      if (p.settledAt) return;
      const grade = String(p.confidenceGrade || p.confidence || "").toUpperCase();
      if (!grade || grade === "—" || grade === "NAN") return;
      const edgeVal = Number(p.rawEdge ?? p.edge);
      const lineVal = Number(p.rawLine ?? p.line);
      const isMargin = marginMarkets.has(p.marketKey);
      const isWinnerMkt = String(p.marketKey || "").toLowerCase() === "winner";
      if (!isFinite(edgeVal)) return;
      if (!isWinnerMkt && (!isFinite(lineVal) || lineVal <= 0)) return;
      const fixedPick = isMargin
        ? getMarginPick(edgeVal, p.league, p.marketKey)
        : getPick(edgeVal, lineVal, p.league, p.marketKey, {});
      if (!fixedPick || fixedPick === "NO PLAY") return;
      p.predictionText = formatMarginPickForDisplay(
        fixedPick,
        p.marketKey,
        p.homeTeam || "Team A",
        p.awayTeam || "Team B",
        lineVal,
      );
      p.smartLineRepaired = true;
      repaired++;
    });
  });
  if (repaired > 0) {
    engineDebug("Repaired mis-tagged NO PLAY tracked picks (smart-line/advisory sync bug)", {
      repaired,
    });
  }
  return repaired;
}

function normalizeTrackerState(raw) {
  const remoteLineMemory =
    raw?.lineMemory && typeof raw.lineMemory === "object" ? raw.lineMemory : {};

  const normalizedActive = Array.isArray(raw?.activePicks)
    ? raw.activePicks.map((p) => ensureTrackedPickKeys(p)).slice(0, TRACKED_PICKS_LIMIT)
    : [];
  const normalizedArchived = Array.isArray(raw?.archivedPicks)
    ? raw.archivedPicks.map((p) => ensureTrackedPickKeys(p)).slice(0, TRACKER_ARCHIVED_LIMIT)
    : [];
  const reconciled = reconcileTrackerBucketConflicts(normalizedActive, normalizedArchived);
  repairMisclassifiedNoPlayTrackedPicks(reconciled.activePicks, reconciled.archivedPicks);

  AppState.tracker.state = {
    vId: raw?.vId || Date.now(),
    sId: raw?.sId || window.__BETCEO_SESSION_ID,
    activePicks: reconciled.activePicks,
    archivedPicks: reconciled.archivedPicks,
    shadowPicks: Array.isArray(raw?.shadowPicks)
      ? raw.shadowPicks.map((p) => ensureTrackedPickKeys(p))
      : [],
    deletedSignatures: Array.isArray(raw?.deletedSignatures) ? raw.deletedSignatures : [],
    stats: {
      total: Number(raw?.stats?.total) || 0,
      settled: Number(raw?.stats?.settled) || 0,
      wins: Number(raw?.stats?.wins) || 0,
      losses: Number(raw?.stats?.losses) || 0,
      pushes: Number(raw?.stats?.pushes) || 0,
    },
    updatedAt: raw?.updatedAt || null,
    lineMemory: {},
  };

  rebuildTrackerStats();
  return AppState.tracker.state;
}

function ensureFreshBuild() {
  try {
    const seenBuild = localStorage.getItem(STANDALONE_BUILD_MARKER) || "";
    const url = new URL(window.location.href);
    const hasBuild = url.searchParams.get("_build") === APP_BUILD_VERSION;

    if (seenBuild === APP_BUILD_VERSION && hasBuild) return false;

    localStorage.setItem(STANDALONE_BUILD_MARKER, APP_BUILD_VERSION);

    const isPWA =
      window.navigator.standalone || window.matchMedia("(display-mode: standalone)").matches;

    if (!hasBuild && !isPWA) {
      url.searchParams.set("_build", APP_BUILD_VERSION);
      url.searchParams.set("_ts", String(Date.now()));
      window.location.replace(url.toString());
      return true;
    }
  } catch (err) {
    console.error("[BB Engine] ensureFreshBuild failed", err);
  }

  return false;
}

function isTrackerStateMeaningfullyEmpty(state) {
  if (!state) return true;
  const active = Array.isArray(state.activePicks) ? state.activePicks.length : 0;
  const archived = Array.isArray(state.archivedPicks) ? state.archivedPicks.length : 0;
  return active === 0 && archived === 0;
}

async function pushTrackerStateToServer(state, isExit = false) {
  if (isTrackerStateMeaningfullyEmpty(state)) return { ok: true };

  g_trackerSaveInFlight = true;
  renderTrackerAnalytics();

  try {
    let stateToPush = state;

    const rawSize = (() => {
      try {
        return JSON.stringify(state).length;
      } catch (e) {
        return 999999;
      }
    })();
    if (isExit || rawSize > 60000) {
      const leanActive = (state.activePicks || []).map((p) => {
        const { diagnostics, ...rest } = p;
        return rest;
      });
      stateToPush = { ...state, activePicks: leanActive, archivedPicks: [], lineMemory: {} };
    }

    let payload;
    try {
      payload = JSON.stringify(stateToPush);
    } catch (serializeErr) {
      trackerDebug("pushTrackerStateToServer: serialization failed — skipping push", {
        error: serializeErr.message,
      });
      return { ok: false };
    }

    const { res, data } = await fetchTrackerJson(TRACKER_API_URL, {
      method: "POST",
      body: payload,
      headers: getTrackerHeaders(true),
      keepalive: !!isExit,
    });

    if (!res.ok) {
      trackerDebug("Cloudflare push rejected: " + res.status + " — local copy preserved");
      return { ok: false };
    }

    g_trackerSaveFailureCount = 0;
    g_trackerPersistedVersion = state.vId || g_trackerSaveVersion;
    return { ok: true, state: data?.state };
  } catch (err) {
    const errMsg = String(err?.message || err).toLowerCase();
    const isNetworkError =
      errMsg.includes("load failed") ||
      errMsg.includes("fetch") ||
      errMsg.includes("networkerror") ||
      errMsg.includes("aborted") ||
      errMsg.includes("timeout");

    g_trackerSaveFailureCount = (g_trackerSaveFailureCount || 0) + 1;

    if (!isExit && g_trackerSaveFailureCount <= 2 && !isNetworkError) {
      const delay = Math.min(1500 * Math.pow(2, g_trackerSaveFailureCount), 20000);
      setTimeout(() => {
        pushTrackerStateToServer(state, false).catch(() => {});
      }, delay);
    }

    if (!isNetworkError) {
      trackerDebug("flush save failed — local copy preserved", {
        error: err?.message || String(err),
      });
    }
    return { ok: false };
  } finally {
    g_trackerSaveInFlight = false;
    renderTrackerAnalytics();
  }
}

async function flushTrackerSave() {
  if (isTrackerStateMeaningfullyEmpty(AppState.tracker.state)) return;

  try {
    await saveTrackerStateToLocal();
  } catch (localErr) {
    trackerDebug("flush save: local write failed", {
      error: String(localErr?.message || localErr),
    });
    return;
  }
  try {
    const snapshot = JSON.parse(JSON.stringify(AppState.tracker.state));
    const pushed = await pushTrackerStateToServer(snapshot);
    if (pushed && pushed.ok && pushed.state) {
      const merged = mergeTrackerStates(snapshot, pushed.state);
      normalizeTrackerState(merged);
      await saveTrackerStateToLocal();
    }
  } catch (err) {
    const errMsg = String(err?.message || err).toLowerCase();
    if (!errMsg.includes("load failed") && !errMsg.includes("networkerror")) {
      trackerDebug("flush save push error (non-network)", { error: String(err?.message || err) });
    }
  }
}

function scheduleTrackerSave(delayMs = TRACKER_SAVE_DEBOUNCE_MS) {
  if (g_trackerSaveTimer) clearTimeout(g_trackerSaveTimer);
  g_trackerSaveTimer = setTimeout(() => {
    g_trackerSaveTimer = null;
    flushTrackerSave();
  }, delayMs);
}

async function forceTrackerSaveNow() {
  clearTrackerFollowupRefresh();

  if (g_trackerSaveTimer) {
    clearTimeout(g_trackerSaveTimer);
    g_trackerSaveTimer = null;
  }

  AppState.tracker.state.updatedAt = new Date().toISOString();
  await saveTrackerStateToLocal();
  g_trackerSaveVersion = Math.max(g_trackerSaveVersion + 1, g_trackerPersistedVersion + 1);

  try {
    await flushTrackerSave();
  } catch (err) {
    console.error("[BB Engine] forceTrackerSaveNow failed", err);
  }
}

function withTrackerCacheBust(url) {
  try {
    const u = new URL(url, window.location.href);
    u.searchParams.set("_build", APP_BUILD_VERSION);
    u.searchParams.set("_ts", String(Date.now()));
    return u.toString();
  } catch (err) {
    const joiner = String(url).includes("?") ? "&" : "?";
    return (
      String(url) +
      joiner +
      "_build=" +
      encodeURIComponent(APP_BUILD_VERSION) +
      "&_ts=" +
      Date.now()
    );
  }
}

async function fetchTrackerJson(url, options = {}, timeoutMs = TRACKER_NETWORK_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const method = String(options?.method || "GET").toUpperCase();

  const joiner = url.includes("?") ? "&" : "?";
  let finalUrl = url + `${joiner}user=${encodeURIComponent(getTrackerUserKey())}`;

  if (method === "GET") {
    finalUrl = withTrackerCacheBust(finalUrl);
  }

  try {
    let res;
    try {
      res = await fetch(finalUrl, {
        ...options,
        cache: "no-store",
        signal: ctrl.signal,
      });
    } catch (fetchErr) {
      if (fetchErr.name === "DataCloneError" || String(fetchErr).includes("clone")) {
        res = await fetch(finalUrl, {
          ...options,
          cache: "no-store",
        });
      } else {
        throw fetchErr;
      }
    }

    const text = await res.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (err) {
      if (res.ok) throw new Error("Tracker returned invalid JSON");
    }

    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

const ONE_TIME_PENDING_WIPE_KEY = "BB_ONE_TIME_PENDING_WIPE_2026_08_06";
async function runOneTimePendingWipe() {
  try {
    if (localStorage.getItem(ONE_TIME_PENDING_WIPE_KEY)) return;
    localStorage.setItem(ONE_TIME_PENDING_WIPE_KEY, "1");

    const result = await clearAllPendingTrackedPicks();
    if (result && result.removed) {
      engineDebug("one-time pending wipe complete", result);
    }
  } catch (e) {
    engineDebug("one-time pending wipe failed: " + (e?.message || String(e)), { error: e });
  }
}

async function primeTrackerStateForRun() {
  const localState = await loadTrackerStateFromLocal();

  if (localState) {
    normalizeTrackerState(localState);
  } else {
    g_trackerState = createEmptyTrackerState();
    rebuildTrackerDerivedState();
  }

  renderTrackedPicks();

  await hydrateTrackedPicks(true);

  await runOneTimePendingWipe();

  g_trackerSaveFailureCount = 0;
}

function clearTrackerFollowupRefresh() {
  if (g_trackerFollowupTimer) {
    clearTimeout(g_trackerFollowupTimer);
    g_trackerFollowupTimer = null;
  }
}

function queueTrackerFollowupRefresh(delayMs = 1200) {
  clearTrackerFollowupRefresh();
  g_trackerFollowupTimer = setTimeout(() => {
    g_trackerFollowupTimer = null;
    throttledRefreshBackground(true);
  }, delayMs);
}
function throttledRefreshBackground(force = false) {
  const now = Date.now();
  if (!force && now - _lastBackgroundSync < BACKGROUND_SYNC_THROTTLE_MS) return;
  _lastBackgroundSync = now;
  refreshTrackerInBackground(force);
}

async function refreshTrackerInBackground(forceHydrate = false) {
  if (g_refreshTrackedPicksInFlight || window.__engineRunInProgress) {
    if (forceHydrate) queueTrackerFollowupRefresh(2000);
    return;
  }
  g_refreshTrackedPicksInFlight = true;
  try {
    await hydrateTrackedPicks(forceHydrate);
    await refreshTrackedPickResults();
    const _activeEids = new Set(
      (g_trackerState.activePicks || [])
        .filter(
          (p) => String(p?.resultStatus || "pending").toLowerCase() === "pending" && p?.eventId,
        )
        .map((p) => p.eventId),
    );
    [...g_liveGameStatus.keys()].forEach((eid) => {
      if (!_activeEids.has(eid)) g_liveGameStatus.delete(eid);
    });
    await forceTrackerSaveNow();
    engineDebug("Watchdog: Settle/Sync cycle complete.", "engine");
    scheduleLiveClockPoll();
    renderTrackedPicks();
  } catch (err) {
    console.error("[BB Engine] refresh failed", err);
  } finally {
    g_refreshTrackedPicksInFlight = false;
  }
}

let _liveClockPollTimer = null;
let _liveTickTimer = null;

function parseClockToSeconds(clockStr) {
  if (!clockStr || clockStr === "HALF") return null;
  const parts = String(clockStr).split(":");
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10);
    const s = parseInt(parts[1], 10);
    return isFinite(m) && isFinite(s) ? m * 60 + s : null;
  }
  const raw = parseFloat(clockStr);
  return isFinite(raw) ? raw : null;
}

function secondsToClock(secs) {
  const safe = Math.max(0, Math.floor(Number(secs) || 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function _tickLiveClocks() {
  if (document.hidden) return;
  if (g_liveGameStatus.size === 0) {
    stopLiveClockTicker();
    return;
  }

  const expiredEventIds = [];

  document.querySelectorAll("[data-live-clk]").forEach((el) => {
    const eid = el.dataset.liveClk;
    const info = g_liveGameStatus.get(eid);
    if (!info || info.clock === "HALF") return;

    const capturedAt = info.capturedAt || Date.now();
    const origSecs = parseClockToSeconds(info.clock);
    if (origSecs === null) return;

    const elapsedSecs = Math.min((Date.now() - capturedAt) / 1000, origSecs);
    const currentSecs = Math.max(0, origSecs - elapsedSecs);

    if (info.clockFrozen) {
      const _regP = LEAGUE_FETCH_RULES[info.league || ""]?.regulationPeriods ?? 4;
      const _p = Number(info.period || 0);
      const _frozenSecs = parseClockToSeconds(info.clock);
      if (_p === 0) {
        el.textContent = "⏸ TIMEOUT";
      } else {
        el.textContent = `${isFinite(_frozenSecs) ? secondsToClock(_frozenSecs) : info.clock} ⏸`;
      }
      return;
    }

    if (currentSecs <= 0) {
      const _regP = LEAGUE_FETCH_RULES[info.league || ""]?.regulationPeriods ?? 4;
      const _p = Number(info.period || 0);
      if (_p > 0 && _p < _regP) {
        el.textContent = `Q${_p} Break`;
      } else {
        el.textContent = "Settling";
        if (!info._expiredAt) {
          info._expiredAt = Date.now();
          expiredEventIds.push(eid);
        }
      }
    } else {
      const _regP = LEAGUE_FETCH_RULES[info.league || ""]?.regulationPeriods ?? 4;
      const _p = Number(info.period || 0);
      if (_p === 0) {
        el.textContent = "LIVE";
      } else {
        el.textContent = secondsToClock(currentSecs);
      }
    }
  });

  if (expiredEventIds.length && !g_refreshTrackedPicksInFlight) {
    setTimeout(() => refreshTrackerInBackground(true), 2000);
  }
}

function startLiveClockTicker() {
  stopLiveClockTicker();
  if (g_liveGameStatus.size === 0) return;
  _liveTickTimer = setInterval(_tickLiveClocks, 1000);
}

function stopLiveClockTicker() {
  if (_liveTickTimer) {
    clearInterval(_liveTickTimer);
    _liveTickTimer = null;
  }
}

function scheduleLiveClockPoll() {
  clearTimeout(_liveClockPollTimer);
  _liveClockPollTimer = null;
  if (g_liveGameStatus.size === 0) return;
  _liveClockPollTimer = setTimeout(async () => {
    _liveClockPollTimer = null;
    await pollLiveGameClocks();
  }, 28000);
}

async function pollLiveGameClocks() {
  if (g_liveGameStatus.size === 0) return;
  const active = Array.isArray(g_trackerState?.activePicks) ? g_trackerState.activePicks : [];
  const byLeague = new Map();
  active.forEach((p) => {
    if (!p?.eventId || !g_liveGameStatus.has(p.eventId)) return;
    if (!byLeague.has(p.league)) byLeague.set(p.league, new Set());
    byLeague.get(p.league).add(p.eventId);
  });
  if (!byLeague.size) {
    g_liveGameStatus.clear();
    renderTrackedPicks();
    return;
  }
  let didChange = false;
  for (const [league, eventIds] of byLeague) {
    const base = getTrackedLeagueApiBase(league);
    if (!base) continue;
    try {
      let data = null;
      try {
        const res = await fetch(`${base}/scoreboard?_=${Date.now()}`, { cache: "no-store" });
        if (res.ok) data = await res.json();
      } catch (e) {
        data = await proxyFetch(`${base}/scoreboard`, 6000).catch(() => null);
      }
      if (!data) continue;
      const events = data?.events || [];
      events.forEach((ev) => {
        const eid = String(ev.id || "");
        if (!eventIds.has(eid)) return;
        const comp = ev?.competitions?.[0];
        if (!comp) return;
        const completed = !!(
          comp?.status?.type?.completed ||
          comp?.status?.type?.state === "post" ||
          comp?.status?.type?.name === "STATUS_FINAL"
        );
        if (completed) {
          g_liveGameStatus.delete(eid);
          didChange = true;
          return;
        }
        const state = String(comp?.status?.type?.state || "");
        const statusName = String(comp?.status?.type?.name || "");
        const clock = String(comp?.status?.displayClock || "");
        const period = Number(comp?.status?.period || 0);
        const isHalf = statusName.toUpperCase().includes("HALFTIME");
        const isLive = state === "in" || isHalf || statusName.toUpperCase().includes("PROGRESS");
        if (isLive) {
          const existing = g_liveGameStatus.get(eid);
          const newClock = isHalf ? "HALF" : clock;
          if (existing?._expiredAt && Date.now() - existing._expiredAt > 5 * 60 * 1000) {
            g_liveGameStatus.delete(eid);
            didChange = true;
            return;
          }
          const _pCompetitors = comp?.competitors || [];
          const _pHome = _pCompetitors.find((c) => c.homeAway === "home");
          const _pAway = _pCompetitors.find((c) => c.homeAway === "away");
          const _pHomeScore = _pHome ? parseFloat(_pHome.score) || 0 : null;
          const _pAwayScore = _pAway ? parseFloat(_pAway.score) || 0 : null;
          const _pHomeLS = (_pHome?.linescores || []).map(
            (l) => parseFloat(l.value ?? l.displayValue ?? 0) || 0,
          );
          const _pAwayLS = (_pAway?.linescores || []).map(
            (l) => parseFloat(l.value ?? l.displayValue ?? 0) || 0,
          );
          const _pQScores =
            _pHomeLS.length && _pAwayLS.length
              ? { home: _pHomeLS, away: _pAwayLS }
              : existing?.qScores || null;
          if (!existing || existing.period !== period || existing.clock !== newClock) {
            g_liveGameStatus.set(eid, {
              period,
              clock: newClock,
              statusName,
              league,
              capturedAt: Date.now(),
              clockFrozen: false,
              homeScore: _pHomeScore,
              awayScore: _pAwayScore,
              qScores: _pQScores,
              _expiredAt: existing?._expiredAt ?? null,
            });
            didChange = true;
          } else if (existing && !existing._expiredAt && newClock !== "HALF") {
            if (!existing.clockFrozen) {
              existing.clockFrozen = true;
              didChange = true;
            }
            if (
              _pHomeScore !== null &&
              (existing.homeScore !== _pHomeScore || existing.awayScore !== _pAwayScore)
            ) {
              existing.homeScore = _pHomeScore;
              existing.awayScore = _pAwayScore;
              didChange = true;
            }
            if (_pQScores && _pQScores.home?.length) {
              existing.qScores = _pQScores;
              didChange = true;
            }
          }
        } else if (state === "pre") {
          g_liveGameStatus.delete(eid);
          didChange = true;
        }
      });
    } catch (err) {
      engineDebug("live game status update failed", { error: err?.message || String(err) });
    }
  }
  if (didChange) renderTrackedPicks();
  scheduleLiveClockPoll();
}

async function hydrateTrackedPicks(force = false) {
  if (g_trackerHydratePromise && !force) return g_trackerHydratePromise;
  if (g_trackerHydratePromise && force) {
    await g_trackerHydratePromise.catch(() => {});
  }
  g_trackerHydratePromise = (async () => {
    trackerDebug("hydrate start", { force, key: getTrackerUserKey() });
    const localState = (await loadTrackerStateFromLocal()) || createEmptyTrackerState();

    const hadLocalState =
      !!localState &&
      ((Array.isArray(localState.activePicks) && localState.activePicks.length > 0) ||
        (Array.isArray(localState.archivedPicks) && localState.archivedPicks.length > 0));

    if (localState) {
      normalizeTrackerState(localState);
      trackerDebug("hydrate local state found", {
        active: getTrackerActivePickCount(localState),
        archived: getTrackerArchivedPickCount(localState),
        pending: getPendingActivePickCount(localState),
        settled: Number(localState?.stats?.settled || 0),
      });
    } else {
      trackerDebug("hydrate local state empty", { key: getTrackerUserKey() });
    }

    try {
      const { res, data } = await fetchTrackerJson(TRACKER_API_URL, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        headers: getTrackerHeaders(false),
      });

      if (!res.ok) {
        trackerDebug("Server unavailable — using local state", { status: res.status });
        return localState;
      }

      if (!data?.state) {
        trackerDebug("No server state — using local");
        return localState;
      }

      const serverState = data.state || {};

      engineDebug("hydrate state snapshot", {
        local: getTrackerStateDebugScore(localState || {}),
        server: getTrackerStateDebugScore(serverState || {}),
      });
      trackerDebug("hydrate server state loaded", {
        active: getTrackerActivePickCount(serverState),
        archived: getTrackerArchivedPickCount(serverState),
        pending: getPendingActivePickCount(serverState),
        settled: Number(serverState?.stats?.settled || 0),
      });
      const serverHasState =
        (Array.isArray(serverState.activePicks) && serverState.activePicks.length > 0) ||
        (Array.isArray(serverState.archivedPicks) && serverState.archivedPicks.length > 0);

      if (hadLocalState && !serverHasState) {
        await forceTrackerSaveNow();
        return g_trackerState;
      }

      const mergedState = mergeTrackerStates(localState || {}, serverState);
      normalizeTrackerState(mergedState);
      saveTrackerStateToLocal();
      trackerDebug("hydrate merged state", {
        active: getTrackerActivePickCount(mergedState),
        archived: getTrackerArchivedPickCount(mergedState),
        pending: getPendingActivePickCount(mergedState),
        settled: Number(mergedState?.stats?.settled || 0),
      });

      const localPendingActive = getPendingActivePickCount(localState);
      const serverPendingActive = getPendingActivePickCount(serverState);
      const mergedPendingActive = getPendingActivePickCount(mergedState);

      const localActiveCount = getTrackerActivePickCount(localState);
      const serverActiveCount = getTrackerActivePickCount(serverState);
      const mergedActiveCount = getTrackerActivePickCount(mergedState);

      const localArchivedCount = getTrackerArchivedPickCount(localState);
      const serverArchivedCount = getTrackerArchivedPickCount(serverState);
      const mergedArchivedCount = getTrackerArchivedPickCount(mergedState);

      const localSettledCount = Number(localState?.stats?.settled || 0);
      const serverSettledCount = Number(serverState?.stats?.settled || 0);
      const mergedSettledCount = Number(mergedState?.stats?.settled || 0);
      const localWins = Number(localState?.stats?.wins || 0);
      const serverWins = Number(serverState?.stats?.wins || 0);
      const mergedWins = Number(mergedState?.stats?.wins || 0);
      const localLosses = Number(localState?.stats?.losses || 0);
      const serverLosses = Number(serverState?.stats?.losses || 0);
      const mergedLosses = Number(mergedState?.stats?.losses || 0);
      const localPushes = Number(localState?.stats?.pushes || 0);
      const serverPushes = Number(serverState?.stats?.pushes || 0);
      const mergedPushes = Number(mergedState?.stats?.pushes || 0);

      const shouldPushMerged =
        mergedPendingActive < serverPendingActive ||
        localPendingActive < serverPendingActive ||
        mergedActiveCount > serverActiveCount ||
        localArchivedCount > serverArchivedCount ||
        mergedArchivedCount > serverArchivedCount ||
        localSettledCount > serverSettledCount ||
        mergedSettledCount > serverSettledCount ||
        localWins > serverWins ||
        mergedWins > serverWins ||
        localLosses > serverLosses ||
        mergedLosses > serverLosses ||
        localPushes > serverPushes ||
        mergedPushes > serverPushes ||
        (hadLocalState && !serverHasState);

      if (shouldPushMerged) {
        try {
          g_trackerState.updatedAt = new Date().toISOString();
          const hydrateSnapshot = JSON.parse(JSON.stringify(g_trackerState));
          const pushed = await pushTrackerStateToServer(hydrateSnapshot);
          if (pushed?.ok && pushed?.state) {
            const hydrateMerged = mergeTrackerStates(hydrateSnapshot, pushed.state);
            normalizeTrackerState(hydrateMerged);
            saveTrackerStateToLocal();
          }
        } catch (pushErr) {
          console.error("[BB Engine] hydrateTrackedPicks merge push failed", pushErr);
        }
      }

      return g_trackerState;
    } catch (err) {
      console.error("[BB Engine] hydrateTrackedPicks failed", err);

      if (hadLocalState) {
        return g_trackerState;
      }

      const emptyState = createEmptyTrackerState();
      g_trackerState = emptyState;
      return emptyState;
    } finally {
      archiveExpiredTrackedPicks();
      renderTrackedPicks();
      g_trackerHydratePromise = null;
    }
  })();

  return g_trackerHydratePromise;
}

function createEmptyTrackerState() {
  return {
    vId: 1,
    sId: window.__BETCEO_SESSION_ID,
    activePicks: [],
    archivedPicks: [],
    shadowPicks: [],
    stats: { total: 0, settled: 0, wins: 0, losses: 0, pushes: 0 },
    updatedAt: new Date().toISOString(),
    lineMemory: {},
  };
}

function getPendingActivePickCount(state) {
  const active = Array.isArray(state?.activePicks) ? state.activePicks : [];
  const now = Date.now();
  return active.filter((p) => {
    const status = String(p?.resultStatus || "pending").toLowerCase();
    const gameTs = safeParseDate(p.eventDate || p.createdAt);
    const isTooOld = gameTs > 0 && now - gameTs > 48 * 60 * 60 * 1000;
    return status === "pending" && !isTooOld;
  }).length;
}

function getTrackerActivePickCount(state) {
  return Array.isArray(state?.activePicks) ? state.activePicks.length : 0;
}

function getTrackerArchivedPickCount(state) {
  return Array.isArray(state?.archivedPicks) ? state.archivedPicks.length : 0;
}

function getTrackerPickStamp(pick) {
  return (
    Date.parse(pick?.settledAt || "") ||
    Date.parse(pick?.createdAt || "") ||
    Date.parse(pick?.eventDate || "") ||
    0
  );
}

function makeTrackerActiveMergeKey(pick = {}) {
  const safe = ensureTrackedPickKeys(pick);
  return [
    String(safe.eventId || ""),
    String(safe.marketKey || ""),
    String(safe.side || "").toLowerCase(),
  ].join("|");
}

function getPickStateWeight(status) {
  const s = String(status || "pending").toLowerCase();
  return s === "win" || s === "loss" || s === "push" ? 1 : 0;
}

function resolveTrackedPick(localPick, serverPick) {
  const local = ensureTrackedPickKeys(localPick || {});
  const server = ensureTrackedPickKeys(serverPick || {});

  const lManual = safeParseDate(local.manualSettledAt);
  const sManual = safeParseDate(server.manualSettledAt);
  if (lManual || sManual) {
    if (lManual > sManual) return local;
    if (sManual > lManual) return server;
  }

  const getWeight = (p) =>
    ["win", "loss", "push"].includes(String(p.resultStatus || "").toLowerCase()) ? 1 : 0;

  const lW = getWeight(local);
  const sW = getWeight(server);

  if (lW > sW) return local;
  if (sW > lW) return server;

  if (local.actualScore && !server.actualScore) return local;
  if (server.actualScore && !local.actualScore) return server;

  // FIX Issue 30: when both settled with actuals, prefer later settledAt, then API source.
  const lSettled = safeParseDate(local.settledAt);
  const sSettled = safeParseDate(server.settledAt);
  if (lSettled || sSettled) {
    if (sSettled > lSettled) return server;
    if (lSettled > sSettled) return local;
  }
  const lApi = String(local.settlementSource || "").toLowerCase() === "api";
  const sApi = String(server.settlementSource || "").toLowerCase() === "api";
  if (sApi && !lApi) return server;
  if (lApi && !sApi) return local;

  return local;
}

function isPickDeleted(pick, deletedList = []) {
  if (!pick || !deletedList || !deletedList.length) return false;
  const deletedSet = new Set(deletedList);
  const sig1 = makeTrackedSignature(pick);
  const sig2 = makeTrackerActiveMergeKey(pick);
  const sig3 = pick.signature;
  const sig4 = pick.pickId;
  return (
    deletedSet.has(sig1) || deletedSet.has(sig2) || deletedSet.has(sig3) || deletedSet.has(sig4)
  );
}

function mergeTrackerStates(localState, serverState) {
  const local = localState || {};
  const server = serverState || {};

  const localTs = safeParseDate(local.updatedAt);
  const serverTs = safeParseDate(server.updatedAt);
  const useServerStats = serverTs > localTs;

  const mergedDeleted = [
    ...new Set([
      ...(Array.isArray(local.deletedSignatures) ? local.deletedSignatures : []),
      ...(Array.isArray(server.deletedSignatures) ? server.deletedSignatures : []),
    ]),
  ];

  return {
    vId: Math.max(local.vId || 1, server.vId || 1) + 1,
    sId: server.sId || local.sId,
    activePicks: mergeTrackerActivePicks(
      local.activePicks,
      server.activePicks,
      local.archivedPicks,
      mergedDeleted,
    ),
    archivedPicks: mergeTrackerArchivedPicks(
      local.archivedPicks,
      server.archivedPicks,
      mergedDeleted,
    ),
    deletedSignatures: mergedDeleted,
    stats: useServerStats ? server.stats || local.stats : local.stats || server.stats,
    updatedAt: new Date().toISOString(),
    lineMemory: { ...(local.lineMemory || {}), ...(server.lineMemory || {}) },
  };
}

function mergeTrackerActivePicks(
  localActive = [],
  serverActive = [],
  localArchived = [],
  deletedSignatures = [],
) {
  const merged = new Map();

  const settledArchivedKeys = new Set();
  (localArchived || []).forEach((raw) => {
    const pick = ensureTrackedPickKeys(raw || {});
    if (!isTrackedPickSettled(pick) || isPickDeleted(pick, deletedSignatures)) return;
    const slotKey = makeTrackerActiveMergeKey(pick);
    if (slotKey) settledArchivedKeys.add(slotKey);
  });

  (localActive || []).forEach((raw) => {
    const pick = ensureTrackedPickKeys(raw || {});
    if (isPickDeleted(pick, deletedSignatures)) return;
    const key = makeTrackerActiveMergeKey(pick) || makeTrackedSignature(pick);
    if (key) merged.set(key, pick);
  });

  (serverActive || []).forEach((raw) => {
    const pick = ensureTrackedPickKeys(raw || {});
    if (isPickDeleted(pick, deletedSignatures)) return;
    const key = makeTrackerActiveMergeKey(pick) || makeTrackedSignature(pick);
    if (!key) return;

    const slotKey = makeTrackerActiveMergeKey(pick);
    if (slotKey && settledArchivedKeys.has(slotKey)) return;

    if (!merged.has(key)) {
      merged.set(key, pick);
    } else {
      merged.set(key, resolveTrackedPick(merged.get(key), pick));
    }
  });

  return [...merged.values()]
    .sort((a, b) => getTrackerPickStamp(b) - getTrackerPickStamp(a))
    .slice(0, TRACKED_PICKS_LIMIT);
}

function mergeTrackerArchivedPicks(
  localArchived = [],
  serverArchived = [],
  deletedSignatures = [],
) {
  const merged = new Map();

  (localArchived || []).forEach((raw) => {
    const pick = ensureTrackedPickKeys(raw || {});
    if (isPickDeleted(pick, deletedSignatures)) return;
    const key = makeTrackedSignature(pick);
    if (key) merged.set(key, pick);
  });

  (serverArchived || []).forEach((raw) => {
    const pick = ensureTrackedPickKeys(raw || {});
    if (isPickDeleted(pick, deletedSignatures)) return;
    const key = makeTrackedSignature(pick);
    if (!key) return;

    if (!merged.has(key)) {
      merged.set(key, pick);
    } else {
      merged.set(key, resolveTrackedPick(merged.get(key), pick));
    }
  });

  return [...merged.values()]
    .sort((a, b) => getTrackerPickStamp(b) - getTrackerPickStamp(a))
    .slice(0, TRACKER_ARCHIVED_LIMIT);
}

function isTrackedPickSettled(pick) {
  const status = String(pick?.resultStatus || "pending").toLowerCase();
  return status === "win" || status === "loss" || status === "push";
}

function choosePreferredBucketPick(existingPick, incomingPick) {
  const current = ensureTrackedPickKeys(existingPick || {});
  const incoming = ensureTrackedPickKeys(incomingPick || {});

  const currManual = safeParseDate(current.manualSettledAt);
  const incManual = safeParseDate(incoming.manualSettledAt);
  if (currManual || incManual) {
    if (currManual > incManual) return current;
    if (incManual > currManual) return incoming;
  }

  const currentWeight = getPickStateWeight(current.resultStatus);
  const incomingWeight = getPickStateWeight(incoming.resultStatus);

  if (incomingWeight > currentWeight) return incoming;
  if (currentWeight >= incomingWeight) return current;

  return current;
}

function reconcileTrackerBucketConflicts(activePicks = [], archivedPicks = []) {
  const active = Array.isArray(activePicks) ? activePicks.map((p) => ensureTrackedPickKeys(p)) : [];
  const archived = Array.isArray(archivedPicks)
    ? archivedPicks.map((p) => ensureTrackedPickKeys(p))
    : [];

  const archivedBySlot = new Map();
  archived.forEach((pick) => {
    const slotKey = makeTrackerActiveMergeKey(pick);
    if (!slotKey) return;
    if (!archivedBySlot.has(slotKey)) {
      archivedBySlot.set(slotKey, pick);
      return;
    }
    archivedBySlot.set(slotKey, choosePreferredBucketPick(archivedBySlot.get(slotKey), pick));
  });

  const activeBySlot = new Map();
  active.forEach((pick) => {
    const slotKey = makeTrackerActiveMergeKey(pick) || makeTrackedSignature(pick);
    if (!slotKey) return;

    const archivedPick = archivedBySlot.get(makeTrackerActiveMergeKey(pick));
    if (archivedPick) {
      const activeManual = safeParseDate(pick.manualSettledAt);
      const archivedManual = safeParseDate(archivedPick.manualSettledAt);

      if (activeManual && activeManual > archivedManual) {
        archivedBySlot.delete(makeTrackerActiveMergeKey(pick));
      } else {
        const archivedSettled = isTrackedPickSettled(archivedPick);
        const activeSettled = isTrackedPickSettled(pick);

        if (archivedSettled && !activeSettled) return;

        if (archivedSettled && activeSettled) {
          const _archiveTs = safeParseDate(
            archivedPick.settledAt || archivedPick.eventDate || archivedPick.createdAt,
          );
          const _cutoffMs = 10 * 60 * 60 * 1000;
          if (_archiveTs === 0 || Date.now() - _archiveTs >= _cutoffMs) return;
          const preferred = choosePreferredBucketPick(pick, archivedPick);
          if (preferred === archivedPick) return;
        }
      }
    }

    if (!activeBySlot.has(slotKey)) {
      activeBySlot.set(slotKey, pick);
      return;
    }
    activeBySlot.set(slotKey, choosePreferredBucketPick(activeBySlot.get(slotKey), pick));
  });

  const keepActive = [...activeBySlot.values()]
    .sort((a, b) => getTrackerPickStamp(b) - getTrackerPickStamp(a))
    .slice(0, TRACKED_PICKS_LIMIT);
  const keepActiveBySlot = new Map();
  keepActive.forEach((pick) => {
    const slotKey = makeTrackerActiveMergeKey(pick);
    if (!slotKey) return;
    keepActiveBySlot.set(slotKey, pick);
  });

  const keepArchived = archived.filter((pick) => {
    const slotKey = makeTrackerActiveMergeKey(pick);
    if (!slotKey) return true;
    if (keepActiveBySlot.get(slotKey)) return false;
    return true;
  });

  return {
    activePicks: keepActive,
    archivedPicks: mergeTrackerArchivedPicks([], keepArchived),
  };
}

function archiveExpiredTrackedPicks() {
  const active = Array.isArray(AppState.tracker.state.activePicks)
    ? AppState.tracker.state.activePicks
    : [];
  const archived = Array.isArray(AppState.tracker.state.archivedPicks)
    ? AppState.tracker.state.archivedPicks
    : [];
  const now = Date.now();
  const cutoffMs = 10 * 60 * 60 * 1000;

  const stripHeavyData = (pick) => {
    const lean = { ...pick };
    if (lean.diagnostics) {
      lean.godsEyeMemory = {
        pace: lean.diagnostics.pace,
        netA: lean.diagnostics.netA,
        netB: lean.diagnostics.netB,
        aVol: lean.diagnostics.aVol,
        bVol: lean.diagnostics.bVol,
      };
    }
    delete lean.diagnostics;
    delete lean.massacre;
    delete lean.trackerFeedback;
    delete lean.shadowTrackerFeedback;
    delete lean.teamMemory;
    delete lean.intelligence;
    delete lean.shadowIntelligence;
    return lean;
  };

  const keepActive = [];
  const moveToArchived = [];
  let changed = false;
  const pruneCutoffMs = BB_CONFIG.limits.archivePruneDays * 24 * 60 * 60 * 1000;

  active.forEach((pick) => {
    const p = ensureTrackedPickKeys({ ...pick });
    const isSettled = ["win", "loss", "push"].includes(String(p.resultStatus || "").toLowerCase());
    const gameTs = safeParseDate(p.eventDate) || safeParseDate(p.createdAt) || 0;
    const refTs = gameTs > 0 ? gameTs : safeParseDate(p.settledAt) || 0;
    const isExpired = refTs > 0 && now - (refTs + 3 * 60 * 60 * 1000) >= cutoffMs;
    const isTimestamplessSettled = refTs === 0 && isSettled;
    const isGhost = isSettled && gameTs > 0 && (now - gameTs) / (1000 * 60 * 60 * 24) > 7;
    if ((isSettled && isExpired) || isTimestamplessSettled || isGhost) {
      moveToArchived.push(stripHeavyData(p));
      changed = true;
    } else {
      keepActive.push(p);
    }
  });

  if (changed) {
    const seen = new Set(archived.map((p) => makeTrackedSignature(p)));
    moveToArchived.forEach((p) => {
      const sig = makeTrackedSignature(p);
      if (sig && !seen.has(sig)) {
        seen.add(sig);
        archived.unshift(p);
      }
    });

    AppState.tracker.state.activePicks = keepActive;

    AppState.tracker.state.archivedPicks = archived
      .filter((p) => {
        const ts = safeParseDate(p.eventDate || p.createdAt);
        return ts === 0 || now - ts < pruneCutoffMs;
      })
      .slice(0, TRACKER_ARCHIVED_LIMIT);

    rebuildTrackerStats();
    saveTrackerStateToLocal();
  }
  if (g_settlementDebugLog.size > 200) {
    [...g_settlementDebugLog.keys()]
      .slice(0, g_settlementDebugLog.size - 150)
      .forEach((k) => g_settlementDebugLog.delete(k));
  }
  return changed;
}
