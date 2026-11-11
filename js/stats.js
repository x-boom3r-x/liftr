/* ==================================================================
   LIFTR - statistiques & detail d'une seance passee
   ================================================================== */
import { icon, iconS } from './icons.js';
import { getCatalogue } from './gym/exercises.js';


/* ---------- détail d'une séance passée (Stats / Calendrier) ---------- */
function historyPlannedGoal(ex){
  const p = ex && ex.planned;
  if (!p) return '<div class="history-no-target">No target set</div>';
  const values = [];
  if (p.sets != null && p.sets !== '') values.push(esc(p.sets) + ' sets');
  if (p.mode === 'time'){
    if (p.sec != null && p.sec !== '') values.push(esc(p.sec) + ' s hold');
  } else if (Array.isArray(p.pyramid) && p.pyramid.length){
    values.push(esc(p.pyramid.map(value => value === 'max' ? 'Max' : value).join(' · ')) + ' reps · pyramid');
  } else if (p.reps != null && p.reps !== '') values.push(esc(p.reps) + ' reps');
  if (p.mode !== 'time' && p.weight != null && p.weight !== '') values.push(fmtNum(p.weight) + ' kg');
  if (p.rest != null && p.rest !== '') values.push(esc(p.rest) + ' s rest');
  const group = p.groupId
    ? '<span class="planned-group">' + (p.groupType === 'circuit' ? 'Circuit' : 'Superset') +
      (p.groupIndex && p.groupCount ? ' · ' + p.groupIndex + '/' + p.groupCount : '') + '</span>'
    : '';
  return (values.length ? '<div class="planned-goal-values">' + values.join(' · ') + '</div>' : '') +
    group + (p.notes ? '<div class="planned-goal-notes">' + esc(p.notes) + '</div>' : '');
}

function openSessionDetail(hid){
  const h = DB.history.find(x => x.id === hid);
  if (!h){ toast('This session no longer exists'); return; }
  const ct = h.cardioMin ? ' · ' + fmtNum(h.cardioKm) + ' km · ' + h.cardioMin + ' min' : '';
  const unit = h.cardioMin && !h.volume ? 'run' : 'set';
  $('daySheetTitle').textContent = h.dayName;
  $('daySheetSub').textContent = fmtLong(h.date) + ' · ' + (h.totalSets || 0) + ' ' + unit +
    ((h.totalSets || 0) !== 1 ? 's' : '') + ' · ' + fmtVolume(h.volume || 0) + ' volume' + ct;

  const activeDays = window.getActiveProgrammeDays();
  const day = h.dayId ? activeDays.find(d => d.id === h.dayId) : null;
  let html = h.sourceType === 'free'
    ? '<div class="hint" style="margin-bottom:14px">Free session · no programmed objectives.</div>'
    : (day
      ? '<button class="btn btn-sm btn-block" style="margin-bottom:14px" onclick="gotoDay(\'' + day.id + '\')">Open "' + esc(day.name) + '" in the Program →</button>'
      : (h.sourceType === 'program'
        ? '<div class="hint" style="margin-bottom:14px">Original session from ' + esc(h.programName || 'the program') + ' · ' + esc(h.dayName) + '. Its saved targets and results stay in stats.</div>'
        : '<div class="hint" style="margin-bottom:14px">This session no longer exists in the Program. Its history stays in stats.</div>'));

  html += '<div class="history-section-title">Results recorded</div>';
  html += (h.exercises || []).map(e =>
    '<div class="ex-block"><div class="ex-name">' + esc(e.name) +
    '<span class="chip chip-type">' + (e.sets || []).length + '×</span></div>' +
    ((e.sets || []).length
      ? e.sets.map((s, i) => '<div class="set-row"><div class="set-num">' + (i + 1) + '</div>' +
          '<div class="set-values">' + setLine(s) + '</div></div>').join('')
      : '<div class="ex-empty">No sets</div>') +
    '</div>'
  ).join('') || '<div class="hint">No exercise logged.</div>';

  const planned = Array.isArray(h.plannedExercises) ? h.plannedExercises : [];
  if (planned.length){
    html += '<div class="history-section-title">Programmed objectives</div>' + planned.map(e =>
      '<div class="history-planned-ex"><div class="history-planned-name">' + esc(e.name) + '</div>' +
      historyPlannedGoal(e) + '</div>'
    ).join('');
  }

  const missing = (h.missing || []).filter(Boolean);
  const added = (h.added || []).filter(a => a && a.name);
  if (missing.length || added.length){
    const replBy = {};
    added.forEach(a => { if (a.action === 'replaced' && a.replaces) replBy[a.replaces.toLowerCase()] = a.name; });
    html += '<div class="hist-diff">';
    missing.forEach(m => {
      html += '<div class="diff-line miss">− ' + esc(m) + ': not done' +
        (replBy[String(m).toLowerCase()] ? ' · replaced by ' + esc(replBy[String(m).toLowerCase()]) : ' · kept in your program') +
        '</div>';
    });
    added.forEach(a => {
      html += '<div class="diff-line add">+ ' + esc(a.name) +
        (a.action === 'added' ? ' · added to the program'
          : a.action === 'replaced' ? ' · replaces "' + esc(a.replaces || '') + '"'
          : ' · kept out of the program') +
        '</div>';
    });
    html += '</div>';
  }

  if (h.note) html += '<div class="hist-note">' + icon('memo') + ' ' + esc(h.note) + '</div>';
  $('daySheetContent').innerHTML = html;
  $('daySheetDelete').onclick = () => deleteHistoryEntry(h.id);
  openModal('daySheetModal');
}

/* --- bouton « supprimer cette seule séance » (une occurrence, pas le jour du programme) --- */
function histDelBtn(h){
  return '<button class="hist-del" title="Delete this session" ' +
    'onclick="event.stopPropagation();deleteHistoryEntry(\'' + h.id + '\')">×</button>';
}

function gotoDay(id){
  closeModal('daySheetModal');
  showTab('programme');
  openDayDetail(id);
}

function deleteHistoryEntry(hid){
  const h = DB.history.find(x => x.id === hid);
  if (!h){ toast('This session no longer exists'); return; }
  askConfirm('Delete this session from stats?',
    '"' + h.dayName + '" on ' + fmtShort(h.date) + '\nIts sets and volume will leave the statistics and calendar.\nPersonal records are kept.',
    'Delete from stats')
  .then(res => {
    if (!res.ok) return;
    DB.history = DB.history.filter(x => x.id !== hid);
    save();
    closeModal('daySheetModal');
    renderAll();
  });
}

/* Nombre de jours entre une date ISO et aujourd'hui (0 = aujourd'hui, négatif = futur) */
function agoOf(iso){
  if (!iso || iso.length < 10) return 9999;
  const t = todayISO();
  const a = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const b = Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10));
  return Math.round((b - a) / 86400000);
}

/* ==================================================================
   DASHBOARD STATS
   ================================================================== */

