/* ==================================================================
   NUTRITION (chantier F + J2 + J3) — Today / Meals / Foods / Goal / Week
   Données locales dans DB.nutri : { profile, goal, foods, meals,
   favs, recents } — Rien de réseau : 100 % offline-first.
   J2 : profil -> buildPlan -> objectif auto, garde-fous, poids unique.
   J3 : ecrans (kcal-card/pbar, builder repas foodId+qty, aliments
   per-100 g, semaine) — totaux TOUJOURS recalculés à l'affichage.
   ================================================================== */
import { buildPlan, macroTargets, projectWeight, adaptiveAdjustment,
  UNITS, nutrientsFor, toGrams, sumNutrients, recipeToFood, atwaterCheck,
  progress, weekSummary, MACRO_PRESETS, targetsFromPercent, targetsFromPerKg,
  waterGoalMl, fiberTargetG, NUTRIENT_FIELDS, TRACKED_MICRONUTRIENTS,
  OPTIONAL_NUTRIENT_META } from './nutrition.js';
import { loadFoods, searchFoods, getFood as getDbFood, allFoods, norm } from './foods.js';
import { searchRemote, importRemoteFood, isBarcodeFormat } from './nutri-remote.js';
import { icon, iconS } from './icons.js';
import './nutri-scan.js';   /* attache openScanner/closeScanner aux boutons onclick */

function nutriDB(){
  if (!window.DB) return null;
  if (!DB.nutri || typeof DB.nutri !== 'object') DB.nutri = {};
  const n = DB.nutri;
  if (!n.goal || typeof n.goal !== 'object') n.goal = { kcal: 0, p: 0, c: 0, f: 0 };
  if (!Array.isArray(n.foods)) n.foods = [];
  if (!Array.isArray(n.meals)) n.meals = [];
  if (!Array.isArray(n.favs)) n.favs = [];
  if (!Array.isArray(n.recents)) n.recents = [];
  if (!Array.isArray(n.recipes)) n.recipes = [];
  if (n.foodPreparation !== 'raw' && n.foodPreparation !== 'cooked') n.foodPreparation = 'cooked';
  if (!n.water || typeof n.water !== 'object') n.water = {};
  n.meals.forEach(m => { if (!Array.isArray(m.items)) m.items = []; });
  /* aliments persos legacy (p/c/f) -> noms nutrition.js (per 100 g) */
  n.foods.forEach(f => {
    if (f && f.protein === undefined && f.p !== undefined) f.protein = +f.p || 0;
    if (f && f.carbs === undefined && f.c !== undefined) f.carbs = +f.c || 0;
    if (f && f.fat === undefined && f.f !== undefined) f.fat = +f.f || 0;
  });
  return n;
}

function nutriFoodPreparation(){
  const n = nutriDB();
  return n && n.foodPreparation === 'raw' ? 'raw' : 'cooked';
}

function saveNutriFoodPreparation(value){
  const n = nutriDB();
  if (!n) return;
  n.foodPreparation = value === 'raw' ? 'raw' : 'cooked';
  save();
  if (currentTab === 'nutri-foods') renderNutriFoods();
  else if (currentTab === 'nutri-meals') renderNutriMeals();
  toast('Food values set to ' + n.foodPreparation);
}

/* Keep the nutrient values that were used when a food was logged. This is
   the diary snapshot model used by OpenNutriTracker: later database edits or
   deleting a custom food must not rewrite an old meal. */
function nutrientSnapshot(food){
  if (!food) return null;
  const snapshot = {
    id: food.id || '', name: food.name || 'Food', source: food.source || 'custom',
    barcode: food.barcode || '', brands: food.brands || ''
  };
  /* Portion-based diary lines must remain reproducible after a food is
     renamed, removed, or its reference data changes. */
  if (food.gramsPerUnit && typeof food.gramsPerUnit === 'object')
    snapshot.gramsPerUnit = Object.assign({}, food.gramsPerUnit);
  if (Number.isFinite(+food.density) && +food.density > 0) snapshot.density = +food.density;
  if (Array.isArray(food.portions)) snapshot.portions = food.portions.map(p => Object.assign({}, p));
  NUTRIENT_FIELDS.forEach(field => {
    const aliases = { protein: 'p', carbs: 'c', fat: 'f', sodium_mg: 'sodium' };
    const value = food[field] != null ? food[field] : food[aliases[field]];
    if (value != null && value !== '' && Number.isFinite(+value)) snapshot[field] = +value;
  });
  return snapshot;
}
function foodItem(food, qty, unit){
  return { foodId: food.id, qty: +qty || 0, unit: unit || 'g', name: food.name,
    snapshot: nutrientSnapshot(food), snapshotVersion: 1 };
}

let nutriForm = null;   /* 'meal' | 'food' | null */
let nutriViewDate = null;   /* jour affiche dans Meals (null = aujourd'hui) */
let nutriRemoteState = { q: '', foods: [], loading: false, empty: false };
let _remoteTimer = null;

/* ---- multi-jour : jour affiche dans Meals (null = aujourd'hui) ---- */
function shiftISO(iso, n){
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  const p = x => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function nutriDate(){ return nutriViewDate || todayISO(); }
function nutriSetDate(iso){ nutriViewDate = (iso && iso !== todayISO()) ? iso : null; }
function nutriShiftDate(delta){ nutriSetDate(shiftISO(nutriDate(), delta)); }
function nutriIsToday(){ return nutriDate() === todayISO(); }

/* barre de navigation par jour (Meals) : ◀ date ▶ [Today] */
function nutriDateNavHtml(){
  const iso = nutriDate();
  const dt = new Date(iso + 'T12:00:00');
  const wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()];
  const label = wd + ' ' + iso.slice(8) + '/' + iso.slice(5, 7);
  const todayChip = nutriIsToday()
    ? '<span class="date-nav-today">Today</span>'
    : '<button class="chip" onclick="nutriGotoToday()">Today</button>';
  const next = nutriIsToday()
    ? '<button class="icon-btn" disabled aria-label="Next day">›</button>'
    : '<button class="icon-btn" onclick="nutriNextDay()" aria-label="Next day">›</button>';
  return '<div class="date-nav">' +
    '<button class="icon-btn" onclick="nutriPrevDay()" aria-label="Previous day">‹</button>' +
    '<span class="date-nav-label">' + label + '</span>' + next + todayChip + '</div>';
}
function nutriPrevDay(){ nutriShiftDate(-1); renderNutriMeals(); }
function nutriNextDay(){ if (!nutriIsToday()){ nutriShiftDate(1); renderNutriMeals(); } }
function nutriGotoToday(){ nutriSetDate(todayISO()); renderNutriMeals(); }

/* ---- hydratation (DB.nutri.water : { 'YYYY-MM-DD': ml }) ---- */
function nutriWaterMl(date){
  const n = nutriDB();
  return n && n.water ? (+n.water[date] || 0) : 0;
}
function nutriWaterGoal(){
  const w = nutriWeight();
  const n = nutriDB();
  if (n && n.profile && +n.profile.waterGoalMl > 0) return +n.profile.waterGoalMl;
  return waterGoalMl({ weightKg: w });
}
function setWaterGoalMl(ml){
  const n = nutriDB();
  if (!n) return;
  nutriProfile().waterGoalMl = Math.max(0, Math.round(+ml || 0));
  save();
}
function saveWaterGoal(){
  const el = $('waterGoalInput');
  if (el) setWaterGoalMl(+el.value);
  renderNutriGoal();
  toast('Water goal saved');
}
/* delta en ml ; borne a [0, 24*200] (coherence) */
function addWater(delta){
  const n = nutriDB();
  if (!n) return;
  const date = todayISO();
  const cur = nutriWaterMl(date);
  const next = Math.max(0, Math.min(24000, cur + (+delta || 0)));
  n.water[date] = next;
  save();
  renderNutrition(currentTab);
  if (typeof window.renderToday === 'function') window.renderToday();
}
function logWater(ml){ addWater(+ml || 0); }

/* Objectif fibres du jour (g) depuis l'objectif actif. */
function nutriFiberGoal(){
  const g = nutriActiveGoal(true);
  return g && g.kcal > 0 ? fiberTargetG(g.kcal) : 0;
}

/* Carte hydratation (Today). Boutons +250 / +500 / −250 ; compteur de verres. */
function nutriWaterCardHtml(date){
  const ml = nutriWaterMl(date);
  const goal = nutriWaterGoal();
  const pr = progress(ml, goal);
  const glasses = Math.round(ml / 250);
  return '<div class="card water-card">' +
    '<div class="water-top"><span class="water-label">Water</span>' +
    '<span class="water-val"><b>' + ml + '</b> / ' + goal + ' ml</span></div>' +
    '<div class="pbar ' + pr.status + '" role="progressbar" aria-label="Water"' +
    ' aria-valuemin="0" aria-valuemax="' + goal + '" aria-valuenow="' + ml + '">' +
    '<i style="width:' + pr.pct + '%"></i></div>' +
    '<div class="water-actions">' +
    '<button class="chip" onclick="addWater(-250)" aria-label="Remove 250 ml">−</button>' +
    '<button class="chip water-add" onclick="addWater(250)">+ 250 ml</button>' +
    '<button class="chip" onclick="addWater(500)">+ 500</button>' +
    '<span class="water-glasses">' + glasses + ' glass' + (glasses === 1 ? '' : 'es') + '</span>' +
    '</div></div>';
}

/* ---- J2 : profil, poids, plan ---- */
function nutriProfile(){
  const n = nutriDB();
  if (!n) return null;
  if (!n.profile || typeof n.profile !== 'object') n.profile = {};
  const p = n.profile;
  p.sex = p.sex === 'female' ? 'female' : 'male';
  p.goal = (p.goal === 'lose' || p.goal === 'gain') ? p.goal : 'maintain';
  p.activity = ['sedentary', 'light', 'moderate', 'active', 'very_active'].indexOf(p.activity) >= 0 ? p.activity : 'moderate';
  if (!(+p.rateKgPerWeek > 0)) p.rateKgPerWeek = 0.5;
  p.heightCm = +p.heightCm || 0;
  p.age = +p.age || 0;
  p.bodyFatPct = +p.bodyFatPct || 0;
  p.kcalOffset = +p.kcalOffset || 0;
  return p;
}

/* Poids actuel = dernière pesée du suivi existant (DB.weightLog) — source unique. */
function nutriWeight(){
  const log = (window.DB && Array.isArray(DB.weightLog)) ? DB.weightLog : [];
  let last = null;
  for (const e of log){
    if (!e || !(+e.kg > 0)) continue;
    if (!last || String(e.date) >= String(last.date)) last = e;
  }
  return last ? +last.kg : 0;
}

/* Plan calculé ; null si profil/poids incomplet (jamais d'exception fuyante). */
function nutriPlan(){
  const p = nutriProfile();
  const weightKg = nutriWeight();
  if (!p || !(p.heightCm > 0) || !(p.age > 0) || !(weightKg > 0)) return null;
  try {
    return buildPlan({
      sex: p.sex, weightKg: weightKg, heightCm: p.heightCm, age: p.age,
      activity: p.activity, goal: p.goal, rateKgPerWeek: p.rateKgPerWeek,
      bodyFatPct: p.bodyFatPct > 0 ? p.bodyFatPct : undefined
    });
  } catch (e) { return null; }
}

/* ---- M2 : objectif custom (DB.nutri.custom) ----
   mode 'auto' (défaut, plan J2 inchangé) ou 'custom'.
   kcal : TDEE ± delta, ou manuel. Macros : preset, %, ou g/kg. */
function nutriCustomDefault(){
  return { mode: 'auto', kcalMode: 'tdee', kcalDelta: 0, kcalManual: 0,
    macroMode: 'preset', preset: 'balanced',
    pPct: 30, cPct: 40, fPct: 30, pPerKg: 2.0, fPerKg: 0.8 };
}

/* Cible custom ou null (incomplète / off). Pure par rapport à DB.nutri.custom. */
function nutriCustomGoal(){
  const n = nutriDB();
  const cu = n && n.custom;
  if (!cu || cu.mode !== 'custom') return null;
  const p = nutriProfile();
  const plan = nutriPlan();
  const w = nutriWeight();
  /* calories */
  let kcal;
  if (cu.kcalMode === 'manual'){
    kcal = Math.round(+cu.kcalManual || 0);
    if (!(kcal > 0)) return null;
  } else {
    if (!plan) return null;
    const floor = Math.max(plan.bmr, p.sex === 'female' ? 1200 : 1500);
    kcal = Math.max(Math.round(plan.tdee + (+cu.kcalDelta || 0)), floor);
  }
  /* macros */
  let m;
  if (cu.macroMode === 'percent'){
    m = targetsFromPercent({ kcal: kcal, pPct: cu.pPct, cPct: cu.cPct, fPct: cu.fPct });
  } else if (cu.macroMode === 'perkg'){
    if (!(w > 0) || !(+cu.pPerKg > 0)) return null;
    m = targetsFromPerKg({ kcal: kcal, weightKg: w, pPerKg: cu.pPerKg, fPerKg: cu.fPerKg });
  } else {
    const pr = MACRO_PRESETS[cu.preset] || MACRO_PRESETS.balanced;
    m = targetsFromPercent({ kcal: kcal, pPct: pr.p, cPct: pr.c, fPct: pr.f });
  }
  return { kcal: kcal, p: m.protein, c: m.carbs, f: m.fat };
}

/* Objectif actif : custom > plan du profil (recalculé à chaque lecture
   -> suit le poids) > objectif manuel saisi dans le formulaire Goal.
   sync=true : réécrit DB.nutri.goal si la cible a bougé (persistance/export). */
function nutriActiveGoal(sync){
  const n = nutriDB();
  if (!n) return { kcal: 0, p: 0, c: 0, f: 0 };
  let g = nutriCustomGoal();
  if (!g){
    const plan = nutriPlan();
    if (!plan) return n.goal;
    const p = nutriProfile();
    const floor = Math.max(plan.bmr, p.sex === 'female' ? 1200 : 1500);
    const kcal = Math.max(plan.kcal + p.kcalOffset, floor);
    const m = macroTargets({ kcal: kcal, weightKg: nutriWeight(), goal: p.goal });
    g = { kcal: kcal, p: m.protein, c: m.carbs, f: m.fat };
  }
  if (sync){
    const cur = nutriDB().goal;
    if (cur.kcal !== g.kcal || cur.p !== g.p || cur.c !== g.c || cur.f !== g.f){
      nutriDB().goal = g;
      save();
    }
  }
  return g;
}

/* Ajustement adaptatif proposé (jamais imposé) : réécart réel vs attendu, ≥ 14 jours. */
function nutriAdaptive(){
  if (!nutriPlan()) return null;
  const log = ((window.DB && Array.isArray(DB.weightLog)) ? DB.weightLog : [])
    .filter(e => e && +e.kg > 0)
    .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (log.length < 2) return null;
  const d0 = Date.parse(log[0].date), d1 = Date.parse(log[log.length - 1].date);
  if (!(d1 > d0)) return null;
  const days = Math.round((d1 - d0) / 86400000);
  const observed = (+log[log.length - 1].kg - +log[0].kg) / (days / 7);
  const p = nutriProfile();
  const expected = p.goal === 'lose' ? -p.rateKgPerWeek : p.goal === 'gain' ? p.rateKgPerWeek : 0;
  const res = adaptiveAdjustment({ goal: p.goal, expectedKgPerWeek: expected, observedKgPerWeek: observed, days: days });
  if (!res || res.reason !== 'adjust' || !res.deltaKcal) return null;
  /* deja applique aujourd'hui : on ne redemande pas le meme ajustement */
  if (p.adaptApplied && p.adaptApplied.delta === res.deltaKcal && p.adaptApplied.on === todayISO()) return null;
  return res;
}

