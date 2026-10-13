/* ==================================================================
   NUTRITION (chantier F + J2 + J3) — Today / Meals / Foods / Goal / Week
   Données locales dans DB.nutri : { profile, goal, foods, meals,
   favs, recents } — Rien de réseau : 100 % offline-first.
   J2 : profil -> buildPlan -> objectif auto, garde-fous, poids unique.
   J3 : ecrans (kcal-card/pbar, builder repas foodId+qty, aliments
   per-100 g, semaine) — totaux TOUJOURS recalculés à l'affichage.
   ================================================================== */
import { buildPlan, macroTargets, projectWeight, adaptiveAdjustment,
  UNITS, nutrientsFor, sumNutrients, recipeToFood, atwaterCheck,
  progress, weekSummary, MACRO_PRESETS, targetsFromPercent, targetsFromPerKg } from './nutrition.js';
import { loadFoods, searchFoods, getFood as getDbFood, allFoods, norm } from './foods.js';

function nutriDB(){
  if (!window.DB) return null;
  if (!DB.nutri || typeof DB.nutri !== 'object') DB.nutri = {};
  const n = DB.nutri;
  if (!n.goal || typeof n.goal !== 'object') n.goal = { kcal: 0, p: 0, c: 0, f: 0 };
  if (!Array.isArray(n.foods)) n.foods = [];
  if (!Array.isArray(n.meals)) n.meals = [];
  if (!Array.isArray(n.favs)) n.favs = [];
  if (!Array.isArray(n.recents)) n.recents = [];
  n.meals.forEach(m => { if (!Array.isArray(m.items)) m.items = []; });
  /* aliments persos legacy (p/c/f) -> noms nutrition.js (per 100 g) */
  n.foods.forEach(f => {
    if (f && f.protein === undefined && f.p !== undefined) f.protein = +f.p || 0;
    if (f && f.carbs === undefined && f.c !== undefined) f.carbs = +f.c || 0;
    if (f && f.fat === undefined && f.f !== undefined) f.fat = +f.f || 0;
  });
  return n;
}

