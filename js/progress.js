/* ==================================================================
   LIFTR - Progression intelligente : moteur de calculs purs (chantier I)
   Aucun DOM ici : tout est testable à la main et mémoïsé par clé.
   Les seuils sont des HEURISTIQUES de coaching (affichés comme conseils,
   jamais comme avis médical) — regroupés pour être ajustés en un endroit.
   ================================================================== */

const P_THRESHOLDS = {
  plateauSessions: 4,            /* nb de séances comparées pour un plateau */
  plateauEps: 0.01,              /* < 1 % d'évolution du 1RM = stagnation */
  setsLow: 6, setsMin: 10, setsHigh: 20,   /* séries dures / semaine / muscle */
  acwrLow: 0.8, acwrHigh: 1.3, acwrDanger: 1.5,
  deloadAfterWeeks: 6
};
const P_DAY = 86400000;
const P_ROUND = (v, d) => { const k = Math.pow(10, d == null ? 1 : d); return Math.round(v * k) / k; };
const P_MIN = (a, b) => (a === undefined ? b : (b === undefined ? a : Math.min(a, b)));
const P_MAX = (a, b) => (a === undefined ? b : (b === undefined ? a : Math.max(a, b)));

/* --- dates : on travaille sur le millésime UTC de l'ISO (YYYY-MM-DD) --- */
function pDate(s){
  if (typeof s !== 'string' || s.length < 10) return NaN;
  return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
}
function pDays(aIso, bIso){ return Math.round((pDate(bIso) - pDate(aIso)) / P_DAY); }
function pAddDays(iso, n){
  const d = new Date(pDate(iso) + n * P_DAY);
  return d.toISOString().slice(0, 10);
}
/* lundi de la semaine ISO contenant iso */
function pWeekStart(iso){
  const t = new Date(pDate(iso));
  const dow = (t.getUTCDay() + 6) % 7;
  return new Date(t.getTime() - dow * P_DAY).toISOString().slice(0, 10);
}

/* --- 1RM estimé (Epley), plafonné à 12 reps pour ne pas gonfler --- */
function pE1rm(kg, reps){
  if (!(kg > 0) || !(reps > 0)) return 0;
  const r = P_MIN(reps, 12);
  return r === 1 ? kg : kg * (1 + r / 30);
}
function pBestE1rm(sets){
  return (sets || []).reduce((m, s) => P_MAX(m, pE1rm(+s.kg, +s.reps)), 0);
}

/* --- pente par semaine (régression linéaire, unités / 7 jours) --- */
function pSlopePerWeek(pts){
  if (!pts || pts.length < 2) return 0;
  const t0 = pDate(pts[0].date);
  const xs = pts.map(p => (pDate(p.date) - t0) / (7 * P_DAY));
  const ys = pts.map(p => +p.v);
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++){ num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) * (xs[i] - mx); }
  return den === 0 ? 0 : num / den;
}

/* --- moyenne mobile exponentielle (bruit eau/sel/repas du poids) --- */
function pEma(values, alpha){
  const a = alpha == null ? 0.2 : alpha;
  const out = [];
  let prev = null;
  (values || []).forEach(v => { prev = prev === null ? v : a * v + (1 - a) * prev; out.push(prev); });
  return out;
}

/* ==================================================================
   ADAPTATEUR : du format Liftr réel -> format « séances normalisées »
   Liftr : history = [{date, exercises:[{name, cardio?, sets:[{weight,reps,assisted,cardio?}]}]}]
   Ici   : { date, exercises:[{ name, muscle, sets:[{kg,reps}] }] }
   - cardio exclu (exercice ET série) ;
   - séries assistées : la charge utile est poids+assistance (bodyweight
     compensé) — convertie explicitement, jamais ignorée en silence ;
   - séries vides / sans charge ni reps : ignorées ;
   - muscle résolu via LIB + EXO_ALIASES (muscleMap()).
   ================================================================== */