/* ---- dispatch depuis showTab ---- */
function renderNutrition(tab){
  const n = nutriDB();
  if (!n) return;
  if (tab === 'nutri-today') renderNutriToday();
  if (tab === 'nutri-meals') renderNutriMeals();
  if (tab === 'nutri-foods') renderNutriFoods();
  if (tab === 'nutri-goal') renderNutriGoal();
  if (tab === 'nutri-week') renderNutriWeek();
}

function openNutriTransfer(){
  openActionSheet('Diary backup & restore', [
    { label: 'Export diary file', fn: exportNutriOpenTracker },
    { label: 'Import diary file', fn: openNutriOpenTrackerImport }
  ]);
}

/* ---- J3 : resolution foodId -> aliment, totaux recalcules ----
   Un repas stocke {foodId, qty, unit} (jamais les totaux) : tout est
   recalcule a l'affichage via nutrition.js, donc corrigible si la
   base change. Legacy (anciens items sans foodId) : totaux stockes. */
function nutriDateMinus(n){
  const d = new Date();
  d.setDate(d.getDate() - n);
  const p = x => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function findNutriFood(id){
  const n = nutriDB();
  if (!n || !id) return null;
  const c = n.foods.find(f => f.id === id);
  if (c) return c;
  /* aliments distants encore en cache de recherche : resolvables avant import */
  if (nutriRemoteState && Array.isArray(nutriRemoteState.foods)){
    const r = nutriRemoteState.foods.find(f => f && f.id === id);
    if (r) return r;
  }
  const local = (window.LiftrFoods && LiftrFoods.get(id)) || null;
  if (local) return local;
  /* A removed food can still be resolved from its immutable diary snapshot. */
  for (const meal of n.meals){
    const item = (meal.items || []).find(x => x && x.foodId === id && x.snapshot);
    if (item) return item.snapshot;
  }
  return null;
}
/* Un aliment distant (off:/usda:) est persiste dans n.foods la premiere
   fois qu'on l'utilise : il reste resolvable hors ligne ensuite. */
function ensureFoodPersisted(f){
  const n = nutriDB();
  if (!n || !f) return f;
  if (n.foods.some(x => x && x.id === f.id)) return f;
  if (f.source === 'off' || f.source === 'usda'){
    n.foods.push(Object.assign({}, f));
  }
  return f;
}
function foodsDbReady(){ return !!(window.LiftrFoods && LiftrFoods.all().length); }
function ensureFoodsDb(tab){
  if (foodsDbReady() || !window.LiftrFoods) return;
  LiftrFoods.load().then(() => {
    if (currentTab !== tab || typeof window.renderNutrition !== 'function') return;
    if (nutriForm === 'food') return;
    if (nutriForm === 'meal' && tab === 'nutri-meals' && nutriDraft && !nutriDraft.pick){
      const results = $('mealPickContent');
      if (results) { results.innerHTML = mealPickResultsHtml(nutriDraft); return; }
    }
    window.renderNutrition(tab);
  }).catch(() => {});
}
function mealsNeedFoods(meals){
  return meals.some(m => (m.items || []).some(it =>
    it.foodId && !findNutriFood(it.foodId) && !foodsDbReady()));
}
function nutriItemN(it){
  if (it.foodId){
    const f = it.snapshot || findNutriFood(it.foodId);
    if (!f) return null;
    try { return nutrientsFor(f, +it.qty || 0, it.unit || 'g'); }
    catch (e){ return null; }
  }
  /* legacy : totaux stockes a l'ecriture (ancien modele) */
  return { kcal: +it.kcal || 0, protein: +it.p || 0, carbs: +it.c || 0,
    fat: +it.f || 0, fiber: null, sugar: null, sodium_mg: null };
}
function nutriMealTotal(m){
  const items = m.items || [];
  let missing = 0;
  const list = [];
  items.forEach(it => { const x = nutriItemN(it); if (x) list.push(x); else missing++; });
  return { n: sumNutrients(list), missing: missing };
}
function nutriItemName(it){
  if (it.foodId){
    const f = it.snapshot || findNutriFood(it.foodId);
    if (f) return f.name;
  }
  return it.name || 'Item';
}
function nutriItemKcal(it){ const x = nutriItemN(it); return x ? x.kcal : null; }
function nutriQtyLabel(it){
  if (it.foodId == null) return '';
  const q = Math.round((+it.qty || 0) * 10) / 10;
  return q + ' ' + (it.unit || 'g');
}
function nutrientPanelHtml(items, title){
  if (!items || !items.length) return '';
  const rows = TRACKED_MICRONUTRIENTS.map(meta => {
    let total = 0, known = 0;
    items.forEach(item => {
      const nutrients = nutriItemN(item);
      const value = nutrients && nutrients[meta.field];
      if (value != null && Number.isFinite(+value)){ total += +value; known++; }
    });
    const shown = known === 0 ? '—' :
      (known < items.length ? '≥ ' : '') + (Math.round(total * 10) / 10) + ' ' + esc(meta.unit);
    const coverage = known > 0 && known < items.length
      ? '<small>' + known + '/' + items.length + ' foods</small>' : '';
    return '<div class="nutri-micro-row"><dt>' + esc(meta.label) + '</dt><dd>' + shown + coverage + '</dd></div>';
  }).join('');
  return '<details class="nutri-micronutrients"><summary>' + esc(title) +
    '<span>Values from your food data</span></summary><dl class="nutri-micro-grid">' + rows +
    '</dl><p>— means no value was provided. A ≥ total is partial because some logged foods lack that nutrient.</p></details>';
}

/* ---- Today : totaux du jour vs objectif (kcal-card + pbar) ---- */
function nutriTotalsOf(dateISO){
  const n = nutriDB();
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  if (!n) return t;
  n.meals.filter(m => m.date === dateISO).forEach(m => {
    const x = nutriMealTotal(m).n;
    t.kcal += x.kcal; t.p += x.protein; t.c += x.carbs; t.f += x.fat;
  });
  return t;
}

function nutriMacroBar(cls, label, val, goal){
  const pr = progress(val, goal);
  const g = Math.round(goal), v = Math.round(val);
  return '<div class="macro ' + cls + '">' +
    '<div class="macro-name"><span>' + label + '</span></div>' +
    '<div class="macro-val">' + v + ' / ' + g + ' g</div>' +
    '<div class="pbar ' + pr.status + '" role="progressbar" aria-label="' + label + '"' +
    ' aria-valuemin="0" aria-valuemax="' + g + '" aria-valuenow="' + v + '">' +
    '<i style="width:' + pr.pct + '%"></i></div></div>';
}

/* .meal-card : repas + ingredients, reutilise Today (lecture) et Meals (edition) */
function nutriMealCard(m, editable){
  const mt = nutriMealTotal(m);
  const t = mt.n;
  const type = m.type || 'lunch';
  const rows = (m.items || []).map((it, ii) => {
    const acts = editable
      ? '<span class="ing-actions">' +
        '<button class="icon-btn" onclick="editMealItem(' + esc(JSON.stringify(m.id)) + ',' + ii + ')" aria-label="Edit ingredient">' + icon('pencil') + '</button>' +
        '<button class="icon-btn" onclick="removeMealItem(' + esc(JSON.stringify(m.id)) + ',' + ii + ')" aria-label="Remove ingredient">' + icon('x') + '</button>' +
        '</span>'
      : '';
    const qty = nutriQtyLabel(it);
    return '<div class="ing-row"><span class="ing-n">' + esc(nutriItemName(it)) + '</span>' +
      '<span class="ing-g">' + esc(qty) + '</span>' +
      '<span class="ing-k">' + (nutriItemKcal(it) == null ? '—' : Math.round(nutriItemKcal(it))) + ' kcal</span>' + acts + '</div>';
  }).join('');
  const miss = mt.missing
    ? '<div class="ing-row"><span class="ing-n">…</span><span class="ing-g"></span><span class="ing-k">…</span></div>'
    : '';
  const acts = editable
    ? '<span class="meal-head-actions">' +
      '<button class="icon-btn" onclick="editMeal(' + esc(JSON.stringify(m.id)) + ')" aria-label="Edit meal">' + icon('pencil') + '</button>' +
      '<button class="icon-btn" onclick="saveMealAsRecipe(' + esc(JSON.stringify(m.id)) + ')" aria-label="Save as recipe">' + icon('star') + '</button>' +
      '<button class="icon-btn" onclick="removeMeal(' + esc(JSON.stringify(m.id)) + ')" aria-label="Delete meal">' + icon('trash') + '</button></span>'
    : '';
  return '<div class="card meal-card meal-' + esc(type) + '">' +
    '<div class="meal-head">' +
    '<span class="meal-dot ' + esc(type) + '" aria-hidden="true"></span>' +
    '<div class="meal-title"><div class="meal-name">' + esc(m.name) + '</div>' +
    '<div class="meal-sub">' + Math.round(t.protein) + 'P / ' +
    Math.round(t.carbs) + 'C / ' + Math.round(t.fat) + 'F</div></div>' +
    '<div class="meal-head-right"><span class="meal-kcal">' + Math.round(t.kcal) +
    ' <small>kcal</small></span>' + acts + '</div>' +
    '</div>' + rows + miss + '</div>';
}

/* ============ helpers UI ONT-style (build 75) ============ */
const WATER_DROP = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3s6 6.6 6 10.4A6 6 0 0 1 6 13.4C6 9.6 12 3 12 3z"/></svg>';
const BARCODE_SVG = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6v12M8 6v12M11 6v12M14 6v12M18 6v12M20 6v12"/></svg>';
const MEAL_SVG = {
  breakfast: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/></svg>',
  lunch: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16a8 8 0 0 1-16 0z"/><path d="M12 4v3"/></svg>',
  dinner: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v7a1.5 1.5 0 0 0 3 0V3"/><path d="M9.5 10v11"/><path d="M16 3c-1.5 1-2 3-2 5s.5 3 2 3"/><path d="M16 11v10"/></svg>',
  snack: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 7c-3-2-7 0-7 4 0 5 3 9 7 9s7-4 7-9c0-4-4-6-7-4z"/><path d="M12 7V4"/></svg>'
};
function nutriMacroCard(cls, label, val, goal){
  const pr = progress(val, goal);
  const g = Math.round(goal), v = Math.round(val);
  return '<div class="mcard ' + cls + '"><div class="mcard-top"><span class="dot"></span>' + label + '</div>' +
    '<div class="mcard-val">' + v + '<small> / ' + g + ' g</small></div>' +
    '<div class="pbar ' + pr.status + '" role="progressbar" aria-label="' + label + '"' +
    ' aria-valuemin="0" aria-valuemax="' + g + '" aria-valuenow="' + v + '">' +
    '<i style="width:' + pr.pct + '%"></i></div></div>';
}
function nutriRingCard(date, g, t, plan){
  const pr = progress(t.kcal, g.kcal);
  const eaten = Math.round(t.kcal), goalK = Math.round(g.kcal);
  const over = pr.status === 'over';
  const num = over ? pr.overBy : pr.remaining;
  const C = 2 * Math.PI * 52;
  const fill = over ? 1 : Math.max(0, Math.min(1, (pr.pct || 0) / 100));
  const off = C * (1 - fill);
  const meta = plan
    ? '<div class="ring-meta"><span>BMR ' + Math.round(plan.bmr) + '</span>' +
      '<span>TDEE ' + Math.round(plan.tdee) + '</span>' +
      '<span>Goal ' + (plan.kcal - plan.tdee >= 0 ? '+' : '−') + Math.abs(Math.round(plan.kcal - plan.tdee)) + '</span></div>'
    : '';
  return '<div class="card ring-card">' +
    '<div class="ring-stats">' +
    '<div class="ring-stat"><span class="rs-ic">' + icon('down') + '</span><span class="rs-n">' + eaten + '</span><span class="rs-l">eaten</span></div>' +
    '<div class="ring-stat right"><span class="rs-ic">' + icon('up') + '</span><span class="rs-n">' + goalK + '</span><span class="rs-l">target</span></div>' +
    '</div>' +
    '<div class="ring-wrap"><svg viewBox="0 0 120 120" class="ring-svg" aria-hidden="true">' +
    '<defs><linearGradient id="calRingGrad" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="#A0BBFF"/><stop offset="1" stop-color="#61A3FF"/></linearGradient></defs>' +
    '<circle class="ring-bg" cx="60" cy="60" r="52"/>' +
    '<circle class="ring-fg' + (over ? ' over' : '') + '" cx="60" cy="60" r="52"' +
    ' style="stroke-dasharray:' + C.toFixed(1) + ';stroke-dashoffset:' + off.toFixed(1) + '"/></svg>' +
    '<div class="ring-center' + (over ? ' over' : '') + '"><b>' + num + '</b><span>' + (over ? 'over' : 'kcal left') + '</span></div></div>' +
    meta + '</div>';
}
function nutriChipsHtml(date){
  const w = nutriWeight();
  const wm = nutriWaterMl(date), wg = nutriWaterGoal();
  const wChip = w > 0
    ? '<button class="nchip" onclick="showTab(\'stats\')" aria-label="Weight"><span class="ic">' + icon('scale') + '</span><b>' + (Math.round(w * 10) / 10) + '</b> kg<span class="edit">' + icon('pencil') + '</span></button>'
    : '';
  const water = '<span class="nchip water"><span class="ic">' + WATER_DROP + '</span><b>' + wm + '</b> / ' + wg + ' ml' +
    '<button class="nchip-plus" onclick="addWater(250)" aria-label="Add 250 ml water">+</button></span>';
  return '<div class="nchips">' + wChip + water + '</div>';
}
function nutriBmi(){
  const p = nutriProfile(), w = nutriWeight();
  if (!p || !(p.heightCm > 0) || !(w > 0)) return null;
  const m = p.heightCm / 100, bmi = w / (m * m);
  let cls, label, risk;
  if (bmi < 18.5){ cls = 'under'; label = 'Underweight'; risk = 'Risk of deficiency: increased'; }
  else if (bmi < 25){ cls = 'normal'; label = 'Normal weight'; risk = 'Risk: within the normal range'; }
  else if (bmi < 30){ cls = 'over'; label = 'Overweight'; risk = 'Risk of comorbidities: increased'; }
  else { cls = 'obese'; label = 'Obesity'; risk = 'Risk of comorbidities: high'; }
  return { value: Math.round(bmi * 10) / 10, cls: cls, label: label, risk: risk };
}
function nutriStreak(){
  const n = nutriDB();
  const logged = d => n.meals.some(m => m.date === d);
  let cur = 0, start = logged(todayISO()) ? todayISO() : shiftISO(todayISO(), -1);
  while (logged(start)){ cur++; start = shiftISO(start, -1); }
  const seen = {}; n.meals.forEach(m => { seen[m.date] = 1; });
  const all = Object.keys(seen).sort();
  let best = 0, run = 0, prev = null;
  all.forEach(dt => { run = (prev && shiftISO(prev, 1) === dt) ? run + 1 : 1; best = Math.max(best, run); prev = dt; });
  return { cur: cur, best: Math.max(best, cur) };
}
function nutriChartHtml(days, goalK){
  const W = 300, H = 148, pad = 10;
  const vals = days.map(d => d.kcal);
  const max = Math.max(goalK || 0, Math.max.apply(null, vals.concat([1]))) * 1.12;
  const nN = days.length;
  const x = i => pad + (i * (W - 2 * pad)) / (nN - 1 || 1);
  const y = v => H - pad - (v / max) * (H - 2 * pad);
  const line = vals.map((v, i) => x(i).toFixed(1) + ',' + y(v).toFixed(1)).join(' ');
  const area = 'M' + x(0).toFixed(1) + ',' + (H - pad) + ' L' + line.replace(/ /g, ' L') + ' L' + x(nN - 1).toFixed(1) + ',' + (H - pad) + ' Z';
  const goalLine = goalK ? '<line class="chart-goal" x1="' + pad + '" y1="' + y(goalK).toFixed(1) + '" x2="' + (W - pad) + '" y2="' + y(goalK).toFixed(1) + '" vector-effect="non-scaling-stroke"/>' : '';
  const dots = nN <= 12 ? vals.map((v, i) => '<circle class="chart-dot" cx="' + x(i).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="2.6"/>').join('') : '';
  return '<div class="card"><div class="section-hint">Calories vs goal</div><div class="chart">' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Calories over time">' +
    '<defs><linearGradient id="calAreaGrad" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="rgba(19,116,252,.35)"/><stop offset="1" stop-color="rgba(19,116,252,0)"/></linearGradient></defs>' +
    goalLine + '<path class="chart-area" d="' + area + '"/>' +
    '<polyline class="chart-line" points="' + line + '" vector-effect="non-scaling-stroke"/>' + dots +
    '</svg>' + (goalK ? '<div class="section-hint" style="margin-top:2px">Dashed line = goal ' + Math.round(goalK) + ' kcal</div>' : '') + '</div></div>';
}
function foodThumbHtml(f){
  const name = f.name || '?';
  const ch = name.trim().charAt(0).toUpperCase() || '?';
  const grads = ['linear-gradient(135deg,#A0BBFF,#61A3FF)', 'linear-gradient(135deg,#4DA3FF,#0A84FF)',
    'linear-gradient(135deg,#30D158,#0F9D4E)', 'linear-gradient(135deg,#BF5AF2,#8A5CFF)',
    'linear-gradient(135deg,#FFD60A,#A0BBFF)', 'linear-gradient(135deg,#FF453A,#61A3FF)'];
  let h = 0; for (let i = 0; i < name.length; i++) h = (h + name.charCodeAt(i)) % grads.length;
  return '<span class="fthumb" style="background:' + grads[h] + '" aria-hidden="true">' + esc(ch) + '</span>';
}

function renderNutriToday(){
  const box = $('nutriToday');
  if (!box) return;
  const n = nutriDB();
  const date = todayISO();
  const meals = n.meals.filter(m => m.date === date);
  if (mealsNeedFoods(meals)) ensureFoodsDb('nutri-today');
  const g = nutriActiveGoal(true);
  const hasGoal = (+g.kcal || +g.p || +g.c || +g.f) > 0;
  const t = nutriTotalsOf(date);
  const plan = nutriPlan();

  let ring, mcards;
  if (!hasGoal){
    ring = '<div class="empty">No goal set yet — open the <b>Goal</b> tab to set daily targets.</div>';
    mcards = '';
  } else {
    ring = nutriRingCard(date, g, t, plan);
    mcards = '<div class="mcards">' +
      nutriMacroCard('c', 'Carbs', t.c, g.c) +
      nutriMacroCard('f', 'Fat', t.f, g.f) +
      nutriMacroCard('p', 'Protein', t.p, g.p) + '</div>';
  }
  const water = nutriWaterCardHtml(date);
  const nutrientItems = meals.flatMap(m => m.items || []);
  const nutrients = nutrientPanelHtml(nutrientItems, 'Nutrients');
  const stack = meals.length
    ? '<div class="section-hint fx-head" style="margin-top:16px">Today\'s meals<span class="fx-n">' + meals.length + '</span></div>' +
      '<div class="meal-stack">' + meals.map(m => nutriMealCard(m, false)).join('') + '</div>'
    : '<div class="empty" style="margin-top:14px">Nothing logged yet — tap <b>+ Add meal</b> to record what you ate.</div>';
  const bar = '<div class="nutri-add-bar"><button class="btn btn-primary" onclick="addMeal()">+ Add meal</button></div>';
  box.innerHTML = nutriChipsHtml(date) + ring + mcards + water + nutrients + stack + bar;
}

/* ---- Meals : liste du jour + builder (foodId + qty, totaux live) ---- */
let nutriDraft = null;   /* {id, type, name, items, pick, q, focus} */
let nutriFormOpener = null;
let nutriFoodDraft = null;

const MEAL_TYPES = [['breakfast','Breakfast'],['lunch','Lunch'],['dinner','Dinner'],['snack','Snack']];
function mealTypeLabel(t){
  const f = MEAL_TYPES.find(x => x[0] === t);
  return f ? f[1] : 'Meal';
}
function newDraft(){
  const h = new Date().getHours();
  const type = h < 11 ? 'breakfast' : h < 16 ? 'lunch' : 'dinner';
  return { id: null, type: type, name: '', items: [], pick: null, q: '' };
}
function draftFromMeal(m){
  return { id: m.id, type: m.type || 'lunch', name: m.name || 'Meal',
    items: (m.items || []).map(it => Object.assign({}, it)), pick: null, q: '' };
}
function allowedUnits(food){
  const hasPiece = !!(food && food.gramsPerUnit && food.gramsPerUnit.piece != null);
  const hasServing = !!(food && ((food.gramsPerUnit && food.gramsPerUnit.serving != null) || food.ontServingUnknown));
  return UNITS.filter(u => (u !== 'piece' || hasPiece) && (u !== 'serving' || hasServing));
}
function defaultUnit(food){
  if (food && food.unitLabel && allowedUnits(food).indexOf(food.unitLabel) >= 0) return food.unitLabel;
  if (food && food.gramsPerUnit && food.gramsPerUnit.piece != null) return 'piece';
  return 'g';
}
function defaultQty(unit){ return (unit === 'g' || unit === 'ml') ? 100 : 1; }

function mealNameInput(v){ if (nutriDraft) nutriDraft.name = v; }
function mealTypeChange(v){ if (nutriDraft) nutriDraft.type = v; }
function mealSearchInput(v){
  if (!nutriDraft) return;
  nutriDraft.q = v;
  const results = $('mealPickContent');
  if (results) results.innerHTML = mealPickResultsHtml(nutriDraft);
  else renderNutriMeals();
}
function pickMealFood(id){
  const d = nutriDraft;
  if (!d) return;
  let f = findNutriFood(id);
  if (!f) return;
  f = ensureFoodPersisted(f);
  const unit = defaultUnit(f);
  d.pick = { foodId: f.id, name: f.name, qty: String(defaultQty(unit)), unit: unit, from: -1 };
  d.focus = null;
  renderNutriMeals();
}
function itemQtyInput(v){
  if (nutriDraft && nutriDraft.pick){ nutriDraft.pick.qty = v; updateItemPreview(); }
}
function itemUnitChange(v){
  const d = nutriDraft;
  if (!d || !d.pick) return;
  d.pick.unit = v;
  d.pick.qty = String(defaultQty(v));
  const el = $('itemQty');
  if (el) el.value = d.pick.qty;
  updateItemPreview();
}
function updateItemPreview(){
  const d = nutriDraft;
  const box = $('itemPreview');
  if (!d || !d.pick || !box) return;
  const f = d.pick.snapshot || findNutriFood(d.pick.foodId);
  if (!f) return;
  const q = +d.pick.qty;
  if (!(q > 0)){ box.textContent = 'Enter a quantity'; return; }
  let n;
  try { n = nutrientsFor(f, q, d.pick.unit); }
  catch (e){ box.textContent = 'Unit not supported for this food'; return; }
  box.textContent = Math.round(n.kcal) + ' kcal · ' + Math.round(n.protein) + 'P / ' +
    Math.round(n.carbs) + 'C / ' + Math.round(n.fat) + 'F';
}
function addDraftItem(){
  const d = nutriDraft;
  if (!d || !d.pick) return;
  const qty = +d.pick.qty;
  if (!(qty > 0)){ toast('Enter a quantity'); return; }
  const food = findNutriFood(d.pick.foodId);
  if (!food) return;
  const item = foodItem(food, qty, d.pick.unit || 'g');
  if (d.pick.from >= 0){
    const previous = d.items[d.pick.from];
    if (previous && previous.foodId === item.foodId && previous.snapshot){
      item.snapshot = previous.snapshot;
      item.snapshotVersion = previous.snapshotVersion || 1;
    }
    if (previous && previous.ontId){
      item.ontId = previous.ontId;
      item.ontDateTime = previous.ontDateTime || '';
      item.ontMeal = Object.assign({}, previous.ontMeal || {}, {
        servingQuantity: null, servingUnit: null, servingSize: null
      });
      if (previous.foodId !== item.foodId){
        const source = item.snapshot && item.snapshot.source;
        item.ontMeal.code = item.snapshot && item.snapshot.barcode || null;
        item.ontMeal.brands = item.snapshot && item.snapshot.brands || '';
        item.ontMeal.source = source === 'usda' ? 'fdc' : source === 'off' || source === 'custom' ? source : 'unknown';
      }
    }
    d.items[d.pick.from] = item;
  }
  else d.items.push(item);
  d.pick = null;
  renderNutriMeals();
}
function editDraftItem(i){
  const d = nutriDraft;
  if (!d || !d.items[i]) return;
  const it = d.items[i];
  if (!it.foodId){ toast('Legacy line: remove it and re-add the food'); return; }
  if (!findNutriFood(it.foodId)) return;
  d.pick = { foodId: it.foodId, name: nutriItemName(it), qty: String(+it.qty || 100),
    unit: it.unit || 'g', from: i, snapshot: it.snapshot || null };
  renderNutriMeals();
}
function removeDraftItem(i){
  if (!nutriDraft) return;
  nutriDraft.items.splice(i, 1);
  renderNutriMeals();
}

function itemEditorHtml(){
  const p = nutriDraft.pick;
  const f = findNutriFood(p.foodId);
  const units = allowedUnits(f).map(u =>
    '<option value="' + u + '"' + (p.unit === u ? ' selected' : '') + '>' + u + '</option>').join('');
  return '<div class="item-editor">' +
    '<span class="ie-name">' + esc(p.name) + '</span>' +
    '<input class="input" id="itemQty" type="number" inputmode="decimal" min="0" step="any"' +
    ' value="' + esc(p.qty) + '" aria-label="Quantity" oninput="itemQtyInput(this.value)">' +
    '<select class="input" id="itemUnit" aria-label="Unit" onchange="itemUnitChange(this.value)">' + units + '</select>' +
    '<span class="item-preview" id="itemPreview"></span>' +
    '<button class="btn btn-primary btn-sm" onclick="addDraftItem()">' +
    (p.from >= 0 ? 'Update' : 'Add to meal') + '</button>' +
    '</div>';
}

function mealPickResultsHtml(d){
  const q = (d.q || '').trim();
  if (!q || d.pick) return '';
  const n = nutriDB();
  const cq = norm(q);
  const custom = n.foods.filter(f => norm(f.name).indexOf(cq) >= 0).slice(0, 8);
  if (!foodsDbReady()) ensureFoodsDb('nutri-meals');
  const db = foodsDbReady() ? searchFoods(q, 12, nutriFoodPreparation()) : [];
  const rows = [];
  custom.forEach(f => rows.push({ f: f, custom: true }));
  db.forEach(f => { if (!rows.some(r => r.f.id === f.id)) rows.push({ f: f, custom: false }); });
  if (!rows.length){
    return '<div class="empty">' + (foodsDbReady()
      ? 'No food matches “' + esc(q) + '”.'
      : 'Searching the database…') + '</div>';
  }
  return '<div class="builder-results">' +
    '<div class="br-head"><span>Add ingredients</span><span class="br-count">' +
    rows.length + ' found</span></div>' +
    '<div class="food-list">' + rows.map(r =>
    '<button type="button" class="food-item food-pick" onclick="pickMealFood(' + esc(JSON.stringify(r.f.id)) + ')">' +
    '<span class="fi-main"><span class="fn">' + esc(r.f.name) + '</span>' +
    '<span class="fm">' + Math.round(+r.f.kcal || 0) + ' kcal / 100 g' +
    (r.custom ? ' · yours' : (r.f.state ? ' · ' + esc(r.f.state) : '')) + '</span></span>' +
    '<span class="fi-kcal"><b>' + Math.round(+r.f.kcal || 0) + '</b><i>/100g</i></span>' +
    '</button>'
    ).join('') + '</div></div>';
}

function draftTotals(){
  const d = nutriDraft;
  const list = ((d && d.items) || []).map(nutriItemN).filter(Boolean);
  return sumNutrients(list);
}

function mealBuilderHtml(){
  const d = nutriDraft;
  if (!d) return '';
  const n = nutriDB();
  const t = draftTotals();
  const yMeals = n.meals.filter(m => m.date === shiftISO(nutriDate(), -1));
  const copyRow = (yMeals.length && !d.items.length)
    ? '<div class="nutri-copy-row"><span class="section-hint" style="margin:0">Copy from yesterday:</span>' +
      yMeals.map(m => '<button type="button" class="chip" onclick="copyYestMeal(' +
        esc(JSON.stringify(m.id)) + ')">' + esc(m.name) + '</button>').join('') + '</div>'
    : '';
  const itemsCard = d.items.length
    ? '<div class="card meal-card builder-items">' +
      d.items.map((it, i) =>
        '<div class="ing-row"><span class="ing-n">' + esc(nutriItemName(it)) + '</span>' +
        '<span class="ing-g">' + esc(nutriQtyLabel(it)) + '</span>' +
        '<span class="ing-k">' + (nutriItemKcal(it) == null ? '—' : Math.round(nutriItemKcal(it))) + ' kcal</span>' +
        '<span class="ing-actions">' +
        '<button class="icon-btn" onclick="editDraftItem(' + i + ')" aria-label="Edit ingredient">' + icon('pencil') + '</button>' +
        '<button class="icon-btn" onclick="removeDraftItem(' + i + ')" aria-label="Remove ingredient">' + icon('x') + '</button>' +
        '</span></div>').join('') +
      '</div>'
    : '';
  /* barre de totaux : kcal en chiffre + macros colorees + mini-barre de part */
  let totals;
  if (d.items.length){
    const kp = t.protein * 4, kc = t.carbs * 4, kf = t.fat * 9;
    const kk = kp + kc + kf || 1;
    const sp = Math.round(kp / kk * 100), sc = Math.round(kc / kk * 100);
    totals = '<div class="builder-totals" id="mealDraftTotals">' +
      '<span class="bt-kcal">Totals: <b>' + Math.round(t.kcal) + '</b> kcal</span>' +
      '<span class="bt-macros">' +
      '<span class="bt-p">' + Math.round(t.protein) + 'P</span>' +
      '<span class="bt-c">' + Math.round(t.carbs) + 'C</span>' +
      '<span class="bt-f">' + Math.round(t.fat) + 'F</span></span>' +
      '<span class="bt-bar" aria-hidden="true"><i class="p" style="width:' + sp +
      '%"></i><i class="c" style="width:' + sc + '%"></i><i class="f" style="width:' +
      Math.max(0, 100 - sp - sc) + '%"></i></span></div>';
  } else {
    totals = '<div class="builder-totals empty" id="mealDraftTotals">' +
      'Search a food, set the quantity, add it.</div>';
  }
  return '<div class="nutri-form-backdrop" role="presentation" onclick="if(event.target===this)cancelNutriForm()">' +
    '<div class="card nutri-form builder-form" role="dialog" aria-modal="true" aria-labelledby="mealBuilderTitle">' +
    '<div class="nutri-sheet-head"><div><div class="nutri-sheet-title" id="mealBuilderTitle">' +
    (d.id ? 'Edit meal' : 'Build a meal') + '</div><div class="section-hint">Choose foods and set portions</div></div>' +
    '<button type="button" class="nutri-sheet-close" data-nutri-close onclick="cancelNutriForm()" aria-label="Close meal editor">×</button></div>' +
    '<input class="input" id="mealName" placeholder="Meal name" maxlength="60" value="' + esc(d.name) + '"' +
    ' oninput="mealNameInput(this.value)">' +
    '<input class="input builder-search" id="mealFoodSearch" placeholder="Search foods…" aria-label="Search foods to add"' +
    ' value="' + esc(d.q || '') + '" oninput="mealSearchInput(this.value)">' +
    '<div id="mealPickContent">' + (d.pick ? itemEditorHtml() : mealPickResultsHtml(d)) + '</div>' +
    copyRow + itemsCard + totals +
    '<div class="composer-actions">' +
    '<button class="chip" onclick="cancelNutriForm()">Cancel</button>' +
    '<button class="btn btn-primary btn-sm" onclick="saveMealDraft()">Save meal</button>' +
    '</div></div></div>';
}

/* ============ Meals ONT-style (build 75) ============ */
const PLUS_SVG = '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const MEAL_SHARE = { breakfast: 0.25, lunch: 0.30, dinner: 0.30, snack: 0.15 };
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function nutriGotoDate(iso){ nutriSetDate(iso); renderNutrition('nutri-meals'); }
function nutriMonthShift(delta){
  const s = nutriDate();
  const y = +s.slice(0, 4), mo = +s.slice(5, 7) - 1;
  const d = new Date(y, mo + delta, Math.min(+s.slice(8), 28));
  const p = x => String(x).padStart(2, '0');
  nutriSetDate(d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()));
  renderNutrition('nutri-meals');
}
function nutriPrevMonth(){ nutriMonthShift(-1); }
function nutriNextMonth(){ nutriMonthShift(1); }

function nutriCalendarStripHtml(){
  const sel = nutriDate(), today = todayISO();
  const y = +sel.slice(0, 4), mo = +sel.slice(5, 7) - 1;
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const n = nutriDB();
  const g = nutriActiveGoal(true);
  const hasGoal = (+g.kcal || +g.p || +g.c || +g.f) > 0;
  let cells = '';
  for (let d = 1; d <= daysInMonth; d++){
    const p = x => String(x).padStart(2, '0');
    const iso = y + '-' + p(mo + 1) + '-' + p(d);
    const isSel = iso === sel, isToday = iso === today;
    const dayMeals = n.meals.filter(m => m.date === iso);
    let dot = 'none';
    if (dayMeals.length){
      const kcal = dayMeals.reduce((s, m) => s + nutriMealTotal(m).n.kcal, 0);
      dot = (hasGoal && kcal > g.kcal * 1.05) ? 'over' : 'on';
    }
    cells += '<button type="button" class="cal-day' + (isSel ? ' sel' : '') + (isToday ? ' today' : '') +
      '" onclick="nutriGotoDate(\'' + iso + '\')" aria-label="' + iso + (isSel ? ', selected' : '') + '">' +
      '<span class="cd-w">' + WD[new Date(iso + 'T12:00:00').getDay()].charAt(0) + '</span>' +
      '<span class="cd-d">' + d + '</span>' +
      '<span class="cd-dot ' + dot + '" aria-hidden="true"></span></button>';
  }
  return '<div class="calstrip-wrap"><div class="calstrip-head">' +
    '<button class="icon-btn" onclick="nutriPrevMonth()" aria-label="Previous month">‹</button>' +
    '<span class="calstrip-month">' + MONTHS[mo] + ' ' + y + '</span>' +
    '<button class="icon-btn" onclick="nutriNextMonth()" aria-label="Next month">›</button>' +
    '<button class="chip" onclick="nutriGotoToday()">Today</button></div>' +
    '<div class="calstrip" role="group" aria-label="Pick a day">' + cells + '</div></div>';
}

function nutriDaySummaryHtml(date){
  const g = nutriActiveGoal(true);
  const hasGoal = (+g.kcal || +g.p || +g.c || +g.f) > 0;
  const t = nutriTotalsOf(date);
  const dt = new Date(date + 'T12:00:00');
  const dateLbl = (date === todayISO() ? 'Today' : WD[dt.getDay()] + ' ' + date.slice(8) + '/' + date.slice(5, 7));
  const ringMini = (val, goal, cls) => {
    const pr = progress(val, goal);
    const C = 2 * Math.PI * 9;
    const off = C * (1 - Math.max(0, Math.min(1, (pr.pct || 0) / 100)));
    return '<svg class="dm-ring" viewBox="0 0 24 24" aria-hidden="true">' +
      '<circle class="dm-bg" cx="12" cy="12" r="9"/>' +
      '<circle class="dm-fg ' + cls + (pr.status === 'over' ? ' over' : '') + '" cx="12" cy="12" r="9"' +
      ' style="stroke-dasharray:' + C.toFixed(1) + ';stroke-dashoffset:' + off.toFixed(1) + '"/></svg>';
  };
  const kcal = Math.round(t.kcal), goalK = Math.round(g.kcal);
  const macros = hasGoal
    ? '<div class="daysum-macros">' +
      '<span class="dm">' + ringMini(t.c, g.c, 'c') + '<span class="dm-val">' + Math.round(t.c) + '<span class="dm-lab">carbs</span></span></span>' +
      '<span class="dm">' + ringMini(t.f, g.f, 'f') + '<span class="dm-val">' + Math.round(t.f) + '<span class="dm-lab">fat</span></span></span>' +
      '<span class="dm">' + ringMini(t.p, g.p, 'p') + '<span class="dm-val">' + Math.round(t.p) + '<span class="dm-lab">protein</span></span></span>' +
      '</div>'
    : '';
  return '<div class="card daysum">' +
    '<div class="daysum-head"><span class="daysum-date">' + dateLbl + '</span></div>' +
    '<div class="daysum-kcal">' + kcal + '<small>' + (hasGoal ? ' / ' + goalK + ' kcal' : ' kcal') + '</small></div>' +
    macros + '</div>';
}

function nutriMealSectionHtml(type, meals){
  const label = mealTypeLabel(type);
  const dayMeals = meals.filter(m => (m.type || 'lunch') === type);
  const g = nutriActiveGoal(true);
  const hasGoal = (+g.kcal || +g.p || +g.c || +g.f) > 0;
  let kcal = 0, p = 0, c = 0, f = 0;
  dayMeals.forEach(m => { const t = nutriMealTotal(m).n; kcal += t.kcal; p += t.protein; c += t.carbs; f += t.fat; });
  const target = hasGoal ? Math.round(g.kcal * MEAL_SHARE[type]) : 0;
  const sub = hasGoal
    ? '<b>' + Math.round(kcal) + '</b> / ' + target + ' kcal · ' + Math.round(p) + 'P / ' + Math.round(c) + 'C / ' + Math.round(f) + 'F'
    : Math.round(kcal) + ' kcal · ' + Math.round(p) + 'P / ' + Math.round(c) + 'C / ' + Math.round(f) + 'F';
  const addBtn = '<button class="icon-btn mse-add" onclick="addMealFor(\'' + type + '\')" aria-label="Add ' + label + '">' + PLUS_SVG + '</button>';
  const cards = dayMeals.length
    ? '<div class="meal-stack">' + dayMeals.map(m => nutriMealCard(m, true)).join('') + '</div>'
    : '';
  return '<section class="mse ' + type + '">' +
    '<div class="mse-head"><span class="mse-ico" aria-hidden="true">' + MEAL_SVG[type] + '</span>' +
    '<div class="mse-title"><div class="mse-name">' + label + '</div><div class="mse-sub">' + sub + '</div></div>' +
    addBtn + '</div>' + cards + '</section>';
}

function renderNutriMeals(){
  const box = $('nutriMeals');
  if (!box) return;
  const n = nutriDB();
  const date = nutriDate();
  const meals = n.meals.filter(m => m.date === date);
  if (mealsNeedFoods(meals)) ensureFoodsDb('nutri-meals');
  const hint = $('nutriMealsHint');
  if (hint) hint.textContent = meals.length
    ? meals.length + ' meal' + (meals.length !== 1 ? 's' : '') + (nutriIsToday() ? ' today' : ' that day')
    : (nutriIsToday() ? 'What you ate today' : 'Meals on this day');

  const open = nutriForm === 'meal' && !!nutriDraft;
  let html = nutriCalendarStripHtml() + nutriDaySummaryHtml(date);
  if (open) html += mealBuilderHtml();
  if (meals.length) html += '<div class="meal-stack">' + meals.map(m => nutriMealCard(m, true)).join('') + '</div>';
  if (!meals.length && !open){
    html += '<div class="empty" style="margin-top:14px">Nothing logged yet.</div>';
  }
  box.innerHTML = html;
  mountNutriDialog(box);
  if (open){
    if (nutriDraft.pick) updateItemPreview();
  }
}

function addMeal(){
  nutriFormOpener = document.activeElement;
  nutriForm = 'meal';
  nutriDraft = newDraft();
  showTab('nutri-meals');
  revealNutriForm();
}
function addMealFor(type){
  nutriFormOpener = document.activeElement;
  nutriForm = 'meal';
  nutriDraft = newDraft();
  if (type){ nutriDraft.type = type; nutriDraft.name = mealTypeLabel(type); }
  showTab('nutri-meals');
  revealNutriForm();
}
function editMeal(id){
  const m = nutriDB().meals.find(x => x.id === id);
  if (!m) return;
  nutriFormOpener = document.activeElement;
  nutriForm = 'meal';
  nutriDraft = draftFromMeal(m);
  showTab('nutri-meals');
  revealNutriForm();
}
function editMealItem(id, idx){
  const m = nutriDB().meals.find(x => x.id === id);
  if (!m) return;
  nutriFormOpener = document.activeElement;
  nutriForm = 'meal';
  nutriDraft = draftFromMeal(m);
  const it = nutriDraft.items[idx];
  if (it && it.foodId && findNutriFood(it.foodId)){
    nutriDraft.pick = { foodId: it.foodId, name: nutriItemName(it),
      qty: String(+it.qty || 100), unit: it.unit || 'g', from: idx, snapshot: it.snapshot || null };
  }
  showTab('nutri-meals');
  revealNutriForm();
}
function removeMeal(id){
  const n = nutriDB();
  n.meals = n.meals.filter(m => m.id !== id);
  if (nutriDraft && nutriDraft.id === id){ nutriForm = null; nutriDraft = null; }
  save();
  renderNutriMeals();
  toast('Meal deleted');
}
function removeMealItem(id, idx){
  const n = nutriDB();
  const m = n.meals.find(x => x.id === id);
  if (!m) return;
  m.items.splice(idx, 1);
  if (!m.items.length){
    n.meals = n.meals.filter(x => x.id !== id);
    toast('Meal removed');
  } else {
    toast('Ingredient removed');
  }
  save();
  renderNutriMeals();
}
function saveMealDraft(){
  const d = nutriDraft;
  const n = nutriDB();
  if (!d || !n) return;
  if (d.pick) addDraftItem();   /* ligne en cours de saisie : ajoutee aussi */
  if (!nutriDraft || !nutriDraft.items.length){ toast('Add at least one food'); return; }
  const dd = nutriDraft;
  const name = (dd.name || '').trim() || 'Meal';
  const items = dd.items.map(it => it.foodId
    ? Object.assign({}, it, { qty: +it.qty || 0, unit: it.unit || 'g', name: it.name || nutriItemName(it) })
    : Object.assign({}, it));
  let m = dd.id ? n.meals.find(x => x.id === dd.id) : null;
  if (m){ m.name = name; m.type = dd.type; m.items = items; }
  else {
    m = { id: uid(), date: nutriDate(), type: dd.type, name: name, items: items };
    n.meals.push(m);
  }
  touchNutriRecent(items.filter(i => i.foodId).map(i => i.foodId));
  nutriForm = null;
  nutriDraft = null;
  save();
  renderNutriMeals();
  toast('Meal saved');
  restoreNutriSectionFocus();
}
function copyYestMeal(id){
  const n = nutriDB();
  const m = n.meals.find(x => x.id === id);
  if (!m || !nutriDraft) return;
  nutriDraft.name = m.name;
  nutriDraft.type = m.type || nutriDraft.type;
  nutriDraft.items = (m.items || []).map(it => Object.assign({}, it));
  renderNutriMeals();
  toast('Copied "' + m.name + '"');
}
function saveMealAsRecipe(id){
  const n = nutriDB();
  const m = n.meals.find(x => x.id === id);
  if (!m) return;
  const items = (m.items || []).map(it => {
    const f = it.foodId ? (it.snapshot || findNutriFood(it.foodId)) : null;
    return f ? { food: f, qty: +it.qty || 0, unit: it.unit || 'g' } : null;
  }).filter(Boolean);
  if (!items.length){ toast('Add foods first — recipes need food items'); return; }
  let food = null;
  try { food = recipeToFood({ id: uid(), name: m.name, items: items, cookedWeightG: 0 }); }
  catch (e){ food = null; }
  if (!food || !(food.kcal >= 0) || !isFinite(food.kcal)){ toast('Could not save this recipe'); return; }
  n.foods.push(food);
  /* template reutilisable : ingredients d'origine (foodId + qty) */
  if (!Array.isArray(n.recipes)) n.recipes = [];
  n.recipes.push({
    id: uid(), name: m.name, type: m.type || 'lunch',
    items: (m.items || []).filter(it => it.foodId).map(it =>
      ({ foodId: it.foodId, qty: +it.qty || 0, unit: it.unit || 'g', name: it.name }))
  });
  save();
  renderNutriMeals();
  toast('"' + m.name + '" saved to Foods');
}

/* ---- recettes : liste dans Foods + reutilisee dans le builder ---- */
function recipesSectionHtml(){
  const n = nutriDB();
  const list = (n.recipes || []);
  if (!list.length) return '';
  return '<div class="section-hint fx-head">Recipes<span class="fx-n">' + list.length + '</span></div>' +
    '<div class="recipe-list">' + list.map(r => {
      let kcal = 0;
      (r.items || []).forEach(it => { const f = findNutriFood(it.foodId); if (f){ try { kcal += nutrientsFor(f, +it.qty || 0, it.unit || 'g').kcal; } catch (e){} } });
      return '<div class="recipe-row">' +
        '<span class="fi-main"><span class="fn">' + esc(r.name) + '</span>' +
        '<span class="fm">' + (r.items || []).length + ' items · ' + Math.round(kcal) + ' kcal / batch</span></span>' +
        '<span class="fi-acts">' +
        '<button class="chip" onclick="useRecipe(' + esc(JSON.stringify(r.id)) + ')">Use</button>' +
        '<button class="icon-btn" onclick="deleteRecipe(' + esc(JSON.stringify(r.id)) + ')" aria-label="Delete recipe">' + icon('trash') + '</button>' +
        '</span></div>';
    }).join('') + '</div>';
}
function useRecipe(id){
  const n = nutriDB();
  const r = (n.recipes || []).find(x => x.id === id);
  if (!r) return;
  nutriFormOpener = document.activeElement;
  nutriForm = 'meal';
  nutriDraft = newDraft();
  nutriDraft.name = r.name;
  if (r.type) nutriDraft.type = r.type;
  nutriDraft.items = (r.items || []).map(it => Object.assign({}, it));
  showTab('nutri-meals');
  revealNutriForm();
  toast('Recipe loaded into a new meal');
}
function deleteRecipe(id){
  const n = nutriDB();
  n.recipes = (n.recipes || []).filter(x => x.id !== id);
  save();
  renderNutriFoods();
  toast('Recipe deleted');
}

/* ---- Foods : recherche (perso + base 690), favoris, recents, per 100 g ---- */
function foodFormHtml(){
  const d = nutriFoodDraft || {};
  const bc = d.barcode || _pendingBarcode || '';
  const optionalInputs = OPTIONAL_NUTRIENT_META.filter(x => x.field !== 'fiber' && x.field !== 'sugar')
    .map(x => '<div><label class="label" for="foodMore_' + x.field + '">' + esc(x.label) + ' (' + esc(x.unit) + ')</label>' +
      '<input class="input" id="foodMore_' + x.field + '" type="number" inputmode="decimal" min="0" step="any" placeholder="—"' +
      ' value="' + (d[x.field] == null ? '' : esc(d[x.field])) + '" oninput="nutriFoodInput(' + esc(JSON.stringify(x.field)) + ',this.value)"></div>')
    .join('');
  return '<div class="nutri-form-backdrop" role="presentation" onclick="if(event.target===this)cancelNutriForm()">' +
    '<div class="card nutri-form food-form" role="dialog" aria-modal="true" aria-labelledby="foodFormTitle">' +
    '<div class="nutri-sheet-head"><div><div class="nutri-sheet-title" id="foodFormTitle">Add a food</div>' +
    '<div class="section-hint">Nutrition values per 100 g</div></div>' +
    '<button type="button" class="nutri-sheet-close" data-nutri-close onclick="cancelNutriForm()" aria-label="Close food editor">×</button></div>' +
    '<div class="section-hint" style="margin-bottom:8px">Per 100 g — stored as typed.</div>' +
    '<label class="label" for="foodName">Name</label>' +
    '<input class="input" id="foodName" placeholder="Food name" maxlength="60" value="' + esc(d.name || '') + '" oninput="nutriFoodInput(\'name\',this.value)">' +
    '<div class="food-macros">' +
    '<div><label class="label" for="foodKcal">kcal</label>' +
    '<input class="input" id="foodKcal" type="number" inputmode="numeric" min="0" placeholder="0" value="' + esc(d.kcal || '') + '" oninput="nutriFoodInput(\'kcal\',this.value)"></div>' +
    '<div><label class="label" for="foodP">Protein (g)</label>' +
    '<input class="input" id="foodP" type="number" inputmode="numeric" min="0" placeholder="0" value="' + esc(d.protein || '') + '" oninput="nutriFoodInput(\'protein\',this.value)"></div>' +
    '<div><label class="label" for="foodC">Carbs (g)</label>' +
    '<input class="input" id="foodC" type="number" inputmode="numeric" min="0" placeholder="0" value="' + esc(d.carbs || '') + '" oninput="nutriFoodInput(\'carbs\',this.value)"></div>' +
    '<div><label class="label" for="foodF">Fat (g)</label>' +
    '<input class="input" id="foodF" type="number" inputmode="numeric" min="0" placeholder="0" value="' + esc(d.fat || '') + '" oninput="nutriFoodInput(\'fat\',this.value)"></div>' +
    '</div>' +
    '<div class="food-macros">' +
    '<div><label class="label" for="foodFiber">Fiber (g)</label>' +
    '<input class="input" id="foodFiber" type="number" inputmode="decimal" min="0" step="any" placeholder="—" value="' + esc(d.fiber || '') + '" oninput="nutriFoodInput(\'fiber\',this.value)"></div>' +
    '<div><label class="label" for="foodSugar">Sugar (g)</label>' +
    '<input class="input" id="foodSugar" type="number" inputmode="decimal" min="0" step="any" placeholder="—" value="' + esc(d.sugar || '') + '" oninput="nutriFoodInput(\'sugar\',this.value)"></div>' +
    '</div>' +
    '<details class="food-extra-nutrients"><summary>Other nutrients · optional</summary>' +
    '<div class="food-macros">' + optionalInputs + '</div>' +
    '<div class="section-hint">Use values per 100 g from the product label. Leave unknown values blank.</div></details>' +
    '<label class="label" for="foodBarcode">Barcode (optional)</label>' +
    '<input class="input" id="foodBarcode" inputmode="numeric" placeholder="Scan or type" value="' + esc(bc) + '" oninput="nutriFoodInput(\'barcode\',this.value)">' +
    '<div class="composer-actions">' +
    '<button class="chip" onclick="cancelNutriForm()">Cancel</button>' +
    '<button class="btn btn-primary btn-sm" onclick="submitFood()">Add</button>' +
    '</div></div></div>';
}

function nutriFoodInput(field, value){
  if (nutriFoodDraft) nutriFoodDraft[field] = value;
}

function foodRowHtml(f, custom){
  const kcal = Math.round(+f.kcal || 0);
  const src = f.source === 'off' ? 'OFF' : f.source === 'usda' ? 'USDA' : null;
  const tail = src ? ' · ' + src : custom ? ' · yours' : (f.state ? ' · ' + esc(f.state) : '');
  const meta = Math.round(+f.protein || +f.p || 0) + 'P / ' +
    Math.round(+f.carbs || +f.c || 0) + 'C / ' +
    Math.round(+f.fat || +f.f || 0) + 'F' + tail;
  const jid = esc(JSON.stringify(f.id));
  return '<div class="food-item" role="button" tabindex="0"' +
    ' onclick="openFoodDetail(' + jid + ')"' +
    ' onkeydown="if(event.key===\'Enter\'){event.preventDefault();openFoodDetail(' + jid + ')}">' +
    foodThumbHtml(f) +
    '<span class="fi-main"><span class="fn">' + esc(f.name) + '</span>' +
    '<span class="fm">' + meta + '</span></span>' +
    '<span class="fi-kcal"><b>' + kcal + '</b><i>/100g</i></span>' +
    '<button class="fadd" onclick="event.stopPropagation();logFood(' + jid + ')"' +
    ' aria-label="Log ' + esc(f.name) + '">+</button>' +
    '</div>';
}

/* ---- recherche distante (Open Food Facts + USDA), debounce + cache 90 j ---- */
function scheduleRemoteSearch(q){
  q = String(q || '').trim();
  if (q.length < 2){ nutriRemoteState = { q: '', foods: [], loading: false, empty: false }; return; }
  if (nutriRemoteState.q === q) return;   /* deja lance / charge pour cette requete */
  clearTimeout(_remoteTimer);
  if (q.length < 3){
    /* raccourci : cache local seulement (pas d'appel par lettre) */
    searchRemote(q, { skipRemote: true }).then(r => {
      if (nutriRemoteState.q === q || true) nutriRemoteState = { q: q, foods: r.foods, loading: false, empty: false };
      if (currentTab === 'nutri-foods' && nutriForm !== 'food') renderNutriFoods();
    }).catch(() => {});
    return;
  }
  nutriRemoteState = { q: q, foods: [], loading: true, empty: false };
  _remoteTimer = setTimeout(() => {
    searchRemote(q).then(r => {
      nutriRemoteState = { q: q, foods: r.foods, loading: false, empty: r.remoteEmpty };
      if (currentTab === 'nutri-foods' && nutriForm !== 'food') renderNutriFoods();
    }).catch(() => {
      if (nutriRemoteState.q === q){ nutriRemoteState = { q: q, foods: [], loading: false, empty: false }; }
    });
  }, 450);
}

function nutriRemoteResultsHtml(q){
  const st = nutriRemoteState;
  const qq = String(q || '').trim();
  if (!st || st.q !== qq){
    return st && st.loading && st.q === qq ? '<div class="section-hint">Searching the web…</div>' : '';
  }
  if (st.loading) return '<div class="section-hint">Searching the web…</div>';
  if (!st.foods.length){
    return st.empty ? '<div class="section-hint">No packaged product found on the web for “' + esc(qq) + '”.</div>' : '';
  }
  const n = nutriDB();
  const shown = st.foods.filter(f => f && !n.foods.some(x => x && x.id === f.id));
  if (!shown.length) return '';
  return '<div class="section-hint fx-head">From the web<span class="fx-n">' + shown.length + '</span></div>' +
    '<div class="food-list">' + shown.map(f => foodRowHtml(f, false)).join('') + '</div>' +
    '<div class="section-hint">Open Food Facts · USDA — tap <b>Log</b> to save and use offline.</div>';
}

/* Log depuis une recherche distante : importe l'aliment puis logue (Snacks). */
function logRemoteFood(id, grams, unit){
  const n = nutriDB();
  let f = findNutriFood(id);
  if (!f) return;
  f = ensureFoodPersisted(f);
  const u = unit || defaultUnit(f);
  const q = grams > 0 ? grams : defaultQty(u);
  let snack = n.meals.find(m => m.date === nutriDate() && (m.type === 'snack' || m.name === 'Snacks'));
  if (!snack){
    snack = { id: uid(), date: nutriDate(), type: 'snack', name: 'Snacks', items: [] };
    n.meals.push(snack);
  }
  snack.items.push(foodItem(f, q, u));
  touchNutriRecent([f.id]);
  save();
  if (currentTab === 'nutri-foods') renderNutriFoods();
  else if (currentTab === 'nutri-meals') renderNutriMeals();
  else if (currentTab === 'nutri-today') renderNutriToday();
  toast(f.name + ' logged');
}

/* Fiche perso pre-remplie avec un code-barres (produit introuvable). */
let _pendingBarcode = null;
function addFoodWithBarcode(code){
  nutriFormOpener = document.activeElement;
  _pendingBarcode = isBarcodeFormat(code) ? String(code).trim() : null;
  nutriFoodDraft = { name:'', kcal:'', protein:'', carbs:'', fat:'', fiber:'', sugar:'', barcode:_pendingBarcode || '' };
  nutriForm = 'food';
  showTab('nutri-foods');
  revealNutriForm();
}

/* ---- fiche aliment : afficher les valeurs fournies, sans transformer une
   donnée absente en zéro ni comparer 100 g d'aliment à une cible journalière. ---- */
function microTile(l, v, u){
  const value = v == null || !Number.isFinite(+v) ? '—' : (Math.round(+v * 10) / 10) + '<small> ' + esc(u) + '</small>';
  return '<div class="micro"><div class="mv">' + value + '</div>' +
    '<div class="ml">' + esc(l) + '</div></div>';
}
function foodDetailHtml(f){
  const n = nutriDB();
  const custom = n.foods.some(x => x && x.id === f.id);
  const fav = (n.favs || []).indexOf(f.id) >= 0;
  const kcal = +f.kcal || 0, p = +f.protein || +f.p || 0, c = +f.carbs || +f.c || 0, fat = +f.fat || +f.f || 0;
  const src = f.source === 'off' ? 'Open Food Facts' : f.source === 'usda' ? 'USDA'
    : custom ? 'Your food' : (f.state || 'Food database');
  const nutriRow = (label, val, unitLbl, big) =>
    '<div class="fd-row' + (big ? ' big' : '') + '"><span class="fdk">' + label + '</span>' +
    '<b>' + (Math.round(val * 10) / 10) + (unitLbl ? ' ' + unitLbl : '') + '</b></div>';
  const more = OPTIONAL_NUTRIENT_META.map(x => {
    const value = f[x.field] != null ? f[x.field] : (x.field === 'sodium_mg' ? f.sodium : undefined);
    return microTile(x.label, value, x.unit);
  }).join('');
  return '<div class="fdetail">' +
    '<div class="fd-name">' + esc(f.name) + '</div>' +
    '<div class="fd-src">' + esc(src) + (f.barcode ? ' · ' + esc(f.barcode) : '') + '</div>' +
    '<div class="fd-per">Per 100 g</div>' +
    '<div class="fd-nutri">' +
    nutriRow('Calories', kcal, 'kcal', true) +
    nutriRow('Protein', p, 'g') +
    nutriRow('Carbs', c, 'g') +
    nutriRow('Fat', fat, 'g') +
    '</div>' +
    '<details class="fd-micros"><summary>More nutrients</summary><div class="micro-grid">' + more +
    '</div><div class="section-hint">— means the source did not provide a value.</div></details>' +
    (f.barcode ? '<div class="fd-barcode">Barcode: ' + esc(f.barcode) + '</div>' : '') +
    '<div class="composer-actions">' +
    '<button class="chip" onclick="toggleNutriFav(' + esc(JSON.stringify(f.id)) + ')"' +
    ' aria-pressed="' + fav + '" aria-label="Favorite">' + icon('star') + (fav ? ' Saved' : ' Save') + '</button>' +
    (custom ? '<button class="chip" onclick="removeFood(' + esc(JSON.stringify(f.id)) + ');closeFoodDetail()"' +
      ' aria-label="Delete food">' + icon('trash') + ' Delete</button>' : '') +
    '<button class="btn btn-primary btn-sm" onclick="logFood(' + esc(JSON.stringify(f.id)) + ');closeFoodDetail()">Log food</button>' +
    '</div></div>';
}
function openFoodDetail(id){
  const f = findNutriFood(id);
  if (!f) return;
  const body = $('foodDetailBody'), modal = $('foodDetailModal');
  if (body) body.innerHTML = foodDetailHtml(f);
  if (modal){ modal.classList.add('show'); modal.setAttribute('aria-hidden', 'false'); }
}
function closeFoodDetail(){
  const modal = $('foodDetailModal');
  if (modal){ modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); }
}