let nutriForm = null;   /* 'meal' | 'food' | null */

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
  return (window.LiftrFoods && LiftrFoods.get(id)) || null;
}
function foodsDbReady(){ return !!(window.LiftrFoods && LiftrFoods.all().length); }
function ensureFoodsDb(tab){
  if (foodsDbReady() || !window.LiftrFoods) return;
  LiftrFoods.load().then(() => {
    if (currentTab === tab && typeof window.renderNutrition === 'function') window.renderNutrition(tab);
  }).catch(() => {});
}
function mealsNeedFoods(meals){
  return meals.some(m => (m.items || []).some(it =>
    it.foodId && !findNutriFood(it.foodId) && !foodsDbReady()));
}
function nutriItemN(it){
  if (it.foodId){
    const f = findNutriFood(it.foodId);
    if (!f) return null;
    try { return nutrientsFor(f, +it.qty || 0, it.unit || 'g'); }
    catch (e){ return null; }
  }
  /* legacy : totaux stockes a l'ecriture (ancien modele) */
  return { kcal: +it.kcal || 0, protein: +it.p || 0, carbs: +it.c || 0,
    fat: +it.f || 0, fiber: 0, sugar: 0, sodium_mg: 0 };
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
    const f = findNutriFood(it.foodId);
    if (f) return f.name;
  }
  return it.name || 'Item';
}
function nutriItemKcal(it){ const x = nutriItemN(it); return x ? x.kcal : 0; }
function nutriQtyLabel(it){
  if (it.foodId == null) return '';
  const q = Math.round((+it.qty || 0) * 10) / 10;
  return q + ' ' + (it.unit || 'g');
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
        '<button class="icon-btn" onclick="editMealItem(' + esc(JSON.stringify(m.id)) + ',' + ii + ')" aria-label="Edit ingredient">✎</button>' +
        '<button class="icon-btn" onclick="removeMealItem(' + esc(JSON.stringify(m.id)) + ',' + ii + ')" aria-label="Remove ingredient">✕</button>' +
        '</span>'
      : '';
    const qty = nutriQtyLabel(it);
    return '<div class="ing-row"><span class="ing-n">' + esc(nutriItemName(it)) + '</span>' +
      '<span class="ing-g">' + esc(qty) + '</span>' +
      '<span class="ing-k">' + Math.round(nutriItemKcal(it)) + ' kcal</span>' + acts + '</div>';
  }).join('');
  const miss = mt.missing
    ? '<div class="ing-row"><span class="ing-n">…</span><span class="ing-g"></span><span class="ing-k">…</span></div>'
    : '';
  const acts = editable
    ? '<span class="meal-head-actions">' +
      '<button class="icon-btn" onclick="editMeal(' + esc(JSON.stringify(m.id)) + ')" aria-label="Edit meal">✎</button>' +
      '<button class="icon-btn" onclick="saveMealAsRecipe(' + esc(JSON.stringify(m.id)) + ')" aria-label="Save as recipe">★</button>' +
      '<button class="icon-btn" onclick="removeMeal(' + esc(JSON.stringify(m.id)) + ')" aria-label="Delete meal">🗑</button></span>'
    : '';
  return '<div class="card meal-card meal-' + esc(type) + '">' +
    '<div class="meal-head">' +
    '<span class="meal-dot ' + esc(type) + '" aria-hidden="true"></span>' +
    '<div class="meal-title"><div class="meal-name">' + esc(m.name) + '</div>' +
    '<div class="meal-sub">' + mealTypeLabel(type) + ' · ' + Math.round(t.protein) + 'P / ' +
    Math.round(t.carbs) + 'C / ' + Math.round(t.fat) + 'F</div></div>' +
    '<div class="meal-head-right"><span class="meal-kcal">' + Math.round(t.kcal) +
    ' <small>kcal</small></span>' + acts + '</div>' +
    '</div>' + rows + miss + '</div>';
}

function renderNutriToday(){
  const box = $('nutriToday');
  if (!box) return;
  const n = nutriDB();
  const date = todayISO();
  const meals = n.meals.filter(m => m.date === date);
  if (mealsNeedFoods(meals)) ensureFoodsDb('nutri-today');
  const g = nutriActiveGoal(true);   /* plan du profil recalcule depuis le poids */
  const hasGoal = (+g.kcal || +g.p || +g.c || +g.f) > 0;
  const t = nutriTotalsOf(date);
  const plan = nutriPlan();

  let card;
  if (!hasGoal){
    card = '<div class="empty">No goal set yet — open the <b>Goal</b> tab to set daily targets.</div>';
  } else {
    const pr = progress(t.kcal, g.kcal);
    const eaten = Math.round(t.kcal);
    const goalK = Math.round(g.kcal);
    const left = pr.status === 'over'
      ? '<div class="kcal-left"><b>' + pr.overBy + '</b> over</div>'
      : '<div class="kcal-left"><b>' + pr.remaining + '</b> left</div>';
    const meta = plan
      ? '<div class="kcal-meta"><span>BMR ' + Math.round(plan.bmr) + '</span>' +
        '<span>TDEE ' + Math.round(plan.tdee) + '</span>' +
        '<span>Goal ' + (plan.kcal - plan.tdee >= 0 ? '+' : '−') +
        Math.abs(Math.round(plan.kcal - plan.tdee)) + '</span></div>'
      : '';
    card = '<div class="card kcal-card">' +
      '<div class="kcal-top"><div class="kcal-eaten">' + eaten +
      '<small>/ ' + goalK + ' kcal</small></div>' + left + '</div>' +
      '<div class="pbar ' + pr.status + '" role="progressbar" aria-label="Calories today"' +
      ' aria-valuemin="0" aria-valuemax="' + goalK + '" aria-valuenow="' + eaten + '">' +
      '<span class="sr-only">' + eaten + ' of ' + goalK + ' kcal</span>' +
      '<i style="width:' + pr.pct + '%"></i></div>' + meta +
      '<div class="macros">' +
      nutriMacroBar('p', 'Protein', t.p, g.p) +
      nutriMacroBar('c', 'Carbs', t.c, g.c) +
      nutriMacroBar('f', 'Fat', t.f, g.f) +
      '</div></div>';
  }

  const stack = meals.length
    ? '<div class="meal-stack">' + meals.map(m => nutriMealCard(m, false)).join('') + '</div>'
    : '<div class="empty" style="margin-top:12px">Nothing logged yet — tap <b>+ Add meal</b> to record what you ate.</div>';
  const bar = '<div class="nutri-add-bar"><button class="btn btn-primary" onclick="addMeal()">+ Add meal</button></div>';
  box.innerHTML = card + stack + bar;
}

