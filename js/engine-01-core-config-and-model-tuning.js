window.__BETCEO_ENGINE_BOOT_SEEN = true;
window.__BETCEO_ENGINE_PARSE_OK = true;
window.__BETCEO_SESSION_ID = "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);

// Moved up from engine-05: clampNumber is used starting in this file (and in
// engine-02/engine-03's own top-level init code), but engine-05 loads much
// later. Calling it before it existed threw "clampNumber is not defined" and
// aborted engine-03's initialization partway through — which is what left
// AppState, g_engineDebugLog, g_refreshTrackedPicksInFlight and engineDebug()
// itself undefined for the rest of the app. Definition kept in engine-05 too
// (harmless duplicate) so nothing else needs to change.
function clampNumber(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

const ENGINE_INTEGRITY_SHIELD = {
  expectedFingerprints: {
    math: "v1_calibrated",
    storage: "indexed_db_v1",
  },

  audit: function () {
    const issues = [];

    try {
      if (typeof MODEL_CONFIG === "undefined")
        issues.push("CRITICAL: MODEL_CONFIG variable is missing.");
    } catch (e) {
      issues.push("CRITICAL: MODEL_CONFIG access blocked.");
    }

    if (typeof getDynamicWeights !== "function")
      issues.push("CRITICAL: getDynamicWeights logic is missing.");

    try {
      const testWeight = getDynamicWeights("full", 0, "nba");

      const _twEntry = TUNABLE_PARAM_REGISTRY.teamWeightBase;
      const _twMin = isFinite(_twEntry?.min) ? _twEntry.min : 0.4;
      const _twMax = isFinite(_twEntry?.max) ? _twEntry.max : 0.85;
      if (
        !isFinite(testWeight.teamWeight) ||
        testWeight.teamWeight < _twMin ||
        testWeight.teamWeight > _twMax
      )
        issues.push("INTEGRITY: getDynamicWeights returned unexpected teamWeight.");
    } catch (e) {
      issues.push("INTEGRITY: Math engine failed internal sanity test.");
    }

    if (!window.indexedDB) issues.push("ENV: Browser IndexedDB is disabled. Data loss imminent.");

    return issues;
  },
};

const APP_BUILD_VERSION = "tracker_cleanup_v22_measurement_lab";
const STANDALONE_BUILD_MARKER = "bb_engine_standalone_build";
const WORKER_URL = "https://thebetceo-engine.ridwantunde636.workers.dev/";
// D2: Client-visible shared secret is NOT real auth by itself. The Cloudflare
// Worker MUST: (1) require X-Engine-Secret, (2) allowlist only ESPN/domain
// targets, (3) rate-limit by IP. Rotate this value in Worker + here together.
// Obfuscated assembly reduces casual scrape-and-replay; determined readers
// still recover it — treat Worker enforcement as mandatory.
// D2 cleanup: removed the Object.defineProperty(window, "WORKER_SHARED_SECRET", ...)
// call that used to sit here. It was a no-op: a top-level `const` in a classic
// <script> never becomes a `window` property in the first place, so overwriting
// `window.WORKER_SHARED_SECRET` hid nothing and only implied a protection that
// didn't exist. The secret below is plainly visible in view-source regardless —
// that's why Worker-side enforcement is the mandatory control, not this file.
const WORKER_SHARED_SECRET = (function () {
  var a = [
    "da4d",
    "8291",
    "5079",
    "6348",
    "6664",
    "d2ef",
    "fd98",
    "3101",
    "af9a",
    "68f6",
    "c462",
    "05d0",
  ];
  return a.join("");
})();

const SS_BASKETBALL_SPORT_IDS = new Set([2, 128, 129, 155, 156, 157, 158]);

function ssIsBasketballEvent(ev) {
  const sportSlug = String(
    ev?.tournament?.category?.sport?.slug || ev?.sport?.slug || ev?.category?.sport?.slug || "",
  ).toLowerCase();
  if (sportSlug && sportSlug !== "basketball") return false;

  let sportId = Number(
    ev?.tournament?.category?.sport?.id ?? ev?.sport?.id ?? ev?.category?.sport?.id ?? -1,
  );

  if (sportId === -1 && ev?.tournament?.category?.parent?.sport?.id) {
    sportId = Number(ev.tournament.category.parent.sport.id);
  }
  if (sportId !== -1 && !SS_BASKETBALL_SPORT_IDS.has(sportId)) return false;

  if (sportSlug === "" && sportId === -1) {
    const hScore = Number(ev?.homeScore?.normaltime ?? ev?.homeScore?.current ?? -1);
    const aScore = Number(ev?.awayScore?.normaltime ?? ev?.awayScore?.current ?? -1);
    if (isFinite(hScore) && isFinite(aScore) && hScore >= 0 && aScore >= 0) {
      if (hScore <= 9 && aScore <= 9) return false;
    }
  }

  return true;
}

window.__seriesDateCache = window.__seriesDateCache || {};
function stashSeriesDates(side, marketKey, dates) {
  if (!Array.isArray(dates) || !dates.length) return;
  window.__seriesDateCache[side + "_" + marketKey] = dates;
}
function getStashedSeriesDates(side, marketKey) {
  return window.__seriesDateCache[side + "_" + marketKey] || null;
}

function ssProcessTeamEvents(events, teamId, label, fixtureTournamentId, predictionAsOf) {
  // Temporal: prediction asOf / eventDate / filterEventsAsOf — exclude post-cutoff games.
  const scoredList = [],
    allowedList = [];
  const homeScoredList = [],
    homeAllowedList = [];
  const awayScoredList = [],
    awayAllowedList = [];

  const h1HomeScoredList = [],
    h1HomeAllowedList = [];
  const h1AwayScoredList = [],
    h1AwayAllowedList = [];
  const h1ScoredList = [],
    h1AllowedList = [];
  const h1ScoredDates = [];
  const q1ScoredList = [],
    q2ScoredList = [],
    q3ScoredList = [],
    q4ScoredList = [];
  const q1AllowedList = [],
    q2AllowedList = [],
    q3AllowedList = [],
    q4AllowedList = [];

  // Q-SPREAD: per-quarter home/away splits, same shape as the h1Home/h1Away
  // pair above. These feed computeQuarterSpread() downstream so recent
  // quarter-margin form can be computed venue-aware, not just overall.
  const q1HomeScoredList = [],
    q1HomeAllowedList = [];
  const q1AwayScoredList = [],
    q1AwayAllowedList = [];
  const q2HomeScoredList = [],
    q2HomeAllowedList = [];
  const q2AwayScoredList = [],
    q2AwayAllowedList = [];
  const q3HomeScoredList = [],
    q3HomeAllowedList = [];
  const q3AwayScoredList = [],
    q3AwayAllowedList = [];
  const q4HomeScoredList = [],
    q4HomeAllowedList = [];
  const q4AwayScoredList = [],
    q4AwayAllowedList = [];

  const q1ScoredDates = [],
    q2ScoredDates = [],
    q3ScoredDates = [],
    q4ScoredDates = [];

  const basketballEvents = events.filter((ev) => ssIsBasketballEvent(ev));
  const blockedCount = events.length - basketballEvents.length;
  if (blockedCount > 0) {
    engineDebug("ssProcessTeamEvents: blocked " + blockedCount + " non-basketball events", {
      label,
      total: events.length,
      kept: basketballEvents.length,
    });
  }

  let competitionEvents = basketballEvents;
  if (fixtureTournamentId != null) {
    const tidStr = String(fixtureTournamentId);
    competitionEvents = basketballEvents.filter((ev) => {
      const evTid = ev?.tournament?.uniqueTournament?.id;
      return evTid != null && String(evTid) === tidStr;
    });
    const crossBlocked = basketballEvents.length - competitionEvents.length;
    if (crossBlocked > 0) {
      engineDebug("ssProcessTeamEvents: blocked " + crossBlocked + " cross-competition events", {
        label,
        fixtureTournamentId,
        kept: competitionEvents.length,
      });
    }
  }

  let completedAll = competitionEvents
    .filter((e) => {
      const _sType = e.status?.type ?? "";
      const _isDone =
        _sType === "finished" ||
        _sType === "afterExtraTime" ||
        _sType === "afterPenalties" ||
        e.status?.finished === true;
      if (!_isDone) return false;
      const hId = String(e.homeTeam?.id || "");
      const aId = String(e.awayTeam?.id || "");
      return hId === String(teamId) || aId === String(teamId);
    })
    .map((e) => {
      // Normalize eventDate for filterEventsAsOf (SofaScore uses startTimestamp seconds).
      if (e && e.startTimestamp && !e.eventDate) {
        try {
          e = Object.assign({}, e, {
            eventDate: new Date(e.startTimestamp * 1000).toISOString(),
          });
        } catch (_eTs) {}
      }
      return e;
    })
    .sort((a, b) => (b.startTimestamp || 0) - (a.startTimestamp || 0));

  // Explicit prediction-date guard: asOf / eventDate / predictionDate / cutoff via filterEventsAsOf.
  let _asOf =
    predictionAsOf ||
    (typeof resolvePredictionAsOf === "function"
      ? resolvePredictionAsOf(null, null)
      : null) ||
    (document.getElementById("eventDate") && document.getElementById("eventDate").value) ||
    "";
  if (!_asOf) {
    try {
      const _fm = typeof getCurrentFixtureMeta === "function" ? getCurrentFixtureMeta() : null;
      _asOf = (_fm && (_fm.eventDate || _fm.predictionDate || _fm.asOf || _fm.date)) || "";
    } catch (_eAsOf) {}
  }
  if (_asOf && typeof filterEventsAsOf === "function") {
    completedAll = filterEventsAsOf(completedAll, _asOf);
  }

  engineDebug("ssProcessTeamEvents completed overall count: " + completedAll.length, {
    label,
    asOf: _asOf || null,
  });

  const overallGames = completedAll.slice(0, 10);

  const lastGameDate =
    overallGames.length && overallGames[0]?.startTimestamp
      ? new Date(overallGames[0].startTimestamp * 1000).toISOString()
      : "";
  overallGames.forEach((ev, idx) => {
    const isHome = String(ev.homeTeam?.id) === String(teamId);
    const myScore = isHome ? ev.homeScore : ev.awayScore;
    const oppScore = isHome ? ev.awayScore : ev.homeScore;
    if (myScore && oppScore) {
      const myFT = Number(myScore.normaltime ?? myScore.current ?? myScore.display ?? 0);
      const oppFT = Number(oppScore.normaltime ?? oppScore.current ?? oppScore.display ?? 0);
      if (myFT > 0) {
        scoredList.push(myFT);
        allowedList.push(oppFT);
        const myQ1 = Number(myScore.period1 ?? 0);
        const myQ2 = Number(myScore.period2 ?? 0);
        const myQ3 = Number(myScore.period3 ?? 0);
        const myQ4 = Number(myScore.period4 ?? 0);
        const oppQ1 = Number(oppScore.period1 ?? 0);
        const oppQ2 = Number(oppScore.period2 ?? 0);
        const oppQ3 = Number(oppScore.period3 ?? 0);
        const oppQ4 = Number(oppScore.period4 ?? 0);

        const _evDate = ev.startTimestamp ? new Date(ev.startTimestamp * 1000).toISOString() : null;
        // FIX Issue 22: period mapping depends on league regulationPeriods.
        let _regP = 4;
        try {
          const _lg =
            (document.getElementById("leagueSelect") && document.getElementById("leagueSelect").value) ||
            "";
          if (typeof LEAGUE_FETCH_RULES !== "undefined" && LEAGUE_FETCH_RULES[_lg]) {
            _regP = Number(LEAGUE_FETCH_RULES[_lg].regulationPeriods) || 4;
          }
        } catch (_eP) {}
        if (_regP <= 2) {
          // 2-period leagues: period1 = H1, period2 = H2; do not treat as quarters.
          if (myQ1 > 0) {
            h1ScoredList.push(myQ1);
            h1AllowedList.push(oppQ1);
            h1ScoredDates.push(_evDate);
          }
        } else if (myQ1 + myQ2 + myQ3 + myQ4 > 0) {
          q1ScoredList.push(myQ1);
          q2ScoredList.push(myQ2);
          q3ScoredList.push(myQ3);
          q4ScoredList.push(myQ4);
          q1AllowedList.push(oppQ1);
          q2AllowedList.push(oppQ2);
          q3AllowedList.push(oppQ3);
          q4AllowedList.push(oppQ4);
          q1ScoredDates.push(_evDate);
          q2ScoredDates.push(_evDate);
          q3ScoredDates.push(_evDate);
          q4ScoredDates.push(_evDate);
          if (myQ1 + myQ2 > 0) {
            h1ScoredList.push(myQ1 + myQ2);
            h1AllowedList.push(oppQ1 + oppQ2);
            h1ScoredDates.push(_evDate);
          }
        }
      }
      engineDebug("ssProcessTeamEvents overall match #" + (idx + 1), { myFT, oppFT, isHome });
    }
  });

  completedAll.forEach((ev) => {
    const isHome = String(ev.homeTeam?.id) === String(teamId);
    const myScore = isHome ? ev.homeScore : ev.awayScore;
    const oppScore = isHome ? ev.awayScore : ev.homeScore;
    if (myScore && oppScore) {
      const myFT = Number(myScore.normaltime ?? myScore.current ?? myScore.display ?? 0);
      const oppFT = Number(oppScore.normaltime ?? oppScore.current ?? oppScore.display ?? 0);
      if (myFT > 0) {
        if (isHome) {
          if (homeScoredList.length < 10) {
            homeScoredList.push(myFT);
            homeAllowedList.push(oppFT);
          }
        } else {
          if (awayScoredList.length < 10) {
            awayScoredList.push(myFT);
            awayAllowedList.push(oppFT);
          }
        }

        const myQ1h = Number(myScore.period1 ?? 0),
          myQ2h = Number(myScore.period2 ?? 0);
        const oppQ1h = Number(oppScore.period1 ?? 0),
          oppQ2h = Number(oppScore.period2 ?? 0);
        if (myQ1h + myQ2h > 0) {
          if (isHome) {
            if (h1HomeScoredList.length < 10) {
              h1HomeScoredList.push(myQ1h + myQ2h);
              h1HomeAllowedList.push(oppQ1h + oppQ2h);
            }
          } else {
            if (h1AwayScoredList.length < 10) {
              h1AwayScoredList.push(myQ1h + myQ2h);
              h1AwayAllowedList.push(oppQ1h + oppQ2h);
            }
          }
        }

        // Q-SPREAD: same isHome branch, one quarter at a time, each list
        // independently capped at 10 (a team can have a q3 value on a game
        // where q4 was missing, etc., so these are not forced to move in lockstep).
        const myQ1 = Number(myScore.period1 ?? 0),
          myQ2 = Number(myScore.period2 ?? 0),
          myQ3 = Number(myScore.period3 ?? 0),
          myQ4 = Number(myScore.period4 ?? 0);
        const oppQ1 = Number(oppScore.period1 ?? 0),
          oppQ2 = Number(oppScore.period2 ?? 0),
          oppQ3 = Number(oppScore.period3 ?? 0),
          oppQ4 = Number(oppScore.period4 ?? 0);
        const _qPairs = [
          [myQ1, oppQ1, q1HomeScoredList, q1HomeAllowedList, q1AwayScoredList, q1AwayAllowedList],
          [myQ2, oppQ2, q2HomeScoredList, q2HomeAllowedList, q2AwayScoredList, q2AwayAllowedList],
          [myQ3, oppQ3, q3HomeScoredList, q3HomeAllowedList, q3AwayScoredList, q3AwayAllowedList],
          [myQ4, oppQ4, q4HomeScoredList, q4HomeAllowedList, q4AwayScoredList, q4AwayAllowedList],
        ];
        _qPairs.forEach(([myQ, oppQ, homeS, homeA, awayS, awayA]) => {
          if (myQ > 0 || oppQ > 0) {
            if (isHome) {
              if (homeS.length < 10) {
                homeS.push(myQ);
                homeA.push(oppQ);
              }
            } else {
              if (awayS.length < 10) {
                awayS.push(myQ);
                awayA.push(oppQ);
              }
            }
          }
        });
      }
    }
  });

  updateLeagueVolCache(document.getElementById("leagueSelect")?.value || "", scoredList);

  return {
    scoredList,
    allowedList,
    homeScoredList,
    homeAllowedList,
    awayScoredList,
    awayAllowedList,

    h1HomeScoredList,
    h1HomeAllowedList,
    h1AwayScoredList,
    h1AwayAllowedList,
    h1ScoredList,
    h1AllowedList,

    q1HomeScoredList,
    q1HomeAllowedList,
    q1AwayScoredList,
    q1AwayAllowedList,
    q2HomeScoredList,
    q2HomeAllowedList,
    q2AwayScoredList,
    q2AwayAllowedList,
    q3HomeScoredList,
    q3HomeAllowedList,
    q3AwayScoredList,
    q3AwayAllowedList,
    q4HomeScoredList,
    q4HomeAllowedList,
    q4AwayScoredList,
    q4AwayAllowedList,

    h1ScoredDates,
    q1ScoredList,
    q2ScoredList,
    q3ScoredList,
    q4ScoredList,
    q1AllowedList,
    q2AllowedList,
    q3AllowedList,
    q4AllowedList,
    q1ScoredDates,
    q2ScoredDates,
    q3ScoredDates,
    q4ScoredDates,
    lastGameDate,
  };
}

function clearPasteJSON(side) {
  const pasteEl = document.getElementById(side === "A" ? "ssPasteA" : "ssPasteB");
  if (pasteEl) pasteEl.value = "";
  const st = document.getElementById("ssFetchStatus");
  if (st) {
    st.style.color = "";
    st.textContent = "";
  }
}

window.__jsonPasteCountA = 0;
window.__jsonPasteCountB = 0;

function updateSofascoreLinks(side) {
  const idInput = document.getElementById(side === "A" ? "ssTeamAId" : "ssTeamBId");
  const linkEl = document.getElementById(side === "A" ? "ssTeamALink" : "ssTeamBLink");
  if (!idInput || !linkEl) return;
  const idVal = idInput.value.trim();
  if (idVal && /^\d+$/.test(idVal)) {
    if (side === "A") {
      linkEl.href = "https://api.sofascore.com/api/v1/team/" + idVal + "/events/last/0";
      linkEl.style.display = "inline-block";
    } else {
      linkEl.href = "https://api.sofascore.com/api/v1/team/" + idVal + "/events/last/0";
      linkEl.style.display = "inline-block";
      const _link1 = document.getElementById("ssTeamBLink1");
      if (_link1) {
        _link1.href = "https://api.sofascore.com/api/v1/team/" + idVal + "/events/last/1";
        _link1.style.display = "inline-block";
      }
      const _link2 = document.getElementById("ssTeamBLink2");
      if (_link2) {
        _link2.href = "https://api.sofascore.com/api/v1/team/" + idVal + "/events/last/2";
        _link2.style.display = "inline-block";
      }
      const _link3 = document.getElementById("ssTeamBLink3");
      if (_link3) {
        _link3.href = "https://api.sofascore.com/api/v1/team/" + idVal + "/events/last/3";
        _link3.style.display = "inline-block";
      }
    }
  } else {
    linkEl.style.display = "none";
    if (side === "B") {
      const _link1 = document.getElementById("ssTeamBLink1");
      if (_link1) _link1.style.display = "none";
      const _link2 = document.getElementById("ssTeamBLink2");
      if (_link2) _link2.style.display = "none";
      const _link3 = document.getElementById("ssTeamBLink3");
      if (_link3) _link3.style.display = "none";
    }
  }
}

function searchSofascorePlayer(side) {
  const nameEl = document.getElementById(side === "A" ? "ssTeamAName" : "ssTeamBName");
  // Fall back to main team name fields (user often filled teamAName, not ssTeamAName).
  const mainEl = document.getElementById(side === "A" ? "teamAName" : "teamBName");
  const rawName = (nameEl?.value || mainEl?.value || "").trim();
  if (!rawName) {
    alert("Enter a player/team name first.");
    return;
  }
  const searchName = rawName.split(",")[0].trim();

  const searchUrl =
    "https://api.sofascore.com/api/v1/search/teams?q=" +
    encodeURIComponent(searchName) +
    "&sport=basketball";
  window.open(searchUrl, "_blank");
  const st = document.getElementById("ssFetchStatus");
  if (st) {
    st.style.color = "#d98a00";
    st.textContent =
      "🔍 Basketball-only search opened for " +
      side +
      " — find the team ID in the JSON and paste it above.";
  }
}

window.__lastEventsA = null;
window.__lastEventsB = null;
window.__h2hEntryCache = [];
window.__fixtureTournamentId = null;

function getFixtureTournamentId() {
  const manualVal = (document.getElementById("ssTournamentId")?.value || "").trim();
  if (manualVal && /^\d+$/.test(manualVal)) return manualVal;
  return window.__fixtureTournamentId != null ? String(window.__fixtureTournamentId) : null;
}

function detectTournamentIdIntersection(eventsA, eventsB) {
  function countByTournament(events) {
    const counts = {};
    events.forEach((ev) => {
      if (!ssIsBasketballEvent(ev)) return;
      const sType = ev.status?.type ?? "";
      const done =
        sType === "finished" ||
        sType === "afterExtraTime" ||
        sType === "afterPenalties" ||
        ev.status?.finished === true;
      if (!done) return;
      const tid = ev?.tournament?.uniqueTournament?.id;
      if (tid == null) return;
      const key = String(tid);
      if (!counts[key]) counts[key] = { id: key, name: ev?.tournament?.name || "", count: 0 };
      counts[key].count++;
    });
    return counts;
  }
  const cA = countByTournament(eventsA);
  const cB = countByTournament(eventsB);
  const result = [];
  Object.keys(cA).forEach((tid) => {
    if (cB[tid]) {
      result.push({
        id: tid,
        name: cA[tid].name || cB[tid].name,
        countA: cA[tid].count,
        countB: cB[tid].count,
        combined: cA[tid].count + cB[tid].count,
      });
    }
  });
  return result.sort((a, b) => b.combined - a.combined);
}

function detectPrimaryTournamentForEvents(events) {
  if (!events || !events.length) return null;

  const counts = {};
  events.forEach((ev) => {
    if (!ssIsBasketballEvent(ev)) return;
    const sType = ev.status?.type ?? "";
    const done =
      sType === "finished" ||
      sType === "afterExtraTime" ||
      sType === "afterPenalties" ||
      ev.status?.finished === true;
    if (!done) return;

    const tName = (ev?.tournament?.name || "").toLowerCase();
    const uName = (ev?.tournament?.uniqueTournament?.name || "").toLowerCase();
    if (tName.includes("rapid") || uName.includes("rapid")) return;

    const tid = ev?.tournament?.uniqueTournament?.id;
    if (tid == null) return;
    const key = String(tid);
    if (!counts[key]) counts[key] = { id: key, name: ev?.tournament?.name || uName, count: 0 };
    counts[key].count++;
  });

  const sorted = Object.values(counts).sort((a, b) => b.count - a.count);
  if (sorted.length > 0) return sorted[0].id;

  const fallbackCounts = {};
  events.forEach((ev) => {
    if (!ssIsBasketballEvent(ev)) return;
    const tid = ev?.tournament?.uniqueTournament?.id;
    if (tid != null) {
      const key = String(tid);
      fallbackCounts[key] = (fallbackCounts[key] || 0) + 1;
    }
  });
  const fallbackSorted = Object.entries(fallbackCounts).sort((a, b) => b[1] - a[1]);
  return fallbackSorted.length > 0 ? fallbackSorted[0][0] : null;
}

function updateTeamUIFromStats(side, stats) {
  if (!stats) return;
  const prefix = side === "A" ? "a" : "b";
  const display10S = stats.scoredList.slice(0, 10);
  const display10A = stats.allowedList.slice(0, 10);

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  };

  setVal(prefix + "FTScored", display10S.join(","));
  setVal(prefix + "FTAllowed", display10A.join(","));

  if (stats.homeScoredList && stats.homeScoredList.length >= 2) {
    const elScoredHome = document.getElementById(prefix + "FTScoredHome");
    const elAllowedHome = document.getElementById(prefix + "FTAllowedHome");
    if (elScoredHome) elScoredHome.value = stats.homeScoredList.slice(0, 10).join(",");
    if (elAllowedHome) elAllowedHome.value = stats.homeAllowedList.slice(0, 10).join(",");
  }

  if (stats.h1ScoredList?.length >= 2) {
    setVal(prefix + "1HScored", stats.h1ScoredList.slice(0, 10).join(","));
    setVal(prefix + "1HAllowed", stats.h1AllowedList.slice(0, 10).join(","));
  }

  if (stats.q1ScoredList?.length >= 2) {
    setVal(prefix + "Q1Scored", stats.q1ScoredList.slice(0, 10).join(","));
    setVal(prefix + "Q2Scored", stats.q2ScoredList.slice(0, 10).join(","));
    setVal(prefix + "Q3Scored", stats.q3ScoredList.slice(0, 10).join(","));
    setVal(prefix + "Q4Scored", stats.q4ScoredList.slice(0, 10).join(","));
    setVal(prefix + "Q1Allowed", stats.q1AllowedList.slice(0, 10).join(","));
    setVal(prefix + "Q2Allowed", stats.q2AllowedList.slice(0, 10).join(","));
    setVal(prefix + "Q3Allowed", stats.q3AllowedList.slice(0, 10).join(","));
    setVal(prefix + "Q4Allowed", stats.q4AllowedList.slice(0, 10).join(","));
  }

  if (!AppState.context.data[side]) AppState.context.data[side] = {};
  if (!AppState.context.data[side].overall) AppState.context.data[side].overall = {};
  AppState.context.data[side].overall.ftScored10 = stats.scoredList;
  AppState.context.data[side].overall.ftAllowed10 = stats.allowedList;
  AppState.context.data[side].overall.scored10 = stats.scoredList;
  AppState.context.data[side].overall.allowed10 = stats.allowedList;
  AppState.context.data[side].overall.scored = display10S;
  AppState.context.data[side].overall.allowed = display10A;

  AppState.context.data[side].lastGameDate = stats.lastGameDate || "";
  if (stats.lastGameDate) {
    const _lastMs = Date.parse(stats.lastGameDate);
    if (isFinite(_lastMs)) {
      // FIX Issue 23: prefer fixture event date over wall-clock Date.now().
      let _refMs = Date.now();
      try {
        const _fm = typeof getCurrentFixtureMeta === "function" ? getCurrentFixtureMeta() : null;
        const _ed = _fm && (_fm.eventDate || _fm.date || _fm.predictionDate);
        const _parsedEd = _ed ? Date.parse(_ed) : NaN;
        if (isFinite(_parsedEd)) _refMs = _parsedEd;
      } catch (_eRest) {}
      const _rawDays = Math.max(0, Math.round((_refMs - _lastMs) / 86400000) - 1);
      // null = unknown; never invent 99 as "no fatigue"
      AppState.context.data[side].restDays = _rawDays <= 14 ? _rawDays : null;
    }
  }

  const _role = getFixtureSideRole(side);
  const _venueScored = _role === "away" ? stats.awayScoredList : stats.homeScoredList;
  const _venueAllowed = _role === "away" ? stats.awayAllowedList : stats.homeAllowedList;
  if (_venueScored && _venueScored.length >= 2) {
    if (!AppState.context.data[side].venue) AppState.context.data[side].venue = {};
    AppState.context.data[side].venue.ftScored10 = _venueScored;
    AppState.context.data[side].venue.ftAllowed10 = _venueAllowed;
  }

  if (stats.h1ScoredList?.length >= 2) {
    AppState.context.data[side].overall.h1Scored10 = stats.h1ScoredList;
    AppState.context.data[side].overall.h1Allowed10 = stats.h1AllowedList;
  }

  const _venueH1Scored = _role === "away" ? stats.h1AwayScoredList : stats.h1HomeScoredList;
  const _venueH1Allowed = _role === "away" ? stats.h1AwayAllowedList : stats.h1HomeAllowedList;
  if (_venueH1Scored && _venueH1Scored.length >= 2) {
    if (!AppState.context.data[side].venue) AppState.context.data[side].venue = {};
    AppState.context.data[side].venue.h1Scored10 = _venueH1Scored;
    AppState.context.data[side].venue.h1Allowed10 = _venueH1Allowed;
  }

  if (stats.q1ScoredList?.length >= 2) {
    AppState.context.data[side].q1Scored = stats.q1ScoredList.slice(0, 10);
    AppState.context.data[side].q2Scored = stats.q2ScoredList.slice(0, 10);
    AppState.context.data[side].q3Scored = stats.q3ScoredList.slice(0, 10);
    AppState.context.data[side].q4Scored = stats.q4ScoredList.slice(0, 10);
    AppState.context.data[side].q1Allowed = stats.q1AllowedList.slice(0, 10);
    AppState.context.data[side].q2Allowed = stats.q2AllowedList.slice(0, 10);
    AppState.context.data[side].q3Allowed = stats.q3AllowedList.slice(0, 10);
    AppState.context.data[side].q4Allowed = stats.q4AllowedList.slice(0, 10);

    const teamName =
      document.getElementById(side === "A" ? "ssTeamAName" : "ssTeamBName")?.value?.trim() ||
      document.getElementById(side === "A" ? "teamAName" : "teamBName")?.value?.trim() ||
      "";
    updateTeamQuarterShapeProfile(
      document.getElementById("leagueSelect")?.value || "",
      teamName,
      stats.q1ScoredList.slice(0, 10),
      stats.q2ScoredList.slice(0, 10),
      stats.q3ScoredList.slice(0, 10),
      stats.q4ScoredList.slice(0, 10),
    );

    // Q-SPREAD: overall + venue-specific quarter margin form, SofaScore path.
    // _role mirrors the exact pattern already used above for h1 venue splits.
    const _qSpreadLeague = document.getElementById("leagueSelect")?.value || "";
    AppState.context.data[side].quarterSpreads = buildQuarterSpreadDual(
      {
        q1Scored: stats.q1ScoredList,
        q1Allowed: stats.q1AllowedList,
        q2Scored: stats.q2ScoredList,
        q2Allowed: stats.q2AllowedList,
        q3Scored: stats.q3ScoredList,
        q3Allowed: stats.q3AllowedList,
        q4Scored: stats.q4ScoredList,
        q4Allowed: stats.q4AllowedList,
      },
      {
        q1Scored: _role === "away" ? stats.q1AwayScoredList : stats.q1HomeScoredList,
        q1Allowed: _role === "away" ? stats.q1AwayAllowedList : stats.q1HomeAllowedList,
        q2Scored: _role === "away" ? stats.q2AwayScoredList : stats.q2HomeScoredList,
        q2Allowed: _role === "away" ? stats.q2AwayAllowedList : stats.q2HomeAllowedList,
        q3Scored: _role === "away" ? stats.q3AwayScoredList : stats.q3HomeScoredList,
        q3Allowed: _role === "away" ? stats.q3AwayAllowedList : stats.q3HomeAllowedList,
        q4Scored: _role === "away" ? stats.q4AwayScoredList : stats.q4HomeScoredList,
        q4Allowed: _role === "away" ? stats.q4AwayAllowedList : stats.q4HomeAllowedList,
      },
      _qSpreadLeague,
    );
  }

  const tagEl = document.getElementById(prefix + "AutoTag");
  if (tagEl) tagEl.style.display = "inline";
}

