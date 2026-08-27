
function clearAll() {
  acknowledgeGlobalEngineAlert();
  _fixtureLoadToken++;
  unlockFetchBtn();
  selectedTeamIds = { A: null, B: null };
  g_lastFetchedTeams = { A: "", B: "" };
  g_fetchMeta = defaultFetchMeta();

  AppState.context.data = defaultMassacreFetchContext();
  Object.assign(g_h2hManualPreference, {
    ft: null,
    h1: null,
    q1: null,
    q2: null,
    q3: null,
    q4: null,
  });

  const ls = document.getElementById("leagueSelect");
  if (ls) ls.value = "";

  document.querySelectorAll("input").forEach((i) => {
    if (i.type !== "checkbox") i.value = "";
    else i.checked = false;
    i.style.borderColor = "";
  });

  setFieldValues(FIELD_GROUPS.markets);
  setFieldValues(FIELD_GROUPS.teamAOverall);
  setFieldValues(FIELD_GROUPS.teamBOverall);
  setFieldValues(FIELD_GROUPS.h2h);
  const espn = document.getElementById("espnSection");
  if (espn) espn.style.display = "none";

  ["a1HSection", "b1HSection", "h2h1HSection"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  const highQ = document.getElementById("highLowQMarketSection");
  if (highQ) highQ.style.display = "none";

  setDisplayValues(FIELD_GROUPS.autoTags, "none");

  hideInjuryBox("A");
  hideInjuryBox("B");
  g_injA = defaultInjuryMeta();
  g_injB = defaultInjuryMeta();
  _schedCache.clear();
  _summaryCache.clear();
  _fixtureCache.clear();

  setStatusText("", "");
  setFetchAuditIssues([]);
  closeDrop("dropA");
  closeDrop("dropB");
  const t = document.getElementById("results");
  if (t) {
    t.innerHTML =
      "<tr><th>Pick</th><th>Projection</th><th>Edge</th><th>Model Grade</th><th>Prediction</th></tr>";
    t.style.display = "none";
  }

  const dash = document.getElementById("syndicateDashboard");
  if (dash) dash.remove();

  g_engineDebugLog = [];
  window.__lastRunParsed = null;
  window.__lastRunFinalLines = null;
  window.__lastRunFixtureMeta = null;

  renderEngineDebugPanel();
  const fixtureSelect = document.getElementById("fixtureSelect");
  if (fixtureSelect) {
    fixtureSelect.innerHTML = '<option value="">— Select match —</option>';
    fixtureSelect.value = "";
  }

  document.querySelectorAll(".section").forEach((s) => {
    s.classList.add("collapsed");
    s.classList.remove("locked");
  });

  lockFrom("espnSection");
  updateSectionLocks();
  accordionOpen("leagueSection");
  validateFetchSection();

  const ssInputs = [
    "ssTeamAName",
    "ssTeamAId",
    "ssPasteA",
    "ssTeamBName",
    "ssTeamBId",
    "ssPasteB",
    "ssTournamentId",
  ];
  ssInputs.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  window.__fixtureTournamentId = null;
  window.__lastEventsA = null;
  window.__lastEventsB = null;
  window.__h2hEntryCache = [];
  const _ssTournamentName = document.getElementById("ssTournamentName");
  if (_ssTournamentName) _ssTournamentName.textContent = "";
  const ssStatus = document.getElementById("ssFetchStatus");
  if (ssStatus) ssStatus.textContent = "";

  ["useQ1H2H", "useQ2H2H", "useQ3H2H", "useQ4H2H"].forEach((id) => {
    const cb = document.getElementById(id);
    if (cb) cb.checked = false;
  });

  const quarterFields = [
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
  ];
  quarterFields.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  syncAllH2HCheckboxes(false);
  queueH2HCheckboxSync(false);
}

function onLeagueChange() {
  if (g_activeFetchController) {
    g_activeFetchController.abort();
    g_activeFetchController = null;
  }

  _fixtureLoadToken++;
  closeDrop("dropA");
  closeDrop("dropB");
  unlockFetchBtn();
  setStatusText("", "");
  setFetchAuditIssues([]);
  resetResultsTable();

  const leagueVal = document.getElementById("leagueSelect")?.value || "";

  const isNbaOrNcaa = ["nba", "wnba", "wnba_pre", "ncaa", "ncaaw", "nba_gl", "nba_summer"].includes(
    leagueVal,
  );
  const isWnba = leagueVal === "wnba" || leagueVal === "wnba_pre";

  document.querySelectorAll(".wrapper input").forEach((i) => {
    if (i.type !== "checkbox") i.value = "";
    else i.checked = false;
    i.style.borderColor = "";
  });

  const dash = document.getElementById("syndicateDashboard");
  if (dash) dash.remove();

  const league = leagueVal;

  const TRUE_BIG5 = new Set(["nba", "wnba", "wnba_pre", "ncaa", "ncaaw", "nba_gl", "nba_summer"]);
  const _isBig5 = TRUE_BIG5.has(league);
  const isQs = ["nba", "wnba", "wnba_pre", "nba_gl", "nba_summer"].includes(league);

  setFieldValues(FIELD_GROUPS.periodInputs);

  const teamMarketSection = document.getElementById("teamMarketSection");
  if (teamMarketSection) {
    teamMarketSection.style.gridTemplateColumns = "1fr 1fr";
  }
  const _espnEl = document.getElementById("espnSection");
  if (_espnEl) _espnEl.style.display = _isBig5 ? "block" : "none";
  const _sofaEl = document.getElementById("sofascoreManualSection");
  if (_sofaEl) _sofaEl.style.display = !league || _isBig5 ? "none" : "block";

  document.getElementById("aQSection").style.display = isQs || !isNbaOrNcaa ? "block" : "none";
  document.getElementById("bQSection").style.display = isQs || !isNbaOrNcaa ? "block" : "none";

  ["a1HSection", "b1HSection", "h2h1HSection"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = leagueVal ? "block" : "none";
  });
  ["a2HSection", "b2HSection", "h2h2HSection"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });
  const h2hQ = document.getElementById("h2hQSection");
  if (h2hQ) h2hQ.style.display = (isQs && isNbaOrNcaa) || !isNbaOrNcaa ? "block" : "none";

  const h1MarketEl = document.getElementById("h1MarketSection");
  if (h1MarketEl) h1MarketEl.style.display = leagueVal ? "block" : "none";

  const h1TeamEl = document.getElementById("h1TeamMarketSection");
  if (h1TeamEl) h1TeamEl.style.display = leagueVal && !isWnba ? "grid" : "none";

  const h1MarketElManual = document.getElementById("h1MarketSection");
  if (h1MarketElManual) h1MarketElManual.style.display = leagueVal ? "block" : "none";

  const h2MarketEl = document.getElementById("h2MarketSection");
  if (h2MarketEl) h2MarketEl.style.display = leagueVal && !isWnba ? "block" : "none";
  const handicapFullEl = document.getElementById("handicapMarketSection");
  if (handicapFullEl) handicapFullEl.style.display = leagueVal && !isWnba ? "block" : "none";
  const handicapH1H2El = document.getElementById("handicapH1H2MarketSection");
  if (handicapH1H2El) handicapH1H2El.style.display = leagueVal && isWnba ? "grid" : "none";

  ["q1q2MarketSection", "q3q4MarketSection"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = leagueVal ? "grid" : "none";
  });

  const highLowQEl = document.getElementById("highLowQMarketSection");
  if (highLowQEl) highLowQEl.style.display = "none";

  ["q1TeamMarketSection", "exoticMarketSection"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  if (!isNbaOrNcaa) {
    ["aAutoTag", "bAutoTag", "h2hAutoTag"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });

    syncH2HCheckbox("h1", false);
    syncH2HCheckbox("q1", false);
    syncH2HCheckbox("q2", false);
    syncH2HCheckbox("q3", false);
    syncH2HCheckbox("q4", false);
  }

  selectedTeamIds = { A: null, B: null };
  g_lastFetchedTeams = { A: "", B: "" };
  g_fetchMeta = defaultFetchMeta();

  AppState.context.data = defaultMassacreFetchContext();
  g_h2hManualPreference.ft = null;
  g_h2hManualPreference.h1 = null;
  g_h2hManualPreference.h2 = null;

  syncAllH2HCheckboxes(false);

  setDisplayValues(FIELD_GROUPS.autoTags, "none");

  _schedCache.clear();
  _summaryCache.clear();

  AppState.injuries.A = defaultInjuryMeta();
  AppState.injuries.B = defaultInjuryMeta();
  hideInjuryBox("A");
  hideInjuryBox("B");

  const fsel = document.getElementById("fixtureSelect");
  if (fsel) {
    fsel.innerHTML = '<option value="">— Select match —</option>';
    fsel.value = "";
  }

  if (!league) {
    lockFrom("espnSection");
    accordionOpen("leagueSection");
    validateFetchSection();
    return;
  }

  updateSectionLocks();
  if (_isBig5) {
    accordionOpen("espnSection");
    loadFixtures(0);
    if (typeof fetchLeagueStandings === "function") fetchLeagueStandings(league);
  } else {
    accordionOpen("sofascoreManualSection");
  }
  validateFetchSection();
}

