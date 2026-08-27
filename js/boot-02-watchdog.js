(function () {
  if (window.__BETCEO_WATCHDOG_LOADED) return;
  window.__BETCEO_WATCHDOG_LOADED = true;
  window.__BETCEO_ENGINE_BOOT_SEEN = false;

  function spawnFatalTerminal(msg, file, line, col, stack) {
    if (document.getElementById("fatalGodModeTerminal")) return;
    const t = document.createElement("div");
    t.id = "fatalGodModeTerminal";
    t.style.cssText =
      "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.98); z-index:1000000; padding:20px; box-sizing:border-box; overflow-y:auto; font-family: ui-monospace, Consolas, monospace; color: #0f0;";

    const esc = (s) =>
      String(s || "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
      );

    t.innerHTML = `
      <div style="border:2px solid #ff5c61; background:#111; max-width:900px; margin:20px auto; box-shadow: 0 0 50px rgba(255, 0, 0, 0.3);">
        <div style="background:#3b0000; color:#ff5c61; padding:15px; font-size:16px; font-weight:900; border-bottom:2px solid #ff5c61; display:flex; justify-content:space-between; text-transform:uppercase;">
          <span>🚨 FATAL ENGINE CRASH</span>
          <span>[SYSTEM LOCK]</span>
        </div>
        <div style="padding:25px;">
          <div style="color:#ffcf73; margin-bottom:20px; font-size:14px; border-left: 3px solid #ffcf73; padding-left: 15px; font-weight:800;">
            CATASTROPHIC ERROR: The engine parser died. The UI is disabled to protect your data.
          </div>
          <div style="display:grid; gap:12px; margin-bottom:25px;">
            <div><strong style="color:#fff; text-transform:uppercase; font-size:11px;">Error Message:</strong><br><span style="color:#ff5c61; font-size:15px; font-weight:bold;">${esc(msg)}</span></div>
            <div style="display:flex; gap:30px;">
                <div><strong style="color:#fff; text-transform:uppercase; font-size:11px;">Line:</strong><br><span style="color:#0f0; font-size:18px; font-weight:900;">${line}</span></div>
                <div><strong style="color:#fff; text-transform:uppercase; font-size:11px;">Column:</strong><br><span style="color:#0f0; font-size:18px; font-weight:900;">${col}</span></div>
                <div><strong style="color:#fff; text-transform:uppercase; font-size:11px;">Source:</strong><br><span style="color:#aaa; font-size:13px;">${esc(file)}</span></div>
            </div>
          </div>
          <strong style="color:#777; text-transform:uppercase; font-size:11px;">Debug Stack Trace:</strong>
          <div style="background:#000; border: 1px solid #222; padding:15px; color:#555; margin-top:8px; white-space:pre-wrap; overflow-x:auto; font-size:11px; line-height:1.4;">${esc(stack || "Syntax Error: No trace available for parser death.")}</div>
          <button onclick="location.reload()" style="margin-top:25px; background:#ff5c61; color:#fff; border:none; padding:12px 24px; font-weight:900; cursor:pointer; font-family:inherit; text-transform:uppercase;">Try Reboot</button>
        </div>
      </div>
    `;

    document.body
      ? document.body.appendChild(t)
      : document.addEventListener("DOMContentLoaded", () => document.body.appendChild(t));
  }

  function __betceoWatchdogError(e) {
    if (e.message === "Script error." && e.lineno === 0) return;
    const file = e.filename ? e.filename.split("/").pop() : "Inline Script";
    if (typeof window.engineDebug === "function") {
      window.engineDebug("ENGINE BREAKDOWN", `${e.message} | Loc: ${file}:${e.lineno}`);
    }
    // FIX: surface real runtime errors immediately. The 15s timeout below only
    // catches a total boot failure (before engine-01's first line runs) — it
    // never fires for an error inside engine-01..10, which is most of the app.
    spawnFatalTerminal(e.message, file, e.lineno, e.colno, e.error && e.error.stack);
  }

  function __betceoWatchdogRejection(e) {
    const reason = e.reason?.message || String(e.reason);
    if (typeof window.engineDebug === "function") {
      window.engineDebug("UNHANDLED PROMISE REJECTION", { detail: reason });
    }
  }

  window.addEventListener("error", __betceoWatchdogError);
  window.addEventListener("unhandledrejection", __betceoWatchdogRejection);
  window.__BETCEO_WATCHDOG_CLEANUP = function () {
    window.removeEventListener("error", __betceoWatchdogError);
    window.removeEventListener("unhandledrejection", __betceoWatchdogRejection);
    window.__BETCEO_WATCHDOG_CLEANUP = null;
  };

  const originalFetch = window.fetch;

  const _RETRY_CHAIN_HOST_PATTERNS = [
    "ridwantunde636.workers.dev",
    "site.api.espn.com",
    "site.web.api.espn.com",
  ];
  function _isRetryChainUrl(url) {
    const s = String(url || "");
    for (let i = 0; i < _RETRY_CHAIN_HOST_PATTERNS.length; i++) {
      if (s.indexOf(_RETRY_CHAIN_HOST_PATTERNS[i]) !== -1) return true;
    }
    return false;
  }
  window.fetch = async function () {
    const args = arguments;
    const first = args[0];
    const url = typeof first === "string" ? first : first && first.url ? first.url : "";
    try {
      const res = await originalFetch.apply(this, args);
      if (res && !res.ok && !_isRetryChainUrl(url)) {
        if (typeof window.engineDebug === "function") {
          window.engineDebug("WATCHDOG FETCH non-ok", {
            url: String(url).slice(0, 160),
            status: res.status,
          });
        }
      }
      return res;
    } catch (err) {
      if (!_isRetryChainUrl(url) && typeof window.engineDebug === "function") {
        window.engineDebug("WATCHDOG FETCH threw", {
          url: String(url).slice(0, 160),
          error: err && err.message ? err.message : String(err),
        });
      }
      throw err;
    }
  };

  setTimeout(function () {
    if (!window.__BETCEO_ENGINE_BOOT_SEEN) {
      spawnFatalTerminal(
        "Engine boot timeout — main script did not mark BOOT_SEEN within 15s (likely a parse error earlier in the file).",
        "watchdog",
        0,
        0,
        null,
      );
    }
  }, 15000);
})();
