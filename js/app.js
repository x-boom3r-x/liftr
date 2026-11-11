/* ==================================================================
   LIFTR - point d'entree
   ================================================================== */

/* Build partage avec index.html (data-build) et sw.js (liftr-vXX) :
   on le bump a chaque deploiement (test handlers.spec.js l'impose). */
window.__LIFTR_BUILD__ = '91';

import './gestures.js';
import './state.js';
import './data.js';
import './exercise-demo.js';   /* après data.js : exoKey/LIB sur window */
import './idb.js';
import './store.js';
import './ui.js';
import './today.js';
import './programme.js';
import './library.js';   /* écran Library (sous-onglet Muscu, build 84) */
import './suggest.js';
import './seance.js';
import './calendrier.js';
import './stats.js';
import './bodymap.js';   /* carte musculaire SVG maison (après stats : muscleMap) */
import './progress.js';   /* après stats.js : réutilise muscleMap() (I) */
import './nutri.js';
import './foods.js';   /* base d'aliments lazy (J1) */
import './comments.js';
import './motivation.js';
import './install.js';
import './share.js';
import './export.js';
import './social/index.js';

/* Erreurs globales : on prévient sans casser l'app (une fois par message) */
let _lastErr = '';
function _warnOnce(msg){
  const m = String(msg || 'erreur');
  if (m === _lastErr) return;
  _lastErr = m;
  const t = document.getElementById('toast');
  if (t && currentUser) toast('An internal error occurred — keep going, it probably has no impact.');
}
window.addEventListener('error', e => _warnOnce(e && (e.message || e.type)));
window.addEventListener('unhandledrejection', e => {
  _warnOnce(e && e.reason && (e.reason.message || e.reason));
});

async function init(){
  await boot();
  const last = localStorage.getItem('at_lastUser');
  if (last) await setUser(last);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
