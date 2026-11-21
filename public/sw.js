// Service worker: halaman dibuka dari jaringan lebih dulu; jika gagal, dipakai salinan terakhir
// (atau halaman offline). Aset statis disimpan agar aplikasi ringan di sinyal lemah.
// Permintaan ke Supabase (domain lain) tidak di-cache di sini; data terakhir disimpan oleh aplikasi
// lewat localStorage (src/lib/offlineCache.js).
const CACHE = 'app-v2';
const PRECACHE = ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // jangan cache API

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const salinan = res.clone(); caches.open(CACHE).then((c) => c.put(req, salinan)); }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/offline.html')))
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/images/')) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const salinan = res.clone(); caches.open(CACHE).then((c) => c.put(req, salinan)); }
        return res;
      }))
    );
  }
});
