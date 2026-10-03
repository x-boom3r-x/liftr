/* ==================================================================
   SOCIAL - état de l'entrée "Feed" (synchrone, zéro requête)
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';

/* true = on affiche l'onglet Feed : configuré + connecté + en ligne. */
export function socialAvailable(){
  return !!(SOCIAL_ENABLED && window.socialUser && navigator.onLine);
}

export function updateSocialGate(){
  const signed = !!(SOCIAL_ENABLED && window.socialUser);
  const on = signed && navigator.onLine;

  const btn = document.getElementById('tabFeedBtn');
  if (btn) btn.classList.toggle('hidden', !on);

  const panel = document.getElementById('tab-feed');
  if (panel && !on) panel.classList.add('hidden');

  const cta = document.getElementById('socialCta');
  if (cta) cta.classList.toggle('hidden', !(SOCIAL_ENABLED && !signed));

  if (!on && window.DB && window.currentUser && window.currentTab === 'feed' &&
      typeof window.showTab === 'function'){
    window.showTab('programme');
  }
}
