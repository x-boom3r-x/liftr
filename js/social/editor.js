/* ==================================================================
   SOCIAL - éditeur d'image : crop + zoom (js/lib/cropper.js), réglages
   (11 curseurs), filtres avec intensité, historique undo/redo et
   comparaison avant/après. Trois modes :
     post   : ratios Original / 1:1 / 4:5 / 3:4 / 16:9, taille
              d'export Small / Medium / Large (≤ 1440 px), JPEG
     story  : 9:16 imposé, export 1080 x 1920
     avatar : 1:1 + masque rond, export 512 x 512
   Tout se passe en canvas : aucune requête réseau, aucun fichier
   intermédiaire sur le disque. Safari ne supporte pas `ctx.filter` :
   tous les effets sont calculés au pixel (matrice 3x4 + passes
   ombres/hautes lumières, netteté, vignettage, grain).

   Résolutions : l'aperçu travaille sur une copie bornée (2048 px, ou
   1280 px dès qu'un effet par pixel est actif) recalculée au plus une
   fois par frame (rAF) ; l'export repart de la source pleine
   résolution (4096 px max) et rend sur fond blanc en JPEG.
   ================================================================== */

import { createCropper } from '../lib/cropper.js';
import { dragToDismiss } from '../gestures.js';

/* Filtres définis comme une chaîne d'opérations (matrice 3x4) appliquées
   au pixel + paramètres additionnels (vignette, grain, ombres…).
   `ops` est mis à l'échelle par l'intensité (0-100 %) au moment du
   rendu ; à 100 % les opérations restent identiques bit à bit. */
const PRESETS = [
  { k: 'none',    label: 'Original',  ops: [],                                                        params: {} },
  { k: 'mono',    label: 'Mono',      ops: [['gray', 1], ['contrast', 1.06]],                          params: {} },
  { k: 'warm',    label: 'Warm',      ops: [['sepia', .22], ['sat', 1.35], ['hue', -6]],               params: { temp: 22, vignette: 8 } },
  { k: 'cool',    label: 'Cool',      ops: [['sat', 1.12], ['hue', 10], ['bright', 1.03]],             params: { temp: -34 } },
  { k: 'vintage', label: 'Vintage',   ops: [['sepia', .34], ['sat', .78], ['contrast', .9]],           params: { vignette: 26, grain: 18, highlights: -12 } },
  { k: 'cine',    label: 'Cinematic', ops: [['contrast', 1.14], ['sat', .94], ['hue', -3]],            params: { temp: 14, tint: -10, shadows: 16, vignette: 16 } },
  { k: 'fade',    label: 'Fade',      ops: [['contrast', .9], ['bright', 1.07], ['sat', .85]],         params: { shadows: 34, highlights: -8 } },
  { k: 'drama',   label: 'Dramatic',  ops: [['contrast', 1.24], ['sat', 1.12]],                       params: { shadows: -18, vignette: 34, grain: 8, exposure: -4 } }
];

const RATIOS = { '1:1': 1, '4:5': .8, '3:4': .75, '9:16': 9 / 16, '16:9': 16 / 9 };

const POST_MIN = .8;        /* un post reste « portrait » ou « paysage » */
const POST_MAX = 1.91;
const WORK_MAX = 2048;      /* copie de travail filtrée (aperçu) */
const FX_MAX = 1280;        /* aperçu réduit quand netteté/grain sont actifs */
const FULL_MAX = 4096;      /* source bornée + export pleine résolution */
const HIST_MAX = 60;        /* instantanés d'historique conservés */

/* Curseurs de réglage (paramètres manuels du preset courant). */
const PARAMS = [
  { k: 'exposure',   id: 'editorExposure',   label: 'Exposure',   min: -100, max: 100, step: 1,   def: 0 },
  { k: 'light',      id: 'editorLight',      label: 'Brightness', min: .7,   max: 1.4, step: .01, def: 1 },
  { k: 'contrast',   id: 'editorContrast',   label: 'Contrast',   min: .5,   max: 1.5, step: .01, def: 1 },
  { k: 'color',      id: 'editorColor',      label: 'Saturation', min: 0,    max: 2,   step: .02, def: 1 },
  { k: 'temp',       id: 'editorTemp',       label: 'Temp',       min: -100, max: 100, step: 1,   def: 0 },
  { k: 'tint',       id: 'editorTint',       label: 'Tint',       min: -100, max: 100, step: 1,   def: 0 },
  { k: 'shadows',    id: 'editorShadows',    label: 'Shadows',    min: -100, max: 100, step: 1,   def: 0 },
  { k: 'highlights', id: 'editorHighlights', label: 'Highlights', min: -100, max: 100, step: 1,   def: 0 },
  { k: 'sharp',      id: 'editorSharp',      label: 'Sharpness',  min: 0,    max: 100, step: 1,   def: 0 },
  { k: 'grain',      id: 'editorGrain',      label: 'Grain',      min: 0,    max: 100, step: 1,   def: 0 },
  { k: 'vignette',   id: 'editorVignette',   label: 'Vignette',   min: 0,    max: 100, step: 1,   def: 0 }
];

