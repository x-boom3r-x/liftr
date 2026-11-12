const CACHE_NAME = 'liftr-v107';

const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/state.js',
  './js/data.js',
  './js/exercise-demo.js',
  './js/idb.js',
  './js/store.js',
  './js/gestures.js',
  './js/ui.js',
  './js/shortcuts.js',
  './js/today.js',
  './js/programme.js',
  './js/gym/exercises.js',
  './js/gym/plates.js',
  './js/gym/progression.js',
  './js/gym/1rm.js',
  './js/library.js',
  './js/bodymap.js',
  './js/bodymap-data.js',
  './js/suggest.js',
  './js/seance.js',
  './js/calendrier.js',
  './js/stats.js',
  './js/progress.js',
  './js/nutri.js',
  './js/nutri-remote.js',
  './js/nutri-scan.js',
  './js/nutrition.js',
  './js/foods.js',
  './js/icons.js',
  './js/illustrations.js',
  './data/foods.json',
  './data/exercises-catalogue-provenance.json',
  './LICENSE',
  './NOTICE.md',
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
  './js/comments/goal-reached.js',
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
  './js/social/notifications.js',
  './js/social/push.js',
  './js/social/realtime.js',
  './js/social/reels.js',
  './js/social/timeline.js',
  './js/social/account.js',
  './js/social/index.js',
  './manifest.json',
  './gym/',
  './gym/index.html',
  './gym/precache.json',
  './logo.png',
  './nouveau%20logo.jpeg',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS);
    try {
      const response = await fetch('./gym/precache.json', { cache: 'reload' });
      if (response.ok) {
        const files = await response.json();
        const gymPath = new URL('./gym/', self.registration.scope).pathname;
        const urls = Array.isArray(files) ? files.filter(path => {
          try {
            const url = new URL(path, self.registration.scope);
            return url.origin === self.location.origin && url.pathname.startsWith(gymPath);
          } catch(e) { return false; }
        }) : [];
        if (urls.length) await cache.addAll(urls);
      }
    } catch(e){}
  })());
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

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch(e){}
    const title = String(payload.title || 'LIFTR Social').slice(0, 80);
    const body = String(payload.body || 'You have a new Social notification.').slice(0, 180);
    const tag = String(payload.tag || 'liftr-social').slice(0, 120);
    const target = new URL(payload.url || './index.html?shortcut=notifications', self.registration.scope);
    if (target.origin !== self.location.origin) target.href = self.registration.scope;
    await self.registration.showNotification(title, {
      body,
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag,
      data: { url: target.href }
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const fallback = new URL('./index.html?shortcut=notifications', self.registration.scope);
  let target = fallback;
  try {
    const candidate = new URL(event.notification.data && event.notification.data.url || fallback.href);
    if (candidate.origin === self.location.origin) target = candidate;
  } catch(e){}
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients){
      if ('focus' in client){
        try { await client.navigate(target.href); } catch(e){}
        return client.focus();
      }
    }
    return self.clients.openWindow(target.href);
  })());
});
