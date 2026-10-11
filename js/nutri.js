/* ==================================================================
   NUTRITION (chantier F) — Today / Meals / Foods / Goal
   Données locales dans DB.nutri : { goal, foods, meals }
   Rien de réseau : 100 % offline-first, comme le reste du Gym.
   ================================================================== */

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
  const g = n.goal;
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

/* ---- Goal ---- */
function renderNutriGoal(){
  const box = $('nutriGoal');
  if (!box) return;
  const g = nutriDB().goal;
  box.innerHTML = '<div class="card nutri-form">' +
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
  saveNutriGoal, cancelNutriForm
});
