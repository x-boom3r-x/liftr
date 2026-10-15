/* ==================================================================
   LIFTR - programme, jours, bibliotheque d'exercices
   ================================================================== */
import { icon } from './icons.js';

let detailDayId = null;
let newDayType = 'PUSH';
let detailDayType = 'PUSH';

/* Cohérence des données liées */
function exoNameSet(day){
  return new Set(day.exercises.map(e => e.name.toLowerCase().trim()));
}
function othersHaveExo(name, excludeDayId){
  const k = name.toLowerCase().trim();
  return DB.programme.some(d => d.id !== excludeDayId && d.exercises.some(e => e.name.toLowerCase().trim() === k));
}
function dropExoRecords(name){
  const k = name.toLowerCase().trim();
  delete DB.prs[k];
  DB.progressions = DB.progressions.filter(p => p.exercise.toLowerCase().trim() !== k);
  if (Array.isArray(DB.prLog)) DB.prLog = DB.prLog.filter(l => l.key !== k);
}

/* ==================================================================
   PROGRAMME
   ================================================================== */
function typeChip(type){
  const t = (type || 'PUSH').toUpperCase();
  const cls = TYPES.includes(t) ? t.toLowerCase() : 'type';
  return '<span class="chip chip-' + cls + '">' + esc(t) + '</span>';
}

