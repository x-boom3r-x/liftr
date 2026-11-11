/* openGym service worker — the app shell and its hashed assets are cached at install and kept
   fresh network-first, media (img/gif) cache-first in a cache of its own. A home-screen app
   reopened without a network comes back from here with the same bundle it last ran; the state
   itself lives in localStorage. `CACHE` carries the build hash (vite.config.js rewrites it), so
   every deploy is a new worker with its own cache and the previous build's files are dropped on
   activate; the media cache (`MEDIA`) is kept across builds. */
const CACHE = 'opengym-rt-b4b429f599'
// Where the page leaves this browser's push device id (lib/push.js shareDeviceId) for the
// pushsubscriptionchange handler below, which has no localStorage to read it from. Not a build
// cache, so activate's sweep leaves it alone.
const DEVICE_CACHE = 'opengym-device'
const DEVICE_URL = '/opengym-device-id'

/* Exercise media (img/, gif/) lives in a cache of its own that outlives builds (#281). It used to
   share the build's cache, so every update swept every animation along with the old bundle, and
   an installed app opened offline after an update showed broken tiles for exercises it had shown
   the day before. The media never changes under a given URL, so there is nothing to invalidate.

   It is bounded instead: past MEDIA_MAX_BYTES (or MEDIA_MAX_ITEMS, for a server that sends no
   Content-Length) the least recently used entries go first. The Cache API keeps entries in the
   order they were written, so a hit is written back once per worker lifetime to move it to the
   end: least recently used as far as this worker has seen, which is what "LRU-ish" means here.
   The whole catalogue is about 100 MB of stills and clips, so the cap only bites for someone who has browsed most of
   it. lib/media-prefetch.js fills this cache ahead for the exercises in the plan — in the app
   installed on the home screen only; a browser tab gets what it has shown and nothing more — and
   names it too, so a new name has to change there as well (sw-media.test.js pins the two
   together). */
const MEDIA = 'opengym-media-v1'
const MEDIA_MAX_BYTES = 150 * 1024 * 1024
const MEDIA_MAX_ITEMS = 3000
// What an entry without a Content-Length is counted as: a little above the catalogue's average.
const MEDIA_GUESS_BYTES = 64 * 1024
// Trimming lists the whole cache, so it runs after every MEDIA_TRIM_EVERY new entries rather
// than after each one, and once when a new worker activates.
const MEDIA_TRIM_EVERY = 20
const isMediaPath = p => p.includes('/exercise-media/') || p.includes('/img/') || p.includes('/gif/')

