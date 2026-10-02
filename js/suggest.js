/* ==================================================================
   LIFTR - suggestions : e1RM, derniere performance, proposition de charge
   ================================================================== */

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
function lastPerf(name){
  const k = String(name || '').toLowerCase().trim();
  if (!k) return null;
  for (const h of DB.history){
    const ex = (h.exercises || []).find(e => String(e.name).toLowerCase().trim() === k);
    if (ex && (ex.sets || []).length){
      const best = ex.sets.reduce((a, b) => volumeOf(b) > volumeOf(a) ? b : a);
      return { date: h.date, sets: ex.sets, best: best, dayName: h.dayName };
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

function round25(v){ return Math.round(v / 2.5) * 2.5; }

/* Double progression : 8 reps ou plus -> +2,5 kg, sinon on garde la charge et on monte en reps */
function suggestFor(name, cardio){
  if (cardio || isCardioName(name)) return null;
  const p = lastPerf(name);
  if (!p) return null;
  const last = p.sets[p.sets.length - 1];
  const w = +last.weight || 0;
  const r = (+last.reps || 0) + (+last.assisted || 0);
  if (!w || r < 1) return null;

  if (r >= 8){
    const nw = round25(w + 2.5);
    return { weight: nw, reps: 8, reason: nw !== w ? '+2.5 kg (8+ reps)' : 'same weight x 8' };
  }
  const nr = Math.min(r + 1, 12);
  return { weight: w, reps: nr, reason: r < 5 ? 'same weight, +1 rep' : 'hold the weight, ' + nr + ' reps' };
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
function activeHistLine(name, cardio){
  if (cardio || isCardioName(name)){
    const p = cardioHistory(name);
    const best = cardioBestKm(name);
    if (!p && !best) return '';
    const bits = [];
    if (p) bits.push('Last time: ' + fmtNum(p.min) + ' min · ' + fmtNum(p.km) + ' km · ' + fmtShort(p.date));
    if (best) bits.push('Record ' + fmtNum(best) + ' km');
    return '<div class="ex-ctx">' + bits.join(' · ') + '</div>';
  }
  const p = lastPerf(name);
  const pr = DB.prs[String(name || '').toLowerCase().trim()];
  if (!p && !pr) return '';
  const bits = [];
  if (p){
    bits.push('Last time: ' + p.sets.map(s =>
      fmtKg(s.weight) + '\u00d7' + s.reps + (s.assisted ? '+' + s.assisted + 'A' : '')
    ).join(', ') + ' · ' + fmtShort(p.date));
  }
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

  const perf = lastPerf(name);
  const pr = DB.prs[String(name || '').toLowerCase().trim()];
  const sug = suggestFor(name, false);

  if (!perf && !pr){ el.hidden = true; el.innerHTML = ''; return; }

  let html = '';
  if (perf){
    html += '<div class="ctx-row"><b>Last time</b> · ' + fmtShort(perf.date) + ' — ' +
      perf.sets.map(s => fmtKg(s.weight) + '\u00d7' + s.reps + (s.assisted ? '+' + s.assisted + 'A' : '')).join(', ') +
      '</div>';
  }
  if (pr){
    html += '<div class="ctx-row"><b>Record</b> — ' + fmtKg(pr.weight) + ' kg \u00d7 ' + pr.reps +
      (pr.assisted ? '+' + pr.assisted + 'A' : '') + ' · e1RM ' + fmtKg(e1rmOf(pr)) + ' kg</div>';
  }
  if (sug){
    html += '<button class="ctx-sug" onclick="applySuggestion()">Suggested: ' +
      fmtKg(sug.weight) + ' kg \u00d7 ' + sug.reps + ' <span>' + sug.reason + '</span></button>';
  }
  el.innerHTML = html;
  el.hidden = false;
}

/* applySuggestion vit dans seance.js (il a besoin de addSetExIdx) */
Object.assign(window, {
  e1rmOf, fmtKg, lastPerf, bestE1rm, suggestFor, activeHistLine,
  renderSetContext, cardioHistory, cardioBestKm
});