function reprocessBothTeamsFromEvents() {
  const tid = getFixtureTournamentId();

  if (window.__lastEventsA && window.__lastEventsA.length) {
    const idA = (document.getElementById("ssTeamAId")?.value || "").trim();
    if (idA) {
      const statsA = ssProcessTeamEvents(window.__lastEventsA, idA, "Team A", tid);
      updateTeamUIFromStats("A", statsA);
    }
  }

  if (window.__lastEventsB && window.__lastEventsB.length) {
    const idB = (document.getElementById("ssTeamBId")?.value || "").trim();
    if (idB) {
      const statsB = ssProcessTeamEvents(window.__lastEventsB, idB, "Team B", tid);
      updateTeamUIFromStats("B", statsB);
    }
  }

  extractH2HFromPastedEvents();
}

function onTournamentIdInput() {
  const nameEl = document.getElementById("ssTournamentName");
  if (nameEl) nameEl.textContent = "";
  const val = (document.getElementById("ssTournamentId")?.value || "").trim();
  if (!val) {
    window.__fixtureTournamentId = null;
    reprocessBothTeamsFromEvents();
    return;
  }
  if (!/^\d+$/.test(val)) return;
  window.__fixtureTournamentId = val;
  validateTournamentSample(val);
  reprocessBothTeamsFromEvents();
}

