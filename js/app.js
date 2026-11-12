/* ==================================================================
   LIFTR - point d'entree
   ================================================================== */

/* Build partage avec index.html (data-build) et sw.js (liftr-vXX) :
   on le bump a chaque deploiement (test handlers.spec.js l'impose). */
window.__LIFTR_BUILD__ = '109';

import './gestures.js';
import './state.js';
import './data.js';
import './exercise-demo.js';   /* après data.js : exoKey/LIB sur window */
import './idb.js';
import './store.js';
import './ui.js';
import './shortcuts.js';
import './today.js';
import './programme.js';
import './library.js';   /* écran Library (sous-onglet Muscu, build 84) */
import './suggest.js';
import './seance.js';
import './calendrier.js';
import './stats.js';
import './bodymap.js';   /* silhouettes anatomiques et charge musculaire */
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

function dismissBootSplash(){
  const splash = document.getElementById('bootSplash');
  if (!splash) return Promise.resolve();
  splash.setAttribute('aria-busy', 'false');
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    splash.classList.add('hidden');
    return Promise.resolve();
  }
  return new Promise(resolve => {
    let done = false;
    let timer;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      splash.removeEventListener('transitionend', onTransition);
      splash.classList.add('hidden');
      resolve();
    };
    const onTransition = event => {
      if (event.target === splash && event.propertyName === 'opacity') finish();
    };
    splash.addEventListener('transitionend', onTransition);
    splash.classList.add('is-leaving');
    timer = setTimeout(finish, 280);
  });
}

function showBootFailure(error){
  console.error('Liftr startup failed', error);
  const splash = document.getElementById('bootSplash');
  if (!splash) return;
  document.getElementById('bootTitle').textContent = 'Liftr is taking a break';
  document.getElementById('bootStatus').textContent = 'We couldn’t open your training space.';
  document.getElementById('bootRail').classList.add('hidden');
  document.getElementById('bootError').classList.remove('hidden');
  splash.classList.add('is-error');
  splash.setAttribute('role', 'alert');
  splash.setAttribute('aria-busy', 'false');
}

async function init(){
  try {
    await boot();
    const last = localStorage.getItem('at_lastUser');
    if (last){
      await setUser(last);
      const shortcut = new URLSearchParams(location.search).get('shortcut');
      if (shortcut && typeof window.runQuickAction === 'function'){
        setTimeout(() => window.runQuickAction(shortcut), 180);
      }
    }
    await dismissBootSplash();
  } catch (error) {
    showBootFailure(error);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