// The code the app loads only when it needs it (the photo and video ingest, the QR reader...),
// listed by the build (vite.config.js, scripts/sw-stamp.mjs). Without it the first photo added
// offline after an update had no ingest to run. Unstamped (a dev server, a test) it is empty.
const LAZY = "[\"./assets/Admin-7ED6DDFZ.js\",\"./assets/CheckIn-D_3Tc9Tl.js\",\"./assets/CoachChat-Dt8nONTN.js\",\"./assets/CoachConsentSheet-Bq0SatN2.js\",\"./assets/CoachIntake-Dmwq7ABX.js\",\"./assets/CoachSetup-mAvSNcD7.js\",\"./assets/DateField-D2SN6Dtx.js\",\"./assets/DurationWheel-DQ1epGS6.js\",\"./assets/History-BgFmtK0L.js\",\"./assets/Library-d7rH5ikZ.js\",\"./assets/Measurements-DAor_d8t.js\",\"./assets/Muscles-7u8Lnylk.js\",\"./assets/Programmes-DwADGFl_.js\",\"./assets/ProgressPhotos-tCCnfmfC.js\",\"./assets/ReportSheet-FPTTd9L8.js\",\"./assets/RoutineEdit-B2hzBJgH.js\",\"./assets/Settings-B6WAZ2vu.js\",\"./assets/ShareCard-BzDpGgqu.js\",\"./assets/Stats-BxEw5TJz.js\",\"./assets/StructuralBalance-B1N8t4jy.js\",\"./assets/Tour-C96LhuIO.css\",\"./assets/Tour-Da-_dNqB.js\",\"./assets/Wrapped-BxtU9Zdz.js\",\"./assets/Wrapped-DofJKFEc.css\",\"./assets/api-IRru6Q2C.js\",\"./assets/app-icon-BHJkKJ0P.js\",\"./assets/backfill-IGb02Eno.js\",\"./assets/backup-media-7qFrXf_x.js\",\"./assets/base-Bsg5g79o.js\",\"./assets/body-paths-D_5SR19s.js\",\"./assets/capacitor-fetch-ZqVRv6f0.js\",\"./assets/categories-B2tdkgdE.js\",\"./assets/channel-Cg7jZNvD.js\",\"./assets/christmas-B7NZEXwM.js\",\"./assets/christmas-Dop0I10C.css\",\"./assets/coach-api-BQjJWbqC.js\",\"./assets/coach-consent-B7hLn56M.js\",\"./assets/coach-demo-COcYdGgi.js\",\"./assets/coach-device-DlB4u7lY.js\",\"./assets/coach-local-DHWrUqfC.js\",\"./assets/day-photos-DdkXkw7I.js\",\"./assets/de-CUISC6gj.js\",\"./assets/demoSeed-DlPIR22j.js\",\"./assets/en-BJ9FHc_q.js\",\"./assets/en-CNDRxJeJ.js\",\"./assets/equipment-D3-Dumhn.js\",\"./assets/esm-BYN2FIk-.js\",\"./assets/esm-Bo1JYWYW.js\",\"./assets/esm-C4TbQXak.js\",\"./assets/esm-D9tRyGu8.js\",\"./assets/esm-DKX4lzFy.js\",\"./assets/esm-DclBbSnz.js\",\"./assets/ex-unit-DQnUseHk.js\",\"./assets/exercise-history-DD-VSt5t.js\",\"./assets/exercises-BC-JO1l2.js\",\"./assets/halloween-7CwKpUf5.css\",\"./assets/halloween-soiBluMy.js\",\"./assets/health-connect-C-QYDBee.js\",\"./assets/health-sync-XMI3_-9I.js\",\"./assets/history-1v4vNF1K.js\",\"./assets/index-CVhupqv3.js\",\"./assets/index-DG7O3Hwv.css\",\"./assets/jsQR-DMfxOdIb.js\",\"./assets/jsx-runtime-LKYXHABd.js\",\"./assets/leaflet-D5ygxVXx.js\",\"./assets/leaflet-src-Dcu4YAMi.js\",\"./assets/leaflet-vh-t_kPv.css\",\"./assets/lean-qr-DWZdVoNy.js\",\"./assets/measurements-vAm7Ri4Q.js\",\"./assets/media-ingest-DINULUwy.js\",\"./assets/media-limits-DyNWDfO_.js\",\"./assets/media-prefetch-CrQLXMhb.js\",\"./assets/media-refs-CjgGBvJX.js\",\"./assets/media-store-CaweaRG8.js\",\"./assets/media-store-fs-eui1FaAd.js\",\"./assets/mobile-CNC2Ypyu.js\",\"./assets/modules-copy-DAbrvPDS.js\",\"./assets/native-C9aHk4AJ.js\",\"./assets/nudge-check-CRhY7GDc.js\",\"./assets/pending-CG0YB1pl.js\",\"./assets/plan-share-Dr5GKxxu.js\",\"./assets/platform-now-CIGTrnA-.js\",\"./assets/preload-helper-CPla4fz8.js\",\"./assets/providers-CC0t0Cvg.js\",\"./assets/rolldown-runtime-XKyaHtl9.js\",\"./assets/rotation-C4sCXTNQ.js\",\"./assets/scan-web-8SDxTI53.js\",\"./assets/seasonal-BDHlgmoO.js\",\"./assets/session-merge-DXlN7JpY.js\",\"./assets/set-videos-qnlxZ6Qi.js\",\"./assets/sheets-CC0Xplca.js\",\"./assets/supersetFlow-8agS1vgs.js\",\"./assets/sync-merge-Cy9-WshM.js\",\"./assets/ui-Bjd_YjuC.js\",\"./assets/useStore-BpKJXSQ7.js\",\"./assets/useUI-BJRlVHUR.js\",\"./assets/web-B6r3s4xM.js\",\"./assets/web-Bhy5aV6A.js\",\"./assets/web-CwjBp88d.js\",\"./assets/web-Dp5pwq3O.js\",\"./assets/web-HEsK0rhk.js\",\"./assets/web-ntrUjKqb.js\",\"./assets/workout-date-CGRlWU93.js\"]"
const lazyAssets = () => { try { const a = JSON.parse(LAZY); return Array.isArray(a) ? a : [] } catch { return [] } }

