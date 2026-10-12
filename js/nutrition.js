/* ==================================================================
   nutrition.js — calculs purs (aucun DOM, aucun stockage) : testables.

   Flux : profil (poids actuel, taille, âge, sexe, activité, objectif)
          -> BMR -> dépense totale (TDEE) -> objectif kcal -> macros
          repas = liste d'ingrédients { food, qty, unit } -> totaux
          journée = repas -> totaux -> progression vs objectif (barre)

   Les valeurs nutritionnelles d'un aliment sont TOUJOURS pour 100 g (ou 100 ml) :
     food = { id, name, kcal, protein, carbs, fat, fiber?, sugar?, sodium_mg?,
              gramsPerUnit?:{ piece:50, tbsp:15, cup:240 }, density?: 1.0 }
   ================================================================== */

export const ACTIVITY = {
  sedentary: 1.2,      // bureau, peu de sport
  light: 1.375,        // 1-3 séances / semaine
  moderate: 1.55,      // 3-5 séances / semaine
  active: 1.725,       // 6-7 séances / semaine
  very_active: 1.9,    // physique + 2 séances / jour
};

const KCAL_PER = { protein: 4, carbs: 4, fat: 9, alcohol: 7 };
const KCAL_PER_KG_FAT = 7700;   // approximation classique, sert aux projections

export const round = (v, d = 0) => { const k = 10 ** d; return Math.round((+v + Number.EPSILON) * k) / k; };

/* ---------- 1. dépense énergétique ---------- */

/** Mifflin-St Jeor (réf. la plus fiable pour la population générale). */
export function bmrMifflin({ sex, weightKg, heightCm, age }) {
  if (!(weightKg > 0) || !(heightCm > 0) || !(age > 0)) throw new RangeError('weightKg, heightCm, age requis (> 0)');
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return base + (sex === 'female' ? -161 : 5);
}

/** Katch-McArdle si le % de masse grasse est connu (plus précis pour sportifs). */
export function bmrKatch({ weightKg, bodyFatPct }) {
  const lbm = weightKg * (1 - bodyFatPct / 100);
  return 370 + 21.6 * lbm;
}

export function tdee(bmr, activity = 'moderate') {
  const f = typeof activity === 'number' ? activity : ACTIVITY[activity];
  if (!f) throw new RangeError('niveau d\'activité inconnu : ' + activity);
  return bmr * f;
}

/* ---------- 2. objectif calorique + macros ---------- */

/**
 * goal : 'lose' | 'maintain' | 'gain'
 * rateKgPerWeek : vitesse visée (>0). Perte plafonnée à 1 % du poids/semaine,
 *                 prise à 0,5 % (au-delà : surtout du gras).
 * Garde-fous : jamais sous max(BMR, plancher). Plancher 1500 (H) / 1200 (F).
 */
export function calorieTarget({ tdee: t, bmr, goal = 'maintain', rateKgPerWeek = 0.5, weightKg, sex }) {
  const floor = Math.max(bmr || 0, sex === 'female' ? 1200 : 1500);
  const notes = [];
  let kcal = t;
  if (goal === 'lose') {
    const rate = Math.min(rateKgPerWeek, weightKg * 0.01);
    kcal = t - (rate * KCAL_PER_KG_FAT) / 7;
    if (rate < rateKgPerWeek) notes.push('rate_capped');
  } else if (goal === 'gain') {
    const rate = Math.min(rateKgPerWeek, weightKg * 0.005);
    kcal = t + (rate * KCAL_PER_KG_FAT) / 7;
    if (rate < rateKgPerWeek) notes.push('rate_capped');
  }
  if (kcal < floor) { kcal = floor; notes.push('floor_applied'); }
  return { kcal: Math.round(kcal), notes };
}

/** Protéines 1,6-2,2 g/kg selon l'objectif, lipides ≥ 0,6 g/kg et ~25 % des kcal, glucides = reste. */
export function macroTargets({ kcal, weightKg, goal = 'maintain' }) {
  const pPerKg = goal === 'lose' ? 2.2 : goal === 'gain' ? 1.8 : 1.8;
  const protein = pPerKg * weightKg;
  const fat = Math.max(0.6 * weightKg, (kcal * 0.25) / KCAL_PER.fat);
  const carbsKcal = Math.max(0, kcal - protein * KCAL_PER.protein - fat * KCAL_PER.fat);
  return { protein: Math.round(protein), fat: Math.round(fat), carbs: Math.round(carbsKcal / KCAL_PER.carbs) };
}

/** Tout en un depuis le profil. */
export function buildPlan(profile) {
  const { sex, weightKg, heightCm, age, activity = 'moderate', goal = 'maintain', rateKgPerWeek = 0.5, bodyFatPct } = profile;
  const bmr = bodyFatPct > 0 ? bmrKatch({ weightKg, bodyFatPct }) : bmrMifflin({ sex, weightKg, heightCm, age });
  const t = tdee(bmr, activity);
  const { kcal, notes } = calorieTarget({ tdee: t, bmr, goal, rateKgPerWeek, weightKg, sex });
  return { bmr: Math.round(bmr), tdee: Math.round(t), kcal, macros: macroTargets({ kcal, weightKg, goal }), notes };
}

/** Projection (indicative) du poids dans N semaines selon le déficit/surplus réel. */
export function projectWeight({ weightKg, tdee: t, kcalPerDay, weeks }) {
  return round(weightKg + ((kcalPerDay - t) * 7 * weeks) / KCAL_PER_KG_FAT, 1);
}

/* ---------- 3. aliments, ingrédients, repas ---------- */

