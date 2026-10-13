const { test, expect } = require('@playwright/test');
const zlib = require('zlib');
const { seed } = require('./helpers');
const { ME, ANA, ME_P, ANA_P, withSocial, signedIn, consoleWatch,
  openFeed, post, story, mockApi } = require('./social-mock');

const ALLOWED_KEYS = ['at_lastUser', 'at_profiles', 'at_tab', 'at_v2_Mouataz', 'at_v2_Mouataz_t'];

const PNG = {
  name: 'leg.png', mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64')
};

/* PNG RGB 64x64 en 4 quadrants colorés : indispensable pour vérifier qu'un
   filtre change vraiment les pixels (une image mono ne bougerait pas). */
function crc32(buf){
  let c, table = crc32.t;
  if (!table){
    table = crc32.t = [];
    for (let n = 0; n < 256; n++){
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function colorPng(){
  const w = 64, h = 64;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++){
    raw[o++] = 0;
    for (let x = 0; x < w; x++){
      const top = y < h / 2, left = x < w / 2;
      if (top && left){ raw[o++] = 230; raw[o++] = 30;  raw[o++] = 40; }   /* rouge  */
      else if (top){     raw[o++] = 20;  raw[o++] = 220; raw[o++] = 60; }   /* vert   */
      else if (left){    raw[o++] = 30;  raw[o++] = 60;  raw[o++] = 230; }   /* bleu   */
      else {             raw[o++] = 240; raw[o++] = 210; raw[o++] = 40; }    /* jaune  */
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}
const COLOR_PNG = {
  name: 'color.png', mimeType: 'image/png', buffer: colorPng()
};

const TRACK = {
  trackId: 1234567890, trackName: 'Neon Skyline', artistName: 'The Lifters',
  collectionName: 'Iron Age', artworkUrl100: 'https://cdn.example/art.jpg',
  previewUrl: 'https://cdn.example/preview.m4a', trackTimeMillis: 30000
};

/* iTunes est hors origine : on le route pour rester deterministe. */
async function routeCdn(page){
  /* pochettes/aperçus : sans route, le navigateur tente un vrai DNS
     (ERR_NAME_NOT_RESOLVED) et le watch console échoue de façon aléatoire. */
  await page.route('**/cdn.example/**', route => route.fulfill({
    status: 200, contentType: 'image/png',
    headers: { 'access-control-allow-origin': '*' },
    buffer: PNG.buffer
  }));
}

async function routeMusic(page){
  await routeCdn(page);
  await page.route('**/itunes.apple.com/**', route => route.fulfill({
    status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ results: [TRACK] })
  }));
}

async function addMusic(page){
  await page.locator('#musicInput').fill('neon');
  await page.locator('#musicSearchBtn').click();
  await expect(page.locator('#musicList .music-row')).toHaveCount(1);
  await page.locator('#musicList .music-row').click();
  await expect(page.locator('#musicList .music-row')).toHaveClass(/sel/);
  await page.locator('#musicUseBtn').click();
  await expect(page.locator('#musicModal')).toBeHidden();
}

test.describe('V4 : « + » = choix du type de publication', () => {

  test('le bouton flottant ouvre Story, Note et Music', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page);

    await openFeed(page);
    await page.locator('#newPostFab').click();
    await expect(page.locator('#actionSheet')).toBeVisible();
    await expect(page.locator('#asList')).toContainText('Photo');
    await expect(page.locator('#asList')).toContainText('Music');
    await page.locator('#asList .as-item', { hasText: 'Story' }).click();
    await expect(page.locator('#storyModal')).toBeVisible();

    await page.evaluate(() => closeModal('storyModal'));
    await page.locator('#newPostFab').click();
    await page.locator('#asList .as-item', { hasText: 'Note' }).click();
    await expect(page.locator('#noteModal')).toBeVisible();

    await page.evaluate(() => closeModal('noteModal'));
    await page.locator('#newPostFab').click();
    await page.locator('#asList .as-item', { hasText: 'Music' }).click();
    await expect(page.locator('#musicModal')).toBeVisible();
    await page.evaluate(() => closeMusicPicker());
    expect(errs).toEqual([]);
  });
});

