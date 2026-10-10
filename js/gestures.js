/* ==================================================================
   gestures.js — swipe pour revenir / fermer, sans dépendance.

   Une PWA iOS installée n'a AUCUN geste "retour" natif : il faut le
   fournir. Trois briques :

   1. onSwipe(el, opts)        swipe directionnel avec verrouillage d'axe
   2. dragToDismiss(el, opts)  la feuille / la story suit le doigt et se ferme
   3. layers (pile retour)     pushLayer(id, close) + history/popstate :
                               le swipe-bord, le bouton retour Android et
                               history.back() ferment TOUJOURS la couche du dessus
   ================================================================== */

const prefersReduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------
   1. onSwipe
   opts:
     axis       'x' | 'y' | 'both'   (défaut 'both')
     threshold  distance min en px pour valider (défaut 56)
     velocity   px/ms qui valide même sous le seuil (défaut 0.45)
     edge       null | { side:'left'|'right', width:24 }   départ au bord seulement
     ignore     sélecteur CSS à ignorer (boutons, champs, zones scrollables)
     onMove     ({dx,dy,axis}) pendant le geste
     onSwipe    (dir:'left'|'right'|'up'|'down', {dx,dy,v}) quand validé
     onCancel   () geste annulé / sous le seuil
   Renvoie une fonction destroy().
   ------------------------------------------------------------------ */
export function onSwipe(el, opts = {}) {
  const o = { axis: 'both', threshold: 56, velocity: 0.45, edge: null, ignore: 'input,textarea,select,[data-no-swipe]', ...opts };
  let id = null, x0 = 0, y0 = 0, t0 = 0, lock = null, dx = 0, dy = 0, live = false;

  const down = e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (id !== null) return;                                  // un seul doigt pilote
    if (o.ignore && e.target.closest(o.ignore)) return;
    if (o.edge) {
      const r = el.getBoundingClientRect();
      const fromLeft = e.clientX - r.left, fromRight = r.right - e.clientX;
      const ok = o.edge.side === 'right' ? fromRight <= o.edge.width : fromLeft <= o.edge.width;
      if (!ok) return;
    }
    id = e.pointerId; x0 = e.clientX; y0 = e.clientY; t0 = performance.now();
    lock = null; dx = dy = 0; live = true;
  };
  const move = e => {
    if (!live || e.pointerId !== id) return;
    dx = e.clientX - x0; dy = e.clientY - y0;
    if (!lock) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;   // zone morte
      lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (o.axis !== 'both' && o.axis !== lock) { live = false; id = null; return; } // laisse le scroll natif
      try { el.setPointerCapture(id); } catch (_) {}
    }
    if (o.onMove) o.onMove({ dx, dy, axis: lock });
  };
  const end = e => {
    if (!live || e.pointerId !== id) return;
    const dt = Math.max(1, performance.now() - t0);
    const d = lock === 'x' ? dx : dy, v = Math.abs(d) / dt;
    const committed = lock && (Math.abs(d) >= o.threshold || v >= o.velocity) && Math.abs(d) > 14;
    live = false; const pid = id; id = null;
    try { el.releasePointerCapture(pid); } catch (_) {}
    if (committed) {
      const dir = lock === 'x' ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
      o.onSwipe && o.onSwipe(dir, { dx, dy, v });
    } else if (lock) { o.onCancel && o.onCancel(); }
  };
  const cancel = e => { if (e.pointerId === id) { live = false; id = null; lock && o.onCancel && o.onCancel(); } };

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', cancel);
  // pan-y : le défilement vertical natif reste possible quand on n'écoute que l'horizontal
  if (o.axis === 'x') el.style.touchAction = 'pan-y';
  else if (o.axis === 'y') el.style.touchAction = 'pan-x';
  else el.style.touchAction = 'none';

  return () => {
    el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move);
    el.removeEventListener('pointerup', end);   el.removeEventListener('pointercancel', cancel);
  };
}

/* ------------------------------------------------------------------
   2. dragToDismiss — glisser vers le BAS pour fermer (story, feuille, éditeur)
   opts:
     handle     élément qui reçoit le geste (défaut : el). Pour une feuille avec
                contenu scrollable, passer le .grabber / l'en-tête uniquement.
     close      () => void   appelé quand validé
     distance   px de glisse pour fermer (défaut 120) ; vitesse 0.6 px/ms valide aussi
     fade       true : l'opacité baisse avec la glisse (story)
     onProgress (ratio 0..1)  ex. pour mettre la story en pause pendant le drag
   ------------------------------------------------------------------ */