function validateTournamentSample(manualId) {
  const evA = window.__lastEventsA || [];
  const evB = window.__lastEventsB || [];
  if (!evA.length && !evB.length) return;

  function countCompletedForTournament(events, tid) {
    let count = 0;
    events.forEach((ev) => {
      if (!ssIsBasketballEvent(ev)) return;
      const sType = ev.status?.type ?? "";
      const done =
        sType === "finished" ||
        sType === "afterExtraTime" ||
        sType === "afterPenalties" ||
        ev.status?.finished === true;
      if (!done) return;
      const evTid = ev?.tournament?.uniqueTournament?.id;
      if (evTid != null && String(evTid) === String(tid)) count++;
    });
    return count;
  }

  const countA = countCompletedForTournament(evA, manualId);
  const countB = countCompletedForTournament(evB, manualId);
  const combined = countA + countB;
  if (combined <= 0) return;

  const nameEl = document.getElementById("ssTournamentName");
  const statusEl = document.getElementById("ssFetchStatus");
  if (combined < 3) {
    if (nameEl) nameEl.textContent = "⚠ thin match (" + combined + " games) — verify manually";
    if (statusEl) {
      statusEl.style.color = "#d98a00";
      statusEl.textContent =
        "⚠ Manual Tournament ID is thin (" +
        combined +
        " games combined). Verify this is the correct competition.";
    }
  }
}

function parseSofascoreIndividual(side) {
  const pasteEl = document.getElementById(side === "A" ? "ssPasteA" : "ssPasteB");
  let rawText = (pasteEl?.value || "").trim();
  const st = document.getElementById("ssFetchStatus");
  if (!rawText) return;

  try {
    const parsed = JSON.parse(rawText);
    const events = parsed.events || [];
    if (!events.length) throw new Error("No events found in pasted JSON.");

    const leagueSelect = document.getElementById("leagueSelect")?.value || "";
    const isWomenLeague =
      leagueSelect.endsWith("_w") || leagueSelect === "wnba" || leagueSelect === "wnba_pre";
    const firstEvent = events[0];
    const tournamentName = firstEvent?.tournament?.name || "";
    const isWomenEvent = tournamentName.toLowerCase().includes("women");
    const _leagueLabel = (() => {
      const sel = document.getElementById("leagueSelect");
      return sel && sel.selectedIndex >= 0
        ? (sel.options[sel.selectedIndex]?.text || leagueSelect).trim()
        : leagueSelect;
    })();
    if (!isWomenLeague && isWomenEvent) {
      if (st) {
        st.style.color = "#d92d2a";
        st.textContent =
          "❌ Rejected: pasted JSON is for a women's league, but your dropdown is set to: " +
          _leagueLabel;
      }
      return;
    }
    if (isWomenLeague && !isWomenEvent) {
      if (st) {
        st.style.color = "#d92d2a";
        st.textContent =
          "❌ Rejected: pasted JSON is for a men's league, but your dropdown is set to: " +
          _leagueLabel;
      }
      return;
    }

    const prevEvents = side === "A" ? window.__lastEventsA || [] : window.__lastEventsB || [];
    const mergedMap = new Map();
    [...prevEvents, ...events].forEach((ev) => {
      if (ev.id != null) mergedMap.set(ev.id, ev);
    });
    const mergedEvents = Array.from(mergedMap.values()).sort(
      (a, b) => (b.startTimestamp || 0) - (a.startTimestamp || 0),
    );
    if (side === "A") window.__lastEventsA = mergedEvents;
    else window.__lastEventsB = mergedEvents;

    if (side === "A") {
      window.__jsonPasteCountA = (window.__jsonPasteCountA || 0) + 1;
    } else {
      window.__jsonPasteCountB = (window.__jsonPasteCountB || 0) + 1;
    }

    if (getFixtureTournamentId() == null) {
      const _evA = window.__lastEventsA || [];
      const _evB = window.__lastEventsB || [];
      if (_evA.length > 0 && _evB.length > 0) {
        const _candidates = detectTournamentIdIntersection(_evA, _evB);
        if (_candidates.length >= 1) {
          const _best = _candidates[0];
          window.__fixtureTournamentId = _best.id;
          const _tidEl = document.getElementById("ssTournamentId");
          const _tNameEl = document.getElementById("ssTournamentName");
          if (_tidEl && !_tidEl.value.trim()) _tidEl.value = _best.id;
          if (_tNameEl)
            _tNameEl.textContent = _best.name
              ? "(" + _best.name + (_candidates.length > 1 ? " · override if wrong" : "") + ")"
              : "";
          engineDebug(
            "Tournament auto-detected via intersection: " + _best.id + " (" + _best.name + ")",
            { side, candidates: _candidates.length },
          );

          if (_best.combined < 3 && _tNameEl) {
            _tNameEl.textContent +=
              " ⚠ thin match (" + _best.combined + " games) — verify manually";
            const _ssStatusEl = document.getElementById("ssFetchStatus");
            if (_ssStatusEl) {
              _ssStatusEl.style.color = "#d98a00";
              _ssStatusEl.textContent =
                "⚠ Tournament auto-match is thin (" +
                _best.combined +
                " games combined). Consider entering the Tournament ID manually.";
            }
          }
        } else {
          const _tNameEl = document.getElementById("ssTournamentName");
          if (_tNameEl)
            _tNameEl.textContent = "(no shared tournament found — paste fixture JSON or enter ID)";
          engineDebug("Intersection detection: no shared tournament between both teams", { side });
        }
      } else {
        const primaryTid = detectPrimaryTournamentForEvents(events);
        if (primaryTid) {
          window.__fixtureTournamentId = primaryTid;
          const _tidEl = document.getElementById("ssTournamentId");
          const _tNameEl = document.getElementById("ssTournamentName");
          if (_tidEl && !_tidEl.value.trim()) _tidEl.value = primaryTid;
          const primaryEvent = events.find(
            (ev) => String(ev?.tournament?.uniqueTournament?.id) === primaryTid,
          );
          const primaryName =
            primaryEvent?.tournament?.name ||
            primaryEvent?.tournament?.uniqueTournament?.name ||
            "";
          if (_tNameEl && primaryName) _tNameEl.textContent = "(" + primaryName + ")";
        }
      }
    }

    const isFirstPaste =
      side === "A"
        ? document.getElementById("aFTScored")?.value?.trim() === ""
        : document.getElementById("bFTScored")?.value?.trim() === "";

    let idVal = (
      document.getElementById(side === "A" ? "ssTeamAId" : "ssTeamBId")?.value || ""
    ).trim();
    if (!idVal) {
      const idCounts = {};
      events.forEach((ev) => {
        if (ev.homeTeam?.id) idCounts[ev.homeTeam.id] = (idCounts[ev.homeTeam.id] || 0) + 1;
        if (ev.awayTeam?.id) idCounts[ev.awayTeam.id] = (idCounts[ev.awayTeam.id] || 0) + 1;
      });
      let maxCount = 0,
        bestId = null;
      for (const id in idCounts) {
        if (idCounts[id] > maxCount) {
          maxCount = idCounts[id];
          bestId = id;
        }
      }
      if (bestId) {
        idVal = bestId;
        const idEl = document.getElementById(side === "A" ? "ssTeamAId" : "ssTeamBId");
        if (idEl) {
          idEl.value = bestId;
          updateSofascoreLinks(side);
        }
      }
    }

    if (!idVal) throw new Error("Could not determine team ID from JSON. Enter it manually.");

    reprocessBothTeamsFromEvents();

    const _ssSyncName = document
      .getElementById(side === "A" ? "ssTeamAName" : "ssTeamBName")
      ?.value.trim();
    if (_ssSyncName) {
      const _mainInput = document.getElementById(side === "A" ? "teamAName" : "teamBName");
      if (_mainInput) _mainInput.value = _ssSyncName;
    }

    if (st && isFirstPaste) {
      st.style.color = "#2f8f4a";
      st.textContent = "✅ Team " + side + " stats loaded from pasted JSON!";
    } else if (st && !isFirstPaste) {
      st.style.color = "#2f8f4a";
      st.textContent = "✅ H2H updated from additional JSON for team " + side;
    }
    if (pasteEl) pasteEl.value = "";

    openSection("marketSection");
    openSection("teamASection");
    openSection("teamBSection");
    invalidateFetchedAudit();
  } catch (err) {
    if (st) {
      st.style.color = "#d92d2a";
      st.textContent = "❌ Parse failed: " + err.message;
    }
    engineDebug("parseSofascoreIndividual failed", { side, error: err.message });
  }
}

