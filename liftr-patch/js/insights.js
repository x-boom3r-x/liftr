/* ==================================================================
   insights.js — transforme l'historique brut en CONSEILS actionnables.
   Calculs purs, sans DOM : testables.

   Entrée normalisée (écrire un adaptateur depuis le format Liftr réel) :
     session = { date:'YYYY-MM-DD', exercises:[ { name, muscle, sets:[ { kg, reps } ] } ] }
     weights = [ { date:'YYYY-MM-DD', kg } ]
   Les séries "assistées" (ass) / cardio sont à exclure ou à convertir par l'adaptateur.

   Tous les seuils sont des HEURISTIQUES de coaching (pas des vérités médicales) :
   ils sont regroupés dans THRESHOLDS pour être ajustés en un seul endroit.
   ================================================================== */

export const THRESHOLDS = {
  plateauSessions: 4,         // nb de séances comparées pour un plateau
  plateauEps: 0.01,           // < 1 % d'évolution du 1RM estimé = stagnation
  setsLow: 6, setsMin: 10, setsHigh: 20,   // séries dures / semaine / muscle
  acwrLow: 0.8, acwrHigh: 1.3, acwrDanger: 1.5,
  deloadAfterWeeks: 6,
};

export const dayMs = 86400000;
export const toDate = s => new Date(s + 'T12:00:00Z');
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / dayMs);
export const addDays = (s, n) => new Date(toDate(s).getTime() + n * dayMs).toISOString().slice(0, 10);
const round = (v, d = 1) => { const k = 10 ** d; return Math.round(v * k) / k; };

/** Semaine ISO (lundi) d'une date -> 'YYYY-MM-DD' du lundi. */
export function weekStart(s) {
  const d = toDate(s); const wd = (d.getUTCDay() + 6) % 7;
  return addDays(s, -wd);
}

/* ---------- 1. force estimée ---------- */

/** Epley, fiable jusqu'à ~10-12 reps ; au-delà on plafonne pour ne pas gonfler le 1RM. */
export function e1rm(kg, reps) {
  if (!(kg > 0) || !(reps > 0)) return 0;
  const r = Math.min(reps, 12);
  return r === 1 ? kg : kg * (1 + r / 30);
}
export const bestE1rm = sets => sets.reduce((m, s) => Math.max(m, e1rm(s.kg, s.reps)), 0);