/* --- états du tableau de bord --- */
let statEx = null;        /* exercice sélectionné (Performance + Progression) */
let statPeriod = 90;      /* jours : 28 (4W) | 90 (3M) | 180 (6M) | 365 (1A) */
let statMetric = 'e1rm';  /* e1rm | weight | reps | volume */
let volRange = 30;        /* jours : 7 | 30 | 90 | 365 (volume + muscles) */
let weightRange = 30;     /* jours sparkline poids : 30 | 90 | 365 */

const PERF_PERIODS = [[28, '4W'], [90, '3M'], [180, '6M'], [365, '1Y']];
const VOL_RANGES = [[7, '7D'], [30, '30D'], [90, '90D'], [365, '1Y']];
const METRICS = [['e1rm', '1RM'], ['weight', 'Weight'], ['reps', 'Reps'], ['volume', 'Volume']];

function periodLabel(d){
  return d === 28 ? '4 weeks' : d === 7 ? '7 days' : d === 30 ? '30 days'
    : d === 90 ? '3 months' : d === 180 ? '6 months' : d === 365 ? '1 year' : d + ' days';
}
function fmtDM(iso){ return (+iso.slice(8, 10)) + '/' + (+iso.slice(5, 7)); }
function daysAgoISO(n){
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoOf(d);
}

/* --- index des exercices (force uniquement, du plus récent au plus ancien) --- */
function statsExList(){
  const map = new Map();
  (DB.history || []).forEach(h => (h.exercises || []).forEach(ex => {
    if (ex.cardio) return;
    const sets = (ex.sets || []).filter(s => !s.cardio && !s.timed && isWorkingSet(s));
    if (!sets.length) return;
    const key = String(ex.name).toLowerCase().trim();
    const cur = map.get(key) || { key: key, name: ex.name, last: '', vol: 0 };
    if (h.date > cur.last) cur.last = h.date;
    cur.vol += sets.reduce((n, s) => n + volumeOf(s), 0);
    map.set(key, cur);
  }));
  Object.entries(DB.prs || {}).forEach(([key, pr]) => {
    if (!map.has(key)) map.set(key, { key: key, name: pr.name || key, last: pr.date || '', vol: 0 });
  });
  return [...map.values()].sort((a, b) => a.last < b.last ? 1 : a.last > b.last ? -1 : b.vol - a.vol);
}

function pickEx(list){
  if (!list.length) return null;
  let ex = list.find(x => x.key === statEx);
  if (!ex){ ex = list[0]; statEx = ex.key; }
  return ex;
}

/* --- série chronologique d'un exercice sur [from, to) jours --- */
function exSeriesWin(key, from, to){
  const out = [];
  (DB.history || []).forEach(h => {
    const ago = agoOf(h.date);
    if (ago < from || ago >= to) return;
    const ex = (h.exercises || []).find(e => !e.cardio && String(e.name).toLowerCase().trim() === key);
    if (!ex) return;
    const sets = (ex.sets || []).filter(s => !s.cardio && !s.timed && isWorkingSet(s));
    if (!sets.length) return;
    let e1 = 0, w = 0, r = 0, vol = 0, best = sets[0];
    sets.forEach(s => {
      const e = e1rmOf(s);
      if (e > e1){ e1 = e; best = s; }
      if (+s.weight > w) w = +s.weight;
      if (+s.reps > r) r = +s.reps;
      vol += volumeOf(s);
    });
    /* raw = les sets valides du meilleur set : requis par pNextTarget (I3 cible) */
    out.push({ date: h.date, e1rm: e1, weight: w, reps: r, vol: vol, best: best, raw: sets });
  });
  out.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  if (!out.length){
    const pr = (DB.prs || {})[key];
    if (pr){
      const a = agoOf(pr.date);
      const w = +pr.weight || 0, r = +pr.reps || 0, s = +pr.assisted || 0;
      if (a >= from && a < to) out.push({
        date: pr.date, e1rm: e1rmOf(pr), weight: w,
        reps: r, vol: w * (r + s),
        best: { weight: w, reps: r, assisted: s }, raw: [{ weight: w, reps: r, assisted: s }]
      });
    }
  }
  return out;
}
function exSeries(key, days){ return exSeriesWin(key, 0, days); }

function metricSeries(series, metric){
  if (metric === 'volume'){
    let run = 0;
    return series.map(p => { run += p.vol; return { date: p.date, v: run }; });
  }
  return series.map(p => ({ date: p.date, v: p[metric] }));
}

/* --- graphes SVG (aucune librairie : la PWA doit marcher hors-ligne) --- */
let _chartN = 0;
function lineChart(pts, color){
  if (!pts || !pts.length) return '';
  const W = 300, H = 92, PX = 5, PT = 10, PB = 10;
  const vs = pts.map(p => p.v);
  let min = Math.min.apply(null, vs), max = Math.max.apply(null, vs);
  if (!isFinite(min) || !isFinite(max)) return '';
  if (min === max){ min -= 1; max += 1; }
  const pad = (max - min) * 0.12;
  min -= pad; max += pad;
  const X = i => pts.length === 1 ? W / 2 : PX + (i / (pts.length - 1)) * (W - PX * 2);
  const Y = v => PT + (1 - (v - min) / (max - min)) * (H - PT - PB);
  const coords = pts.map((p, i) => X(i).toFixed(1) + ',' + Y(p.v).toFixed(1));
  const id = 'lg' + (++_chartN);
  const c = color || 'var(--primary)';
  let area = '';
  if (pts.length > 1){
    area = '<path d="M' + coords[0] + ' L' + coords.join(' L') +
      ' L' + X(pts.length - 1).toFixed(1) + ',' + (H - 1) + ' L' + X(0).toFixed(1) + ',' + (H - 1) + ' Z" fill="url(#' + id + ')"/>';
  }
  const last = pts[pts.length - 1];
  return '<svg class="dchart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Progress chart">' +
    '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="' + c + '" stop-opacity=".32"/>' +
      '<stop offset="1" stop-color="' + c + '" stop-opacity="0"/></linearGradient></defs>' +
    area +
    '<polyline points="' + coords.join(' ') + '" fill="none" stroke="' + c + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
    '<circle cx="' + X(pts.length - 1).toFixed(1) + '" cy="' + Y(last.v).toFixed(1) + '" r="3" fill="' + c + '" stroke="var(--surface)" stroke-width="1.5" vector-effect="non-scaling-stroke"/>' +
  '</svg>';
}