function extractH2HFromPastedEvents() {
  let idA = document.getElementById("ssTeamAId")?.value.trim();
  let idB = document.getElementById("ssTeamBId")?.value.trim();

  if (!idA || !idB) {
    if (window.__h2hEntryCache && window.__h2hEntryCache.length) {
      window.__h2hEntryCache = [];
      const h2hTag = document.getElementById("h2hAutoTag");
      if (h2hTag) h2hTag.style.display = "none";
      [
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
      ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });
      const ftCb = document.getElementById("useFTH2H");
      if (ftCb) ftCb.checked = false;
      const h1Cb = document.getElementById("use1HH2H");
      if (h1Cb) h1Cb.checked = false;
      ["useQ1H2H", "useQ2H2H", "useQ3H2H", "useQ4H2H"].forEach((id) => {
        const cb = document.getElementById(id);
        if (cb) cb.checked = false;
      });
    }
    return;
  }

  if (
    (!window.__lastEventsA || !window.__lastEventsA.length) &&
    (!window.__lastEventsB || !window.__lastEventsB.length)
  ) {
    return;
  }

  if (!window.__h2hEntryCache) window.__h2hEntryCache = [];

  let allEvents = [...(window.__lastEventsA || []), ...(window.__lastEventsB || [])];
  // Temporal gate: when a prediction event date is known, drop H2H events after it.
  try {
    const asOf =
      (typeof resolvePredictionAsOf === "function" && resolvePredictionAsOf(null, null)) ||
      (document.getElementById("eventDate") && document.getElementById("eventDate").value) ||
      null;
    if (asOf && typeof filterEventsAsOf === "function") {
      allEvents = filterEventsAsOf(allEvents, asOf);
    }
  } catch (_asOfH2H) {}

  if (!allEvents.length) return;

  const uniqueEvents = [];
  const seenIds = new Set();
  allEvents.forEach((ev) => {
    if (ev.id && !seenIds.has(ev.id)) {
      seenIds.add(ev.id);
      uniqueEvents.push(ev);
    }
  });

  let h2hMatches = uniqueEvents
    .filter((ev) => {
      const sType = ev.status?.type ?? "";
      const isTerminal =
        sType === "finished" ||
        sType === "afterExtraTime" ||
        sType === "afterPenalties" ||
        ev.status?.finished === true;
      if (!isTerminal) return false;
      const hId = String(ev.homeTeam?.id ?? "");
      const aId = String(ev.awayTeam?.id ?? "");

      if (hId && hId === aId) return false;
      if (!((hId === idA && aId === idB) || (hId === idB && aId === idA))) return false;

      const fixtureTid = getFixtureTournamentId();
      if (fixtureTid != null) {
        const evTid = ev?.tournament?.uniqueTournament?.id;
        if (evTid == null || String(evTid) !== fixtureTid) return false;
      }

      return true;
    })
    .sort((a, b) => {
      const tA = a.startTimestamp || 0;
      const tB = b.startTimestamp || 0;
      return tB - tA;
    })
    .slice(0, 10);

  if (h2hMatches.length >= 2) {
    const newEntries = [];
    h2hMatches.forEach((m) => {
      const isAHome = String(m.homeTeam?.id) === idA;
      const myScoreObj = isAHome ? m.homeScore : m.awayScore;
      const oppScoreObj = isAHome ? m.awayScore : m.homeScore;
      const myFT = Number(
        myScoreObj?.normaltime ?? myScoreObj?.current ?? myScoreObj?.display ?? 0,
      );
      const oppFT = Number(
        oppScoreObj?.normaltime ?? oppScoreObj?.current ?? oppScoreObj?.display ?? 0,
      );
      if (myFT > 0) {
        const mQ1 = Number(myScoreObj?.period1 ?? 0);
        const mQ2 = Number(myScoreObj?.period2 ?? 0);
        const mQ3 = Number(myScoreObj?.period3 ?? 0);
        const mQ4 = Number(myScoreObj?.period4 ?? 0);
        const oQ1 = Number(oppScoreObj?.period1 ?? 0);
        const oQ2 = Number(oppScoreObj?.period2 ?? 0);
        const oQ3 = Number(oppScoreObj?.period3 ?? 0);
        const oQ4 = Number(oppScoreObj?.period4 ?? 0);
        newEntries.push({
          id: m.id,
          ts: m.startTimestamp || 0,
          aFT: myFT,
          bFT: oppFT,
          aH1: mQ1 + mQ2,
          bH1: oQ1 + oQ2,
          aQ1: mQ1,
          bQ1: oQ1,
          aQ2: mQ2,
          bQ2: oQ2,
          aQ3: mQ3,
          bQ3: oQ3,
          aQ4: mQ4,
          bQ4: oQ4,
          hasQ: mQ1 > 0 || mQ2 > 0,
        });
      }
    });

    newEntries.sort((a, b) => b.ts - a.ts);
    window.__h2hEntryCache = newEntries.slice(0, 5);

    const merged = window.__h2hEntryCache;
    const h2hA = merged.map((e) => e.aFT);
    const h2hB = merged.map((e) => e.bFT);
    const h2hA1H = merged.filter((e) => e.hasQ).map((e) => e.aH1);
    const h2hB1H = merged.filter((e) => e.hasQ).map((e) => e.bH1);
    const h2hAQ1 = merged.filter((e) => e.hasQ).map((e) => e.aQ1);
    const h2hBQ1 = merged.filter((e) => e.hasQ).map((e) => e.bQ1);
    const h2hAQ2 = merged.filter((e) => e.hasQ).map((e) => e.aQ2);
    const h2hBQ2 = merged.filter((e) => e.hasQ).map((e) => e.bQ2);
    const h2hAQ3 = merged.filter((e) => e.hasQ).map((e) => e.aQ3);
    const h2hBQ3 = merged.filter((e) => e.hasQ).map((e) => e.bQ3);
    const h2hAQ4 = merged.filter((e) => e.hasQ).map((e) => e.aQ4);
    const h2hBQ4 = merged.filter((e) => e.hasQ).map((e) => e.bQ4);

    if (h2hA.length >= 2) {
      document.getElementById("aFTH2H").value = h2hA.join(",");
      document.getElementById("bFTH2H").value = h2hB.join(",");
      const h2hCb = document.getElementById("useFTH2H");
      if (h2hCb) h2hCb.checked = true;
      if (h2hA1H.length >= 2) {
        document.getElementById("a1HH2H").value = h2hA1H.join(",");
        document.getElementById("b1HH2H").value = h2hB1H.join(",");
        const h1Cb = document.getElementById("use1HH2H");
        if (h1Cb) h1Cb.checked = true;
      }
      if (h2hAQ1.length >= 2) {
        document.getElementById("aQ1H2H").value = h2hAQ1.join(",");
        document.getElementById("bQ1H2H").value = h2hBQ1.join(",");
        document.getElementById("aQ2H2H").value = h2hAQ2.join(",");
        document.getElementById("bQ2H2H").value = h2hBQ2.join(",");
        document.getElementById("aQ3H2H").value = h2hAQ3.join(",");
        document.getElementById("bQ3H2H").value = h2hBQ3.join(",");
        document.getElementById("aQ4H2H").value = h2hAQ4.join(",");
        document.getElementById("bQ4H2H").value = h2hBQ4.join(",");
        ["useQ1H2H", "useQ2H2H", "useQ3H2H", "useQ4H2H"].forEach((id) => {
          const cb = document.getElementById(id);
          if (cb) cb.checked = true;
        });
      }
      syncAllH2HCheckboxes(false);

      document.getElementById("h2hAutoTag").style.display = "inline";
      engineDebug("Pasted JSON H2H auto-filled (merged)", { games: h2hA.length });
    }
  }
}

const WORKER_BASE_URL = String(WORKER_URL || "").replace(/\/+$/, "");
const DEBUG = false;
const CACHE_MAX = 300;

const BB_CONFIG = {
  limits: { activePicks: 500, archivePruneDays: 90 },
  timeouts: { fetch: 15000 },
  version: "Path-A-v1",
};


/* ============================================================
 * BB ENGINE PATCH v23 — forensic seal fixes applied 2026-08-25
 * CRITICAL/HIGH addressed:
 *  1. Handicap settlement netCover = margin + line
 *  2. Counterfactual learning delta non-zero on decision change
 *  3. Vol regime thresholds on Euclidean scale
 *  4. Half priors tunable (halfShareH1/H2)
 *  5. Period advanced tagged synthetic
 *  6. netVenueEffect applied to ftProj
 *  8. Period pace no longer leaks FT pace under period source
 *  9. Fallback pace * leaguePaceNorm
 * 10. Fatigue team-level only; ftProj = projA+projB
 * 11. Tuner evaluates NO PLAY as 0 return
 * 14. Grade A requires fitted confidence coeffs
 * 15. H2H season decay prediction-date aware
 * 20. H2H context floor tunable (default 0.2)
 * 23. teamWeight clamped [0,1]
 * v24 follow-up (remaining 14): default coeffs neutralized, defense anchored,
 * advanced beta tunable, missing-defense soften, coeff version-lock, FT H2H
 * baseline=eb, quarter vol Euclidean, thin-vol prior, lock newSignals, winner
 * repair, walk-forward CV, reverse home/away warn, applyVolatility docs.
 * Residual SD full residual model and continuous sampleQuality wiring still
 * deepenable — see BB_ENGINE_30_ISSUES_FULL.md.
 * ============================================================ */