/* ---- Meals : liste du jour + builder (foodId + qty, totaux live) ---- */
let nutriDraft = null;   /* {id, type, name, items, pick, q, focus} */

const MEAL_TYPES = [['breakfast','Breakfast'],['lunch','Lunch'],['dinner','Dinner'],['snack','Snack']];
function mealTypeLabel(t){
  const f = MEAL_TYPES.find(x => x[0] === t);
  return f ? f[1] : 'Meal';
}
function newDraft(){
  const h = new Date().getHours();
  const type = h < 11 ? 'breakfast' : h < 16 ? 'lunch' : 'dinner';
  return { id: null, type: type, name: mealTypeLabel(type), items: [], pick: null, q: '' };
}
function draftFromMeal(m){
  return { id: m.id, type: m.type || 'lunch', name: m.name || 'Meal',
    items: (m.items || []).map(it => Object.assign({}, it)), pick: null, q: '' };
}
function allowedUnits(food){
  const hasPiece = !!(food && food.gramsPerUnit && food.gramsPerUnit.piece != null);
  return UNITS.filter(u => u !== 'piece' || hasPiece);
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
  nutriDraft.focus = 'search';
  renderNutriMeals();
}
function pickMealFood(id){
  const d = nutriDraft;
  if (!d) return;
  const f = findNutriFood(id);
  if (!f) return;
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
  const f = findNutriFood(d.pick.foodId);
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
  const item = { foodId: d.pick.foodId, qty: qty, unit: d.pick.unit || 'g', name: d.pick.name };
  if (d.pick.from >= 0) d.items[d.pick.from] = item;
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
    unit: it.unit || 'g', from: i };
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
  const db = foodsDbReady() ? searchFoods(q, 12) : [];
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
  const yMeals = n.meals.filter(m => m.date === nutriDateMinus(1));
  const copyRow = (yMeals.length && !d.items.length)
    ? '<div class="nutri-copy-row"><span class="section-hint" style="margin:0">Copy from yesterday:</span>' +
      yMeals.map(m => '<button type="button" class="chip" onclick="copyYestMeal(' +
        esc(JSON.stringify(m.id)) + ')">' + esc(m.name) + '</button>').join('') + '</div>'
    : '';
  const typeOpts = MEAL_TYPES.map(([v, l]) =>
    '<option value="' + v + '"' + (d.type === v ? ' selected' : '') + '>' + l + '</option>').join('');
  const itemsCard = d.items.length
    ? '<div class="card meal-card builder-items">' +
      d.items.map((it, i) =>
        '<div class="ing-row"><span class="ing-n">' + esc(nutriItemName(it)) + '</span>' +
        '<span class="ing-g">' + esc(nutriQtyLabel(it)) + '</span>' +
        '<span class="ing-k">' + Math.round(nutriItemKcal(it)) + ' kcal</span>' +
        '<span class="ing-actions">' +
        '<button class="icon-btn" onclick="editDraftItem(' + i + ')" aria-label="Edit ingredient">✎</button>' +
        '<button class="icon-btn" onclick="removeDraftItem(' + i + ')" aria-label="Remove ingredient">✕</button>' +
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
  return '<div class="card nutri-form builder-form">' +
    '<input class="input" id="mealName" placeholder="Meal name" maxlength="60" value="' + esc(d.name) + '"' +
    ' oninput="mealNameInput(this.value)">' +
    '<div class="nutri-form-row builder-row">' +
    '<select class="input" id="mealType" aria-label="Meal type" onchange="mealTypeChange(this.value)">' + typeOpts + '</select>' +
    '<input class="input builder-search" id="mealFoodSearch" placeholder="Search foods…" aria-label="Search foods to add"' +
    ' value="' + esc(d.q || '') + '" oninput="mealSearchInput(this.value)">' +
    '</div>' +
    (d.pick ? itemEditorHtml() : mealPickResultsHtml(d)) +
    copyRow + itemsCard + totals +
    '<div class="composer-actions">' +
    '<button class="chip" onclick="cancelNutriForm()">Cancel</button>' +
    '<button class="btn btn-primary btn-sm" onclick="saveMealDraft()">Save meal</button>' +
    '</div></div>';
}

