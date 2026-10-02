/* ==================================================================
   LIFTR - installation PWA (beforeinstallprompt)
   ================================================================== */


let _deferredPrompt = null;

function _showInstallBtn(on){
  const b = $('installBtn');
  if (b) b.classList.toggle('hidden', !on);
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredPrompt = e;
  _showInstallBtn(true);
});

async function installApp(){
  const p = _deferredPrompt;
  if (!p) return;
  _deferredPrompt = null;
  _showInstallBtn(false);
  try {
    p.prompt();
    const res = await p.userChoice;
    if (res && res.outcome === 'accepted') toast('Liftr installed on your device ✓');
  } catch (e){ /* prompt déjà consommé */ }
}

window.addEventListener('appinstalled', () => {
  _deferredPrompt = null;
  _showInstallBtn(false);
  toast('Liftr installed on your device ✓');
});

Object.assign(window, { installApp, hasInstallPrompt: () => !!_deferredPrompt });