test.describe('V4 : like des publications', () => {

  test('le bouton like est un cœur (♥), compteur et état actif', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);

    await openFeed(page);
    const up = page.locator('#feedList [data-act="like"]').first();
    /* G : icônes seules — le libellé vit dans aria-label */
    await expect(up).toHaveAttribute('aria-label', 'Like');
    await expect(up.locator('.post-act-ico svg[data-i="heart"]')).toBeVisible();
    await expect(up.locator('[data-n="likes"]')).toHaveText('0');

    const n = up.locator('[data-n="likes"]');
    await expect(n).toHaveText('0');
    await up.click();
    await expect(n).toHaveText('1');
    await expect(up).toHaveClass(/on/);
    expect(api.calls.find(c => c.method === 'POST' && c.url.includes('/rest/v1/likes'))).toBeTruthy();

    await page.locator('#feedList [data-act="like"]').first().click();
    await expect(page.locator('#feedList [data-act="like"]').first()).not.toHaveClass(/on/);
    expect(errs).toEqual([]);
  });
});

test.describe('V4 : durée des notes et des stories', () => {

  test('note : 7 jours puis « forever »', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.evaluate(() => openNoteComposer());
    await expect(page.locator('#noteModal')).toBeVisible();

    await page.locator('#noteDur [data-dur="7"]').click();
    await expect(page.locator('#noteDur [data-dur="7"]')).toHaveClass(/active/);
    await page.locator('#noteBody').fill('Seven days of legs');
    await page.locator('#noteSubmit').click();
    await expect(page.locator('#noteModal')).toBeHidden();
    await expect.poll(() => api.st.notes.length).toBe(1);
    const week = (Date.parse(api.st.notes[0].expires_at) - Date.now()) / 86400000;
    expect(week).toBeGreaterThan(6.9);
    expect(week).toBeLessThan(7.1);

    await page.evaluate(() => openNoteComposer());
    await page.locator('#noteDur [data-dur="0"]').click();
    await page.locator('#noteBody').fill('Here for good');
    await page.locator('#noteSubmit').click();
    await expect(page.locator('#noteModal')).toBeHidden();
    await expect.poll(() => api.st.notes.length).toBe(1);
    const forever = (Date.parse(api.st.notes[0].expires_at) - Date.now()) / (365 * 86400000);
    expect(forever).toBeGreaterThan(50);
    expect(errs).toEqual([]);
  });

  test('story : 3 jours au choix', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.evaluate(() => openStoryComposer());
    await expect(page.locator('#storyModal')).toBeVisible();

    await page.locator('#storyDur [data-dur="3"]').click();
    await page.locator('#storyBody').fill('Three day story');
    await page.locator('#storySubmit').click();
    await expect(page.locator('#storyDone')).toBeVisible();
    await page.locator('#storyDoneBtn').click();
    await expect(page.locator('#storyModal')).toBeHidden();
    await expect.poll(() => api.st.stories.length).toBe(1);

    const days = (Date.parse(api.st.stories[0].expires_at) - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThan(3.1);
    expect(errs).toEqual([]);
  });
});

test.describe('V4 : compte privé / public', () => {

  test('le fil masque un compte privé non suivi, le follow ouvre tout', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page, {
      people: [Object.assign({}, ANA_P, { is_private: true }), ME_P],
      posts: [post(0, ANA, { body: 'Secret session' }),
              post(1, ME.id, { body: 'Public session' })]
    });

    await openFeed(page);
    await expect(page.locator('#feedList .post')).toHaveCount(1);
    await expect(page.locator('#feedList')).toContainText('Public session');
    await expect(page.locator('#feedList')).not.toContainText('Secret session');

    /* profil : badge + grille verrouillée tant qu'on ne suit pas */
    await page.evaluate(id => openProfile(id), ANA);
    await expect(page.locator('#view-profile')).toBeVisible();
    await expect(page.locator('#profName')).toHaveText('Ana');
    await expect(page.locator('#profPriv')).toBeVisible();
    await expect(page.locator('#profGrid')).toContainText('This account is private');
    await expect(page.locator('#profGrid .ptile')).toHaveCount(0);

    /* on suit Ana : le post entre dans le fil, la grille se déverrouille */
    api.st.follows.push({ follower_id: ME.id, followee_id: ANA });
    await page.evaluate(() => renderFeed());
    await expect(page.locator('#feedList .post')).toHaveCount(2);
    await expect(page.locator('#feedList')).toContainText('Secret session');

    await page.evaluate(() => renderProfile());
    await expect(page.locator('#profPriv')).toBeVisible();
    await expect(page.locator('#profGrid .ptile')).toHaveCount(1);
    expect(errs).toEqual([]);
  });

  test('basculer mon compte en privé dans « Edit profile »', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page, { people: [ME_P, ANA_P] });

    await openFeed(page);
    await page.locator('#socialNav [data-view="profile"]').click();
    await expect(page.locator('#view-profile')).toBeVisible();
    await page.locator('#editProfileBtn').click();
    await expect(page.locator('#profileModal')).toBeVisible();

    const sw = page.locator('#editPrivate');
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await page.locator('#editPrivate').click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await page.locator('#profileSubmit').click();
    await expect(page.locator('#profileModal')).toBeHidden();

    const patches = api.calls.filter(c => c.method === 'PATCH' &&
      c.url.includes('/rest/v1/profiles'));
    expect(patches.length).toBeGreaterThan(0);
    const wrotePrivacy = patches.some(c => {
      const b = JSON.parse(c.body || '{}');
      return String(b.bio || '').indexOf('⁣private⁣') >= 0 || b.is_private === true;
    });
    expect(wrotePrivacy).toBe(true);
    expect(errs).toEqual([]);
  });
});