function barChart(vals, color){
  if (!vals || !vals.length) return '';
  const W = 300, H = 92, PB = 3;
  const max = Math.max.apply(null, vals.concat([1]));
  const n = vals.length;
  const gap = n > 24 ? 1 : 2;
  const bw = Math.max(1.5, (W - gap * (n - 1)) / n);
  const c = color || 'var(--primary)';
  const bars = vals.map((v, i) => {
    if (v <= 0) return '';
    const h = Math.max(2, (v / max) * (H - PB - 4));
    const op = (0.45 + 0.55 * (v / max)).toFixed(2);
    return '<rect x="' + (i * (bw + gap)).toFixed(1) + '" y="' + (H - h).toFixed(1) +
      '" width="' + bw.toFixed(1) + '" height="' + h.toFixed(1) + '" rx="2" fill="' + c + '" opacity="' + op + '"/>';
  }).join('');
  if (!bars) return '<svg class="dchart" viewBox="0 0 ' + W + ' ' + H + '"><rect x="0" y="' + (H - 2) + '" width="' + W + '" height="2" fill="rgba(255,255,255,.08)"/></svg>';
  return '<svg class="dchart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Bar chart">' + bars + '</svg>';
}

function chartAxis(fromIso, toIso){
  if (!fromIso || !toIso) return '';
  return '<div class="chart-x"><span>' + fmtDM(fromIso) + '</span><span>' + fmtDM(toIso) + '</span></div>';
}

function dashHint(txt){
  return '<div class="dash-hint">' + txt + '</div>';
}
function dashEmpty(){
  return '<div class="empty dash-empty"><div class="empty-icon">' + iconS('chartup') + '</div>' +
    '<div class="empty-title">Not enough data yet</div>' +
    '<div class="empty-text">Keep logging your workouts to see your progress.</div></div>';
}

function statCell(value, label, color){
  return '<div class="stat-box"><div class="stat-value" style="color:' + color + '">' + value + '</div>' +
    '<div class="stat-label">' + label + '</div></div>';
}

function perfDelta(pct){
  const cls = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  const arrow = pct > 0 ? '↑ +' : pct < 0 ? '↓ ' : '';
  return '<span class="perf-delta ' + cls + '">' + arrow + fmtNum(pct) + ' %</span>';
}

/* --- sélecteur d'exercice (Performance + Progression partagent la sélection) --- */
function exChipsHtml(list){
  if (list.length < 2) return '';
  return '<div class="ex-chips">' + list.map(x =>
    '<button class="ex-chip' + (x.key === statEx ? ' on' : '') + '" data-ex="' + esc(x.key) + '">' + esc(x.name) + '</button>'
  ).join('') + '</div>';
}

/* --- 3. Force : courbe 1RM estimé + record + prochaine cible + plateau --- */
function forceCardHtml(list, sessions, today){
  const ex = pickEx(list);
  if (!ex) return '';
  const series = exSeriesWin(ex.key, 0, statPeriod);
  const periods = '<div class="range-picker">' + PERF_PERIODS.map(p =>
    '<button class="range-opt' + (statPeriod === p[0] ? ' on' : '') + '" data-per="' + p[0] + '">' + p[1] + '</button>'
  ).join('') + '</div>';

  let body;
  if (!series.length){
    body = dashHint('No data over ' + periodLabel(statPeriod).toLowerCase() + ' for this exercise.');
  } else {
    const last = series[series.length - 1];
    const best = series.reduce((a, b) => b.e1rm > a.e1rm ? b : a);
    const hist = pExerciseHistory(sessions, ex.name);
    const plateau = pDetectPlateau(hist);
    const tgt = pNextTarget(hist.length ? hist[hist.length - 1].raw : (last.best ? [last.best] : []), {});
    const cells = [
      '<div class="stat-box"><div class="stat-value" style="color:var(--primary)">' + fmtKg(last.e1rm) +
        '</div><div class="stat-label">1RM estimated</div></div>',
      '<div class="stat-box"><div class="stat-value">' + fmtKg(best.e1rm) +
        '</div><div class="stat-label">best</div></div>',
      tgt ? '<div class="stat-box"><div class="stat-value" style="color:var(--blue)">' + fmtKg(tgt.kg) +
        '<span class="stat-unit">×' + tgt.reps + '</span></div><div class="stat-label">next target</div></div>'
        : '<div class="stat-box"><div class="stat-value">—</div><div class="stat-label">next target</div></div>'
    ].join('');
    body = '<div class="stats-grid force-cells" style="margin:0">' + cells + '</div>' +
      lineChart(series.map(p => ({ date: p.date, v: p.e1rm }))) +
      chartAxis(series[0].date, last.date) +
      '<div class="force-meta">' +
      (plateau.plateau
        ? '<span class="force-pill warn">plateau ' + plateau.gainPct + ' %</span>'
        : '<span class="force-pill good">progressing</span>') +
      (tgt ? '<span class="force-pill blue">target ' + fmtKg(tgt.kg) + ' kg × ' + tgt.reps +
        ' (' + (tgt.why === 'top_of_range' ? 'add load' : 'add reps') + ')</span>' : '') +
      '</div>';
  }

  return '<div class="card force-card"><div class="card-header">' +
    '<div class="card-title">Force</div>' + periods + '</div>' +
    exChipsHtml(list) +
    '<div class="perf-label">' + esc(ex.name) + '</div>' + body + '</div>';
}

/* --- 3b. Performance : e1RM + variation % (carte d'origine, régression) --- */
function perfCardHtml(list){
  const ex = pickEx(list);
  if (!ex) return '';
  const series = exSeriesWin(ex.key, 0, statPeriod);
  const periods = '<div class="range-picker">' + PERF_PERIODS.map(p =>
    '<button class="range-opt' + (statPeriod === p[0] ? ' on' : '') + '" data-per="' + p[0] + '">' + p[1] + '</button>'
  ).join('') + '</div>';

  let body;
  if (!series.length){
    body = dashHint('No data yet for "' + esc(ex.name) + '" over ' + periodLabel(statPeriod) + '.');
  } else {
    const last = series[series.length - 1];
    const first = series[0];
    const best = series.reduce((a, b) => b.e1rm > a.e1rm ? b : a);
    let delta = '';
    if (series.length >= 2 && first.e1rm > 0){
      delta = perfDelta(Math.round((last.e1rm - first.e1rm) / first.e1rm * 1000) / 10);
    }
    body =
      '<div class="perf-main">' +
        '<span class="perf-value">' + fmtKg(last.e1rm) + '<span class="perf-unit">kg</span></span>' + delta +
      '</div>' +
      '<div class="perf-sub">estimated e1RM · max ' + fmtKg(best.e1rm) + ' kg · ' + series.length +
        ' performance' + (series.length !== 1 ? 's' : '') + '</div>' +
      lineChart(series.map(p => ({ date: p.date, v: p.e1rm }))) +
      chartAxis(first.date, last.date);
  }

  return '<div class="card perf-card">' +
    '<div class="card-header"><div class="card-title">Performance</div>' + periods + '</div>' +
    exChipsHtml(list) +
    '<div class="perf-label">' + esc(ex.name) + '</div>' +
    body +
  '</div>';
}