function defaultParams(){
  const p = {};
  PARAMS.forEach(x => { p[x.k] = x.def; });
  return p;
}

const MODES = {
  post: {
    ratios: ['free', '1:1', '4:5', '3:4', '16:9'], def: 'free', round: false,
    export: { maxSide: 1440, quality: .9 }
  },
  story: {
    ratios: ['9:16'], def: '9:16', round: false,
    export: { width: 1080, height: 1920, quality: .9 }
  },
  avatar: {
    ratios: ['1:1'], def: '1:1', round: true,
    export: { width: 512, height: 512, quality: .9 }
  }
};

const UNSUPPORTED = "This format isn't supported — choose a JPEG or PNG.";

/* state : { mode, src, work, workKey, aspect, freeAspect, preset,
             intensity, params, size, workRaf, exportCv,
             hist, histI } */
let state = null;
let onDone = null;
let crop = null;
let comparing = false;
let commitT = 0;
let cmpWinWired = false;
let scratch = null;

/* gestes éditeur (façon Instagram) : appui long = original,
   swipe horizontal à zoom 1 = filtre précédent/suivant */
const HOLD_MS = 380, HOLD_SLOP = 10, SWIPE_MIN = 56;
let gId = -1, gX = 0, gY = 0, gT = 0, gHeld = false, gSwiped = false;

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function dispose(cv){
  try { if (cv && typeof cv.width === 'number' && cv.width) cv.width = cv.height = 0; } catch(e){}
}

