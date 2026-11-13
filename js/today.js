/* ==================================================================
   TODAY — résumé local Gym + Nutrition, disponible sans réseau.
   Les valeurs sont lues dans les structures existantes; aucune donnée
   d'entraînement ou d'alimentation n'est dupliquée dans cet écran.
   ================================================================== */
import { waterGoalMl } from './nutrition.js';

function uiLocale(){ return document.documentElement.lang === 'fr' ? 'fr-FR' : 'en-US'; }
function localDateLabel(iso){
  const date = new Date(iso + 'T12:00:00');
  return new Intl.DateTimeFormat(uiLocale(), { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
}

function renderToday(){
  if (!window.DB || !window.currentUser) return;
  const name = document.getElementById('todayName');
  const date = document.getElementById('todayDate');
  const nutrition = document.getElementById('todayNutritionSummary');
  const waterSummary = document.getElementById('todayWaterSummary');
  const iso = typeof window.todayISO === 'function' ? window.todayISO() : new Date().toISOString().slice(0, 10);
  const db = window.DB;
  const nutri = db.nutri || {};
  const meals = Array.isArray(nutri.meals) ? nutri.meals.filter(m => m && m.date === iso) : [];
  const totals = typeof window.nutriTotalsOf === 'function'
    ? window.nutriTotalsOf(iso)
    : { kcal: 0, p: 0, c: 0, f: 0 };
  const goal = typeof window.nutriActiveGoal === 'function'
    ? window.nutriActiveGoal(false)
    : (nutri.goal || {});
  const loggedKcal = Math.max(0, Math.round(+totals.kcal || 0));
  const targetKcal = Math.max(0, Math.round(+goal.kcal || 0));
  const progress = targetKcal ? Math.min(100, Math.round(loggedKcal / targetKcal * 100)) : 0;
  const water = nutri.water && +nutri.water[iso] || 0;
  const profile = nutri.profile || {};
  const weight = typeof window.nutriWeight === 'function' ? window.nutriWeight() : 0;
  const waterGoal = +profile.waterGoalMl > 0 ? +profile.waterGoalMl : waterGoalMl({ weightKg: weight });
  const records = Array.isArray(db.history) ? db.history.filter(h => h && h.date === iso) : [];

  if (name) name.textContent = window.currentUser;
  if (date) date.textContent = localDateLabel(iso).toUpperCase();

  if (nutrition){
    nutrition.innerHTML = '<div class="today-kcal-row">' +
      '<div><strong>' + loggedKcal.toLocaleString(uiLocale()) + '</strong><span>kcal logged</span></div>' +
      '<div class="today-kcal-target">' + (targetKcal ? (uiLocale() === 'fr-FR' ? 'sur ' : 'of ') + targetKcal.toLocaleString(uiLocale()) + ' kcal' : 'Set a daily target') + '</div>' +
      '</div>' +
      '<div class="today-progress" role="progressbar" aria-label="' + (uiLocale() === 'fr-FR' ? 'Calories consommées aujourd’hui' : 'Calories logged today') + '" aria-valuemin="0" aria-valuemax="' + (targetKcal || 1) + '" aria-valuenow="' + loggedKcal + '"><span style="width:' + progress + '%"></span></div>' +
      '<div class="today-macros">' +
        '<div><span>Protein</span><strong>' + Math.round(+totals.p || 0) + '<small> g</small></strong></div>' +
        '<div><span>Carbs</span><strong>' + Math.round(+totals.c || 0) + '<small> g</small></strong></div>' +
        '<div><span>Fat</span><strong>' + Math.round(+totals.f || 0) + '<small> g</small></strong></div>' +
        '<div><span>Meals</span><strong>' + meals.length + '</strong></div>' +
      '</div>';
  }

  if (waterSummary){
    const percent = waterGoal ? Math.min(100, Math.round(water / waterGoal * 100)) : 0;
    waterSummary.innerHTML = '<div class="today-water-value"><strong>' + Math.round(water).toLocaleString(uiLocale()) + '</strong><span> / ' + Math.round(waterGoal).toLocaleString(uiLocale()) + ' ml</span></div>' +
      '<div class="today-progress water-progress" role="progressbar" aria-label="' + (uiLocale() === 'fr-FR' ? 'Eau bue aujourd’hui' : 'Water logged today') + '" aria-valuemin="0" aria-valuemax="' + Math.round(waterGoal) + '" aria-valuenow="' + Math.round(water) + '"><span style="width:' + percent + '%"></span></div>';
  }

  const count = document.getElementById('todaySessionCount');
  if (count){
    const fr = uiLocale() === 'fr-FR';
    count.textContent = db.active ? (fr ? 'Séance en cours' : 'Workout in progress')
      : records.length ? (fr ? records.length + (records.length > 1 ? ' séances terminées aujourd’hui' : ' séance terminée aujourd’hui')
        : records.length + ' workout' + (records.length === 1 ? '' : 's') + ' completed today')
        : (fr ? 'Prêt quand tu veux' : 'Ready when you are');
  }
  if (typeof window.renderTodayBodyMap === 'function') window.renderTodayBodyMap();
}

Object.assign(window, { renderToday });
