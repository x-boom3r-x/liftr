/* ==================================================================
   audio-controller.js — UN SEUL lecteur audio pour toute l'app.

   Pourquoi : le bug "je lance la musique et je ne peux plus l'arrêter"
   vient presque toujours de `new Audio(url).play()` appelé à chaque clic :
   chaque clic crée un NOUVEL objet Audio sans référence conservée, donc
   personne ne peut plus le mettre en pause, et l'UI (re-rendue par
   innerHTML) a perdu l'état du bouton. Ici : une seule balise <audio>,
   un seul état, des boutons synchronisés par délégation d'événements.

   Usage HTML (n'importe où : feed, story, modale musique, notes) :
     <button data-audio-id="trk_123" data-audio-url="https://…m4a"
             data-audio-start="0" data-audio-end="15">▶</button>

   Usage JS :
     import { player, installAudioUI } from './audio-controller.js';
     installAudioUI();                       // une fois, au démarrage
     player.toggle('trk_123', url, {start:0, end:15});
     player.stop();                          // à appeler dans closeModal,
                                             // closeStoryViewer, showTab, setSView…
   ================================================================== */

const ICON_PLAY = '▶';
const ICON_STOP = '❚❚';

class AudioPlayer {
  constructor() {
    this.el = null;
    this.state = { id: null, playing: false, progress: 0, error: null };
    this.win = { start: 0, end: 0 };
    this.listeners = new Set();
    this._token = 0;            // invalide les play() obsolètes (clics rapides)
  }

  _audio() {
    if (this.el) return this.el;
    const a = document.createElement('audio');
    a.preload = 'none';
    a.setAttribute('playsinline', '');
    a.crossOrigin = 'anonymous';
    a.addEventListener('play',  () => this._set({ playing: true,  error: null }));
    a.addEventListener('pause', () => this._set({ playing: false }));
    a.addEventListener('ended', () => this._finish());
    a.addEventListener('error', () => this._set({ playing: false, error: 'load' }));
    a.addEventListener('timeupdate', () => {
      const { start, end } = this.win;
      const dur = end > start ? end - start : (a.duration || 0) - start;
      const progress = dur > 0 ? Math.min(1, Math.max(0, (a.currentTime - start) / dur)) : 0;
      if (end > start && a.currentTime >= end) return this._finish(); // fin de l'extrait
      this._set({ progress });
    });
    this.el = a;
    return a;
  }

  _finish() {
    const a = this.el;
    if (a) { a.pause(); try { a.currentTime = this.win.start || 0; } catch (_) {} }
    this._set({ playing: false, progress: 0 });
  }

  _set(patch) {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    if (prev.id !== this.state.id || prev.playing !== this.state.playing ||
        prev.error !== this.state.error || Math.abs(prev.progress - this.state.progress) > 0.004) {
      this.listeners.forEach(fn => { try { fn(this.state); } catch (_) {} });
    }
  }

  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  isPlaying(id) { return this.state.playing && this.state.id === id; }

  /** Lance (ou reprend). Si un autre morceau joue, il est STOPPÉ d'abord. */
  async play(id, url, { start = 0, end = 0 } = {}) {
    if (!url) return false;
    const a = this._audio();
    const token = ++this._token;
    const same = this.state.id === id && a.src && a.src === new URL(url, location.href).href;
    this.win = { start: Math.max(0, +start || 0), end: Math.max(0, +end || 0) };
    if (!same) {
      a.pause();
      a.src = url;
      this._set({ id, playing: false, progress: 0, error: null });
      await new Promise(res => {
        const done = () => { a.removeEventListener('loadedmetadata', done); a.removeEventListener('error', done); res(); };
        a.addEventListener('loadedmetadata', done); a.addEventListener('error', done);
        a.load();
        setTimeout(done, 4000);            // filet : ne jamais rester bloqué
      });
      if (token !== this._token) return false;   // un autre clic a pris le relais
      try { a.currentTime = this.win.start; } catch (_) {}
    } else if (a.currentTime < this.win.start || (this.win.end && a.currentTime >= this.win.end)) {
      try { a.currentTime = this.win.start; } catch (_) {}
    }
    try {
      await a.play();
      return true;
    } catch (err) {
      // iOS : NotAllowedError si hors geste utilisateur ; AbortError si pause() concurrente
      if (err && err.name !== 'AbortError') this._set({ playing: false, error: err.name || 'play' });
      return false;
    }
  }

  pause() { if (this.el) this.el.pause(); }

  /** Arrêt TOTAL et idempotent. Sûr à appeler n'importe quand. */
  stop() {
    this._token++;
    const a = this.el;
    if (a) {
      a.pause();
      try { a.currentTime = this.win.start || 0; } catch (_) {}
    }
    this._set({ id: null, playing: false, progress: 0, error: null });
  }

  /** Même morceau en lecture → stop ; sinon → play (et arrête l'autre). */
  toggle(id, url, opts) {
    if (this.isPlaying(id)) { this.stop(); return Promise.resolve(false); }
    return this.play(id, url, opts);
  }
}

export const player = new AudioPlayer();

/* ---------- synchronisation de TOUS les boutons ---------- */
function syncButtons(root = document) {
  const { id, playing, progress } = player.state;
  root.querySelectorAll('[data-audio-id]').forEach(btn => {
    const on = playing && btn.dataset.audioId === id;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? 'Arrêter la musique' : 'Lire la musique');
    if (btn.dataset.audioIcon !== 'none') btn.textContent = on ? ICON_STOP : ICON_PLAY;
    const bar = btn.closest('.music-row, .mchip')?.querySelector('.music-prog > i');
    if (bar) bar.style.width = on ? (progress * 100).toFixed(1) + '%' : '0%';
  });
}

let installed = false;
export function installAudioUI() {
  if (installed) return; installed = true;

  // 1. délégation : fonctionne même si la liste est re-rendue (innerHTML)
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-audio-id]');
    if (!btn || !btn.dataset.audioUrl) return;
    e.preventDefault(); e.stopPropagation();           // ne pas "sélectionner la ligne" au passage
    player.toggle(btn.dataset.audioId, btn.dataset.audioUrl, {
      start: parseFloat(btn.dataset.audioStart) || 0,
      end:   parseFloat(btn.dataset.audioEnd)   || 0,
    });
  }, true);

  // 2. l'état → toutes les vues
  player.subscribe(() => syncButtons());

  // 3. après un re-rendu, les nouveaux boutons retrouvent le bon état
  let raf = 0;
  new MutationObserver(() => {
    if (!player.state.id || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; syncButtons(); });
  }).observe(document.body, { childList: true, subtree: true });

  // 4. arrêt automatique : app en arrière-plan, page quittée, retour offline
  document.addEventListener('visibilitychange', () => { if (document.hidden) player.stop(); });
  window.addEventListener('pagehide', () => player.stop());
}