function decode(file){
  if (typeof createImageBitmap === 'function'){
    return createImageBitmap(file, { imageOrientation: 'from-image' })
      .catch(() => createImageBitmap(file));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { setTimeout(() => URL.revokeObjectURL(url), 0); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

/* Une source unique, bornée à FULL_MAX : iOS plafonne les canvas ~16 Mpx
   et l'export pleine résolution doit partir de quelque chose de prévisible. */
function decodeBounded(file){
  return decode(file).then(bmp => {
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    if (!w || !h){ if (bmp.close) bmp.close(); throw new Error('empty image'); }
    const k = Math.min(1, FULL_MAX / Math.max(w, h));
    if (k >= 1) return bmp;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * k));
    c.height = Math.max(1, Math.round(h * k));
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    if (bmp.close) bmp.close();
    return c;
  });
}

/* --------------------- filtres au pixel (matrice) ------------------ */
const LUM = [.2126, .7152, .0722];

function opMatrix(op, k){
  const m = [1,0,0, 0,1,0, 0,0,1, 0,0,0];
  if (op === 'bright'){
    m[0] = m[4] = m[8] = k;
  } else if (op === 'contrast'){
    const b = 127.5 * (1 - k);
    m[0] = m[4] = m[8] = k;
    m[9] = m[10] = m[11] = b;
  } else if (op === 'sat'){
    const l = LUM;
    m[0] = l[0] + (1 - l[0]) * k; m[1] = -l[1] * k;              m[2] = -l[2] * k;
    m[3] = -l[0] * k;              m[4] = l[1] + (1 - l[1]) * k; m[5] = -l[2] * k;
    m[6] = -l[0] * k;              m[7] = -l[1] * k;              m[8] = l[2] + (1 - l[2]) * k;
  } else if (op === 'gray'){
    const l = LUM;
    m[0] = 1 - k + l[0] * k; m[1] = l[1] * k;        m[2] = l[2] * k;
    m[3] = l[0] * k;         m[4] = 1 - k + l[1] * k; m[5] = l[2] * k;
    m[6] = l[0] * k;         m[7] = l[1] * k;         m[8] = 1 - k + l[2] * k;
  } else if (op === 'sepia'){
    const s = [.393,.769,.189, .349,.686,.168, .272,.534,.131];
    m[0] = 1 - k + s[0] * k; m[1] = s[1] * k;        m[2] = s[2] * k;
    m[3] = s[3] * k;         m[4] = 1 - k + s[4] * k; m[5] = s[5] * k;
    m[6] = s[6] * k;         m[7] = s[7] * k;         m[8] = 1 - k + s[8] * k;
  } else if (op === 'hue'){
    const a = k * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    m[0] = .213 + c * .787 - s * .213; m[1] = .715 - c * .715 - s * .715; m[2] = .072 - c * .072 + s * .928;
    m[3] = .213 - c * .213 + s * .143; m[4] = .715 + c * .285 + s * .140; m[5] = .072 - c * .072 - s * .283;
    m[6] = .213 - c * .213 - s * .787; m[7] = .715 - c * .715 + s * .715; m[8] = .072 + c * .928 + s * .072;
  } else if (op === 'temp'){
    m[0] = 1 + 0.0022 * k; m[4] = 1 + 0.0004 * k; m[8] = 1 - 0.0022 * k;
  } else if (op === 'tint'){
    m[0] = 1 + 0.0007 * k; m[4] = 1 - 0.0018 * k; m[8] = 1 + 0.0007 * k;
  }
  return m;
}

/* compose : on applique `acc` puis `next` (ordre de la chaîne) */
function compose(next, acc){
  const out = new Array(12);
  for (let r = 0; r < 3; r++){
    for (let c = 0; c < 3; c++){
      out[r * 3 + c] = next[r * 3] * acc[c] + next[r * 3 + 1] * acc[3 + c] + next[r * 3 + 2] * acc[6 + c];
    }
    out[9 + r] = next[r * 3] * acc[9] + next[r * 3 + 1] * acc[10] + next[r * 3 + 2] * acc[11] + next[9 + r];
  }
  return out;
}

function matrixOf(ops){
  let m = [1,0,0, 0,1,0, 0,0,1, 0,0,0];
  for (let i = 0; i < ops.length; i++) m = compose(opMatrix(ops[i][0], ops[i][1]), m);
  return m;
}

function applyMatrix(data, m){
  const m0 = m[0], m1 = m[1], m2 = m[2], m3 = m[3], m4 = m[4], m5 = m[5],
        m6 = m[6], m7 = m[7], m8 = m[8], b0 = m[9], b1 = m[10], b2 = m[11];
  for (let i = 0; i < data.length; i += 4){
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const nr = m0 * r + m1 * g + m2 * b + b0;
    const ng = m3 * r + m4 * g + m5 * b + b1;
    const nb = m6 * r + m7 * g + m8 * b + b2;
    data[i]     = nr < 0 ? 0 : (nr > 255 ? 255 : nr);
    data[i + 1] = ng < 0 ? 0 : (ng > 255 ? 255 : ng);
    data[i + 2] = nb < 0 ? 0 : (nb > 255 ? 255 : nb);
  }
}

/* ------------------- passes additionnelles (au pixel) --------------- */
function mulberry32(a){
  return function(){
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function applyTone(data, shadows, highlights){
  const sa = shadows / 100, ha = highlights / 100;
  for (let i = 0; i < data.length; i += 4){
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const l = (LUM[0] * r + LUM[1] * g + LUM[2] * b) / 255;
    let f = 1;
    if (sa){
      const w = (1 - l) * (1 - l);
      f *= 1 + sa * 1.15 * w;
    }
    if (ha){
      const w = l * l;
      f *= 1 + ha * 0.75 * w;
    }
    if (f !== 1){
      if (f < 0) f = 0;
      data[i] = r * f; data[i + 1] = g * f; data[i + 2] = b * f;
    }
  }
}

function applySharp(data, w, h, amt){
  if (!amt || w < 3 || h < 3) return;
  const n = data.length;
  if (!scratch || scratch.length < n) scratch = new Uint8ClampedArray(n);
  scratch.set(data);
  const cw = 1 + 4 * amt, ce = -amt;
  for (let y = 1; y < h - 1; y++){
    for (let x = 1; x < w - 1; x++){
      const i = (y * w + x) * 4, up = i - w * 4, dn = i + w * 4, lf = i - 4, rt = i + 4;
      for (let c = 0; c < 3; c++){
        const v = scratch[i + c] * cw + (scratch[up + c] + scratch[dn + c] + scratch[lf + c] + scratch[rt + c]) * ce;
        data[i + c] = v;
      }
    }
  }
}

function applyFinish(data, w, h, vig, grain){
  const cx = w / 2, cy = h / 2, mr = Math.sqrt(cx * cx + cy * cy) || 1;
  const rnd = grain ? mulberry32(0x9E3779B9) : null;
  const amp = grain * 46;
  for (let y = 0; y < h; y++){
    const dy = y - cy;
    for (let x = 0; x < w; x++){
      const i = (y * w + x) * 4;
      if (vig){
        const dx = x - cx;
        const r = Math.sqrt(dx * dx + dy * dy) / mr;
        let t = (r - .42) / .58;
        t = t < 0 ? 0 : (t > 1 ? 1 : t);
        const f = 1 - vig * .78 * t * t;
        if (f < 1){ data[i] *= f; data[i + 1] *= f; data[i + 2] *= f; }
      }
      if (rnd){
        const nz = (rnd() - .5) * 2 * amp;
        data[i] += nz; data[i + 1] += nz; data[i + 2] += nz;
      }
    }
  }
}

/* -------------------------- combinaison ---------------------------- */
function currentPreset(){
  return (state && PRESETS.find(p => p.k === state.preset)) || PRESETS[0];
}

function intensityT(){
  return state ? state.intensity / 100 : 1;
}

function scaleOp(op, t){
  if (t === 1) return op;
  const v = op[1];
  if (op[0] === 'bright' || op[0] === 'contrast' || op[0] === 'sat') return [op[0], 1 + (v - 1) * t];
  return [op[0], v * t];
}

function colorOps(){
  if (!state) return [];
  const t = intensityT();
  const preset = currentPreset();
  const pp = preset.params || {};
  const ops = preset.ops.map(o => scaleOp(o, t));
  const p = state.params;
  const exposure = p.exposure + (pp.exposure || 0) * t;
  const temp = p.temp + (pp.temp || 0) * t;
  const tint = p.tint + (pp.tint || 0) * t;
  if (exposure) ops.push(['bright', Math.pow(2, exposure / 100)]);
  if (p.light !== 1) ops.push(['bright', p.light]);
  if (temp) ops.push(['temp', temp]);
  if (tint) ops.push(['tint', tint]);
  if (p.contrast !== 1) ops.push(['contrast', p.contrast]);
  if (p.color !== 1) ops.push(['sat', p.color]);
  return ops;
}

function finishParams(){
  if (!state) return { shadows: 0, highlights: 0, sharp: 0, grain: 0, vignette: 0 };
  const p = state.params, t = intensityT(), pp = currentPreset().params || {};
  return {
    shadows: p.shadows + (pp.shadows || 0) * t,
    highlights: p.highlights + (pp.highlights || 0) * t,
    sharp: p.sharp,
    grain: p.grain + (pp.grain || 0) * t,
    vignette: p.vignette + (pp.vignette || 0) * t
  };
}

function workMax(){
  const f = finishParams();
  return (f.sharp || f.grain) ? FX_MAX : WORK_MAX;
}

/* Filtre `src` dans un canvas borné à `maxSide` (alpha conservé) :
   matrice de couleur, puis ombres/hautes lumières, netteté, vignettage
   et grain. Sans aucun effet : on renvoie la source telle quelle. */
function applyPipeline(src, maxSide){
  if (!state) return src;
  const ops = colorOps();
  const fin = finishParams();
  const hasFx = !!(fin.shadows || fin.highlights || fin.sharp || fin.grain || fin.vignette);
  if (!ops.length && !hasFx) return src;
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  if (!sw || !sh) return src;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  if (ops.length) applyMatrix(d, matrixOf(ops));
  if (fin.shadows || fin.highlights) applyTone(d, fin.shadows, fin.highlights);
  if (fin.sharp) applySharp(d, w, h, fin.sharp / 100 * .9);
  if (fin.vignette || fin.grain) applyFinish(d, w, h, fin.vignette / 100, fin.grain / 100);
  g.putImageData(img, 0, 0);
  return cv;
}

/* Copie de travail : au plus un recalcul par frame pendant qu'on tire
   sur un curseur / un preset (jamais en pleine résolution). */
function refreshWork(){
  if (!state || !crop) return;
  const ops = colorOps();
  const fin = finishParams();
  const max = workMax();
  const key = [ops.map(o => o[0] + ':' + o[1]).join('|'),
               fin.shadows, fin.highlights, fin.sharp, fin.grain, fin.vignette, max].join(';');
  if (state.workKey === key && state.work) return;
  const next = applyPipeline(state.src, max);
  const prev = state.work;
  state.work = next;
  state.workKey = key;
  if (!comparing) crop.setSource(next);
  if (prev && prev !== state.src && prev !== next) dispose(prev);
}

function scheduleWorkFilter(){
  if (!state || state.workRaf) return;
  state.workRaf = requestAnimationFrame(() => {
    if (!state) return;
    state.workRaf = 0;
    refreshWork();
  });
}

/* ------------------------------ état ------------------------------ */
function aspectValue(k){
  if (!state) return null;
  if (k === 'free') return state.freeAspect;
  return RATIOS.hasOwnProperty(k) ? RATIOS[k] : state.freeAspect;
}

function applyModeChips(){
  const ratios = state ? MODES[state.mode].ratios : [];
  document.querySelectorAll('#editorAspect .seg').forEach(b =>
    b.classList.toggle('hidden', ratios.indexOf(b.getAttribute('data-aspect')) < 0));
}

function setAspectUI(k){
  document.querySelectorAll('#editorAspect .seg').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-aspect') === k));
}

function setAspect(k){
  if (!state || !crop) return;
  if (k === 'free'){
    if (MODES[state.mode].ratios.indexOf('free') < 0) return;
  } else if (!RATIOS.hasOwnProperty(k)) return;
  state.aspect = k;
  setAspectUI(k);
  crop.setAspect(aspectValue(k), { round: !!MODES[state.mode].round });
  commit();
}

function setPreset(k){
  if (!state) return;
  const found = PRESETS.find(p => p.k === k);
  state.preset = found ? k : 'none';
  document.querySelectorAll('#editorPresets .seg').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-preset') === state.preset));
  scheduleWorkFilter();
  commit();
}

/* `window.__editorState` : copie plane, lecture seule, pour les tests
   (géométrie du cadre/visible sans toucher à l'implémentation). */
function emitState(s){
  if (!state || !crop){ window.__editorState = null; return; }
  const st = s || crop.getState();
  const r = st.rect;
  window.__editorState = Object.freeze({
    zoom: st.zoom,
    rect: r ? { x: r.x, y: r.y, w: r.w, h: r.h } : null,
    frame: { x: st.frame.x, y: st.frame.y, w: st.frame.w, h: st.frame.h },
    iw: st.iw, ih: st.ih, rot: st.rot, flip: st.flip, flipV: !!st.flipV,
    aspect: state.aspect,
    round: !!MODES[state.mode].round,
    mode: state.mode,
    preset: state.preset,
    intensity: state.intensity,
    size: state.size,
    params: Object.assign({}, state.params),
    canUndo: state.histI > 0,
    canRedo: state.histI < state.hist.length - 1
  });
  updateDims(st);
}

function onCropChange(s){
  const z = el('editorZoom');
  if (z) z.value = String(s.zoom);
  emitState(s);
}

function updateDims(st){
  const d = el('editorDims');
  if (!d || !state) return;
  const e = MODES[state.mode].export;
  let w, h;
  if (e.width && e.height){
    w = e.width; h = e.height;
  } else {
    const r = (st && st.rect) || (crop && crop.getState().rect) || { w: 1, h: 1 };
    const max = (state.mode === 'post' && state.size) ? state.size : e.maxSide;
    const k = Math.min(1, max / Math.max(r.w, r.h));
    w = Math.max(1, Math.round(r.w * k));
    h = Math.max(1, Math.round(r.h * k));
  }
  const txt = w + ' × ' + h;
  if (d.textContent !== txt) d.textContent = txt;
}

function syncControls(){
  if (!state) return;
  setAspectUI(state.aspect);
  const z = el('editorZoom');
  if (z && crop) z.value = String(crop.getZoom());
  PARAMS.forEach(p => {
    const inp = el(p.id);
    if (!inp) return;
    inp.value = String(state.params[p.k]);
    const wrap = inp.closest('.editor-slider');
    const rst = wrap ? wrap.querySelector('.editor-rst') : null;
    if (rst) rst.classList.toggle('hidden', Math.abs(state.params[p.k] - p.def) < 1e-9);
  });
  const ii = el('editorIntensity');
  if (ii) ii.value = String(state.intensity);
  document.querySelectorAll('#editorPresets .seg').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-preset') === state.preset));
  document.querySelectorAll('#editorSize .seg').forEach(b =>
    b.classList.toggle('active', parseInt(b.getAttribute('data-size'), 10) === state.size));
  updateDims();
}

function syncHistoryBtns(){
  const u = el('editorUndo'), r = el('editorRedo');
  if (u) u.disabled = !state || state.histI <= 0;
  if (r) r.disabled = !state || state.histI >= (state ? state.hist.length - 1 : 0);
}

/* ---------------------------- historique --------------------------- */
function snap(){
  return {
    aspect: state.aspect,
    preset: state.preset,
    intensity: state.intensity,
    params: Object.assign({}, state.params),
    size: state.size,
    crop: crop ? crop.view() : null
  };
}

function commit(){
  if (commitT){ clearTimeout(commitT); commitT = 0; }
  if (!state || !crop) return;
  const s = snap();
  const h = state.hist;
  const prev = h[state.histI];
  if (prev && JSON.stringify(prev) === JSON.stringify(s)) return;
  h.length = state.histI + 1;
  h.push(s);
  while (h.length > HIST_MAX) h.shift();
  state.histI = h.length - 1;
  syncHistoryBtns();
}

function scheduleCommit(ms){
  if (!state) return;
  if (commitT) clearTimeout(commitT);
  commitT = setTimeout(() => {
    commitT = 0;
    commit();
  }, ms || 350);
}

function applySnap(s){
  if (!state || !crop || !s) return;
  state.aspect = s.aspect;
  state.preset = s.preset;
  state.intensity = s.intensity;
  state.params = Object.assign({}, s.params);
  if (s.size != null) state.size = s.size;
  setAspectUI(s.aspect);
  crop.setAspect(aspectValue(s.aspect), { round: !!MODES[state.mode].round });
  if (s.crop) crop.setView(s.crop);
  syncControls();
  refreshWork();
  emitState();
}

export function editorUndo(){
  if (!state || !crop || state.histI <= 0) return false;
  state.histI--;
  applySnap(state.hist[state.histI]);
  syncHistoryBtns();
  return true;
}

export function editorRedo(){
  if (!state || !crop || state.histI >= state.hist.length - 1) return false;
  state.histI++;
  applySnap(state.hist[state.histI]);
  syncHistoryBtns();
  return true;
}

export function editorResetAll(){
  if (!state || !crop || !state.hist.length) return false;
  state.histI = 0;
  applySnap(state.hist[0]);
  syncHistoryBtns();
  return true;
}

/* --------------------------- comparaison --------------------------- */
function compareOn(){
  if (!state || !crop || comparing) return;
  comparing = true;
  crop.setSource(state.src);
}

function compareOff(){
  if (!comparing) return;
  comparing = false;
  if (!state || !crop) return;
  crop.setSource(state.work || state.src);
}

/* Appui long sur la photo = aperçu de l'original (relâche = retour).
   Swipe horizontal, seulement à zoom 1 (sinon c'est le pan du crop),
   = filtre suivant/précédent, un pas par geste. */
function stepPreset(dir){
  if (!state) return;
  const n = PRESETS.length;
  let i = PRESETS.findIndex(p => p.k === state.preset);
  if (i < 0) i = 0;
  setPreset(PRESETS[((i + dir) % n + n) % n].k);
}

function clearHold(){
  if (gT){ clearTimeout(gT); gT = 0; }
}

function stageDown(e){
  if (!state || !crop) return;
  if (gId !== -1 || e.isPrimary === false){
    clearHold();
    gHeld = false;
    return;
  }
  gId = e.pointerId;
  gX = e.clientX; gY = e.clientY;
  gHeld = false; gSwiped = false;
  clearHold();
  gT = setTimeout(() => {
    gT = 0;
    if (!state || gId === -1 || gHeld) return;
    gHeld = true;
    compareOn();
  }, HOLD_MS);
}

function stageMove(e){
  if (e.pointerId !== gId || !state) return;
  const dx = e.clientX - gX, dy = e.clientY - gY;
  if (!gHeld && gT && dx * dx + dy * dy > HOLD_SLOP * HOLD_SLOP) clearHold();
  if (gHeld || gSwiped || !crop) return;
  if (crop.getZoom() > 1.001) return;
  if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) <= Math.abs(dy) * 1.5) return;
  gSwiped = true;
  clearHold();
  stepPreset(dx < 0 ? 1 : -1);
}

function stageUp(e){
  if (e.pointerId !== undefined && e.pointerId !== gId) return;
  clearHold();
  if (gHeld){ gHeld = false; compareOff(); }
  gId = -1;
}

function endStageGesture(){
  clearHold();
  if (gHeld){ gHeld = false; compareOff(); }
  gId = -1;
}

/* ------------------------------ export ---------------------------- */
async function encodeJpeg(cv, quality){
  const q = quality || .9;
  const blob = await new Promise((res, rej) => {
    try { cv.toBlob(b => b ? res(b) : rej(new Error('encode failed')), 'image/jpeg', q); }
    catch(e){ rej(e); }
  });
  if (blob && blob.type === 'image/jpeg') return blob;
  /* Safari renvoie parfois un PNG quand on demande un JPEG : on repasse
     par dataURL, sinon on jette (le toast prévient l'utilisateur). */
  const data = cv.toDataURL('image/jpeg', q);
  const bin = atob(data.split(',')[1]);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: 'image/jpeg' });
}

