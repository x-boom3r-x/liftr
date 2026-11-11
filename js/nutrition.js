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

/* ---- M2 : objectif custom (cible personnalisée) ---- */
/** Presets de macros en % des kcal (somme = 100). */
export const MACRO_PRESETS = {
  balanced:    { label: 'Balanced',     p: 30, c: 40, f: 30 },
  highprotein: { label: 'High protein', p: 40, c: 30, f: 30 },
  cutting:     { label: 'Cutting',      p: 35, c: 35, f: 30 },
  lowcarb:     { label: 'Low carb',     p: 40, c: 15, f: 45 },
  keto:        { label: 'Keto',         p: 25, c:  5, f: 70 }
};

/** Macros depuis des pourcentages de kcal. La somme est normalisée (jamais bloquée). */
export function targetsFromPercent({ kcal, pPct, cPct, fPct }) {
  const p = +pPct || 0, c = +cPct || 0, f = +fPct || 0;
  const sum = p + c + f;
  if (!(kcal > 0) || !(sum > 0)) return { protein: 0, carbs: 0, fat: 0, pctSum: sum };
  return {
    protein: Math.round((kcal * p / sum / KCAL_PER.protein)),
    carbs: Math.round((kcal * c / sum / KCAL_PER.carbs)),
    fat: Math.round((kcal * f / sum / KCAL_PER.fat)),
    pctSum: sum
  };
}

/** Macros depuis g/kg : protéines + lipides saisis, glucides = reste (kcal restantes / 4). */
export function targetsFromPerKg({ kcal, weightKg, pPerKg, fPerKg }) {
  const w = +weightKg || 0;
  const protein = (+pPerKg || 0) * w;
  const fat = (+fPerKg || 0) * w;
  const carbs = Math.max(0, ((+kcal || 0) - protein * KCAL_PER.protein - fat * KCAL_PER.fat) / KCAL_PER.carbs);
  return { protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat) };
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

/* Canonical nutrient shape follows OpenNutriTracker's documented 24-field
   food model. Optional values stay null when the source did not provide them;
   a missing nutrient is never presented as a measured zero. */
export const NUTRIENT_FIELDS = [
  'kcal', 'carbs', 'fat', 'protein', 'sugar', 'saturated_fat', 'fiber',
  'monounsaturated_fat', 'polyunsaturated_fat', 'trans_fat',
  'cholesterol_mg', 'sodium_mg', 'potassium_mg', 'magnesium_mg',
  'calcium_mg', 'iron_mg', 'zinc_mg', 'phosphorus_mg', 'vitamin_a_ug',
  'vitamin_c_mg', 'vitamin_d_ug', 'vitamin_b6_mg', 'vitamin_b12_ug',
  'niacin_mg'
];

export const TRACKED_MICRONUTRIENTS = [
  { field: 'fiber', label: 'Fiber', unit: 'g' },
  { field: 'sodium_mg', label: 'Sodium', unit: 'mg' },
  { field: 'saturated_fat', label: 'Saturated fat', unit: 'g' },
  { field: 'sugar', label: 'Sugar', unit: 'g' },
  { field: 'calcium_mg', label: 'Calcium', unit: 'mg' },
  { field: 'iron_mg', label: 'Iron', unit: 'mg' },
  { field: 'potassium_mg', label: 'Potassium', unit: 'mg' },
  { field: 'vitamin_d_ug', label: 'Vitamin D', unit: 'µg' },
  { field: 'vitamin_b12_ug', label: 'Vitamin B12', unit: 'µg' },
  { field: 'magnesium_mg', label: 'Magnesium', unit: 'mg' }
];

export const OPTIONAL_NUTRIENT_META = [
  { field: 'fiber', label: 'Fiber', unit: 'g' },
  { field: 'sugar', label: 'Sugar', unit: 'g' },
  { field: 'saturated_fat', label: 'Saturated fat', unit: 'g' },
  { field: 'monounsaturated_fat', label: 'Monounsaturated fat', unit: 'g' },
  { field: 'polyunsaturated_fat', label: 'Polyunsaturated fat', unit: 'g' },
  { field: 'trans_fat', label: 'Trans fat', unit: 'g' },
  { field: 'cholesterol_mg', label: 'Cholesterol', unit: 'mg' },
  { field: 'sodium_mg', label: 'Sodium', unit: 'mg' },
  { field: 'potassium_mg', label: 'Potassium', unit: 'mg' },
  { field: 'magnesium_mg', label: 'Magnesium', unit: 'mg' },
  { field: 'calcium_mg', label: 'Calcium', unit: 'mg' },
  { field: 'iron_mg', label: 'Iron', unit: 'mg' },
  { field: 'zinc_mg', label: 'Zinc', unit: 'mg' },
  { field: 'phosphorus_mg', label: 'Phosphorus', unit: 'mg' },
  { field: 'vitamin_a_ug', label: 'Vitamin A', unit: 'µg' },
  { field: 'vitamin_c_mg', label: 'Vitamin C', unit: 'mg' },
  { field: 'vitamin_d_ug', label: 'Vitamin D', unit: 'µg' },
  { field: 'vitamin_b6_mg', label: 'Vitamin B6', unit: 'mg' },
  { field: 'vitamin_b12_ug', label: 'Vitamin B12', unit: 'µg' },
  { field: 'niacin_mg', label: 'Niacin (B3)', unit: 'mg' }
];

const OPTIONAL_FIELDS = new Set(OPTIONAL_NUTRIENT_META.map(x => x.field));
const ZERO = () => Object.fromEntries(NUTRIENT_FIELDS.map(field =>
  [field, OPTIONAL_FIELDS.has(field) ? null : 0]));
const FOOD_ALIASES = {
  protein: 'p', carbs: 'c', fat: 'f', sodium_mg: 'sodium'
};

export function nutrientsFor(food, qty, unit = 'g') {
  const k = toGrams(food, qty, unit) / 100, out = ZERO();
  for (const field of NUTRIENT_FIELDS){
    const raw = food[field] != null ? food[field] : food[FOOD_ALIASES[field]];
    if (raw == null || raw === ''){
      out[field] = OPTIONAL_FIELDS.has(field) ? null : 0;
      continue;
    }
    const value = +raw;
    out[field] = Number.isFinite(value) ? value * k : (OPTIONAL_FIELDS.has(field) ? null : 0);
  }
  return out;
}

export function sumNutrients(list) {
  const out = ZERO();
  for (const n of list) for (const field of NUTRIENT_FIELDS){
    const value = n && n[field];
    if (value == null || !Number.isFinite(+value)) continue;
    out[field] = out[field] == null ? +value : out[field] + +value;
  }
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
  const per100 = {}; for (const field of NUTRIENT_FIELDS)
    per100[field] = total[field] == null ? null : (total[field] / w) * 100;
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

/* ---------- 5. objectifs additionnels (eau, fibres) — chantier Nutrition ---------- */

/**
 * Hydratation quotidienne : ~35 ml / kg (fourchette 1,5–4 L), arrondie à 100 ml.
 * Simple heuristique populaire, pas un avis médical.
 */
export function waterGoalMl({ weightKg }) {
  const w = +weightKg || 0;
  if (!(w > 0)) return 2000;
  return Math.min(4000, Math.max(1500, Math.round((w * 35) / 100) * 100));
}

/** Fibres : ~14 g pour 1 000 kcal (apport usuel), arrondi à l'entier. */
export function fiberTargetG(kcal) {
  const k = +kcal || 0;
  return k > 0 ? Math.round((k / 1000) * 14) : 0;
}