function renderNutriMeals(){
  const box = $('nutriMeals');
  if (!box) return;
  const n = nutriDB();
  const meals = n.meals.filter(m => m.date === todayISO());
  if (mealsNeedFoods(meals)) ensureFoodsDb('nutri-meals');
  const hint = $('nutriMealsHint');
  if (hint) hint.textContent = meals.length
    ? meals.length + ' meal' + (meals.length !== 1 ? 's' : '') + ' today'
    : 'What you ate today';

  const open = nutriForm === 'meal' && !!nutriDraft;
  let html = open ? mealBuilderHtml() : '';
  if (!meals.length && !open){
    html += '<div class="empty">Nothing logged yet — tap <b>+ Meal</b> to add what you ate.</div>';
  }
  if (meals.length){
    html += '<div class="meal-stack">' + meals.map(m => nutriMealCard(m, true)).join('') + '</div>';
  }
  box.innerHTML = html;
  if (open){
    if (nutriDraft.focus === 'search'){
      const el = $('mealFoodSearch');
      if (el){
        el.focus();
        try { el.setSelectionRange(el.value.length, el.value.length); } catch (e){}
      }
      nutriDraft.focus = null;
    }
    if (nutriDraft.pick) updateItemPreview();
  }
}

function addMeal(){
  nutriForm = 'meal';
  nutriDraft = newDraft();
  showTab('nutri-meals');
}
function editMeal(id){
  const m = nutriDB().meals.find(x => x.id === id);
  if (!m) return;
  nutriForm = 'meal';
  nutriDraft = draftFromMeal(m);
  showTab('nutri-meals');
}
function editMealItem(id, idx){
  const m = nutriDB().meals.find(x => x.id === id);
  if (!m) return;
  nutriForm = 'meal';
  nutriDraft = draftFromMeal(m);
  const it = nutriDraft.items[idx];
  if (it && it.foodId && findNutriFood(it.foodId)){
    nutriDraft.pick = { foodId: it.foodId, name: nutriItemName(it),
      qty: String(+it.qty || 100), unit: it.unit || 'g', from: idx };
  }
  showTab('nutri-meals');
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
  const name = (dd.name || '').trim() || mealTypeLabel(dd.type);
  const items = dd.items.map(it => it.foodId
    ? { foodId: it.foodId, qty: +it.qty || 0, unit: it.unit || 'g', name: it.name }
    : Object.assign({}, it));
  let m = dd.id ? n.meals.find(x => x.id === dd.id) : null;
  if (m){ m.name = name; m.type = dd.type; m.items = items; }
  else {
    m = { id: uid(), date: todayISO(), type: dd.type, name: name, items: items };
    n.meals.push(m);
  }
  touchNutriRecent(items.filter(i => i.foodId).map(i => i.foodId));
  nutriForm = null;
  nutriDraft = null;
  save();
  renderNutriMeals();
  toast('Meal saved');
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
    const f = it.foodId ? findNutriFood(it.foodId) : null;
    return f ? { food: f, qty: +it.qty || 0, unit: it.unit || 'g' } : null;
  }).filter(Boolean);
  if (!items.length){ toast('Add foods first — recipes need food items'); return; }
  let food = null;
  try { food = recipeToFood({ id: uid(), name: m.name, items: items, cookedWeightG: 0 }); }
  catch (e){ food = null; }
  if (!food || !(food.kcal >= 0) || !isFinite(food.kcal)){ toast('Could not save this recipe'); return; }
  n.foods.push(food);
  save();
  renderNutriMeals();
  toast('"' + m.name + '" saved to Foods');
}

