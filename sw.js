// BB Engine service worker — v23_seal_20260828
// Network-first for navigations / index.html (never freeze the engine)
// Cache name matches APP_BUILD_VERSION
// Only shell static assets may be cache-first
// skipWaiting + clients.claim so updates apply

const CACHE_NAME = "bb-engine-v23_seal_20260828";
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

  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    e.respondWith(
      fetch(req)
        .then((res) => res)
        .catch(() => caches.match(req))
    );
    return;
  }

  if (isAppShellRequest(req)) {
    e.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => res))
    );
    return;
  }
});
