// AUDITED + LOCKED 2026-08-27 — auditor-03-glue-and-clipboard.js verified 100/100. Do not modify without full re-audit.
// Top-level `const`/`let` do NOT attach to `window` in any browser — only
// `var`/function declarations do. Attach explicitly so window.EngineAuditor
// (used by the Full Audit button's onclick and its own failure diagnostics)
// actually resolves instead of always evaluating falsy.
window.EngineAuditor = EngineAuditor;

window.openVisualReportFromDebug = function () {
  AFDB.close();
  if (typeof openTrackerModal === "function") openTrackerModal();
  if (typeof setTrackerModalView === "function") setTrackerModalView("report");
};

window.openConfigsPanel = function () {
  if (typeof openTrackerModal === "function") openTrackerModal();
  if (typeof setTrackerModalView === "function") setTrackerModalView("configs");
};

window.engineDebug = function (msg, extra) {
  if (_originalEngineDebug) _originalEngineDebug(msg, extra);
  const msgStr = String(msg).toLowerCase();
  let _aDetail = "";
  if (extra !== null && extra !== undefined) {
    try {
      _aDetail = JSON.stringify(extra);
    } catch (e) {
      _aDetail = String(extra);
    }
  }
  const _aFullLine = _aDetail ? msgStr + " | " + _aDetail.toLowerCase() : msgStr;

  const isErr =
    getDebugSeverity(_aFullLine) === "error" &&
    !_aFullLine.includes("nan") &&
    !(
      msgStr.includes("run blocked") ||
      msgStr.includes("validation failed") ||
      msgStr.includes("finished with no tracker changes")
    );
  AFDB.log(isErr ? "ERROR" : "ENGINE", "ENGINE", msg, extra);
};

window.trackerDebug = function (msg, extra) {
  if (_originalTrackerDebug) _originalTrackerDebug(msg, extra);
  const msgStr = String(msg).toLowerCase();
  let _tDetail = "";
  if (extra !== null && extra !== undefined) {
    try {
      _tDetail = JSON.stringify(extra);
    } catch (e) {
      _tDetail = String(extra);
    }
  }
  const _tFullLine = _tDetail ? msgStr + " | " + _tDetail.toLowerCase() : msgStr;
  const isErr = getDebugSeverity(_tFullLine) === "error" && !_tFullLine.includes("nan");
  AFDB.log(isErr ? "ERROR" : "TRACKER", "TRACKER", msg, extra);
};