/* ---- filtres de la liste Foods (All / Favorites / Recent / Mine) ---- */
let nutriFoodFilter = 'all';
function setNutriFoodFilter(f){ nutriFoodFilter = f; renderNutriFoods(); }
function nutriFilterChipsHtml(){
  const opts = [['all', 'All'], ['fav', 'Favorites'], ['recent', 'Recent'], ['mine', 'Mine']];
  return '<div class="filter-chips" role="tablist">' + opts.map(([v, l]) =>
    '<button type="button" role="tab" class="fchip' + (nutriFoodFilter === v ? ' active' : '') + '"' +
    ' aria-selected="' + (nutriFoodFilter === v) + '" onclick="setNutriFoodFilter(\'' + v + '\')">' +
    l + '</button>').join('') + '</div>';
}

function renderNutriFoods(){
  const box = $('nutriFoods');
  if (!box) return;
  const n = nutriDB();
  const q = (($('nutriFoodSearch') && $('nutriFoodSearch').value) || '').trim();
  let html = nutriForm === 'food' ? foodFormHtml() : '';
  if (!q && !foodsDbReady() && ((n.favs || []).length || (n.recents || []).length)) ensureFoodsDb('nutri-foods');
  if (nutriForm !== 'food'){
    html += '<div class="food-prep-note">Showing ' + (nutriFoodPreparation() === 'raw' ? 'raw' : 'cooked') +
      ' values <button type="button" onclick="showRoot(\'nutrition\',\'nutri-goal\')">Change</button></div>';
  }
  if (q){
    if (!foodsDbReady()) ensureFoodsDb('nutri-foods');
    scheduleRemoteSearch(q);
    const cq = norm(q);
    const custom = n.foods.filter(f => norm(f.name).indexOf(cq) >= 0).slice(0, 10);
    const db = foodsDbReady() ? searchFoods(q, 20, nutriFoodPreparation()) : [];
    const rows = [];
    custom.forEach(f => rows.push({ f: f, custom: true }));
    db.forEach(f => { if (!rows.some(r => r.f.id === f.id)) rows.push({ f: f, custom: false }); });
    if (rows.length){
      html += '<div class="section-hint">Your foods first, then the database.</div>' +
        '<div class="food-list">' + rows.map(r => foodRowHtml(r.f, r.custom)).join('') + '</div>';
    } else {
      html += '<div class="empty">' + (foodsDbReady()
        ? 'No food matches “' + esc(q) + '”.'
        : 'Searching the database…') + '</div>';
    }
    html += nutriRemoteResultsHtml(q);
  } else {
    nutriRemoteState = { q: '', foods: [], loading: false, empty: false };
    html += nutriFilterChipsHtml();
    const asRow = id => { const f = findNutriFood(id); return f ? { f: f, custom: n.foods.some(x => x && x.id === id) } : null; };
    const prep = nutriFoodPreparation();
    const collapse = rows => window.LiftrFoods && LiftrFoods.collapseVariants
      ? LiftrFoods.collapseVariants(rows, prep) : rows;
    const favs = collapse((n.favs || []).map(asRow).filter(Boolean));
    const recents = collapse((n.recents || []).map(asRow).filter(Boolean)).slice(0, 10)
      .filter(x => !favs.some(v => v.f.id === x.f.id));
    const mine = n.foods.slice(-30).reverse().map(f => ({ f: f, custom: true }));
    const fxSec = (label, list) => '<div class="section-hint fx-head">' + label +
      '<span class="fx-n">' + list.length + '</span></div>' +
      '<div class="food-list">' + list.map(x => foodRowHtml(x.f, x.custom)).join('') + '</div>';
    const fl = nutriFoodFilter;
    if ((fl === 'all' || fl === 'fav') && favs.length) html += fxSec('Favorites', favs);
    if ((fl === 'all' || fl === 'recent') && recents.length) html += fxSec('Recent', recents);
    if ((fl === 'all' || fl === 'mine') && mine.length) html += fxSec('Your foods', mine);
    if (fl === 'all' && (n.recipes || []).length) html += recipesSectionHtml();
    const anyShown = ((fl === 'all') && (favs.length || recents.length || mine.length || (n.recipes || []).length)) ||
      (fl === 'fav' && favs.length) || (fl === 'recent' && recents.length) || (fl === 'mine' && mine.length);
    if (!anyShown){
      html += '<div class="empty">' + (fl === 'all'
        ? 'Your food list is empty — tap <b>+ Food</b> to add staples (per 100 g), or type to search.'
        : 'Nothing in this filter yet.') + '</div>';
    }
  }
  box.innerHTML = html;
  mountNutriDialog(box);
}