/* --- 2. Records personnels --- */
function prRowsHtml(){
  const rows = Object.entries(DB.prs || {}).map(([key, pr]) => ({ key: key, name: pr.name || key, weight: +pr.weight || 0, reps: +pr.reps || 0, assisted: +pr.assisted || 0, date: pr.date }));
  if (!rows.length) return '';
  rows.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
  const activeDays = window.getActiveProgrammeDays();
  const inProgramme = new Set((activeDays || []).flatMap(d => d.exercises.map(e => String(e.name).toLowerCase().trim())));

  return rows.map(pr => {
    const logs = (DB.prLog || []).filter(l => l.key === pr.key && l.date === pr.date);
    const log = logs[0] || null;
    let badge = '';
    if (log && log.prev){
      const dw = pr.weight - (+log.prev.weight || 0);
      const dr = pr.reps - (+log.prev.reps || 0);
      if (dw > 0) badge = '<span class="pr-badge up">+' + fmtNum(dw) + ' kg</span>';
      else if (dr > 0) badge = '<span class="pr-badge up">+' + dr + ' reps</span>';
    } else if (agoOf(pr.date) <= 7){
      badge = '<span class="pr-badge new">NEW PR</span>';
    }
    return '<div class="pr-card"><div><div class="pr-exercise">' + esc(pr.name) +
      (inProgramme.has(pr.key) ? '' : ' <span class="chip chip-rest" style="margin-left:6px">not in program</span>') +
      '</div><div class="pr-meta">' + fmtShort(pr.date) + '</div></div>' +
      '<div class="pr-right">' + badge +
      '<div class="pr-value">' + fmtNum(pr.weight) + '<span class="pr-unit">kg × ' + pr.reps +
      (pr.assisted ? '+' + pr.assisted + 'A' : '') + '</span></div>' +
      '<button type="button" class="icon-btn pr-share" data-key="' + esc(encodeURIComponent(pr.key)) + '" ' +
      'onclick="event.stopPropagation();sharePrFromCard(this)" ' +
      'title="Share this record" aria-label="Share this record">' + icon('share') + '</button></div></div>';
  }).join('');
}

function prSectionHtml(showHint){
  const rows = prRowsHtml();
  if (rows) return '<div class="section-title" style="font-size:.95rem;margin:16px 0 10px">Personal records</div>' + rows;
  if (showHint) return dashHint('No personal records yet — lift a new best to set one.');
  return '';
}

/* H : partager un record depuis sa carte — ouvre le composer du Feed
   pré-rempli (attachement pr, validation + rendu dans social/attach.js) */
function sharePrFromCard(btn){
  const key = decodeURIComponent((btn && btn.getAttribute && btn.getAttribute('data-key')) || '');
  if (!key) return false;
  const att = (typeof window.prAttachment === 'function') ? window.prAttachment(key) : null;
  if (!att){ toast('This record cannot be shared yet.'); return false; }
  return (typeof window.openShareComposer === 'function') && window.openShareComposer(att);
}

/* --- 3. Progression par exercice --- */
function progCardHtml(list){
  const ex = pickEx(list);
  if (!ex) return '';
  const series = exSeries(ex.key, statPeriod);
  const metrics = '<div class="range-picker">' + METRICS.map(m =>
    '<button class="range-opt' + (statMetric === m[0] ? ' on' : '') + '" data-metric="' + m[0] + '">' + m[1] + '</button>'
  ).join('') + '</div>';

  let body;
  if (!series.length){
    body = dashHint('No data over ' + periodLabel(statPeriod).toLowerCase() + ' for this exercise.');
  } else {
    const bestE = series.reduce((m, p) => Math.max(m, p.e1rm), 0);
    const bestW = series.reduce((m, p) => Math.max(m, p.weight), 0);
    const bestR = series.reduce((m, p) => Math.max(m, p.reps), 0);
    const vol = series.reduce((n, p) => n + p.vol, 0);
    const mpts = metricSeries(series, statMetric);
    body =
      '<div class="stats-grid prog-cells">' +
        statCell(fmtKg(bestE), 'estimated e1RM', 'var(--primary)') +
        statCell(fmtNum(bestW), 'Best weight', 'var(--blue)') +
        statCell(fmtNum(bestR), 'Best reps', 'var(--green)') +
        statCell(fmtVolume(vol) + ' kg', 'Total volume', 'var(--violet)') +
      '</div>' +
      (mpts.length > 1
        ? lineChart(mpts, statMetric === 'volume' ? 'var(--violet)' : statMetric === 'reps' ? 'var(--green)' : statMetric === 'weight' ? 'var(--blue)' : 'var(--primary)') +
          chartAxis(mpts[0].date, mpts[mpts.length - 1].date)
        : '<div class="dash-hint">Only one measurement recorded over ' + periodLabel(statPeriod).toLowerCase() + '.</div>');
  }

  return '<div class="card prog-card">' +
    '<div class="card-header"><div class="card-title">Progression</div>' + metrics + '</div>' +
    exChipsHtml(list) +
    '<div class="perf-label">' + esc(ex.name) + ' · ' + periodLabel(statPeriod) + '</div>' +
    body +
  '</div>';
}

/* --- 4. Volume d'entraînement --- */
function volumeWindow(days){
  let cur = 0, prev = 0;
  (DB.history || []).forEach(h => {
    const ago = agoOf(h.date);
    if (ago < 0) return;
    if (ago < days) cur += h.volume || 0;
    else if (ago < days * 2) prev += h.volume || 0;
  });
  return { cur: cur, prev: prev };
}

function volumeBuckets(days){
  const size = days <= 7 ? 1 : days <= 30 ? 3 : days <= 90 ? 7 : 31;
  const count = Math.ceil(days / size);
  const bars = new Array(count).fill(0);
  (DB.history || []).forEach(h => {
    const ago = agoOf(h.date);
    if (ago < 0 || ago >= days) return;
    const slot = Math.floor(ago / size);
    if (slot >= 0 && slot < count) bars[count - 1 - slot] += h.volume || 0;
  });
  return bars;
}

function volCardHtml(){
  const { cur, prev } = volumeWindow(volRange);
  const ranges = '<div class="range-picker">' + VOL_RANGES.map(r =>
    '<button class="range-opt' + (volRange === r[0] ? ' on' : '') + '" data-vol="' + r[0] + '">' + r[1] + '</button>'
  ).join('') + '</div>';

  let delta = '';
  if (prev > 0) delta = perfDelta(Math.round((cur - prev) / prev * 1000) / 10);
  else if (cur > 0) delta = '<span class="perf-delta up">↑ new</span>';

  const bars = volumeBuckets(volRange);
  const hasAny = cur > 0 || prev > 0 || bars.some(b => b > 0);
  const body = hasAny
    ? '<div class="perf-main">' +
        '<span class="perf-value vol-value">' + fmtVolume(cur) + '<span class="perf-unit">kg</span></span>' + delta +
      '</div>' +
      '<div class="perf-sub">over ' + periodLabel(volRange) +
        (prev > 0 ? ' · previous period ' + fmtVolume(prev) + ' kg' : '') + '</div>' +
      barChart(bars) +
      chartAxis(daysAgoISO(volRange - 1), todayISO())
    : dashHint('No volume over ' + periodLabel(volRange).toLowerCase() + '.');

  const ct = cardioInRange(volRange);
  const cardioLine = (ct.km || ct.min)
    ? '<div class="cardio-line">' + iconS('run') + ' ' + fmtNum(ct.km) + ' km · ' + ct.min + ' minutes · ' + ct.sorties + ' run' + (ct.sorties !== 1 ? 's' : '') + '</div>'
    : '';

  return '<div class="card vol-card">' +
    '<div class="card-header"><div class="card-title">Training volume</div>' + ranges + '</div>' +
    body + cardioLine +
  '</div>';
}