function getDynamicWeights(sampleTier, volatility, league) {
  const _tunedTeamWeight = isFinite(getParam("teamWeightBase", league))
    ? Number(getParam("teamWeightBase", league))
    : 0.65;
  const base = { teamWeight: _tunedTeamWeight, oppWeight: 1 - _tunedTeamWeight };
  const sampleShrink = sampleTier === "full" ? 0 : sampleTier === "thin" ? 0.5 : 0.85;

  const volRatio = isFinite(Number(volatility)) ? clampNumber(Number(volatility), 0, 2.5) : 0.5;
  const volShrink = volRatio * 0.3;
  const isTrustedLeague = LEAGUE_TRUST_PROFILES?.trusted?.includes(
    String(league || "").toLowerCase(),
  );
  const leagueShrink = isTrustedLeague ? 0 : 0.05;
  const shrink = clampNumber(sampleShrink + volShrink + leagueShrink, 0, 0.95);
  return {
    teamWeight: base.teamWeight - (base.teamWeight - 0.5) * shrink,
    oppWeight: base.oppWeight - (base.oppWeight - 0.5) * shrink,
  };
}

function getUnifiedVolatilityState(aSeries, bSeries, volLimit) {
  const aVol = getVolatilityRatioForSeries(aSeries, volLimit);
  const bVol = getVolatilityRatioForSeries(bSeries, volLimit);
  // FIX (CRITICAL #9): use the same sqrt(aVol^2+bVol^2) combination the
  // compute*Projection functions use internally for H2H weighting, instead
  // of max(aVol,bVol), which understates combined uncertainty whenever both
  // teams are volatile at once. This value feeds getDynamicWeights, which
  // sets the team-vs-opponent blend weight directly in the projection math.
  const combinedVol = clampNumber(
    Math.sqrt((isFinite(aVol) ? aVol : 0) ** 2 + (isFinite(bVol) ? bVol : 0) ** 2),
    0.5,
    2.5,
  );
  // FIX CRITICAL: combinedVol uses Euclidean norm; baseline teams at volRatio=1
  // produce ~1.414. Old thresholds (0.45/0.65/0.85) classified every standard
  // game as "extreme". Recalibrated to Euclidean scale.
  let regime = "stable";
  if (combinedVol > 1.95) regime = "extreme";
  else if (combinedVol > 1.55) regime = "volatile";
  else if (combinedVol > 1.15) regime = "moderate";
  return {
    aVolRatio: aVol,
    bVolRatio: bVol,
    combinedVolRatio: combinedVol,
    regime,
    isHighVol: combinedVol > 1.65,
  };
}

function applyDampedIntelSignal(baseProj, rawSignal, opponentVolRatio) {
  if (!isFinite(rawSignal) || rawSignal === 0) return baseProj;
  const dampening = Math.max(0.3, 1.0 - (opponentVolRatio || 0.5) * 0.5);
  const sign = Math.sign(rawSignal);
  const absSig = Math.abs(rawSignal);
  const scaledSignal = sign * Math.log1p(absSig) * 1.5;
  return baseProj + scaledSignal * dampening;
}

function buildGlobalModelState({ league, parsed, lines, injMultA = 1, injMultB = 1 }) {
  const eb = getLeagueScoreBase(league);
  const volLimit = getMarketVolLimit(league, "ft");

  const aVenue = getFetchedSeries("A", "venue", "ft", "scored");
  const bVenue = getFetchedSeries("B", "venue", "ft", "scored");
  const aFTS = aVenue.length >= 6 ? aVenue : getOverallSeries("A", 25);
  const bFTS = bVenue.length >= 6 ? bVenue : getOverallSeries("B", 25);
  const volState = getUnifiedVolatilityState(aFTS, bFTS, volLimit);
  const intel = computeIntelligencePack(league);
  return { league, eb, volLimit, volState, intel, injMultA, injMultB, aFTS, bFTS, lines };
}

const MODEL_CONFIG = {
  H2H_DIVERGE_THRESHOLD: 0.2,
  LINE_ANCHOR_NBA: 0.65,
  LINE_ANCHOR_OTHER: 0.5,
};

const MODEL_TUNING = {
  anchorEnabled: { ft: true, h1: true, h2: true, team: true },
  // anchorScale removed: never read by anchorProjection (blend is always n/10).
  // Historical localStorage keys that still hold anchorScale are ignored.
  h2hMaxWeight: 0.3,
  recencyWeights: [1.35, 1.2, 1.0, 0.85, 0.7, 0.56, 0.44, 0.33, 0.24, 0.16],

  quarterAnchorBlendWeight: 0.7,
};

