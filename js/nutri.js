/* ==================================================================
   NUTRITION (chantier F + J2) — Today / Meals / Foods / Goal
   Données locales dans DB.nutri : { profile, goal, foods, meals }
   Rien de réseau : 100 % offline-first, comme le reste du Gym.
   J2 : profil -> buildPlan (nutrition.js) -> objectif auto,
   garde-fous floor/rate, recalcul à chaque lecture du poids.
   ================================================================== */
import { buildPlan, macroTargets, projectWeight, adaptiveAdjustment } from './nutrition.js';

function nutriDB(){
  if (!window.DB) return null;
  if (!DB.nutri || typeof DB.nutri !== 'object') DB.nutri = {};
  const n = DB.nutri;
  if (!n.goal || typeof n.goal !== 'object') n.goal = { kcal: 0, p: 0, c: 0, f: 0 };
  if (!Array.isArray(n.foods)) n.foods = [];
  if (!Array.isArray(n.meals)) n.meals = [];
  n.meals.forEach(m => { if (!Array.isArray(m.items)) m.items = []; });
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

/* Objectif actif : plan du profil (recalculé à chaque lecture -> suit le poids)
   sinon objectif manuel saisi dans le formulaire Goal.
   sync=true : réécrit DB.nutri.goal si le plan a bougé (persistance/export). */
function nutriActiveGoal(sync){
  const n = nutriDB();
  if (!n) return { kcal: 0, p: 0, c: 0, f: 0 };
  const plan = nutriPlan();
  if (!plan) return n.goal;
  const p = nutriProfile();
  const floor = Math.max(plan.bmr, p.sex === 'female' ? 1200 : 1500);
  const kcal = Math.max(plan.kcal + p.kcalOffset, floor);
  const m = macroTargets({ kcal: kcal, weightKg: nutriWeight(), goal: p.goal });
  const g = { kcal: kcal, p: m.protein, c: m.carbs, f: m.fat };
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
}

/* ---- Today : totaux du jour vs objectif ---- */
function nutriTotalsOf(dateISO){
  const n = nutriDB();
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  if (!n) return t;
  n.meals.filter(m => m.date === dateISO).forEach(m => (m.items || []).forEach(it => {
    t.kcal += +it.kcal || 0; t.p += +it.p || 0; t.c += +it.c || 0; t.f += +it.f || 0;
  }));
  return t;
}

function nutriBar(label, val, goal, unit){
  const pct = goal > 0 ? Math.min(100, Math.round(val / goal * 100)) : 0;
  return '<div class="nutri-bar">' +
    '<div class="nutri-bar-top"><span>' + esc(label) + '</span>' +
    '<span class="nutri-bar-num">' + Math.round(val) + ' / ' + Math.round(goal) + ' ' + unit + '</span></div>' +
    '<div class="nutri-bar-track"><div class="nutri-bar-fill" style="width:' + pct + '%"></div></div>' +
    '</div>';
}

function renderNutriToday(){
  const box = $('nutriToday');
  if (!box) return;
  const n = nutriDB();
  const t = nutriTotalsOf(todayISO());
  const g = nutriActiveGoal(true);   /* plan du profil recalcule depuis le poids */
  const hasGoal = (+g.kcal || +g.p || +g.c || +g.f) > 0;

  let html = '<div class="card nutri-kcal">' +
    '<div class="nutri-kcal-num">' + Math.round(t.kcal) + '</div>' +
    '<div class="nutri-kcal-sub">kcal today · goal ' + Math.round(g.kcal || 0) + '</div>' +
    '</div>';

  if (hasGoal){
    html += nutriBar('Protein', t.p, g.p, 'g');
    html += nutriBar('Carbs', t.c, g.c, 'g');
    html += nutriBar('Fat', t.f, g.f, 'g');
  } else {
    html += '<div class="empty">No goal set yet — open the <b>Goal</b> tab to set daily targets.</div>';
  }

  const meals = n.meals.filter(m => m.date === todayISO());
  html += '<div class="section-hint" style="margin-top:14px">' +
    meals.length + ' meal' + (meals.length !== 1 ? 's' : '') + ' logged today</div>';
  box.innerHTML = html;
}

/* ---- Meals ---- */
function mealFormHtml(){
  return '<div class="card nutri-form">' +
    '<input class="input" id="mealName" placeholder="Meal name (e.g. Lunch)" maxlength="60">' +
    '<div class="nutri-form-row">' +
    '<input class="input" id="mealKcal" type="number" inputmode="numeric" min="0" placeholder="kcal">' +
    '<input class="input" id="mealP" type="number" inputmode="numeric" min="0" placeholder="Protein g">' +
    '<input class="input" id="mealC" type="number" inputmode="numeric" min="0" placeholder="Carbs g">' +
    '<input class="input" id="mealF" type="number" inputmode="numeric" min="0" placeholder="Fat g">' +
    '</div>' +
    '<div class="composer-actions">' +
    '<button class="chip" onclick="cancelNutriForm()">Cancel</button>' +
    '<button class="btn btn-primary btn-sm" onclick="submitMeal()">Add</button>' +
    '</div></div>';
}

function renderNutriMeals(){
  const box = $('nutriMeals');
  if (!box) return;
  const n = nutriDB();
  const meals = n.meals.filter(m => m.date === todayISO());
  const hint = $('nutriMealsHint');
  if (hint) hint.textContent = meals.length
    ? meals.length + ' meal' + (meals.length !== 1 ? 's' : '') + ' today'
    : 'What you ate today';

  let html = nutriForm === 'meal' ? mealFormHtml() : '';
  if (!meals.length && nutriForm !== 'meal'){
    html += '<div class="empty">Nothing logged yet — tap <b>+ Meal</b> to add what you ate.</div>';
  }
  meals.forEach(m => {
    const kc = (m.items || []).reduce((s, it) => s + (+it.kcal || 0), 0);
    html += '<div class="card nutri-meal">' +
      '<div class="nutri-meal-top">' +
      '<div class="nutri-meal-name">' + esc(m.name) + '</div>' +
      '<div class="nutri-meal-kcal">' + Math.round(kc) + ' kcal</div>' +
      '<button class="icon-btn" onclick="removeMeal(' + esc(JSON.stringify(m.id)) + ')" aria-label="Delete meal">🗑</button>' +
      '</div>' +
      (m.items || []).map(it =>
        '<div class="nutri-item"><span>' + esc(it.name) + '</span>' +
        '<span class="nutri-item-macros">' + Math.round(+it.kcal || 0) + ' kcal · ' +
        Math.round(+it.p || 0) + 'P / ' + Math.round(+it.c || 0) + 'C / ' + Math.round(+it.f || 0) + 'F</span></div>'
      ).join('') +
      '</div>';
  });
  box.innerHTML = html;
}

function addMeal(){
  nutriForm = 'meal';
  showTab('nutri-meals');
}

function submitMeal(){
  const name = ($('mealName') && $('mealName').value.trim()) || 'Meal';
  const n = nutriDB();
  n.meals.push({
    id: uid(), date: todayISO(), name: name,
    items: [{ name: name, kcal: +($('mealKcal') && $('mealKcal').value) || 0,
      p: +($('mealP') && $('mealP').value) || 0,
      c: +($('mealC') && $('mealC').value) || 0,
      f: +($('mealF') && $('mealF').value) || 0 }]
  });
  nutriForm = null;
  save();
  renderNutriMeals();
  toast('Meal added');
}

function removeMeal(id){
  const n = nutriDB();
  n.meals = n.meals.filter(m => m.id !== id);
  save();
  renderNutriMeals();
}

/* ---- Foods ---- */
function foodFormHtml(){
  return '<div class="card nutri-form">' +
    '<input class="input" id="foodName" placeholder="Food name" maxlength="60">' +
    '<div class="nutri-form-row">' +
    '<input class="input" id="foodKcal" type="number" inputmode="numeric" min="0" placeholder="kcal">' +
    '<input class="input" id="foodP" type="number" inputmode="numeric" min="0" placeholder="Protein g">' +
    '<input class="input" id="foodC" type="number" inputmode="numeric" min="0" placeholder="Carbs g">' +
    '<input class="input" id="foodF" type="number" inputmode="numeric" min="0" placeholder="Fat g">' +
    '</div>' +
    '<div class="composer-actions">' +
    '<button class="chip" onclick="cancelNutriForm()">Cancel</button>' +
    '<button class="btn btn-primary btn-sm" onclick="submitFood()">Add</button>' +
    '</div></div>';
}

function renderNutriFoods(){
  const box = $('nutriFoods');
  if (!box) return;
  const n = nutriDB();
  const q = ($('nutriFoodSearch') && $('nutriFoodSearch').value.trim().toLowerCase()) || '';
  const list = n.foods.filter(f => !q || f.name.toLowerCase().indexOf(q) >= 0);

  let html = nutriForm === 'food' ? foodFormHtml() : '';
  if (!n.foods.length && nutriForm !== 'food'){
    html += '<div class="empty">Your food list is empty — tap <b>+ Food</b> to add staples (per serving).</div>';
  } else if (!list.length){
    html += '<div class="empty">No food matches “' + esc(q) + '”.</div>';
  }
  list.forEach(f => {
    html += '<div class="card nutri-food">' +
      '<div class="nutri-meal-top">' +
      '<div class="nutri-meal-name">' + esc(f.name) + '</div>' +
      '<div class="nutri-meal-kcal">' + Math.round(+f.kcal || 0) + ' kcal</div>' +
      '<button class="chip" onclick="logFood(' + esc(JSON.stringify(f.id)) + ')" aria-label="Log this food">＋ Log</button>' +
      '<button class="icon-btn" onclick="removeFood(' + esc(JSON.stringify(f.id)) + ')" aria-label="Delete food">🗑</button>' +
      '</div>' +
      '<div class="nutri-item-macros">' + Math.round(+f.p || 0) + 'P / ' + Math.round(+f.c || 0) + 'C / ' +
      Math.round(+f.f || 0) + 'F</div>' +
      '</div>';
  });
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
  n.foods.push({
    id: uid(), name: name,
    kcal: +($('foodKcal') && $('foodKcal').value) || 0,
    p: +($('foodP') && $('foodP').value) || 0,
    c: +($('foodC') && $('foodC').value) || 0,
    f: +($('foodF') && $('foodF').value) || 0
  });
  nutriForm = null;
  save();
  renderNutriFoods();
  toast('Food added');
}

function removeFood(id){
  const n = nutriDB();
  n.foods = n.foods.filter(f => f.id !== id);
  save();
  renderNutriFoods();
}

/* ＋ Log : pousse l'aliment dans le repas du jour « Snacks » (créé si besoin) */
function logFood(id){
  const n = nutriDB();
  const f = n.foods.find(x => x.id === id);
  if (!f) return;
  let snack = n.meals.find(m => m.date === todayISO() && m.name === 'Snacks');
  if (!snack){ snack = { id: uid(), date: todayISO(), name: 'Snacks', items: [] }; n.meals.push(snack); }
  snack.items.push({ name: f.name, kcal: +f.kcal || 0, p: +f.p || 0, c: +f.c || 0, f: +f.f || 0 });
  save();
  renderNutriFoods();
  toast(f.name + ' logged');
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

  /* objectif manuel (avancé) : conservé tel quel */
  const g = nutriDB().goal;
  html += '<div class="card nutri-form" style="margin-top:12px">' +
    '<div class="section-hint" style="margin-bottom:8px">Manual target (advanced) — used only until a plan is calculated.</div>' +
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
  renderNutrition(currentTab);
}

Object.assign(window, {
  renderNutrition, nutriDB, nutriTotalsOf,
  addMeal, submitMeal, removeMeal,
  addFood, submitFood, removeFood, logFood,
  saveNutriGoal, cancelNutriForm,
  /* J2 : profil / plan */
  nutriProfile, nutriWeight, nutriPlan, nutriActiveGoal, nutriAdaptive,
  saveNutriProfile, applyAdaptive
});
