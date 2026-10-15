/* ==================================================================
   NUTRI-REMOTE (chantier Nutrition) — sources alimentaires distantes
   Open Food Facts (produits emballés, pas de clé) + USDA FoodData
   Central (aliments génériques, DEMO_KEY ou clé fournie). Les deux
   API répondent en CORS `*` : appels navigateur directs, AUCUNE
   donnée personnelle envoyée — seule la requête de recherche ou le
   code-barres quitte l'appareil.
   - Normalisation vers le modèle LIFTR per-100 g.
   - Fibres / sucres / sodium : null quand inconnu (jamais 0 trompeur).
   - Cache local 90 j (DB.nutri.remoteCache) pour les recherches
     répétées et le mode hors ligne.
   Aucun code GPL n'est copié : les API et le modèle per-100 g sont
   publics ; les mappings sont réimplifiés ici.
   ================================================================== */

const OFF_SEARCH = 'https://world.openfoodfacts.org/cgi/search.pl';
const OFF_PRODUCT = 'https://world.openfoodfacts.org/api/v2/product/';
const USDA_SEARCH = 'https://api.nal.usda.gov/fdc/v1/foods/search';
/* DEMO_KEY USDA : quota bas, suffisant pour la démo. Une clé gratuite
   (https://fdc.nal.usda.gov/api-key-signup.html) peut être branchée
   via window.LIFTR_USDA_KEY sans changer le code. */
const USDA_KEY = () => (window.LIFTR_USDA_KEY || 'DEMO_KEY');
const CACHE_DAYS = 90;
const UA = { 'User-Agent': 'LIFTR/1.0 (nutrition tracker)' };

/* ---- cache local (DB.nutri.remoteCache) : { key, food, at } ---- */
function cacheBox(){
  const n = window.DB && DB.nutri;
  if (!n) return [];
  if (!Array.isArray(n.remoteCache)) n.remoteCache = [];
  return n.remoteCache;
}
function cacheGet(key){
  const now = Date.now();
  for (const e of cacheBox()){
    if (e && e.key === key && (now - (+e.at || 0)) < CACHE_DAYS * 86400000) return e.food;
  }
  return null;
}
function cachePut(key, food){
  const box = cacheBox();
  const i = box.findIndex(e => e && e.key === key);
  const rec = { key: key, food: food, at: Date.now() };
  if (i >= 0) box[i] = rec; else box.push(rec);
  /* borne la taille : 400 entrées max, les plus vieilles d'abord */
  if (box.length > 400){
    box.sort((a, b) => (+b.at || 0) - (+a.at || 0));
    box.length = 400;
  }
}

/* ---- validation code-barres (modulo-10 : EAN-8 / UPC-A / EAN-13 / GTIN-14) ----
   Algorithme public : de droite à gauche, poids alterné 3/1, somme ->
   (10 - somme % 10) % 10 == chiffre de contrôle. */
export function isBarcodeFormat(value){
  return /^\d{8,14}$/.test(String(value || '').trim());
}
export function isValidBarcodeCheckDigit(code){
  code = String(code || '').trim();
  if ([8, 12, 13, 14].indexOf(code.length) < 0) return false;
  if (!/^\d+$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits[digits.length - 1];
  let sum = 0, w3 = true;
  for (let i = digits.length - 2; i >= 0; i--, w3 = !w3) sum += digits[i] * (w3 ? 3 : 1);
  return ((10 - (sum % 10)) % 10) === check;
}

/* ---- normalisation : nombre robuste (null si inconnu) ---- */
function num(v){
  if (v === null || v === undefined || v === '') return null;
  const x = +v;
  return isFinite(x) ? x : null;
}
function r1(v){ return v === null ? null : Math.round(v * 10) / 10; }

/* ---- Open Food Facts -> modèle LIFTR (per 100 g) ---- */
export function offToFood(p){
  if (!p) return null;
  const n = p.nutriments || {};
  const kcal = num(n['energy-kcal_100g']);
  if (kcal === null) return null;   /* produit sans kcal exploitable */
  const sodiumG = num(n.sodium_100g);
  const food = {
    id: 'off:' + (p.code || ''),
    name: (p.product_name || p.product_name_en || p.generic_name || 'Product').trim().slice(0, 70),
    kcal: Math.round(kcal),
    protein: r1(num(n.proteins_100g)),
    carbs: r1(num(n.carbohydrates_100g)),
    fat: r1(num(n.fat_100g)),
    fiber: r1(num(n.fiber_100g)),
    sugar: r1(num(n.sugars_100g)),
    sodium_mg: sodiumG === null ? null : Math.round(sodiumG * 1000),
    source: 'off',
    barcode: p.code || '',
    brands: (p.brands || '').split(',')[0].trim() || undefined,
    category: p.categories ? String(p.categories).split(',')[0].trim() : undefined
  };
  /* portion standard : serving_size en grammes si disponible */
  const sg = servingGrams(p);
  if (sg > 0) food.portions = [{ label: p.serving_size ? '1 serving' : '1 unit', grams: sg }];
  return food;
}
function servingGrams(p){
  const n = p.nutriments || {};
  /* OFF expose serving_quantity (ml/g) ; on convertit en grammes */
  const q = num(p.serving_quantity);
  if (q && q > 0) return Math.round(q);
  const g = num(n['serving_weight_100g']);
  return g ? Math.round(g) : 0;
}

/* ---- USDA FoodData Central -> modèle LIFTR (per 100 g) ---- */
const USDA_BY_KEY = {
  kcal: ['Energy'],
  protein: ['Protein'],
  carbs: ['Carbohydrate, by difference', 'Carbohydrate, by difference (AOAC)'],
  fat: ['Total lipid (fat)'],
  fiber: ['Fiber, total dietary'],
  sugar: ['Total Sugars', 'Sugars, total'],
  sodium_mg: ['Sodium, Na']
};
export function usdaToFood(f){
  if (!f) return null;
  const list = f.foodNutrients || [];
  const pick = keys => {
    for (const k of keys){
      const hit = list.find(x => x.nutrientName === k && x.value !== undefined);
      if (hit){
        let v = num(hit.value);
        /* Energy peut venir en kJ : convertir (facteur Atwater 4.184) */
        if (keys === USDA_BY_KEY.kcal && String(hit.unitName || '').toUpperCase().startsWith('KJ') && v !== null)
          v = v / 4.184;
        return v;
      }
    }
    return null;
  };
  const kcal = pick(USDA_BY_KEY.kcal);
  if (kcal === null) return null;
  return {
    id: 'usda:' + (f.fdcId || ''),
    name: (f.description || 'Food').trim().slice(0, 70),
    kcal: Math.round(kcal),
    protein: r1(pick(USDA_BY_KEY.protein)),
    carbs: r1(pick(USDA_BY_KEY.carbs)),
    fat: r1(pick(USDA_BY_KEY.fat)),
    fiber: r1(pick(USDA_BY_KEY.fiber)),
    sugar: r1(pick(USDA_BY_KEY.sugar)),
    sodium_mg: pick(USDA_BY_KEY.sodium_mg) === null ? null : Math.round(pick(USDA_BY_KEY.sodium_mg)),
    source: 'usda',
    category: f.dataType || undefined
  };
}

/* ---- appels distants sûrs (timeout + repli silencieux) ---- */
function withTimeout(ms){
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
}

async function searchOff(q){
  const url = OFF_SEARCH + '?search_terms=' + encodeURIComponent(q) +
    '&search_simple=1&action=process&json=1&page_size=12' +
    '&fields=code,product_name,product_name_en,generic_name,brands,categories,nutriments,serving_quantity,serving_size';
  const { signal, done } = withTimeout(12000);
  try {
    const r = await fetch(url, { headers: UA, signal: signal });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.products || []).map(offToFood).filter(Boolean);
  } catch (e){ return []; } finally { done(); }
}

