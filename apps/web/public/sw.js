// Minimal service worker so the driver app is installable ("Tambahkan ke
// layar utama"). Network-only: no caching of API data or private photos.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* pass through to the network */ });