/* ---- Foods : recherche (perso + base 690), favoris, recents, per 100 g ---- */
function foodFormHtml(){
  return '<div class="card nutri-form food-form">' +
    '<div class="section-hint" style="margin-bottom:8px">Per 100 g — stored as typed.</div>' +
    '<label class="label" for="foodName">Name</label>' +
    '<input class="input" id="foodName" placeholder="Food name" maxlength="60">' +
    '<div class="food-macros">' +
    '<div><label class="label" for="foodKcal">kcal</label>' +
    '<input class="input" id="foodKcal" type="number" inputmode="numeric" min="0" placeholder="0"></div>' +
    '<div><label class="label" for="foodP">Protein (g)</label>' +
    '<input class="input" id="foodP" type="number" inputmode="numeric" min="0" placeholder="0"></div>' +
    '<div><label class="label" for="foodC">Carbs (g)</label>' +
    '<input class="input" id="foodC" type="number" inputmode="numeric" min="0" placeholder="0"></div>' +
    '<div><label class="label" for="foodF">Fat (g)</label>' +
    '<input class="input" id="foodF" type="number" inputmode="numeric" min="0" placeholder="0"></div>' +
    '</div>' +
    '<div class="composer-actions">' +
    '<button class="chip" onclick="cancelNutriForm()">Cancel</button>' +
    '<button class="btn btn-primary btn-sm" onclick="submitFood()">Add</button>' +
    '</div></div>';
}

function foodRowHtml(f, custom){
  const n = nutriDB();
  const fav = (n.favs || []).indexOf(f.id) >= 0;
  const kcal = Math.round(+f.kcal || 0);
  const meta = Math.round(+f.protein || +f.p || 0) + 'P / ' +
    Math.round(+f.carbs || +f.c || 0) + 'C / ' +
    Math.round(+f.fat || +f.f || 0) + 'F' +
    (custom ? ' · yours' : (f.state ? ' · ' + esc(f.state) : ''));
  return '<div class="food-item">' +
    '<span class="fi-main"><span class="fn">' + esc(f.name) + '</span>' +
    '<span class="fm">' + meta + '</span></span>' +
    '<span class="fi-kcal"><b>' + kcal + '</b><i>/100g</i></span>' +
    '<span class="fi-acts">' +
    '<button class="chip" onclick="toggleNutriFav(' + esc(JSON.stringify(f.id)) + ')"' +
    ' aria-label="Favorite" aria-pressed="' + (fav ? 'true' : 'false') + '">' + (fav ? '★' : '☆') + '</button>' +
    '<button class="chip" onclick="logFood(' + esc(JSON.stringify(f.id)) + ')">Log</button>' +
    (custom
      ? '<button class="icon-btn" onclick="removeFood(' + esc(JSON.stringify(f.id)) + ')" aria-label="Delete food">🗑</button>'
      : '') +
    '</span></div>';
}

