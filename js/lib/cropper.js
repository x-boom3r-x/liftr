/* ==================================================================
   cropper.js — crop + zoom pour posts, stories et photo de profil.

   Ce que ça fait (et que l'éditeur actuel ne fait pas) :
     - cadre de recadrage VISIBLE (ratio fixe, grille des tiers, masque rond)
     - déplacement au doigt, PINCH à deux doigts (zoom centré sur les doigts),
       molette (desktop), double-tap = zoom x2 / retour
     - l'image couvre TOUJOURS le cadre : impossible de voir du vide
     - rotation 90° et miroir
     - canvas de preview dimensionné en pixels réels (clientWidth x dpr) :
       jamais étiré par le CSS (la preview n'est plus déformée sur petit écran)

   Ajout par rapport au patch : `setSource()` — remplacer la source sans
   perdre la vue (le zoom/centre est reporté en coordonnées normalisées).
   C'est ce qui permet à l'éditeur de basculer entre la copie de travail
   filtrée (2048 px) et la pleine résolution à l'export.

   L'export n'est PAS ici : js/social/editor.js dessine le recadrage dans
   son propre canvas (fond blanc, JPEG plein axe) via `drawTo()`.

   Usage :
     const c = createCropper(document.getElementById('editorStage'),
                             { aspect: 4/5 });           // 1, 4/5, 9/16, 16/9, null = ratio d'origine
     await c.load(file);                                  // File | Blob | <img> | ImageBitmap
     c.setSource(otherCanvas);                            // même vue, autre résolution
     zoomSlider.oninput = () => c.setZoom(+zoomSlider.value);
     c.onChange(s => { zoomSlider.value = s.zoom; });
     c.drawTo(ctx, w, h);                                 // recadrage courant -> (0,0,w,h)
     ================================================================== */

const MAX_BASE = 4096;           // côté max du bitmap de travail (mémoire iOS)
const MARGIN = 16;               // marge stage -> cadre
const MAX_ZOOM = 5;