/* --- cardio cumulé (compact) --- */
function cardioInRange(days){
  let km = 0, min = 0, sorties = 0;
  (DB.history || []).forEach(h => {
    if (days){
      const a = agoOf(h.date);
      if (a < 0 || a >= days) return;
    }
    if (h.cardioMin || h.cardioKm){
      km += +h.cardioKm || 0; min += +h.cardioMin || 0; sorties++;
    } else {
      const t = cardioTotals(h.exercises);
      if (t.min || t.km){ km += t.km; min += t.min; sorties++; }
    }
  });
  return { km: Math.round(km * 10) / 10, min: Math.round(min), sorties: sorties };
}

/* --- 5. Répartition musculaire --- */
const MUSCLE_BUCKETS = [
  ['Chest', ['Chest']],
  ['Back', ['Back']],
  ['Legs', ['Legs', 'Glutes']],
  ['Shoulders', ['Shoulders']],
  ['Arms', ['Biceps', 'Triceps']],
  ['Core', ['Core']],
  ['Other', []]
];
function muscleMap(){
  const m = {};
  Object.keys(LIB).forEach(g => {
    if (g === 'Cardio') return;
    LIB[g].forEach(n => { m[String(n).toLowerCase().trim()] = g; });
  });
  /* legacy French names resolve through EXO_ALIASES to their English key */
  Object.keys(EXO_ALIASES).forEach(fr => { if (m[EXO_ALIASES[fr]]) m[fr] = m[EXO_ALIASES[fr]]; });
  /* Ajoute les exercices du catalogue openGym (nom → bodyPart) quand disponible. */
  const cat = getCatalogue();
  if (cat.length){
    cat.forEach(ex => {
      if (ex.name && ex.bodyPart) m[String(ex.name).toLowerCase().trim()] = ex.bodyPart.replace(/\b\w/g, c => c.toUpperCase());
    });
  }
  return m;
}
function muscleSplit(days){
  const mm = muscleMap();
  const agg = {};
  MUSCLE_BUCKETS.forEach(b => { agg[b[0]] = 0; });
  (DB.history || []).forEach(h => {
    const ago = agoOf(h.date);
    if (ago < 0 || (days && ago >= days)) return;
    (h.exercises || []).forEach(ex => {
      const sets = (ex.sets || []).filter(s => !s.cardio);
      if (!sets.length) return;
      const g = mm[String(ex.name).toLowerCase().trim()];
      let bucket = 'Other';
      if (g){
        const found = MUSCLE_BUCKETS.find(b => b[1].indexOf(g) >= 0);
        if (found) bucket = found[0];
      }
      agg[bucket] += sets.reduce((n, s) => n + volumeOf(s), 0);
    });
  });
  const total = MUSCLE_BUCKETS.reduce((n, b) => n + agg[b[0]], 0);
  return { agg: agg, total: total };
}

function muscleCardHtml(){
  const { agg, total } = muscleSplit(volRange);
  if (!total) return '';
  const rows = MUSCLE_BUCKETS
    .map(b => ({ name: b[0], v: agg[b[0]] }))
    .filter(r => r.v > 0)
    .sort((a, b) => b.v - a.v)
    .map(r => {
      const pct = Math.round(r.v / total * 100);
      return '<div class="musc-row">' +
        '<span class="musc-label">' + r.name + '</span>' +
        '<span class="musc-track"><i style="width:' + Math.max(pct, 2) + '%"></i></span>' +
        '<span class="musc-pct">' + pct + ' %</span>' +
      '</div>';
    }).join('');
  /* carte musculaire maison (js/bodymap.js) : mêmes scores que la liste,
     silhouette cliquable → ouvre Library filtrée sur le muscle */
  const map = (typeof window.bodyMapHtml === 'function')
    ? bodyMapHtml({
        scores: muscleScores(volRange),
        days: volRange,
        selected: '',
        select: true
      })
    : '';
  return '<div class="card musc-card">' +
    '<div class="card-header"><div class="card-title">Muscle split</div>' +
    '<div class="card-sub" style="margin:0">over ' + periodLabel(volRange) + '</div></div>' +
    map +
    '<div class="musc-list">' + rows + '</div>' +
  '</div>';
}

/* ==================================================================
   CHANTIER I — Progression intelligente
   Ordre : Insights · Cette semaine · Force · Volume · Séries/muscle ·
           ACWR · Corps (EMA) · Records · Cardio · By session · Récent
   Moteur de calculs purs dans js/progress.js (mémoïsé pDataset()).
   ================================================================== */

/* --- 1. Insights : 3 à 5 cartes triées par sévérité + action --- */
function insightsCardHtml(sessions, weights, today){
  const list = pInsights(sessions, weights, today).slice(0, 5);
  if (!list.length){
    return '<div class="card"><div class="card-title">Insights</div>' +
      dashHint('Not enough data for advice yet — log 2–3 more sessions.') + '</div>';
  }
  const rows = list.map(it => {
    const act = it.action
      ? '<div class="ins-act">' + esc(it.action) + '</div>' : '';
    return '<div class="ins-card ' + esc(it.severity) + '" data-kind="' + esc(it.kind) + '">' +
      '<div class="ins-head"><span class="ins-dot" aria-hidden="true"></span>' +
      '<span class="ins-title">' + esc(it.title) + '</span></div>' +
      '<div class="ins-detail">' + esc(it.detail) + '</div>' + act +
    '</div>';
  }).join('');
  return '<div class="card ins-list-card"><div class="card-header">' +
    '<div class="card-title">Insights</div>' +
    '<div class="card-sub" style="margin:0">coaching heuristics</div></div>' +
    '<div class="ins-list">' + rows + '</div></div>';
}