/** Historique par exercice : [{date, e1rm, topKg, topReps, volume, sets}] trié par date. */
export function exerciseHistory(sessions, name) {
  const out = [];
  for (const s of sessions) for (const ex of s.exercises) {
    if (ex.name !== name) continue;
    const sets = ex.sets.filter(x => x.kg > 0 && x.reps > 0);
    if (!sets.length) continue;
    const top = sets.reduce((a, b) => (e1rm(b.kg, b.reps) > e1rm(a.kg, a.reps) ? b : a));
    out.push({
      date: s.date, e1rm: bestE1rm(sets), topKg: top.kg, topReps: top.reps,
      volume: sets.reduce((v, x) => v + x.kg * x.reps, 0), sets: sets.length,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------- 2. tendances ---------- */

/** Pente par semaine d'une série [{date, v}] (régression linéaire, en unités / 7 jours). */
export function slopePerWeek(points) {
  if (points.length < 2) return 0;
  const t0 = toDate(points[0].date).getTime();
  const xs = points.map(p => (toDate(p.date).getTime() - t0) / (7 * dayMs));
  const ys = points.map(p => p.v);
  const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? 0 : num / den;
}

/** Moyenne mobile exponentielle (tendance du poids : efface le bruit eau/sel/repas). */
export function ema(values, alpha = 0.2) {
  const out = []; let prev = null;
  for (const v of values) { prev = prev === null ? v : alpha * v + (1 - alpha) * prev; out.push(prev); }
  return out;
}

export function weightTrend(weights, alpha = 0.2) {
  const w = [...weights].sort((a, b) => a.date.localeCompare(b.date));
  const sm = ema(w.map(x => x.kg), alpha);
  const pts = w.map((x, i) => ({ date: x.date, v: sm[i] }));
  const last28 = pts.filter(p => daysBetween(p.date, w[w.length - 1]?.date || p.date) <= 28);
  return { points: pts, current: pts.length ? round(pts[pts.length - 1].v, 1) : null, kgPerWeek: round(slopePerWeek(last28), 2) };
}

/* ---------- 3. plateau & progression ---------- */

export function detectPlateau(history, n = THRESHOLDS.plateauSessions, eps = THRESHOLDS.plateauEps) {
  if (history.length < n) return { plateau: false, sessions: history.length };
  const recent = history.slice(-n);
  const first = recent[0].e1rm, best = Math.max(...recent.map(h => h.e1rm));
  const gain = (best - first) / first;
  const improvedLast = recent[recent.length - 1].e1rm >= best - 1e-9 && recent[recent.length - 1].e1rm > first * (1 + eps);
  return { plateau: gain <= eps && !improvedLast, sessions: n, gainPct: round(gain * 100, 1) };
}

/**
 * Double progression : tant que toutes les séries n'atteignent pas le haut de la
 * fourchette, on ajoute des reps ; dès que c'est le cas, on monte la charge.
 * rep range par défaut 6-10 (force/hypertrophie). incrément : 2,5 kg (haut du corps) / 5 kg (bas).
 */
export function nextTarget(lastSets, { minReps = 6, maxReps = 10, lower = false } = {}) {
  const sets = lastSets.filter(s => s.kg > 0 && s.reps > 0);
  if (!sets.length) return null;
  const kg = Math.max(...sets.map(s => s.kg));
  const atKg = sets.filter(s => s.kg === kg);
  const allTop = atKg.every(s => s.reps >= maxReps);
  const step = lower ? 5 : 2.5;
  if (allTop) return { kg: kg + step, reps: minReps, why: 'top_of_range' };
  const minR = Math.min(...atKg.map(s => s.reps));
  return { kg, reps: Math.min(maxReps, minR + 1), why: 'add_rep' };
}

/* ---------- 4. volume par muscle & charge ---------- */

export function weeklySetsByMuscle(sessions, weekOf) {
  const wk = weekStart(weekOf), out = {};
  for (const s of sessions) {
    if (weekStart(s.date) !== wk) continue;
    for (const ex of s.exercises) {
      const n = ex.sets.filter(x => x.reps > 0 && x.kg >= 0).length;
      if (ex.muscle && n) out[ex.muscle] = (out[ex.muscle] || 0) + n;
    }
  }
  return out;
}

export function classifySets(n, t = THRESHOLDS) {
  return n < t.setsLow ? 'low' : n < t.setsMin ? 'maintain' : n <= t.setsHigh ? 'productive' : 'high';
}

export const sessionLoad = s => s.exercises.reduce((l, ex) => l + ex.sets.reduce((v, x) => v + (x.kg > 0 ? x.kg * x.reps : 0), 0), 0);

/**
 * Ratio charge aiguë (7 j) / chronique (moyenne hebdo des 28 j).
 * Indicateur de pic de charge — indicatif, pas un diagnostic.
 */
export function acwr(sessions, today) {
  const load = (from, to) => sessions.filter(s => s.date > from && s.date <= to).reduce((l, s) => l + sessionLoad(s), 0);
  const acute = load(addDays(today, -7), today);
  const chronic = load(addDays(today, -28), today) / 4;
  if (chronic <= 0) return { ratio: null, acute, chronic, zone: 'unknown' };
  const ratio = acute / chronic;
  const t = THRESHOLDS;
  return { ratio: round(ratio, 2), acute: Math.round(acute), chronic: Math.round(chronic),
    zone: ratio > t.acwrDanger ? 'danger' : ratio > t.acwrHigh ? 'high' : ratio < t.acwrLow ? 'low' : 'optimal' };
}

/* ---------- 5. régularité ---------- */

export function consistency(sessions, today, plannedPerWeek = 3, weeks = 4) {
  const from = addDays(today, -7 * weeks);
  const dates = [...new Set(sessions.filter(s => s.date > from && s.date <= today).map(s => s.date))];
  const done = dates.length, planned = plannedPerWeek * weeks;
  // série en cours : semaines consécutives (en remontant) avec ≥ 1 séance
  let streakWeeks = 0, wk = weekStart(today);
  const have = new Set(sessions.map(s => weekStart(s.date)));
  while (have.has(wk)) { streakWeeks++; wk = addDays(wk, -7); }
  if (!have.has(weekStart(today))) {  // semaine en cours encore vide : on ne casse pas la série avant dimanche
    streakWeeks = 0; wk = addDays(weekStart(today), -7);
    while (have.has(wk)) { streakWeeks++; wk = addDays(wk, -7); }
  }
  return { done, planned, adherencePct: Math.min(100, Math.round((done / planned) * 100)), streakWeeks };
}

/* ---------- 6. conseils ---------- */

/**
 * Renvoie une liste triée de { id, kind, severity:'info'|'good'|'warn', title, detail, action?, data }
 * `labels` permet de traduire/personnaliser (clés = id) ; par défaut en français.
 */
export function buildInsights({ sessions, weights = [], today, plannedPerWeek = 3, goal = null, lowerBody = [] }) {
  const out = [], T = THRESHOLDS;
  const names = [...new Set(sessions.flatMap(s => s.exercises.map(e => e.name)))];

  // a) plateaux et records par exercice
  for (const name of names) {
    const h = exerciseHistory(sessions, name);
    if (h.length < 2) continue;
    const p = detectPlateau(h);
    const last = h[h.length - 1];
    const bestBefore = Math.max(...h.slice(0, -1).map(x => x.e1rm));
    if (last.e1rm > bestBefore * 1.005 && daysBetween(last.date, today) <= 14)
      out.push({ id: 'pr:' + name, kind: 'pr', severity: 'good', title: `Record : ${name}`, detail: `1RM estimé ${round(last.e1rm)} kg (+${round(((last.e1rm - bestBefore) / bestBefore) * 100)} %)`, data: { name, e1rm: round(last.e1rm) } });
    else if (p.plateau) {
      const t = nextTarget(sessions.flatMap(s => s.exercises.filter(e => e.name === name).map(e => ({ date: s.date, sets: e.sets }))).pop().sets, { lower: lowerBody.includes(name) });
      out.push({ id: 'plateau:' + name, kind: 'plateau', severity: 'warn', title: `${name} stagne`, detail: `Pas de progrès sur les ${p.sessions} dernières séances (${p.gainPct} %).`, action: t ? `Vise ${t.kg} kg × ${t.reps}, ou ajoute une série légère après tes séries de travail.` : 'Change la plage de reps ou ajoute une série.', data: { name } });
    }
  }

  // b) volume par muscle (semaine en cours, sinon précédente)
  const sets = weeklySetsByMuscle(sessions, today);
  for (const [m, n] of Object.entries(sets)) {
    const c = classifySets(n);
    if (c === 'low') out.push({ id: 'vol-low:' + m, kind: 'volume', severity: 'info', title: `${m} : volume faible`, detail: `${n} séries cette semaine (cible ${T.setsMin}–${T.setsHigh}).`, action: `Ajoute ${T.setsMin - n} séries pour ${m} avant dimanche.`, data: { muscle: m, sets: n } });
    if (c === 'high') out.push({ id: 'vol-high:' + m, kind: 'volume', severity: 'warn', title: `${m} : volume élevé`, detail: `${n} séries cette semaine (> ${T.setsHigh}).`, action: 'Surveille la récupération ; réduis si tu stagnes ou es fatigué.', data: { muscle: m, sets: n } });
  }

  // c) charge aiguë / chronique
  const a = acwr(sessions, today);
  if (a.zone === 'high' || a.zone === 'danger')
    out.push({ id: 'acwr', kind: 'load', severity: 'warn', title: 'Pic de charge', detail: `Cette semaine = ${a.ratio}× ta moyenne des 4 dernières semaines.`, action: 'Garde une séance plus légère cette semaine pour absorber la charge.', data: a });
  if (a.zone === 'low')
    out.push({ id: 'acwr-low', kind: 'load', severity: 'info', title: 'Semaine légère', detail: `Charge à ${a.ratio}× ta moyenne récente.`, data: a });

  // d) régularité
  const c = consistency(sessions, today, plannedPerWeek);
  if (c.streakWeeks >= 3) out.push({ id: 'streak', kind: 'consistency', severity: 'good', title: `${c.streakWeeks} semaines d'affilée`, detail: `${c.done}/${c.planned} séances sur 4 semaines (${c.adherencePct} %).`, data: c });
  else if (c.adherencePct < 60) out.push({ id: 'adherence', kind: 'consistency', severity: 'info', title: 'Régularité en baisse', detail: `${c.done}/${c.planned} séances prévues ces 4 semaines.`, action: 'Réduis la fréquence cible plutôt que de sauter des semaines entières.', data: c });

  // e) poids vs objectif
  if (weights.length >= 5) {
    const w = weightTrend(weights);
    if (goal === 'lose' && w.kgPerWeek > -0.05) out.push({ id: 'wt-lose', kind: 'weight', severity: 'info', title: 'Poids stable malgré l\'objectif de perte', detail: `Tendance ${w.kgPerWeek > 0 ? '+' : ''}${w.kgPerWeek} kg/sem.`, action: 'Vérifie tes apports réels (onglet Nutrition) avant de réduire encore.', data: w });
    if (goal === 'gain' && w.kgPerWeek < 0.05) out.push({ id: 'wt-gain', kind: 'weight', severity: 'info', title: 'Pas de prise malgré l\'objectif', detail: `Tendance ${w.kgPerWeek} kg/sem.`, action: 'Ajoute ~150 kcal/jour pendant 2 semaines.', data: w });
  }

  const rank = { warn: 0, good: 1, info: 2 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity]);
}