test.describe('V4 : musique', () => {

  test('recherche, ajout au post, pion dans le corps, chip dans le fil', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.locator('#postMusicBtn').click();
    await expect(page.locator('#musicModal')).toBeVisible();
    await addMusic(page);

    await expect(page.locator('#postMusicSlot')).toBeVisible();
    await expect(page.locator('#postMusicSlot .mchip-t')).toHaveText('Neon Skyline');

    await page.locator('#postBody').fill('Big pull day');
    await page.locator('#postSubmit').click();
    await expect.poll(() => api.st.posts.length).toBe(3);
    expect(api.st.posts[0].body).toBe('Big pull day ♪1234567890@0-15');

    const chip = page.locator('#feedList .post-music .mchip').first();
    await expect(chip).toBeVisible();
    await expect(chip.locator('.mchip-t')).toHaveText('Neon Skyline');
    await expect(chip.locator('[data-mplay]')).toHaveCount(1);
    await expect(page.locator('#postMusicSlot')).toBeHidden();

    expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(ALLOWED_KEYS);
    expect(errs).toEqual([]);
  });

  test('une note garde la musique dans ses 60 caractères', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeMusic(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.evaluate(() => openNoteComposer());
    await page.locator('#noteMusicBtn').click();
    await addMusic(page);
    await expect(page.locator('#noteMusicSlot')).toBeVisible();

    await page.locator('#noteBody').fill('Legs are sore from the squats today');
    await page.locator('#noteSubmit').click();
    await expect(page.locator('#noteModal')).toBeHidden();
    await expect.poll(() => api.st.notes.length).toBe(1);

    const body = api.st.notes[0].body;
    expect(body.endsWith('♪1234567890@0-15')).toBe(true);
    expect(body.length).toBeLessThanOrEqual(60);

    await expect(page.locator('#notesRow .note-music .mchip-t')).toHaveText('Neon Skyline');
    expect(errs).toEqual([]);
  });
});

