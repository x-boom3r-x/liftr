/* ==================================================================
   SOCIAL - autoplay musique : un seul son à la fois, jamais contre
   la volonté de l'utilisateur.

   - Défaut SILENCIEUX : les navigateurs bloquent le son sans geste
     (Chrome desktop, iOS) et l'utilisateur doit rester maître.
     Le mute vit dans CHAQUE post (icône dans l'en-tête, pattern IG)
     et pilote TOUS les sons, feed comme stories. Choix persisté
     (`liftr_music_muted` : '0' = son activé, '1' ou absent =
     silencieux) — clé listée dans la liste blanche des tests.
   - Une fois le son activé (pattern Instagram) : dès qu'une chip
     musique occupe ~55 % du viewport et que ni le mute global ni
     le pion « !m » ne s'y opposent, la piste se lance ; en
     sortant du viewport elle s'arrête.
   - Story : la musique de la story en cours démarre à l'affichage
     du slide ; appui long = pause, reprise = relance ;
     fermeture = stop (déjà géré par la visionneuse).

   Aucune dépendance circulaire : music.js nous appelle via
   `window.autoplayScan` / `window.musicStoryAutoplay` (hydratation
   des chips et peinture des slides).
   ================================================================== */

import { playTrack, stopMusic, musicPlayingId } from './music.js';
import { iconS } from '../icons.js';

const LS_KEY = 'liftr_music_muted';

let muted = true;
try { muted = localStorage.getItem(LS_KEY) !== '0'; } catch(e){}

let io = null;

export function isGlobalMuted(){ return muted; }

export function setGlobalMuted(v){
  muted = !!v;
  try { localStorage.setItem(LS_KEY, muted ? '1' : '0'); } catch(e){}
  if (muted) stopMusic();
  else {
    /* activation du son : le contenu visible se lance, comme Instagram */
    const chip = document.querySelector(
      '.mchip[data-auto-on][data-auto-seen]:not([data-muted="1"]):not(.is-editable)');
    if (chip && !musicPlayingId()){
      const id = chip.getAttribute('data-track');
      const cs = parseFloat(chip.getAttribute('data-start')) || 0;
      const ce = parseFloat(chip.getAttribute('data-end')) || 0;
      playTrack(id, ce > cs ? { start: cs, end: ce } : null);
    }
    musicStoryResume();
  }
  paintMute();
  return muted;
}

/* M3 : le mute vit dans chaque post (.post-mute) — tous synchronisés. */
function paintMute(){
  const name = muted ? 'mute' : 'volume';
  document.querySelectorAll('.post-mute').forEach(b => {
    b.innerHTML = iconS(name);
    b.setAttribute('aria-label', muted ? 'Unmute music' : 'Mute music');
    b.setAttribute('aria-pressed', muted ? 'true' : 'false');
    b.classList.toggle('is-on', !!musicPlayingId());
  });
}

function clipOf(chip){
  const cs = parseFloat(chip.getAttribute('data-start')) || 0;
  const ce = parseFloat(chip.getAttribute('data-end')) || 0;
  return ce > cs ? { start: cs, end: ce } : null;
}

function isChipMuted(chip){
  return chip.getAttribute('data-muted') === '1';
}

/* Scanne un conteneur fraîchement rendu et observe ses chips. */
export function autoplayScan(root){
  const scope = root && root.querySelectorAll ? root : document;
  if (typeof IntersectionObserver !== 'function') return;
  if (!io){
    io = new IntersectionObserver(entries => {
      entries.forEach(en => {
        const chip = en.target;
        if (!chip.isConnected) return;
        const id = chip.getAttribute('data-track');
        if (en.isIntersecting && en.intersectionRatio >= 0.55){
          if (!chip.dataset.autoSeen){ chip.dataset.autoSeen = '1'; }
          paintMute();
          if (muted || isChipMuted(chip)) return;
          if (musicPlayingId()) return;          /* un seul son : on ne vole pas le lecteur */
          playTrack(id, clipOf(chip));
        } else {
          if (chip.dataset.autoSeen){ delete chip.dataset.autoSeen; }
          paintMute();
          if (musicPlayingId() === String(id)) stopMusic();
        }
      });
    }, { threshold: [0, 0.55, 1] });
  }
  scope.querySelectorAll('.mchip[data-track][data-music-on]:not(.is-editable)').forEach(chip => {
    if (chip.dataset.autoOn) return;
    chip.dataset.autoOn = '1';
    io.observe(chip);
  });
}

/* Appelé par stories.js à chaque peinture de slide (et à la reprise). */
let lastStoryParts = null;

export function musicStoryAutoplay(parts){
  lastStoryParts = parts || null;
  if (!parts || !parts.trackId) return;
  paintMute();
  if (muted || parts.muted) return;
  playTrack(parts.trackId, parts.end > parts.start ? { start: parts.start, end: parts.end } : null);
}

/* Reprise après appui long (gestes story). */
export function musicStoryResume(){
  if (lastStoryParts && lastStoryParts.trackId) musicStoryAutoplay(lastStoryParts);
}

export function musicStoryForget(){ lastStoryParts = null; }

export function initAutoplay(){
  /* le mute est dans chaque post : la délégation de clics vit dans feed.js */
  paintMute();
}

