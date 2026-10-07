/* ==================================================================
   SOCIAL - éditeur d'image (recadrage, rotation, miroir, filtres)
   Ouvert avant la publication d'une photo de post ou d'une story.
   Tout est fait en canvas : aucune requête réseau, aucun fichier
   intermédiaire sur le disque.
   ================================================================== */

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

const RATIOS = {
  'free': 0,
  '1:1': 1,
  '4:5': 0.8,
  '9:16': 9 / 16,
  '16:9': 16 / 9
};

let state = null;      /* { src, img, imgKey, maxEdge, aspect, rot, flip, zoom, tx, ty, preset, light, color } */
let onDone = null;
let dragging = false;
let lastPt = null;
let rafId = 0;

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }

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

function ratio(){
  return RATIOS[state ? state.aspect : 'free'] || 0;
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

/* Recalcule `state.img` (source filtrée) uniquement quand les couleurs
   changent : la géométrie (rotation/zoom/décalage) s'applique dessus. */
function rebuildImage(){
  if (!state || !state.src) return;
  const ops = colorOps();
  const key = ops.map(o => o[0] + ':' + o[1]).join('|');
  if (state.imgKey === key && state.img) return;
  if (!ops.length){
    state.img = state.src;
    state.imgKey = key;
    return;
  }
  const src = state.src;
  const maxWork = 2048;
  const scale = Math.min(1, maxWork / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));
  let cv = state.filterCv;
  if (!cv){ cv = document.createElement('canvas'); state.filterCv = cv; }
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  applyMatrix(imgData.data, matrixOf(ops));
  ctx.putImageData(imgData, 0, 0);
  state.img = cv;
  state.imgKey = key;
}

function stageSize(){
  const st = el('editorStage');
  const r = st ? st.getBoundingClientRect() : { width: 320, height: 320 };
  return { w: Math.max(120, Math.round(r.width)), h: Math.max(120, Math.round(r.height)) };
}

function cropBox(){
  const s = stageSize();
  const pad = 10;
  const aw = s.w - pad * 2;
  const ah = s.h - pad * 2;
  const r = ratio();
  let w = aw, h = ah;
  if (r){
    if (aw / ah > r){ h = ah; w = ah * r; }
    else { w = aw; h = aw / r; }
  }
  return { x: (s.w - w) / 2, y: (s.h - h) / 2, w: w, h: h };
}

function transformedSize(box){
  const img = state.img;
  const rot = ((state.rot % 360) + 360) % 360;
  const swapped = rot === 90 || rot === 270;
  const dw = swapped ? img.height : img.width;
  const dh = swapped ? img.width : img.height;
  const cover = Math.max(box.w / dw, box.h / dh);
  const s = cover * state.zoom;
  return { w: dw * s, h: dh * s, s: s, rot: rot };
}

function clampPan(box){
  const t = transformedSize(box);
  const maxX = Math.max(0, (t.w - box.w) / 2);
  const maxY = Math.max(0, (t.h - box.h) / 2);
  state.tx = Math.max(-maxX, Math.min(maxX, state.tx));
  state.ty = Math.max(-maxY, Math.min(maxY, state.ty));
}

function drawTo(ctx, box){
  const img = state.img;
  const t = transformedSize(box);
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.translate(box.x + box.w / 2 + state.tx, box.y + box.h / 2 + state.ty);
  ctx.rotate(t.rot * Math.PI / 180);
  ctx.scale(state.flip ? -1 : 1, 1);
  ctx.scale(t.s, t.s);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, -img.width / 2, -img.height / 2, img.width, img.height);
  ctx.restore();
}

function renderPreview(){
  if (!state) return;
  rebuildImage();
  const cv = el('editorCanvas');
  const st = el('editorStage');
  if (!cv || !st) return;
  const s = stageSize();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(s.w * dpr);
  cv.height = Math.round(s.h * dpr);
  cv.style.width = s.w + 'px';
  cv.style.height = s.h + 'px';
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#131316';
  ctx.fillRect(0, 0, s.w, s.h);

  const box = cropBox();
  clampPan(box);
  drawTo(ctx, box);

  ctx.fillStyle = 'rgba(0,0,0,.5)';
  ctx.fillRect(0, 0, s.w, box.y);
  ctx.fillRect(0, box.y + box.h, s.w, s.h - box.y - box.h);
  ctx.fillRect(0, box.y, box.x, box.h);
  ctx.fillRect(box.x + box.w, box.y, s.w - box.x - box.w, box.h);

  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(box.x + .75, box.y + .75, box.w - 1.5, box.h - 1.5);

  ctx.strokeStyle = 'rgba(255,255,255,.28)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++){
    ctx.beginPath();
    ctx.moveTo(box.x + (box.w * i) / 3, box.y);
    ctx.lineTo(box.x + (box.w * i) / 3, box.y + box.h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(box.x, box.y + (box.h * i) / 3);
    ctx.lineTo(box.x + box.w, box.y + (box.h * i) / 3);
    ctx.stroke();
  }
}

function scheduleRender(){
  if (rafId) return;
  rafId = requestAnimationFrame(() => { rafId = 0; renderPreview(); });
}

/* ------------------------------ export ---------------------------- */
function encode(canvas, mime, quality){
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) return canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode failed')), mime, quality);
    try {
      const data = canvas.toDataURL(mime, quality);
      const bin = atob(data.split(',')[1]);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      resolve(new Blob([buf], { type: mime }));
    } catch(e){ reject(e); }
  });
}

function webpOk(){
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    return c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
  } catch(e){ return false; }
}

