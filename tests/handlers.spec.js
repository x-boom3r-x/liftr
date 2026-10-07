const { test, expect } = require('@playwright/test');

/* Chaque handler inline (HTML statique + chaînes générées par le JS) doit
   exister en global : filet de sécurité du découpage en modules ES
   (chaque module publie sa surface via Object.assign(window, {...})). */

const JS_FILES = [
  'js/app.js', 'js/state.js', 'js/data.js', 'js/store.js', 'js/ui.js',
  'js/programme.js', 'js/suggest.js', 'js/seance.js', 'js/calendrier.js',
  'js/stats.js', 'js/comments.js', 'js/motivation.js', 'js/install.js',
  'js/share.js', 'js/idb.js', 'js/export.js',
  'js/social/config.js', 'js/social/client.js', 'js/social/gate.js',
  'js/social/auth.js', 'js/social/feed.js', 'js/social/comments.js',
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