function renderNutriFoods(){
  const box = $('nutriFoods');
  if (!box) return;
  const n = nutriDB();
  const q = (($('nutriFoodSearch') && $('nutriFoodSearch').value) || '').trim();
  let html = nutriForm === 'food' ? foodFormHtml() : '';

  if (q){
    /* base lazy : on affiche le perso tout de suite, la base apres fetch */
    if (!foodsDbReady()) ensureFoodsDb('nutri-foods');
    const cq = norm(q);
    const custom = n.foods.filter(f => norm(f.name).indexOf(cq) >= 0).slice(0, 10);
    const db = foodsDbReady() ? searchFoods(q, 20) : [];
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
  } else {
    const asRow = id => { const f = findNutriFood(id); return f ? { f: f, custom: n.foods.some(x => x.id === id) } : null; };
    const favs = (n.favs || []).map(asRow).filter(Boolean);
    const recents = (n.recents || []).slice(0, 10).map(asRow)
      .filter(x => x && !favs.some(v => v.f.id === x.f.id));
    const mine = n.foods.slice(-30).reverse().map(f => ({ f: f, custom: true }));
    /* en-tete de section + compteur ; .section-hint reste adjacent a .food-list */
    const fxSec = (label, list) => '<div class="section-hint fx-head">' + label +
      '<span class="fx-n">' + list.length + '</span></div>' +
      '<div class="food-list">' + list.map(x => foodRowHtml(x.f, x.custom)).join('') + '</div>';
    if (favs.length) html += fxSec('Favorites', favs);
    if (recents.length) html += fxSec('Recent', recents);
    if (mine.length) html += fxSec('Your foods', mine);
    else if (!favs.length && !recents.length){
      html += '<div class="empty">Your food list is empty — tap <b>+ Food</b> to add staples (per 100 g), or type to search the full database.</div>';
    }
    html += '<div class="section-hint" style="margin-top:10px">' +
      'Type above to search 690+ foods (accents optional).</div>';
  }
  box.innerHTML = html;
}

function addFood(){
  nutriForm = 'food';
  showTab('nutri-foods');
}

function submitFood(){
  const name = ($('foodName') && $('foodName').value.trim()) || '';
  if (!name){ toast('Give the food a name.'); return; }
  const n = nutriDB();
  const f = {
    id: uid(), name: name,
    kcal: +($('foodKcal') && $('foodKcal').value) || 0,
    protein: +($('foodP') && $('foodP').value) || 0,
    carbs: +($('foodC') && $('foodC').value) || 0,
    fat: +($('foodF') && $('foodF').value) || 0
  };
  const chk = atwaterCheck(f);
  n.foods.push(f);
  nutriForm = null;
  save();
  renderNutriFoods();
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
  const f = findNutriFood(id);
  if (!f) return;
  const unit = defaultUnit(f);
  const qty = defaultQty(unit);
  let snack = n.meals.find(m => m.date === todayISO() && (m.type === 'snack' || m.name === 'Snacks'));
  if (!snack){
    snack = { id: uid(), date: todayISO(), type: 'snack', name: 'Snacks', items: [] };
    n.meals.push(snack);
  }
  snack.items.push({ foodId: f.id, qty: qty, unit: unit, name: f.name });
  touchNutriRecent([f.id]);
  save();
  renderNutriFoods();
  toast(f.name + ' logged');
}