function renderProgramme(){
  const el = $('daysList');
  $('progCount').textContent = DB.programme.length + ' day' + (DB.programme.length !== 1 ? 's' : '') + ' in your program';
  if (!DB.programme.length){
    el.innerHTML = '<div class="empty"><div class="empty-icon">🗓️</div>' +
      '<div class="empty-text">No day created yet.<br>Start by adding a session (PUSH, PULL, LEGS…)</div></div>';
    return;
  }
  el.innerHTML = DB.programme.map((d, i) => {
    const past = DB.history.filter(h => h.dayId === d.id).length;
    return '<div class="card tap" onclick="openDayDetail(\'' + d.id + '\')">' +
      '<div class="card-header">' +
        '<div style="min-width:0">' +
          '<div class="card-title">' + esc(d.name) + '</div>' +
          '<div class="card-sub">' + d.exercises.length + ' exercise' + (d.exercises.length !== 1 ? 's' : '') +
            (d.exercises.length ? ' · ' + esc(d.exercises.slice(0,3).map(e => e.name).join(', ')) + (d.exercises.length > 3 ? '…' : '') : '') +
            (past ? ' · ' + past + ' past session' + (past > 1 ? 's' : '') : '') +
          '</div>' +
        '</div>' +
        '<div class="card-actions">' + typeChip(d.type) +
          '<span class="icon-btn" onclick="event.stopPropagation();shareProgramme()" ' +
          'title="Share program" aria-label="Share program">' + icon('share') + '</span>' +
          '<span class="icon-btn" onclick="event.stopPropagation();renamePrompt(\'' + d.id + '\')" title="Rename">' + icon('pencil') + '</span>' +
          '<span class="icon-btn danger" onclick="event.stopPropagation();deleteDay(\'' + d.id + '\')" title="Delete">' + icon('trash') + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function openNewDay(){
  newDayType = 'PUSH';
  $('dayNameInput').value = '';
  renderTypePicker('dayTypePicker', newDayType, t => { newDayType = t; });
  openModal('newDayModal');
  setTimeout(() => $('dayNameInput').focus(), 120);
}

/* H : partager le programme — ouvre le composer du Feed pré-rempli
   (attachement program, CTA « Import this program » côté réception) */
function shareProgramme(){
  const att = (typeof window.programAttachment === 'function') ? window.programAttachment() : null;
  if (!att){ toast('Add a program day first.'); return false; }
  return (typeof window.openShareComposer === 'function') && window.openShareComposer(att);
}

function renderTypePicker(elId, current, onPick){
  $(elId).innerHTML = TYPES.map(t =>
    '<button class="type-opt' + (t === current ? ' on' : '') + '" data-t="' + t + '">' + t + '</button>'
  ).join('');
  $(elId).querySelectorAll('.type-opt').forEach(b => b.onclick = () => {
    onPick(b.dataset.t);
    $(elId).querySelectorAll('.type-opt').forEach(x => x.classList.toggle('on', x.dataset.t === b.dataset.t));
  });
}

function saveNewDay(){
  const name = $('dayNameInput').value.trim();
  if (!name) { $('dayNameInput').focus(); return; }
  DB.programme.push({ id: uid(), name: name, type: newDayType, exercises: [] });
  save();
  closeModal('newDayModal');
  renderAll();
}

function renamePrompt(id){
  const d = DB.programme.find(x => x.id === id);
  if (!d) return;
  const v = prompt('New session name:', d.name);
  if (v && v.trim()) applyDayName(d, v.trim());
}

/* Renommer = même nom partout (stats + historique + calendrier) */
function applyDayName(day, name){
  day.name = name;
  DB.history.forEach(h => { if (h.dayId === day.id) h.dayName = name; });
  save(); renderAll();
}

function deleteDay(id){
  const d = DB.programme.find(x => x.id === id);
  if (!d) return;

  const sessions = DB.history.filter(h => h.dayId === id);
  const names = exoNameSet(d);
  const shared = new Set();
  DB.programme.filter(x => x.id !== id).forEach(x => x.exercises.forEach(e => shared.add(e.name.toLowerCase().trim())));
  const orphanPrs = Object.keys(DB.prs).filter(k => names.has(k) && !shared.has(k));
  const orphanProgs = DB.progressions.filter(p => names.has(p.exercise.toLowerCase().trim()) && !shared.has(p.exercise.toLowerCase().trim()));

  let msg = 'The session "' + d.name + '" and its ' + d.exercises.length + ' exercises will disappear from Program, Session and Calendar.';
  if (sessions.length) msg += '\n\nIts ' + sessions.length + ' past session(s) will also leave stats and the calendar (check below to keep them).';
  if (orphanPrs.length || orphanProgs.length) msg += '\n\nRecords deleted: ' + orphanPrs.length + '\nProgressions deleted: ' + orphanProgs.length + '\n(exercises absent from other sessions)';

  askConfirm('Delete the session?', msg, 'Delete',
    sessions.length ? 'Keep the past sessions in history and stats' : null)
  .then(res => {
    if (!res.ok) return;

    if (sessions.length && !res.check){
      DB.history = DB.history.filter(h => h.dayId !== id);
    } else {
      DB.history.forEach(h => { if (h.dayId === id) h.dayId = null; });
    }
    orphanPrs.forEach(k => delete DB.prs[k]);
    if (orphanPrs.length && Array.isArray(DB.prLog)){
      const drop = new Set(orphanPrs);
      DB.prLog = DB.prLog.filter(l => !drop.has(l.key));
    }
    if (orphanProgs.length){
      const drop = new Set(orphanProgs.map(p => p.id));
      DB.progressions = DB.progressions.filter(p => !drop.has(p.id));
    }

    DB.programme = DB.programme.filter(x => x.id !== id);
    if (DB.active && DB.active.dayId === id) DB.active = null;
    if (detailDayId === id){ detailDayId = null; closeModal('dayDetailModal'); }
    save(); renderAll();
  });
}
/* --- détail : rename + exercices --- */
function openDayDetail(id){
  const d = DB.programme.find(x => x.id === id);
  if (!d) return;
  detailDayId = id;
  detailDayType = d.type;
  $('dayTitleInput').value = d.name;
  renderTypePicker('detailTypePicker', detailDayType, t => { detailDayType = t; d.type = t; save(); renderProgramme(); });
  renderDayExercises();
  libFilter = 'Toutes'; libQuery = '';
  const s = $('libSearch'); if (s) s.value = '';
  renderLibrary();
  openModal('dayDetailModal');
}

function renameDay(){
  const d = DB.programme.find(x => x.id === detailDayId);
  const v = $('dayTitleInput').value.trim();
  if (!d || !v || d.name === v) return;
  applyDayName(d, v);
  $('dayTitleInput').blur();
}

function renderDayExercises(){
  const d = DB.programme.find(x => x.id === detailDayId);
  const el = $('dayExercises');
  if (!d) return;
  if (!d.exercises.length){
    el.innerHTML = '<div class="empty" style="padding:24px"><div class="empty-text">No exercises. Add some below.</div></div>';
    return;
  }
  el.innerHTML = d.exercises.map((e, i) =>
    '<div class="ex-block">' +
      '<div class="ex-name"><span>' + (i+1) + '. ' + esc(e.name) +
        (e.cardio ? ' <span class="chip chip-cardio">CARDIO</span>' : '') + '</span>' +
        '<span class="card-actions">' +
          '<span class="icon-btn' + (e.cardio ? ' on' : '') + '" onclick="toggleCardio(\'' + e.id + '\')" title="Cardio exercise (time / distance)">' + (e.cardio ? icon('run') : icon('flex')) + '</span>' +
          '<span class="icon-btn" onclick="renameExercise(\'' + e.id + '\')" title="Rename">' + icon('pencil') + '</span>' +
          '<span class="icon-btn danger" onclick="deleteExercise(\'' + e.id + '\')" title="Delete">' + icon('trash') + '</span>' +
        '</span>' +
      '</div>' +
      '<div class="card-sub">' + exerciseHistoryLine(e.name, e.cardio) + '</div>' +
    '</div>'
  ).join('');
}

/* basculer un exercice entre musculation (poids/reps) et cardio (durée/distance) */
function toggleCardio(exId){
  const d = DB.programme.find(x => x.id === detailDayId);
  const ex = d && d.exercises.find(x => x.id === exId);
  if (!ex) return;
  ex.cardio = !ex.cardio;
  save();
  renderDayExercises(); renderProgramme(); renderSeance();
  toast(ex.cardio ? '"' + ex.name + '" is now a cardio exercise' : '"' + ex.name + '" is back to lifting');
}

function exerciseHistoryLine(name, cardio){
  const key = name.toLowerCase();
  const isCardio = cardio || isCardioName(name);
  let best = null, count = 0, km = 0, min = 0;
  DB.history.forEach(h => (h.exercises || []).forEach(ex => {
    if (ex.name.toLowerCase() !== key) return;
    (ex.sets || []).forEach(s => {
      count++;
      if (s.cardio){ km += +s.km || 0; min += +s.min || 0; }
      else if (!best || s.weight > best.weight) best = s;
    });
  }));
  if (!count) return 'Never done yet';
  if (isCardio){
    return count + ' run' + (count !== 1 ? 's' : '') + ' logged' +
      ' · ' + fmtNum(km) + ' km · ' + Math.round(min) + ' min';
  }
  return count + ' sets logged' + (best ? ' · max ' + best.weight + ' kg × ' + best.reps + (best.assisted ? '+' + best.assisted + 'A' : '') : '');
}

/* ---------- bibliothèque d'exercices ---------- */
let libFilter = 'All';
let libQuery = '';

function libEntries(){
  const seen = new Set(), out = [];
  const push = (name, group, custom) => {
    const k = String(name).toLowerCase().trim();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ name: name, group: group, custom: !!custom });
  };
  Object.keys(LIB).forEach(g => LIB[g].forEach(n => push(n, g, false)));
  (DB.custom || []).forEach(n => push(n, 'Custom', true));
  return out;
}

function renderLibrary(){
  const d = DB.programme.find(x => x.id === detailDayId);
  const have = new Set((d ? d.exercises : []).map(e => e.name.toLowerCase()));
  const all = libEntries();
  const counts = {};
  all.forEach(e => counts[e.group] = (counts[e.group] || 0) + 1);

  const groups = ['All'].concat(Object.keys(LIB), counts['Custom'] ? ['Custom'] : []);
  $('libChips').innerHTML = groups.map(g => {
    const n = g === 'All' ? all.length : (counts[g] || 0);
    return '<button class="lib-chip' + (libFilter === g ? ' on' : '') + '" data-g="' + g + '">' +
      esc(g) + ' <span class="n">' + n + '</span></button>';
  }).join('');
  $('libChips').querySelectorAll('.lib-chip').forEach(b => b.onclick = () => { libFilter = b.dataset.g; renderLibrary(); });

  const q = libQuery.toLowerCase().trim();
  const list = all.filter(e =>
    (libFilter === 'All' || e.group === libFilter) &&
    (!q || e.name.toLowerCase().includes(q) || e.group.toLowerCase().includes(q))
  );

  $('libGrid').innerHTML = list.length
    ? list.map(e => {
        const on = have.has(e.name.toLowerCase());
        return '<button class="lib-item' + (on ? ' on' : '') + '" data-name="' + esc(e.name) + '">' +
          libThumb(e.name) +
          '<span>' + esc(e.name) + '<span class="grp">' + esc(e.group) + '</span></span>' +
          '<span class="lib-tick">' + (on ? icon('check') : '+') + '</span></button>';
      }).join('')
    : '<div class="lib-empty">No result.<br>Add it below, it will be kept under "Custom".</div>';
  $('libGrid').querySelectorAll('.lib-item').forEach(b => b.onclick = () => toggleLibExercise(b.dataset.name));

  const added = list.filter(e => have.has(e.name.toLowerCase())).length;
  $('libHint').textContent = list.length + ' exercise' + (list.length !== 1 ? 's' : '') +
    ' shown' + (added ? ' · ' + added + ' already in the session' : '');
}

function onLibSearch(v){
  libQuery = v;
  if (v.trim() && libFilter !== 'All') libFilter = 'All';
  renderLibrary();
}

function toggleLibExercise(name){
  const d = DB.programme.find(x => x.id === detailDayId);
  if (!d) return;
  const i = d.exercises.findIndex(e => e.name.toLowerCase() === name.toLowerCase());
  if (i >= 0) d.exercises.splice(i, 1);
  else d.exercises.push({ id: uid(), name: name, cardio: isCardioName(name) || undefined });
  save();
  renderDayExercises(); renderProgramme(); renderSeance(); renderLibrary();
}

function addExercise(){
  const input = $('exNameInput');
  const name = input.value.trim();
  const d = DB.programme.find(x => x.id === detailDayId);
  if (!name || !d) { input.focus(); return; }

  if (!d.exercises.some(e => e.name.toLowerCase() === name.toLowerCase())){
    const cardioChk = $('exCardioChk');
    const isCardio = (cardioChk && cardioChk.checked) || isCardioName(name);
    d.exercises.push({ id: uid(), name: name, cardio: isCardio || undefined });
    const known = libEntries().some(e => e.name.toLowerCase() === name.toLowerCase());
    if (!known){
      if (!DB.custom) DB.custom = [];
      if (!DB.custom.some(n => n.toLowerCase() === name.toLowerCase())) DB.custom.push(name);
    }
  }
  save();
  input.value = '';
  if ($('exCardioChk')) $('exCardioChk').checked = false;
  renderDayExercises(); renderProgramme(); renderSeance(); renderLibrary();
  input.focus();
}

function renameExercise(id){
  const d = DB.programme.find(x => x.id === detailDayId);
  const ex = d && d.exercises.find(x => x.id === id);
  if (!ex) return;
  const v = prompt('New exercise name:', ex.name);
  if (!v || !v.trim() || v.trim() === ex.name) return;
  const name = v.trim();
  const ok = ex.name.toLowerCase().trim();
  const nk = name.toLowerCase().trim();

  const otherDays = DB.programme.filter(p => p.id !== d.id && p.exercises.some(e => e.name.toLowerCase().trim() === ok));
  const apply = scopeAll => {
    const targets = scopeAll ? DB.programme : [d];
    const ids = new Set(targets.map(p => p.id));
    targets.forEach(p => p.exercises.forEach(e => { if (e.name.toLowerCase().trim() === ok) e.name = name; }));

    /* historique : uniquement les séances concernées */
    DB.history.forEach(h => {
      if (!scopeAll && !ids.has(h.dayId)) return;
      (h.exercises || []).forEach(e => { if (e.name.toLowerCase().trim() === ok) e.name = name; });
    });

    /* progressions + records : seulement si l'exercice est renommé partout */
    if (scopeAll){
      DB.progressions.forEach(p => { if (p.exercise.toLowerCase().trim() === ok) p.exercise = name; });
      if (DB.prs[ok]){
        DB.prs[nk] = Object.assign({}, DB.prs[ok], { name: name });
        if (nk !== ok) delete DB.prs[ok];
      }
      if (Array.isArray(DB.prLog)){
        DB.prLog.forEach(l => { if (l.key === ok){ l.key = nk; l.name = name; } });
      }
      if (DB.custom) DB.custom = DB.custom.filter(n => n.toLowerCase().trim() !== ok);
    }

    const known = libEntries().some(e => e.name.toLowerCase().trim() === nk);
    if (!known){ if (!DB.custom) DB.custom = []; if (!DB.custom.some(n => n.toLowerCase().trim() === nk)) DB.custom.push(name); }
    save(); renderAll();
  };

  if (otherDays.length){
    askConfirm('Rename the exercise?',
      '"' + ex.name + '" is also used in ' + otherDays.length + ' other session(s).\n' +
      'Renaming everywhere keeps history, progressions and records linked.',
      'Rename', 'Apply in the other sessions too')
      .then(res => { if (res.ok) apply(res.check); });
  } else apply(true);
}

function deleteExercise(id){
  const d = DB.programme.find(x => x.id === detailDayId);
  const ex = d && d.exercises.find(x => x.id === id);
  if (!ex) return;
  const k = ex.name.toLowerCase().trim();
  const shared = DB.programme.some(p => p.id !== d.id && p.exercises.some(e => e.name.toLowerCase().trim() === k));
  const hasPr = !!DB.prs[k];
  const nProg = DB.progressions.filter(p => p.exercise.toLowerCase().trim() === k).length;

  const doDelete = cleanup => {
    d.exercises = d.exercises.filter(x => x.id !== id);
    if (!shared && cleanup) dropExoRecords(ex.name);
    save();
    renderDayExercises(); renderProgramme(); renderSeance(); renderLibrary();
    renderStats(); renderCalendar();
  };

  if (!shared && (hasPr || nProg)){
    askConfirm('Delete the exercise?',
      '"' + ex.name + '" is only used by this session.\n' +
      'Records: ' + (hasPr ? 1 : 0) + ' · Progressions: ' + nProg,
      'Delete', 'Also delete its records and progressions')
      .then(res => { if (res.ok) doDelete(res.check); });
  } else doDelete(true);
}

function deleteCurrentDay(){
  if (!detailDayId) return;
  deleteDay(detailDayId);
}

Object.assign(window, {
  exoNameSet, othersHaveExo, dropExoRecords, typeChip, renderProgramme,
  openNewDay, renderTypePicker, saveNewDay, renamePrompt, applyDayName, deleteDay,
  openDayDetail, renameDay, renderDayExercises, exerciseHistoryLine, libEntries,
  renderLibrary, onLibSearch, toggleLibExercise, addExercise, renameExercise,
  deleteExercise, deleteCurrentDay, toggleCardio, shareProgramme
});