function applySystemTheme() {
  try {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.body.classList.toggle("dark-mode", !!prefersDark);
  } catch (_e) {
    /* ignore */
  }
}

function toggleTheme() {
  /* Manual theme toggle disabled — follows system preference */
  applySystemTheme();
}

(function applySavedTheme() {
  applySystemTheme();
  try {
    if (window.matchMedia) {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      if (mq.addEventListener) {
        mq.addEventListener("change", applySystemTheme);
      } else if (mq.addListener) {
        mq.addListener(applySystemTheme);
      }
    }
  } catch (_e2) {
    /* ignore */
  }
  // Drop any legacy manual theme preference
  try {
    localStorage.removeItem("theme");
  } catch (_e3) {}
})();

document.addEventListener("DOMContentLoaded", () => {
  if (ensureFreshBuild()) return;

  makeSectionsCollapsible();

  try {
    updateEnginePerformanceScore();
  } catch (_pe) {
    engineDebug("updateEnginePerformanceScore failed (DOMContentLoaded)", {
      error: _pe?.message || String(_pe),
    });
  }

  const headerErrorBtn = document.getElementById("headerErrorBtn");
  if (headerErrorBtn) {
    headerErrorBtn.style.display = "none";
    headerErrorBtn.classList.remove("active");
    // Pop-up alerts disabled — errors stay in debug logs only
  }

  const trackerToggleBtn = document.getElementById("trackerToggleBtn");
  if (trackerToggleBtn)
    trackerToggleBtn.addEventListener(
      "click",
      withErrorBoundary(openTrackerModal, "openTrackerModal"),
    );

  const trackerMilitaryRaidBtn = document.getElementById("trackerMilitaryRaidBtn");
  if (trackerMilitaryRaidBtn)
    trackerMilitaryRaidBtn.addEventListener("dblclick", (e) => {
      e.stopImmediatePropagation();
      toggleTrackerDebugView();
    });

  const trackerConfigBtn = document.getElementById("trackerConfigBtn");
  if (trackerConfigBtn) trackerConfigBtn.addEventListener("click", toggleTrackerConfigsView);

  const trackerHealthBtn = document.getElementById("trackerHealthBtn");
  if (trackerHealthBtn) trackerHealthBtn.addEventListener("click", toggleTrackerHealthView);

  const trackerCloseBtn = document.getElementById("trackerCloseBtn");
  if (trackerCloseBtn) trackerCloseBtn.addEventListener("click", closeTrackerModal);

  const trackerCopyDataBtn = document.getElementById("trackerCopyDataBtn");
  if (trackerCopyDataBtn)
    trackerCopyDataBtn.addEventListener("click", function () {
      if (isTrackerConfigsView()) copyConfigsData();
      else copyTrackerData();
    });

  const trackerCopyDataJsonBtn = document.getElementById("trackerCopyDataJsonBtn");
  if (trackerCopyDataJsonBtn)
    trackerCopyDataJsonBtn.addEventListener("click", function () {
      const data = {
        activePicks: g_trackerState.activePicks,
        archivedPicks: g_trackerState.archivedPicks,
        stats: g_trackerState.stats,
      };
      const json = JSON.stringify(data, null, 2);
      const setFb = (ok) => {
        const orig = trackerCopyDataJsonBtn.textContent;
        trackerCopyDataJsonBtn.textContent = ok ? "✅" : "❌";
        setTimeout(() => {
          trackerCopyDataJsonBtn.textContent = orig;
        }, 1500);
      };
      copyTextToClipboard(json, setFb);
    });

  const trackerHeadTitle = document.getElementById("trackerHeadTitle");
  if (trackerHeadTitle)
    trackerHeadTitle.addEventListener("click", () => {
      if (!isTrackerPicksView()) setTrackerModalView("picks");
    });

  const trackerModal = document.getElementById("trackerModal");
  if (trackerModal) {
    trackerModal.addEventListener("click", (e) => {
      if (e.target === trackerModal) closeTrackerModal();
    });
  }

  const trackedPicksBody = document.getElementById("trackedPicksBody");
  if (trackedPicksBody)
    trackedPicksBody.addEventListener(
      "click",
      withErrorBoundary(handleTrackedPicksActionClick, "handleTrackedPicksActionClick"),
    );

  const leagueSelect = document.getElementById("leagueSelect");
  if (leagueSelect) leagueSelect.addEventListener("change", onLeagueChange);

  const fixturesTodayBtn = document.getElementById("fixturesTodayBtn");
  if (fixturesTodayBtn)
    fixturesTodayBtn.addEventListener(
      "click",
      withErrorBoundary(() => loadFixtures(0), "loadFixtures_today"),
    );

  const fixturesTomorrowBtn = document.getElementById("fixturesTomorrowBtn");
  if (fixturesTomorrowBtn)
    fixturesTomorrowBtn.addEventListener(
      "click",
      withErrorBoundary(() => loadFixtures(1), "loadFixtures_tomorrow"),
    );

  const fixtureSelect = document.getElementById("fixtureSelect");
  if (fixtureSelect) fixtureSelect.addEventListener("change", onFixtureSelect);

  let teamSearchTimeoutA = null;
  let teamSearchTimeoutB = null;

  const teamAName = document.getElementById("teamAName");
  if (teamAName) {
    teamAName.addEventListener("input", () => {
      clearTimeout(teamSearchTimeoutA);
      teamSearchTimeoutA = setTimeout(() => onTeamInput("A"), 250);
    });
  }

  const teamBName = document.getElementById("teamBName");
  if (teamBName) {
    teamBName.addEventListener("input", () => {
      clearTimeout(teamSearchTimeoutB);
      teamSearchTimeoutB = setTimeout(() => onTeamInput("B"), 250);
    });
  }

  const dropA = document.getElementById("dropA");
  if (dropA) {
    dropA.addEventListener("mousedown", () => cancelDropClose("dropA"));
  }

  const dropB = document.getElementById("dropB");
  if (dropB) {
    dropB.addEventListener("mousedown", () => cancelDropClose("dropB"));
  }

  const fetchBtn = document.getElementById("fetchBtn");
  if (fetchBtn) fetchBtn.addEventListener("click", withErrorBoundary(fetchESPN, "fetchESPN"));

  const runBtn = document.getElementById("runBtn");
  if (runBtn) runBtn.addEventListener("click", withErrorBoundary(runEngine, "runEngine"));

  const clearBtn = document.getElementById("clearBtn");
  if (clearBtn) clearBtn.addEventListener("click", clearAll);

  document.querySelectorAll(".section").forEach((s) => {
    s.classList.add("collapsed");
    s.classList.remove("locked");
  });

  const ls0 = document.getElementById("leagueSelect");
  if (ls0) ls0.value = "";

  const espnEl = document.getElementById("espnSection");
  if (espnEl) espnEl.style.display = "none";

  ["a1HSection", "b1HSection", "h2h1HSection", "h1MarketSection"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = "none";
  });

  lockFrom("espnSection");
  openSection("leagueSection");

  setTimeout(async () => {
    g_trackerSaveFailureCount = 0;
    await refreshTrackerInBackground(true);
  }, 50);

  let _refreshDebounceTimer = null;
  let _lastBackgroundSync = 0;

  function debouncedRefreshBackground(force) {
    const now = Date.now();
    if (!force && now - _lastBackgroundSync < 60000) return;

    _lastBackgroundSync = now;
    clearTimeout(_refreshDebounceTimer);
    _refreshDebounceTimer = setTimeout(() => refreshTrackerInBackground(false), 800);
  }

  const _isPWA = !!(
    window.navigator.standalone ||
    (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
  );

  window.addEventListener("focus", () =>
    _isPWA ? refreshTrackerInBackground(true) : debouncedRefreshBackground(false),
  );
  window.addEventListener("pageshow", (e) => {
    if (e.persisted || _isPWA) refreshTrackerInBackground(true);
    else debouncedRefreshBackground(false);
  });
  window.addEventListener("online", () => refreshTrackerInBackground(true));

  window.addEventListener("offline", function () {
    let banner = document.getElementById("offlineBanner");
    if (!banner) {
      banner = document.createElement("div");
      banner.id = "offlineBanner";
      banner.style.cssText =
        "position:fixed;top:0;left:0;right:0;background:#d91f26;color:#fff;padding:8px;text-align:center;font-weight:bold;z-index:9999;";
      banner.textContent = "⚠️ You are offline. Some fetches may fail.";
      document.body.prepend(banner);
    }
    banner.style.display = "block";
  });

  window.addEventListener("online", function () {
    const banner = document.getElementById("offlineBanner");
    if (banner) banner.style.display = "none";
  });

  window.addEventListener("beforeunload", () => {
    if (g_activeFetchController) {
      g_activeFetchController.abort();
    }
  });

  const handleExit = () => {
    if (isTrackerStateMeaningfullyEmpty(g_trackerState)) return;

    pushTrackerStateToServer(g_trackerState, true);
  };

  window.addEventListener("pagehide", handleExit);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      handleExit();
      stopLiveClockTicker();
    } else {
      debouncedRefreshBackground(false);
      if (g_liveGameStatus.size > 0) {
        stopLiveClockTicker();
        pollLiveGameClocks().then(() => {
          if (document.getElementById("trackerModal")?.classList.contains("open")) {
            startLiveClockTicker();
          }
        });
      }
    }
  });

  [
    ["useFTH2H", "ft"],
    ["use1HH2H", "h1"],
    ["useQ1H2H", "q1"],
    ["useQ2H2H", "q2"],
    ["useQ3H2H", "q3"],
    ["useQ4H2H", "q4"],
  ].forEach(([id, kind]) => {
    const el = document.getElementById(id);
    if (el)
      el.addEventListener("change", () => {
        if (Object.prototype.hasOwnProperty.call(g_h2hManualPreference, kind)) {
          g_h2hManualPreference[kind] = el.checked;
        }
        invalidateFetchedAudit();
        updateSectionLocks();
        updateIntelligencePack();
      });
  });

  [
    ["aFTH2H", "ft"],
    ["bFTH2H", "ft"],
    ["a1HH2H", "h1"],
    ["b1HH2H", "h1"],
    ["aQ1H2H", "q1"],
    ["bQ1H2H", "q1"],
    ["aQ2H2H", "q2"],
    ["bQ2H2H", "q2"],
    ["aQ3H2H", "q3"],
    ["bQ3H2H", "q3"],
    ["aQ4H2H", "q4"],
    ["bQ4H2H", "q4"],
  ].forEach(([id, kind]) => {
    const el = document.getElementById(id);
    if (!el) return;

    const handleH2HInputSync = () => {
      const tag = document.getElementById("h2hAutoTag");
      if (tag) tag.style.display = "none";
      queueH2HCheckboxSync(false);
      invalidateFetchedAudit();
      updateSectionLocks();
      updateIntelligencePack();
    };

    ["input", "change", "paste", "blur"].forEach((evt) => {
      el.addEventListener(evt, handleH2HInputSync);
    });
  });

  const bucketMap = {
    aFTScored: ["A", "ft"],
    a1HScored: ["A", "h1"],
    bFTScored: ["B", "ft"],
    b1HScored: ["B", "h1"],
  };

  Object.entries(bucketMap).forEach(([id, [side, bucket]]) => {
    const el = document.getElementById(id);
    if (el)
      el.addEventListener("input", () => {
        g_fetchMeta[side][bucket] = {
          source: "manual",
          venueReliable: g_fetchMeta[side][bucket]?.venueReliable ?? true,
        };
        const tagId = side === "A" ? "aAutoTag" : "bAutoTag";

        const tagEl = document.getElementById(tagId);
        if (tagEl) tagEl.style.display = "none";

        invalidateFetchedAudit();
        updateSectionLocks();
        updateIntelligencePack();
      });
  });

  [
    "ftMarket",
    "teamAMarket",
    "teamBMarket",
    "h1Market",
    "h2Market",
    "handicapMarket",
    "handicapH1Market",
    "handicapH2Market",
    "q1Market",
    "q2Market",
    "q3Market",
    "q4Market",
    "h1TeamAMarket",
    "h1TeamBMarket",
    "highQTotalMarket",
    "lowQTotalMarket",
    "q1TeamAMarket",
    "q1TeamBMarket",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el)
      el.addEventListener("input", () => {
        invalidateFetchedAudit();
        updateSectionLocks();
        updateIntelligencePack();
      });
  });

  setFetchInputErrors([]);
  setFetchAuditIssues([]);
  validateFetchSection();
  syncAllH2HCheckboxes(false);
  queueH2HCheckboxSync(false);
  updateIntelligencePack();

  window.addEventListener("error", (event) => {
    if (
      (event?.message === "Script error." || event?.message === "Script error") &&
      (!event?.lineno || event.lineno === 0)
    ) {
      return;
    }
    const detail = {
      message: event?.message || "Unknown runtime error",
      file: event?.filename || "inline",
      line: event?.lineno || 0,
      column: event?.colno || 0,
      stack: event?.error?.stack || "No stack trace attached",
    };
    engineDebug("FATAL RUNTIME ERROR", detail);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const err = event?.reason;
    const detail = {
      message: err?.message || String(err),
      stack: err?.stack || "No stack trace available",
    };
    const msgLower = detail.message.toLowerCase();
    if (
      msgLower.includes("fetch") ||
      msgLower.includes("load failed") ||
      msgLower.includes("networkerror")
    )
      return;
    engineDebug("UNHANDLED PROMISE REJECTION", detail);
  });

  try {
    if (typeof window.__BETCEO_WATCHDOG_CLEANUP === "function") window.__BETCEO_WATCHDOG_CLEANUP();
    if (typeof ENGINE_INTEGRITY_SHIELD !== "undefined") {
      const integrityReport = ENGINE_INTEGRITY_SHIELD.audit();

      if (Array.isArray(integrityReport) && integrityReport.length > 0) {
        integrityReport.forEach((e) => {
          engineDebug("WATCHDOG FLAG: " + e);
        });
      } else {
        engineDebug("WATCHDOG SUCCESS: System integrity OK");
      }
    } else {
      engineDebug("WATCHDOG BYPASS: Shield not present");
    }
  } catch (e) {
    engineDebug("WATCHDOG CRITICAL: Audit engine crash");
  }

  const inputsCopyBtn = document.getElementById("inputsCopyBtn");
  if (inputsCopyBtn) {
    inputsCopyBtn.addEventListener("click", () => {
      const ids = [
        "leagueSelect",
        "teamAName",
        "teamBName",
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
      ];
      const out = {};
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el && el.value && el.value.trim()) out[id] = el.value.trim();
      });
      const text = JSON.stringify(out, null, 2);
      const setFb = (ok) => {
        const orig = inputsCopyBtn.textContent;
        inputsCopyBtn.textContent = ok ? "✅" : "❌";
        setTimeout(() => {
          inputsCopyBtn.textContent = orig;
        }, 1800);
      };
      copyTextToClipboard(text, setFb);
    });
  }

  const auditCopyBtn = document.getElementById("auditCopyBtn");
  if (auditCopyBtn) {
    auditCopyBtn.addEventListener("click", () => {
      if (!window.__LAST_AUDIT_STATE) {
        alert("⚠️ You must hit 'Run' first to generate audit data.");
        return;
      }

      if (window.__LAST_AUDIT_STATE) {
        window.__LAST_AUDIT_STATE.meta = window.__LAST_AUDIT_STATE.meta || {};
        window.__LAST_AUDIT_STATE.meta.confidenceNaNNote =
          'DESIGN CHOICE: "NaN" in any confidence/grade field means NO PLAY / no valid line — not a real grade, not a bug.';
      }

      if (window.__LAST_AUDIT_STATE && typeof g_massacreFetchContext !== "undefined") {
        window.__LAST_AUDIT_STATE.rawFetchedData = {
          A_overall: AppState.context.data.A?.overall
            ? {
                ftScored10: AppState.context.data.A.overall.ftScored10 || [],
                ftAllowed10: AppState.context.data.A.overall.ftAllowed10 || [],
                h1Scored10: AppState.context.data.A.overall.h1Scored10 || [],
                h1Allowed10: AppState.context.data.A.overall.h1Allowed10 || [],
                scored: AppState.context.data.A.overall.scored || [],
                allowed: AppState.context.data.A.overall.allowed || [],
              }
            : null,
          B_overall: AppState.context.data.B?.overall
            ? {
                ftScored10: AppState.context.data.B.overall.ftScored10 || [],
                ftAllowed10: AppState.context.data.B.overall.ftAllowed10 || [],
                h1Scored10: AppState.context.data.B.overall.h1Scored10 || [],
                h1Allowed10: AppState.context.data.B.overall.h1Allowed10 || [],
                scored: AppState.context.data.B.overall.scored || [],
                allowed: AppState.context.data.B.overall.allowed || [],
              }
            : null,
          A_venue: AppState.context.data.A?.venue
            ? {
                ftScored10: AppState.context.data.A.venue.ftScored10 || [],
                ftAllowed10: AppState.context.data.A.venue.ftAllowed10 || [],
                h1Scored10: AppState.context.data.A.venue.h1Scored10 || [],
                h1Allowed10: AppState.context.data.A.venue.h1Allowed10 || [],
                scored: AppState.context.data.A.venue.scored || [],
                allowed: AppState.context.data.A.venue.allowed || [],
              }
            : null,
          B_venue: AppState.context.data.B?.venue
            ? {
                ftScored10: AppState.context.data.B.venue.ftScored10 || [],
                ftAllowed10: AppState.context.data.B.venue.ftAllowed10 || [],
                h1Scored10: AppState.context.data.B.venue.h1Scored10 || [],
                h1Allowed10: AppState.context.data.B.venue.h1Allowed10 || [],
                scored: AppState.context.data.B.venue.scored || [],
                allowed: AppState.context.data.B.venue.allowed || [],
              }
            : null,
          A_quarters: {
            q1Scored: AppState.context.data.A?.q1Scored || [],
            q2Scored: AppState.context.data.A?.q2Scored || [],
            q3Scored: AppState.context.data.A?.q3Scored || [],
            q4Scored: AppState.context.data.A?.q4Scored || [],
            q1Allowed: AppState.context.data.A?.q1Allowed || [],
            q2Allowed: AppState.context.data.A?.q2Allowed || [],
            q3Allowed: AppState.context.data.A?.q3Allowed || [],
            q4Allowed: AppState.context.data.A?.q4Allowed || [],
          },
          B_quarters: {
            q1Scored: AppState.context.data.B?.q1Scored || [],
            q2Scored: AppState.context.data.B?.q2Scored || [],
            q3Scored: AppState.context.data.B?.q3Scored || [],
            q4Scored: AppState.context.data.B?.q4Scored || [],
            q1Allowed: AppState.context.data.B?.q1Allowed || [],
            q2Allowed: AppState.context.data.B?.q2Allowed || [],
            q3Allowed: AppState.context.data.B?.q3Allowed || [],
            q4Allowed: AppState.context.data.B?.q4Allowed || [],
          },
          advanced: {
            A: {
              ortg10: AppState.context.data.A?.ortg10 || [],
              drtg10: AppState.context.data.A?.drtg10 || [],
              pace10: AppState.context.data.A?.pace10 || [],
            },
            B: {
              ortg10: AppState.context.data.B?.ortg10 || [],
              drtg10: AppState.context.data.B?.drtg10 || [],
              pace10: AppState.context.data.B?.pace10 || [],
            },
          },
          h2hGames:
            AppState.context.data.h2hGames?.map((g) => ({
              eventId: g.eventId,
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
              date: g.date,
            })) || [],

          blendWeights: {
            ftH2HWeight:
              window.__LAST_AUDIT_STATE?.projectionBuild?.FT_TOTAL?.STEP7_h2hBlend?.h2hWeight ??
              null,
            teamWeight:
              window.__LAST_AUDIT_STATE?.projectionBuild?.FT_TOTAL?.STEP7_h2hBlend?.teamWeight ??
              null,
            overallVsVenue: "Venue replaces overall when enabled",
          },
        };
      }
      const auditData = JSON.stringify(window.__LAST_AUDIT_STATE, null, 2);

      copyTextToClipboard(auditData, (ok) => {
        if (ok) {
          const originalText = auditCopyBtn.innerHTML;
          auditCopyBtn.innerHTML = "✅";
          setTimeout(() => {
            auditCopyBtn.innerHTML = originalText;
          }, 2000);
        } else {
          alert("Copy failed. Your browser might be blocking clipboard access.");
        }
      });
    });
  }

  window.updateLeagueDropdownIndicators = function () {
    const selectElement = document.getElementById("leagueSelect");
    if (!selectElement) return;
    let verifiedTunings = {};
    try {
      verifiedTunings = JSON.parse(localStorage.getItem("BB_VERIFIED_TUNINGS")) || {};
    } catch (e) {
      engineDebug("BB_VERIFIED_TUNINGS load failed", { error: e?.message || String(e) });
    }

    Array.from(selectElement.options).forEach((option) => {
      const leagueValue = option.value;
      if (verifiedTunings[leagueValue] && verifiedTunings[leagueValue].verified) {
        if (!option.text.includes("✓")) {
          option.text = option.text + " ✓";
          option.style.color = "#3a9c35";
          option.style.fontWeight = "800";
        }
      }
    });
  };

  setTimeout(window.updateLeagueDropdownIndicators, 1000);
});