/* --- 2. This week : sessions done/planned, volume, delta vs 4w avg, streak --- */
function weekCardHtml(sessions, today){
  const wk = pWeekStart(today);
  const week = sessions.filter(s => pWeekStart(s.date) === wk);
  const vol = week.reduce((n, s) => n + pSessionLoad(s), 0);

  /* moyenne hebdo des 4 semaines précédentes */
  let sum4 = 0;
  for (let i = 1; i <= 4; i++){
    const a = pAddDays(pAddDays(wk, -7 * i), 0), b = pAddDays(pAddDays(wk, -7 * i), 7);
    sum4 += sessions.filter(s => s.date >= a && s.date < b).reduce((n, s) => n + pSessionLoad(s), 0);
  }
  const avg4 = sum4 / 4;
  const delta = avg4 > 0 ? Math.round(((vol - avg4) / avg4) * 100) : null;
  const c = pConsistency(sessions, today, 3, 4);
  const cells = [
    '<div class="stat-box"><div class="stat-value">' + week.length +
      '<span class="stat-unit">/3</span></div><div class="stat-label">sessions</div></div>',
    '<div class="stat-box"><div class="stat-value" style="color:var(--violet)">' + fmtVolume(vol) +
      '<span class="stat-unit">kg</span></div><div class="stat-label">volume</div></div>',
    '<div class="stat-box"><div class="stat-value" style="color:' +
      (delta == null ? 'var(--muted)' : delta >= 0 ? 'var(--green)' : 'var(--red)') + '">' +
      (delta == null ? '—' : (delta > 0 ? '+' : '') + delta + '%') +
      '</div><div class="stat-label">vs 4w avg</div></div>',
    '<div class="stat-box"><div class="stat-value" style="color:var(--primary)">' + iconS('flame') + c.streakWeeks +
      '</div><div class="stat-label">week streak</div></div>'
  ].join('');
  return '<div class="card week-card"><div class="card-title">This week</div>' +
    '<div class="stats-grid" style="margin:0">' + cells + '</div>' +
    '<div class="card-sub" style="margin-top:8px">' + c.done + '/' + c.planned +
      ' sessions over 4 weeks (' + c.adherencePct + ' %)</div></div>';
}


/* I4 — séries dures / semaine / muscle avec bande cible 10–20 (THRESHOLDS) */
function muscleSetsCardHtml(sessions, today){
  const sets = pWeeklySetsByMuscle(sessions, today);
  const rows = MUSCLE_BUCKETS
    .map(b => ({ name: b[0], n: b[1].reduce((t, g) => t + (sets[g] || 0), 0) }))
    .filter(r => r.n > 0)
    .sort((a, b) => b.n - a.n);
  if (!rows.length) return '';
  const maxScale = Math.max(20, rows[0].n);
  const body = rows.map(r => {
    const cls = pClassifySets(r.n);
    const pct = Math.min(100, Math.round((r.n / maxScale) * 100));
    return '<div class="muscs-row ' + cls + '">' +
      '<span class="muscs-label">' + r.name + '</span>' +
      '<span class="muscs-track"><i style="width:' + pct + '%"></i></span>' +
      '<span class="muscs-n">' + r.n + '<span class="muscs-of">/10–20</span></span>' +
    '</div>';
  }).join('');
  return '<div class="card muscs-card"><div class="card-title">Hard sets by muscle</div>' +
    '<div class="card-sub">hard sets this week · target band 10–20</div>' +
    '<div class="muscs-list">' + body + '</div></div>';
}

/* --- 5. Load & recovery : ACWR gauge (indicative, not a diagnosis) --- */
function acwrCardHtml(sessions, today){
  const a = pAcwr(sessions, today);
  const zoneTxt = { optimal: 'optimal zone', high: 'high', danger: 'very high',
    low: 'low', unknown: 'not enough data' };
  const color = { optimal: 'var(--green)', high: 'var(--orange)', danger: 'var(--red)',
    low: 'var(--blue)', unknown: 'var(--muted)' }[a.zone];
  const ratio = a.ratio == null ? '—' : a.ratio.toFixed(2);
  return '<div class="card acwr-card"><div class="card-title">Load &amp; recovery</div>' +
    '<div class="acwr-main"><span class="acwr-val" style="color:' + color + '">' + ratio + '</span>' +
    '<span class="acwr-zone" style="color:' + color + '">' + zoneTxt[a.zone] + '</span></div>' +
    '<div class="acwr-bar" role="img" aria-label="ACWR ' + ratio + '">' +
      '<span class="acwr-fill" style="width:' +
      (a.ratio == null ? 0 : Math.min(100, Math.round((a.ratio / 1.6) * 100))) + '%;background:' + color + '"></span>' +
    '</div>' +
    '<div class="card-sub">acute 7 d: ' + a.acute + ' · chronic: ' + a.chronic +
      ' · indicative, not medical advice</div></div>';
}

/* --- 6. Body : smoothed weight (EMA) + kg/week slope + nutrition goal --- */
function bodyCardHtml(weights, sessions, today){
  const goal = pNutriGoal();
  const gtxt = goal.kcal > 0
    ? '<div class="card-sub">Nutrition goal: ' + Math.round(goal.kcal) + ' kcal/day' +
      (goal.type ? ' · ' + esc(goal.type) : '') + '</div>'
    : '<div class="card-sub">no Nutrition goal set</div>';
  if (weights.length < 2){
    return '<div class="card body-card"><div class="card-title">Body</div>' +
      dashHint('Add at least 2 weigh-ins to see the smoothed trend.') + gtxt + '</div>';
  }
  const w = pWeightTrend(weights);
  const pts = w.points.map(p => ({ date: p.date, v: p.v }));
  const cls = w.kgPerWeek > 0.02 ? 'up' : w.kgPerWeek < -0.02 ? 'down' : 'flat';
  return '<div class="card body-card"><div class="card-title">Body</div>' +
    '<div class="stats-grid body-cells" style="margin:0">' +
      '<div class="stat-box"><div class="stat-value">' + fmtNum(w.current) +
        '<span class="stat-unit">kg</span></div><div class="stat-label">smoothed weight</div></div>' +
      '<div class="stat-box"><div class="stat-value ' + cls + '">' +
        (w.kgPerWeek > 0 ? '+' : '') + w.kgPerWeek +
        '</div><div class="stat-label">kg / week</div></div>' +
    '</div>' +
    lineChart(pts, 'var(--blue)') + chartAxis(pts[0].date, pts[pts.length - 1].date) +
    '<div class="card-sub">exponential moving average (EMA) over ' + pts.length +
      ' weigh-ins — water/salt noise is filtered out</div>' + gtxt + '</div>';
}

/* ==================================================================
   POIDS CORPOREL
   ================================================================== */
function weightPoints(days){
  const from = days ? daysAgoISO(days) : '0000-00-00';
  return (DB.weightLog || []).filter(w => w.date >= from).slice().reverse();
}

