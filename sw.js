const CACHE_NAME = 'liftr-v29';

const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/state.js',
  './js/data.js',
  './js/idb.js',
  './js/store.js',
  './js/ui.js',
  './js/programme.js',
  './js/suggest.js',
  './js/seance.js',
  './js/calendrier.js',
  './js/stats.js',
  './js/comments.js',
  './js/motivation.js',
  './js/comments/new-pr.js',
  './js/comments/strength-progress.js',
  './js/comments/reps-progress.js',
  './js/comments/volume-progress.js',
  './js/comments/consistency.js',
  './js/comments/comeback.js',
  './js/comments/hard-session.js',
  './js/comments/milestone.js',
  './js/comments/setback.js',
  './js/comments/general-progress.js',
  './js/install.js',
  './js/share.js',
  './js/export.js',
  './js/vendor/supabase.js',
  './js/social/config.js',
  './js/social/client.js',
  './js/social/gate.js',
  './js/social/auth.js',
  './js/social/feed.js',
  './js/social/index.js',
  './manifest.json',
  './logo.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Pages HTML : réseau d'abord, cache en secours (pour mettre à jour l'app)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // Hors origine (Supabase, etc.) : on ne touche pas — jamais intercepté,
  // jamais mis en cache, l'API est appelée directement par la page.
  if (!req.url.startsWith(self.location.origin)) return;

  // Reste : cache d'abord
  event.respondWith(
    caches.match(req).then(cached => cached || fetch(req))
  );
});
