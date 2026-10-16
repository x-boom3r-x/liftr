/* ==================================================================
   NUTRI-SCAN (chantier Nutrition) — scanner de codes-barres par caméra.
   quagga2 (@ericblade/quagga2, MIT) est vendorisé dans js/vendor/ et
   chargé à la demande (lazy) : pas de poids au boot. Le décodage natif
   BarcodeDetector n'existe pas sur Safari/iPhone → lib nécessaire.
   Flux : ouvrir caméra -> décodage EAN/UPC -> lookup OFF -> fiche
   produit -> quantité -> ajout au repas/jour. Gère : HTTPS requis,
   déni d'autorisation, produit introuvable (recherche manuelle +
   création de fiche perso pré-remplie).
   ================================================================== */
import { nutrientsFor } from './nutrition.js';
import { lookupBarcode, importRemoteFood } from './nutri-remote.js';

const VENDOR_QUAGGA = 'js/vendor/quagga2.js';
/* EAN-13/EAN-8/UPC-A (via ean_reader)/UPC-E — formats produits Open Food Facts */
const QUAGGA_READERS = ['ean_reader', 'ean_8_reader', 'upc_e_reader'];
let _scanState = null;        /* { food, code } résultat courant */
let _scanActive = false;      /* décodage actif (caméra ouverte) */
let _lookupBusy = false;      /* anti-rebond pendant un lookup */
let _boundDetect = false;     /* handler onDetected monté une seule fois */

function scanModal(){ return document.getElementById('scanModal'); }
function scanRegion(){ return document.getElementById('scanRegion'); }

function lazyLoadQuagga(){
  if (window.Quagga) return Promise.resolve(true);
  if (scanLoadPromise) return scanLoadPromise;
  scanLoadPromise = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = VENDOR_QUAGGA;
    s.onload = () => resolve(!!window.Quagga);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return scanLoadPromise;
}
let scanLoadPromise = null;

function scanSet(html){ const b = document.getElementById('scanBody'); if (b) b.innerHTML = html; }

/* ---- ouverture / fermeture ---- */
async function openScanner(){
  const modal = scanModal();
  if (!modal) return;
  _scanState = null;
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');

  /* HTTPS requis pour getUserMedia (hors localhost). */
  const secure = window.isSecureContext || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (!secure){
    scanSet('<div class="scan-msg">Camera needs a secure connection (https). Use the search box to add this product manually.</div>' +
      '<div class="composer-actions"><button class="btn btn-primary" onclick="scanToManual()">Search manually</button>' +
      '<button class="chip" onclick="closeScanner()">Close</button></div>');
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){
    scanSet('<div class="scan-msg">This browser can’t open the camera. Search the product by name instead.</div>' +
      '<div class="composer-actions"><button class="btn btn-primary" onclick="scanToManual()">Search manually</button>' +
      '<button class="chip" onclick="closeScanner()">Close</button></div>');
    return;
  }

  scanSet('<div class="scan-region" id="scanRegion"></div>' +
    '<div class="scan-msg" id="scanStatus">Starting the camera…</div>' +
    '<div class="composer-actions"><button class="chip" onclick="closeScanner()">Cancel</button></div>');

  const ok = await lazyLoadQuagga();
  if (!ok){
    scanSet('<div class="scan-msg">Scanner library failed to load. Add the product by name instead.</div>' +
      '<div class="composer-actions"><button class="btn btn-primary" onclick="scanToManual()">Search manually</button>' +
      '<button class="chip" onclick="closeScanner()">Close</button></div>');
    return;
  }
  startCamera();
}

function bindDetect(){
  if (_boundDetect || !window.Quagga) return;
  _boundDetect = true;
  window.Quagga.onDetected(det => {
    if (!_scanActive) return;
    const code = det && det.codeResult && det.codeResult.code;
    if (code) onDecoded(String(code));
  });
}