function mountNutriDialog(box){
  let mount = document.getElementById('nutriDialogMount');
  if (!mount){
    mount = document.createElement('div');
    mount.id = 'nutriDialogMount';
    document.body.appendChild(mount);
  }
  mount.replaceChildren();
  const dialog = box && box.querySelector('.nutri-form-backdrop');
  if (dialog) mount.appendChild(dialog);
}

function revealNutriForm(){
  requestAnimationFrame(() => {
    const close = document.querySelector('.nutri-form-backdrop [data-nutri-close]');
    if (close) { try { close.focus({ preventScroll: true }); } catch(e) { close.focus(); } }
  });
}

function restoreNutriSectionFocus(){
  const previous = nutriFormOpener;
  nutriFormOpener = null;
  requestAnimationFrame(() => {
    if (previous && previous.isConnected && !previous.closest('.hidden')){
      try { previous.focus({ preventScroll: true }); } catch(e) { previous.focus(); }
      return;
    }
    const current = document.querySelector('#rootSubnav [data-tab="' + currentTab + '"]') ||
      document.querySelector('.tabbar .tab.active');
    if (current) { try { current.focus({ preventScroll: true }); } catch(e) { current.focus(); } }
  });
}

function addFood(){
  nutriFormOpener = document.activeElement;
  _pendingBarcode = null;
  nutriFoodDraft = { name:'', kcal:'', protein:'', carbs:'', fat:'', fiber:'', sugar:'', barcode:'' };
  nutriForm = 'food';
  showTab('nutri-foods');
  revealNutriForm();
}

