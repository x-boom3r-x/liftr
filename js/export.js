/* ==================================================================
   LIFTR - export CSV par intervalle (stats, séances, records, poids)
   ================================================================== */

let exportPreset = 7; /* 7 | 30 | 90 | 0 (tout) | -1 (perso) */

function exportRange(){
  const to = todayISO();
  if (exportPreset === -1){
    const a = ($('expFrom') && $('expFrom').value) || '0000-01-01';
    const b = ($('expTo') && $('expTo').value) || to;
    return a <= b ? { from: a, to: b } : { from: b, to: a };
  }
  if (exportPreset === 0) return { from: '0000-01-01', to: to };
  const d = new Date();
  d.setDate(d.getDate() - (exportPreset - 1));
  return { from: isoOf(d), to: to };
}

function statsInRange(from, to){
  const hist = DB.history.filter(h => h.date >= from && h.date <= to);
  const prs = (DB.prLog || []).filter(p => p.date >= from && p.date <= to);
  const w = (DB.weightLog || []).filter(x => x.date >= from && x.date <= to);
  const progs = DB.progressions.filter(p => p.date >= from && p.date <= to);
  let sets = 0, vol = 0, km = 0, min = 0, cardioLines = 0;
  hist.forEach(h => {
    sets += h.totalSets || 0;
    vol += h.volume || 0;
    km += h.cardioKm || 0;
    min += h.cardioMin || 0;
    (h.exercises || []).forEach(e => (e.sets || []).forEach(s => { if (s.cardio) cardioLines++; }));
  });
  return { hist: hist, prs: prs, w: w, progs: progs, sets: sets, vol: vol, km: km, min: min, cardioLines: cardioLines };
}