export function createCropper(stage, options = {}) {
  let aspect = options.aspect ?? null;       // null = ratio de l'image
  let round = !!options.round;
  const dprFn = () => Math.min(3, window.devicePixelRatio || 1);

  // --- DOM ---------------------------------------------------------
  let canvas = stage.querySelector('canvas');
  if (!canvas) { canvas = document.createElement('canvas'); stage.appendChild(canvas); }
  const ctx = canvas.getContext('2d');
  const frameEl = document.createElement('div');
  frameEl.className = 'crop-frame' + (round ? ' round' : '');
  stage.appendChild(frameEl);

  // --- état --------------------------------------------------------
  let source = null;                         // bitmap/img d'origine (borné à MAX_BASE)
  let rot = 0, flip = false;                 // rot = quarts de tour
  let base = null;                           // canvas tourné/miroité
  let zoom = 1, cx = 0, cy = 0;              // zoom relatif + centre dans `base` (px)
  let W = 0, H = 0, frame = { x: 0, y: 0, w: 1, h: 1 };
  const listeners = new Set();
  const pointers = new Map();
  let lastTap = 0;

  // --- géométrie ---------------------------------------------------
  const iw = () => (base ? base.width : 1);
  const ih = () => (base ? base.height : 1);
  const minScale = () => Math.max(frame.w / iw(), frame.h / ih());     // px écran / px image à zoom 1
  const scale = () => minScale() * zoom;

  function computeFrame() {
    W = stage.clientWidth; H = stage.clientHeight;
    const a = aspect || (iw() / ih());
    const availW = Math.max(40, W - 2 * MARGIN), availH = Math.max(40, H - 2 * MARGIN);
    let fw = availW, fh = fw / a;
    if (fh > availH) { fh = availH; fw = fh * a; }
    frame = { x: (W - fw) / 2, y: (H - fh) / 2, w: fw, h: fh };
    Object.assign(frameEl.style, {
      left: frame.x + 'px', top: frame.y + 'px', width: frame.w + 'px', height: frame.h + 'px',
    });
  }

  function clamp() {
    zoom = Math.min(MAX_ZOOM, Math.max(1, zoom));
    const s = scale(), hw = frame.w / (2 * s), hh = frame.h / (2 * s);
    cx = Math.min(iw() - hw, Math.max(hw, cx));
    cy = Math.min(ih() - hh, Math.max(hh, cy));
  }

  function rect() {                           // zone de `base` visible dans le cadre
    const s = scale();
    return { x: cx - frame.w / (2 * s), y: cy - frame.h / (2 * s), w: frame.w / s, h: frame.h / s };
  }

  function emit() {
    const st = getState();
    listeners.forEach(fn => { try { fn(st); } catch (_) {} });
  }

  // --- rendu -------------------------------------------------------
  function sizeCanvas() {
    const d = dprFn(), w = Math.round(W * d), h = Math.round(H * d);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  }
  function render() {
    if (!base) return;
    sizeCanvas();
    const d = dprFn(), s = scale();
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingQuality = 'high';
    const dx = frame.x + frame.w / 2 - cx * s, dy = frame.y + frame.h / 2 - cy * s;
    ctx.drawImage(base, dx, dy, iw() * s, ih() * s);
  }
  function update() { computeFrame(); clamp(); render(); emit(); }

  function buildBase() {
    if (!source) return;
    const sw = source.width, sh = source.height, odd = rot % 2 === 1;
    const bw = odd ? sh : sw, bh = odd ? sw : sh;
    const c = document.createElement('canvas'); c.width = bw; c.height = bh;
    const g = c.getContext('2d');
    g.translate(bw / 2, bh / 2);
    g.rotate(rot * Math.PI / 2);
    if (flip) g.scale(-1, 1);
    g.drawImage(source, -sw / 2, -sh / 2);
    base = c;
  }

  // --- API ---------------------------------------------------------
  async function load(src) {
    let bmp;
    if (src instanceof Blob) {
      // imageOrientation:'from-image' applique l'EXIF (photos iPhone portrait)
      bmp = await createImageBitmap(src, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(src));
    } else if (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap) bmp = src;
    else bmp = src;                                       // HTMLImageElement / canvas
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    const k = Math.min(1, MAX_BASE / Math.max(w, h));
    if (k < 1) {                                           // borne mémoire
      const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); source = c;
    } else if (bmp instanceof HTMLCanvasElement || (typeof ImageBitmap !== 'undefined' && bmp instanceof ImageBitmap)) {
      source = bmp;
    } else {
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(bmp, 0, 0); source = c;
    }
    rot = 0; flip = false; zoom = 1;
    buildBase(); cx = iw() / 2; cy = ih() / 2;
    update();
  }

  /* Remplace la source (copie filtrée <-> pleine résolution) en gardant la
     vue : cx/cy sont reportés par le rapport de taille des deux sources. */
  function setSource(next) {
    if (!next || next === source) return false;
    const ow = source ? (source.width || source.naturalWidth) : 0;
    const oh = source ? (source.height || source.naturalHeight) : 0;
    source = next;
    buildBase();
    if (ow && oh) { cx = cx * (iw() / ow); cy = cy * (ih() / oh); }
    else { cx = iw() / 2; cy = ih() / 2; }
    update();
    return true;
  }

  function setAspect(a, opt = {}) {
    aspect = a; if ('round' in opt) { round = !!opt.round; frameEl.classList.toggle('round', round); }
    zoom = 1; computeFrame(); cx = iw() / 2; cy = ih() / 2; update();
  }
  function setZoom(z) { zoom = z; update(); }
  function rotate() { rot = (rot + 1) % 4; buildBase(); zoom = 1; cx = iw() / 2; cy = ih() / 2; update(); }
  function mirror() { flip = !flip; buildBase(); update(); }
  function reset() { zoom = 1; cx = iw() / 2; cy = ih() / 2; update(); }

  function drawTo(g, w, h) {                                // le recadrage courant -> (0,0,w,h)
    const r = rect();
    g.drawImage(base, r.x, r.y, r.w, r.h, 0, 0, w, h);
  }

  function getState() {
    return { zoom, rect: base ? rect() : null, frame: { ...frame }, iw: iw(), ih: ih(), rot, flip, aspect, round };
  }

  // --- gestes ------------------------------------------------------
  const pos = e => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  function onDown(e) {
    if (!base) return;
    pointers.set(e.pointerId, pos(e));
    try { stage.setPointerCapture(e.pointerId); } catch (_) {}
    if (pointers.size === 1) {                               // double-tap
      const now = performance.now();
      if (now - lastTap < 280) { zoom = zoom > 1.01 ? 1 : 2; if (zoom === 1) { cx = iw() / 2; cy = ih() / 2; } update(); lastTap = 0; }
      else lastTap = now;
    }
  }
  function onMove(e) {
    if (!pointers.has(e.pointerId)) return;
    const prev = new Map(pointers);
    pointers.set(e.pointerId, pos(e));
    const s = scale();
    if (pointers.size === 1) {
      const p0 = prev.get(e.pointerId), p1 = pointers.get(e.pointerId);
      cx -= (p1.x - p0.x) / s; cy -= (p1.y - p0.y) / s;
      clamp(); render(); emit();
    } else if (pointers.size >= 2) {
      const ids = [...pointers.keys()].slice(0, 2);
      const a0 = prev.get(ids[0]), b0 = prev.get(ids[1]), a1 = pointers.get(ids[0]), b1 = pointers.get(ids[1]);
      const m0 = mid(a0, b0), m1 = mid(a1, b1);
      const fcx = frame.x + frame.w / 2, fcy = frame.y + frame.h / 2;
      // point de l'image sous le milieu des doigts AVANT le geste
      const ix = cx + (m0.x - fcx) / s, iy = cy + (m0.y - fcy) / s;
      zoom = Math.min(MAX_ZOOM, Math.max(1, zoom * dist(a1, b1) / dist(a0, b0)));
      const s2 = scale();
      // …doit se retrouver sous le milieu des doigts APRÈS (zoom centré sur les doigts + pan à deux doigts)
      cx = ix - (m1.x - fcx) / s2; cy = iy - (m1.y - fcy) / s2;
      clamp(); render(); emit();
    }
  }
  function onUp(e) { pointers.delete(e.pointerId); try { stage.releasePointerCapture(e.pointerId); } catch (_) {} }
  function onWheel(e) {
    if (!base) return; e.preventDefault();
    const p = pos(e), s = scale(), fcx = frame.x + frame.w / 2, fcy = frame.y + frame.h / 2;
    const ix = cx + (p.x - fcx) / s, iy = cy + (p.y - fcy) / s;
    zoom = Math.min(MAX_ZOOM, Math.max(1, zoom * Math.exp(-e.deltaY * 0.0015)));
    const s2 = scale(); cx = ix - (p.x - fcx) / s2; cy = iy - (p.y - fcy) / s2;
    clamp(); render(); emit();
  }

  stage.style.touchAction = 'none';
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  stage.addEventListener('wheel', onWheel, { passive: false });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (base) update(); }) : null;
  ro && ro.observe(stage);

  return {
    load, setSource, setAspect, setZoom, rotate, mirror, reset, drawTo, getState,
    getZoom: () => zoom,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    destroy() {
      ro && ro.disconnect(); frameEl.remove(); listeners.clear(); pointers.clear();
      stage.removeEventListener('pointerdown', onDown); stage.removeEventListener('pointermove', onMove);
      stage.removeEventListener('pointerup', onUp); stage.removeEventListener('pointercancel', onUp);
      stage.removeEventListener('wheel', onWheel);
    },
  };
}