function submitFood(){
  const draft = nutriFoodDraft || {};
  const name = String(draft.name || ($('foodName') && $('foodName').value) || '').trim();
  if (!name){ toast('Give the food a name.'); return; }
  const n = nutriDB();
  const rd = (field, id) => {
    const el = $(id);
    const value = draft[field] !== undefined ? draft[field] : (el && el.value);
    return value !== '' && value != null ? +value || 0 : 0;
  };
  const f = {
    id: uid(), name: name,
    kcal: rd('kcal', 'foodKcal'),
    protein: rd('protein', 'foodP'),
    carbs: rd('carbs', 'foodC'),
    fat: rd('fat', 'foodF')
  };
  OPTIONAL_NUTRIENT_META.forEach(x => {
    const id = x.field === 'fiber' ? 'foodFiber' : x.field === 'sugar' ? 'foodSugar' : 'foodMore_' + x.field;
    const el = $(id);
    const raw = draft[x.field] !== undefined ? draft[x.field] : (el && el.value);
    if (raw !== '' && raw != null && Number.isFinite(+raw) && +raw >= 0) f[x.field] = +raw;
  });
  const bc = String(draft.barcode || ($('foodBarcode') && $('foodBarcode').value) || _pendingBarcode || '').trim();
  if (isBarcodeFormat(bc)){ f.barcode = bc; f.source = 'custom'; }
  const chk = atwaterCheck(f);
  n.foods.push(f);
  nutriForm = null;
  nutriFoodDraft = null;
  _pendingBarcode = null;
  save();
  renderNutriFoods();
  restoreNutriSectionFocus();
  /* Atwater : on AVERTIT, on ne bloque jamais */
  if (!chk.ok) toast('Food added — check Atwater: ' + chk.calc + ' vs ' + f.kcal + ' kcal');
  else toast('Food added');
}

