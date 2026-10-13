const { test, expect } = require('@playwright/test');
const fs = require('fs');

/* Chaque handler inline (HTML statique + chaînes générées par le JS) doit
   exister en global : filet de sécurité du découpage en modules ES
   (chaque module publie sa surface via Object.assign(window, {...})). */

const JS_FILES = [
  'js/app.js', 'js/state.js', 'js/data.js', 'js/store.js', 'js/ui.js',
  'js/programme.js', 'js/suggest.js', 'js/seance.js', 'js/calendrier.js',
  'js/stats.js', 'js/comments.js', 'js/motivation.js', 'js/install.js',
  'js/share.js', 'js/idb.js', 'js/export.js', 'js/nutri.js', 'js/icons.js',
  'js/social/config.js', 'js/social/client.js', 'js/social/gate.js',
  'js/social/auth.js', 'js/social/attach.js', 'js/social/feed.js', 'js/social/comments.js',
  'js/social/people.js', 'js/social/shell.js', 'js/social/profile.js',
  'js/social/search.js', 'js/social/inbox.js', 'js/social/index.js'
];

const KEYWORDS = new Set([
  'if', 'for', 'while', 'switch', 'typeof', 'return', 'new', 'catch',
  'try', 'delete', 'do', 'else', 'in', 'instanceof', 'void', 'throw'
]);

const BUILTINS = new Set([
  'alert', 'confirm', 'prompt', 'event', 'parseFloat', 'parseInt', 'isNaN',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'JSON', 'Math', 'Date', 'String', 'Number', 'Boolean', 'Object', 'Array', 'Set', 'Map',
  'encodeURIComponent', 'decodeURIComponent', 'escape', 'unescape', 'btoa', 'atob',
  'document', 'window', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'fetch', 'URL', 'URLSearchParams', 'Blob', 'FileReader', 'TextEncoder', 'TextDecoder',
  'Promise', 'console', 'getComputedStyle', 'matchMedia', 'crypto', 'AbortController'
]);

test('tous les handlers inline (HTML + JS) existent en global', async ({ page }) => {
  await page.goto('/index.html');

  const sources = await page.evaluate(async files => {
    const out = [];
    out.push(await (await fetch('index.html')).text());
    for (const f of files){
      const r = await fetch(f);
      if (r.ok) out.push(await r.text());
    }
    return out;
  }, JS_FILES);

  const found = new Set();
  for (const src of sources){
    const attr = /on(?:click|input|change)="([^"]*)"/g;
    let m;
    while ((m = attr.exec(src))){
      // identifiants appelés dans le handler, en excluant les appels de méthode (.foo())
      const calls = m[1].matchAll(/(?:^|[^.\w$])([a-zA-Z_$][\w$]*)\s*\(/g);
      for (const c of calls){
        const n = c[1];
        if (KEYWORDS.has(n) || BUILTINS.has(n)) continue;
        found.add(n);
      }
    }
  }

  const names = [...found].sort();
  expect(names.length, 'handlers détectés').toBeGreaterThan(40);

  const missing = await page.evaluate(list => list.filter(n => typeof window[n] !== 'function'), names);
  expect(missing, 'handlers manquants en global').toEqual([]);
});

test('chargement du script principal : zéro erreur console', async ({ page }) => {
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/index.html');
  await page.waitForSelector('#welcomeScreen');
  expect(errors.filter(e => !/favicon|apple-touch/i.test(e))).toEqual([]);
});

/* HTML (data-build), JS (window.__LIFTR_BUILD__) et service worker (liftr-vXX)
   portent le même numéro : le filet anti-desynchro de index.html recharge la
   page quand un HTML nouveau s'apparie à un JS plus ancien. */
