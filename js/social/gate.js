/* ==================================================================
   SOCIAL - état de l'entrée "Feed" (synchrone, zéro requête)
   ================================================================== */
import { SOCIAL_ENABLED, GOOGLE_ENABLED } from './config.js';

/* true = l'onglet Feed est utilisable : configuré + connecté + en ligne. */
export function socialAvailable(){
  return !!(SOCIAL_ENABLED && window.socialUser && navigator.onLine);
}

/* Chantier F : le bouton Feed est TOUJOURS visible (1er des 3 racines).
   Déconnecté/hors-ligne, showRoot('feed') bascule sur Gym avec un toast ;
   le panneau Feed reste fermé et l'invite de connexion remonte. */
export function updateSocialGate(){
  const signed = !!(SOCIAL_ENABLED && window.socialUser);
  const on = signed && navigator.onLine;

  const panel = document.getElementById('tab-feed');
  if (panel && !on) panel.classList.add('hidden');

  const cta = document.getElementById('socialCta');
  if (cta) cta.classList.toggle('hidden', !(SOCIAL_ENABLED && !signed));

  const signIn = document.getElementById('signInBtn');
  if (signIn) signIn.classList.toggle('hidden', !(SOCIAL_ENABLED && !signed));

  const google = document.getElementById('authGoogleBtn');
  if (google) google.classList.toggle('hidden', !GOOGLE_ENABLED);

  if (!on && window.DB && window.currentUser && window.currentTab === 'feed' &&
      typeof window.showTab === 'function'){
    window.showTab('programme');
  }
}
