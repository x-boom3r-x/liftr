/* ==================================================================
   LIFTR - suggestions : e1RM, derniere performance, proposition de charge
   ================================================================== */
import { recommendNextSet } from './gym/progression.js';

/* e1RM (Epley) : charge x (1 + reps/30) */
function e1rmOf(s){
  const w = +s.weight || 0;
  const r = +s.reps || 0;
  if (!w || r < 1) return 0;
  return Math.round(w * (1 + r / 30) * 10) / 10;
}

function fmtKg(v){
  const n = Math.round((+v || 0) * 10) / 10;
  return (n % 1 === 0) ? String(n) : n.toFixed(1);
}

/* Derniere performance connue d'un exercice (l'historique est du plus recent au plus ancien) */
function lastPerf(name, mode){
  const k = String(name || '').toLowerCase().trim();
  if (!k) return null;
  for (const h of DB.history){
    const ex = (h.exercises || []).find(e => String(e.name).toLowerCase().trim() === k);
    if (!ex) continue;
    const planned = (h.plannedExercises || []).find(item =>
        String(item.name || '').toLowerCase().trim() === k
      );
    const plan = planned ? planned.planned : null;
    const timed = plan && plan.mode === 'time' || (ex.sets || []).some(s => s && s.timed);
    if (mode === 'time' && !timed) continue;
    if (mode && mode !== 'time' && timed) continue;
    const valid = (ex.sets || []).some(s => timed
      ? s && s.timed && !isWarmupSet(s) && Number(s.sec) > 0
      : s && !isWarmupSet(s) && !s.cardio && !s.timed && +s.weight > 0 && +s.reps > 0);
    if (valid){
      const best = timed
        ? ex.sets.filter(s => s && s.timed && !isWarmupSet(s)).reduce((a, b) => Number(b.sec) > Number(a.sec) ? b : a)
        : ex.sets.reduce((a, b) => volumeOf(b) > volumeOf(a) ? b : a);
      return { date: h.date, sets: ex.sets, best: best, timed, dayName: h.dayName, planned: plan };
    }
  }
  return null;
}

/* Meilleur e1RM connu (historique + record) */
function bestE1rm(name){
  const k = String(name || '').toLowerCase().trim();
  let best = 0;
  DB.history.forEach(h => (h.exercises || []).forEach(ex => {
    if (String(ex.name).toLowerCase().trim() !== k) return;
    (ex.sets || []).forEach(s => { const e = e1rmOf(s); if (e > best) best = e; });
  }));
  const pr = DB.prs[k];
  if (pr){ const e = e1rmOf(pr); if (e > best) best = e; }
  return best;
}

/* La suggestion lit les séries de travail complètes et la cible du programme lorsqu'elle existe. */
function suggestFor(name, cardio, planned){
  if (cardio || isCardioName(name)) return null;
  const p = lastPerf(name, planned && planned.mode);
  if (!p) return null;
  const currentPlan = planned || p.planned || null;
  return recommendNextSet({ sets: p.sets, planned: currentPlan, previousPlan: p.planned });
}

/* --- cardio : dernière sortie + record de distance --- */
function cardioHistory(name){
  const k = String(name || '').toLowerCase().trim();
  if (!k) return null;
  for (const h of DB.history){
    const ex = (h.exercises || []).find(e => String(e.name).toLowerCase().trim() === k);
    if (ex && (ex.sets || []).some(s => s.cardio)){
      const t = cardioTotals([ex]);
      return { date: h.date, km: t.km, min: t.min };
    }
  }
  return null;
}
function cardioBestKm(name){
  const k = String(name || '').toLowerCase().trim();
  if (!k) return 0;
  let best = 0;
  DB.history.forEach(h => (h.exercises || []).forEach(ex => {
    if (String(ex.name).toLowerCase().trim() !== k) return;
    (ex.sets || []).forEach(s => { if (s.cardio && (+s.km || 0) > best) best = +s.km; });
  }));
  return best;
}