// What the shell needs to boot without a network: index.html plus every script/style/icon it
// references. Read from the served index.html so the list follows the build, not a hand-kept
// manifest that would go stale the first time a chunk is renamed.
async function precache() {
  const c = await caches.open(CACHE)
  const res = await fetch('index.html', { cache: 'no-cache' })
  // Whatever came back is not the shell: the server was restarting mid-deploy (5xx), or the
  // request was answered by something else after a redirect — an auth proxy in front (Authelia,
  // Cloudflare Access; docs/SELF_HOSTING.md) sends its login page once the session there expires.
  // Throwing fails the install, which is the only thing that keeps the build already
  // on this device, and its cache, in place; a returned-quietly install activates and sweeps.
  if (!res.ok || res.redirected) throw new Error('precache: index.html ' + res.status + (res.redirected ? ' redirected' : ''))
  const html = await res.text()
  const refs = [...new Set([...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])
    .filter(u => /\.(?:js|css|png|svg|webmanifest|json)(?:\?|$)/.test(u) && !/^(?:https?:)?\/\//.test(u)))]
  // The scripts and the stylesheets ARE the app. Every sub-resource used to be best-effort, so an
  // install that got index.html and lost one chunk to a flaky connection still activated, still
  // swept the build this device came from, and the next offline open was a shell with no code:
  // a blank page. A chunk that will not cache fails the install instead, which keeps the working
  // build and its cache exactly where they are. Images, icons and the manifest stay best-effort —
  // a missing icon is not a broken app.
  const code = refs.filter(u => /\.(?:js|css)(?:\?|$)/.test(u))
  // Fetched by hand rather than with `cache.add`, for the same reason index.html is: `add` takes
  // a REDIRECT for an answer, and an auth proxy in front answers every request with its login
  // page once the session there expires. A 200 of HTML stored under the main bundle's URL is
  // worse than nothing cached at all —
  // the install would report success and then sweep the build that still worked.
  await Promise.all(code.map(async u => {
    const r = await fetch(u, { cache: 'no-cache' }).catch(e => { throw new Error('precache: ' + u + ' — ' + (e?.message || e)) })
    if (!r.ok || r.redirected) throw new Error('precache: ' + u + ' ' + r.status + (r.redirected ? ' redirected' : ''))
    await c.put(u, r)
  }))
  await Promise.all(refs.filter(u => !code.includes(u)).map(u => c.add(u).catch(() => {})))
  // Best effort, like the icons: a chunk missing here is fetched when it is needed, as before, and
  // must not keep a working build from installing. Fetched by hand for the same redirect reason.
  await Promise.all(lazyAssets().filter(u => !code.includes(u)).map(async u => {
    try {
      const r = await fetch(u, { cache: 'no-cache' })
      if (r.ok && !r.redirected) await c.put(u, r)
    } catch { /* fetched on demand instead */ }
  }))
  // The shell goes in last, so activate's guard — an index.html in THIS build's cache — means the
  // whole shell is there rather than just its first file.
  await c.put('index.html', new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
}

self.addEventListener('install', e => {
  e.waitUntil(precache().then(() => self.skipWaiting()))
})
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // The previous build's files are what a reopen without a network comes back from, so they go
    // only once this build's shell is really in its own cache. An install that never got the
    // shell used to take them anyway, and the app opened on the browser's error page until the
    // next load with a network.
    const c = await caches.open(CACHE)
    if (await c.match('index.html')) {
      // DEVICE_CACHE holds this browser's device id (the push re-register below needs it): not a
      // build, so an update never sweeps it.
      const old = (await caches.keys()).filter(k => k !== CACHE && k !== MEDIA && k !== DEVICE_CACHE)
      // A build from before MEDIA existed kept its media in its own cache: move it across first,
      // so the first update to this worker does not cost what the device already had offline.
      await Promise.all(old.map(k => adoptMedia(k).catch(() => {})))
      await Promise.all(old.map(k => caches.delete(k)))
      await trimMedia().catch(() => {})
    }
    await self.clients.claim()
  })())
})

