const { test, expect } = require('@playwright/test');
const { seed } = require('./helpers');

const MOCK_CONFIG = { supabaseUrl: 'https://demo-project.supabase.co', anonKey: 'anon-key-for-tests' };
const ALLOWED_KEYS = ['at_lastUser', 'at_profiles', 'at_tab', 'at_v2_Mouataz', 'at_v2_Mouataz_t'];
const PAGE_SIZE = 20;

const USER = { id: '11111111-1111-4111-8111-111111111111', user_metadata: { name: 'Mouataz' } };

/* 1×1 PNG valide (assez pour le flux upload/preview) */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function withSocial(page){
  return page.addInitScript(cfg => { window.LIFTR_SOCIAL_CONFIG = cfg; }, MOCK_CONFIG);
}

async function signedIn(page){
  await page.evaluate(u => Promise.resolve(window.restoreSession()).then(() => {
    window.socialUser = u;
    window.updateSocialGate();
  }), USER);
}

function post(i, over){
  return Object.assign({
    id: 'post-' + i,
    kind: 'text',
    body: 'Séance ' + i + ' — du volume et de la constance.',
    image_path: null,
    thumb_path: null,
    meta: {},
    created_at: new Date(Date.now() - i * 3600000).toISOString(),
    deleted_at: null,
    author: { username: 'mouataz', display_name: 'Mouataz', avatar_url: null }
  }, over || {});
}

/* Une seule route pour tout Supabase : rest / storage / auth.
   `handler` reçoit { route, kind, call } et répond lui-même. */
function supa(page, handler){
  const calls = [];
  page.route('**/*.supabase.co/**', async route => {
    const req = route.request();
    const call = { url: req.url(), method: req.method(), body: req.postData() };
    calls.push(call);
    const kind = call.url.includes('/rest/v1/') ? 'rest'
      : call.url.includes('/storage/v1/') ? 'storage'
      : 'auth';
    if (handler) return handler({ route, kind, call });
    if (kind === 'rest') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  return calls;
}

function consoleWatch(page){
  const errs = [];
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(String(e)));
  return errs;
}

async function openFeed(page){
  await page.locator('#tabFeedBtn').click();
  await expect(page.locator('#tab-feed')).toBeVisible();
}

test.describe('Feed : liste', () => {

  test('vide : état vide, composer prêt, aucune clé localStorage en plus', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    supa(page);

    await openFeed(page);

    await expect(page.locator('#feedList .feed-empty-t')).toHaveText('Nothing here yet');
    await expect(page.locator('#feedList .post')).toHaveCount(0);
    await expect(page.locator('#feedMoreWrap')).toBeHidden();
    await expect(page.locator('#postSubmit')).toBeDisabled();
    await expect(page.locator('#postBody')).toHaveAttribute('maxlength', '2000');
    await expect(page.locator('#composerAvatar')).toHaveText('M');

    const keys = await page.evaluate(allowed => Object.keys(localStorage).sort()
      .every(k => allowed.includes(k)), ALLOWED_KEYS);
    expect(keys).toBe(true);
    expect(errs).toEqual([]);
  });

  test('cartes : avatar, nom, horodatage, corps et photo en blur-up', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    supa(page, ({ route, kind }) => {
      if (kind !== 'rest') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      const rows = [
        post(1, { kind: 'photo', image_path: 'u/1-a.webp', thumb_path: 'u/1-a-thumb.webp' }),
        post(2)
      ];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    });

    await openFeed(page);

    await expect(page.locator('#feedList .post')).toHaveCount(2);
    await expect(page.locator('.post-name').first()).toHaveText('Mouataz');
    await expect(page.locator('.post-time').first()).toHaveText('1h');
    await expect(page.locator('.post-body').first()).toContainText('Séance 1');

    const img = page.locator('.post-img').first();
    await expect(img).toHaveAttribute('src', /\/storage\/v1\/object\/public\/posts\/u\/1-a\.webp$/);
    await expect(page.locator('.post-blur').first()).toHaveAttribute('src', /1-a-thumb\.webp$/);
    await expect(page.locator('.post-media')).toHaveCount(1);
    expect(errs).toEqual([]);
  });

  test('page suivante : « Load more » n’apparaît que si la page est pleine', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);

    const seen = [];
    supa(page, ({ route, kind, call }) => {
      if (kind !== 'rest') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      const isPosts = call.url.indexOf('/rest/v1/posts?') !== -1;
      if (!isPosts) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      const m = call.url.match(/offset=(\d+)/);
      const offset = m ? parseInt(m[1], 10) : 0;
      seen.push(offset);
      const rows = offset === 0
        ? Array.from({ length: PAGE_SIZE }, (_, i) => post(i))
        : [post(90), post(91)];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    });

    await openFeed(page);
    await expect(page.locator('#feedList .post')).toHaveCount(PAGE_SIZE);
    await expect(page.locator('#feedMoreWrap')).toBeVisible();

    await page.locator('#feedMore').click();
    await expect(page.locator('#feedList .post')).toHaveCount(PAGE_SIZE + 2);
    await expect(page.locator('#feedMoreWrap')).toBeHidden();
    expect(seen).toEqual([0, PAGE_SIZE]);
  });

  test('erreur serveur : état d’erreur lisible puis Retry qui recharge', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);

    let broken = true;
    supa(page, ({ route, kind }) => {
      if (kind !== 'rest') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      if (broken) return route.fulfill({ status: 500, contentType: 'application/json',
        body: JSON.stringify({ message: 'boom', code: '500' }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([post(1)]) });
    });

    await openFeed(page);
    await expect(page.locator('#feedList .feed-empty-t')).toHaveText('Could not load the feed');
    await expect(page.locator('#feedList .feed-empty-s')).toContainText('boom');

    broken = false;
    await page.locator('#feedList button:has-text("Retry")').click();
    await expect(page.locator('#feedList .post')).toHaveCount(1);
  });

  test('restauration du scroll en quittant puis en rouvrant le Feed', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    supa(page, ({ route, kind }) => {
      if (kind !== 'rest') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      const rows = Array.from({ length: PAGE_SIZE }, (_, i) =>
        post(i, { body: 'Post numéro ' + i + ' avec un texte volontairement un peu long pour remplir la page.' }));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) });
    });

    await openFeed(page);
    await expect(page.locator('#feedList .post')).toHaveCount(PAGE_SIZE);

    /* le conteneur qui défile est .app (app shell), plus le document */
    await page.evaluate(() => { document.querySelector('.app').scrollTop = 620; });
    await page.waitForFunction(() => document.querySelector('.app').scrollTop > 200);

    await page.evaluate(() => showTab('programme'));
    expect(await page.evaluate(() => document.querySelector('.app').scrollTop)).toBeLessThan(620);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);

    await page.evaluate(() => showTab('feed'));
    await page.waitForFunction(() => document.querySelector('.app').scrollTop > 200);
    const y = await page.evaluate(() => document.querySelector('.app').scrollTop);
    expect(Math.abs(y - 620)).toBeLessThan(3);
  });
});