async function exportEdited(){
  if (!state || !crop) throw new Error('editor closed');
  const mode = MODES[state.mode];
  const full = applyPipeline(state.src, FULL_MAX);
  crop.setSource(full);                 // la vue est reportée sur la nouvelle résolution
  if (full !== state.src){
    if (state.exportCv && state.exportCv !== state.src) dispose(state.exportCv);
    state.exportCv = full;
  }
  const e = mode.export;
  const st = crop.getState();
  const r = st.rect || { w: 1, h: 1 };
  let w, h;
  if (e.width && e.height){ w = e.width; h = e.height; }
  else {
    const max = (state.mode === 'post' && state.size) ? state.size : e.maxSide;
    const k = Math.min(1, max / Math.max(r.w, r.h));
    w = Math.max(1, Math.round(r.w * k));
    h = Math.max(1, Math.round(r.h * k));
  }
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.fillStyle = '#FFFFFF';              /* PNG transparent -> blanc (pas de noir) */
  g.fillRect(0, 0, w, h);
  crop.drawTo(g, w, h);
  const out = await encodeJpeg(cv, e.quality);
  dispose(cv);
  return out;
}

/* ------------------------------ ouverture ------------------------- */
export function openImageEditor(opts, done){
  const file = opts && opts.file;
  if (!file) return false;
  const modeKey = (opts && MODES[opts.mode]) ? opts.mode : 'post';
  const title = opts && opts.title ? opts.title : 'Edit photo';
  if (state) closeEditor();
  decodeBounded(file)
    .then(src => openWith(src, modeKey, title, done))
    .catch(() => toast(UNSUPPORTED));
  return true;
}

