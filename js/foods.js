/* ==================================================================
   LIFTR - base d'aliments (J1) : data/foods.json lazy + recherche
   ------------------------------------------------------------------
   - chargée À LA DEMANDE (premier loadFoods()), jamais au boot
   - précachée par le service worker (sw.js ASSETS) -> offline OK
   - recherche insensible aux accents/casse (NFD), classement
     préfixe du nom > sous-chaîne du nom > tokens, max 30 résultats
   Aliment (pour 100 g) : { id, name, state, category, kcal, protein,
   carbs, fat, gramsPerUnit?, density?, unitLabel?, synonyms? }
   ================================================================== */

let pending = null;
let list = [];
let byId = new Map();
let foodVariants = new Map();
let familyById = new Map();

/** normalisation partagée requête/index : œ→oe, NFD, minuscules. */
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function prepare(foods) {
  list = foods;
  byId = new Map();
  foodVariants = new Map();
  familyById = new Map();
  for (const f of foods) {
    f._n = norm(f.name);
    const prep = preparationOf(f.state);
    f._s = norm([f.synonyms, f.category, f.state, prep === 'raw' ? 'raw' : prep === 'cooked' ? 'cooked' : ''].filter(Boolean).join(' '));
    byId.set(f.id, f);
    if (prep){
      const key = variantKey(f);
      if (!foodVariants.has(key)) foodVariants.set(key, { raw: [], cooked: [] });
      foodVariants.get(key)[prep].push(f);
    }
  }
  for (const family of foodVariants.values()){
    if (!family.raw.length || !family.cooked.length) continue;
    family.raw.forEach(f => familyById.set(f.id, family));
    family.cooked.forEach(f => familyById.set(f.id, family));
  }
  return foods;
}

function preparationOf(state){
  const value = norm(state);
  if (/(^|\s)(cru|raw|sec|dried)(\s|$)/.test(value)) return 'raw';
  if (/(^|\s)(cuit|cooked)(\s|$)/.test(value)) return 'cooked';
  return null;
}

function variantKey(food){ return norm(food.name) + '\u0000' + norm(food.category); }

function preferredVariant(food, preparation){
  if (!food) return food;
  const family = familyById.get(food.id);
  if (!family) return food;
  const selected = preparation === 'raw' ? 'raw' : 'cooked';
  return (family[selected] && family[selected][0]) || food;
}

/** Replace paired raw/cooked records with one row using the chosen default. */
export function collapseFoodVariants(rows, preparation = 'cooked'){
  const seen = new Set();
  const result = [];
  for (const item of rows || []){
    const food = item && item.f ? item.f : item;
    if (!food) continue;
    if (!familyById.has(food.id)){ result.push(item); continue; }
    const key = variantKey(food);
    if (seen.has(key)) continue;
    seen.add(key);
    const chosen = preferredVariant(food, preparation);
    result.push(item && item.f ? Object.assign({}, item, { f: chosen }) : chosen);
  }
  return result;
}

/** Promesse unique : fetch data/foods.json puis index en mémoire. */
export function loadFoods() {
  if (!pending) {
    pending = fetch('./data/foods.json')
      .then((r) => {
        if (!r.ok) throw new Error('foods.json HTTP ' + r.status);
        return r.json();
      })
      .then((j) => prepare(Array.isArray(j.foods) ? j.foods : []))
      .catch((e) => {
        pending = null; // retry possible
        throw e;
      });
  }
  return pending;
}

export function getFood(id) {
  return byId.get(id) || null;
}

export function allFoods() {
  return list;
}

/**
 * Recherche : tokens (ET) sur nom + synonymes + catégorie + état,
 * classement préfixe > sous-chaîne > tokens épars, puis longueur/nom.
 * Renvoie au plus `limit` (30) aliments. Nécessite loadFoods() résolu.
 */
export function searchFoods(q, limit = 30, preparation = 'cooked') {
  const tokens = norm(q).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || !list.length) return [];
  const full = tokens.join(' ');
  const requestedPreparation = tokens.some(t => ['cru', 'raw', 'sec', 'dried'].includes(t))
    ? 'raw'
    : tokens.some(t => ['cuit', 'cooked'].includes(t)) ? 'cooked' : preparation;
  const hits = [];
  for (const f of list) {
    const hay = f._n + ' ' + f._s;
    if (!tokens.every((t) => hay.includes(t))) continue;
    let score = 2;
    if (f._n.startsWith(full)) score = 0;
    else if (f._n.includes(full)) score = 1;
    hits.push({ f, score, len: f._n.length });
  }
  hits.sort((a, b) => a.score - b.score || a.len - b.len || (a.f._n < b.f._n ? -1 : 1));
  const unique = new Set();
  const selected = [];
  for (const hit of hits){
    const f = preferredVariant(hit.f, requestedPreparation);
    const key = familyById.has(f.id) ? variantKey(f) : f.id;
    if (unique.has(key)) continue;
    unique.add(key);
    selected.push(f);
    if (selected.length >= limit) break;
  }
  return selected;
}

window.LiftrFoods = { load: loadFoods, search: searchFoods, get: getFood, all: allFoods, norm, collapseVariants: collapseFoodVariants };
