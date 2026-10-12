/* Chantier C — éditeur plein écran : cadre de recadrage, gestes
   (pinch / double-tap), bornes de zoom, exports par mode (post / story /
   avatar) et tenue sur petit écran. Toutes les images sont générées à la
   volée en PNG brut : chaque assertion compare des pixels connus. */
const { test, expect } = require('@playwright/test');
const zlib = require('zlib');
const { seed } = require('./helpers');
const { ME, ME_P, ANA_P, withSocial, signedIn, consoleWatch,
  openFeed, post, mockApi } = require('./social-mock');

/* ------------------------ générateurs PNG -------------------------- */
function crc32(buf){
  let table = crc32.t;
  if (!table){
    table = crc32.t = [];
    for (let n = 0; n < 256; n++){
      let c = n;
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
function png(w, h, colorType, fn){
  const bpp = colorType === 6 ? 4 : 3;
  const raw = Buffer.alloc((w * bpp + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++){
    raw[o++] = 0;
    for (let x = 0; x < w; x++){
      const c = fn(x, y);
      raw[o++] = c[0]; raw[o++] = c[1]; raw[o++] = c[2];
      if (bpp === 4) raw[o++] = c[3] === undefined ? 255 : c[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 1 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}
const file = (name, mime, buffer) => ({ name: name, mimeType: mime, buffer: buffer });

/* 64x64, 4 quadrants (rouge / vert / bleu / jaune) : repère de couleurs. */
const COLOR = file('zones.png', 'image/png', png(64, 64, 2, (x, y) => {
  if (y < 32) return x < 32 ? [230, 30, 40] : [20, 220, 60];
  return x < 32 ? [30, 60, 230] : [240, 210, 40];
}));

/* 64x64 RGBA : bordure de 8 px transparente, coteur rouge opaque.
   -> l'export doit remplir le vide de blanc (jamais de noir). */
const ALPHA = file('alpha.png', 'image/png', png(64, 64, 6, (x, y) => {
  if (x < 8 || y < 8 || x >= 56 || y >= 56) return [0, 0, 0, 0];
  return [230, 60, 60, 255];
}));

/* 3200x2400 (4:3) : blanc + barre noire de 200 px au centre (pleine
   hauteur) : c'est la mire de nettete pour l'export pleine resolution. */
const EDGE = file('edge.png', 'image/png', png(3200, 2400, 2, x =>
  (x >= 1500 && x < 1700) ? [0, 0, 0] : [255, 255, 255]));

/* deux ratios extremes pour verifier le bornage de « Original » */
const WIDE = file('wide.png', 'image/png', png(2400, 600, 2, () => [180, 180, 180]));
const TALL = file('tall.png', 'image/png', png(900, 1600, 2, () => [180, 180, 180]));

/* ---------------------------- helpers ------------------------------ */
/* Capture chaque toBlob() (aperçu 1080x1920 / 512 / 1440 et vignettes) :
   on lit ensuite le blob reel encode, pas le canvas dessine. */
async function watchExports(page){
  await page.addInitScript(() => {
    window.__exports = [];
    const orig = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function(cb, type, quality){
      const cv = this;
      const entry = { w: cv.width, h: cv.height, type: type || 'image/png' };
      window.__exports.push(entry);
      return orig.call(cv, function(b){
        if (b){ entry.blob = b; entry.blobType = b.type; }
        if (cb) cb(b);
      }, type, quality);
    };
  });
}

async function boot(page){
  const errs = consoleWatch(page);
  await withSocial(page);
  await seed(page, {});
  await signedIn(page);
  return { errs: errs, api: mockApi(page) };
}

async function openPost(page, img){
  await openFeed(page);
  await page.setInputFiles('#postPhoto', img);
  await expect(page.locator('#editorModal')).toBeVisible();
}

async function goProfile(page){
  await openFeed(page);
  await page.locator('#socialNav [data-view="profile"]').click();
  await expect(page.locator('#view-profile')).toBeVisible();
  await expect(page.locator('#profName')).toHaveText('Mouataz');
}

function setSlider(page, id, val){
  return page.evaluate(([i, v]) => {
    const n = document.getElementById(i);
    n.value = String(v);
    n.dispatchEvent(new Event('input', { bubbles: true }));
  }, [id, val]);
}

const state = page => page.evaluate(() => window.__editorState);

test.describe('C : éditeur plein écran (crop / gestes / export)', () => {

  test('le cadre occupe l’écran, canvas = client x dpr, rien n’est étiré', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page, EDGE);
    await expect(page.locator('#editorStage .crop-frame')).toBeVisible();

    const info = await page.evaluate(() => {
      const stage = document.getElementById('editorStage');
      const cv = document.getElementById('editorCanvas');
      const frame = stage.querySelector('.crop-frame');
      const st = window.__editorState;
      const ed = document.querySelector('.editor');
      const fr = frame.getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      const er = ed.getBoundingClientRect();
      return {
        dpr: Math.min(3, window.devicePixelRatio || 1),
        cw: cv.width, ch: cv.height,
        sw: stage.clientWidth, sh: stage.clientHeight,
        cssW: cv.getBoundingClientRect().width,
        cssH: cv.getBoundingClientRect().height,
        edW: er.width, edH: er.height,
        vw: window.innerWidth, vh: window.innerHeight,
        touch: stage.style.touchAction,
        aspect: st.aspect,
        frameRatio: fr.width / fr.height,
        imgRatio: st.iw / st.ih,
        inStage: fr.left >= sr.left - 1 && fr.right <= sr.right + 1 &&
                 fr.top >= sr.top - 1 && fr.bottom <= sr.bottom + 1
      };
    });
    expect(info.touch).toBe('none');
    /* canvas en pixels reels, jamais redimensionne par le CSS
       (±1 px : clientHeight est arrondi, getBoundingClientRect ne l'est pas) */
    expect(info.cw).toBe(Math.round(info.sw * info.dpr));
    expect(info.ch).toBe(Math.round(info.sh * info.dpr));
    expect(Math.abs(info.cssW - info.sw)).toBeLessThanOrEqual(1);
    expect(Math.abs(info.cssH - info.sh)).toBeLessThanOrEqual(1);
    /* l'éditeur couvre bien la fenetre */
    expect(Math.abs(info.edW - info.vw)).toBeLessThanOrEqual(2);
    expect(Math.abs(info.edH - info.vh)).toBeLessThanOrEqual(2);
    /* « Original » = ratio exact de l'image, cadre dans le stage */
    expect(info.aspect).toBe('free');
    expect(Math.abs(info.frameRatio - info.imgRatio)).toBeLessThan(0.02);
    expect(info.inStage).toBe(true);
    expect(errs).toEqual([]);
  });

  test('le pinch zoome centré sur les doigts, le double-tap alterne ×2', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page, EDGE);

    await setSlider(page, 'editorZoom', 2);
    expect((await state(page)).zoom).toBeCloseTo(2, 2);

    const res = await page.evaluate(() => {
      const stage = document.getElementById('editorStage');
      const sr = stage.getBoundingClientRect();
      const s0 = window.__editorState;
      /* ancrage hors centre : le point sous les doigts ne doit pas bouger */
      const P = { x: s0.frame.x + s0.frame.w * 0.35, y: s0.frame.y + s0.frame.h * 0.45 };
      const read = () => {
        const s = window.__editorState;
        const sc = s.frame.w / s.rect.w;
        return {
          zoom: s.zoom,
          ix: s.rect.x + (P.x - s.frame.x) / sc,
          iy: s.rect.y + (P.y - s.frame.y) / sc,
          sc: sc
        };
      };
      const fire = (type, id, x, y) => stage.dispatchEvent(new PointerEvent(type, {
        pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true,
        pointerType: 'touch'
      }));
      const x = sr.left + P.x, y = sr.top + P.y;
      const before = read();
      fire('pointerdown', 1, x - 50, y);
      fire('pointerdown', 2, x + 50, y);
      fire('pointermove', 1, x - 75, y);
      fire('pointermove', 2, x + 75, y);
      const after = read();
      fire('pointerup', 1, x - 75, y);
      fire('pointerup', 2, x + 75, y);
      return { before: before, after: after };
    });

    /* doigts 100 -> 150 px : zoom x1,5 depuis 2 */
    expect(res.after.zoom).toBeCloseTo(3, 1);
    expect(Math.abs(res.after.ix - res.before.ix) * res.after.sc).toBeLessThanOrEqual(2);
    expect(Math.abs(res.after.iy - res.before.iy) * res.after.sc).toBeLessThanOrEqual(2);
    /* le curseur suit le geste */
    expect(await page.evaluate(() => +document.getElementById('editorZoom').value))
      .toBeCloseTo(3, 4);

    /* double-tap : x3 -> retour au dpart -> x2 */
    await page.waitForTimeout(320);
    const taps = await page.evaluate(() => {
      const stage = document.getElementById('editorStage');
      const r = stage.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      const tap = () => ['pointerdown', 'pointerup'].forEach(t =>
        stage.dispatchEvent(new PointerEvent(t, {
          pointerId: 9, clientX: x, clientY: y, bubbles: true, cancelable: true,
          pointerType: 'touch'
        })));
      const z0 = window.__editorState.zoom;
      tap(); tap();
      const z1 = window.__editorState.zoom;
      tap(); tap();
      return { z0: z0, z1: z1, z2: window.__editorState.zoom };
    });
    expect(taps.z0).toBeCloseTo(3, 4);
    expect(taps.z1).toBe(1);
    expect(taps.z2).toBe(2);
    expect(errs).toEqual([]);
  });

  test('après zoom ×3 et un grand glissement, la vue reste dans l’image', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page, EDGE);
    await setSlider(page, 'editorZoom', 3);
    expect((await state(page)).zoom).toBeCloseTo(3, 2);

    /* glissement volontairement extreme : le cadre ne doit jamais
       montrer du vide (l'image couvre toujours les 4 coins) */
    await page.evaluate(() => {
      const stage = document.getElementById('editorStage');
      const r = stage.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const fire = (type, x, y) => stage.dispatchEvent(new PointerEvent(type, {
        pointerId: 7, clientX: x, clientY: y, bubbles: true, cancelable: true,
        pointerType: 'touch'
      }));
      fire('pointerdown', cx, cy);
      fire('pointermove', cx + 1500, cy + 1500);
      fire('pointermove', cx + 6000, cy - 6000);
      fire('pointerup', cx + 6000, cy - 6000);
    });

    const info = await page.evaluate(() => {
      const st = window.__editorState;
      const cv = document.getElementById('editorCanvas');
      const stage = document.getElementById('editorStage');
      const k = stage.clientWidth ? cv.width / stage.clientWidth : 1;
      const tmp = document.createElement('canvas');
      tmp.width = cv.width; tmp.height = cv.height;
      const g = tmp.getContext('2d', { willReadFrequently: true });
      g.drawImage(cv, 0, 0);
      const px = (x, y) => {
        const cx = Math.max(0, Math.min(cv.width - 1, Math.round(x * k)));
        const cy = Math.max(0, Math.min(cv.height - 1, Math.round(y * k)));
        return g.getImageData(cx, cy, 1, 1).data[3];
      };
      const f = st.frame;
      return {
        st: st,
        alphas: [px(f.x + 2, f.y + 2), px(f.x + f.w - 2, f.y + 2),
                 px(f.x + 2, f.y + f.h - 2), px(f.x + f.w - 2, f.y + f.h - 2)]
      };
    });
    const r = info.st.rect;
    expect(r.x).toBeGreaterThanOrEqual(-0.5);
    expect(r.y).toBeGreaterThanOrEqual(-0.5);
    expect(r.x + r.w).toBeLessThanOrEqual(info.st.iw + 0.5);
    expect(r.y + r.h).toBeLessThanOrEqual(info.st.ih + 0.5);
    expect(info.alphas).toEqual([255, 255, 255, 255]);
    expect(errs).toEqual([]);
  });

  test('l’export d’un post est un JPEG plein axe sur fond blanc', async ({ page }) => {
    await watchExports(page);
    const { errs } = await boot(page);
    await openPost(page, ALPHA);
    await page.locator('#editorUse').click();
    await expect(page.locator('#editorModal')).toBeHidden();
    await expect(page.locator('#postPreview')).toBeVisible();

    const out = await page.evaluate(async () => {
      const e = window.__exports && window.__exports[0];
      if (!e || !e.blob) return null;
      const bmp = await createImageBitmap(e.blob);
      const cv = document.createElement('canvas');
      cv.width = bmp.width; cv.height = bmp.height;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const at = (x, y) =>
        Array.from(g.getImageData(x, y, 1, 1).data);
      return {
        w: bmp.width, h: bmp.height, type: e.type, blobType: e.blobType,
        corners: [at(1, 1), at(bmp.width - 2, 1),
                  at(1, bmp.height - 2), at(bmp.width - 2, bmp.height - 2)],
        center: at(Math.floor(bmp.width / 2), Math.floor(bmp.height / 2)),
        count: window.__exports.length
      };
    });
    expect(out).toBeTruthy();
    expect(out.type).toBe('image/jpeg');
    expect(out.blobType).toBe('image/jpeg');
    expect(out.w).toBeLessThanOrEqual(1440);
    expect(out.h).toBeLessThanOrEqual(1440);
    expect(out.w).toBe(out.h);                 /* image carree + « Original » */
    /* PNG transparent -> blanc, jamais de noir */
    out.corners.forEach(c => {
      expect(c[0]).toBeGreaterThanOrEqual(248);
      expect(c[1]).toBeGreaterThanOrEqual(248);
      expect(c[2]).toBeGreaterThanOrEqual(248);
    });
    /* …mais le contenu est bien la (centre rouge opaque) */
    expect(out.center[0]).toBeGreaterThan(190);
    expect(out.center[1]).toBeLessThan(120);
    expect(out.center[2]).toBeLessThan(120);
    expect(errs).toEqual([]);
  });

  test('l’export de la photo de profil fait 512 × 512 (masque rond)', async ({ page }) => {
    await watchExports(page);
    const { errs } = await boot(page);
    await goProfile(page);
    await page.locator('#editProfileBtn').click();
    await expect(page.locator('#profileModal')).toBeVisible();
    await page.locator('#editAvatarFile').setInputFiles(COLOR);
    await expect(page.locator('#editorModal')).toBeVisible();

    await expect(page.locator('#editorTitle')).toHaveText('Profile photo');
    await expect(page.locator('#editorAspect [data-aspect="1:1"]')).not.toHaveClass(/hidden/);
    await expect(page.locator('#editorAspect [data-aspect="free"]')).toHaveClass(/hidden/);
    await expect(page.locator('#editorStage .crop-frame')).toHaveClass(/round/);

    await page.locator('#editorUse').click();
    await expect(page.locator('#editorModal')).toBeHidden();
    await expect(page.locator('#editAvatarPreview img')).toBeVisible();

    const out = await page.evaluate(() => {
      const e = window.__exports && window.__exports[0];
      return e ? { w: e.w, h: e.h, type: e.type, blobType: e.blobType } : null;
    });
    expect(out).toEqual({ w: 512, h: 512, type: 'image/jpeg', blobType: 'image/jpeg' });
    expect(errs).toEqual([]);
  });

  test('une story s’exporte en 1080 × 1920 et Mono garde les bords nets', async ({ page }) => {
    test.slow();
    await watchExports(page);
    const { errs } = await boot(page);
    await openFeed(page);
    await page.evaluate(() => window.openStoryComposer());
    await expect(page.locator('#storyModal')).toBeVisible();

    const lastStory = () => page.evaluate(() => {
      const a = window.__exports || [];
      for (let i = a.length - 1; i >= 0; i--)
        if (a[i].w === 1080 && a[i].h === 1920) return i;
      return -1;
    });
    /* metrique de nettete d'une seule ligne : largeur du passage
       blanc -> noir de la barre centrale (plus c'est dur, mieux c'est) */
    const metrics = i => page.evaluate(async idx => {
      const e = window.__exports[idx];
      const bmp = await createImageBitmap(e.blob);
      const cv = document.createElement('canvas');
      cv.width = bmp.width; cv.height = bmp.height;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const y = Math.floor(cv.height / 2);
      const row = g.getImageData(0, y, cv.width, 1).data;
      const v = [];
      for (let x = 0; x < cv.width; x++)
        v.push(Math.round(0.299 * row[x * 4] + 0.587 * row[x * 4 + 1] + 0.114 * row[x * 4 + 2]));
      let maxD = 0;
      for (let x = 1; x < v.length; x++) maxD = Math.max(maxD, Math.abs(v[x] - v[x - 1]));
      const mid = Math.floor(v.length / 2);
      const peak = (a, b) => {
        let bi = a + 1, bd = -1;
        for (let x = a + 1; x < b; x++){
          const d = Math.abs(v[x] - v[x - 1]);
          if (d > bd){ bd = d; bi = x; }
        }
        return bi;
      };
      const e1 = peak(2, mid), e2 = peak(mid, v.length - 2);
      let soft = 0;
      [e1, e2].forEach(p => {
        for (let x = p - 12; x <= p + 12; x++){
          if (x < 0 || x >= v.length) continue;
          if (v[x] > 25 && v[x] < 230) soft++;
        }
      });
      return { w: cv.width, h: cv.height, type: e.type, maxD: maxD, soft: soft,
               gap: e2 - e1 };
    }, i);

    /* run A : Original (aucun filtre) */
    await page.setInputFiles('#storyPhoto', EDGE);
    await expect(page.locator('#editorModal')).toBeVisible();
    await expect(page.locator('#editorAspect [data-aspect="9:16"]')).not.toHaveClass(/hidden/);
    await page.locator('#editorUse').click();
    await expect(page.locator('#editorModal')).toBeHidden();
    await expect(page.locator('#storyStageImg')).toBeVisible();
    const ia = await lastStory();
    expect(ia).toBeGreaterThanOrEqual(0);
    const A = await metrics(ia);
    expect(A.w).toBe(1080);
    expect(A.h).toBe(1920);
    expect(A.type).toBe('image/jpeg');
    expect(A.maxD).toBeGreaterThanOrEqual(40);          /* bord reel */
    expect(A.gap).toBeGreaterThan(145);                 /* barre de 160 px */
    expect(A.gap).toBeLessThan(175);

    /* run B : meme source, preset Mono au moment de l'export */
    await page.setInputFiles('#storyPhoto', EDGE);
    await expect(page.locator('#editorModal')).toBeVisible();
    await page.locator('#editorPresets [data-preset="mono"]').click();
    await page.locator('#editorUse').click();
    await expect(page.locator('#editorModal')).toBeHidden();
    await expect(page.locator('#storyStageImg')).toBeVisible();
    const ib = await lastStory();
    expect(ib).toBeGreaterThan(ia);
    const B = await metrics(ib);
    expect(B.w).toBe(1080);
    expect(B.h).toBe(1920);
    expect(B.type).toBe('image/jpeg');
    expect(B.gap).toBeCloseTo(A.gap, 0);
    /* le filtre part de la meme pleine resolution : pas d'adoucissement */
    expect(B.soft).toBeLessThanOrEqual(A.soft + 4);
    expect(B.maxD).toBeGreaterThanOrEqual(A.maxD * 0.5);
    expect(errs).toEqual([]);
  });

  test('chaque mode n’offre que ses ratios (et son masque rond)', async ({ page }) => {
    const { errs } = await boot(page);

    /* post : Original / 1:1 / 4:5 / 16:9, pas de 9:16, pas de rond */
    await openPost(page, COLOR);
    await expect(page.locator('#editorTitle')).toHaveText('Edit photo');
    await expect(page.locator('#editorAspect [data-aspect="free"]')).not.toHaveClass(/hidden/);
    await expect(page.locator('#editorAspect [data-aspect="16:9"]')).not.toHaveClass(/hidden/);
    await expect(page.locator('#editorAspect [data-aspect="9:16"]')).toHaveClass(/hidden/);
    await expect(page.locator('#editorStage .crop-frame')).not.toHaveClass(/round/);
    await page.locator('#editorCancel').click();
    await expect(page.locator('#editorModal')).toBeHidden();

    /* story : 9:16 seul */
    await openFeed(page);
    await page.evaluate(() => window.openStoryComposer());
    await expect(page.locator('#storyModal')).toBeVisible();
    await page.setInputFiles('#storyPhoto', COLOR);
    await expect(page.locator('#editorModal')).toBeVisible();
    await expect(page.locator('#editorTitle')).toHaveText('Edit story photo');
    await expect(page.locator('#editorAspect [data-aspect="9:16"]')).not.toHaveClass(/hidden/);
    await expect(page.locator('#editorAspect [data-aspect="free"]')).toHaveClass(/hidden/);
    await expect(page.locator('#editorAspect [data-aspect="1:1"]')).toHaveClass(/hidden/);
    await expect(page.locator('#editorStage .crop-frame')).not.toHaveClass(/round/);
    await page.locator('#editorCancel').click();
    await expect(page.locator('#editorModal')).toBeHidden();
    await page.evaluate(() => window.closeModal('storyModal'));

    /* avatar : 1:1 seul + masque rond */
    await goProfile(page);
    await page.locator('#editProfileBtn').click();
    await expect(page.locator('#profileModal')).toBeVisible();
    await page.locator('#editAvatarFile').setInputFiles(COLOR);
    await expect(page.locator('#editorModal')).toBeVisible();
    await expect(page.locator('#editorTitle')).toHaveText('Profile photo');
    await expect(page.locator('#editorAspect [data-aspect="1:1"]')).not.toHaveClass(/hidden/);
    await expect(page.locator('#editorAspect [data-aspect="free"]')).toHaveClass(/hidden/);
    await expect(page.locator('#editorStage .crop-frame')).toHaveClass(/round/);
    expect(errs).toEqual([]);
  });

  test('« Original » reste borné entre 4:5 et ~2:1', async ({ page }) => {
    const { errs } = await boot(page);

    await openPost(page, WIDE);                    /* 4:1 -> plafonne a 1.91 */
    const wide = await page.evaluate(() => {
      const st = window.__editorState;
      return { aspect: st.aspect, ratio: st.frame.w / st.frame.h };
    });
    expect(wide.aspect).toBe('free');
    expect(wide.ratio).toBeCloseTo(1.91, 1);
    await page.locator('#editorCancel').click();
    await expect(page.locator('#editorModal')).toBeHidden();

    await openPost(page, TALL);                    /* 9:16 -> plafonne a 0.8 */
    const tall = await page.evaluate(() => {
      const st = window.__editorState;
      return { aspect: st.aspect, ratio: st.frame.w / st.frame.h };
    });
    expect(tall.aspect).toBe('free');
    expect(tall.ratio).toBeCloseTo(0.8, 1);
    expect(errs).toEqual([]);
  });

  test('un format non supporté affiche un message clair', async ({ page }) => {
    const { errs } = await boot(page);
    await openFeed(page);
    await page.setInputFiles('#postPhoto', {
      name: 'photo.heic', mimeType: 'image/heic', buffer: Buffer.from('not an image')
    });

    await expect(page.locator('#toast'))
      .toContainText("This format isn't supported — choose a JPEG or PNG.");
    await expect(page.locator('#editorModal')).toBeHidden();
    await expect(page.locator('#postPreview')).toBeHidden();
    /* le refus de decodage ne doit pas polluer la console */
    expect(errs.filter(e => !/Failed to load resource/i.test(e))).toEqual([]);
  });

  test('sur un petit écran (375 px), l’éditeur reste conforme et ne déborde pas', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page, EDGE);

    await page.setViewportSize({ width: 375, height: 667 });
    /* le ResizeObserver du crop doit reprendre la nouvelle taille */
    await expect.poll(() => page.evaluate(() => {
      const cv = document.getElementById('editorCanvas');
      const st = document.getElementById('editorStage');
      const d = Math.min(3, window.devicePixelRatio || 1);
      return cv.width === Math.round(st.clientWidth * d) &&
             cv.height === Math.round(st.clientHeight * d);
    }), { timeout: 3000 }).toBe(true);

    const info = await page.evaluate(() => {
      const ed = document.querySelector('.editor');
      const stage = document.getElementById('editorStage');
      const fr = stage.querySelector('.crop-frame').getBoundingClientRect();
      const sr = stage.getBoundingClientRect();
      const st = window.__editorState;
      const cv = document.getElementById('editorCanvas');
      return {
        edScroll: ed.scrollWidth, edClient: ed.clientWidth,
        stageW: stage.clientWidth, stageH: stage.clientHeight,
        cvDelta: cv.getBoundingClientRect().width - stage.clientWidth,
        inStage: fr.left >= sr.left - 1 && fr.right <= sr.right + 1 &&
                 fr.top >= sr.top - 1 && fr.bottom <= sr.bottom + 1,
        ratio: fr.width / fr.height, imgRatio: st.iw / st.ih
      };
    });
    expect(info.stageW).toBeGreaterThan(200);
    expect(info.stageH).toBeGreaterThan(150);
    expect(info.edScroll).toBeLessThanOrEqual(375);
    expect(Math.abs(info.cvDelta)).toBeLessThanOrEqual(1);
    expect(info.inStage).toBe(true);
    expect(Math.abs(info.ratio - info.imgRatio)).toBeLessThan(0.02);
    expect(errs).toEqual([]);
  });

  test('après un changement de photo, l’avatar se met à jour partout', async ({ page }) => {
    const errs = consoleWatch(page);
    await withSocial(page);
    await seed(page, {});
    await signedIn(page);

    const AV = 'https://demo-project.supabase.co/storage/v1/object/public/avatars/' +
      ME.id + '/avatar-old.jpg';
    const api = mockApi(page, {
      posts: [post(0, ME.id, { author: { id: ME.id, username: 'mouataz',
        display_name: 'Mouataz', avatar_url: AV } })],
      people: [{ ...ME_P, avatar_url: AV }, ANA_P]
    });

    await goProfile(page);
    await page.locator('#editProfileBtn').click();
    await expect(page.locator('#profileModal')).toBeVisible();
    await page.locator('#editAvatarFile').setInputFiles(COLOR);
    await expect(page.locator('#editorModal')).toBeVisible();
    await page.locator('#editorUse').click();
    await expect(page.locator('#editorModal')).toBeHidden();
    await expect(page.locator('#editAvatarPreview img')).toBeVisible();
    await page.locator('#profileSubmit').click();
    await expect(page.locator('#profileModal')).toBeHidden();

    /* profil : la nouvelle photo s'affiche avec un cache-buster */
    const prof = await page.locator('#profAvatarBtn img').getAttribute('src');
    expect(prof).toContain('avatar-');
    expect(prof).toContain('?v=');

    /* en base : URL propre, sans `?v=` */
    const patch = api.calls.find(c => c.method === 'PATCH' &&
      c.url.includes('/rest/v1/profiles'));
    expect(patch).toBeTruthy();
    expect(JSON.parse(patch.body).avatar_url).not.toContain('?');

    /* fil deja rendu : rafraichi sans rechargement de page (renderFeed
       re-peint avec l'URL de base, puis le bust ajoute ?v=) */
    await expect(page.locator('#feedList .post-avatar-img').first())
      .toHaveAttribute('src', /\?v=/);
    expect(errs).toEqual([]);
  });
});
