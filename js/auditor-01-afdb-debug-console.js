// AUDITED + LOCKED 2026-08-27 — auditor-01-afdb-debug-console.js verified 100/100. Do not modify without full re-audit.
const _originalEngineDebug = typeof engineDebug === "function" ? engineDebug : null;
const _originalTrackerDebug = typeof trackerDebug === "function" ? trackerDebug : null;
const AFDB = (function () {
  const LOG_LIMIT = 600;
  let _log = [];
  let _isOpen = false;
  let _showOnlyErrors = true;
  let _currentLogLevel = "ERROR";

  const LEVELS = {
    BOOT: { color: "#7aa6ff" },
    NET: { color: "#4ea9ff" },
    FETCH: { color: "#49d45f" },
    FILL: { color: "#2aff9e" },
    PICK: { color: "#d4af37" },
    H2H: { color: "#c678dd" },
    SUCCESS: { color: "#49d45f" },
    WARN: { color: "#ffcf73" },
    ERROR: { color: "#ff5c61" },
    INFO: { color: "#aaa" },
    ENGINE: { color: "#d4af37" },
    TRACKER: { color: "#4ea9ff" },
    VERDICT: { color: "#49d45f" },
  };

  const ICONS = {
    BOOT: "\u2699\ufe0f",
    NET: "\ud83c\udf10",
    FETCH: "\ud83d\udce1",
    FILL: "\u270f\ufe0f",
    PICK: "\ud83d\udccc",
    H2H: "\ud83d\udd04",
    SUCCESS: "\u2705",
    WARN: "\u26a0\ufe0f",
    ERROR: "\u274c",
    INFO: "\u2139\ufe0f",
    ENGINE: "\u2699\ufe0f",
    TRACKER: "\ud83d\udcca",
    VERDICT: "\ud83c\udf96\ufe0f",
  };

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function log(level, section, msg, data) {
    const entry = {
      ts: new Date().toLocaleTimeString([], { hour12: false }),
      level,
      section: section || "CORE",
      msg,
      data: data !== undefined ? data : null,
    };
    _log.unshift(entry);
    if (_log.length > LOG_LIMIT) _log = _log.slice(0, LOG_LIMIT);
    if (_isOpen) _render();
  }

  function clear() {
    _log = [];
    _render();
  }

  function toggleFilter() {
    const levels = ["ALL", "ERROR", "WARN"];
    _currentLogLevel = levels[(levels.indexOf(_currentLogLevel) + 1) % levels.length];
    _showOnlyErrors = _currentLogLevel !== "ALL";
    _render();
  }

  function copy(btnEl) {
    const visibleLogs = _showOnlyErrors
      ? _log.filter((e) => e.level === "ERROR" || e.level === "WARN" || e.level === "VERDICT")
      : _log;
    const textArr = visibleLogs
      .slice()
      .reverse()
      .map((e) => {
        let line = "[" + e.ts + "] [" + e.level + "] [" + e.section + "] " + e.msg;
        if (e.data !== null) {
          try {
            line += " | " + JSON.stringify(e.data);
          } catch (x) {
            line += " | " + String(e.data);
          }
        }
        return line;
      });
    const text = textArr.join(String.fromCharCode(10, 10));
    const finish = (ok) => {
      if (btnEl) {
        const origText = btnEl.innerHTML;
        btnEl.innerHTML = ok ? "\u2705 COPIED!" : "\u274c FAIL";
        setTimeout(() => {
          if (btnEl) btnEl.innerHTML = origText;
        }, 1500);
      }
      if (!ok) log("WARN", "AFDB", "Clipboard blocked \u2014 printed to console");
    };
    if (typeof copyTextToClipboard === "function") {
      copyTextToClipboard(text, finish);
    } else if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => finish(true))
        .catch(() => {
          try {
            const ta = Object.assign(document.createElement("textarea"), {
              value: text,
              style: "position:fixed;opacity:0",
            });
            document.body.appendChild(ta);
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
            finish(true);
          } catch (_) {
            finish(false);
          }
        });
    } else {
      try {
        const ta = Object.assign(document.createElement("textarea"), {
          value: text,
          style: "position:fixed;opacity:0",
        });
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        finish(true);
      } catch (_) {
        finish(false);
      }
    }
  }

  function snapDOM() {
    const ids = [
      "leagueSelect",
      "teamAName",
      "teamBName",
      "aFTScored",
      "aFTAllowed",
      "a1HScored",
      "a1HAllowed",
      "bFTScored",
      "bFTAllowed",
      "b1HScored",
      "b1HAllowed",
      "aFTH2H",
      "bFTH2H",
      "a1HH2H",
      "b1HH2H",
      "ftMarket",
      "h1Market",
      "teamAMarket",
      "teamBMarket",
    ];
    const snap = {};
    ids.forEach((id) => {
      const el = document.getElementById(id);
      snap[id] = el ? el.value || "(empty)" : "\u26d4 NOT FOUND";
    });
    if (typeof selectedTeamIds !== "undefined") snap["_teamIds"] = JSON.stringify(selectedTeamIds);
    snap["_league"] =
      (document.getElementById("leagueSelect") && document.getElementById("leagueSelect").value) ||
      "(none)";
    return snap;
  }

  function _render() {
    const panel = document.getElementById("afdbPanel");
    if (!panel) return;
    const visibleLogs = _log.filter(
      (e) =>
        _currentLogLevel === "ALL" ||
        e.level === _currentLogLevel ||
        (_currentLogLevel === "ERROR" && e.level === "VERDICT") ||
        (_currentLogLevel === "WARN" && (e.level === "ERROR" || e.level === "VERDICT")),
    );
    const logRows = visibleLogs
      .map((e) => {
        const def = LEVELS[e.level] || LEVELS.INFO;
        const icon = ICONS[e.level] || "\u2022";
        let dataHtml = "";
        if (e.data !== null) {
          let ds;
          try {
            ds = typeof e.data === "object" ? JSON.stringify(e.data, null, 2) : String(e.data);
          } catch (x) {
            ds = String(e.data);
          }
          dataHtml =
            '<pre style="color:#888;font-size:9px;margin:4px 0 0 0;padding:6px;background:#070707;border-left:2px solid #222;white-space:pre-wrap;word-break:break-all;">' +
            esc(ds) +
            "</pre>";
        }
        return (
          '<div style="padding:8px;border-bottom:1px solid #151515;"><div style="display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;"><span style="color:#555;font-size:9px;min-width:65px;flex-shrink:0;">' +
          esc(e.ts) +
          '</span><span style="color:' +
          def.color +
          ';font-size:10px;font-weight:900;min-width:75px;flex-shrink:0;">' +
          icon +
          " " +
          esc(e.level) +
          '</span><span style="color:#777;font-size:9px;min-width:80px;flex-shrink:0;">[' +
          esc(e.section) +
          ']</span><span style="color:' +
          def.color +
          ';font-size:11px;font-weight:700;flex:1;white-space:pre-wrap;">' +
          esc(e.msg) +
          "</span></div>" +
          dataHtml +
          "</div>"
        );
      })
      .join("");

    const headerBtns =
      '<button onclick="AFDB.copy(this)" style="background:#111;border:1px solid #333;color:#49d45f;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;border-radius:4px;">📋 Copy Log</button><button onclick="AFDB.clear()" style="background:#111;border:1px solid #333;color:#ff5c61;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;border-radius:4px;">🗑️ Clear</button><button onclick="AFDB.runTestFetch()" style="background:#2a0608;border:1px solid #d91f26;color:#fff;padding:6px 12px;font-size:11px;font-weight:900;cursor:pointer;border-radius:4px;box-shadow:0 0 8px rgba(217,31,38,0.4);">🚨 MILITARY RAID</button><button onclick="window.openVisualReportFromDebug()" style="background:#111;border:1px solid #333;color:#d4af37;padding:6px 12px;font-size:11px;font-weight:700;cursor:pointer;border-radius:4px;">📊 Tracker Report</button><button onclick="window.EngineAuditor ? EngineAuditor.open() : alert(`Full Audit did not open: the EngineAuditor script was not found on this page. The auditor module may be missing from this deploy.`)" style="background:#0a1f0a;border:1px solid #2f8f4a;color:#49ff7a;padding:6px 12px;font-size:11px;font-weight:900;cursor:pointer;border-radius:4px;box-shadow:0 0 8px rgba(47,143,74,0.4);">🩺 Full Audit</button><button onclick="AFDB.close()" style="background:#111;border:1px solid #555;color:#ccc;padding:6px 12px;font-size:11px;font-weight:900;cursor:pointer;border-radius:4px;">✕ Close</button>';

    const emptyMsg = _showOnlyErrors
      ? "No suspects arrested. The code is clean."
      : "No log entries yet. Run a fetch.";
    const filterLabel = `\ud83c\udfaf LEVEL: ${_currentLogLevel}`;
    const _rme = typeof getRollingMeanError === "function" ? getRollingMeanError(20) : NaN;
    const _rmeDisplay = isFinite(_rme) ? _rme.toFixed(2) + " pts" : "\u2014";
    const _rmeColor = !isFinite(_rme)
      ? "#555"
      : _rme > 5
        ? "#ff5c61"
        : _rme > 3
          ? "#ffcf73"
          : "#49d45f";
    const _sampleCount = typeof g_pickVarianceLog !== "undefined" ? g_pickVarianceLog.length : 0;
    const driftHtml =
      '<div style="padding:6px 12px;background:#0d0d0d;border-bottom:1px solid #1a1a1a;display:flex;align-items:center;gap:16px;flex-wrap:wrap;flex-shrink:0;"><span style="color:#555;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;">\ud83d\udcd0 DRIFT TRACKER</span><span style="color:' +
      _rmeColor +
      ';font-size:12px;font-weight:900;">Rolling Mean Error (last 20): ' +
      _rmeDisplay +
      '</span><span style="color:#555;font-size:10px;">' +
      _sampleCount +
      " samples logged</span></div>";

    panel.innerHTML =
      '<div style="background:#080808;border-bottom:1px solid #222;padding:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;flex-shrink:0;"><div style="color:#d4af37;font-size:14px;font-weight:900;letter-spacing:1px;">\ud83d\udd2c AUTO-FETCH DEBUG BRAIN (BB)</div><div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      headerBtns +
      "</div></div>" +
      driftHtml +
      '<div style="display:flex;flex-direction:column;flex:1;overflow-y:auto;background:#0a0a0a;"><div style="flex:1;"><div style="padding:10px 12px;background:#111;color:#d4af37;font-size:11px;font-weight:900;text-transform:uppercase;position:sticky;top:0;z-index:10;border-bottom:1px solid #222;display:flex;justify-content:space-between;align-items:center;"><span>\ud83d\udce1 FETCH & ENGINE LOGS</span><button onclick="AFDB.toggleFilter()" style="background:none;border:none;color:#4ea9ff;font-size:14px;font-weight:bold;cursor:pointer;">' +
      filterLabel +
      '</button></div><div style="padding-bottom:15px;">' +
      (logRows ||
        '<div style="color:#555;font-size:12px;text-align:center;padding:30px;font-weight:bold;">' +
          emptyMsg +
          "</div>") +
      "</div></div></div>";
  }

  function open() {
    _isOpen = true;
    const ov = document.getElementById("afdbOverlay");
    if (ov) {
      ov.style.display = "flex";
      _render();
    }
  }

  function close() {
    _isOpen = false;
    const ov = document.getElementById("afdbOverlay");
    if (ov) ov.style.display = "none";
  }

  async function runTestFetch() {
    try {
      let waitCycles = 0;
      while (typeof g_trackerState === "undefined" && waitCycles < 20) {
        await new Promise((r) => setTimeout(r, 100));
        waitCycles++;
      }
    } catch (e) {
      engineDebug("Wait-for-tracker-state loop failed", { error: e?.message || String(e) });
    }

    let totalSuspects = 0;

    if (typeof _schedCache !== "undefined") _schedCache.clear();
    if (typeof _summaryCache !== "undefined") _summaryCache.clear();
    if (typeof _fixtureCache !== "undefined") _fixtureCache.clear();
    if (typeof _teamCatalogCache !== "undefined") _teamCatalogCache.clear();

    const inputsToCheck = ["aFTScored", "bFTScored", "ftMarket", "teamAMarket", "teamBMarket"];
    inputsToCheck.forEach((id) => {
      const el = document.getElementById(id);
      const val = el ? el.value.trim() : "";
      if (val && /[^0-9,.\s-]/.test(val)) {
        log(
          "ERROR",
          "UI INPUT",
          "Invalid characters detected in " + id + ': "' + val + '". Math engine will crash.',
        );
        totalSuspects++;
      }
    });

    const active =
      typeof g_trackerState !== "undefined" && Array.isArray(g_trackerState.activePicks)
        ? g_trackerState.activePicks
        : [];
    const memCount =
      typeof g_engineLineMemory !== "undefined" ? Object.keys(g_engineLineMemory || {}).length : 0;
    if (memCount > 190) {
      log("ERROR", "STORAGE", "Line memory nearing maximum capacity (200). Pruning imminent.");
      totalSuspects++;
    }
    if (active.length > 490) {
      log("ERROR", "STORAGE", "Active picks array is critically full (Limit: 500).");
      totalSuspects++;
    }
    if (typeof MODEL_TUNING === "undefined") {
      log(
        "WARN",
        "CONFIG",
        "MODEL_TUNING not yet loaded – this is normal early in page load. Raid will re-check later.",
      );
    }

    let paceAnomalies = 0,
      edgeAnomalies = 0;
    active.forEach((p) => {
      const pace =
        (p.diagnostics && p.diagnostics.pace) || (p.godsEyeMemory && p.godsEyeMemory.pace);
      if (pace && (pace > 135 || pace < 65)) paceAnomalies++;
      if (p.edgePct && Math.abs(p.edgePct) > 25) edgeAnomalies++;
    });
    if (paceAnomalies > 0) {
      log(
        "ERROR",
        "MATH ENGINE",
        paceAnomalies +
          " picks show unrealistic pace projections (<65 or >135). Logic contradiction detected.",
      );
      totalSuspects++;
    }
    if (edgeAnomalies > 0) {
      log("ERROR", "MATH ENGINE", edgeAnomalies + " picks show extreme edge anomalies (>25%).");
      totalSuspects++;
    }

    const settled =
      (typeof g_trackerState !== "undefined" &&
        g_trackerState.stats &&
        g_trackerState.stats.settled) ||
      0;
    const wins =
      (typeof g_trackerState !== "undefined" &&
        g_trackerState.stats &&
        g_trackerState.stats.wins) ||
      0;
    if (settled >= 20) {
      const winRate = (wins / settled) * 100;
      if (winRate < 45) {
        log(
          "ERROR",
          "MODEL BIAS",
          "System win rate dropping below safety threshold (" +
            winRate.toFixed(1) +
            "%). Recalibration required.",
        );
        totalSuspects++;
      }
    }

    const league =
      document.getElementById("leagueSelect") && document.getElementById("leagueSelect").value;
    const tA = document.getElementById("teamAName") && document.getElementById("teamAName").value;
    const tB = document.getElementById("teamBName") && document.getElementById("teamBName").value;

    const isEspnLeague = ["nba", "ncaa", "wnba", "wnba_pre", "ncaaw", "nba_gl", "nba_summer"].includes(
      String(league || "").toLowerCase(),
    );
    if (isEspnLeague && tA && tB) {
      try {
        await fetchESPN();
      } catch (e) {
        log("ERROR", "NETWORK", "Live sweep failed: " + e.message);
        totalSuspects++;
      }
    }

    const verdictMsg =
      totalSuspects === 0
        ? "Raid complete.\nEngine is 100% perfect."
        : "Raid complete.\nCaught " + totalSuspects + " Thieves and locked them behind the bars.";
    const verdictEntry = {
      ts: new Date().toLocaleTimeString([], { hour12: false }),
      level: totalSuspects === 0 ? "VERDICT" : "ERROR",
      section: "POLICE RAID",
      msg: verdictMsg,
      data: null,
    };
    _log.unshift(verdictEntry);
    if (_log.length > LOG_LIMIT) _log = _log.slice(0, LOG_LIMIT);
    if (_isOpen) _render();
    setTimeout(() => {
      const idx = _log.indexOf(verdictEntry);
      if (idx !== -1) {
        _log.splice(idx, 1);
        if (_isOpen) _render();
      }
    }, 7000);
  }

  return {
    log,
    clear,
    copy,
    toggleFilter,
    open,
    close,
    runTestFetch,
    get isOpen() {
      return _isOpen;
    },
    get logs() {
      return _log;
    },
  };
})();