test.describe('V4 : éditeur d’image avant publication', () => {

  test('annuler l’édition ne met rien dans le composeur', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.setInputFiles('#postPhoto', PNG);
    await expect(page.locator('#editorModal')).toBeVisible();
    await expect(page.locator('#editorPresets .seg').first()).toHaveClass(/active/);

    await page.locator('#editorPresets [data-preset="mono"]').click();
    await expect(page.locator('#editorPresets [data-preset="mono"]')).toHaveClass(/active/);
    await page.locator('#editorAspect [data-aspect="4:5"]').click();
    await expect(page.locator('#editorAspect [data-aspect="4:5"]')).toHaveClass(/active/);

    await page.locator('#editorCancel').click();
    await expect(page.locator('#editorModal')).toBeHidden();
    await expect(page.locator('#postPreview')).toBeHidden();
    expect(api.calls.filter(c => c.method !== 'GET')).toEqual([]);
    expect(errs).toEqual([]);
  });

  /* Safari/iOS ne supporte pas `ctx.filter` : les filtres doivent être
     calculés au pixel, sinon les presets et les curseurs ne changent rien. */
  test('les presets et les curseurs modifient réellement les pixels', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    const api = mockApi(page);

    await openFeed(page);
    await page.setInputFiles('#postPhoto', COLOR_PNG);
    await expect(page.locator('#editorModal')).toBeVisible();
    await page.waitForTimeout(250);

    /* on échantillonne au cœur du cadre (jamais dessus : les 4 quadrants
       se croisent au centre exact et le lissage les mélangerait), toujours
       à l'intérieur de la zone recadrée. */
    const px = async () => page.evaluate(() => {
      const cv = document.getElementById('editorCanvas');
      const stage = document.getElementById('editorStage');
      const st = window.__editorState;
      if (!cv || !stage || !st || !st.frame) return null;
      const k = stage.clientWidth ? cv.width / stage.clientWidth : 1;
      const x = Math.max(0, Math.min(cv.width - 1, Math.round((st.frame.x + st.frame.w * 0.75) * k)));
      const y = Math.max(0, Math.min(cv.height - 1, Math.round((st.frame.y + st.frame.h * 0.75) * k)));
      /* copie dans un canvas de lecture : évite l'avertissement
         Chrome « willReadFrequently » sans toucher au rendu réel */
      const tmp = document.createElement('canvas');
      tmp.width = cv.width; tmp.height = cv.height;
      const ctx = tmp.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(cv, 0, 0);
      const d = ctx.getImageData(x, y, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2] };
    });
    const sat = p => Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b);
    const sum = p => p.r + p.g + p.b;

    const before = await px();
    expect(before).toBeTruthy();
    expect(sat(before)).toBeGreaterThan(60);          /* source bien colorée */

    await page.locator('#editorPresets [data-preset="mono"]').click();
    await page.waitForTimeout(150);
    const mono = await px();
    expect(sat(mono)).toBeLessThanOrEqual(6);          /* désaturé = filtre appliqué */
    expect(sum(mono)).not.toBe(sum(before));

    await page.locator('#editorLight').fill('1.4');
    await page.locator('#editorLight').dispatchEvent('input');
    await page.waitForTimeout(200);
    const lit = await px();
    expect(sum(lit)).toBeGreaterThan(sum(mono));       /* le curseur agit aussi */

    await page.locator('#editorPresets [data-preset="warm"]').click();
    await page.waitForTimeout(150);
    const warm = await px();
    expect(sat(warm)).toBeGreaterThan(6);

    /* l'export part de la même image filtrée que l'aperçu */
    await page.locator('#editorUse').click();
    await expect(page.locator('#editorModal')).toBeHidden();
    await expect(page.locator('#postPreview')).toBeVisible();
    expect(api.calls.filter(c => c.method !== 'GET')).toEqual([]);
    expect(errs).toEqual([]);
  });
});

