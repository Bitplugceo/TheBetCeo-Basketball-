// BB Engine service worker — fixed for Issues 47 & 48
// - Network-first for navigations / index.html (never freeze the engine)
// - Cache name bumped with engine release
// - Only shell static assets may be cache-first
// - skipWaiting + clients.claim so updates apply

const CACHE_NAME = "bb-engine-v23-seal-batch1";
const APP_SHELL = ["./manifest.json"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL).catch(() => undefined))
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

function isAppShellRequest(request) {
  try {
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return false;
    const path = url.pathname || "";
    return path.endsWith("/manifest.json");
  } catch (_) {
    return false;
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  // Navigations / HTML document: always network-first (Issue 47)
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    e.respondWith(
      fetch(req)
        .then((res) => res)
        .catch(() => caches.match(req))
    );
    return;
  }

  // Only precached shell may use cache-first (Issue 48)
  if (isAppShellRequest(req)) {
    e.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => res))
    );
    return;
  }

  // Everything else (ESPN, proxy, APIs): network only — do not intercept into cache
  // Let the browser handle it by not calling respondWith for non-shell requests.
});