function removeFood(id){
  const n = nutriDB();
  n.foods = n.foods.filter(f => f.id !== id);
  n.favs = (n.favs || []).filter(x => x !== id);
  n.recents = (n.recents || []).filter(x => x !== id);
  save();
  renderNutriFoods();
}

function toggleNutriFav(id){
  const n = nutriDB();
  const f = findNutriFood(id);
  if (f) ensureFoodPersisted(f);
  const favs = n.favs || [];
  n.favs = favs.indexOf(id) >= 0 ? favs.filter(x => x !== id) : favs.concat([id]);
  save();
  renderNutriFoods();
}

function touchNutriRecent(ids){
  const n = nutriDB();
  let r = Array.isArray(n.recents) ? n.recents : [];
  ids.forEach(id => { r = r.filter(x => x !== id); r.unshift(id); });
  n.recents = r.slice(0, 20);
}

/* Log rapide : repas « Snacks » du jour (cree si besoin), qty par defaut. */
function logFood(id){
  const n = nutriDB();
  let f = findNutriFood(id);
  if (!f) return;
  f = ensureFoodPersisted(f);   /* distant -> n.foods pour rester resolvable */
  const unit = defaultUnit(f);
  const qty = defaultQty(unit);
  let snack = n.meals.find(m => m.date === todayISO() && (m.type === 'snack' || m.name === 'Snacks'));
  if (!snack){
    snack = { id: uid(), date: todayISO(), type: 'snack', name: 'Snacks', items: [] };
    n.meals.push(snack);
  }
  snack.items.push(foodItem(f, qty, unit));
  touchNutriRecent([f.id]);
  save();
  renderNutriFoods();
  toast(f.name + ' logged');
}

/* ---- Week : fenêtre glissante (7 / 30 / 90 j) vs objectif + tendances ---- */
let nutriWeekRange = 7;
function setNutriWeekRange(v){ nutriWeekRange = v === 30 ? 30 : v === 90 ? 90 : 7; renderNutriWeek(); }

function renderNutriWeek(){
  const box = $('nutriWeek');
  if (!box) return;
  const n = nutriDB();
  const goal = nutriActiveGoal(true);
  const goalK = goal && goal.kcal > 0 ? goal.kcal : 0;
  const R = nutriWeekRange;
  const days = [];
  for (let i = R - 1; i >= 0; i--){
    const date = nutriDateMinus(i);
    const meals = n.meals.filter(m => m.date === date);
    let kcal = 0, protein = 0, carbs = 0, fat = 0;
    meals.forEach(m => { const x = nutriMealTotal(m).n; kcal += x.kcal; protein += x.protein; carbs += x.carbs; fat += x.fat; });
    days.push({ date: date, kcal: Math.round(kcal), protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat), water: nutriWaterMl(date) });
  }
  const wk = weekSummary(days, goalK);
  const streak = nutriStreak();
  const seg = '<div class="seg-row" role="group" aria-label="Range">' +
    [7, 30, 90].map(v => '<button type="button" class="seg' + (R === v ? ' active' : '') +
      '" onclick="setNutriWeekRange(' + v + ')">' + v + 'd</button>').join('') + '</div>';

  let html = '<div class="card streak-card">' +
    '<span class="streak-ico">' + icon('flame') + '</span>' +
    '<div class="streak-main"><div class="streak-n">' + streak.cur + '<small>day' + (streak.cur === 1 ? '' : 's') + '</small></div>' +
    '<div class="streak-l">Current logging streak</div></div>' +
    '<div class="streak-best">best<br><b>' + streak.best + '</b></div></div>' + seg;

  if (!wk.loggedDays){
    html += '<div class="empty">Nothing logged ' + (R === 7 ? 'this week' : 'in this period') +
      ' yet — it appears here after your first meal.</div>';
    box.innerHTML = html;
    return;
  }

  /* graphe calories (aire + ligne objectif pointillee) */
  html += nutriChartHtml(days, goalK);

  /* moyennes journalieres */
  const dn = wk.loggedDays || 1;
  const avg = k => Math.round(days.reduce((s, d) => s + d[k], 0) / dn);
  const avgRow = (l, v, goalV) => {
    const pr = goalV ? progress(v, goalV) : { pct: 0, status: 'under' };
    return '<div class="avg-row"><span class="avg-l">' + l + '</span>' +
      '<span class="pbar ' + pr.status + '" role="progressbar" aria-valuemin="0" aria-valuemax="' + (goalV || 100) +
      '" aria-valuenow="' + v + '"><i style="width:' + (goalV ? pr.pct : 0) + '%"></i></span>' +
      '<span class="avg-v">' + v + '<small>' + (goalV ? ' / ' + goalV : '') + '</small></span></div>';
  };
  html += '<div class="card"><div class="section-hint">Daily average · ' + wk.loggedDays + ' day' + (wk.loggedDays === 1 ? '' : 's') + ' logged</div>' +
    '<div class="daysum-kcal" style="margin:6px 0 10px">' + avg('kcal') + '<small>' + (goalK ? ' / ' + goalK + ' kcal' : ' kcal') + '</small></div>' +
    avgRow('Carbs', avg('carbs'), goal.c) +
    avgRow('Fat', avg('fat'), goal.f) +
    avgRow('Protein', avg('protein'), goal.p) +
    '</div>';

  const periodDates = new Set(days.map(d => d.date));
  const periodItems = n.meals.filter(m => periodDates.has(m.date)).flatMap(m => m.items || []);
  html += nutrientPanelHtml(periodItems, 'Nutrients · ' + R + '-day total');

  /* hydratation moyenne sur la fenetre */
  const wGoal = nutriWaterGoal();
  const avgW = Math.round(days.reduce((s, d) => s + d.water, 0) / R);
  html += '<div class="card"><div class="section-hint">Water</div>' + avgRow('Avg', avgW, wGoal) + '</div>';

  /* tendance poids */
  const last = days[days.length - 1].date;
  const wlog = ((window.DB && Array.isArray(DB.weightLog)) ? DB.weightLog : [])
    .filter(e => e && +e.kg > 0 && String(e.date) >= days[0].date && String(e.date) <= last)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (wlog.length >= 2){
    const dlt = Math.round((+wlog[wlog.length - 1].kg - +wlog[0].kg) * 10) / 10;
    html += '<div class="card"><div class="section-hint">Weight</div><div class="avg-row">' +
      '<span class="avg-l">' + (+wlog[0].kg).toFixed(1) + ' kg</span>' +
      '<span style="flex:1;text-align:center;color:var(--text3)">→ ' + (dlt >= 0 ? '+' : '') + dlt + ' kg</span>' +
      '<span class="avg-v">' + (+wlog[wlog.length - 1].kg).toFixed(1) + '<small> kg</small></span></div></div>';
  }

  html += '<div class="nutri-add-bar"><button class="btn" onclick="showTab(\'stats\')">Full stats →</button></div>';
  box.innerHTML = html;
}

/* ---- M2 : carte « How your target is computed » (Auto plan | Custom) ---- */
function nutriCustom(){
  const n = nutriDB();
  return Object.assign(nutriCustomDefault(), n.custom || {});
}

function calcResultHtml(){
  const g = nutriCustomGoal();
  if (g) return 'Daily target: <b>' + g.kcal + '</b> kcal — ' +
    g.p + 'P / ' + g.c + 'C / ' + g.f + 'F';
  return 'Fill the missing fields to see your target.';
}

/* Bouton segmenté : [value, label, handler] */
function calcSeg(id, cur, opts){
  return '<div class="seg-row" id="' + id + '" role="group">' +
    opts.map(o => '<button type="button" class="seg' + (String(cur) === String(o[0]) ? ' active' : '') +
      '" onclick="' + o[2] + '(\'' + o[0] + '\')">' + o[1] + '</button>').join('') + '</div>';
}

function calcNum(id, val, min, max, step){
  return '<input class="input" id="' + id + '" type="number" inputmode="decimal" min="' + min +
    '" max="' + max + '" step="' + step + '" value="' + (+val || 0) + '" oninput="customFieldChange()">';
}

function renderCalcCard(){
  const cu = nutriCustom();
  const plan = nutriPlan();
  const w = nutriWeight();
  const on = cu.mode === 'custom';
  let h = '<div class="card" id="calcModeCard">' +
    '<div class="nutri-meal-name" style="margin-bottom:10px">How your target is computed</div>' +
    calcSeg('calcMode', cu.mode, [['auto', 'Auto plan', 'setCalcMode'], ['custom', 'Custom', 'setCalcMode']]);
  if (on){
    /* calories : TDEE ± offset, ou manuel */
    h += '<div class="calc-block"><div class="calc-label">Calories</div>' +
      calcSeg('kcalSource', cu.kcalMode,
        [['tdee', 'Daily burn ± offset', 'setKcalSource'], ['manual', 'Manual', 'setKcalSource']]);
    if (cu.kcalMode === 'tdee'){
      h += plan
        ? '<div class="calc-fields"><div>' + calcNum('kcalDelta', cu.kcalDelta, -1000, 1000, 25) + '</div>' +
          '<span class="calc-note">from TDEE ' + plan.tdee + ' kcal</span></div>'
        : '<div class="calc-note">Calculate your plan first (profile above), or use Manual.</div>';
    } else {
      h += '<div class="calc-fields"><div>' + calcNum('kcalManual', cu.kcalManual, 800, 10000, 10) + '</div>' +
        '<span class="calc-note">kcal / day</span></div>';
    }
    h += '</div>';
    /* macros : presets, %, ou g/kg */
    h += '<div class="calc-block"><div class="calc-label">Macros</div>' +
      calcSeg('macroMode', cu.macroMode,
        [['preset', 'Presets', 'setMacroMode'], ['percent', 'Percentages', 'setMacroMode'],
         ['perkg', 'Per kg', 'setMacroMode']]);
    if (cu.macroMode === 'preset'){
      h += '<div class="seg-row">' + Object.keys(MACRO_PRESETS).map(k =>
        '<button type="button" class="seg' + (cu.preset === k ? ' active' : '') +
        '" onclick="setCustomPreset(\'' + k + '\')">' + MACRO_PRESETS[k].label + ' ' +
        MACRO_PRESETS[k].p + '/' + MACRO_PRESETS[k].c + '/' + MACRO_PRESETS[k].f +
        '</button>').join('') + '</div>';
    } else if (cu.macroMode === 'percent'){
      const sum = (+cu.pPct || 0) + (+cu.cPct || 0) + (+cu.fPct || 0);
      h += '<div class="calc-fields calc-pct">' +
        '<div><label class="label" for="pPct">Protein %</label>' + calcNum('pPct', cu.pPct, 0, 100, 1) + '</div>' +
        '<div><label class="label" for="cPct">Carbs %</label>' + calcNum('cPct', cu.cPct, 0, 100, 1) + '</div>' +
        '<div><label class="label" for="fPct">Fat %</label>' + calcNum('fPct', cu.fPct, 0, 100, 1) + '</div>' +
        '</div><div class="calc-note' + (sum === 100 ? '' : ' warn') + '" id="calcPctWarn">' +
        'Sum: ' + sum + '% (normalized automatically).</div>';
    } else {
      h += (w > 0 ? '' : '<div class="calc-note">Log your weight (Stats) to use per-kg targets.</div>') +
        '<div class="calc-fields">' +
        '<div><label class="label" for="pPerKg">Protein (g / kg)</label>' + calcNum('pPerKg', cu.pPerKg, 0, 5, 0.1) + '</div>' +
        '<div><label class="label" for="fPerKg">Fat (g / kg, optional)</label>' + calcNum('fPerKg', cu.fPerKg, 0, 3, 0.1) + '</div>' +
        '</div><div class="calc-note">Carbs = leftover calories ÷ 4.</div>';
    }
    h += '</div>';
    h += '<div class="calc-result" id="calcResult">' + calcResultHtml() + '</div>';
  }
  return h + '</div>';
}