function weightSparkHtml(pts){
  if (pts.length < 2){
    return '<div class="spark-empty">Add at least 2 weigh-ins to see the curve.</div>';
  }
  const kgs = pts.map(p => p.kg);
  const min = Math.min.apply(null, kgs), max = Math.max.apply(null, kgs);
  const span = (max - min) || 1;
  const coords = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * 100;
    const y = 28 - ((p.kg - min) / span) * 24;
    return { x: x, y: y, p: p };
  });
  const poly = coords.map(c => c.x.toFixed(1) + ',' + c.y.toFixed(1)).join(' ');
  const last = coords[coords.length - 1];
  return '<svg class="spark" viewBox="0 0 100 30" preserveAspectRatio="none" role="img" aria-label="Weight curve">' +
    '<polyline points="' + poly + '" fill="none" stroke="var(--blue)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>' +
    '<circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="2.4" fill="var(--blue)" stroke="var(--surface)" stroke-width="1" vector-effect="non-scaling-stroke"/>' +
  '</svg>';
}

function weightTodayKg(){
  const w = (DB.weightLog || []).find(x => x.date === todayISO());
  return w ? w.kg : null;
}

/* jours de pesée consécutive (aujourd'hui compté s'il est déjà noté, sinon on tolère "à faire") */
function weightStreak(){
  const dates = new Set((DB.weightLog || []).map(w => w.date));
  if (!dates.size) return 0;
  let n = 0;
  const d = new Date();
  if (!dates.has(isoOf(d))) d.setDate(d.getDate() - 1);
  while (dates.has(isoOf(d))){ n++; d.setDate(d.getDate() - 1); }
  return n;
}

/* variation sur N jours (dernière pesée vs pesée la plus ancienne ≥ N jours) */
function weightVar(days){
  const log = DB.weightLog || [];
  if (log.length < 2) return null;
  const older = log.find(w => w.date <= daysAgoISO(days));
  if (!older) return null;
  return Math.round((log[0].kg - older.kg) * 10) / 10;
}
function weightVarHtml(days){
  const v = weightVar(days);
  if (v == null) return '<span class="w-var">' + days + 'd <b class="flat">—</b></span>';
  const cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
  return '<span class="w-var">' + days + 'd <b class="' + cls + '">' + (v > 0 ? '+' : '') + fmtNum(v) + ' kg</b></span>';
}

function weightCardHtml(){
  const log = DB.weightLog || [];
  const last = log[0] || null;
  const prev = log[1] || null;
  const delta = (last && prev) ? Math.round((last.kg - prev.kg) * 10) / 10 : null;
  const pts = weightPoints(weightRange);
  const todayKg = weightTodayKg();
  const streak = weightStreak();
  const hasLog = log.length > 0;

  let deltaHtml = '';
  if (delta != null){
    const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    deltaHtml = '<span class="weight-delta ' + cls + '">' + (delta > 0 ? '+' : '') + fmtNum(delta) + ' kg</span>';
  }

  const ranges = [[30, '30d'], [90, '90d'], [365, '1y']].map(r =>
    '<button class="range-opt' + (weightRange === r[0] ? ' on' : '') + '" onclick="setWeightRange(' + r[0] + ')">' + r[1] + '</button>'
  ).join('');

  /* today state: done / due (+ day streak) */
  const todayHtml = todayKg != null
    ? '<div class="w-today ok"><span>' + iconS('check') + ' Today\'s weigh-in · ' + fmtNum(todayKg) + ' kg</span>' +
      (streak ? '<span class="w-streak">' + iconS('flame') + ' ' + streak + ' day' + (streak !== 1 ? 's' : '') + '</span>' : '') + '</div>'
    : '<div class="w-today todo"><span>' + (hasLog ? 'Today\'s weigh-in due' : 'First weigh-in of the day') + '</span>' +
      (streak ? '<span class="w-streak">' + iconS('flame') + ' ' + streak + ' day' + (streak > 1 ? 's' : ' to keep') + '</span>' : '') + '</div>';

  /* pré-rempli : poids du jour s'il existe, sinon dernier poids connu (ajuste et Noter) */
  const seedVal = todayKg != null ? todayKg : (hasLog ? last.kg : '');

  return '<div class="card weight-card">' +
    '<div class="card-header">' +
      '<div class="card-title">' + iconS('scale') + ' Body weight</div>' +
      '<div class="range-picker">' + ranges + '</div>' +
    '</div>' +
    '<div class="weight-main">' +
      (hasLog ? '<span class="weight-val">' + fmtNum(last.kg) + '<span class="weight-unit">kg</span></span>' +
                '<span class="weight-date">' + fmtShort(last.date) + '</span>' + deltaHtml
              : '<span class="weight-val dim">—</span><span class="weight-date">no weigh-in</span>') +
    '</div>' +
    '<div class="w-vars">' + weightVarHtml(7) + weightVarHtml(30) + '</div>' +
    weightSparkHtml(pts) +
    todayHtml +
    '<div class="row" style="margin-top:12px">' +
      '<div class="field" style="margin:0;flex:1">' +
        '<label class="label">Today\'s weight</label>' +
        '<div class="stepper">' +
          '<button type="button" onclick="stepWeightInput(-0.1)" aria-label="Minus 0.1 kg">−</button>' +
          '<input id="weightInputVal" type="number" inputmode="decimal" step="0.1" min="20" max="300" ' +
            'placeholder="kg" value="' + seedVal + '">' +
          '<span class="unit">kg</span>' +
          '<button type="button" onclick="stepWeightInput(0.1)" aria-label="Plus 0.1 kg">+</button>' +
        '</div>' +
      '</div>' +
      '<button class="btn btn-primary" style="flex:none;align-self:flex-end" onclick="logWeight()">' +
        (todayKg != null ? 'Update' : 'Log') + '</button>' +
    '</div>' +
  '</div>';
}

function stepWeightInput(d){
  const i = $('weightInputVal');
  if (!i) return;
  const base = parseFloat(i.value) || ((DB.weightLog || [])[0] || {}).kg || 75;
  let v = base + d;
  v = Math.min(300, Math.max(20, Math.round(v * 10) / 10));
  i.value = v;
}

function setWeightRange(days){
  weightRange = days;
  renderStats();
}

function logWeight(){
  const input = $('weightInputVal');
  if (!input) return;
  const raw = String(input.value || '').trim();
  if (!raw){ toast('Enter your weight with the + / −'); return; }
  const kg = Math.round((parseFloat(raw) || 0) * 10) / 10;
  if (kg < 20 || kg > 300){ toast('Enter a weight between 20 and 300 kg'); return; }
  const today = todayISO();
  const existing = (DB.weightLog || []).find(w => w.date === today);
  const wasNew = !existing;
  if (existing) existing.kg = kg;
  else DB.weightLog.unshift({ date: today, kg: kg });
  DB.weightLog.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  save();
  renderStats();
  const s = weightStreak();
  const suffix = s > 1 ? ' · ' + s + ' days' : '';
  toast((wasNew ? 'Today\'s weight logged' : 'Today\'s weigh-in updated') + suffix);
}

/* ==================================================================
   RENDU DE L'ONGLET
   ================================================================== */
function setStatsEx(key){ statEx = key; renderStats(); }
function setStatsPeriod(d){ statPeriod = d; renderStats(); }
function setStatsVol(d){ volRange = d; renderStats(); }
function setStatsMetric(m){ statMetric = m; renderStats(); }