async function openWith(src, modeKey, title, done){
  const mode = MODES[modeKey];
  const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
  state = {
    mode: modeKey, src: src, work: src, workKey: null,
    aspect: mode.def, freeAspect: Math.min(POST_MAX, Math.max(POST_MIN, w / h)),
    preset: 'none', intensity: 100, params: defaultParams(),
    size: modeKey === 'post' ? 1440 : null,
    workRaf: 0, exportCv: null, hist: [], histI: 0
  };
  comparing = false;
  onDone = typeof done === 'function' ? done : null;
  const t = el('editorTitle');
  if (t) t.textContent = title;
  if (typeof window.openModal !== 'function'){ state = null; onDone = null; return false; }
  window.openModal('editorModal');                 /* le stage est dimensionné avant le cropper */

  const stage = el('editorStage');
  crop = createCropper(stage, { aspect: aspectValue(state.aspect), round: mode.round });
  try {
    await crop.load(src);
  } catch(e){
    crop.destroy(); crop = null; state = null; onDone = null;
    window.__editorState = null;
    if (typeof window.closeModal === 'function') window.closeModal('editorModal');
    toast(UNSUPPORTED);
    return false;
  }
  if (!state){ crop.destroy(); crop = null; return false; }   /* fermé pendant le chargement */
  applyModeChips();
  const srow = el('editorSize');
  if (srow) srow.classList.toggle('hidden', modeKey !== 'post');
  crop.onChange(onCropChange);
  state.hist = [snap()];
  state.histI = 0;
  syncHistoryBtns();
  syncControls();
  emitState();
  return true;
}

