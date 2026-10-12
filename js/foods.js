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
  for (const f of foods) {
    f._n = norm(f.name);
    f._s = norm([f.synonyms, f.category, f.state].filter(Boolean).join(' '));
    byId.set(f.id, f);
  }
  return foods;
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
export function searchFoods(q, limit = 30) {
  const tokens = norm(q).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length || !list.length) return [];
  const full = tokens.join(' ');
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
  return hits.slice(0, limit).map((h) => h.f);
}

window.LiftrFoods = { load: loadFoods, search: searchFoods, get: getFood, all: allFoods, norm };