// Only a real answer is kept. A gated instance answers a lapsed session with 401, and an auth
// proxy in front with its login page, a 200 of HTML after a redirect; stored under an image's
// URL, that would stand in for the animation for good, since nothing sweeps this cache.
const realMedia = res => {
  const type = (res.headers && res.headers.get('content-type')) || ''
  return res.ok && !res.redirected && !/text\/html/i.test(type)
}

async function adoptMedia(name) {
  const from = await caches.open(name)
  const media = (await from.keys()).filter(r => { try { return isMediaPath(new URL(r.url || r, location.href).pathname) } catch { return false } })
  if (!media.length) return
  const to = await caches.open(MEDIA)
  for (const r of media) {
    if (await to.match(r)) continue
    // A build before this one kept any ok answer, a login page included. It went with that
    // build's cache; carried into this one, it would stay.
    const res = await from.match(r)
    if (res && realMedia(res)) await to.put(r, res)
  }
}

let mediaPuts = 0
// Oldest first, which after the write-backs below is least recently used first.
async function trimMedia() {
  if (!(await caches.keys()).includes(MEDIA)) return
  const c = await caches.open(MEDIA)
  const keys = await c.keys()
  const sizes = await Promise.all(keys.map(k => c.match(k).then(r => Number(r && r.headers && r.headers.get('content-length')) || MEDIA_GUESS_BYTES, () => MEDIA_GUESS_BYTES)))
  let bytes = sizes.reduce((a, b) => a + b, 0)
  let items = keys.length
  for (let i = 0; i < keys.length && (bytes > MEDIA_MAX_BYTES || items > MEDIA_MAX_ITEMS); i++) {
    await c.delete(keys[i])
    bytes -= sizes[i]; items--
  }
}

// A <video> asks for its clip in byte ranges. The network's 206 cannot be cached (cache.put
// refuses a partial answer), so a clip was never kept; and a whole 200 handed to a range request
// is a clip iOS Safari will not play. So the cache holds the whole file, fetched without a Range,
// and a range request is answered with a 206 cut from it. One range, the only kind a player asks
// for; anything else gets the whole file.
const rangeOf = req => (req.headers && typeof req.headers.get === 'function' && req.headers.get('range')) || ''
async function slice(res, range) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  const type = res.headers.get('content-type') || 'application/octet-stream'
  const body = await res.arrayBuffer()
  const size = body.byteLength
  let start = m && m[1] !== '' ? Number(m[1]) : NaN
  let end = m && m[2] !== '' ? Number(m[2]) : size - 1
  if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, size - Number(m[2])); end = size - 1 }
  if (!m || !Number.isFinite(start)) return new Response(body, { status: 200, headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes' } })
  if (start >= size || end < start) return new Response(null, { status: 416, headers: { 'content-range': 'bytes */' + size } })
  end = Math.min(end, size - 1)
  return new Response(body.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: { 'content-type': type, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' }
  })
}

// URLs written back this worker lifetime; see MEDIA above.
const touched = new Set()
function media(e) {
  const range = rangeOf(e.request)
  return caches.open(MEDIA).then(c => c.match(e.request).then(hit => {
    if (hit) {
      if (!touched.has(e.request.url)) {
        touched.add(e.request.url)
        const copy = hit.clone()
        e.waitUntil(c.put(e.request, copy).catch(() => {}))
      }
      return range ? slice(hit, range) : hit
    }
    // The whole file for a range request: the one answer that can be kept.
    return fetch(range ? e.request.url : e.request).then(res => {
      const whole = range ? res.status === 200 : true
      if (whole && realMedia(res)) {
        touched.add(e.request.url)
        const copy = res.clone()
        e.waitUntil(c.put(e.request.url, copy).then(() => { if (++mediaPuts >= MEDIA_TRIM_EVERY) { mediaPuts = 0; return trimMedia() } }).catch(() => {}))
        if (range) return slice(res, range)
      }
      return res
    })
  }))
}

// The payload is parsed inside waitUntil: a push whose handler throws before showing anything is
// a "silent push", which Chrome counts against the site and eventually revokes. A body that is
// not JSON still shows a notification.
self.addEventListener('push', e => {
  e.waitUntil((async () => {
    let data = {}
    try { data = e.data ? e.data.json() : {} } catch { data = { body: (() => { try { return e.data.text() } catch { return '' } })() } }
    // One alert per kind: a new rest-timer push replaces the last one instead of stacking
    // up in the tray (issue #172). `tag` alone should do that, but iOS keeps every one, so
    // the previous notification with the same tag is closed by hand first.
    const tag = data.tag || 'opengym'
    try { for (const n of await self.registration.getNotifications({ tag })) n.close() } catch {}
    await self.registration.showNotification(data.title || 'openGym', {
      body: data.body || '',
      icon: 'icon-512.png',
      badge: 'icon-180.png',
      tag,
      renotify: true
    })
  })())
})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => {
    const c = clients.find(c => 'focus' in c)
    return c ? c.focus() : self.clients.openWindow('./')
  }))
})
// The push service rotated the subscription (key change, expiry): subscribe again with the same
// server key and tell the server, so the row it holds keeps pointing at this browser. With the
// device id the page registers with: without one, this browser's rest-timer alert goes to every
// device of the account until the page's next boot sync sees the missing id and sends it again.
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    const old = e.oldSubscription || (await self.registration.pushManager.getSubscription())
    const key = e.newSubscription?.options?.applicationServerKey || old?.options?.applicationServerKey
    if (!key) return
    const sub = e.newSubscription || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
    const deviceId = await caches.open(DEVICE_CACHE).then(c => c.match(DEVICE_URL)).then(r => r ? r.text() : undefined).catch(() => undefined)
    await fetch('api/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), deviceId }) }).catch(() => {})
  })())
})