export function closeEditor(){
  if (state){
    if (state.workRaf){ cancelAnimationFrame(state.workRaf); state.workRaf = 0; }
    if (commitT){ clearTimeout(commitT); commitT = 0; }
    if (crop){ try { crop.destroy(); } catch(e){} crop = null; }
    const work = state.work;
    if (work && work !== state.src) dispose(work);
    if (state.exportCv && state.exportCv !== state.src) dispose(state.exportCv);
    const s = state.src;
    /* la source n'est libérée qu'ici : rotate()/mirror() en ont besoin. */
    if (s && typeof s.close === 'function'){ try { s.close(); } catch(e){} }
    else if (s && s.tagName === 'CANVAS') dispose(s);
  }
  state = null;
  onDone = null;
  comparing = false;
  window.__editorState = null;
  if (typeof window.closeModal === 'function') window.closeModal('editorModal');
  return true;
}

export async function useEditedImage(){
  if (!state || !crop) return false;
  const btn = el('editorUse');
  if (btn){ btn.disabled = true; btn.textContent = 'Processing…'; }
  try {
    const blob = await exportEdited();
    const cb = onDone;
    closeEditor();
    if (cb) cb(blob);
    return true;
  } catch(e){
    toast('Could not export that photo.');
    return false;
  } finally {
    if (btn){ btn.disabled = false; btn.textContent = 'Use photo'; }
  }
}

