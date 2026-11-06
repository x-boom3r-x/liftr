// node --test tests/modules.test.mjs   (Node 18+, aucune dépendance)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as N from '../js/nutrition.js';
import * as I from '../js/insights.js';

/* ---------------- nutrition ---------------- */
test('Mifflin-St Jeor : valeurs calculées à la main', () => {
  assert.equal(N.bmrMifflin({ sex: 'male', weightKg: 80, heightCm: 180, age: 30 }), 1780);          // 800+1125-150+5
  assert.equal(N.bmrMifflin({ sex: 'female', weightKg: 60, heightCm: 165, age: 25 }), 1345.25);     // 600+1031.25-125-161
  assert.throws(() => N.bmrMifflin({ sex: 'male', weightKg: 0, heightCm: 180, age: 30 }), RangeError);
});
test('TDEE', () => {
  assert.equal(Math.round(N.tdee(1780, 'moderate')), 2759);
  assert.throws(() => N.tdee(1780, 'inconnu'), RangeError);
});
test('objectif : déficit 0,5 kg/sem ~ -550 kcal, plafonné à 1 %/sem, plancher respecté', () => {
  const plan = N.buildPlan({ sex: 'male', weightKg: 80, heightCm: 180, age: 30, activity: 'moderate', goal: 'lose', rateKgPerWeek: 0.5 });
  assert.equal(plan.tdee, 2759);
  assert.equal(plan.kcal, Math.round(2759 - 0.5 * 7700 / 7));            // 2209
  const fast = N.buildPlan({ sex: 'female', weightKg: 50, heightCm: 160, age: 30, activity: 'sedentary', goal: 'lose', rateKgPerWeek: 1.5 });
  assert.ok(fast.notes.includes('rate_capped'));
  assert.ok(fast.kcal >= 1200 && fast.kcal >= fast.bmr, 'jamais sous le plancher ni sous le BMR');
});
test('macros : protéines g/kg, lipides >= 0,6 g/kg, glucides = reste, somme ≈ kcal', () => {
  const m = N.macroTargets({ kcal: 2200, weightKg: 80, goal: 'lose' });
  assert.equal(m.protein, 176);
  assert.ok(m.fat >= 48);
  const kcal = 4 * m.protein + 4 * m.carbs + 9 * m.fat;
  assert.ok(Math.abs(kcal - 2200) <= 12, 'macros -> kcal : ' + kcal);
});
test('ingrédients : g, ml, pièce, cuillère ; erreur explicite si poids inconnu', () => {
  const riz = { name: 'Riz cuit', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 };
  const oeuf = { name: 'Oeuf', kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5, gramsPerUnit: { piece: 60 } };
  assert.equal(N.nutrientsFor(riz, 200).kcal, 260);
  assert.equal(N.nutrientsFor(oeuf, 2, 'piece').kcal, 143 * 1.2);       // 120 g
  assert.equal(N.toGrams({ name: 'Lait', density: 1.03 }, 100, 'ml'), 103);
  assert.equal(N.toGrams(riz, 2, 'tbsp'), 30);
  assert.throws(() => N.toGrams(riz, 1, 'piece'), /poids d'une unité/);
});
test('repas multi-ingrédients + journée + recette -> aliment /100 g', () => {
  const riz = { name: 'Riz', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 };
  const poulet = { name: 'Poulet', kcal: 165, protein: 31, carbs: 0, fat: 3.6 };
  const meal = { name: 'Déjeuner', items: [{ food: riz, qty: 200 }, { food: poulet, qty: 150 }] };
  const { total } = N.mealTotals(meal);
  assert.equal(Math.round(total.kcal), 260 + 248);                      // 507.5 -> 508
  assert.equal(N.dayTotals([meal, meal]).protein, 2 * (5.4 + 46.5));
  const f = N.recipeToFood({ id: 'r1', name: 'Poulet-riz', items: meal.items });
  assert.equal(Math.round(f.kcal), Math.round(507.5 / 350 * 100));
});
test('progression : sous / dans la cible / dépassement ; barre bornée à 100', () => {
  assert.deepEqual(N.progress(1000, 2000), { ratio: 0.5, pct: 50, remaining: 1000, overBy: 0, status: 'under' });
  assert.equal(N.progress(1900, 2000).status, 'ok');
  const o = N.progress(2300, 2000); assert.equal(o.status, 'over'); assert.equal(o.pct, 100); assert.equal(o.overBy, 300);
  assert.equal(N.progress(500, 0).pct, 0);
});
test('contrôle Atwater (détecte une ligne Excel incohérente)', () => {
  assert.ok(N.atwaterCheck({ kcal: 165, protein: 31, carbs: 0, fat: 3.6 }).ok);
  assert.ok(!N.atwaterCheck({ kcal: 900, protein: 31, carbs: 0, fat: 3.6 }).ok);
});
test('ajustement adaptatif : plafonné ±150, rien avant 14 jours', () => {
  assert.equal(N.adaptiveAdjustment({ goal: 'lose', expectedKgPerWeek: 0.5, observedKgPerWeek: -0.5, days: 20 }).deltaKcal, 0);
  assert.equal(N.adaptiveAdjustment({ goal: 'lose', expectedKgPerWeek: 0.5, observedKgPerWeek: 0, days: 5 }).reason, 'not_enough_data');
  const d = N.adaptiveAdjustment({ goal: 'lose', expectedKgPerWeek: 0.5, observedKgPerWeek: 0.2, days: 21 }).deltaKcal;
  assert.ok(d < 0 && d >= -150, 'trop lent -> baisse limitée : ' + d);
});

/* ---------------- insights ---------------- */
const S = (date, name, muscle, sets) => ({ date, exercises: [{ name, muscle, sets }] });
test('1RM Epley', () => {
  assert.equal(I.e1rm(100, 1), 100);
  assert.equal(Math.round(I.e1rm(100, 5) * 10) / 10, 116.7);
  assert.equal(I.e1rm(100, 30), I.e1rm(100, 12), 'plafonné à 12 reps');
});
test('semaines ISO : lundi', () => {
  assert.equal(I.weekStart('2026-10-09'), '2026-10-05');       // vendredi -> lundi
  assert.equal(I.weekStart('2026-10-11'), '2026-10-05');       // dimanche
});
test('plateau : 4 séances sans progrès', () => {
  const s = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22'].map(d => S(d, 'Squat', 'Jambes', [{ kg: 100, reps: 5 }]));
  assert.equal(I.detectPlateau(I.exerciseHistory(s, 'Squat')).plateau, true);
  const g = ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22'].map((d, i) => S(d, 'Squat', 'Jambes', [{ kg: 100 + 5 * i, reps: 5 }]));
  assert.equal(I.detectPlateau(I.exerciseHistory(g, 'Squat')).plateau, false);
});
test('double progression', () => {
  assert.deepEqual(I.nextTarget([{ kg: 60, reps: 10 }, { kg: 60, reps: 10 }]), { kg: 62.5, reps: 6, why: 'top_of_range' });
  assert.deepEqual(I.nextTarget([{ kg: 60, reps: 8 }, { kg: 60, reps: 7 }]), { kg: 60, reps: 8, why: 'add_rep' });
  assert.equal(I.nextTarget([{ kg: 100, reps: 10 }], { lower: true }).kg, 105);
});
test('tendance du poids : EMA lisse un pic, pente/semaine correcte', () => {
  const w = Array.from({ length: 28 }, (_, i) => ({ date: I.addDays('2026-09-01', i), kg: 80 - i * (0.5 / 7) + (i === 14 ? 2 : 0) }));
  const t = I.weightTrend(w);
  assert.ok(t.kgPerWeek < -0.3 && t.kgPerWeek > -0.7, 'pente ≈ -0,5 : ' + t.kgPerWeek);
});
test('volume par muscle et classes', () => {
  const s = [S('2026-10-05', 'Bench', 'Pectoraux', Array(12).fill({ kg: 60, reps: 8 })), S('2026-10-07', 'Curl', 'Biceps', Array(3).fill({ kg: 15, reps: 10 }))];
  assert.deepEqual(I.weeklySetsByMuscle(s, '2026-10-09'), { Pectoraux: 12, Biceps: 3 });
  assert.equal(I.classifySets(12), 'productive'); assert.equal(I.classifySets(3), 'low'); assert.equal(I.classifySets(25), 'high');
});
test('ACWR : semaine 2x la moyenne => zone high/danger', () => {
  const calm = [0, 1, 2, 3].map(i => S(I.addDays('2026-09-14', i * 7), 'Squat', 'Jambes', [{ kg: 100, reps: 10 }]));
  const spike = [...calm, S('2026-10-06', 'Squat', 'Jambes', Array(4).fill({ kg: 100, reps: 10 }))];
  const a = I.acwr(spike, '2026-10-09');
  assert.ok(['high', 'danger'].includes(a.zone), JSON.stringify(a));
  assert.equal(I.acwr([], '2026-10-09').zone, 'unknown');
});
test('insights : PR, plateau, volume faible triés par sévérité', () => {
  const sessions = [
    ...['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22'].map(d => S(d, 'Squat', 'Jambes', [{ kg: 100, reps: 5 }])),
    S('2026-10-05', 'Bench', 'Pectoraux', [{ kg: 80, reps: 5 }]),
    S('2026-10-07', 'Bench', 'Pectoraux', [{ kg: 85, reps: 5 }]),
  ];
  const out = I.buildInsights({ sessions, today: '2026-10-09' });
  assert.ok(out.some(i => i.id === 'plateau:Squat' && i.action.includes('100 kg × 6')));   // plateau + cible concrète (ajoute 1 rep)
  assert.ok(out.some(i => i.id === 'pr:Bench'));
  assert.ok(out.some(i => i.id === 'vol-low:Pectoraux'));
  assert.equal(out[0].severity, 'warn');
});
test('régularité : série de semaines et adhérence', () => {
  const s = [0, 1, 2, 3].map(i => S(I.addDays('2026-09-14', i * 7), 'Squat', 'Jambes', [{ kg: 100, reps: 5 }]));
  const c = I.consistency(s, '2026-10-09', 3);
  assert.equal(c.streakWeeks, 4); assert.equal(c.done, 4); assert.equal(c.planned, 12);
});