test('builds synchronisés : index.html = js/app.js = sw.js', () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const app = fs.readFileSync('js/app.js', 'utf8');
  const sw = fs.readFileSync('sw.js', 'utf8');
  const inHtml = (html.match(/data-build="(\d+)"/) || [])[1];
  const inApp = (app.match(/__LIFTR_BUILD__\s*=\s*'(\d+)'/) || [])[1];
  const inSw = (sw.match(/liftr-v(\d+)/) || [])[1];
  expect(inHtml, 'index.html: data-build absent').toBeTruthy();
  expect(inApp, 'js/app.js: __LIFTR_BUILD__ absent').toBe(inHtml);
  expect(inSw, 'sw.js: CACHE_NAME absent').toBe(inHtml);
});

/* Le filet de index.html recharge la page si HTML et JS ne portent pas le meme
   build : il doit s'arreter (deux essais max), jamais boucler. Le service
   worker est empeche ici pour que la divergence persiste apres chaque reload. */
test('filet anti-desynchro : se recharge au plus deux fois puis se stabilise', async ({ page }) => {
  await page.addInitScript(() => {
    try { navigator.serviceWorker.register = () => Promise.reject(new Error('sw bloque')); } catch(e){}
    try {
      const n = parseInt(sessionStorage.getItem('__loads') || '0', 10);
      sessionStorage.setItem('__loads', String(n + 1));
    } catch(e){}
  });
  await page.route('**/index.html', async route => {
    const res = await route.fetch();
    const body = (await res.text()).replace(/data-build="\d+"/, 'data-build="999"');
    await route.fulfill({ response: res, body, headers: { 'content-type': 'text/html; charset=utf-8' } });
  });

  await page.goto('/index.html');
  await page.waitForFunction(
    () => sessionStorage.getItem('__loads') === '3' && sessionStorage.getItem('liftr-build-n') === '2',
    null, { timeout: 20000 }
  );
  const loads = await page.evaluate(() => parseInt(sessionStorage.getItem('__loads') || '0', 10));
  expect(loads, 'chargements : depart + 2 recharges maximum').toBe(3);

  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => parseInt(sessionStorage.getItem('__loads') || '0', 10));
  expect(after, 'le filet ne boucle pas').toBe(loads);

  await page.unroute('**/index.html');
});

/* Regression du fix « boutons morts » : un HTML nouveau servi avec un JS
   ancien sorti du cache. Le service worker sert maintenant le réseau d'abord. */
test('service worker : le JS vient du réseau même si le cache est pollué', async ({ page }) => {
  const build = (fs.readFileSync('index.html', 'utf8').match(/data-build="(\d+)"/) || [])[1];

  await page.goto('/index.html');
  await page.waitForFunction(
    () => !!(navigator.serviceWorker && navigator.serviceWorker.controller), null, { timeout: 20000 }
  );

  await page.evaluate(async () => {
    const sw = await (await fetch('sw.js')).text();
    const name = (sw.match(/liftr-v\d+/) || [])[0];
    const url = new URL('js/app.js', location.href).href;
    const cache = await caches.open(name);
    await cache.put(url, new Response('window.__LIFTR_BUILD__ = "pollue";', {
      headers: { 'content-type': 'text/javascript' }
    }));
    sessionStorage.setItem('liftr-build-n', '2');   /* on fige le filet pour lire le resultat */
  });

  await page.reload();
  const seen = await page.evaluate(() => window.__LIFTR_BUILD__);
  expect(seen, 'JS servi depuis le réseau, pas depuis le cache pollué').toBe(build);
});

/* Les modules sociaux ajout�s au fil des iterations ont ete oublies une fois
   dans la liste de pre-cache : l'app cassait hors-ligne. On verifie que tout
   ce qui existe sur disque est dans ASSETS. */
test('service worker : ASSETS precache tous les modules sociaux', () => {
  const sw = fs.readFileSync('sw.js', 'utf8');
  const listed = (sw.match(/'\.\/js\/social\/[^']+'/g) || []).map(s => s.replace(/'/g, ''));
  const onDisk = require('fs').readdirSync('js/social')
    .filter(f => f.endsWith('.js'))
    .map(f => './js/social/' + f);
  expect(onDisk.length, 'dossier js/social vide ?').toBeGreaterThan(0);
  expect(onDisk.filter(f => !listed.includes(f))).toEqual([]);
});