export function initEditor(){
  const stage = el('editorStage');
  if (stage && !stage.dataset.wired){
    stage.dataset.wired = '1';
    /* iOS : le pinch natif (gesture*) ferait zoommer la page sous le crop. */
    const stopGestures = e => { if (e && e.cancelable) e.preventDefault(); };
    ['gesturestart','gesturechange','gestureend'].forEach(t =>
      stage.addEventListener(t, stopGestures, { passive: false }));
    /* fin de geste = un pas d'historique (coalescé, jamais par frame) */
    stage.addEventListener('pointerup', () => scheduleCommit(400));
    stage.addEventListener('pointercancel', () => scheduleCommit(400));
    stage.addEventListener('wheel', () => scheduleCommit(400), { passive: true });
    /* gestes Instagram (compare / filtre) greffés sur le même stage */
    stage.addEventListener('pointerdown', stageDown);
    stage.addEventListener('pointermove', stageMove);
    stage.addEventListener('pointerup', stageUp);
    stage.addEventListener('pointercancel', stageUp);
    if (!cmpWinWired){
      cmpWinWired = true;
      window.addEventListener('pointerup', endStageGesture);
      window.addEventListener('pointercancel', endStageGesture);
    }
  }

  /* chantier E : swipe bas depuis l'en-tête = annuler (ferme l'éditeur). */
  const modal = document.getElementById('editorModal');
  const top = document.querySelector('.editor-top');
  if (modal && top && !top.dataset.gestures){
    top.dataset.gestures = '1';
    dragToDismiss(modal, {
      handle: top,
      close: () => { if (typeof window.closeEditor === 'function') window.closeEditor(); },
    });
  }

  const presets = el('editorPresets');
  if (presets && !presets.dataset.wired){
    presets.dataset.wired = '1';
    presets.addEventListener('click', e => {
      const b = e.target && e.target.closest && e.target.closest('[data-preset]');
      if (b) setPreset(b.getAttribute('data-preset'));
    });
  }

  const aspects = el('editorAspect');
  if (aspects && !aspects.dataset.wired){
    aspects.dataset.wired = '1';
    aspects.addEventListener('click', e => {
      const b = e.target && e.target.closest && e.target.closest('[data-aspect]');
      if (b) setAspect(b.getAttribute('data-aspect'));
    });
  }

  const zoom = el('editorZoom');
  if (zoom && !zoom.dataset.wired){
    zoom.dataset.wired = '1';
    zoom.addEventListener('input', () => {
      if (!crop) return;
      crop.setZoom(Math.max(1, Math.min(5, parseFloat(zoom.value) || 1)));
    });
    zoom.addEventListener('change', () => { if (state) commit(); });
  }

  PARAMS.forEach(p => {
    const inp = el(p.id);
    if (!inp || inp.dataset.wired) return;
    inp.dataset.wired = '1';
    const wrap = inp.closest('.editor-slider');
    const rst = wrap ? wrap.querySelector('.editor-rst') : null;
    inp.addEventListener('input', () => {
      if (!state) return;
      let v = parseFloat(inp.value);
      if (isNaN(v)) v = p.def;
      state.params[p.k] = Math.max(p.min, Math.min(p.max, v));
      if (rst) rst.classList.toggle('hidden', Math.abs(state.params[p.k] - p.def) < 1e-9);
      scheduleWorkFilter();
    });
    inp.addEventListener('change', () => { if (state) commit(); });
    if (rst) rst.addEventListener('click', () => {
      if (!state) return;
      state.params[p.k] = p.def;
      inp.value = String(p.def);
      rst.classList.add('hidden');
      scheduleWorkFilter();
      commit();
    });
  });

  const intensity = el('editorIntensity');
  if (intensity && !intensity.dataset.wired){
    intensity.dataset.wired = '1';
    intensity.addEventListener('input', () => {
      if (!state) return;
      state.intensity = Math.max(0, Math.min(100, parseInt(intensity.value, 10) || 0));
      scheduleWorkFilter();
    });
    intensity.addEventListener('change', () => { if (state) commit(); });
  }

  const sizeRow = el('editorSize');
  if (sizeRow && !sizeRow.dataset.wired){
    sizeRow.dataset.wired = '1';
    sizeRow.addEventListener('click', e => {
      const b = e.target && e.target.closest && e.target.closest('[data-size]');
      if (!b || !state) return;
      const n = parseInt(b.getAttribute('data-size'), 10);
      if (!n) return;
      state.size = n;
      sizeRow.querySelectorAll('.seg').forEach(x => x.classList.toggle('active', x === b));
      updateDims();
      commit();
    });
  }

  const rot = el('editorRotate');
  if (rot && !rot.dataset.wired){
    rot.dataset.wired = '1';
    rot.addEventListener('click', () => { if (crop){ crop.rotate(); commit(); } });
  }
  const flip = el('editorFlip');
  if (flip && !flip.dataset.wired){
    flip.dataset.wired = '1';
    flip.addEventListener('click', () => { if (crop){ crop.mirror(); commit(); } });
  }
  const flipV = el('editorFlipV');
  if (flipV && !flipV.dataset.wired){
    flipV.dataset.wired = '1';
    flipV.addEventListener('click', () => { if (crop){ crop.mirrorV(); commit(); } });
  }
}