function startCamera(){
  const region = scanRegion();
  const status = document.getElementById('scanStatus');
  if (!region || !window.Quagga) return;
  _scanActive = false;
  try {
    window.Quagga.init({
      inputStream: {
        name: 'Live',
        type: 'LiveStream',
        target: region,
        constraints: { width: 640, height: 480, facingMode: 'environment' }
      },
      decoder: { readers: QUAGGA_READERS, multiple: false },
      locate: true,
      frequency: 10
    }, err => {
      if (err){
        const name = (err && (err.name || err.message || err)) || '';
        const denied = /NotAllowed|Permission|denied|SecurityError|Could not start/i.test(String(name));
        if (status) status.textContent = denied
          ? 'Camera permission denied. Allow camera access, or add the product by name.'
          : 'Could not open the camera on this device.';
        const acts = document.querySelector('#scanBody .composer-actions');
        if (acts && denied){
          acts.insertAdjacentHTML('afterbegin',
            '<button class="btn btn-primary" onclick="scanToManual()">Search manually</button>');
        }
        return;
      }
      if (status) status.textContent = 'Point the camera at the barcode.';
      bindDetect();
      _scanActive = true;
    });
  } catch (e){
    if (status) status.textContent = 'Could not start the camera.';
  }
}

function stopCamera(){
  _scanActive = false;
  if (window.Quagga){
    try { window.Quagga.stop(); } catch (e){}
  }
}

async function onDecoded(code){
  /* anti-rebond : un seul lookup à la fois, une seule fiche par code */
  if (_lookupBusy) return;
  if (_scanState && _scanState.code === code) return;
  _lookupBusy = true;
  _scanActive = false;                 /* fige le décodage pendant le lookup */
  const status = document.getElementById('scanStatus');
  if (status) status.textContent = 'Looking up ' + code + '…';
  let res;
  try { res = await lookupBarcode(code); }
  catch (e){ res = { invalid: true }; }
  if (res && res.invalid){
    if (status) status.textContent = 'That doesn’t look like a valid barcode. Try another.';
    _scanActive = true;                /* reprend la visée */
    _lookupBusy = false;
    return;
  }
  stopCamera();
  _lookupBusy = false;
  _scanState = { food: res.food, code: code };
  if (res.food) renderScanFood(res.food);
  else renderScanNotFound(code, res.offline);
}

/* ---- fiche produit trouvé ---- */
function renderScanFood(food){
  const portions = (food.portions || []).map((p, i) =>
    '<option value="' + p.grams + '">' + esc(p.label) + ' — ' + p.grams + ' g</option>').join('');
  scanSet(
    '<div class="scan-found">' +
    '<div class="scan-name">' + esc(food.name) + '</div>' +
    (food.brands ? '<div class="scan-brand">' + esc(food.brands) + '</div>' : '') +
    '<div class="scan-src">Source: ' + (food.source === 'off' ? 'Open Food Facts' : 'USDA FoodData Central') + '</div>' +
    '<div class="scan-nutri">' +
    '<span><b>' + Math.round(food.kcal) + '</b> kcal</span>' +
    '<span>' + (food.protein != null ? food.protein : '—') + ' P</span>' +
    '<span>' + (food.carbs != null ? food.carbs : '—') + ' C</span>' +
    '<span>' + (food.fat != null ? food.fat : '—') + ' F</span>' +
    (food.fiber != null ? '<span>' + food.fiber + ' fiber</span>' : '') +
    '</div><div class="scan-per">per 100 g</div>' +
    '<div class="scan-qty">' +
    '<input class="input" id="scanQty" type="number" inputmode="decimal" min="0" step="any" value="100" aria-label="Quantity">' +
    '<select class="input" id="scanUnit" aria-label="Unit" onchange="scanUnitChange()">' +
    '<option value="g">g</option><option value="ml">ml</option>' +
    (portions ? '<option value="serving">serving</option>' : '') +
    '</select></div>' +
    (portions ? '<select class="input" id="scanPortion" aria-label="Serving size" onchange="scanPortionChange()">' +
      '<option value="">Choose a serving…</option>' + portions + '</select>' : '') +
    '<div class="scan-preview" id="scanPreview"></div>' +
    '</div>' +
    '<div class="composer-actions">' +
    '<button class="chip" onclick="openScanner()">Scan again</button>' +
    '<button class="btn btn-primary btn-sm" onclick="scanConfirmAdd()">Add to meal</button>' +
    '</div>'
  );
  scanPreview();
}

