/* Build 82 — éditeur d'image : 11 réglages, presets + intensité, 3:4,
   flip vertical, tailles d'export, undo/redo/reset et gestes Instagram
   (appui long = original, swipe horizontal = filtre précédent/suivant).
   Les images sont générées à la volée : les assertions lisent de vrais
   pixels du canvas d'aperçu et les vraies dimensions des blobs exportés. */
const { test, expect } = require('@playwright/test');
const zlib = require('zlib');
const { seed } = require('./helpers');
const { withSocial, signedIn, consoleWatch, openFeed, mockApi } = require('./social-mock');

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
function png(w, h, fn){
  const bpp = 3;
  const raw = Buffer.alloc((w * bpp + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++){
    raw[o++] = 0;
    for (let x = 0; x < w; x++){
      const c = fn(x, y);
      raw[o++] = c[0]; raw[o++] = c[1]; raw[o++] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 1 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

/* 64x64, 4 quadrants : rouge / vert / bleu / jaune (repère de couleurs). */
const COLOR = (() => {
  const buffer = png(64, 64, (x, y) => {
    if (y < 32) return x < 32 ? [230, 30, 40] : [20, 220, 60];
    return x < 32 ? [30, 60, 230] : [240, 210, 40];
  });
  return { name: 'zones.png', mimeType: 'image/png', buffer: buffer };
})();

/* 1600x1200 : assez grand pour que les tailles d'export ne soient pas
   bridées par la source (pas d'agrandissement). */
const BIG = { name: 'big.png', mimeType: 'image/png', buffer: png(1600, 1200, (x, y) =>
  (y < 600 ? [200, 60, 60] : [40, 60, 200])) };

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
  await watchExports(page);
  await withSocial(page);
  await seed(page, {});
  await signedIn(page);
  return { errs: errs, api: mockApi(page) };
}

async function openPost(page, img){
  await openFeed(page);
  await page.setInputFiles('#postPhoto', img || COLOR);
  await expect(page.locator('#editorModal')).toBeVisible();
}

const state = page => page.evaluate(() => window.__editorState);

function setSlider(page, id, val){
  return page.evaluate(([i, v]) => {
    const n = document.getElementById(i);
    n.value = String(v);
    n.dispatchEvent(new Event('input', { bubbles: true }));
    n.dispatchEvent(new Event('change', { bubbles: true }));
  }, [id, val]);
}

/* pixel du canvas d'aperçu, en fractions de sa taille réelle */
const px = (page, fx, fy) => page.evaluate(([fx, fy]) => {
  const st = window.__editorState;
  const stage = document.getElementById('editorStage');
  const cv = document.getElementById('editorCanvas');
  const dpr = cv.width / stage.clientWidth;
  const x = Math.round((st.frame.x + st.frame.w * fx) * dpr);
  const y = Math.round((st.frame.y + st.frame.h * fy) * dpr);
  const t = document.createElement('canvas');
  t.width = t.height = 1;
  const c = t.getContext('2d', { willReadFrequently: true });
  c.drawImage(cv, x, y, 1, 1, 0, 0, 1, 1);
  const d = c.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}, [fx, fy]);

async function pointer(page, type, x, y, id){
  await page.evaluate(([t, x, y, id]) => {
    const st = document.getElementById('editorStage');
    const r = st.getBoundingClientRect();
    st.dispatchEvent(new PointerEvent(t, {
      bubbles: true, cancelable: true,
      pointerId: id, pointerType: 'touch', isPrimary: id === 1,
      clientX: r.left + x, clientY: r.top + y
    }));
  }, [type, x, y, id || 1]);
}

async function stageCenter(page){
  return page.evaluate(() => {
    const r = document.getElementById('editorStage').getBoundingClientRect();
    return { x: r.width / 2, y: r.height / 2 };
  });
}

const isGray = p => Math.abs(p[0] - p[1]) <= 8 && Math.abs(p[1] - p[2]) <= 8;

test.describe('Build 82 : éditeur d’image complet', () => {

  test('les 11 réglages sont présents et le ↺ individuel les remet à zéro', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page);

    const ids = ['Exposure','Light','Contrast','Color','Temp','Tint',
      'Shadows','Highlights','Sharp','Grain','Vignette'];
    for (const k of ids){
      await expect(page.locator('#editor' + k)).toBeVisible();
    }

    await setSlider(page, 'editorContrast', 1.35);
    await expect.poll(async () => (await state(page)).params.contrast).toBeCloseTo(1.35, 2);

    const wrap = page.locator('.editor-slider[data-p="contrast"]');
    await expect(wrap.locator('.editor-rst')).toBeVisible();
    await wrap.locator('.editor-rst').click();
    await expect.poll(async () => (await state(page)).params.contrast).toBe(1);
    await expect(wrap.locator('.editor-rst')).toBeHidden();

    expect(errs).toEqual([]);
  });

  test('presets : mono rend l’aperçu gris, Original le rétablit', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page);

    const before = await px(page, .25, .25);
    expect(before[0]).toBeGreaterThan(before[1] + 60);

    await page.locator('#editorPresets [data-preset="mono"]').click();
    await expect.poll(async () => {
      const p = await px(page, .25, .25);
      return isGray(p);
    }, { timeout: 4000 }).toBe(true);
    await expect(page.locator('#editorPresets [data-preset="mono"]'))
      .toHaveClass(/active/);

    await page.locator('#editorPresets [data-preset="none"]').click();
    await expect.poll(async () => {
      const p = await px(page, .25, .25);
      return p[0] > p[1] + 60;
    }, { timeout: 4000 }).toBe(true);

    expect(errs).toEqual([]);
  });

  test('l’intensité module le preset sans le changer', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page);
    await page.locator('#editorPresets [data-preset="mono"]').click();
    await expect.poll(async () => isGray(await px(page, .25, .25))).toBe(true);

    await setSlider(page, 'editorIntensity', 0);
    await expect.poll(async () => {
      const p = await px(page, .25, .25);
      return p[0] > p[1] + 60;
    }, { timeout: 4000 }).toBe(true);
    expect((await state(page)).preset).toBe('mono');
    expect((await state(page)).intensity).toBe(0);

    await setSlider(page, 'editorIntensity', 100);
    await expect.poll(async () => isGray(await px(page, .25, .25))).toBe(true);

    expect(errs).toEqual([]);
  });

  test('appui long sur la photo montre l’original, relâcher rétablit l’édition', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page);
    await page.locator('#editorPresets [data-preset="mono"]').click();
    await expect.poll(async () => isGray(await px(page, .25, .25))).toBe(true);

    const c = await stageCenter(page);
    await pointer(page, 'pointerdown', c.x, c.y);
    await expect.poll(async () => {
      const p = await px(page, .25, .25);
      return p[0] > p[1] + 60;
    }, { timeout: 3000 }).toBe(true);

    await pointer(page, 'pointerup', c.x, c.y);
    await expect.poll(async () => isGray(await px(page, .25, .25)), { timeout: 3000 }).toBe(true);

    expect(errs).toEqual([]);
  });

  test('swipe horizontal à zoom 1 = filtre suivant / précédent', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page);
    expect((await state(page)).preset).toBe('none');

    const c = await stageCenter(page);
    await pointer(page, 'pointerdown', c.x + 90, c.y);
    await pointer(page, 'pointermove', c.x - 60, c.y);
    await pointer(page, 'pointerup', c.x - 60, c.y);
    await expect.poll(async () => (await state(page)).preset).toBe('mono');

    await setSlider(page, 'editorZoom', 2);
    await expect.poll(async () => (await state(page)).zoom).toBeGreaterThan(1.5);
    await page.waitForTimeout(320);
    await pointer(page, 'pointerdown', c.x + 90, c.y);
    await pointer(page, 'pointermove', c.x - 60, c.y);
    await pointer(page, 'pointerup', c.x - 60, c.y);
    expect((await state(page)).preset).toBe('mono');

    expect(errs).toEqual([]);
  });

  test('un drag vertical n’est pas un swipe de filtre', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page);
    const c = await stageCenter(page);
    await pointer(page, 'pointerdown', c.x, c.y - 90);
    await pointer(page, 'pointermove', c.x + 10, c.y + 80);
    await pointer(page, 'pointerup', c.x + 10, c.y + 80);
    expect((await state(page)).preset).toBe('none');
    expect(errs).toEqual([]);
  });

  test('undo / redo / reset all', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page);

    const ul = page.locator('#editorUndo');
    const rl = page.locator('#editorRedo');
    await expect(ul).toBeDisabled();

    await setSlider(page, 'editorExposure', 40);
    await expect(ul).toBeEnabled();
    await expect.poll(async () => (await state(page)).params.exposure).toBe(40);

    await ul.click();
    await expect.poll(async () => (await state(page)).params.exposure).toBe(0);
    await expect(rl).toBeEnabled();

    await rl.click();
    await expect.poll(async () => (await state(page)).params.exposure).toBe(40);

    await page.locator('#editorPresets [data-preset="warm"]').click();
    await setSlider(page, 'editorSharp', 60);
    await page.locator('#editorResetAll').click();
    await expect.poll(async () => {
      const st = await state(page);
      return st.preset === 'none' && st.intensity === 100 &&
        st.params.exposure === 0 && st.params.sharp === 0 &&
        st.params.contrast === 1 && st.flipV === false && st.rot === 0;
    }).toBe(true);

    expect(errs).toEqual([]);
  });

  test('3:4 est disponible et cadre au bon ratio', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page);

    await page.locator('#editorAspect [data-aspect="3:4"]').click();
    await expect(page.locator('#editorAspect [data-aspect="3:4"]')).toHaveClass(/active/);
    await expect.poll(async () => (await state(page)).aspect).toBe('3:4');
    const ratio = await page.evaluate(() => {
      const st = window.__editorState;
      return st.frame.w / st.frame.h;
    });
    expect(ratio).toBeCloseTo(0.75, 2);

    expect(errs).toEqual([]);
  });

  test('flip vertical bascule le cadre sans changer de mode', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page);
    expect((await state(page)).flipV).toBe(false);
    await page.locator('#editorFlipV').click();
    await expect.poll(async () => (await state(page)).flipV).toBe(true);
    await page.locator('#editorFlipV').click();
    await expect.poll(async () => (await state(page)).flipV).toBe(false);
    expect(errs).toEqual([]);
  });

  test('les tailles d’export produisent les bonnes dimensions', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page, BIG);

    await expect(page.locator('#editorSize')).toBeVisible();
    await page.locator('#editorSize [data-size="720"]').click();
    await expect(page.locator('#editorDims')).toContainText('720');
    await page.locator('#editorUse').click();
    await expect(page.locator('#editorModal')).toBeHidden();

    await expect.poll(() => page.evaluate(() =>
      window.__exports.filter(e => e.blob && e.type === 'image/jpeg').length),
    { timeout: 4000 }).toBeGreaterThan(0);
    const shots = await page.evaluate(() =>
      window.__exports.filter(e => e.blob && e.type === 'image/jpeg').map(e => ({ w: e.w, h: e.h, t: e.blobType })));
    const big = shots[shots.length - 1];
    expect(big.t).toBe('image/jpeg');
    expect(Math.max(big.w, big.h)).toBe(720);
    expect(errs).toEqual([]);
  });

  test('fermer l’éditeur nettoie l’état sans laisser d’erreur', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page);
    await page.locator('#editorCancel').click();
    await expect(page.locator('#editorModal')).toBeHidden();
    expect(await state(page)).toBeFalsy();
    expect(errs).toEqual([]);
  });

  test('calques : ajout de texte, édition, taille, rotation, suppression', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page);

    await page.locator('#editorAddText').click();
    await expect.poll(async () => (await state(page)).layers.length).toBe(1);
    expect((await state(page)).layers[0].t).toBe('text');
    await expect(page.locator('#editorLayerBar')).toBeVisible();

    await page.locator('#editorLayerText').fill('Ciao');
    await expect.poll(async () => (await state(page)).layers[0].text).toBe('Ciao');

    await setSlider(page, 'editorLayerSize', 30);
    await expect.poll(async () => (await state(page)).layers[0].size).toBeCloseTo(.3, 2);

    await page.locator('#editorLayerRot').click();
    await expect.poll(async () => (await state(page)).layers[0].rot).toBeGreaterThan(.2);

    await page.locator('#editorUndo').click();
    await expect.poll(async () => (await state(page)).layers[0].rot).toBe(0);
    await page.locator('#editorRedo').click();
    await expect.poll(async () => (await state(page)).layers[0].rot).toBeGreaterThan(.2);

    await page.locator('#editorLayerDel').click();
    await expect.poll(async () => (await state(page)).layers.length).toBe(0);
    await expect(page.locator('#editorLayerBar')).toBeHidden();
    expect(errs).toEqual([]);
  });

  test('calque : glisser le texte le déplace, le recadrage ne bouge pas', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page);
    await page.locator('#editorAddText').click();
    await expect.poll(async () => (await state(page)).layers.length).toBe(1);

    const before = await state(page);
    const c = await stageCenter(page);
    await pointer(page, 'pointerdown', c.x, c.y);
    await pointer(page, 'pointermove', c.x + 70, c.y + 30);
    await pointer(page, 'pointerup', c.x + 70, c.y + 30);

    await expect.poll(async () => (await state(page)).layers[0].x).toBeGreaterThan(.55);
    const after = await state(page);
    expect(after.zoom).toBe(before.zoom);
    expect(after.frame).toEqual(before.frame);
    expect(after.rect).toEqual(before.rect);
    expect(errs).toEqual([]);
  });

  test('le texte est gravé dans le JPEG exporté', async ({ page }) => {
    const { errs } = await boot(page);
    await openPost(page);
    await page.locator('#editorAddText').click();
    await setSlider(page, 'editorLayerSize', 40);
    await page.locator('#editorUse').click();
    await expect(page.locator('#editorModal')).toBeHidden();

    await expect.poll(() => page.evaluate(() =>
      window.__exports.some(e => e.blob && e.type === 'image/jpeg')), { timeout: 4000 }).toBe(true);
    const white = await page.evaluate(async () => {
      const e = window.__exports.find(x => x.type === 'image/jpeg' && x.blob);
      const bmp = await createImageBitmap(e.blob);
      const c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(bmp, 0, 0);
      const d = g.getImageData(Math.floor(c.width * .35), Math.floor(c.height * .35),
        Math.ceil(c.width * .3), Math.ceil(c.height * .3)).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4){
        if (d[i] >= 235 && d[i + 1] >= 235 && d[i + 2] >= 235) n++;
      }
      return n;
    });
    expect(white).toBeGreaterThan(0);
    expect(errs).toEqual([]);
  });
});