function adaptSessions(history, mm){
  const map = mm || (typeof window.muscleMap === 'function' ? window.muscleMap() : {});
  const out = [];
  (history || []).forEach(h => {
    if (!h || !h.date) return;
    const exs = [];
    (h.exercises || []).forEach(e => {
      if (!e || e.cardio) return;
      const name = String(e.name || '').trim();
      if (!name) return;
      const sets = [];
      (e.sets || []).forEach(s => {
        if (!s || s.cardio) return;
        const kg = (+s.weight || 0) + (+s.assisted || 0);
        const reps = +s.reps || 0;
        if (!(kg > 0) || !(reps > 0)) return;
        sets.push({ kg: P_ROUND(kg, 2), reps: reps });
      });
      if (!sets.length) return;
      exs.push({ name: name, muscle: map[name.toLowerCase()] || null, sets: sets });
    });
    if (!exs.length) return;
    out.push({ date: h.date, exercises: exs });
  });
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

function adaptWeights(weightLog){
  return (weightLog || []).filter(w => w && w.date && +w.kg > 0)
    .map(w => ({ date: w.date, kg: +w.kg }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/* --- historique par exercice : [{date,e1rm,topKg,topReps,volume,sets}] trié --- */
function pExerciseHistory(sessions, name){
  const out = [];
  (sessions || []).forEach(s => (s.exercises || []).forEach(ex => {
    if (ex.name !== name) return;
    const sets = ex.sets.filter(x => x.kg > 0 && x.reps > 0);
    if (!sets.length) return;
    let top = sets[0];
    sets.forEach(b => { if (pE1rm(b.kg, b.reps) > pE1rm(top.kg, top.reps)) top = b; });
    out.push({
      date: s.date, e1rm: pBestE1rm(sets), topKg: top.kg, topReps: top.reps,
      volume: sets.reduce((v, x) => v + x.kg * x.reps, 0), sets: sets.length, raw: sets
    });
  }));
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/* --- plateau : peu d'évolution du 1RM sur les n dernières séances --- */
function pDetectPlateau(history, n, eps){
  const N = n == null ? P_THRESHOLDS.plateauSessions : n;
  const EPS = eps == null ? P_THRESHOLDS.plateauEps : eps;
  if (!history || history.length < N) return { plateau: false, sessions: history ? history.length : 0 };
  const recent = history.slice(-N);
  const first = recent[0].e1rm;
  if (!(first > 0)) return { plateau: false, sessions: N };
  const best = recent.reduce((m, h) => P_MAX(m, h.e1rm), 0);
  const gain = (best - first) / first;
  const last = recent[recent.length - 1].e1rm;
  const improvedLast = last >= best - 1e-9 && last > first * (1 + EPS);
  return { plateau: gain <= EPS && !improvedLast, sessions: N, gainPct: P_ROUND(gain * 100, 1) };
}

/* --- double progression : ajoute une rep tant que la fourchette n'est pas
       atteinte, monte la charge (2,5 kg haut du corps / 5 kg bas) sinon --- */
function pNextTarget(lastSets, opts){
  const o = opts || {};
  const minReps = o.minReps == null ? 6 : o.minReps;
  const maxReps = o.maxReps == null ? 10 : o.maxReps;
  const sets = (lastSets || []).filter(s => s.kg > 0 && s.reps > 0);
  if (!sets.length) return null;
  const kg = sets.reduce((m, s) => P_MAX(m, s.kg), 0);
  const atKg = sets.filter(s => s.kg === kg);
  const allTop = atKg.every(s => s.reps >= maxReps);
  const step = o.lower ? 5 : 2.5;
  if (allTop) return { kg: P_ROUND(kg + step, 2), reps: minReps, why: 'top_of_range' };
  const minR = atKg.reduce((m, s) => P_MIN(m, s.reps), atKg[0].reps);
  return { kg: kg, reps: P_MIN(maxReps, minR + 1), why: 'add_rep' };
}

/* --- volume par muscle : séries dures de la semaine contenant weekOf --- */
function pWeeklySetsByMuscle(sessions, weekOf){
  const wk = pWeekStart(weekOf);
  const out = {};
  (sessions || []).forEach(s => {
    if (pWeekStart(s.date) !== wk) return;
    (s.exercises || []).forEach(ex => {
      const n = ex.sets.filter(x => x.reps > 0 && x.kg >= 0).length;
      if (ex.muscle && n) out[ex.muscle] = (out[ex.muscle] || 0) + n;
    });
  });
  return out;
}
function pClassifySets(n){
  const T = P_THRESHOLDS;
  return n < T.setsLow ? 'low' : n < T.setsMin ? 'maintain' : n <= T.setsHigh ? 'productive' : 'high';
}

/* --- charge = somme kg×reps (séries valides) --- */
function pSessionLoad(s){
  return (s.exercises || []).reduce((l, ex) =>
    l + ex.sets.reduce((v, x) => v + (x.kg > 0 && x.reps > 0 ? x.kg * x.reps : 0), 0), 0);
}

/* --- ACWR : charge aiguë (7 j) / chronique (moyenne hebdo des 28 j) --- */
function pAcwr(sessions, today){
  const T = P_THRESHOLDS;
  const load = (from, to) => (sessions || [])
    .filter(s => s.date > from && s.date <= to)
    .reduce((l, s) => l + pSessionLoad(s), 0);
  const acute = load(pAddDays(today, -7), today);
  const chronic = load(pAddDays(today, -28), today) / 4;
  if (chronic <= 0) return { ratio: null, acute: acute, chronic: chronic, zone: 'unknown' };
  const ratio = acute / chronic;
  return {
    ratio: P_ROUND(ratio, 2), acute: Math.round(acute), chronic: Math.round(chronic),
    zone: ratio > T.acwrDanger ? 'danger' : ratio > T.acwrHigh ? 'high'
      : ratio < T.acwrLow ? 'low' : 'optimal'
  };
}

/* --- régularité : séances faites / prévues + série de semaines --- */
function pConsistency(sessions, today, plannedPerWeek, weeks){
  const ppw = plannedPerWeek == null ? 3 : plannedPerWeek;
  const W = weeks == null ? 4 : weeks;
  const from = pAddDays(today, -7 * W);
  const dates = {};
  (sessions || []).forEach(s => { if (s.date > from && s.date <= today) dates[s.date] = 1; });
  const done = Object.keys(dates).length;
  const planned = ppw * W;
  const have = {};
  (sessions || []).forEach(s => { have[pWeekStart(s.date)] = 1; });
  const curWeek = pWeekStart(today);
  let streak = 0;
  if (have[curWeek]){
    let wk = curWeek;
    while (have[wk]){ streak++; wk = pAddDays(wk, -7); }
  } else {
    let wk = pAddDays(curWeek, -7);   /* semaine en cours vide : ne casse pas avant dimanche */
    while (have[wk]){ streak++; wk = pAddDays(wk, -7); }
  }
  return { done: done, planned: planned,
    adherencePct: planned ? Math.min(100, Math.round((done / planned) * 100)) : 100,
    streakWeeks: streak };
}

/* --- poids : courbe lissée (EMA) + pente kg/semaine (fenêtre 28 j) --- */
function pWeightTrend(weights, alpha){
  const w = (weights || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (!w.length) return { points: [], current: null, kgPerWeek: 0 };
  const sm = pEma(w.map(x => x.kg), alpha);
  const points = w.map((x, i) => ({ date: x.date, v: P_ROUND(sm[i], 2) }));
  const lastDate = w[w.length - 1].date;
  const last28 = points.filter(p => pDays(p.date, lastDate) <= 28);
  return { points: points, current: P_ROUND(points[points.length - 1].v, 1),
    kgPerWeek: P_ROUND(pSlopePerWeek(last28), 2) };
}

/* ==================================================================
   MÉMOÏSATION — aucun calcul lourd à chaque rendu.
   On se fie à deux compteurs déjà incrémentés à chaque écriture du
   store : DB.history.length et DB.weightLog.length (l'ajout d'une
   séance/pesée passe toujours par un push sur ces tableaux). Tant que
   le compte est stable, la structure est inchangée et on renvoie le
   cache ; sinon on recalcèle et on stocke. Un seul endroit : pCache.
   ================================================================== */
const pCache = {
  key: null,       /* 'histN/weightsN' de la dernière construction */
  sessions: null,
  weights: null,
  muscleMap: null,
  insights: null
};

/* Construit (ou renvoie le cache de) {sessions, weights, muscleMap, today} */
function pDataset(){
  const hist = (window.DB && DB.history) || [];
  const wlog = (window.DB && DB.weightLog) || [];
  const key = hist.length + '/' + wlog.length;
  if (pCache.key !== key){
    pCache.key = key;
    if (!pCache.muscleMap) pCache.muscleMap = (typeof window.muscleMap === 'function' ? muscleMap() : {});
    pCache.sessions = adaptSessions(hist, pCache.muscleMap);
    pCache.weights = adaptWeights(wlog);
    pCache.insights = null;   /* invalidé : dépend aussi de today/objectif */
  }
  if (!pCache.muscleMap) pCache.muscleMap = (typeof window.muscleMap === 'function' ? muscleMap() : {});
  /* stats.js (qui déclare muscleMap) s'exécute APRÈS ce module : au premier
     rendu la map est vide. On la reconstruit dès qu'elle se remplit, et on
     rafraîchit les séances déjà adaptées pour que le muscle soit résolu. */
  const hasMuscles = pCache.muscleMap && Object.keys(pCache.muscleMap).length > 0;
  if (!hasMuscles && typeof window.muscleMap === 'function' && Object.keys(muscleMap()).length){
    pCache.muscleMap = muscleMap();
    pCache.sessions = adaptSessions(hist, pCache.muscleMap);
  }
  return { sessions: pCache.sessions, weights: pCache.weights,
    muscleMap: pCache.muscleMap, today: todayISO() };
}

/* Force le recalcul (tests, changement d'objectif) */
function pResetCache(){ pCache.key = null; pCache.insights = null; }

/* Objectif nutritionnel : kcal/jour + type lose|maintain|gain (si saisi). */
function pNutriGoal(){
  const n = (window.DB && DB.nutri && DB.nutri.goal) || null;
  return { kcal: n ? +n.kcal || 0 : 0,
    type: (n && (n.type || n.mode)) ? String(n.type || n.mode) : null };
}

/* ==================================================================
   CONSEILS (buildInsights) — 3 à 5 cartes triées par sévérité.
   Chaque conseil porte une action concrète et chiffrée.
   Textes en français, tournés en coaching : ce sont des heuristiques,
   pas des avis médicaux (voir P_THRESHOLDS).
   ================================================================== */
function pLowerBodyNames(){
  return ['squat', 'barbell squat', 'front squat', 'leg press', 'deadlift',
    'romanian deadlift', 'bulgarian split squat', 'walking lunges', 'leg extension',
    'leg curl', 'hip thrust'];
}

function pBuildInsights(sessions, weights, today){
  const T = P_THRESHOLDS;
  const out = [];
  const lower = pLowerBodyNames();
  const names = [];
  const seen = {};
  sessions.forEach(s => s.exercises.forEach(e => { if (!seen[e.name]){ seen[e.name] = 1; names.push(e.name); } }));

  /* a) records + plateaux par exercice (cible chiffrée si stagnation) */
  names.forEach(name => {
    const h = pExerciseHistory(sessions, name);
    if (h.length < 2) return;
    const p = pDetectPlateau(h);
    const last = h[h.length - 1];
    const bestBefore = h.slice(0, -1).reduce((m, x) => P_MAX(m, x.e1rm), 0);
    if (bestBefore > 0 && last.e1rm > bestBefore * 1.005 && pDays(last.date, today) <= 14){
      out.push({ id: 'pr:' + name, kind: 'pr', severity: 'good',
        title: 'Record: ' + name,
        detail: 'Estimated 1RM ' + P_ROUND(last.e1rm) + ' kg (+' +
          P_ROUND(((last.e1rm - bestBefore) / bestBefore) * 100) + ' %).',
        data: { name: name, e1rm: P_ROUND(last.e1rm) } });
    } else if (p.plateau){
      const t = pNextTarget(h[h.length - 1].raw, { lower: lower.indexOf(name.toLowerCase()) >= 0 });
      out.push({ id: 'plateau:' + name, kind: 'plateau', severity: 'warn',
        title: name + ' is stalling',
        detail: 'No progress over the last ' + p.sessions + ' sessions (' + p.gainPct + ' %).',
        action: t ? 'Aim for ' + t.kg + ' kg × ' + t.reps + ', or add one back-off set after your working sets.'
          : 'Change the rep range or add a set.',
        data: { name: name, target: t } });
    }
  });

  /* b) volume par muscle (bande cible 10–20 séries dures / semaine) */
  const sets = pWeeklySetsByMuscle(sessions, today);
  Object.keys(sets).forEach(m => {
    const n = sets[m];
    const c = pClassifySets(n);
    if (c === 'low') out.push({ id: 'vol-low:' + m, kind: 'volume', severity: 'info',
      title: m + ': low volume',
      detail: n + ' sets this week (target ' + T.setsMin + '–' + T.setsHigh + ').',
      action: 'Add ' + (T.setsMin - n) + ' sets for ' + m + ' before Sunday.',
      data: { muscle: m, sets: n } });
    if (c === 'high') out.push({ id: 'vol-high:' + m, kind: 'volume', severity: 'warn',
      title: m + ': high volume',
      detail: n + ' sets this week (> ' + T.setsHigh + ').',
      action: 'Watch recovery — back off if you stall or feel worn down.',
      data: { muscle: m, sets: n } });
  });

  /* c) pic de charge / semaine légère (ACWR : indicatif, pas un diagnostic) */
  const a = pAcwr(sessions, today);
  if (a.zone === 'high' || a.zone === 'danger'){
    out.push({ id: 'acwr', kind: 'load', severity: 'warn', title: 'Load spike',
      detail: 'This week is ' + a.ratio + '× your 4-week average.',
      action: 'Keep one lighter session this week to absorb the load.',
      data: a });
  } else if (a.zone === 'low'){
    out.push({ id: 'acwr-low', kind: 'load', severity: 'info', title: 'Light week',
      detail: 'Load is at ' + a.ratio + '× your recent average.',
      action: 'You have headroom: add a session or reasonable volume.',
      data: a });
  }

  /* d) régularité : série de semaines ou baisse d'adhésion */
  const c4 = pConsistency(sessions, today, 3, 4);
  if (c4.streakWeeks >= 3){
    out.push({ id: 'streak', kind: 'consistency', severity: 'good',
      title: c4.streakWeeks + ' week streak',
      detail: c4.done + '/' + c4.planned + ' sessions over 4 weeks (' + c4.adherencePct + ' %).',
      data: c4 });
  } else if (c4.adherencePct < 60 && c4.planned){
    out.push({ id: 'adherence', kind: 'consistency', severity: 'info',
      title: 'Consistency slipping',
      detail: c4.done + '/' + c4.planned + ' planned sessions these 4 weeks.',
      action: 'Lower the target frequency rather than skipping whole weeks.',
      data: c4 });
  }

  /* e) poids vs objectif (tendance lissée, jamais la courbe brute) */
  const goal = pNutriGoal();
  if (weights.length >= 5){
    const w = pWeightTrend(weights);
    if (goal.kcal > 0 && goal.type === 'lose' && w.kgPerWeek > -0.05){
      out.push({ id: 'wt-lose', kind: 'weight', severity: 'info',
        title: 'Weight flat despite a cut',
        detail: 'Trend ' + (w.kgPerWeek > 0 ? '+' : '') + w.kgPerWeek + ' kg/week.',
        action: 'Check your real intake (Nutrition tab) before cutting further.',
        data: w });
    } else if (goal.kcal > 0 && goal.type === 'gain' && w.kgPerWeek < 0.05){
      out.push({ id: 'wt-gain', kind: 'weight', severity: 'info',
        title: 'No gain despite a bulk',
        detail: 'Trend ' + w.kgPerWeek + ' kg/week.',
        action: 'Add ~150 kcal/day for 2 weeks.',
        data: w });
    }
  }

  const rank = { warn: 0, good: 1, info: 2 };
  return out.sort((x, y) => rank[x.severity] - rank[y.severity]);
}

/* Version mémoïsée par (dernière séance, nombre de séances, objectif). */
function pInsights(sessions, weights, today){
  const goal = pNutriGoal();
  const key = (sessions.length ? sessions[sessions.length - 1].date : '-') + '/' +
    sessions.length + '/' + goal.type + '/' + goal.kcal;
  if (pCache.insights && pCache.insights.key === key) return pCache.insights.list;
  const list = pBuildInsights(sessions, weights, today);
  pCache.insights = { key: key, list: list };
  return list;
}

/* Exports pour stats.js (script classique) — les autres restent des globals. */
window.P_THRESHOLDS = P_THRESHOLDS;
window.adaptSessions = adaptSessions;
window.adaptWeights = adaptWeights;
window.pExerciseHistory = pExerciseHistory;
window.pDetectPlateau = pDetectPlateau;
window.pNextTarget = pNextTarget;
window.pWeeklySetsByMuscle = pWeeklySetsByMuscle;
window.pClassifySets = pClassifySets;
window.pAcwr = pAcwr;
window.pConsistency = pConsistency;
window.pWeightTrend = pWeightTrend;
window.pWeekStart = pWeekStart;
window.pAddDays = pAddDays;
window.pSessionLoad = pSessionLoad;
window.pDataset = pDataset;
window.pResetCache = pResetCache;
window.pInsights = pInsights;
window.pNutriGoal = pNutriGoal;