// The API sits next to the app, wherever the app is served: /api/ at the site root, /myGym/api/
// under a subpath (#238). Matching '/api/' alone let a subpath deployment's data answers into
// the network-first branch below, which cached them and handed an old document back as a 200
// once the network was gone — the page then took it for the server's word. The Cache API ignores
// the API's own `Cache-Control: no-store`, so the worker has to know to stay out of the way.
const API = (() => { try { return new URL('api/', location.href).pathname } catch { return '/api/' } })()

// How long a request for the app itself waits on the network before a cached copy answers it.
const NET_WAIT_MS = 3000

// The build's own chunks and stylesheets (assets/<name>-<hash>.js|css): the name changes whenever
// the content does, so a copy in this build's cache is the file, and a start serves them from
// here instead of asking the network about each of them again (40-odd round trips before Home).
const isHashedAsset = p => /\/assets\/[^/]+-[A-Za-z0-9_-]{8}\.(?:js|css)$/.test(p)
const cacheFirst = e => caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request).then(res => {
  // Only a real answer is kept: an auth proxy's login page would otherwise stand in for the chunk
  // for the rest of this build.
  if (res.ok && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}) }
  return res
}))

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith(API)) return    // never cache auth/data

  if (isMediaPath(url.pathname)) {
    e.respondWith(media(e))
    return
  }
  if (isHashedAsset(url.pathname)) {
    e.respondWith(cacheFirst(e))
    return
  }
  // Network first; the copy for the cache is cloned before the response is handed to the page —
  // cloning later, once the page has started reading the body, throws and caches nothing, which
  // is why the shell never used to survive an offline reload.
  // A dead radio does not reject fetch() quickly — it just never settles — so a cold-launch of
  // the installed app with no network stayed on a blank screen forever, with the cache fallback
  // never getting a chance to run (issue #274). So a request the network has not answered within
  // NET_WAIT_MS is answered from the cache, when the cache has it. Nothing is aborted: an abort
  // that fires once the headers are in errors the body the page is still reading, and on a slow
  // connection a locale pack or a chunk that was on its way failed outright, every start again,
  // since a body that never finishes is never cached either (and AbortSignal.timeout, which the
  // abort used, does not exist before iOS 16: the handler threw before it answered at all, the
  // cache fallback with it). A request the cache cannot answer keeps waiting for the network, as
  // it always did; and the network's answer, whenever it comes, still refreshes the cache.
  const fromCache = () => caches.match(e.request, { ignoreSearch: true }).then(hit =>
    hit || (e.request.mode === 'navigate' ? caches.match('index.html') : undefined))
  e.respondWith(new Promise(resolve => {
    const slow = setTimeout(() => fromCache().then(hit => { if (hit) resolve(hit) }, () => {}), NET_WAIT_MS)
    fetch(e.request).then(res => {
      clearTimeout(slow)
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {}) }
      resolve(res)
    }, () => {
      clearTimeout(slow)
      resolve(fromCache())
    })
  }))
})