export function dragToDismiss(el, opts = {}) {
  const o = { handle: el, distance: 120, fade: false, ...opts };
  const reduced = prefersReduced();
  let base = null;                       // transform d'origine, capturé UNE fois par geste
  const apply = (dy, ratio) => {
    el.style.transition = 'none';
    el.style.transform = `${base || ''} translateY(${Math.max(0, dy)}px)`;
    if (o.fade) el.style.opacity = String(1 - Math.min(.6, ratio * .6));
    o.onProgress && o.onProgress(ratio);
  };
  const reset = () => {
    el.style.transition = reduced ? 'none' : 'transform .22s cubic-bezier(.22,.61,.36,1), opacity .22s';
    el.style.transform = base || ''; el.style.opacity = '';
    base = null;
    o.onProgress && o.onProgress(0);
  };
  return onSwipe(o.handle, {
    axis: 'y', threshold: o.distance, velocity: 0.6, ignore: o.ignore ?? 'input,textarea,select,[data-no-swipe]',
    onMove: ({ dy, axis }) => {
      if (axis !== 'y') return;
      if (base === null) { const t = getComputedStyle(el).transform; base = t === 'none' ? '' : t; }
      apply(dy, Math.min(1, Math.max(0, dy) / (o.distance * 2)));
    },
    onSwipe: dir => {
      if (dir !== 'down') return reset();
      el.style.transition = reduced ? 'none' : 'transform .2s ease-in, opacity .2s';
      el.style.transform = `${base || ''} translateY(100%)`; el.style.opacity = '0';
      setTimeout(() => { el.style.transform = base || ''; el.style.opacity = ''; el.style.transition = ''; base = null; o.close && o.close(); }, reduced ? 0 : 190);
    },
    onCancel: reset,
  });
}

/* ------------------------------------------------------------------
   3. layers — pile retour (modal > story > sous-vue)
   Chaque couche qui s'ouvre fait pushLayer(id, closeFn). Quand elle se ferme
   PAR L'UI (bouton ✕, clic dehors…) il faut appeler popLayer(id) pour garder
   history synchronisé. Le geste retour, le bouton retour matériel et
   history.back() déclenchent popstate → on ferme la couche du dessus.
   ------------------------------------------------------------------ */
const stack = [];
let internalBack = 0;

export function pushLayer(id, close) {
  if (stack.some(l => l.id === id)) return;
  stack.push({ id, close });
  history.pushState({ liftrLayer: id }, '');
}
export function popLayer(id) {
  const i = stack.findIndex(l => l.id === id);
  if (i < 0) return;
  const wasTop = i === stack.length - 1;
  stack.splice(i, 1);
  if (wasTop && history.state && history.state.liftrLayer === id) { internalBack++; history.back(); }
}
export function hasLayers() { return stack.length > 0; }
/** À brancher sur les "boutons retour" visuels et sur le swipe bord gauche. */
export function goBack() { if (stack.length) history.back(); }

window.addEventListener('popstate', () => {
  if (internalBack > 0) { internalBack--; return; }          // retour déclenché par popLayer
  const top = stack.pop();
  if (top) { try { top.close(); } catch (_) {} }
});

/* Swipe depuis le bord gauche = retour (sous-vues du feed, fil de discussion, profil…) */
export function installEdgeBack(root = document.body, { width = 24, ignore } = {}) {
  return onSwipe(root, {
    axis: 'x', edge: { side: 'left', width }, threshold: 70, ignore,
    onSwipe: dir => { if (dir === 'right') goBack(); },
  });
}

/* ------------------------------------------------------------------
   Story : navigation par gestes
     tap gauche / droite      précédent / suivant (les .sv-tap existent déjà)
     swipe BAS                fermer (la story suit le doigt)
     swipe GAUCHE / DROITE    story de l'utilisateur suivant / précédent
     appui long               pause (relâcher = reprise)
   ------------------------------------------------------------------ */
export function installStoryGestures(viewer, api) {
  // api: { close, nextUser, prevUser, pause, resume }
  const offs = [];
  offs.push(dragToDismiss(viewer, {
    fade: true, distance: 110, ignore: '.sv-foot,.sv-head,.sv-close,.sv-music,input,textarea',
    close: api.close, onProgress: r => (r > 0 ? api.pause() : api.resume()),
  }));
  offs.push(onSwipe(viewer, {
    axis: 'x', threshold: 70, ignore: '.sv-foot,.sv-head,.sv-close,.sv-music,input,textarea',
    onSwipe: dir => (dir === 'left' ? api.nextUser() : api.prevUser()),
  }));
  // appui long = pause
  let timer = 0, held = false;
  const start = e => { if (e.target.closest('.sv-foot,.sv-head,.sv-close,.sv-music')) return; timer = setTimeout(() => { held = true; api.pause(); }, 220); };
  const stop = () => {
    clearTimeout(timer);
    if (!held) return;
    held = false; api.resume();
    // relâcher après un appui long ne doit PAS déclencher le "tap suivant"
    const eat = ev => { ev.stopPropagation(); ev.preventDefault(); };
    viewer.addEventListener('click', eat, { capture: true, once: true });
    setTimeout(() => viewer.removeEventListener('click', eat, { capture: true }), 350);
  };
  viewer.addEventListener('pointerdown', start);
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => viewer.addEventListener(t, stop));
  offs.push(() => { viewer.removeEventListener('pointerdown', start); ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => viewer.removeEventListener(t, stop)); });
  // NB : swipe BAS et swipe GAUCHE/DROITE sont deux onSwipe sur le même élément,
  // chacun verrouille son axe : pas de conflit. touch-action est géré par dragToDismiss
  // (pan-x) puis écrasé par le second (pan-y) → on force 'none' pour la story.
  viewer.style.touchAction = 'none';
  return () => offs.forEach(f => f());
}
