const CACHE_NAME = "bb-engine-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "manifest.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  );
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((cached) => {
      // If cached, return it; otherwise try network, fallback to cached if network fails
      return (
        cached ||
        fetch(e.request).catch(() => {
          // If network fails and we have a cached response, return it
          return caches.match(e.request);
        })
      );
    })
  );
});
