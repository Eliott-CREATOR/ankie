// Minimal service worker — presence is what makes the PWA installable on iOS.
// Real offline caching (asset precache, Dexie sync) is Chantier 4's job.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Pass-through — no caching yet.
});