const TUNABLE_PARAM_REGISTRY = {
  h2hFactor: {
    value: 1.0,
    min: 0.5,
    max: 1.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "team_a", "team_b"],
    description: "Overall H2H blend scaling factor applied on top of getH2HWeight's output",
    lastVerifiedAt: null,
  },

  h2hMaxWeight: {
    value: 0.3,
    min: 0.05,
    max: 0.5,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "Cap on H2H blend weight in getH2HWeight",
    lastVerifiedAt: null,
  },
  h2hTierInsufficientPenalty: {
    value: 0.55,
    min: 0.3,
    max: 0.9,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "getH2HWeight multiplier applied when sampleTier is 'insufficient'",
    lastVerifiedAt: null,
  },
  h2hTierThinPenalty: {
    value: 0.85,
    min: 0.5,
    max: 1.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "getH2HWeight multiplier applied when sampleTier is 'thin'",
    lastVerifiedAt: null,
  },
  h2hDivergenceThreshold: {
    value: 0.12,
    min: 0.05,
    max: 0.3,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description:
      "getH2HWeight relative-divergence threshold above which the divergence penalty kicks in",
    lastVerifiedAt: null,
  },
  h2hDivergenceSlope: {
    value: 2.5,
    min: 0.5,
    max: 5.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "getH2HWeight slope applied to divergence beyond h2hDivergenceThreshold",
    lastVerifiedAt: null,
  },
  h2hInjuryRiskSlope: {
    value: 1.5,
    min: 0.5,
    max: 3.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "getH2HWeight slope applied to injury-gap risk in the context penalty",
    lastVerifiedAt: null,
  },
  h2hVolRiskSlope: {
    value: 0.4,
    min: 0.1,
    max: 1.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "getH2HWeight slope applied to volatility-ratio risk in the context penalty",
    lastVerifiedAt: null,
  },
  h2hBlowoutGapThreshold: {
    value: 15,
    min: 8,
    max: 25,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "getH2HWeight point-gap threshold above which the blowout-risk penalty applies",
    lastVerifiedAt: null,
  },
  h2hBlowoutRisk: {
    value: 0.2,
    min: 0.05,
    max: 0.4,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description:
      "getH2HWeight fixed risk deduction applied when blowoutGap exceeds h2hBlowoutGapThreshold",
    lastVerifiedAt: null,
  },
  h2hPaceRisk: {
    value: 0.15,
    min: 0.05,
    max: 0.35,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "getH2HWeight fixed risk deduction applied when paceGapRisk is true",
    lastVerifiedAt: null,
  },
  pickBlowoutThresholdMult: {
    value: 1.15,
    min: 1.0,
    max: 1.5,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "team_a", "team_b"],
    description:
      "getPick edge-threshold multiplier applied when context.blowoutGap exceeds h2hBlowoutGapThreshold. Previously read via getParam but never registered, so it was silently stuck at this hardcoded default and logged an 'unknown key' debug warning on every FT/team_a/team_b pick.",
    lastVerifiedAt: null,
  },
  trapVolRatioThreshold: {
    value: 1.15,
    min: 1.0,
    max: 2.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "detectTrap: minimum volatility ratio required to flag a moderate-edge caution",
    lastVerifiedAt: null,
  },
  trapEdgePctMin: {
    value: 0.02,
    min: 0.0,
    max: 0.1,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description:
      "detectTrap: lower bound of the edge-pct band that counts as a moderate-edge caution",
    lastVerifiedAt: null,
  },
  trapEdgePctMax: {
    value: 0.06,
    min: 0.02,
    max: 0.2,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description:
      "detectTrap: upper bound of the edge-pct band that counts as a moderate-edge caution",
    lastVerifiedAt: null,
  },
  h2hLookbackSeasons: {
    value: 4,
    min: 1,
    max: 6,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "How many prior seasons of H2H games to fetch (fetchH2HCore lookbackYears)",
    lastVerifiedAt: null,
  },
  h2hDecayCurrent: {
    value: 1.0,
    min: 0.5,
    max: 1.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "Season-decay weight for current-season H2H games (getH2HSeasonDecayWeight)",
    lastVerifiedAt: null,
  },
  h2hDecayMinus1: {
    value: 0.75,
    min: 0.3,
    max: 1.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "Season-decay weight for 1-season-old H2H games",
    lastVerifiedAt: null,
  },
  h2hDecayMinus2: {
    value: 0.5,
    min: 0.1,
    max: 0.9,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "Season-decay weight for 2-season-old H2H games",
    lastVerifiedAt: null,
  },

  h2hDecayOlder: {
    value: 0.3,
    min: 0.05,
    max: 0.7,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "Season-decay weight for 3+ season-old H2H games",
    lastVerifiedAt: null,
  },

  recencyWeights: {
    value: [1.35, 1.2, 1.0, 0.85, 0.7, 0.56, 0.44, 0.33, 0.24, 0.16],
    min: null,
    max: null,
    type: "weight_vector",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "Per-game-index recency weighting for weightedRecentAverage",
    lastVerifiedAt: null,
  },
  teamWeightBase: {
    value: 0.65,
    min: 0.4,
    max: 0.85,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4", "team_a", "team_b"],
    description:
      "Base own-scoring vs opponent-defense blend ratio (getDynamicWeights base.teamWeight)",
    lastVerifiedAt: null,
  },
  venueMinGames: {
    value: 6,
    min: 3,
    max: 10,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1"],
    description:
      "Minimum venue-split games required before venue blending activates (VENUE_BLEND_CONFIG.minGames)",
    lastVerifiedAt: null,
  },
  venueStrongGames: {
    value: 10,
    min: 6,
    max: 15,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1"],
    description:
      "Venue sample size for the strong-tier blend weight (VENUE_BLEND_CONFIG.strongGames)",
    lastVerifiedAt: null,
  },
  venueModerateWeight: {
    value: 0.5,
    min: 0.2,
    max: 0.7,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1"],
    description:
      "Venue blend weight at moderate sample tier (VENUE_BLEND_CONFIG.moderateVenueWeight)",
    lastVerifiedAt: null,
  },
  venueStrongWeight: {
    value: 0.7,
    min: 0.4,
    max: 0.85,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1"],
    description: "Venue blend weight at strong sample tier (VENUE_BLEND_CONFIG.strongVenueWeight)",
    lastVerifiedAt: null,
  },
  quarterVenueProxyFactor: {
    value: 1,
    min: 0,
    max: 1.5,
    type: "scalar",
    scope: "global",
    appliesTo: ["q1", "q2", "q3", "q4"],
    description:
      "Scales the FT venue adjustment proxy applied to quarter projections (QUARTER_VENUE_PROXY_FACTOR)",
    lastVerifiedAt: null,
  },
  injuryOppBoostFactor: {
    value: 0.2,
    min: 0.0,
    max: 0.5,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description:
      "How much an injured team's opponent projection increases (INJURY_OPPONENT_BOOST_FACTOR)",
    lastVerifiedAt: null,
  },
  injuryUsageRedistribution: {
    value: 0.3,
    min: 0.0,
    max: 0.6,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description:
      "fetchInjuryMeta: fraction of an injured player's lost production assumed recaptured by teammates' usage bump, applied before the maxInjCap",
    lastVerifiedAt: null,
  },
  underEdgeFactor: {
    value: 1.2,
    min: 1.0,
    max: 1.6,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4", "team_a", "team_b"],
    description:
      "Multiplier making UNDER picks require a larger edge than OVER (UNDER_EDGE_FACTOR)",
    lastVerifiedAt: null,
  },

  extremeExpansion: {
    value: 1.3,
    min: 1.0,
    max: 1.4,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description:
      "DEPRECATED / NOT WIRED: the mechanism that read this value was removed from computeFTProjection (see A2 fix). Currently has zero effect on any computation. Kept only so historical references don't throw; do not tune this expecting output to change.",
    lastVerifiedAt: null,
  },
  paceClampMinNbaNcaa: {
    value: 0.65,
    min: 0.5,
    max: 0.9,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description:
      "Lower pace clamp bound for NBA/NCAA-tier leagues (getEffectivePaceClamp wide.min)",
    lastVerifiedAt: null,
  },
  paceClampMaxNbaNcaa: {
    value: 1.35,
    min: 1.1,
    max: 1.5,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description:
      "Upper pace clamp bound for NBA/NCAA-tier leagues (getEffectivePaceClamp wide.max)",
    lastVerifiedAt: null,
  },

  paceClampMinOther: {
    value: 0.7,
    min: 0.5,
    max: 0.9,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "Lower pace clamp bound for non-NBA/NCAA leagues",
    lastVerifiedAt: null,
  },
  paceClampMaxOther: {
    value: 1.3,
    min: 1.1,
    max: 1.5,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "Upper pace clamp bound for non-NBA/NCAA leagues",
    lastVerifiedAt: null,
  },
  advancedBlendWeight: {
    value: 0.45,
    min: 0.0,
    max: 1.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description:
      "Weight given to the ESPN-boxscore-derived pace/ortg/drtg blend vs. the points-path projection (0 = points-only, 1 = advanced-only).",
    lastVerifiedAt: null,
  },

  confidenceAThresh: {
    value: 0.66,
    min: 0.55,
    max: 0.8,
    type: "scalar",
    scope: "global",
    appliesTo: [
      "ft",
      "h1",
      "h2",
      "q1",
      "q2",
      "q3",
      "q4",
      "team_a",
      "team_b",
      "winner",
      "handicap",
      "handicap_h1",
      "handicap_h2",
    ],
    description: "Win-probability cutoff for confidence grade A",
    lastVerifiedAt: null,
  },
  confidenceBThresh: {
    value: 0.58,
    min: 0.5,
    max: 0.7,
    type: "scalar",
    scope: "global",
    appliesTo: [
      "ft",
      "h1",
      "h2",
      "q1",
      "q2",
      "q3",
      "q4",
      "team_a",
      "team_b",
      "winner",
      "handicap",
      "handicap_h1",
      "handicap_h2",
    ],
    description: "Win-probability cutoff for confidence grade B",
    lastVerifiedAt: null,
  },
  confidenceCThresh: {
    value: 0.51,
    min: 0.45,
    max: 0.6,
    type: "scalar",
    scope: "global",
    appliesTo: [
      "ft",
      "h1",
      "h2",
      "q1",
      "q2",
      "q3",
      "q4",
      "team_a",
      "team_b",
      "winner",
      "handicap",
      "handicap_h1",
      "handicap_h2",
    ],
    description: "Win-probability cutoff for confidence grade C",
    lastVerifiedAt: null,
  },
  volatilityLimit: {
    value: 12,
    min: 4,
    max: 30,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "h1", "q1", "q2", "q3", "q4"],
    description: "Volatility limits used to scale volatility ratio",
    lastVerifiedAt: null,
  },

  h1VolScale: {
    value: 0.7071,
    min: 0.4,
    max: 1.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["h1"],
    description:
      "Half-game volatility limit as a fraction of the full-game volatilityLimit (getMarketVolLimit). Default 0.7071 ≈ 1/sqrt(2), a time-fraction variance scaling.",
    lastVerifiedAt: null,
  },
  teamVolScale: {
    value: 0.5,
    min: 0.3,
    max: 1.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["team_a", "team_b"],
    description:
      "Single-team full-game volatility limit as a fraction of the full-game volatilityLimit (getMarketVolLimit). Was a flat hardcoded 0.5 with no documented derivation.",
    lastVerifiedAt: null,
  },
  quarterVolScale: {
    value: 0.5,
    min: 0.25,
    max: 1.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["q1", "q2", "q3", "q4"],
    description:
      "Quarter volatility limit as a fraction of the full-game volatilityLimit (getMarketVolLimit). Was a flat hardcoded 0.5 with no documented derivation.",
    lastVerifiedAt: null,
  },
  edgeFTPointThreshold: {
    value: 5.0,
    min: 2.0,
    max: 15.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft"],
    description: "Point edge threshold required for FT picks",
    lastVerifiedAt: null,
  },
  edgeH1PointThreshold: {
    value: 6.0,
    min: 2.0,
    max: 15.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["h1"],
    description: "Point edge threshold required for 1H picks",
    lastVerifiedAt: null,
  },

  edgeH2PointThreshold: {
    value: 6.0,
    min: 2.0,
    max: 15.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["h2"],
    description: "Point edge threshold required for 2H Total picks",
    lastVerifiedAt: null,
  },
  edgeTeamPointThreshold: {
    value: 8.0,
    min: 3.0,
    max: 20.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["team_a", "team_b"],
    description: "Point edge threshold required for Team Total picks",
    lastVerifiedAt: null,
  },
  edgeQPointThreshold: {
    value: 3.0,
    min: 1.0,
    max: 10.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["q1", "q2", "q3", "q4"],
    description: "Point edge threshold required for Quarter picks",
    lastVerifiedAt: null,
  },

  edgeWinnerPointThreshold: {
    value: 5.0,
    min: 1.0,
    max: 20.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["winner"],
    description:
      "Margin-projection point threshold (vs. combined margin volatility) required before a Winner pick is made",
    lastVerifiedAt: null,
  },
  edgeHandicapPointThreshold: {
    value: 5.0,
    min: 1.0,
    max: 15.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["handicap"],
    description:
      "Point edge threshold required for full-game Handicap picks (edge = marginProjection + handicapLine)",
    lastVerifiedAt: null,
  },
  edgeHandicapH1PointThreshold: {
    value: 4.0,
    min: 1.0,
    max: 12.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["handicap_h1"],
    description: "Point edge threshold required for 1H Handicap picks (WNBA-only market)",
    lastVerifiedAt: null,
  },
  edgeHandicapH2PointThreshold: {
    value: 4.0,
    min: 1.0,
    max: 12.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["handicap_h2"],
    description: "Point edge threshold required for 2H Handicap picks (WNBA-only market)",
    lastVerifiedAt: null,
  },

  fatigueB2BPenalty: {
    value: -2.5,
    min: -6.0,
    max: 0,
    type: "scalar",
    scope: "global",
    appliesTo: ["ft", "team_a", "team_b"],
    description:
      "Point signal applied by buildTotalMarketIntelSignal/buildTeamMarketIntelSignal (via applyDampedIntelSignal in computeFTProjection) when a team has under 1 day of rest (back-to-back). Was hardcoded; now tunable AND live-wired.",
    lastVerifiedAt: null,
  },
  quarterAnchorBlendWeight: {
    value: 0.7,
    min: 0.3,
    max: 1.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["q1", "q2", "q3", "q4"],
    description:
      "Blend weight pulling each quarter's raw projection toward its H1/H2-anchored scale. Applied in the live quarter-anchor block. Was hardcoded in MODEL_TUNING only; now tunable.",
    lastVerifiedAt: null,
  },

  quarterSpreadMinSampleOverall: {
    value: 5,
    min: 3,
    max: 10,
    type: "scalar",
    scope: "global",
    appliesTo: ["q1", "q2", "q3", "q4"],
    description:
      "computeQuarterSpread: minimum paired games (overall, not venue-split) before a team's recent quarter-margin form is treated as reliable rather than insufficient-data.",
    lastVerifiedAt: null,
  },
  quarterSpreadMinSampleSplit: {
    value: 3,
    min: 2,
    max: 8,
    type: "scalar",
    scope: "global",
    appliesTo: ["q1", "q2", "q3", "q4"],
    description:
      "computeQuarterSpread: minimum paired games for the venue-specific (home or away) quarter-margin split, which sees fewer games than the overall split and needs a lower floor.",
    lastVerifiedAt: null,
  },
  quarterSpreadBlowoutGapThreshold: {
    value: 18,
    min: 10,
    max: 30,
    type: "scalar",
    scope: "global",
    appliesTo: ["q1", "q2", "q3", "q4"],
    description:
      "computeQuarterSpread: single-quarter |scored-allowed| above this is excluded as a likely garbage-time/blowout outlier before averaging. Deliberately separate from h2hBlowoutGapThreshold, which is calibrated for full-game gaps, not one quarter.",
    lastVerifiedAt: null,
  },
  quarterSpreadMaterialityPts: {
    value: 2.0,
    min: 0.5,
    max: 6.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["q1", "q2", "q3", "q4"],
    description:
      "getQuarterFormAgreement: minimum |margin| (form or model) required before a quarter's recent-form margin is labeled SUPPORT/CONTRA against the model's projection. Below this on both sides, labeled NEUTRAL rather than treating noise as a signal.",
    lastVerifiedAt: null,
  },
  quarterSpreadEdgeHaircutMaxFrac: {
    value: 0.3,
    min: 0.1,
    max: 0.6,
    type: "scalar",
    scope: "global",
    appliesTo: ["q1", "q2", "q3", "q4"],
    description:
      "applyQuarterFormEdgeHaircut: max fraction of the model's own edge that a CONTRA quarter-form signal can trim off, before the capPts hard limit is also applied. One-directional — SUPPORT never adds edge, only CONTRA ever removes it.",
    lastVerifiedAt: null,
  },
  quarterSpreadEdgeHaircutCapPts: {
    value: 1.0,
    min: 0.25,
    max: 3.0,
    type: "scalar",
    scope: "global",
    appliesTo: ["q1", "q2", "q3", "q4"],
    description:
      "applyQuarterFormEdgeHaircut: hard point cap on the CONTRA edge haircut, independent of maxFrac — prevents a single noisy quarter-form sample from erasing a large edge outright, and prevents the haircut from ever flipping a pick's sign (it clamps at 0, not past it).",
    lastVerifiedAt: null,
  },

  injuryOppBoostFactor_NOTE: null,
};
delete TUNABLE_PARAM_REGISTRY.injuryOppBoostFactor_NOTE;

const TUNABLE_PARAM_REGISTRY_STORAGE_KEY = "BB_TUNABLE_PARAM_REGISTRY_V1";

function loadTunableParamRegistryOverrides() {
  try {
    const raw = localStorage.getItem(TUNABLE_PARAM_REGISTRY_STORAGE_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw);
    if (!stored || typeof stored !== "object") return;
    Object.keys(stored).forEach((key) => {
      const entry = TUNABLE_PARAM_REGISTRY[key];
      if (entry && stored[key] && "value" in stored[key]) {
        let storedValue = stored[key].value;
        if (
          entry.type === "scalar" &&
          isFinite(entry.min) &&
          isFinite(entry.max) &&
          isFinite(storedValue)
        ) {
          storedValue = clampNumber(storedValue, entry.min, entry.max);
        }
        entry.value = storedValue;
        entry.lastVerifiedAt = stored[key].lastVerifiedAt || null;
      }
    });
  } catch (e) {
    engineDebug("loadTunableParamRegistryOverrides failed: " + (e?.message || String(e)), {
      error: e,
    });
  }
}

function saveTunableParamRegistryOverrides() {
  try {
    const out = {};
    Object.keys(TUNABLE_PARAM_REGISTRY).forEach((key) => {
      out[key] = {
        value: TUNABLE_PARAM_REGISTRY[key].value,
        lastVerifiedAt: TUNABLE_PARAM_REGISTRY[key].lastVerifiedAt,
      };
    });
    localStorage.setItem(TUNABLE_PARAM_REGISTRY_STORAGE_KEY, JSON.stringify(out));
  } catch (e) {
    engineDebug(
      "saveTunableParamRegistryOverrides failed to persist: " + (e?.message || String(e)),
      { error: e },
    );
  }
}

const TUNABLE_PARAM_LEAGUE_OVERRIDES_KEY = "BB_TUNABLE_PARAM_LEAGUE_OVERRIDES_V1";
let g_tunableParamLeagueOverrides = {};

function loadTunableParamLeagueOverrides() {
  try {
    const raw = localStorage.getItem(TUNABLE_PARAM_LEAGUE_OVERRIDES_KEY);
    const parsed = raw ? JSON.parse(raw) || {} : {};

    Object.keys(parsed).forEach((leagueKey) => {
      const leagueOverrides = parsed[leagueKey];
      if (!leagueOverrides || typeof leagueOverrides !== "object") return;
      Object.keys(leagueOverrides).forEach((paramKey) => {
        const entry = TUNABLE_PARAM_REGISTRY[paramKey];
        const override = leagueOverrides[paramKey];
        if (
          entry &&
          override &&
          "value" in override &&
          entry.type === "scalar" &&
          isFinite(entry.min) &&
          isFinite(entry.max) &&
          isFinite(override.value)
        ) {
          override.value = clampNumber(override.value, entry.min, entry.max);
        }
      });
    });
    g_tunableParamLeagueOverrides = parsed;
  } catch (e) {
    engineDebug("loadTunableParamLeagueOverrides failed: " + (e?.message || String(e)), {
      error: e,
    });
    g_tunableParamLeagueOverrides = {};
  }
}

function saveTunableParamLeagueOverrides() {
  try {
    localStorage.setItem(
      TUNABLE_PARAM_LEAGUE_OVERRIDES_KEY,
      JSON.stringify(g_tunableParamLeagueOverrides),
    );
  } catch (e) {
    engineDebug("saveTunableParamLeagueOverrides failed to persist: " + (e?.message || String(e)), {
      error: e,
    });
  }
}