test.describe('Feed : composer', () => {

  test('le bouton Post s’active dès qu’il y a du texte', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    supa(page);

    await openFeed(page);
    await expect(page.locator('#postSubmit')).toBeDisabled();

    await page.fill('#postBody', 'Bench 3×5 à 80 kg');
    await expect(page.locator('#postSubmit')).toBeEnabled();

    await page.fill('#postBody', '   ');
    await expect(page.locator('#postSubmit')).toBeDisabled();
  });

  test('publication texte : insert envoyé, carte ajoutée, composer vidé', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);

    const inserts = [];
    supa(page, ({ route, kind, call }) => {
      if (kind !== 'rest') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      if (call.method === 'POST'){
        const payload = JSON.parse(call.body);
        inserts.push(payload);
        return route.fulfill({ status: 201, contentType: 'application/json',
          body: JSON.stringify([Object.assign({ id: 'new-1', created_at: new Date().toISOString(),
            author: { username: 'mouataz', display_name: 'Mouataz', avatar_url: null } }, payload)]) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([post(1)]) });
    });

    await openFeed(page);
    await expect(page.locator('#feedList .post')).toHaveCount(1);

    await page.fill('#postBody', '80 kg × 5, good bar speed.');
    await page.locator('#postSubmit').click();

    await expect(page.locator('#feedList .post')).toHaveCount(2);
    await expect(page.locator('.post-body').first()).toHaveText('80 kg × 5, good bar speed.');
    await expect(page.locator('#postBody')).toHaveValue('');
    await expect(page.locator('#postSubmit')).toBeDisabled();

    expect(inserts).toHaveLength(1);
    expect(inserts[0].author_id).toBe(USER.id);
    expect(inserts[0].kind).toBe('text');
    expect(inserts[0].body).toBe('80 kg × 5, good bar speed.');
    expect(inserts[0].image_path).toBe(null);
    expect(errs).toEqual([]);
  });

  test('publication avec photo : deux uploads storage puis kind "photo"', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);

    const inserts = [];
    const uploads = [];
    supa(page, ({ route, kind, call }) => {
      if (kind === 'storage'){
        if (call.method === 'POST'){ uploads.push(call.url); return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }); }
        /*GET : la vignette et la photo des cartes*/
        return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: PNG });
      }
      if (kind !== 'rest') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      if (call.method === 'POST'){
        const payload = JSON.parse(call.body);
        inserts.push(payload);
        return route.fulfill({ status: 201, contentType: 'application/json',
          body: JSON.stringify([Object.assign({ id: 'new-2', created_at: new Date().toISOString(),
            author: { username: 'mouataz', display_name: 'Mouataz', avatar_url: null } }, payload)]) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await openFeed(page);
    await page.fill('#postBody', 'Leg day.');
    await page.setInputFiles('#postPhoto', { name: 'leg.png', mimeType: 'image/png', buffer: PNG });

    /* la photo passe par l'éditeur avant d'entrer dans le composeur */
    await expect(page.locator('#editorModal')).toBeVisible();
    await page.locator('#editorUse').click();
    await expect(page.locator('#editorModal')).toBeHidden();

    await expect(page.locator('#postPreview')).toBeVisible();
    await expect(page.locator('#postPreviewImg')).toHaveAttribute('src', /^blob:/);

    await page.locator('#postSubmit').click();
    await expect(page.locator('#feedList .post')).toHaveCount(1);

    expect(uploads).toHaveLength(2);
    expect(uploads[0]).toContain('/storage/v1/object/posts/');
    expect(uploads[0]).toMatch(/\/11111111-1111-4111-8111-111111111111\/\d+-\w+\.webp$/);
    expect(uploads[1]).toMatch(/-thumb\.webp$/);

    expect(inserts).toHaveLength(1);
    expect(inserts[0].kind).toBe('photo');
    expect(inserts[0].image_path).toMatch(/\.webp$/);
    expect(inserts[0].thumb_path).toMatch(/-thumb\.webp$/);
    await expect(page.locator('#postPreview')).toBeHidden();
    expect(errs).toEqual([]);
  });

  test('fichier non image : toast, aucun aperçu, aucune requête', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const calls = supa(page);

    await openFeed(page);
    await page.setInputFiles('#postPhoto', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });

    await expect(page.locator('#toast')).toContainText('Please choose an image file.');
    await expect(page.locator('#postPreview')).toBeHidden();
    /* rien à part la lecture initiale du fil */
    expect(calls.filter(c => c.method !== 'GET')).toEqual([]);
  });

  test('compression : WebP, 1080 px max, vignette 320 px', async ({ page }) => {
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await openFeed(page);

    const res = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 2000; c.height = 1500;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#FF6B35';
      ctx.fillRect(0, 0, 2000, 1500);
      const src = await new Promise(r => c.toBlob(r, 'image/png'));

      const full = await compressImage(src, 1080, 0.85);
      const thumb = await compressImage(src, 320, 0.8);
      const dims = async b => {
        const bmp = await createImageBitmap(b);
        const d = { w: bmp.width, h: bmp.height, bytes: b.size };
        if (bmp.close) bmp.close();
        return d;
      };
      return {
        supported: webpSupported(),
        fullType: full.type, thumbType: thumb.type,
        full: await dims(full), thumb: await dims(thumb)
      };
    });

    expect(res.supported).toBe(true);
    expect(res.fullType).toBe('image/webp');
    expect(res.thumbType).toBe('image/webp');
    expect(res.full.w).toBe(1080);
    expect(res.full.h).toBe(810);
    expect(res.thumb.w).toBe(320);
    expect(res.thumb.h).toBe(240);
    expect(res.full.bytes).toBeGreaterThan(0);
    expect(res.thumb.bytes).toBeLessThan(res.full.bytes);
  });

  test('déconnexion : composer et liste vidés', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    supa(page, ({ route, kind }) => {
      if (kind !== 'rest') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([post(1)]) });
    });

    await openFeed(page);
    await expect(page.locator('#feedList .post')).toHaveCount(1);
    await page.fill('#postBody', 'un brouillon');

    await page.locator('#tab-feed button:has-text("Sign out")').click();

    await expect(page.locator('#tabFeedBtn')).toBeHidden();
    await expect(page.locator('#tab-feed')).toBeHidden();
    expect(await page.evaluate(() => document.getElementById('postBody').value)).toBe('');
    expect(await page.evaluate(() => document.getElementById('feedList').innerHTML)).toBe('');
    expect(errs).toEqual([]);
  });
});