function csvCell(v){
  const s = v == null ? '' : String(v);
  return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvLine(cells){
  return cells.map(csvCell).join(';');
}

function buildStatsCSV(from, to){
  const st = statsInRange(from, to);
  const L = [];
  const sect = name => { L.push(''); L.push(name); };

  L.push('LIFTR - EXPORT');
  L.push(csvLine(['Period', fmtShort(from), fmtShort(to)]));

  sect('SUMMARY');
  L.push(csvLine(['Sessions', st.hist.length]));
  L.push(csvLine(['Work lines', st.sets]));
  L.push(csvLine(['Total volume (kg)', st.vol]));
  L.push(csvLine(['Records broken', st.prs.length]));
  L.push(csvLine(['Cardio lines', st.cardioLines]));
  L.push(csvLine(['Cardio (km)', fmtNum(st.km)]));
  L.push(csvLine(['Cardio (min)', st.min]));
  L.push(csvLine(['Weigh-ins', st.w.length]));
  L.push(csvLine(['Progressions', st.progs.length]));
  const wSorted = st.w.slice().sort((a, b) => (a.date > b.date ? 1 : a.date < b.date ? -1 : 0));
  if (wSorted.length){
    L.push(csvLine(['Starting weight (kg)', fmtNum(wSorted[0].kg)]));
    L.push(csvLine(['Ending weight (kg)', fmtNum(wSorted[wSorted.length - 1].kg)]));
    L.push(csvLine(['Change (kg)', fmtNum(wSorted[wSorted.length - 1].kg - wSorted[0].kg)]));
  }

  if (st.hist.length){
    sect('SESSIONS');
    L.push(csvLine(['Date', 'Day', 'Lines', 'Volume (kg)', 'Cardio (km)', 'Cardio (min)', 'Note']));
    st.hist.forEach(h => L.push(csvLine([
      h.date, h.dayName, h.totalSets || 0, h.volume || 0,
      fmtNum(h.cardioKm || 0), h.cardioMin || 0, h.note || ''
    ])));
  }

  const anySets = st.hist.some(h => (h.exercises || []).some(e => (e.sets || []).length));
  if (anySets){
    sect('SETS');
    L.push(csvLine(['Date', 'Day', 'Exercise', 'Type', 'Detail', 'Weight (kg)', 'Reps', 'Assisted']));
    st.hist.forEach(h => (h.exercises || []).forEach(e => (e.sets || []).forEach(s => {
      L.push(csvLine([
        h.date, h.dayName, e.name, e.cardio ? 'CARDIO' : 'STRENGTH',
        setShort(s),
        s.cardio ? '' : s.weight, s.cardio ? '' : s.reps, s.cardio ? '' : (s.assisted || 0)
      ]));
    })));
  }

  if (st.prs.length){
    sect('RECORDS');
    L.push(csvLine(['Date', 'Exercise', 'Weight (kg)', 'Reps', 'Assisted', 'Previous']));
    st.prs.forEach(p => L.push(csvLine([
      p.date, p.name, p.weight, p.reps, p.assisted || 0, p.prev == null ? '' : p.prev
    ])));
  }

  if (wSorted.length){
    sect('WEIGHT');
    L.push(csvLine(['Date', 'Weight (kg)']));
    wSorted.forEach(w2 => L.push(csvLine([w2.date, fmtNum(w2.kg)])));
  }

  if (st.progs.length){
    sect('PROGRESSIONS');
    L.push(csvLine(['Date', 'Exercise', 'Weight (kg)', 'Reps', 'Assisted', 'Note']));
    st.progs.forEach(p => L.push(csvLine([
      p.date, p.exercise, p.weight, p.reps, p.assisted || 0, p.note || ''
    ])));
  }

  return L.join('\r\n') + '\r\n';
}

function updateExportPreview(){
  const box = $('exportPreview');
  if (!box) return;
  const r = exportRange();
  const st = statsInRange(r.from, r.to);
  const row = (k, v) => '<div class="ep-row"><span>' + k + '</span><b>' + v + '</b></div>';
  box.innerHTML = '<div class="ep-head">Preview · ' + fmtShort(r.from) + ' → ' + fmtShort(r.to) + '</div>' +
    row('Sessions', st.hist.length) +
    row('Work lines', st.sets) +
    row('Records', st.prs.length) +
    row('Cardio lines', st.km ? fmtNum(st.km) + ' km · ' + st.min + ' min' : 0) +
    row('Weigh-ins', st.w.length) +
    row('Progressions', st.progs.length);
}

function setExportPreset(p, btn){
  exportPreset = p;
  const modal = $('exportModal');
  if (modal){
    const opts = modal.querySelectorAll('.type-opt');
    if (!btn && p !== -1){
      const idx = [7, 30, 90, 0, -1].indexOf(p);
      if (idx >= 0 && opts[idx]) btn = opts[idx];
    }
    opts.forEach(b => b.classList.remove('on'));
    if (btn) btn.classList.add('on');
  }
  const custom = $('exportCustom');
  if (custom) custom.hidden = p !== -1;
  if (p === -1){
    const from = $('expFrom'), to = $('expTo');
    if (from && !from.value){ const d = new Date(); d.setDate(d.getDate() - 29); from.value = isoOf(d); }
    if (to && !to.value) to.value = todayISO();
  }
  updateExportPreview();
}

function openExport(){
  const hasData = DB.history.length || (DB.prLog || []).length ||
    (DB.weightLog || []).length || DB.progressions.length;
  if (!hasData){ toast('No data to export yet'); return; }
  setExportPreset(exportPreset === -1 ? -1 : 7, null);
  openModal('exportModal');
}

function exportStatsCSV(){
  const r = exportRange();
  const csv = buildStatsCSV(r.from, r.to);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'liftr-stats_' + r.from + '_' + r.to + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  closeModal('exportModal');
  toast('CSV downloaded');
}

Object.assign(window, {
  openExport, setExportPreset, updateExportPreview, exportStatsCSV,
  buildStatsCSV, statsInRange, exportRange
});