function pruneUnverifiedLeagueOverrideDrift() {
  const PRUNABLE_STATIC_SOURCES = {
    volatilityLimit: (lk) => getLeagueVolLimit(lk),
    edgeFTPointThreshold: (lk) => LEAGUE_EDGE_POINT_THRESHOLDS[lk]?.ft,
    edgeH1PointThreshold: (lk) => LEAGUE_EDGE_POINT_THRESHOLDS[lk]?.h1,
    edgeTeamPointThreshold: (lk) => LEAGUE_EDGE_POINT_THRESHOLDS[lk]?.team,
    edgeQPointThreshold: (lk) => LEAGUE_EDGE_POINT_THRESHOLDS[lk]?.q,
  };

  let prunedCount = 0;
  const prunedDetail = [];

  Object.keys(g_tunableParamLeagueOverrides).forEach((leagueKey) => {
    const leagueOverrides = g_tunableParamLeagueOverrides[leagueKey];
    if (!leagueOverrides || typeof leagueOverrides !== "object") return;

    Object.keys(PRUNABLE_STATIC_SOURCES).forEach((paramKey) => {
      const entry = leagueOverrides[paramKey];
      if (!entry || entry.lastVerifiedAt) return;

      const expectedStaticValue = PRUNABLE_STATIC_SOURCES[paramKey](leagueKey);
      if (!isFinite(expectedStaticValue)) return;

      if (Number(entry.value) !== Number(expectedStaticValue)) {
        prunedDetail.push({
          league: leagueKey,
          param: paramKey,
          staleValue: entry.value,
          expectedStaticValue,
        });
        delete leagueOverrides[paramKey];
        prunedCount++;
      }
    });
  });

  if (prunedCount > 0) {
    saveTunableParamLeagueOverrides();
    engineDebug(
      "pruneUnverifiedLeagueOverrideDrift removed " +
        prunedCount +
        " unstamped, unexplained league override(s)",
      { pruned: prunedDetail },
    );
  }
}

let g_currentLiveComputeMarket = null;

const BB_LOCKED_CONFIG_KEY = "BB_LOCKED_CONFIG_V1";
let g_lockedConfigCache = null;

function loadLockedConfigStore() {
  if (g_lockedConfigCache) return g_lockedConfigCache;
  try {
    const raw = localStorage.getItem(BB_LOCKED_CONFIG_KEY);
    g_lockedConfigCache = raw ? JSON.parse(raw) || {} : {};
  } catch (e) {
    g_lockedConfigCache = {};
    if (typeof engineDebug === "function") {
      engineDebug("loadLockedConfigStore failed: " + (e?.message || String(e)));
    }
  }
  return g_lockedConfigCache;
}

function saveLockedConfigStore(store) {
  try {
    g_lockedConfigCache = store || {};
    localStorage.setItem(BB_LOCKED_CONFIG_KEY, JSON.stringify(g_lockedConfigCache));
    return true;
  } catch (e) {
    if (typeof engineDebug === "function") {
      engineDebug("saveLockedConfigStore failed: " + (e?.message || String(e)));
    }
    return false;
  }
}

function hasLockedConfig(league, market) {
  if (!league || !market) return false;
  const store = loadLockedConfigStore();
  const lk = String(league).toLowerCase();
  const mk = String(market).toLowerCase();
  return !!(
    store[lk] &&
    store[lk][mk] &&
    store[lk][mk].params &&
    typeof store[lk][mk].params === "object"
  );
}

function getLockedParam(key, league, market) {
  if (!key || !league || !market) return undefined;
  const store = loadLockedConfigStore();
  const lk = String(league).toLowerCase();
  const mk = String(market).toLowerCase();
  const entry = store[lk] && store[lk][mk];
  if (!entry || !entry.params || !(key in entry.params)) return undefined;
  return entry.params[key];
}

function getLockedConfigMeta(league, market) {
  if (!league || !market) return null;
  const store = loadLockedConfigStore();
  const lk = String(league).toLowerCase();
  const mk = String(market).toLowerCase();
  const entry = store[lk] && store[lk][mk];
  return entry && entry.meta ? entry.meta : null;
}

function saveLockedConfig(league, market, params, meta) {
  if (!league || !market || !params || typeof params !== "object") {
    if (typeof engineDebug === "function") {
      engineDebug("saveLockedConfig: missing league/market/params", { league, market });
    }
    return false;
  }
  const store = loadLockedConfigStore();
  const lk = String(league).toLowerCase();
  const mk = String(market).toLowerCase();
  if (!store[lk]) store[lk] = {};
  store[lk][mk] = {
    params: Object.assign({}, params),
    meta: Object.assign(
      {
        lockedAt: new Date().toISOString(),
        searchVersion: "joint-v1",
      },
      meta || {},
    ),
  };
  return saveLockedConfigStore(store);
}

function clearLockedConfig(league, market) {
  if (!league) return false;
  const store = loadLockedConfigStore();
  const lk = String(league).toLowerCase();
  if (!store[lk]) return false;
  if (market) {
    const mk = String(market).toLowerCase();
    delete store[lk][mk];
    if (Object.keys(store[lk]).length === 0) delete store[lk];
  } else {
    delete store[lk];
  }
  return saveLockedConfigStore(store);
}

window.loadLockedConfigStore = loadLockedConfigStore;
window.saveLockedConfig = saveLockedConfig;
window.hasLockedConfig = hasLockedConfig;
window.getLockedParam = getLockedParam;
window.getLockedConfigMeta = getLockedConfigMeta;
window.clearLockedConfig = clearLockedConfig;

function getTunableParam(key, league, market) {
  const entry = TUNABLE_PARAM_REGISTRY[key];
  if (!entry) {
    engineDebug("getTunableParam: unknown key '" + key + "' — check TUNABLE_PARAM_REGISTRY", {
      key,
      league,
    });
    return null;
  }

  // FIX Issue 20: do not use mutable g_currentLiveComputeMarket for locks unless
  // the caller explicitly passed market. Prevents wrong-lock reads after market key drifts.
  const effectiveMarket =
    market != null && market !== ""
      ? market
      : null; // ignore g_currentLiveComputeMarket for lock selection
  if (league && effectiveMarket && hasLockedConfig(league, effectiveMarket)) {
    const lockedVal = getLockedParam(key, league, effectiveMarket);
    if (lockedVal !== undefined) {
      return lockedVal;
    }
  }

  let overrideValue = entry.value;
  let overrideStamp = entry.lastVerifiedAt || null;
  if (league && entry.scope === "global") {
    const leagueKey = String(league).toLowerCase();
    const leagueEntry = g_tunableParamLeagueOverrides?.[leagueKey]?.[key];
    if (leagueEntry && "value" in leagueEntry) {
      overrideValue = leagueEntry.value;
      overrideStamp = leagueEntry.lastVerifiedAt || null;
    }
  }

  return overrideValue;
}

function setTunableParam(key, newValue, scopeLeague, verifiedAt) {
  const entry = TUNABLE_PARAM_REGISTRY[key];
  if (!entry) {
    engineDebug("setTunableParam: unknown key '" + key + "'", { key, newValue, scopeLeague });
    return false;
  }
  let clampedValue = newValue;
  if (entry.type === "scalar" && isFinite(entry.min) && isFinite(entry.max) && isFinite(newValue)) {
    clampedValue = clampNumber(newValue, entry.min, entry.max);
  }
  const stamp = verifiedAt || new Date().toISOString();

  if (scopeLeague) {
    if (entry.scope !== "global") {
      engineDebug("setTunableParam: key '" + key + "' does not allow league-level overrides", {
        key,
        scopeLeague,
      });
      return false;
    }
    const leagueKey = String(scopeLeague).toLowerCase();
    if (!g_tunableParamLeagueOverrides[leagueKey]) g_tunableParamLeagueOverrides[leagueKey] = {};
    g_tunableParamLeagueOverrides[leagueKey][key] = { value: clampedValue, lastVerifiedAt: stamp };
    saveTunableParamLeagueOverrides();
  } else {
    entry.value = clampedValue;
    entry.lastVerifiedAt = stamp;
    saveTunableParamRegistryOverrides();
  }
  engineDebug("setTunableParam promoted", {
    key,
    newValue: clampedValue,
    scopeLeague: scopeLeague || "global",
    verifiedAt: stamp,
  });
  return true;
}

loadTunableParamRegistryOverrides();
loadTunableParamLeagueOverrides();

function getStoredTunerProposal(league) {
  try {
    const key = "BB_TUNER_PROPOSAL_" + (league || "global");
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.applied || !Array.isArray(parsed.promotions) || !parsed.promotions.length)
      return null;
    return parsed;
  } catch (e) {
    engineDebug("getStoredTunerProposal failed", { league, error: e?.message || String(e) });
    return null;
  }
}

function applyTunerProposal(league) {
  const scopeKey = league || "global";
  const proposal = getStoredTunerProposal(league);
  if (!proposal) return false;
  proposal.promotions.forEach((p) => {
    setTunableParam(p.key, p.val, proposal.league || null, new Date().toISOString());
  });
  try {
    proposal.applied = true;
    proposal.appliedAt = new Date().toISOString();
    localStorage.setItem("BB_TUNER_PROPOSAL_" + scopeKey, JSON.stringify(proposal));
  } catch (e) {
    engineDebug(
      "applyTunerProposal failed to mark proposal applied: " + (e?.message || String(e)),
      { error: e },
    );
  }

  try {
    const health = _getCanaryHealth(league || null);
    let canaries = {};
    try {
      canaries = JSON.parse(localStorage.getItem("BB_TUNER_CANARIES") || "{}");
    } catch (e) {
      engineDebug("Tuner canary load failed", { error: e?.message || String(e), league });
    }
    const existingCanary = canaries[scopeKey];
    if (existingCanary && !existingCanary.resolved) {
      const merged = Array.isArray(existingCanary.promotions)
        ? existingCanary.promotions.map((p) => ({ ...p }))
        : [];
      (proposal.promotions || []).forEach((next) => {
        const idx = merged.findIndex((prev) => prev.key === next.key);
        if (idx >= 0) {
          merged[idx] = { ...merged[idx], ...next, old: merged[idx].old };
        } else {
          merged.push({ ...next });
        }
      });
      canaries[scopeKey] = {
        ...existingCanary,
        league: proposal.league || existingCanary.league || null,
        promotions: merged,
        lastAppliedAt: new Date().toISOString(),
        resolved: false,
      };
    } else {
      canaries[scopeKey] = {
        league: proposal.league || null,
        promotions: proposal.promotions,
        nAtApply: health ? health.n : 0,
        canaryWindow: 20,
        appliedAt: new Date().toISOString(),
        resolved: false,
      };
    }
    localStorage.setItem("BB_TUNER_CANARIES", JSON.stringify(canaries));
  } catch (e) {
    engineDebug("applyTunerProposal failed to register canary: " + (e?.message || String(e)), {
      error: e,
    });
  }
  engineDebug("Tuner proposal manually applied via Configs panel (canary monitoring active)", {
    league: scopeKey,
    promotions: proposal.promotions,
  });
  return true;
}

function getStoredConstantProposal(constantName) {
  try {
    const raw = localStorage.getItem("BB_CONST_PROPOSAL_" + constantName);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.applied) return null;
    return parsed;
  } catch (e) {
    engineDebug("getStoredConstantProposal failed", {
      constantName,
      error: e?.message || String(e),
    });
    return null;
  }
}

function applyEngineConstantProposal(constantName) {
  const proposal = getStoredConstantProposal(constantName);
  if (!proposal) return false;
  setTunableConstant(constantName, proposal.proposedValue, proposal.netDelta, proposal.sampleCount);
  try {
    proposal.applied = true;
    proposal.appliedAt = new Date().toISOString();
    localStorage.setItem("BB_CONST_PROPOSAL_" + constantName, JSON.stringify(proposal));
  } catch (e) {
    engineDebug(
      "applyEngineConstantProposal failed to mark proposal applied: " + (e?.message || String(e)),
      { error: e },
    );
  }
  engineDebug("Engine constant proposal manually applied via Configs panel", {
    constantName,
    value: proposal.proposedValue,
  });
  return true;
}

window.applyTunerProposalFromUI = function (league) {
  const scopeKey = league || "global";
  if (
    !confirm(
      "Apply the pending tuning proposal for " +
        scopeKey +
        "? This will overwrite the current tunable parameter values.",
    )
  )
    return;
  if (applyTunerProposal(league)) {
    if (typeof renderConfigsPanel === "function") renderConfigsPanel();
  }
};

window.applyConstantProposalFromUI = function (constantName) {
  if (!confirm("Apply the pending proposal for " + constantName + "?")) return;
  if (applyEngineConstantProposal(constantName)) {
    if (typeof renderConfigsPanel === "function") renderConfigsPanel();
  }
};