function scanQty(){ const e = document.getElementById('scanQty'); return e ? +e.value : 0; }
function scanUnit(){ const e = document.getElementById('scanUnit'); return e ? e.value : 'g'; }
function scanUnitChange(){ scanPreview(); }
function scanPortionChange(){
  const sel = document.getElementById('scanPortion');
  const q = document.getElementById('scanQty');
  if (sel && q && sel.value){ q.value = sel.value; scanUnit().length; }
  scanPreview();
}
function scanPreview(){
  const box = document.getElementById('scanPreview');
  if (!box || !_scanState || !_scanState.food) return;
  const f = _scanState.food;
  const q = scanQty();
  if (!(q > 0)){ box.textContent = 'Enter a quantity'; return; }
  /* portion -> grammes via son poids ; sinon unité directe */
  let grams = q, unit = scanUnit();
  if (unit === 'serving'){
    const sel = document.getElementById('scanPortion');
    grams = sel && sel.value ? +sel.value : q;
    unit = 'g';
  }
  try {
    const n = nutrientsFor(f, grams, unit);
    box.textContent = Math.round(n.kcal) + ' kcal · ' + Math.round(n.protein) + 'P / ' +
      Math.round(n.carbs) + 'C / ' + Math.round(n.fat) + 'F';
  } catch (e){ box.textContent = 'Unit not supported'; }
}

function scanConfirmAdd(){
  if (!_scanState || !_scanState.food) return;
  const f = _scanState.food;
  const q = scanQty();
  if (!(q > 0)){ toast('Enter a quantity'); return; }
  importRemoteFood(f);
  let grams = q, unit = scanUnit();
  if (unit === 'serving'){
    const sel = document.getElementById('scanPortion');
    grams = sel && sel.value ? +sel.value : q;
    unit = 'g';
  }
  closeScanner();
  window.logRemoteFood(f.id, grams, unit);
}

/* ---- produit introuvable ---- */
function renderScanNotFound(code, offline){
  scanSet(
    '<div class="scan-msg">' +
    (offline ? 'You appear to be offline — the barcode couldn’t be looked up.'
      : 'No product found for <b>' + esc(code) + '</b> in Open Food Facts.') +
    '</div>' +
    '<div class="scan-notfound">' +
    '<button class="btn btn-primary btn-block" onclick="scanCreateFood(\'' + esc(code) + '\')">Create a custom food for it</button>' +
    '<button class="btn btn-block" onclick="scanToManual()">Search by name instead</button>' +
    '</div>' +
    '<div class="composer-actions"><button class="chip" onclick="openScanner()">Scan again</button>' +
    '<button class="chip" onclick="closeScanner()">Close</button></div>'
  );
}

/* cree une fiche perso pre-remplie avec le code-barres */
function scanCreateFood(code){
  window.LiftrCloseScanModal && window.LiftrCloseScanModal();
  window.addFoodWithBarcode && window.addFoodWithBarcode(code);
}

/* renvoie a la recherche manuelle (Foods) */
function scanToManual(){
  closeScanner();
  window.showTab && window.showTab('nutri-foods');
  setTimeout(() => { const el = document.getElementById('nutriFoodSearch'); if (el) el.focus(); }, 60);
}

function closeScanner(){
  stopCamera();
  _scanState = null;
  const modal = scanModal();
  if (modal){ modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); }
}

window.openScanner = openScanner;
window.closeScanner = closeScanner;
window.scanToManual = scanToManual;
window.scanCreateFood = scanCreateFood;
window.scanUnitChange = scanUnitChange;
window.scanPortionChange = scanPortionChange;
window.scanConfirmAdd = scanConfirmAdd;
window.LiftrCloseScanModal = closeScanner;