async function searchUsda(q){
  const { signal, done } = withTimeout(12000);
  try {
    const r = await fetch(USDA_SEARCH + '?api_key=' + encodeURIComponent(USDA_KEY()), {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, UA),
      body: JSON.stringify({ query: q, pageSize: 12, dataType: ['Foundation', 'SR Legacy', 'Branded'] }),
      signal: signal
    });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.foods || []).map(usdaToFood).filter(Boolean);
  } catch (e){ return []; } finally { done(); }
}

/* ---- recherche fusionnée + dédup + cache ; remoteEmpty = indice réseau ---- */
function dedupKey(f){ return f.id || (f.source + ':' + f.name); }
function dedup(list){
  const seen = new Set(), out = [];
  for (const f of list){ const k = dedupKey(f); if (!seen.has(k)){ seen.add(k); out.push(f); } }
  return out;
}

/* Recherche multi-sources. skipRemote : local (cache) seulement, pour les
   frappes courtes — évite un appel réseau à chaque lettre. */
export async function searchRemote(q, opts){
  opts = opts || {};
  q = String(q || '').trim();
  if (q.length < 2) return { foods: [], remoteEmpty: false };
  const ckey = 'q:' + q.toLowerCase();
  if (opts.skipRemote){
    const c = cacheGet(ckey);
    return { foods: c || [], remoteEmpty: false };
  }
  const [off, usda] = await Promise.all([searchOff(q), searchUsda(q)]);
  const merged = dedup(off.concat(usda));
  if (merged.length) cachePut(ckey, merged);
  return { foods: merged, remoteEmpty: off.length === 0 && usda.length === 0 };
}

/* ---- lookup code-barres (produit OFF) ; null si introuvable ---- */
export async function lookupBarcode(code){
  code = String(code || '').trim();
  if (!isBarcodeFormat(code)) return { food: null, invalid: true };
  const ckey = 'b:' + code;
  const hit = cacheGet(ckey);
  if (hit) return { food: hit, invalid: false };
  const { signal, done } = withTimeout(12000);
  try {
    const r = await fetch(OFF_PRODUCT + code + '.json', { headers: UA, signal: signal });
    if (!r.ok) return { food: null, invalid: false };
    const j = await r.json();
    if (j.status !== 1 || !j.product) return { food: null, invalid: false };
    const food = offToFood(j.product);
    if (!food) return { food: null, invalid: false, noNutrition: true };
    cachePut(ckey, food);
    return { food: food, invalid: false };
  } catch (e){ return { food: null, invalid: false, offline: true }; }
  finally { done(); }
}

/* Persiste un aliment distant dans DB.nutri.foods (source de vérité) pour
   que findNutriFood le résolve et qu'il survive au hors ligne. Idempotent. */
export function importRemoteFood(food){
  const n = window.DB && DB.nutri;
  if (!n || !food) return null;
  if (!Array.isArray(n.foods)) n.foods = [];
  const ex = n.foods.find(f => f && f.id === food.id);
  if (ex) return ex;
  n.foods.push(Object.assign({}, food));
  return n.foods[n.foods.length - 1];
}

window.LiftrRemote = {
  search: searchRemote, lookupBarcode: lookupBarcode, importRemoteFood: importRemoteFood,
  isBarcodeFormat: isBarcodeFormat, isValidBarcodeCheckDigit: isValidBarcodeCheckDigit,
  offToFood: offToFood, usdaToFood: usdaToFood, _cacheGet: cacheGet, _cachePut: cachePut
};