/* handlers (boutons = re-render complet ; champs numériques = update local) */
function setCalcMode(mode){
  const n = nutriDB();
  const cu = nutriCustom();
  /* premier passage en Custom : le delta suit le plan (pas de saut en maintenance) */
  if (mode === 'custom' && cu.kcalMode === 'tdee' && !cu.kcalDeltaSeeded){
    const plan = nutriPlan();
    if (plan){ cu.kcalDelta = Math.round(plan.kcal - plan.tdee); cu.kcalDeltaSeeded = true; }
  }
  cu.mode = mode;
  n.custom = cu;
  save();
  renderNutriGoal();
}
function setKcalSource(v){
  const n = nutriDB();
  const cu = nutriCustom();
  cu.kcalMode = v;
  n.custom = cu;
  save();
  renderNutriGoal();
}
function setMacroMode(v){
  const n = nutriDB();
  const cu = nutriCustom();
  cu.macroMode = v;
  n.custom = cu;
  save();
  renderNutriGoal();
}
function setCustomPreset(v){
  const n = nutriDB();
  const cu = nutriCustom();
  cu.preset = v;
  n.custom = cu;
  save();
  renderNutriGoal();
}
/* lecture directe des champs numériques, persistance, mise a jour du seul resultat */
function customFieldChange(){
  const n = nutriDB();
  const cu = nutriCustom();
  const rd = id => { const el = $(id); return el && el.value !== '' ? +el.value : 0; };
  if ($('kcalDelta')) cu.kcalDelta = rd('kcalDelta');
  if ($('kcalManual')) cu.kcalManual = rd('kcalManual');
  if ($('pPct')) cu.pPct = rd('pPct');
  if ($('cPct')) cu.cPct = rd('cPct');
  if ($('fPct')) cu.fPct = rd('fPct');
  if ($('pPerKg')) cu.pPerKg = rd('pPerKg');
  if ($('fPerKg')) cu.fPerKg = rd('fPerKg');
  n.custom = cu;
  save();
  const res = $('calcResult');
  if (res) res.innerHTML = calcResultHtml();
  const warn = $('calcPctWarn');
  if (warn){
    const sum = (+cu.pPct || 0) + (+cu.cPct || 0) + (+cu.fPct || 0);
    warn.textContent = 'Sum: ' + sum + '% (normalized automatically).';
    warn.classList.toggle('warn', sum !== 100);
  }
}

/* ---- Goal : profil J2 + plan expliqué + objectif manuel (avancé) ---- */
function goalOpt(v, label, cur){ return '<option value="' + v + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + label + '</option>'; }

function nutriBmiCardHtml(){
  const b = nutriBmi();
  if (!b){
    return '<div class="card bmi-wrap"><div class="bmi-circle"><b>—</b><span>BMI</span></div>' +
      '<div class="bmi-label">No data yet</div>' +
      '<div class="bmi-risk">Log your height and weight to see your body mass index.</div></div>';
  }
  return '<div class="card bmi-wrap">' +
    '<div class="bmi-circle ' + b.cls + '"><b>' + b.value + '</b><span>BMI</span></div>' +
    '<div class="bmi-label">' + b.label + '</div>' +
    '<div class="bmi-risk">' + b.risk + '</div></div>';
}
function nutriGoalListHtml(p, goal, w){
  const actLabel = { sedentary: 'Sedentary', light: 'Light', moderate: 'Moderate', active: 'Active', very_active: 'Very active' }[p.activity] || 'Moderate';
  const goalLabel = { lose: 'Lose weight', maintain: 'Maintain', gain: 'Gain weight' }[p.goal] || 'Maintain';
  const rate = p.goal === 'maintain' ? 'Maintaining' : (p.rateKgPerWeek || 0.5) + ' kg / week';
  const rowIco = (ico, t, v) => '<div class="goal-row"><span class="goal-ico">' + ico + '</span>' +
    '<span class="gr-main"><span class="gr-t">' + t + '</span><span class="gr-v">' + v + '</span></span></div>';
  return '<div class="card goal-list">' +
    rowIco(icon('run'), 'Activity', actLabel) +
    rowIco(icon('chartup'), 'Daily target', goal.kcal ? goal.kcal + ' kcal' : goalLabel) +
    rowIco(icon('scale'), 'Weight', (w > 0 ? w + ' kg' : '—')) +
    rowIco(icon('down'), 'Weekly rate', rate) +
    '</div>';
}

/* OpenNutriTracker's canonical user_intake.json interchange. The local diary
   stays authoritative: imports merge by intake id and never replace profile,
   goals, foods, recipes, water, or unrelated meals. */
const ONT_NUTRIENT_KEYS = {
  kcal: 'energyKcal100', carbs: 'carbohydrates100', fat: 'fat100', protein: 'proteins100',
  sugar: 'sugars100', saturated_fat: 'saturatedFat100', fiber: 'fiber100',
  monounsaturated_fat: 'monounsaturatedFat100', polyunsaturated_fat: 'polyunsaturatedFat100',
  trans_fat: 'transFat100', cholesterol_mg: 'cholesterol100', sodium_mg: 'sodium100',
  potassium_mg: 'potassium100', magnesium_mg: 'magnesium100', calcium_mg: 'calcium100',
  iron_mg: 'iron100', zinc_mg: 'zinc100', phosphorus_mg: 'phosphorus100',
  vitamin_a_ug: 'vitaminA100', vitamin_c_mg: 'vitaminC100', vitamin_d_ug: 'vitaminD100',
  vitamin_b6_mg: 'vitaminB6100', vitamin_b12_ug: 'vitaminB12100', niacin_mg: 'niacin100'
};
const ONT_INTAKE_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
const NUTRI_TRANSFER_UNITS = new Set(['g', 'ml', 'piece', 'serving', 'tbsp', 'tsp', 'cup']);
const ONT_LEGACY_OFF_SCALE = {
  cholesterol100: 1000, sodium100: 1000, potassium100: 1000, magnesium100: 1000,
  calcium100: 1000, iron100: 1000, zinc100: 1000, phosphorus100: 1000,
  vitaminA100: 1000000, vitaminC100: 1000, vitaminD100: 1000000,
  vitaminB6100: 1000, vitaminB12100: 1000000, niacin100: 1000
};

function ontDerivedId(parts, occurrence){
  const value = JSON.stringify(parts);
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++){
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 'ont-derived-' + (hash >>> 0).toString(16) + '-' + occurrence;
}
function ontLocalDate(date){
  const pad = x => String(x).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}