/* ---- Week : 7 derniers jours vs objectif + tendance poids ---- */
function renderNutriWeek(){
  const box = $('nutriWeek');
  if (!box) return;
  const n = nutriDB();
  const goal = nutriActiveGoal(true);
  const goalK = goal && goal.kcal > 0 ? goal.kcal : 0;
  const days = [];
  for (let i = 6; i >= 0; i--){
    const date = nutriDateMinus(i);
    const meals = n.meals.filter(m => m.date === date);
    let kcal = 0;
    meals.forEach(m => { kcal += nutriMealTotal(m).n.kcal; });
    days.push({ date: date, kcal: Math.round(kcal) });
  }
  const wk = weekSummary(days, goalK);

  if (!wk.loggedDays){
    box.innerHTML = '<div class="empty">Nothing logged this week yet — your week appears here after your first meal.</div>';
    return;
  }

  let html = '<div class="card"><div class="section-hint">Last 7 days</div>';
  days.forEach(d => {
    const p = goalK ? progress(d.kcal, goalK) : { pct: 0 };
    const cls = p.status === 'ok' ? 'ok' : p.status === 'over' ? 'over' : '';
    const dt = new Date(d.date + 'T12:00:00');
    const wd = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dt.getDay()];
    html += '<div class="week-row">' +
      '<span class="week-day">' + wd + ' ' + d.date.slice(8) + '/' + d.date.slice(5, 7) + '</span>' +
      '<span class="pbar ' + cls + '" role="progressbar" aria-valuemin="0"' +
      ' aria-valuemax="' + (goalK || 100) + '" aria-valuenow="' + d.kcal + '"' +
      ' aria-label="kcal ' + d.date + '"><i style="width:' + Math.min(100, +p.pct || 0) + '%"></i></span>' +
      '<span class="week-kcal">' + (d.kcal ? d.kcal + ' kcal' : '—') + '</span>' +
      '</div>';
  });
  html += '</div>';

  html += '<div class="card"><div class="week-stats">' +
    '<div class="week-stat"><b>' + wk.loggedDays + '</b><span>days logged</span></div>' +
    '<div class="week-stat"><b>' + wk.avgKcal + '</b><span>avg kcal</span></div>' +
    (goalK
      ? '<div class="week-stat"><b>' + wk.daysOnTarget + '/7</b><span>days on target (±10%)</span></div>'
      : '<div class="week-stat"><b>—</b><span>set a goal in Goal</span></div>') +
    '</div>';
  if (goalK && wk.loggedDays){
    html += '<div class="section-hint" style="margin-top:8px">Avg vs goal: ' +
      (wk.avgDeltaKcal >= 0 ? '+' : '') + wk.avgDeltaKcal + ' kcal</div>';
  }
  /* tendance poids sur la fenêtre affichée */
  const wlog = ((window.DB && Array.isArray(DB.weightLog)) ? DB.weightLog : [])
    .filter(e => e && +e.kg > 0 && String(e.date) >= days[0].date && String(e.date) <= days[6].date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (wlog.length >= 2){
    const dlt = Math.round((+wlog[wlog.length - 1].kg - +wlog[0].kg) * 10) / 10;
    html += '<div class="section-hint" style="margin-top:8px">Weight: ' +
      (+wlog[0].kg).toFixed(1) + ' → ' + (+wlog[wlog.length - 1].kg).toFixed(1) +
      ' kg (' + (dlt >= 0 ? '+' : '') + dlt + ' kg)</div>';
  }
  html += '</div>';

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

function renderNutriGoal(){
  const box = $('nutriGoal');
  if (!box) return;
  const p = nutriProfile();
  const plan = nutriPlan();
  const goal = nutriActiveGoal(true);
  const w = nutriWeight();
  const row = (label, val) => '<div class="nutri-plan-row"><span>' + label + '</span><b>' + val + '</b></div>';

  let html = '<div class="card nutri-form">' +
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
  renderNutrition(currentTab);
}

Object.assign(window, {
  renderNutrition, nutriDB, nutriTotalsOf,
  /* meals : liste + builder foodId/qty */
  addMeal, editMeal, editMealItem, removeMeal, removeMealItem,
  saveMealDraft, cancelNutriForm, copyYestMeal, saveMealAsRecipe,
  mealNameInput, mealTypeChange, mealSearchInput, pickMealFood,
  itemQtyInput, itemUnitChange, addDraftItem, editDraftItem, removeDraftItem,
  /* foods : per 100 g + recherche + log */
  addFood, submitFood, removeFood, logFood, toggleNutriFav,
  /* J2 : profil / plan */
  nutriProfile, nutriWeight, nutriPlan, nutriActiveGoal, nutriAdaptive,
  saveNutriProfile, applyAdaptive, saveNutriGoal,
  /* M2 : objectif custom */
  nutriCustomGoal, setCalcMode, setKcalSource, setMacroMode, setCustomPreset, customFieldChange,
  MACRO_PRESETS, targetsFromPercent, targetsFromPerKg
});
