/* ==================================================================
   SOCIAL - anneaux de story partagés (chantier B)

   Une SEULE source de vérité : Map uid -> true(vu) / false(non vu).
   Alimentée par stories.js (renderStories / refreshStoryRings) ;
   lue par feed (avatars de post), profile (avatar) et comments.
   L'anneau d'un avatar = classe "has-story" (+ "seen" si déjà vu) ;
   sans story active : AUCUNE classe, donc aucun dégradé (css/app.css).
   ================================================================== */

let ringUsers = new Map();
let ringAt = 0;

export const RING_TTL = 60000;   /* expiration : rafraîchissement toutes les 60 s */

/** ' has-story seen' | ' has-story' | '' — à coller dans un attribut class. */
export function storyRingClass(uid){
  if (!uid || !ringUsers.has(String(uid))) return '';
  return ringUsers.get(String(uid)) ? ' has-story seen' : ' has-story';
}

/** Remplace le Set (reçu de storyState : { uid: { count, seen } }). */
export function setStoryRings(state){
  const m = new Map();
  Object.keys(state || {}).forEach(k => { m.set(String(k), !!(state[k] && state[k].seen)); });
  ringUsers = m;
  ringAt = Date.now();
}

/** Une story vient d'être vue : l'anneau passe en « vu » sans re-fetch. */
export function markStorySeen(uid){
  const k = String(uid || '');
  if (!k || !ringUsers.has(k) || ringUsers.get(k)) return false;
  ringUsers.set(k, true);
  return true;
}

export function clearStoryRings(){ ringUsers = new Map(); ringAt = 0; }

export function ringsFresh(){ return Date.now() - ringAt < RING_TTL; }

/** Empreinte du jeu d'auteurs : elle change quand une story apparaît/expire. */
export function ringAuthorsKey(){ return [...ringUsers.keys()].sort().join(','); }

/** Applique has-story / seen sur tous les avatars data-uid du DOM. */
export function applyStoryRings(root){
  const scope = root || document;
  if (!scope || !scope.querySelectorAll) return 0;
  let n = 0;
  scope.querySelectorAll('.avatar[data-uid], .prof-av[data-uid]').forEach(av => {
    const k = storyRingClass(av.getAttribute('data-uid'));
    const wantStory = k.indexOf('has-story') >= 0;
    const wantSeen = k.indexOf('seen') >= 0;
    if (av.classList.contains('has-story') !== wantStory){ av.classList.toggle('has-story', wantStory); n++; }
    if (av.classList.contains('seen') !== wantSeen){ av.classList.toggle('seen', wantSeen); n++; }
  });
  return n;
}
