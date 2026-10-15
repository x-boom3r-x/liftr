const CACHE_NAME = 'liftr-v72';

const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/state.js',
  './js/data.js',
  './js/idb.js',
  './js/store.js',
  './js/gestures.js',
  './js/ui.js',
  './js/programme.js',
  './js/suggest.js',
  './js/seance.js',
  './js/calendrier.js',
  './js/stats.js',
  './js/progress.js',
  './js/nutri.js',
  './js/nutrition.js',
  './js/foods.js',
  './js/icons.js',
  './data/foods.json',
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
  './js/lib/cropper.js',
  './js/social/config.js',
  './js/social/client.js',
  './js/social/gate.js',
  './js/social/auth.js',
  './js/social/editor.js',
  './js/social/music.js',
  './js/social/autoplay.js',
  './js/social/privacy.js',
  './js/social/attach.js',
  './js/social/deeplink.js',
  './js/social/feed.js',
  './js/social/comments.js',
  './js/social/people.js',
  './js/social/shell.js',
  './js/social/profile.js',
  './js/social/search.js',
  './js/social/inbox.js',
  './js/social/rings.js',
  './js/social/stories.js',
  './js/social/notes.js',
  './js/social/account.js',
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

  // Hors origine (Supabase, etc.) : on ne touche pas — jamais intercepté,
  // jamais mis en cache, l'API est appelée directement par la page.
  if (!req.url.startsWith(self.location.origin)) return;

  // Origine : réseau d'abord, cache en secours (hors ligne).
  // Auparavant le HTML venait du réseau et les JS du cache : un déploiement
  // pouvait servir du HTML nouveau avec du JS ancien (boutons morts).
  const navig = req.mode === 'navigate';

  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.ok){
        const copyReq = res.clone();
        const copyIdx = navig ? res.clone() : null;
        caches.open(CACHE_NAME).then(c => {
          const jobs = [c.put(req, copyReq)];
          if (copyIdx) jobs.push(c.put('./index.html', copyIdx));
          return Promise.all(jobs);
        }).catch(() => {});
      }
      return res;
    } catch(e){
      const hit = await caches.match(req);
      if (hit) return hit;
      if (navig){
        const app = await caches.match('./index.html') || await caches.match('./');
        if (app) return app;
      }
      throw e;
    }
  })());
});
