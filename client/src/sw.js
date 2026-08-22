// ── Core lifecycle ────────────────────────────────────────────────────────────
self.skipWaiting();
self.addEventListener("activate", (e) => e.waitUntil(clients.claim()));

// ── Push notification received ────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(
    self.registration.showNotification(data.title ?? "E-Telly Alert", {
      body:               data.body  ?? "A new alert has been issued for Antipolo City.",
      icon:               "/icons/icon.png",
      badge:              "/icons/icon.png",
      data:               { url: data.url ?? "/alerts" },
      vibrate:            [200, 100, 200],
      requireInteraction: data.urgent ?? false,
      tag:                data.tag   ?? "etelly-alert",
    })
  );
});

// ── Notification clicked → open or focus the app ──────────────────────────────
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/alerts";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && "focus" in client)
          return client.focus();
      }
      return clients.openWindow(url);
    })
  );
});

// ── Workbox caching (production only — imports are bundled by vite-plugin-pwa) ─
// Dynamic import so a failure here never breaks the push handlers above.
(async () => {
  try {
    const { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } =
      await import("workbox-precaching");
    const { NavigationRoute, registerRoute, setCatchHandler } = await import("workbox-routing");
    const { NetworkFirst, StaleWhileRevalidate }  = await import("workbox-strategies");
    const { ExpirationPlugin }                    = await import("workbox-expiration");

    precacheAndRoute(self.__WB_MANIFEST || []);
    cleanupOutdatedCaches();

    registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

    registerRoute(
      /\/api\/(alerts|reports)/,
      new NetworkFirst({
        cacheName: "api-cache",
        networkTimeoutSeconds: 5,
        plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 300 })],
      })
    );

    registerRoute(
      /^https:\/\/(.*\.tile\.openstreetmap\.org|.*\.basemaps\.cartocdn\.com|server\.arcgisonline\.com)/,
      new StaleWhileRevalidate({
        cacheName: "map-tiles",
        plugins: [new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 7 * 24 * 60 * 60 })],
      })
    );

    // Hazard overlay WMS tiles (flood: LIPAD/UP DREAM, landslide: Phil
    // Geoportal). Unlike the basemap above, these weren't cached at all, so
    // every pan/zoom re-fetched from two external gov/university servers.
    // The underlying hazard datasets (25yr flood return period, landslide
    // susceptibility) are static, not live forecasts, so a week-long cache
    // is safe — same lifetime as the basemap tiles.
    registerRoute(
      /^https:\/\/(lipad-fmc\.dream\.upd\.edu\.ph|geoserver\.geoportal\.gov\.ph)\/geoserver\/wms/,
      new StaleWhileRevalidate({
        cacheName: "hazard-wms-tiles",
        plugins: [new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 7 * 24 * 60 * 60 })],
      })
    );

    // Per-route page chunks are deliberately excluded from the precache
    // manifest (see injectManifest.globIgnores in vite.config.js) so they
    // don't all download on first install. This picks them up instead the
    // first time each page is actually visited, so offline support still
    // builds up progressively rather than being lost.
    registerRoute(
      /\/assets\/.*\.(js|css)$/,
      new StaleWhileRevalidate({ cacheName: "route-chunks" })
    );

    registerRoute(
      /nominatim\.openstreetmap\.org/,
      new NetworkFirst({
        cacheName: "geocoding-cache",
        networkTimeoutSeconds: 8,
        plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 3600 })],
      })
    );
    // Offline fallback — navigation requests that fail (no cache + no network)
    setCatchHandler(async ({ event }) => {
      if (event.request.destination === "document") {
        return caches.match("/offline.html");
      }
      return Response.error();
    });
  } catch {
    // Dev mode — workbox packages not bundled yet, caching disabled
  }
})();