function bindStats(){
  const root = $('statsContent');
  if (!root) return;
  root.querySelectorAll('[data-ex]').forEach(b => {
    b.onclick = () => setStatsEx(b.getAttribute('data-ex'));
  });
  root.querySelectorAll('[data-per]').forEach(b => {
    b.onclick = () => setStatsPeriod(+b.getAttribute('data-per'));
  });
  root.querySelectorAll('[data-vol]').forEach(b => {
    b.onclick = () => setStatsVol(+b.getAttribute('data-vol'));
  });
  root.querySelectorAll('[data-metric]').forEach(b => {
    b.onclick = () => setStatsMetric(b.getAttribute('data-metric'));
  });
}

function renderStats(){
  const history = DB.history || [];
  const list = statsExList();
  const prs = Object.keys(DB.prs || {}).length;

  $('statsRange').textContent = history.length
    ? 'Since ' + fmtShort(history[history.length - 1].date)
    : 'No sessions recorded';

  let html = '';
  if (!history.length && !prs){
    html += dashEmpty();
  } else {
    const ds = pDataset();
    const today = todayISO();
    html += insightsCardHtml(ds.sessions, ds.weights, today);
    html += weekCardHtml(ds.sessions, today);
    html += forceCardHtml(list, ds.sessions, today);
    html += perfCardHtml(list);
    html += progCardHtml(list);
    html += volCardHtml();
    html += muscleSetsCardHtml(ds.sessions, today);
    html += muscleCardHtml();
    html += acwrCardHtml(ds.sessions, today);
    html += bodyCardHtml(ds.weights, ds.sessions, today);
    html += prSectionHtml(list.length > 0);
  }

  /* cardio cumulé (compact, seulement s'il existe) */
  const ct = cardioInRange(0);
  if (ct.sorties){
    html += '<div class="card cardio-card">' +
      '<div class="card-title" style="margin-bottom:10px">' + iconS('run') + ' Cardio · total</div>' +
      '<div class="stats-grid" style="margin:0">' +
        '<div class="stat-box"><div class="stat-value" style="color:var(--blue)">' + fmtNum(ct.km) + '</div><div class="stat-label">km</div></div>' +
        '<div class="stat-box"><div class="stat-value" style="color:var(--green)">' + ct.min + '</div><div class="stat-label">minutes</div></div>' +
        '<div class="stat-box"><div class="stat-value" style="color:var(--primary)">' + ct.sorties + '</div><div class="stat-label">runs</div></div>' +
      '</div>' +
    '</div>';
  }

  html += weightCardHtml();

  if (DB.progressions.length){
    html += '<div class="card" style="margin-bottom:16px"><div class="card-title" style="margin-bottom:8px">Logged progressions</div>' +
      '<div class="card-sub">' + DB.progressions.length + ' entr' + (DB.progressions.length > 1 ? 'ies' : 'y') +
      ' · across ' + Object.keys(DB.weeks).length + ' week' + (Object.keys(DB.weeks).length !== 1 ? 's' : '') + '</div></div>';
  }

  /* Découpage par séance : clique pour ouvrir la séance dans Programme */
  const byDay = {};
  history.forEach(h => {
    const k = h.dayId || ('~' + h.dayName);
    if (!byDay[k]) byDay[k] = { name: h.dayName, dayId: h.dayId, n: 0, sets: 0, vol: 0, km: 0, holdSec: 0,
      live: !!h.dayId && window.getActiveProgrammeDays().some(d => d.id === h.dayId) };
    byDay[k].n++; byDay[k].sets += h.totalSets || 0; byDay[k].vol += h.volume || 0;
    byDay[k].km += h.cardioKm || 0; byDay[k].holdSec += h.holdSec || 0;
  });
  const rows = Object.values(byDay).sort((a, b) => b.n - a.n);
  if (rows.length){
    html += '<div class="section-title" style="font-size:.95rem;margin:18px 0 10px">By session</div>';
    html += rows.map(r =>
      '<div class="card' + (r.live ? ' tap' : '') + '"' + (r.live ? ' onclick="gotoDay(\'' + r.dayId + '\')"' : '') + '>' +
        '<div class="card-header"><div>' +
          '<div class="card-title">' + esc(r.name) + (r.live ? '' : ' <span class="chip chip-rest" style="margin-left:6px">deleted</span>') + '</div>' +
          '<div class="card-sub">' + r.n + ' session' + (r.n !== 1 ? 's' : '') + ' · ' + r.sets + ' line' + (r.sets !== 1 ? 's' : '') + (r.live ? ' · click to open' : '') + '</div>' +
        '</div>' +
        '<div style="text-align:right;font-weight:750;font-size:.9rem;color:var(--blue)">' +
          (r.vol ? fmtVolume(r.vol) : (r.km ? fmtNum(r.km) + ' km' : r.holdSec ? fmtNum(r.holdSec) + ' s' : '0')) +
          (r.vol && r.km ? '<div class="card-sub">' + fmtNum(r.km) + ' km</div>' : '') + '</div>' +
      '</div></div>'
    ).join('');
  }

  if (history.length){
    html += '<div class="section-title" style="font-size:.95rem;margin:18px 0 10px">Recent sessions</div>';
    html += history.slice(0, 6).map(h =>
      '<div class="hist-item tap" onclick="openSessionDetail(\'' + h.id + '\')">' +
        '<div class="hist-top"><div><div class="card-title">' + esc(h.dayName) + '</div>' +
        '<div class="card-sub">' + fmtShort(h.date) + ' · view details →</div></div>' +
        '<div class="hist-right"><div style="text-align:right"><div style="font-weight:750;font-size:.9rem">' + (h.totalSets || 0) + ' line' + ((h.totalSets || 0) !== 1 ? 's' : '') + '</div>' +
        '<div class="card-sub">' + (h.volume ? fmtVolume(h.volume) : (h.cardioKm ? fmtNum(h.cardioKm) + ' km' : (h.holdSec ? fmtNum(h.holdSec) + ' s hold' : '—'))) + '</div></div>' + histDelBtn(h) + '</div></div>' +
        (h.exercises || []).map(e =>
          '<div class="hist-ex"><b>' + esc(e.name) + '</b> — ' +
          e.sets.map(setShort).join(', ') +
          '</div>').join('') +
        (h.note ? '<div class="hist-note">' + icon('memo') + ' ' + esc(h.note) + '</div>' : '') +
      '</div>'
    ).join('');
  }

  $('statsContent').innerHTML = html;
  bindStats();
}

Object.assign(window, {
  openSessionDetail, histDelBtn, gotoDay, deleteHistoryEntry, renderStats,
  agoOf, setWeightRange, logWeight,
  stepWeightInput, weightStreak, weightTodayKg,
  setStatsEx, setStatsPeriod, setStatsVol, setStatsMetric,
  sharePrFromCard, muscleMap
});
