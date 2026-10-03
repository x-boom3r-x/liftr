/* ==================================================================
   LIFTR - point d'entree
   ================================================================== */

import './state.js';
import './data.js';
import './idb.js';
import './store.js';
import './ui.js';
import './programme.js';
import './suggest.js';
import './seance.js';
import './calendrier.js';
import './stats.js';
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
