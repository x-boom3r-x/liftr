/* ==================================================================
   SOCIAL - éditeur d'image : crop + zoom (js/lib/cropper.js), filtres
   au pixel, rotation et miroir. Trois modes :
     post   : ratios Original / 1:1 / 4:5 / 16:9, export JPEG ≤ 1440 px
     story  : 9:16 imposé, export 1080 x 1920
     avatar : 1:1 + masque rond, export 512 x 512
   Tout se passe en canvas : aucune requête réseau, aucun fichier
   intermédiaire sur le disque.

   Résolutions : l'aperçu travaille sur une copie bornée (2048 px)
   recalculée au plus une fois par frame (rAF) ; l'export repart de la
   source pleine résolution (4096 px max) et rend sur fond blanc en JPEG.
   Le recadrage n'est jamais redessiné depuis la copie basse résolution.
   ================================================================== */

import { createCropper } from '../lib/cropper.js';
import { dragToDismiss } from '../gestures.js';

/* Filtres définis comme une chaîne d'opérations (matrice 3x4) appliquées
   au pixel : Safari ne supporte pas `ctx.filter`, donc aucun effet canvas
   filtre ne fonctionnerait sur iPhone. On fait le calcul nous-mêmes. */
const PRESETS = [
  { k: 'none',  label: 'Original', ops: [] },
  { k: 'mono',  label: 'Mono',     ops: [['gray', 1], ['contrast', 1.06]] },
  { k: 'warm',  label: 'Warm',     ops: [['sepia', .22], ['sat', 1.35], ['hue', -6]] },
  { k: 'cool',  label: 'Cool',     ops: [['sat', 1.12], ['hue', 10], ['bright', 1.03]] },
  { k: 'fade',  label: 'Fade',     ops: [['contrast', .9], ['bright', 1.07], ['sat', .85]] },
  { k: 'vivid', label: 'Vivid',    ops: [['sat', 1.55], ['contrast', 1.08]] }
];

const RATIOS = { '1:1': 1, '4:5': .8, '9:16': 9 / 16, '16:9': 16 / 9 };

const POST_MIN = .8;        /* un post reste « portrait » ou « paysage » */
const POST_MAX = 1.91;
const WORK_MAX = 2048;      /* copie de travail filtrée (aperçu) */
const FULL_MAX = 4096;      /* source bornée + export pleine résolution */

const MODES = {
  post: {
    ratios: ['free', '1:1', '4:5', '16:9'], def: 'free', round: false,
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

/* state : { mode, src, work, workKey, aspect, freeAspect,
             preset, light, color, workRaf, exportCv } */
let state = null;
let onDone = null;
let crop = null;

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

function colorOps(){
  if (!state) return [];
  const preset = PRESETS.find(p => p.k === state.preset) || PRESETS[0];
  const ops = preset.ops.slice();
  if (state.light !== 1) ops.push(['bright', state.light]);
  if (state.color !== 1) ops.push(['sat', state.color]);
  return ops;
}

/* Filtre `src` dans un canvas borné à `maxSide` (alpha conservé).
   Sans opération : on renvoie la source telle quelle. */
function applyOps(src, ops, maxSide){
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  if (!sw || !sh || !ops.length) return src;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  const data = g.getImageData(0, 0, w, h);
  applyMatrix(data.data, matrixOf(ops));
  g.putImageData(data, 0, 0);
  return cv;
}

/* Copie de travail : au plus un recalcul par frame pendant qu'on tire
   sur un curseur / un preset (jamais en pleine résolution). */
function refreshWork(){
  if (!state || !crop) return;
  const ops = colorOps();
  const key = ops.map(o => o[0] + ':' + o[1]).join('|');
  if (state.workKey === key && state.work) return;
  const next = applyOps(state.src, ops, WORK_MAX);
  const prev = state.work;
  state.work = next;
  state.workKey = key;
  crop.setSource(next);                 // no-op si identique à la source courante
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

function setAspect(k){
  if (!state || !crop) return;
  if (k === 'free'){
    if (MODES[state.mode].ratios.indexOf('free') < 0) return;
  } else if (!RATIOS.hasOwnProperty(k)) return;
  state.aspect = k;
  document.querySelectorAll('#editorAspect .seg').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-aspect') === k));
  crop.setAspect(aspectValue(k), { round: !!MODES[state.mode].round });
}

function setPreset(k){
  if (!state) return;
  const found = PRESETS.find(p => p.k === k);
  state.preset = found ? k : 'none';
  document.querySelectorAll('#editorPresets .seg').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-preset') === state.preset));
  scheduleWorkFilter();
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
    iw: st.iw, ih: st.ih, rot: st.rot, flip: st.flip,
    aspect: state.aspect,
    round: !!MODES[state.mode].round,
    mode: state.mode
  });
}

function onCropChange(s){
  const z = el('editorZoom');
  if (z) z.value = String(s.zoom);
  emitState(s);
}

function syncControls(){
  setAspect(state.aspect);
  const z = el('editorZoom');
  if (z && crop) z.value = String(crop.getZoom());
  const l = el('editorLight');
  if (l) l.value = String(state.light);
  const c = el('editorColor');
  if (c) c.value = String(state.color);
  document.querySelectorAll('#editorPresets .seg').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-preset') === state.preset));
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
  const full = applyOps(state.src, colorOps(), FULL_MAX);
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
    const k = Math.min(1, e.maxSide / Math.max(r.w, r.h));
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
    preset: 'none', light: 1, color: 1, workRaf: 0, exportCv: null
  };
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
  crop.onChange(onCropChange);
  syncControls();
  emitState();
  return true;
}

export function closeEditor(){
  if (state){
    if (state.workRaf){ cancelAnimationFrame(state.workRaf); state.workRaf = 0; }
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
  }

  const slider = (id, key, min, max) => {
    const node = el(id);
    if (!node || node.dataset.wired) return;
    node.dataset.wired = '1';
    node.addEventListener('input', () => {
      if (!state) return;
      state[key] = Math.max(min, Math.min(max, parseFloat(node.value) || 1));
      scheduleWorkFilter();
    });
  };
  slider('editorLight', 'light', .7, 1.4);
  slider('editorColor', 'color', 0, 2);

  const rot = el('editorRotate');
  if (rot && !rot.dataset.wired){
    rot.dataset.wired = '1';
    rot.addEventListener('click', () => { if (crop) crop.rotate(); });
  }
  const flip = el('editorFlip');
  if (flip && !flip.dataset.wired){
    flip.dataset.wired = '1';
    flip.addEventListener('click', () => { if (crop) crop.mirror(); });
  }
}