function parseOpenTrackerIntakes(payload){
  if (!Array.isArray(payload) || !payload.length) throw new Error('Choose a non-empty nutrition diary JSON file.');
  if (payload.length > 50000) throw new Error('This diary contains more than 50,000 entries; split it into smaller files.');
  const rows = [], seen = new Set(), derived = Object.create(null);
  let duplicateIds = 0;
  payload.forEach((raw, index) => {
    const pos = index + 1;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !raw.meal || typeof raw.meal !== 'object')
      throw new Error('Entry ' + pos + ' is not a valid food diary entry. Nothing was imported.');
    const amount = Number(raw.amount);
    const dateTime = typeof raw.dateTime === 'string' ? raw.dateTime : '';
    const parsedDate = dateTime ? new Date(dateTime) : null;
    const type = String(raw.type || '').toLowerCase();
    const unit = String(raw.unit || '').trim().toLowerCase();
    const food = raw.meal;
    const name = String(food.name || '').trim();
    const nutriments = food.nutriments;
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000000 || !parsedDate || !Number.isFinite(parsedDate.getTime()) ||
        !ONT_INTAKE_TYPES.has(type) || !unit || !name || name.length > 250 || !nutriments || typeof nutriments !== 'object' || Array.isArray(nutriments)){
      throw new Error('Entry ' + pos + ' has a missing or invalid date, amount, meal type, unit, or food name. Nothing was imported.');
    }
    if (String(raw.id || '').length > 256) throw new Error('Entry ' + pos + ' has an invalid identifier. Nothing was imported.');
    if (food.servingQuantity != null && (!Number.isFinite(Number(food.servingQuantity)) || Number(food.servingQuantity) < 0 || Number(food.servingQuantity) > 1000000))
      throw new Error('Entry ' + pos + ' has an invalid serving size. Nothing was imported.');
    for (const key of Object.values(ONT_NUTRIENT_KEYS)){
      const v = nutriments[key];
      if (v != null && (v === '' || !Number.isFinite(Number(v)) || Number(v) < 0))
        throw new Error('Entry ' + pos + ' contains an invalid nutrient value. Nothing was imported.');
    }
    const source = String(food.source || 'unknown').toLowerCase();
    const signature = [dateTime, type, amount, unit, source, String(food.code || ''), name, String(food.brands || '')];
    let id = String(raw.id || '').trim();
    if (!id){
      const sig = JSON.stringify(signature);
      derived[sig] = (derived[sig] || 0) + 1;
      id = ontDerivedId(signature, derived[sig]);
    }
    if (seen.has(id)){ duplicateIds++; return; }
    seen.add(id);
    const servingQuantity = Number(food.servingQuantity);
    const servingUnit = String(food.servingUnit || '').trim().toLowerCase();
    let localUnit = unit, localQty = amount, servingUnknown = false;
    if (unit === 'serving' || unit === 'piece'){
      if (Number.isFinite(servingQuantity) && servingQuantity > 0 && servingQuantity <= 1000000 && (servingUnit === 'g' || servingUnit === 'ml')){
        localUnit = servingUnit;
        localQty = amount * servingQuantity;
      } else {
        localUnit = 'serving';
        servingUnknown = true;
      }
    } else if (!NUTRI_TRANSFER_UNITS.has(unit)) {
      localUnit = 'serving';
      servingUnknown = true;
    }
    if (!Number.isFinite(localQty) || localQty <= 0)
      throw new Error('Entry ' + pos + ' has an unusable serving size. Nothing was imported.');
    const sourceLocal = source === 'fdc' ? 'usda' : (source === 'off' ? 'off' : 'custom');
    const dataVersion = Number(food.dataVersion);
    const scaleLegacyOff = source === 'off' && (!Number.isFinite(dataVersion) || dataVersion < 1);
    const snapshot = {
      id: 'ont:' + id, name: name, source: sourceLocal,
      barcode: String(food.code || ''), brands: String(food.brands || '')
    };
    if (servingUnknown) snapshot.ontServingUnknown = true;
    Object.keys(ONT_NUTRIENT_KEYS).forEach(field => {
      const key = ONT_NUTRIENT_KEYS[field], v = nutriments[key];
      if (v == null || v === '') snapshot[field] = null;
      else {
        const scale = scaleLegacyOff ? (ONT_LEGACY_OFF_SCALE[key] || 1) : 1;
        const converted = Number(v) * scale;
        if (!Number.isFinite(converted)) throw new Error('Entry ' + pos + ' has a nutrient value outside the supported range. Nothing was imported.');
        snapshot[field] = converted;
      }
    });
    rows.push({
      id, date: ontLocalDate(parsedDate), dateTime: dateTime, type: type,
      qty: localQty, unit: localUnit, originalUnit: unit, originalAmount: amount,
      food: food, snapshot: snapshot
    });
  });
  return { rows, duplicateIds };
}
function openNutriOpenTrackerImport(){
  const input = $('nutriOpenTrackerFile');
  if (input) input.click();
}
function importNutriOpenTracker(input){
  const file = input && input.files && input.files[0];
  if (!file) return;
  if (file.size > 25 * 1024 * 1024){ input.value = ''; toast('This file is too large to import here (25 MB maximum).'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try { parsed = parseOpenTrackerIntakes(JSON.parse(String(reader.result || ''))); }
    catch (e){ toast(e && e.message ? e.message : 'Invalid nutrition diary file.'); input.value = ''; return; }
    const n = nutriDB();
    const existing = new Set();
    n.meals.forEach(m => (m.items || []).forEach(it => { if (it && it.ontId) existing.add(String(it.ontId)); }));
    const updates = parsed.rows.filter(row => existing.has(row.id)).length;
    const additions = parsed.rows.length - updates;
    input.value = '';
    askConfirm('Import nutrition diary?',
      parsed.rows.length + ' food entr' + (parsed.rows.length === 1 ? 'y' : 'ies') + ' found · ' + additions + ' new · ' + updates + ' matching ID(s) updated' +
      (parsed.duplicateIds ? ' · ' + parsed.duplicateIds + ' duplicate ID row(s) ignored' : '') +
      '. Existing matching entries will be replaced. Other LIFTR meals and profile data stay as they are. Entries with no usable serving weight remain visible but their nutrients cannot be calculated.',
      'Merge diary')
    .then(result => {
      if (!result.ok) return;
      const current = nutriDB();
      parsed.rows.forEach(row => {
        current.meals.forEach(m => { m.items = (m.items || []).filter(it => !it || String(it.ontId || '') !== row.id); });
        current.meals = current.meals.filter(m => !(m.importSource === 'opennutritracker' && !m.items.length));
        const groupId = 'ont-meal-' + row.date + '-' + row.type;
        let meal = current.meals.find(m => m.id === groupId);
        if (!meal){
          meal = { id: groupId, date: row.date, type: row.type, name: mealTypeLabel(row.type), items: [], importSource: 'opennutritracker' };
          current.meals.push(meal);
        }
        const meta = row.food;
        meal.items.push({
          foodId: 'ont:' + row.id, qty: row.qty, unit: row.unit, name: row.snapshot.name,
          snapshot: row.snapshot, snapshotVersion: 1, ontId: row.id,
          ontAmount: row.originalAmount, ontUnit: row.originalUnit, ontDateTime: row.dateTime,
          ontMeal: {
            code: meta.code == null ? null : String(meta.code), brands: meta.brands || '',
            source: meta.source || 'unknown', mealQuantity: meta.mealQuantity,
            mealUnit: meta.mealUnit, servingQuantity: meta.servingQuantity,
            servingUnit: meta.servingUnit, servingSize: meta.servingSize,
            thumbnailImageUrl: meta.thumbnailImageUrl || null, mainImageUrl: meta.mainImageUrl || null,
            url: meta.url || null
          }
        });
      });
      save();
      renderNutrition(currentTab);
      if (typeof window.renderToday === 'function') window.renderToday();
      toast('Diary updated · ' + additions + ' new · ' + updates + ' updated');
    });
  };
  reader.onerror = () => { input.value = ''; toast('Could not read this JSON file.'); };
  reader.readAsText(file);
}
function exportNutriOpenTracker(){
  const n = nutriDB();
  const output = [], skipped = [];
  n.meals.forEach((m, mealIndex) => (m.items || []).forEach((it, itemIndex) => {
    const food = (it && it.snapshot) || (it && it.foodId ? findNutriFood(it.foodId) : null);
    const qty = Number(it && it.qty);
    if (!food || !Number.isFinite(qty) || qty <= 0){ skipped.push(it && it.name || 'unknown food'); return; }
    const sourceMeta = it.ontMeal || {};
    let unit = String(it.ontUnit || it.unit || 'g').toLowerCase();
    let amount = Number.isFinite(Number(it.ontAmount)) && it.ontAmount != null ? Number(it.ontAmount) : qty;
    let servingQuantity = sourceMeta.servingQuantity;
    let servingUnit = sourceMeta.servingUnit;
    let servingSize = sourceMeta.servingSize || null;
    if (!it.ontUnit && unit !== 'g' && unit !== 'ml'){
      try {
        const mass = toGrams(food, 1, unit);
        if (mass > 0){ unit = 'serving'; amount = qty; servingQuantity = mass; servingUnit = 'g'; servingSize = mass + ' g'; }
        else { unit = 'serving'; amount = qty; }
      } catch (e){ unit = 'serving'; amount = qty; }
    }
    if (!['g', 'ml', 'serving'].includes(unit)){
      const originalUnit = unit;
      unit = 'serving';
      if (!it.ontUnit) amount = qty;
      if (servingQuantity == null){
        try {
          const grams = toGrams(food, 1, originalUnit);
          if (grams > 0){ servingQuantity = grams; servingUnit = 'g'; servingSize = grams + ' g'; }
        } catch (e){}
      }
    }
    const nutriments = {};
    Object.keys(ONT_NUTRIENT_KEYS).forEach(field => {
      const value = food[field];
      nutriments[ONT_NUTRIENT_KEYS[field]] = value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
    });
    const source = sourceMeta.source || (food.source === 'usda' ? 'fdc' : food.source === 'off' ? 'off' : food.source === 'custom' ? 'custom' : 'unknown');
    let dateTime = it.ontDateTime || '';
    if (!dateTime){
      const date = String(m.date || todayISO());
      dateTime = date.slice(0, 10) + 'T12:00:00.000';
    }
    output.push({
      id: String(it.ontId || ('liftr:' + (m.id || mealIndex) + ':' + itemIndex)),
      unit: unit, amount: amount, type: ONT_INTAKE_TYPES.has(m.type) ? m.type : 'snack', dateTime: dateTime,
      meal: {
        code: sourceMeta.code != null ? sourceMeta.code : (food.barcode || null),
        name: String(food.name || it.name || 'Food'), brands: sourceMeta.brands || food.brands || '',
        thumbnailImageUrl: sourceMeta.thumbnailImageUrl || null, mainImageUrl: sourceMeta.mainImageUrl || null,
        url: sourceMeta.url || null,
        mealQuantity: sourceMeta.mealQuantity != null ? String(sourceMeta.mealQuantity) : '100',
        mealUnit: sourceMeta.mealUnit || 'g', servingQuantity: servingQuantity == null ? null : Number(servingQuantity),
        servingUnit: servingUnit || null, servingSize: servingSize,
        source: source, nutriments: nutriments, dataVersion: 1
      }
    });
  }));
  if (!output.length){ toast('No nutrition entries could be exported.'); return; }
  const blob = new Blob([JSON.stringify(output, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'user_intake.json';
  document.body.appendChild(link); link.click();
  setTimeout(() => { URL.revokeObjectURL(link.href); link.remove(); }, 400);
  toast('Exported ' + output.length + ' diary entr' + (output.length === 1 ? 'y' : 'ies') + (skipped.length ? ' · skipped ' + skipped.length + ' unsupported line(s)' : ''));
}

function renderNutriGoal(){
  const box = $('nutriGoal');
  if (!box) return;
  const p = nutriProfile();
  const plan = nutriPlan();
  const goal = nutriActiveGoal(true);
  const w = nutriWeight();
  const row = (label, val) => '<div class="nutri-plan-row"><span>' + label + '</span><b>' + val + '</b></div>';

  const prep = nutriFoodPreparation();
  let html = '<div class="card nutri-form nutri-food-prep-setting">' +
    '<div class="nutri-meal-name">Food values</div>' +
    '<div class="section-hint">Foods with raw and cooked data appear once. This choice sets the values used for new food searches and meal entries; saved meals stay unchanged.</div>' +
    '<label class="label" for="nutriFoodPreparation">Default preparation</label>' +
    '<select class="input" id="nutriFoodPreparation" onchange="saveNutriFoodPreparation(this.value)">' +
      '<option value="cooked"' + (prep === 'cooked' ? ' selected' : '') + '>Cooked</option>' +
      '<option value="raw"' + (prep === 'raw' ? ' selected' : '') + '>Raw</option>' +
    '</select></div>' +
    nutriBmiCardHtml() + nutriGoalListHtml(p, goal, w) + '<div class="card nutri-form">' +
    '<div class="nutri-meal-name" style="margin-bottom:10px">Your plan</div>' +
    (w > 0
      ? '<div class="section-hint">Current weight: <b>' + w + ' kg</b> — updated by your weigh-ins (Body weight, Stats).</div>'
      : '<label class="label" for="profWeight">Current weight (kg)</label>' +
        '<input class="input" id="profWeight" type="number" inputmode="decimal" min="30" max="300" step="0.1" placeholder="e.g. 82.4">') +
    '<div class="nutri-form-row">' +
    '<div><label class="label" for="profHeight">Height (cm)</label>' +
    '<input class="input" id="profHeight" type="number" inputmode="numeric" min="100" max="250" value="' + (p.heightCm || '') + '"></div>' +
    '<div><label class="label" for="profAge">Age</label>' +
    '<input class="input" id="profAge" type="number" inputmode="numeric" min="13" max="100" value="' + (p.age || '') + '"></div>' +
    '</div>' +
    '<label class="label" for="profSex">Sex</label>' +
    '<select class="input" id="profSex">' + goalOpt('male', 'Male', p.sex) + goalOpt('female', 'Female', p.sex) + '</select>' +
    '<label class="label" for="profActivity">Activity</label>' +
    '<select class="input" id="profActivity">' +
      goalOpt('sedentary', 'Sedentary — desk, little sport', p.activity) +
      goalOpt('light', 'Light — 1-3 sessions / week', p.activity) +
      goalOpt('moderate', 'Moderate — 3-5 sessions / week', p.activity) +
      goalOpt('active', 'Active — 6-7 sessions / week', p.activity) +
      goalOpt('very_active', 'Very active — physical job + daily training', p.activity) +
    '</select>' +
    '<label class="label" for="profGoal">Goal</label>' +
    '<select class="input" id="profGoal">' +
      goalOpt('lose', 'Lose weight', p.goal) +
      goalOpt('maintain', 'Maintain', p.goal) +
      goalOpt('gain', 'Gain weight', p.goal) +
    '</select>' +
    '<label class="label" for="profRate">Speed (kg / week)</label>' +
    '<select class="input" id="profRate">' +
      goalOpt('0.25', '0.25 — gentle', p.rateKgPerWeek) +
      goalOpt('0.5', '0.5 — steady', p.rateKgPerWeek) +
      goalOpt('0.75', '0.75 — fast', p.rateKgPerWeek) +
      goalOpt('1', '1 — maximum safe', p.rateKgPerWeek) +
    '</select>' +
    '<label class="label" for="profBodyFat">Body fat % (optional, more precise)</label>' +
    '<input class="input" id="profBodyFat" type="number" inputmode="decimal" min="3" max="60" step="0.1" value="' + (p.bodyFatPct || '') + '">' +
    '<button class="btn btn-primary btn-block" id="profCalc" style="margin-top:12px" onclick="saveNutriProfile()">Calculate target</button>' +
    '</div>';

  /* M2 : mode de calcul (Auto plan | Custom) — custom gagne sur le plan */
  html += renderCalcCard();

  if (plan){
    const adapt = nutriAdaptive();
    const proj4 = projectWeight({ weightKg: w, tdee: plan.tdee, kcalPerDay: goal.kcal, weeks: 4 });
    const proj8 = projectWeight({ weightKg: w, tdee: plan.tdee, kcalPerDay: goal.kcal, weeks: 8 });
    html += '<div class="card" id="nutriPlanCard">' +
      row('Basal burn (BMR)', plan.bmr + ' kcal') +
      row('Daily burn (TDEE)', plan.tdee + ' kcal') +
      row('Daily target', goal.kcal + ' kcal') +
      '<div class="nutri-plan-macros">Protein <b>' + goal.p + ' g</b> · Carbs <b>' + goal.c + ' g</b> · Fat <b>' + goal.f + ' g</b></div>' +
      (plan.notes.indexOf('floor_applied') >= 0
        ? '<div class="chip nutri-plan-note">Target raised to stay above your basal needs.</div>' : '') +
      (plan.notes.indexOf('rate_capped') >= 0
        ? '<div class="chip nutri-plan-note">Speed capped to a safe rate for your body weight.</div>' : '') +
      (p.goal !== 'maintain'
        ? '<div class="section-hint">If you keep this target: ≈ ' + proj4 + ' kg in 4 weeks · ≈ ' + proj8 + ' kg in 8 weeks.</div>'
        : '') +
      (adapt
        ? '<div class="card nutri-adapt"><span>Your weight trend differs from the plan — suggested change: ' +
          (adapt.deltaKcal > 0 ? '+' : '') + adapt.deltaKcal + ' kcal / day.</span>' +
          '<button class="chip" id="adaptApply" onclick="applyAdaptive()">Apply</button></div>'
        : '') +
      '<div class="section-hint nutri-plan-legal">Estimates only — not medical advice. Avoid extreme targets.</div>' +
      '</div>';
  }

  /* objectifs additionnels : hydratation + fibres (recalcules depuis le poids / kcal) */
  const wGoal = nutriWaterGoal();
  const fGoal = nutriFiberGoal();
  html += '<div class="card" id="nutriExtraGoals">' +
    '<div class="nutri-meal-name" style="margin-bottom:10px">Daily targets</div>' +
    row('Fiber', (fGoal ? fGoal + ' g' : '—')) +
    row('Water', wGoal + ' ml') +
    '<div class="nutri-form-row" style="margin-top:8px">' +
    '<div><label class="label" for="waterGoalInput">Water goal (ml)</label>' +
    '<input class="input" id="waterGoalInput" type="number" inputmode="numeric" min="0" max="8000" step="50" value="' + wGoal + '"></div>' +
    '</div>' +
    '<button class="chip" style="margin-top:8px" onclick="saveWaterGoal()">Save water goal</button>' +
    '<div class="section-hint">Fiber ≈ 14 g / 1 000 kcal. Water ≈ 35 ml / kg (editable).</div>' +
    '</div>';

  /* objectif manuel (avancé) : conservé tel quel — repli si ni plan ni Custom */
  const g = nutriDB().goal;
  html += '<div class="card nutri-form" style="margin-top:12px">' +
    '<div class="section-hint" style="margin-bottom:8px">Manual target (advanced) — used when Auto plan has no plan, and Custom is off.</div>' +
    '<label class="label" for="goalKcal">Daily calories (kcal)</label>' +
    '<input class="input" id="goalKcal" type="number" inputmode="numeric" min="0" value="' + (+g.kcal || '') + '">' +
    '<label class="label" for="goalP">Protein (g)</label>' +
    '<input class="input" id="goalP" type="number" inputmode="numeric" min="0" value="' + (+g.p || '') + '">' +
    '<label class="label" for="goalC">Carbs (g)</label>' +
    '<input class="input" id="goalC" type="number" inputmode="numeric" min="0" value="' + (+g.c || '') + '">' +
    '<label class="label" for="goalF">Fat (g)</label>' +
    '<input class="input" id="goalF" type="number" inputmode="numeric" min="0" value="' + (+g.f || '') + '">' +
    '<button class="btn btn-primary btn-block" style="margin-top:12px" onclick="saveNutriGoal()">Save goal</button>' +
    '</div>' +
    '<div class="section-hint">Targets are private and stored on this device.</div>';

  box.innerHTML = html;
  renderNutriWeek();
}

function saveNutriProfile(){
  const n = nutriDB();
  if (!n) return;
  const p = nutriProfile();
  const h = +($('profHeight') && $('profHeight').value);
  const age = +($('profAge') && $('profAge').value);
  if (!(h > 0) || !(age > 0)){ toast('Height and age are required.'); return; }
  p.heightCm = h;
  p.age = age;
  p.sex = ($('profSex') && $('profSex').value) === 'female' ? 'female' : 'male';
  if ($('profActivity')) p.activity = $('profActivity').value;
  if ($('profGoal')) p.goal = $('profGoal').value;
  p.rateKgPerWeek = +($('profRate') && $('profRate').value) || 0.5;
  p.bodyFatPct = +($('profBodyFat') && $('profBodyFat').value) || 0;
  if (!nutriWeight()){
    const w = +($('profWeight') && $('profWeight').value);
    if (!(w > 0)){ toast('Enter your weight once to start.'); return; }
    DB.weightLog = (Array.isArray(DB.weightLog) ? DB.weightLog : []).concat([{ date: todayISO(), kg: w }]);
  }
  const plan = nutriPlan();
  if (plan) nutriActiveGoal(true);   /* alimente DB.nutri.goal */
  save();
  renderNutriGoal();
  toast(plan ? 'Plan saved' : 'Profile saved');
}

/* Ajustement adaptatif : proposé dans le résultat, appliqué seulement au clic. */
function applyAdaptive(){
  const adapt = nutriAdaptive();
  if (!adapt) return;
  const p = nutriProfile();
  p.kcalOffset = p.kcalOffset + adapt.deltaKcal;
  p.adaptApplied = { delta: adapt.deltaKcal, on: todayISO() };
  nutriActiveGoal(true);
  save();
  renderNutriGoal();
  toast('Target adjusted by ' + (adapt.deltaKcal > 0 ? '+' : '') + adapt.deltaKcal + ' kcal');
}

function saveNutriGoal(){
  const n = nutriDB();
  n.goal = {
    kcal: +($('goalKcal') && $('goalKcal').value) || 0,
    p: +($('goalP') && $('goalP').value) || 0,
    c: +($('goalC') && $('goalC').value) || 0,
    f: +($('goalF') && $('goalF').value) || 0
  };
  save();
  toast('Goal saved');
}

function cancelNutriForm(){
  nutriForm = null;
  nutriDraft = null;
  nutriFoodDraft = null;
  _pendingBarcode = null;
  renderNutrition(currentTab);
  restoreNutriSectionFocus();
}

document.addEventListener('keydown', function(e){
  if (e.key === 'Escape' && nutriForm){
    e.preventDefault();
    e.stopPropagation();
    cancelNutriForm();
    return;
  }
  if (e.key === 'Tab' && nutriForm){
    const dialog = document.querySelector('#nutriDialogMount [role="dialog"]');
    if (!dialog) return;
    const targets = Array.from(dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'))
      .filter(el => el.getClientRects().length > 0);
    if (!targets.length) return;
    const first = targets[0], last = targets[targets.length - 1];
    if (e.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))){
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))){
      e.preventDefault(); first.focus();
    }
  }
}, true);

Object.assign(window, {
  renderNutrition, nutriDB, nutriTotalsOf,
  nutriFoodPreparation, saveNutriFoodPreparation,
  /* meals : liste + builder foodId/qty */
  addMeal, addMealFor, editMeal, editMealItem, removeMeal, removeMealItem,
  saveMealDraft, cancelNutriForm, copyYestMeal, saveMealAsRecipe,
  mealNameInput, mealTypeChange, mealSearchInput, pickMealFood,
  itemQtyInput, itemUnitChange, addDraftItem, editDraftItem, removeDraftItem,
  /* foods : per 100 g + recherche + log */
  addFood, submitFood, nutriFoodInput, removeFood, logFood, toggleNutriFav,
  openFoodDetail, closeFoodDetail, setNutriFoodFilter,
  /* J2 : profil / plan */
  nutriProfile, nutriWeight, nutriPlan, nutriActiveGoal, nutriAdaptive,
  saveNutriProfile, applyAdaptive, saveNutriGoal,
  /* M2 : objectif custom */
  nutriCustomGoal, setCalcMode, setKcalSource, setMacroMode, setCustomPreset, customFieldChange,
  MACRO_PRESETS, targetsFromPercent, targetsFromPerKg,
  /* chantier Nutrition : multi-jour, eau, recettes, recherche web, scanner, semaine */
  nutriPrevDay, nutriNextDay, nutriGotoToday,
  nutriGotoDate, nutriPrevMonth, nutriNextMonth,
  addWater, logWater, saveWaterGoal,
  useRecipe, deleteRecipe,
  logRemoteFood, addFoodWithBarcode,
  setNutriWeekRange, openNutriTransfer,
  openNutriOpenTrackerImport, importNutriOpenTracker, exportNutriOpenTracker
});
