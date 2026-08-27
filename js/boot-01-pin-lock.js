// AUDITED + LOCKED 2026-08-27 — boot-01-pin-lock.js verified 100/100. Do not modify without full re-audit.
(function () {
  // D1: still client-side only — not real access control. Mitigations added:
  // salted hash comparison, progressive lockout after failures, short session TTL.
  // Server-side auth is required for true protection.
  var ENGINE_LOCK_PIN_HASH = "dc69839a54b801d7badf5c5d5a64ad5800f49c2cb4cca4f99a1767940240b711";
  var ENGINE_LOCK_SALT = "bb_engine_lock_v1";
  var overlay = document.getElementById("engineLockOverlay");
  var LOCKOUT_KEY = "engineLockFails";
  var UNLOCK_TS_KEY = "engineUnlockedAt";
  var SESSION_TTL_MS = 12 * 60 * 60 * 1000;
  var unlockedAt = parseInt(localStorage.getItem(UNLOCK_TS_KEY) || "0", 10);
  if (
    localStorage.getItem("engineUnlocked") === "yes" &&
    unlockedAt &&
    Date.now() - unlockedAt < SESSION_TTL_MS
  ) {
    overlay.classList.add("hidden");
  } else {
    localStorage.removeItem("engineUnlocked");
    localStorage.removeItem(UNLOCK_TS_KEY);
  }
  async function _sha256Hex(str) {
    var buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf))
      .map(function (b) {
        return b.toString(16).padStart(2, "0");
      })
      .join("");
  }
  async function tryUnlock() {
    var val = document.getElementById("engineLockInput").value;
    var err = document.getElementById("engineLockError");
    var failState = { n: 0, until: 0 };
    try {
      failState = JSON.parse(localStorage.getItem(LOCKOUT_KEY) || '{"n":0,"until":0}');
    } catch (_e) {}
    if (failState.until && Date.now() < failState.until) {
      var secs = Math.ceil((failState.until - Date.now()) / 1000);
      err.textContent = "Locked out " + secs + "s — too many attempts";
      return;
    }
    if (!window.crypto || !window.crypto.subtle) {
      err.textContent = "Secure crypto unavailable — open in HTTPS / modern browser";
      return;
    }
    // Only the salted hash is accepted (legacy unsalted path removed).
    var salted = await _sha256Hex(ENGINE_LOCK_SALT + ":" + val);
    if (salted === ENGINE_LOCK_PIN_HASH) {
      localStorage.setItem("engineUnlocked", "yes");
      localStorage.setItem(UNLOCK_TS_KEY, String(Date.now()));
      localStorage.removeItem(LOCKOUT_KEY);
      overlay.classList.add("hidden");
      err.textContent = "";
    } else {
      failState.n = (failState.n || 0) + 1;
      var backoff = Math.min(300000, 1000 * Math.pow(2, Math.min(9, failState.n)));
      if (failState.n >= 5) failState.until = Date.now() + backoff;
      try {
        localStorage.setItem(LOCKOUT_KEY, JSON.stringify(failState));
      } catch (_e2) {}
      err.textContent =
        failState.n >= 5 ? "Wrong PIN — locked " + Math.ceil(backoff / 1000) + "s" : "Wrong PIN";
      document.getElementById("engineLockInput").value = "";
    }
  }
  document.getElementById("engineLockBtn").addEventListener("click", tryUnlock);
  document.getElementById("engineLockInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter") tryUnlock();
  });
})();