/* Ligne resume sous l'exercice pendant la seance active */
function activeHistLine(name, cardio, planned){
  if (cardio || isCardioName(name)){
    const p = cardioHistory(name);
    const best = cardioBestKm(name);
    if (!p && !best) return '';
    const bits = [];
    if (p) bits.push('Last time: ' + fmtNum(p.min) + ' min · ' + fmtNum(p.km) + ' km · ' + fmtShort(p.date));
    if (best) bits.push('Record ' + fmtNum(best) + ' km');
    return '<div class="ex-ctx">' + bits.join(' · ') + '</div>';
  }
  const p = lastPerf(name, planned && planned.mode);
  const pr = DB.prs[String(name || '').toLowerCase().trim()];
  if (!p && !pr) return '';
  const bits = [];
  if (p){
    bits.push('Last time: ' + (p.timed
      ? p.sets.filter(s => s && s.timed).map(s => fmtNum(s.sec) + ' s').join(', ')
      : p.sets.map(s => fmtKg(s.weight) + '\u00d7' + s.reps + (s.assisted ? '+' + s.assisted + 'A' : '')).join(', ')) + ' · ' + fmtShort(p.date));
  }
  if (p && p.timed) return '<div class="ex-ctx">' + bits.join(' · ') + '</div>';
  if (pr) bits.push('PR ' + fmtKg(pr.weight) + '\u00d7' + pr.reps);
  const e = bestE1rm(name);
  if (e) bits.push('e1RM ~' + fmtKg(e) + ' kg');
  return '<div class="ex-ctx">' + bits.join(' · ') + '</div>';
}

/* Contexte dans la modale « + Serie » : derniere fois, record, suggestion cliquable */
function renderSetContext(name, cardio){
  const el = $('setContext');
  if (!el) return;

  if (cardio || isCardioName(name)){
    const p = cardioHistory(name);
    const best = cardioBestKm(name);
    if (!p && !best){ el.hidden = true; el.innerHTML = ''; return; }
    let chtml = '';
    if (p) chtml += '<div class="ctx-row"><b>Last time</b> · ' + fmtShort(p.date) + ' — ' +
      fmtNum(p.min) + ' min · ' + fmtNum(p.km) + ' km</div>';
    if (best) chtml += '<div class="ctx-row"><b>Distance record</b> — ' + fmtNum(best) + ' km</div>';
    el.innerHTML = chtml;
    el.hidden = false;
    return;
  }

  const currentEx = DB.active && DB.active.exercises.find(ex =>
    String(ex.name).toLowerCase().trim() === String(name).toLowerCase().trim()
  );
  const perf = lastPerf(name, currentEx && currentEx.planned && currentEx.planned.mode);
  const pr = DB.prs[String(name || '').toLowerCase().trim()];
  const sug = suggestFor(name, false, currentEx && currentEx.planned);
  const timed = !!(currentEx && currentEx.planned && currentEx.planned.mode === 'time') || !!(perf && perf.timed);

  if (!perf && !pr){ el.hidden = true; el.innerHTML = ''; return; }

  let html = '';
  if (perf){
    html += '<div class="ctx-row"><b>Last time</b> · ' + fmtShort(perf.date) + ' — ' +
      (perf.timed
        ? perf.sets.filter(s => s && s.timed).map(s => fmtNum(s.sec) + ' s hold').join(', ')
        : perf.sets.map(s => fmtKg(s.weight) + '\u00d7' + s.reps + (s.assisted ? '+' + s.assisted + 'A' : '')).join(', ')) +
      '</div>';
  }
  if (timed){
    if (sug){
      html += '<button class="ctx-sug" onclick="applySuggestion()">Suggested: ' +
        fmtNum(sug.sec) + ' s <span>' + sug.reason + '</span></button>';
    }
    el.innerHTML = html;
    el.hidden = !html;
    return;
  }
  if (pr){
    html += '<div class="ctx-row"><b>Record</b> — ' + fmtKg(pr.weight) + ' kg \u00d7 ' + pr.reps +
      (pr.assisted ? '+' + pr.assisted + 'A' : '') + ' · e1RM ' + fmtKg(e1rmOf(pr)) + ' kg</div>';
  }
  if (sug){
    html += '<button class="ctx-sug" onclick="applySuggestion()">Suggested: ' +
      fmtKg(sug.weight) + ' kg \u00d7 ' + sug.reps + (sug.sets ? ' · ' + sug.sets + ' sets' : '') +
      ' <span>' + sug.reason + '</span></button>';
  }
  el.innerHTML = html;
  el.hidden = false;
}

/* applySuggestion vit dans seance.js (il a besoin de addSetExIdx) */
Object.assign(window, {
  e1rmOf, fmtKg, lastPerf, bestE1rm, suggestFor, activeHistLine,
  renderSetContext, cardioHistory, cardioBestKm
});