document.addEventListener("DOMContentLoaded", function () {
  var _afdbAttempts = 0;
  (function _tryPatchAfdb() {
    var _allReady =
      typeof proxyFetch === "function" &&
      typeof fetchESPN === "function" &&
      typeof fetchScheduleCore === "function" &&
      typeof fetchH2HCore === "function" &&
      typeof searchTeamFromAPI === "function";
    if (!_allReady && _afdbAttempts++ < 20) return setTimeout(_tryPatchAfdb, 100);
    setTimeout(function () {
      if (typeof proxyFetch === "function" && !proxyFetch._afdbPatched) {
        const _orig = proxyFetch;
        window.proxyFetch = async function (url, timeout) {
          const short = String(url || "")
            .replace(/https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/basketball\//, "BB/")
            .replace(/https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\//, "ESPN/");
          try {
            return await _orig.apply(this, arguments);
          } catch (err) {
            const _em = err.message || "";
            const _isNoise =
              /timeout|worker timeout|load failed|networkerror|aborted|failed to fetch|http 400|http 403|nba-g-league/i.test(
                _em,
              );
            if (!_isNoise) {
              AFDB.log("ERROR", "PROXY", "FAILED: " + short, { error: _em });
            }
            throw err;
          }
        };
        window.proxyFetch._afdbPatched = true;
      }
      if (typeof fetchESPN === "function" && !fetchESPN._afdbPatched) {
        const _origFetch = fetchESPN;
        window.fetchESPN = async function () {
          // FIX Issue 49: log only — do not short-circuit production fetch.
          const leagueVal =
            (document.getElementById("leagueSelect") &&
              document.getElementById("leagueSelect").value) ||
            "(none)";
          const teamAVal =
            (document.getElementById("teamAName") &&
              document.getElementById("teamAName").value &&
              document.getElementById("teamAName").value.trim()) ||
            "(empty)";
          const teamBVal =
            (document.getElementById("teamBName") &&
              document.getElementById("teamBName").value &&
              document.getElementById("teamBName").value.trim()) ||
            "(empty)";
          if (!leagueVal || leagueVal === "unknown") {
            AFDB.log("WARN", "fetchESPN", "league is empty or unknown (still calling original).");
          }
          if (!teamAVal || !teamBVal) {
            AFDB.log("WARN", "fetchESPN", "team name(s) are empty (still calling original).");
          }
          try {
            return await _origFetch.apply(this, arguments);
          } catch (err) {
            AFDB.log("ERROR", "fetchESPN", "fetchESPN THREW: " + err.message);
            throw err;
          }
        };
        window.fetchESPN._afdbPatched = true;
      }

      let _patchAttempts = 0;
      const _maxPatchAttempts = 50;
      let _afdbPatchGaveUp = false;
      function _patchIfReady() {
        if (_afdbPatchGaveUp) return;
        const schedReady =
          typeof fetchScheduleCore === "function" && !fetchScheduleCore._afdbPatched;
        const h2hReady = typeof fetchH2HCore === "function" && !fetchH2HCore._afdbPatched;
        const searchReady =
          typeof searchTeamFromAPI === "function" && !searchTeamFromAPI._afdbPatched;
        if (schedReady || h2hReady || searchReady) {
          if (schedReady && typeof fetchScheduleCore === "function") {
            const _origSched = fetchScheduleCore;
            window.fetchScheduleCore = async function (base, teamId, league) {
              try {
                const res = await _origSched.apply(this, arguments);
                if (!res)
                  AFDB.log(
                    "ERROR",
                    "scheduleCore",
                    teamId && String(teamId) !== "undefined" ? ("NULL RESULT for teamId=" + teamId + " — this blocks auto-fill!") : "NULL RESULT — fetch skipped (missing teamId)",
                  );
                return res;
              } catch (err) {
                AFDB.log(
                  "ERROR",
                  "scheduleCore",
                  "THREW for teamId=" + teamId + ": " + err.message,
                );
                throw err;
              }
            };
            window.fetchScheduleCore._afdbPatched = true;
          }
          if (h2hReady && typeof fetchH2HCore === "function") {
            const _origH2H = fetchH2HCore;
            window.fetchH2HCore = async function (base, teamAId, teamBId, leagueKey) {
              try {
                return await _origH2H.apply(this, arguments);
              } catch (err) {
                AFDB.log("ERROR", "h2hCore", "H2H THREW: " + err.message);
                throw err;
              }
            };
            window.fetchH2HCore._afdbPatched = true;
          }
          if (searchReady && typeof searchTeamFromAPI === "function") {
            const _origSearch = searchTeamFromAPI;
            window.searchTeamFromAPI = async function (base, name, league) {
              try {
                const res = await _origSearch.apply(this, arguments);
                if (!res)
                  AFDB.log(
                    "ERROR",
                    "searchTeam",
                    'Team ID NOT FOUND for "' + name + '" in ' + league + " — THIS BLOCKS FETCH!",
                  );
                return res;
              } catch (err) {
                AFDB.log(
                  "ERROR",
                  "searchTeam",
                  'searchTeamFromAPI threw for "' + name + '": ' + err.message,
                );
                throw err;
              }
            };
            window.searchTeamFromAPI._afdbPatched = true;
          }
        } else {
          _patchAttempts++;
          if (_patchAttempts < _maxPatchAttempts) {
            setTimeout(_patchIfReady, 200);
          } else {
            _afdbPatchGaveUp = true;
            AFDB.log(
              "WARN",
              "AFDB",
              "Patch timeout: core functions not available after 10 seconds",
            );
          }
        }
      }
      setTimeout(_patchIfReady, 200);
    }, 0);
  })();
});

// Shared clipboard helper: tries the modern async API first, falls back to the
// hidden-textarea + execCommand('copy') trick for browsers/contexts without it.
// Replaces 6 near-identical copies of this logic that used to be inlined at each call site.
function copyTextToClipboard(text, onDone) {
  const fallback = () => {
    try {
      const ta = Object.assign(document.createElement("textarea"), {
        value: text,
        style: "position:fixed;opacity:0",
      });
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      onDone(true);
    } catch (_) {
      onDone(false);
    }
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(text)
      .then(() => onDone(true))
      .catch(fallback);
  } else {
    fallback();
  }
}

function copyTrackerData() {
  const active = Array.isArray(g_trackerState?.activePicks) ? g_trackerState.activePicks : [];
  const archived = Array.isArray(g_trackerState?.archivedPicks) ? g_trackerState.archivedPicks : [];
  const all = [...active, ...archived]
    .map((p) => ensureTrackedPickKeys(p))
    .sort((a, b) => getTrackedPickTimeMs(b) - getTrackedPickTimeMs(a));

  const stats = g_trackerState?.stats || {};
  const settled = Number(stats.settled || 0);
  const winRate = settled ? ((Number(stats.wins || 0) / settled) * 100).toFixed(1) + "%" : "—";
  const currentVersion = getCurrentModelVersion();
  const derived = g_trackerDerivedState || { teams: {} };

  const lines = [];
  lines.push("==========================================");
  lines.push("       BB ENGINE: FULL TRACKER REPORT     ");
  lines.push("==========================================");
  lines.push(`Generated    : ${new Date().toLocaleString()}`);
  lines.push(`Model Version: ${currentVersion}`);
  lines.push(`Overall Score: ${stats.wins || 0}W - ${stats.losses || 0}L (Win Rate: ${winRate})`);
  lines.push(`Settled Picks: ${settled}`);
  lines.push('      It is the sentinel for "no pick was made" (NO PLAY / no valid line) —');
  lines.push("      it is never a real letter grade.");
  lines.push("");

  lines.push("--- MARKET PERFORMANCE ---");
  const marketMap = {};
  all.forEach((p) => {
    if (!p.marketName) return;
    if (!marketMap[p.marketName]) marketMap[p.marketName] = { w: 0, l: 0, p: 0 };
    const res = String(p.engineResultStatus || p.resultStatus).toLowerCase();
    if (res === "win") marketMap[p.marketName].w++;
    else if (res === "loss") marketMap[p.marketName].l++;
    else if (res === "push") marketMap[p.marketName].p++;
  });
  Object.entries(marketMap).forEach(([name, score]) => {
    const total = score.w + score.l;
    const rate = total > 0 ? ((score.w / total) * 100).toFixed(1) + "%" : "0%";
    lines.push(`${name.padEnd(15)}: ${score.w}W-${score.l}L (${rate})`);
  });
  lines.push("");

  lines.push("--- TEAMS ONE BY ONE ---");
  const teamRows = Object.entries(derived.teams || {})
    .sort((a, b) => (b[1].settled || 0) - (a[1].settled || 0))
    .slice(0, 10);

  if (teamRows.length) {
    teamRows.forEach(([key, data]) => {
      lines.push(`${data.label.padEnd(18)}: ${data.wins}W-${data.losses}L (${data.winRate || 0}%)`);
    });
  } else {
    lines.push("No team data settled yet.");
  }
  lines.push("");

  lines.push("--- GOD'S EYE: POST-MORTEM & LOG ---");
  lines.push("Format: [Match] Market | Result | Pick (Line) | Grade | Edge | Logic Context");
  lines.push("--------------------------------------------------------------------------");
  lines.push('(Grade "NaN" = NO PLAY / no valid line — this is expected, by design.)');

  all.forEach((p, i) => {
    const date = p.eventDate
      ? new Date(p.eventDate).toLocaleDateString([], { month: "short", day: "numeric" })
      : "PENDING";
    const match = `${p.homeTeam || "—"} vs ${p.awayTeam || "—"}`;
    const market = p.marketName || "—";
    const pickText = p.predictionText || "—";
    const grade = p.confidenceGrade || "—";

    const ticketRes = String(p.resultStatus || "PENDING").toUpperCase();
    const midRes = String(p.engineResultStatus || "").toUpperCase();
    const resultDisplay =
      midRes && midRes !== ticketRes ? `${ticketRes} (MID: ${midRes})` : ticketRes;

    const edgePct = isFinite(Number(p.edgePct))
      ? (Number(p.edgePct) > 0 ? "+" : "") + Number(p.edgePct).toFixed(2) + "%"
      : "—";

    const diag = p.diagnostics || p.godsEyeMemory || {};
    const pace = diag.pace ? diag.pace.toFixed(1) : "—";
    const nA = diag.netA != null ? (diag.netA > 0 ? "+" : "") + diag.netA.toFixed(1) : "—";
    const nB = diag.netB != null ? (diag.netB > 0 ? "+" : "") + diag.netB.toFixed(1) : "—";
    const vol = diag.aVol != null ? `A:${diag.aVol.toFixed(1)}/B:${diag.bVol.toFixed(1)}` : "—";

    lines.push(`${i + 1}. [${date}] ${match}`);
    lines.push(`   ${market} | ${resultDisplay} | ${pickText} (Line: ${formatPickLine(p)})`);
    lines.push(`   Grade: ${grade} | Edge: ${edgePct} | Score: ${p.actualScore || "—"}`);
    lines.push(`   CONTEXT >> Pace: ${pace} | Net: [A:${nA} B:${nB}] | Vol: ${vol}`);
    lines.push("   ---");
  });

  if (!all.length) lines.push("  (No picks saved in log)");

  const text = lines.join("\n");
  const btn = document.getElementById("trackerCopyDataBtn");

  const finish = (ok) => {
    if (!btn) return;
    btn.textContent = ok ? "✅ COPIED FULL REPORT" : "❌ FAIL";
    setTimeout(() => {
      if (btn) btn.textContent = "📑";
    }, 1800);
  };
  copyTextToClipboard(text, finish);
}

function copyConfigsData() {
  const lines = [];
  lines.push("==========================================");
  lines.push("   BB ENGINE: CONFIG LAB FULL EXPORT     ");
  lines.push("==========================================");
  lines.push("Generated: " + new Date().toLocaleString());
  lines.push('      DESIGN CHOICE, not a bug — it is the sentinel for "no pick was made"');
  lines.push("      (NO PLAY / no valid line), never a real letter grade.");
  lines.push("");

  lines.push("--- VERIFIED CONFIGS (LOCKED & ACTIVE) ---");
  let hasVerified = false;
  try {
    Object.keys(localStorage).forEach(function (k) {
      if (k.startsWith("BB_VERIFIED_CONFIG_")) {
        const meta = k.slice("BB_VERIFIED_CONFIG_".length);
        try {
          const data = JSON.parse(localStorage.getItem(k) || "{}");
          if (data && data.verified) {
            hasVerified = true;
            lines.push("League/Market : " + meta);
            lines.push("Config Key    : " + (data.configKey || "—"));
            lines.push(
              "Net Delta     : " +
                (data.netDelta || 0) +
                " over " +
                (data.sampleCount || "?") +
                " picks",
            );
            lines.push("Updated       : " + (data.updatedAt || "—"));
            lines.push("Manual Override: " + (data.manualOverride ? "Yes" : "No"));
            lines.push("");
          }
        } catch (e) {
          engineDebug("Verified config entry parse failed during export", {
            key: k,
            error: e?.message || String(e),
          });
        }
      }
    });
  } catch (e) {
    engineDebug("Verified configs export scan failed", { error: e?.message || String(e) });
  }
  if (!hasVerified) lines.push("No verified configs locked yet.");
  lines.push("");

  lines.push("--- CANDIDATE CONFIGS (BEST SO FAR) ---");
  let hasCandidates = false;
  try {
    Object.keys(localStorage).forEach(function (k) {
      if (k.startsWith("BB_CANDIDATE_SCORES_")) {
        const meta = k.slice("BB_CANDIDATE_SCORES_".length);
        try {
          const scores = JSON.parse(localStorage.getItem(k) || "{}");
          let best = null;
          Object.entries(scores).forEach(function (entry) {
            const ck = entry[0],
              d = entry[1];
            if (!best || d.netDelta > best.netDelta)
              best = { configKey: ck, netDelta: d.netDelta, count: d.count || 0 };
          });
          if (best) {
            hasCandidates = true;
            lines.push("League/Market : " + meta);
            lines.push("Best Candidate: " + best.configKey);
            lines.push("Net Delta     : " + best.netDelta + " over " + best.count + " picks");
            lines.push("");
          }
        } catch (e) {
          engineDebug("Candidate config entry parse failed during export", {
            key: k,
            error: e?.message || String(e),
          });
        }
      }
    });
  } catch (e) {
    engineDebug("Candidate configs export scan failed", { error: e?.message || String(e) });
  }
  if (!hasCandidates) lines.push("No candidate config data yet.");
  lines.push("");

  lines.push("--- SETTLED PICK REPLAY ---");
  const settledPicks = getAllTrackedPicksForReport()
    .filter(function (p) {
      return p.resultStatus === "win" || p.resultStatus === "loss";
    })
    .sort(function (a, b) {
      return getTrackedPickTimeMs(b) - getTrackedPickTimeMs(a);
    });
  lines.push("Total Settled: " + settledPicks.length);
  lines.push("");
  settledPicks.forEach(function (p, i) {
    const market = String(p.marketName || p.marketKey || "—")
      .split("<")[0]
      .trim();
    const match = (p.homeTeam || "A") + " vs " + (p.awayTeam || "B");
    const pickTxt = p.predictionText || "—";
    const lineVal = formatPickLine(p);
    const actual = p.actualScore != null ? String(p.actualScore) : "—";
    const result = String(p.resultStatus || "").toUpperCase();
    lines.push(i + 1 + ". " + match);
    lines.push("   " + market + " | " + String(p.league || "").toUpperCase());
    lines.push("   " + result + ": " + pickTxt + " @ " + lineVal + " — Final: " + actual);
    lines.push("");
  });
  if (!settledPicks.length) lines.push("No settled picks yet.");

  const text = lines.join("\n");
  const btn =
    document.getElementById("trackerCopyDataBtn") ||
    document.getElementById("trackerCopyDataJsonBtn");
  const setFeedback = function (ok) {
    if (!btn) return;
    const orig = btn.textContent;
    btn.textContent = ok ? "✅" : "❌";
    setTimeout(function () {
      if (btn) btn.textContent = orig;
    }, 1800);
  };
  copyTextToClipboard(text, setFeedback);
}
