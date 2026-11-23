// Offline: App-Dateien + Bibliotheken cachen, Kartenkacheln beim Ansehen merken
const APP = "reise-app-v5", FOTOS = "fotos-v1", TILES = "tiles-v1";
const DATEIEN = ["./", "index.html", "app.js", "db.js", "style.css", "manifest.webmanifest", "icon-180.png", "laender.js", "welt.geojson", "web.json", "orte.json",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css", "https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css",
  "https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js", "https://cdn.jsdelivr.net/npm/exifr@7.1.3/dist/lite.umd.js"];
self.addEventListener("install", (e) => e.waitUntil(caches.open(APP).then((c) => c.addAll(DATEIEN)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.hostname.includes("nominatim")) return;
  if (u.pathname.includes("/fotos/")) { e.respondWith(caches.open(FOTOS).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }))); return; }
  if (u.hostname.endsWith("tile.openstreetmap.de")) {
    e.respondWith(caches.open(TILES).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; })));
    return;
  }
  // App-Dateien: erst Netz (Updates), sonst Cache
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) caches.open(APP).then((c) => c.put(e.request, r.clone())); return r; }).catch(() => caches.match(e.request)));
});