export const UNITS = ['g', 'ml', 'piece', 'tbsp', 'tsp', 'cup'];
const DEFAULT_GRAMS = { tbsp: 15, tsp: 5, cup: 240 };

/** Quantité -> grammes. Lance une erreur explicite plutôt que de deviner. */
export function toGrams(food, qty, unit = 'g') {
  if (!(qty >= 0)) throw new RangeError('quantité invalide');
  if (unit === 'g') return qty;
  if (unit === 'ml') return qty * (food.density || 1);
  const per = food.gramsPerUnit?.[unit] ?? DEFAULT_GRAMS[unit];
  if (!per) throw new RangeError(`"${food.name}" : poids d'une unité "${unit}" inconnu (gramsPerUnit.${unit})`);
  return qty * per;
}

const ZERO = () => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0, sodium_mg: 0 });
const FIELDS = Object.keys(ZERO());

export function nutrientsFor(food, qty, unit = 'g') {
  const k = toGrams(food, qty, unit) / 100, out = ZERO();
  for (const f of FIELDS) out[f] = (food[f] || 0) * k;
  return out;
}

export function sumNutrients(list) {
  const out = ZERO();
  for (const n of list) for (const f of FIELDS) out[f] += n[f] || 0;
  return out;
}

/** meal = { name, items:[{ food, qty, unit }] } */
export function mealTotals(meal) {
  const lines = meal.items.map(it => ({ item: it, grams: toGrams(it.food, it.qty, it.unit), n: nutrientsFor(it.food, it.qty, it.unit) }));
  return { lines, total: sumNutrients(lines.map(l => l.n)) };
}

export function dayTotals(meals) { return sumNutrients(meals.map(m => mealTotals(m).total)); }

/** Recette : ingrédients -> aliment "pour 100 g" réutilisable (ex. "Mon porridge"). */
export function recipeToFood({ id, name, items, cookedWeightG }) {
  const { lines, total } = mealTotals({ items });
  const w = cookedWeightG || lines.reduce((s, l) => s + l.grams, 0);
  const per100 = {}; for (const f of FIELDS) per100[f] = (total[f] / w) * 100;
  return { id, name, ...per100, gramsPerUnit: { piece: w } };
}

/** Contrôle de cohérence d'une ligne de base de données (import Excel) : kcal ≈ 4P + 4C + 9F. */
export function atwaterCheck(food, tolerance = 0.15) {
  const calc = 4 * (food.protein || 0) + 4 * (food.carbs || 0) + 9 * (food.fat || 0);
  const stated = food.kcal || 0;
  if (calc === 0 && stated === 0) return { ok: true, calc, stated, diff: 0 };
  const ref = Math.max(calc, stated, 1);
  const diff = Math.abs(calc - stated) / ref;
  // les aliments riches en fibres / alcool / polyols s'écartent légitimement
  return { ok: diff <= tolerance || Math.abs(calc - stated) <= 12, calc: round(calc), stated, diff: round(diff, 2) };
}

/* ---------- 4. progression de la journée (barre) ---------- */

/**
 * status : 'under' (< 90 %) | 'ok' (90-105 %) | 'over' (> 105 %)
 * pct est borné à 100 pour la barre ; overBy dit de combien on dépasse.
 */
export function progress(consumed, target) {
  if (!(target > 0)) return { pct: 0, ratio: 0, remaining: 0, overBy: 0, status: 'under' };
  const ratio = consumed / target;
  return {
    ratio: round(ratio, 3),
    pct: Math.min(100, round(ratio * 100)),
    remaining: Math.max(0, Math.round(target - consumed)),
    overBy: Math.max(0, Math.round(consumed - target)),
    status: ratio > 1.05 ? 'over' : ratio >= 0.9 ? 'ok' : 'under',
  };
}

export function dayProgress(totals, plan) {
  return {
    kcal: progress(totals.kcal, plan.kcal),
    protein: progress(totals.protein, plan.macros.protein),
    carbs: progress(totals.carbs, plan.macros.carbs),
    fat: progress(totals.fat, plan.macros.fat),
  };
}

/** Bilan hebdo : moyenne, jours dans la cible (±10 %), régularité. */
export function weekSummary(days, targetKcal) {
  const logged = days.filter(d => d.kcal > 0);
  if (!logged.length) return { loggedDays: 0, avgKcal: 0, daysOnTarget: 0, avgDeltaKcal: 0 };
  const avg = logged.reduce((s, d) => s + d.kcal, 0) / logged.length;
  return {
    loggedDays: logged.length,
    avgKcal: Math.round(avg),
    daysOnTarget: logged.filter(d => Math.abs(d.kcal - targetKcal) <= targetKcal * 0.1).length,
    avgDeltaKcal: Math.round(avg - targetKcal),
  };
}

/**
 * Ajuste l'objectif d'après l'évolution RÉELLE du poids (tendance lissée) :
 * si le poids ne bouge pas comme prévu depuis ≥ 14 jours, on corrige de max ±150 kcal.
 */
export function adaptiveAdjustment({ goal, expectedKgPerWeek, observedKgPerWeek, days }) {
  if (days < 14) return { deltaKcal: 0, reason: 'not_enough_data' };
  const exp = goal === 'lose' ? -Math.abs(expectedKgPerWeek) : goal === 'gain' ? Math.abs(expectedKgPerWeek) : 0;
  const errKgWk = observedKgPerWeek - exp;
  const delta = (Math.max(-150, Math.min(150, Math.round(-(errKgWk * KCAL_PER_KG_FAT) / 7 / 2 / 10) * 10))) || 0;   // || 0 : évite -0
  return { deltaKcal: delta, reason: Math.abs(delta) < 30 ? 'on_track' : 'adjust' };
}