async function exportBlob(){
  rebuildImage();
  const box = cropBox();
  const r = ratio();
  const maxEdge = state.maxEdge || 1080;
  let outW, outH;
  if (r){
    if (r >= 1){ outW = maxEdge; outH = Math.max(1, Math.round(maxEdge / r)); }
    else { outH = maxEdge; outW = Math.max(1, Math.round(maxEdge * r)); }
  } else {
    const k = maxEdge / Math.max(box.w, box.h);
    outW = Math.max(1, Math.round(box.w * k));
    outH = Math.max(1, Math.round(box.h * k));
  }

  const cv = document.createElement('canvas');
  cv.width = outW;
  cv.height = outH;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0B0B0D';
  ctx.fillRect(0, 0, outW, outH);
  ctx.setTransform(outW / box.w, 0, 0, outH / box.h, -box.x * (outW / box.w), -box.y * (outH / box.h));
  drawTo(ctx, box);
  const mime = webpOk() ? 'image/webp' : 'image/jpeg';
  const blob = await encode(cv, mime, 0.9);
  cv.width = cv.height = 0;
  return blob;
}

/* ------------------------------ état ------------------------------ */
function setAspect(k){
  if (!state || !RATIOS.hasOwnProperty(k)) return;
  state.aspect = k;
  state.tx = 0;
  state.ty = 0;
  document.querySelectorAll('#editorAspect .seg').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-aspect') === k));
  renderPreview();
}

function setPreset(k){
  if (!state) return;
  const found = PRESETS.find(p => p.k === k);
  state.preset = found ? k : 'none';
  document.querySelectorAll('#editorPresets .seg').forEach(b =>
    b.classList.toggle('active', b.getAttribute('data-preset') === state.preset));
  renderPreview();
}

function syncControls(){
  const z = el('editorZoom');
  if (z) z.value = String(state.zoom);
  const l = el('editorLight');
  if (l) l.value = String(state.light);
  const c = el('editorColor');
  if (c) c.value = String(state.color);
  setAspect(state.aspect);
  setPreset(state.preset);
}

export function openImageEditor(opts, done){
  const file = opts && opts.file;
  if (!file) return false;
  const maxEdge = (opts && opts.maxEdge) || 1080;
  const aspect = (opts && opts.aspect) || 'free';

  decode(file).then(src => {
    state = {
      src: src, img: src, imgKey: null, filterCv: null,
      maxEdge: maxEdge, aspect: RATIOS.hasOwnProperty(aspect) ? aspect : 'free',
      rot: 0, flip: false, zoom: 1, tx: 0, ty: 0, preset: 'none', light: 1, color: 1
    };
    onDone = typeof done === 'function' ? done : null;
    syncControls();
    const title = el('editorTitle');
    if (title) title.textContent = opts && opts.title ? opts.title : 'Edit photo';
    if (typeof window.openModal === 'function') window.openModal('editorModal');
    renderPreview();
    return true;
  }).catch(() => toast('Could not read that photo.'));
  return true;
}

export function closeEditor(){
  if (state){
    const s = state.src;
    if (s && typeof s.close === 'function'){
      try { s.close(); } catch(e){}
    }
    if (state.filterCv){
      try { state.filterCv.width = state.filterCv.height = 0; } catch(e){}
    }
  }
  state = null;
  onDone = null;
  dragging = false;
  if (rafId){ cancelAnimationFrame(rafId); rafId = 0; }
  if (typeof window.closeModal === 'function') window.closeModal('editorModal');
  return true;
}

export async function useEditedImage(){
  if (!state) return false;
  const btn = el('editorUse');
  if (btn){ btn.disabled = true; btn.textContent = 'Processing…'; }
  try {
    const blob = await exportBlob();
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
    stage.addEventListener('pointerdown', e => {
      if (!state) return;
      dragging = true;
      lastPt = { x: e.clientX, y: e.clientY };
      try { stage.setPointerCapture(e.pointerId); } catch(err){}
    });
    stage.addEventListener('pointermove', e => {
      if (!dragging || !state || !lastPt) return;
      state.tx += e.clientX - lastPt.x;
      state.ty += e.clientY - lastPt.y;
      lastPt = { x: e.clientX, y: e.clientY };
      scheduleRender();
    });
    const stop = () => { dragging = false; lastPt = null; };
    stage.addEventListener('pointerup', stop);
    stage.addEventListener('pointercancel', stop);
    stage.addEventListener('pointerleave', stop);
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

  const bind = (id, key, parse) => {
    const node = el(id);
    if (!node || node.dataset.wired) return;
    node.dataset.wired = '1';
    node.addEventListener('input', () => {
      if (!state) return;
      state[key] = parse(node.value);
      scheduleRender();
    });
  };
  bind('editorZoom', 'zoom', v => Math.max(1, Math.min(4, parseFloat(v) || 1)));
  bind('editorLight', 'light', v => Math.max(.7, Math.min(1.4, parseFloat(v) || 1)));
  bind('editorColor', 'color', v => Math.max(0, Math.min(2, parseFloat(v) || 1)));

  const rot = el('editorRotate');
  if (rot && !rot.dataset.wired){
    rot.dataset.wired = '1';
    rot.addEventListener('click', () => {
      if (!state) return;
      state.rot = (state.rot + 90) % 360;
      state.tx = 0;
      state.ty = 0;
      renderPreview();
    });
  }
  const flip = el('editorFlip');
  if (flip && !flip.dataset.wired){
    flip.dataset.wired = '1';
    flip.addEventListener('click', () => {
      if (!state) return;
      state.flip = !state.flip;
      state.tx = 0;
      renderPreview();
    });
  }

  window.addEventListener('resize', () => { if (state) scheduleRender(); });
}