test.describe('V4 : barre du bas', () => {

  test('la tabbar reste collée au bas de l’écran, même si le viewport rétrécit', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page);
    await openFeed(page);

    /* état nominal : bas de la tabbar = bas de l'écran */
    const at = async () => page.evaluate(() => {
      const b = document.querySelector('.tabbar').getBoundingClientRect();
      const shell = document.getElementById('mainApp').getBoundingClientRect();
      return { bottom: Math.round(b.bottom), vh: Math.round(window.innerHeight),
               shellH: Math.round(shell.height),
               transform: document.querySelector('.tabbar').style.transform || '' };
    });
    let r = await at();
    expect(Math.abs(r.bottom - r.vh)).toBeLessThanOrEqual(2);
    expect(r.transform).toBe('');

    /* simulation iOS : le visualViewport est plus bas que le layout
       (barre du navigateur qui réapparaît) → le shell suit en hauteur et la
       tabbar (enfant flex) reste collée au bas visible */
    await page.evaluate(() => {
      const vv = window.visualViewport;
      Object.defineProperty(vv, 'height', { value: window.innerHeight - 60, configurable: true });
      Object.defineProperty(vv, 'offsetTop', { value: 0, configurable: true });
      vv.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(120);
    r = await at();
    expect(r.transform, 'le shell absorbe le décalage, plus de translateY').toBe('');
    expect(r.shellH, 'la hauteur du shell suit le visualViewport').toBe(r.vh - 60);
    expect(Math.abs(r.bottom - (r.vh - 60))).toBeLessThanOrEqual(2);

    /* retour à la normale : plus aucune correction */
    await page.evaluate(() => {
      const vv = window.visualViewport;
      delete vv.height;
      delete vv.offsetTop;
      vv.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(120);
    r = await at();
    expect(r.transform).toBe('');
    expect(r.shellH, 'le shell revient à la pleine hauteur').toBe(r.vh);
    expect(Math.abs(r.bottom - r.vh)).toBeLessThanOrEqual(2);

    /* la correction reste appliquée pendant les changements d'onglet */
    await page.evaluate(() => showTab('stats'));
    r = await at();
    expect(Math.abs(r.bottom - r.vh)).toBeLessThanOrEqual(2);
    expect(errs).toEqual([]);
  });

  test('rebond iOS (visualViewport.offsetTop négatif) : la tabbar ne remonte pas', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    mockApi(page);
    await openFeed(page);

    const at = async () => page.evaluate(() => {
      const b = document.querySelector('.tabbar').getBoundingClientRect();
      const shell = document.getElementById('mainApp').getBoundingClientRect();
      return { bottom: Math.round(b.bottom), vh: Math.round(window.innerHeight),
               shellH: Math.round(shell.height),
               transform: document.querySelector('.tabbar').style.transform || '' };
    });
    let r = await at();
    expect(Math.abs(r.bottom - r.vh)).toBeLessThanOrEqual(2);

    /* pendant un scroll rebond, iOS décale le visualViewport vers le haut SANS
       réduire sa hauteur visible → le shell ne bouge pas (offsetTop ignoré) */
    await page.evaluate(() => {
      const vv = window.visualViewport;
      Object.defineProperty(vv, 'offsetTop', { value: -90, configurable: true });
      vv.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new Event('scroll'));
    });
    await page.waitForTimeout(150);
    r = await at();
    expect(r.transform).toBe('');
    expect(r.shellH, 'offsetTop négatif ne redimensionne pas le shell').toBe(r.vh);
    expect(Math.abs(r.bottom - r.vh)).toBeLessThanOrEqual(2);

    /* la hauteur réellement réduite reste corrigée (la vraie toolbar) */
    await page.evaluate(() => {
      const vv = window.visualViewport;
      Object.defineProperty(vv, 'height', { value: window.innerHeight - 60, configurable: true });
      vv.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(150);
    r = await at();
    expect(r.transform, 'le shell absorbe la réduction, plus de translateY').toBe('');
    expect(r.shellH, 'la hauteur du shell suit la vraie toolbar').toBe(r.vh - 60);
    expect(Math.abs(r.bottom - (r.vh - 60))).toBeLessThanOrEqual(2);

    await page.evaluate(() => {
      const vv = window.visualViewport;
      delete vv.offsetTop;
      delete vv.height;
      vv.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(150);
    r = await at();
    expect(r.transform).toBe('');
    expect(Math.abs(r.bottom - r.vh)).toBeLessThanOrEqual(2);
    expect(errs).toEqual([]);
  });
});

test.describe('V4 : musique — secours si iTunes ne répond pas', () => {

  test('iTunes en échec → la recherche bascule sur Deezer et trouve le morceau', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);
    await routeCdn(page);

    await page.route('**/itunes.apple.com/**', route => route.fulfill({
      status: 500, contentType: 'text/plain', body: 'upstream down'
    }));
    await page.route('**/api.deezer.com/**', route => {
      const cb = new URL(route.request().url()).searchParams.get('callback');
      const payload = JSON.stringify({
        data: [{
          id: 99887766, title: 'Deep Squat', duration: 30,
          artist: { name: 'The Lifters' },
          album: { title: 'Iron Age', cover_medium: 'https://cdn.example/dz.jpg' },
          preview: 'https://cdn.example/dz.mp3'
        }]
      });
      route.fulfill({
        status: 200, contentType: 'application/javascript',
        body: cb + '(' + payload + ');'
      });
    });
    const api = mockApi(page);

    await openFeed(page);
    await page.locator('#postMusicBtn').click();
    await expect(page.locator('#musicModal')).toBeVisible();
    await page.locator('#musicInput').fill('deep squat');
    await page.locator('#musicSearchBtn').click();

    await expect(page.locator('#musicList .music-row')).toHaveCount(1);
    await expect(page.locator('#musicList .music-row')).toContainText('Deep Squat');
    await expect(page.locator('#musicError')).toBeHidden();

    await page.locator('#musicList .music-row').click();
    await expect(page.locator('#musicList .music-row')).toHaveClass(/sel/);
    await page.locator('#musicUseBtn').click();
    await expect(page.locator('#musicModal')).toBeHidden();
    await expect(page.locator('#postMusicSlot .mchip-t')).toHaveText('Deep Squat');

    await page.locator('#postBody').fill('Squats with the band');
    await page.locator('#postSubmit').click();
    await expect.poll(() => api.st.posts.length).toBe(3);
    /* Deezer n'a pas de durée exploitable ? le token reste au format ancien */
    expect(api.st.posts[0].body.startsWith('Squats with the band ♪99887766')).toBe(true);

    /* on ignore les erreurs réseau provoquées volontairement par le test */
    expect(errs.filter(e => !/Failed to load resource/.test(e))).toEqual([]);
  });
});