function getStoredConfidenceModelProposal() {
  try {
    const coeffRaw = localStorage.getItem("BB_CONFIDENCE_MODEL_COEFF_PROPOSED");
    if (!coeffRaw) return null;
    const coeff = JSON.parse(coeffRaw);
    if (!coeff || !Object.keys(coeff).length) return null;
    let platt = {};
    try {
      platt = JSON.parse(localStorage.getItem("BB_PLATT_CALIB_PROPOSED") || "{}");
    } catch (e) {
      engineDebug("Platt calibration proposal load failed", { error: e?.message || String(e) });
    }
    let sampleSizes = {};
    try {
      sampleSizes = JSON.parse(
        localStorage.getItem("BB_CONFIDENCE_MODEL_COEFF_N_PROPOSED") ||
          localStorage.getItem("BB_CONFIDENCE_MODEL_COEFF_N") ||
          "{}",
      );
    } catch (e) {
      engineDebug("Confidence coefficient sample-size load failed", {
        error: e?.message || String(e),
      });
    }
    let thresholds = null;
    try {
      const tRaw = localStorage.getItem("BB_CONFIDENCE_THRESHOLDS_PROPOSED");
      if (tRaw) thresholds = JSON.parse(tRaw);
    } catch (e) {
      engineDebug("Confidence thresholds proposal load failed", { error: e?.message || String(e) });
    }
    let gradeWinRates = null;
    try {
      const gRaw = localStorage.getItem("BB_CONFIDENCE_GRADE_WIN_RATES_PROPOSED");
      if (gRaw) gradeWinRates = JSON.parse(gRaw);
    } catch (e) {
      engineDebug("Grade win-rates proposal load failed", { error: e?.message || String(e) });
    }
    return { coeff, platt, sampleSizes, thresholds, gradeWinRates, scopes: Object.keys(coeff) };
  } catch (e) {
    engineDebug("getStoredConfidenceModelProposal failed", { error: e?.message || String(e) });
    return null;
  }
}

function applyConfidenceModelProposal() {
  const proposal = getStoredConfidenceModelProposal();
  if (!proposal) return false;
  // FIX Issue 32: block promote unless fitted definition is met and tracker is advisory-safe.
  try {
    const nMap = JSON.parse(localStorage.getItem("BB_CONFIDENCE_MODEL_COEFF_N") || "{}");
    const nVals = Object.values(nMap || {}).map(Number).filter((x) => isFinite(x));
    const maxN = nVals.length ? Math.max.apply(null, nVals) : 0;
    if (maxN < 40) {
      engineDebug("Confidence promote blocked: sample N < 40", { maxN });
      return false;
    }
  } catch (_nErr) {
    engineDebug("Confidence promote blocked: cannot read sample sizes");
    return false;
  }
  try {
    if (typeof TRACKER_POLICY !== "undefined" && TRACKER_POLICY && TRACKER_POLICY.advisoryOnly === false) {
      engineDebug("Confidence promote blocked: tracker not advisory-only");
      return false;
    }
  } catch (_tErr) {}
  try {
    // True atomic promote: one primary blob first, then best-effort legacy key mirrors.
    const liveBundle = {
      coeff: proposal.coeff,
      platt: proposal.platt,
      sampleSizes:
        proposal.sampleSizes && typeof proposal.sampleSizes === "object"
          ? proposal.sampleSizes
          : null,
      thresholds:
        proposal.thresholds && typeof proposal.thresholds === "object" ? proposal.thresholds : null,
      gradeWinRates:
        proposal.gradeWinRates && typeof proposal.gradeWinRates === "object"
          ? proposal.gradeWinRates
          : null,
      appliedAt: Date.now(),
      scopes: proposal.scopes || null,
    };
    localStorage.setItem("BB_CONFIDENCE_MODEL_LIVE", JSON.stringify(liveBundle));
    // Legacy mirrors (readers that still use individual keys)
    try {
      localStorage.setItem("BB_CONFIDENCE_MODEL_COEFF", JSON.stringify(proposal.coeff));
      localStorage.setItem("BB_PLATT_CALIB", JSON.stringify(proposal.platt));
      if (liveBundle.sampleSizes)
        localStorage.setItem("BB_CONFIDENCE_MODEL_COEFF_N", JSON.stringify(liveBundle.sampleSizes));
      if (liveBundle.thresholds)
        localStorage.setItem("BB_CONFIDENCE_THRESHOLDS", JSON.stringify(liveBundle.thresholds));
      if (liveBundle.gradeWinRates)
        localStorage.setItem(
          "BB_CONFIDENCE_GRADE_WIN_RATES",
          JSON.stringify(liveBundle.gradeWinRates),
        );
    } catch (_mirrorErr) {
      engineDebug("applyConfidenceModelProposal legacy mirror partial fail (live blob OK)", {
        error: _mirrorErr?.message || String(_mirrorErr),
      });
    }
    localStorage.removeItem("BB_CONFIDENCE_MODEL_COEFF_PROPOSED");
    localStorage.removeItem("BB_PLATT_CALIB_PROPOSED");
    localStorage.removeItem("BB_CONFIDENCE_MODEL_COEFF_N_PROPOSED");
    localStorage.removeItem("BB_CONFIDENCE_THRESHOLDS_PROPOSED");
    localStorage.removeItem("BB_CONFIDENCE_GRADE_WIN_RATES_PROPOSED");
  } catch (e) {
    engineDebug(
      "applyConfidenceModelProposal failed to write live keys: " + (e?.message || String(e)),
      { error: e },
    );
    return false;
  }
  engineDebug(
    "Confidence model + Platt + thresholds applied atomically via BB_CONFIDENCE_MODEL_LIVE",
    { scopes: proposal.scopes, hasThresholds: !!proposal.thresholds },
  );
  return true;
}

window.applyConfidenceModelProposalFromUI = function () {
  if (
    !confirm(
      "Apply pending confidence model atomically (coeffs + N + Platt + grade thresholds)? This overwrites live grading for every new pick.",
    )
  )
    return;
  if (applyConfidenceModelProposal()) {
    if (typeof renderConfigsPanel === "function") renderConfigsPanel();
  }
};

function getParam(key, league, market) {
  return getTunableParam(key, league, market);
}
window.getParam = getParam;

function initLeagueOverridesFromDefaults() {
  if (Object.keys(g_tunableParamLeagueOverrides).length > 0) return;

  Object.entries(LEAGUE_CONFIG_MAP).forEach(([l, cfg]) => {
    const lk = l.toLowerCase();
    if (!g_tunableParamLeagueOverrides[lk]) g_tunableParamLeagueOverrides[lk] = {};
    g_tunableParamLeagueOverrides[lk]["volatilityLimit"] = {
      value: cfg.volLimit,
      lastVerifiedAt: null,
    };
  });
  Object.entries(LEAGUE_VOL_LIMITS).forEach(([l, vol]) => {
    const lk = l.toLowerCase();
    if (!g_tunableParamLeagueOverrides[lk]) g_tunableParamLeagueOverrides[lk] = {};
    g_tunableParamLeagueOverrides[lk]["volatilityLimit"] = { value: vol, lastVerifiedAt: null };
  });

  Object.entries(LEAGUE_EDGE_POINT_THRESHOLDS).forEach(([l, th]) => {
    const lk = l.toLowerCase();
    if (!g_tunableParamLeagueOverrides[lk]) g_tunableParamLeagueOverrides[lk] = {};
    g_tunableParamLeagueOverrides[lk]["edgeFTPointThreshold"] = {
      value: th.ft,
      lastVerifiedAt: null,
    };
    g_tunableParamLeagueOverrides[lk]["edgeH1PointThreshold"] = {
      value: th.h1,
      lastVerifiedAt: null,
    };
    g_tunableParamLeagueOverrides[lk]["edgeTeamPointThreshold"] = {
      value: th.team,
      lastVerifiedAt: null,
    };
    g_tunableParamLeagueOverrides[lk]["edgeQPointThreshold"] = {
      value: th.q,
      lastVerifiedAt: null,
    };
  });
  saveTunableParamLeagueOverrides();
}

let INJURY_OPPONENT_BOOST_FACTOR =
  getParam("injuryOppBoostFactor") ?? getTunableConstant("INJURY_OPPONENT_BOOST_FACTOR", 0.2);

let UNDER_EDGE_FACTOR = getParam("underEdgeFactor") ?? getTunableConstant("UNDER_EDGE_FACTOR", 1.2);

const TUNING_GRID = {
  h2hFactors: [0.75, 1.0],
  recencyProfiles: [
    [1.35, 1.2, 1.0, 0.85, 0.7, 0.56, 0.44, 0.33, 0.24, 0.16],
    [1.6, 1.3, 0.9, 0.6, 0.4, 0.28, 0.18, 0.11, 0.07, 0.04],
    [1.0, 1.0, 1.0, 1.0, 1.0, 0.8, 0.63, 0.5, 0.4, 0.32],
  ],
  edgeMults: [1.0],
  paceDampenings: [0.35],
  injuryMults: [1.0],
};

const BB_LOCK_SHORTLIST_KEY = "BB_LOCK_SHORTLIST_V1";
const LOCK_MIN_HOLDOUT_DECISIVE = 100;
const LOCK_MIN_HOLDOUT_WINRATE = 0.55;
const LOCK_MAX_OVERFIT_GAP = 0.08;
const LOCK_MIN_SIGNIFICANCE_P = 0.05;
const LOCK_NULL_WINRATE = 0.5238;

// One-sided one-proportion z-test: is the observed holdout win rate
// significantly above breakeven (-110 pricing, ~52.38%), or could it
// plausibly be a coin flip that happened to clear the raw threshold?
// Uses the Abramowitz & Stegun 7.1.26 erf approximation since no
// normal-CDF helper exists elsewhere in this file.
function _lockEvidenceSignificance(decisive, winRate, nullRate) {
  const n = Number(decisive) || 0;
  const p = Number(winRate);
  const p0 = isFinite(nullRate) ? Number(nullRate) : LOCK_NULL_WINRATE;
  if (n <= 0 || !isFinite(p)) return { z: null, pValue: 1, significant: false };
  const se = Math.sqrt((p0 * (1 - p0)) / n);
  if (!isFinite(se) || se <= 0) return { z: null, pValue: 1, significant: false };
  const z = (p - p0) / se;
  const erf = function (x) {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const a1 = 0.254829592,
      a2 = -0.284496736,
      a3 = 1.421413741,
      a4 = -1.453152027,
      a5 = 1.061405429,
      pc = 0.3275911;
    const t = 1 / (1 + pc * ax);
    const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
    return sign * y;
  };
  const pValue = 1 - 0.5 * (1 + erf(z / Math.SQRT2));
  return { z, pValue, significant: pValue < LOCK_MIN_SIGNIFICANCE_P };
}

function validateLockEvidence(evalResult, opts) {
  opts = opts || {};
  const minDecisive = isFinite(opts.minDecisive)
    ? Number(opts.minDecisive)
    : LOCK_MIN_HOLDOUT_DECISIVE;
  const minWinRate = isFinite(opts.minWinRate) ? Number(opts.minWinRate) : LOCK_MIN_HOLDOUT_WINRATE;
  const maxGap = isFinite(opts.maxGap) ? Number(opts.maxGap) : LOCK_MAX_OVERFIT_GAP;

  if (!evalResult || !evalResult.holdout) {
    return { ok: false, reason: "Missing holdout evaluation" };
  }
  const h = evalResult.holdout;
  if (!h.sampleOk || h.decisive < minDecisive) {
    return {
      ok: false,
      reason: "Holdout sample too small (" + (h.decisive || 0) + "/" + minDecisive + " decisive)",
    };
  }
  if (h.winRate < minWinRate) {
    return {
      ok: false,
      reason:
        "Holdout win rate " +
        (h.winRate * 100).toFixed(1) +
        "% below minimum " +
        (minWinRate * 100).toFixed(1) +
        "%",
    };
  }
  const _sig = _lockEvidenceSignificance(h.decisive, h.winRate, opts.nullWinRate);
  if (!_sig.significant) {
    return {
      ok: false,
      reason:
        "Holdout win rate not statistically significant vs breakeven (p=" +
        (isFinite(_sig.pValue) ? _sig.pValue.toFixed(3) : "n/a") +
        ", need p<" +
        LOCK_MIN_SIGNIFICANCE_P +
        ")",
    };
  }
  if (evalResult.overfitSuspect || (evalResult.gap != null && evalResult.gap > maxGap)) {
    return {
      ok: false,
      reason:
        "Overfit suspect (train−holdout gap " + ((evalResult.gap || 0) * 100).toFixed(1) + " pts)",
    };
  }
  if (!(evalResult.searchScore > 0)) {
    return { ok: false, reason: "searchScore is zero — config rejected by evaluation guards" };
  }
  return { ok: true };
}
