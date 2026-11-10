/* ==================================================================
   LIFTR - programme, jours, bibliotheque d'exercices   ================================================================== */
import { icon } from './icons.js';
import {
  searchExercises,
  filterByMuscle,
  filterByEquipment,
  filterByCategory,
  getExercise,
  aliasFrToEn,
  aliasEnToFr,
  makeCustomExercise,
  getCatalogue,
  catalogueReady,
  loadCatalogue
} from './gym/exercises.js';
import {
  policyOff,
  policyLinear,
  policyGreyskull,
  policyDouble,
  policyTriple,
  policyTime,
  getPolicy,
  suggestNextWeight
} from './gym/progression.js';
import { computePlateCombination } from './gym/plates.js';

/* Démarre le chargement du catalogue openGym dès l'import du module. */
loadCatalogue();

let detailDayId = null;
let newDayType = 'PUSH';
let detailDayType = 'PUSH';
let activeProgramId = null; // ID du programme actuellement sélectionné

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

/* --- carte « Aujourd'hui » (modèle openGym) : plan du jour, suggestion,
       session en cours — reprend la couleur Liftr --- */
const MUSCLE_CHIP = {
  Chest: 'chip-push', Shoulders: 'chip-upper', Biceps: 'chip-pull',
  Triceps: 'chip-pull', Back: 'chip-pull', Legs: 'chip-legs',
  Glutes: 'chip-legs', Core: 'chip-rest', Cardio: 'chip-cardio'
};
function muscleChip(g){
  return '<span class="chip ' + (MUSCLE_CHIP[g] || 'chip-type') + '">' + esc(g) + '</span>';
}
function dayMuscles(day){
  const mm = (typeof window.muscleMap === 'function') ? muscleMap() : {};
  const out = [];
  (day.exercises || []).forEach(e => {
    const g = mm[String(e.name || '').toLowerCase().trim()];
    if (g && g !== 'Cardio' && out.indexOf(g) < 0) out.push(g);
  });
  return out;
}
function lastDoneOf(dayId){
  let last = null;
  (DB.history || []).forEach(h => {
    if (h.dayId === dayId && (!last || h.date > last)) last = h.date;
  });
  return last;
}
/* Retourne les journées du programme actif (ou tous les jours si pas de programme actif) */
function getActiveProgrammeDays(){
  const active = getActiveProgramme();
  if (!active) return DB.programme.filter(d => !d.programId);
  return DB.programme.filter(d => d.programId === active.id);
}

/* séance la moins récemment faite (ou jamais faite) */
function suggestDay(){
  const days = getActiveProgrammeDays();
  if (!days.length) return null;
  return days.slice().sort((a, b) => {
    const la = lastDoneOf(a.id) || '', lb = lastDoneOf(b.id) || '';
    return la < lb ? -1 : la > lb ? 1 : 0;
  })[0];
}

function todayCardEmpty(){
  return '<div class="today-empty">' +
    '<span class="te-ico" aria-hidden="true">🏋️</span>' +
    '<div class="te-txt"><div class="te-t">No session in your program yet</div>' +
    '<div class="te-s">Create a day (PUSH, PULL, LEGS…) and it shows up here.</div></div>' +
    '<button class="btn btn-primary btn-sm" onclick="openNewDay()">+ New day</button>' +
  '</div>';
}

function renderTodayCard(){
  const el = $('todayCard');
  if (!el) return;
  const days = getActiveProgrammeDays();
  if (!days.length){ el.innerHTML = todayCardEmpty(); return; }

  const iso = todayISO();
  const entry = (typeof window.planEntry === 'function') ? planEntry(iso) : null;
  const status = (typeof window.planStatus === 'function') ? planStatus(iso) : 'none';
  const planned = (entry && entry.dayId)
    ? days.find(d => d.id === entry.dayId) : null;

  /* 1. session en cours */
  if (DB.active){
    const a = DB.active;
    const sets = (a.exercises || []).reduce((n, e) => n + e.sets.length, 0);
    const mins = Math.max(1, Math.round((Date.now() - a.startedAt) / 60000));
    el.innerHTML = '<div class="today-card">' +
      '<div class="today-top"><div>' +
        '<div class="today-eyebrow"><span class="today-dot"></span>In progress</div>' +
        '<div class="today-name">' + esc(a.dayName) + '</div>' +
        '<div class="today-meta">' + mins + ' min · ' + sets + ' set' + (sets !== 1 ? 's' : '') +
          ' logged</div>' +
      '</div></div>' +
      '<div class="today-acts">' +
        '<button class="btn btn-primary btn-sm" onclick="resumeSession()">Resume</button>' +
        '<button class="btn btn-sm" onclick="showTab(\'seance\')">Session tab</button>' +
      '</div></div>';
    return;
  }

  /* 2. plan du jour : à faire */
  if (planned && status !== 'done' && status !== 'skip'){
    const mus = dayMuscles(planned);
    el.innerHTML = '<div class="today-card">' +
      '<div class="today-top"><div>' +
        '<div class="today-eyebrow"><span class="today-dot"></span>Today\'s plan</div>' +
        '<div class="today-name">' + esc(planned.name) + '</div>' +
        '<div class="today-meta">' + planned.exercises.length + ' exercise' +
          (planned.exercises.length !== 1 ? 's' : '') +
          (lastDoneOf(planned.id) ? ' · last done ' + fmtShort(lastDoneOf(planned.id)) : ' · never done') +
        '</div>' +
      '</div>' + typeChip(planned.type) + '</div>' +
      (mus.length ? '<div class="today-muscles">' + mus.map(muscleChip).join('') + '</div>' : '') +
      '<div class="today-acts">' +
        '<button class="btn btn-primary btn-sm" onclick="startSession(\'' + planned.id + '\')">Start session</button>' +
        '<button class="btn btn-sm" onclick="openDayDetail(\'' + planned.id + '\')">View</button>' +
      '</div></div>';
    return;
  }

  /* 3. plan du jour : fait */
  if (planned && status === 'done'){
    el.innerHTML = '<div class="today-card done">' +
      '<div class="today-top"><div>' +
        '<div class="today-eyebrow"><span class="today-dot"></span>Done today</div>' +
        '<div class="today-name">' + esc(planned.name) + '</div>' +
        '<div class="today-meta">Nice — recovery is programmed. See you tomorrow.</div>' +
      '</div>' + typeChip(planned.type) + '</div>' +
      '<div class="today-acts">' +
        '<button class="btn btn-sm" onclick="openDayDetail(\'' + planned.id + '\')">View session</button>' +
        '<button class="btn btn-sm" onclick="showTab(\'stats\')">Progress</button>' +
      '</div></div>';
    return;
  }

  /* 4. aucun plan : suggestion (séance la moins récente) */
  const sugg = suggestDay();
  if (!sugg){ el.innerHTML = todayCardEmpty(); return; }
  const mus = dayMuscles(sugg);
  const last = lastDoneOf(sugg.id);
  el.innerHTML = '<div class="today-card">' +
    '<div class="today-top"><div>' +
      '<div class="today-eyebrow"><span class="today-dot"></span>Suggested today</div>' +
      '<div class="today-name">' + esc(sugg.name) + '</div>' +
      '<div class="today-meta">' + sugg.exercises.length + ' exercise' +
        (sugg.exercises.length !== 1 ? 's' : '') +
        (last ? ' · last done ' + fmtShort(last) : ' · never done') + '</div>' +
    '</div>' + typeChip(sugg.type) + '</div>' +
    (mus.length ? '<div class="today-muscles">' + mus.map(muscleChip).join('') + '</div>' : '') +
    '<div class="today-acts">' +
      '<button class="btn btn-primary btn-sm" onclick="startSession(\'' + sugg.id + '\')">Start session</button>' +
      '<button class="btn btn-sm" onclick="openDayDetail(\'' + sugg.id + '\')">View</button>' +
    '</div></div>';
}

function renderProgramme(){
  const activeProg = getActiveProgramme();
  const el = $('daysList');
  const days = activeProg ? DB.programme.filter(d => d.programId === activeProg.id) : DB.programme.filter(d => !d.programId);
  $('progCount').textContent = days.length + ' day' + (days.length !== 1 ? 's' : '') + ' in your program';
  renderTodayCard();
  if (!days.length){
    el.innerHTML = '<div class="empty"><div class="empty-icon">🗓️</div>' +
      '<div class="empty-text">No day created yet.<br>Start by adding a session (PUSH, PULL, LEGS…)</div></div>';
    return;
  }
  el.innerHTML = days.map((d, i) => {
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

function openNewDay(programId){
  newDayType = 'PUSH';
  $('dayNameInput').value = '';
  renderTypePicker('dayTypePicker', newDayType, t => { newDayType = t; });
  const progSel = $('dayProgramSelector');
  if (progSel) renderProgramSelector('dayProgramSelector', programId || activeProgramId);
  openModal('newDayModal');
  setTimeout(() => $('dayNameInput').focus(), 120);
}

window.openNewDay = openNewDay;

/* H : partager le programme — ouvre le composer du Feed pré-rempli
   (attachement program, CTA « Import this program » côté réception) */
function shareProgramme(){
  const att = (typeof window.programAttachment === 'function') ? window.programAttachment() : null;
  if (!att){ toast('Add a program day first.'); return false; }
  return (typeof window.openShareComposer === 'function') && window.openShareComposer(att);
}

/* ==================================================================
   GESTION DES PROGRAMMES (Phase 2)
   ================================================================== */

/* Retourne le programme actuellement actif (ou le premier s'il n'y en a qu'un seul) */
function getActiveProgramme(){
  if (activeProgramId){
    const p = DB.programmes.find(x => x.id === activeProgramId);
    if (p) return p;
  }
  return DB.programmes.length ? DB.programmes[0] : null;
}

/* Définit le programme actif et persiste le choix */
function setActiveProgramme(id){
  const p = DB.programmes.find(x => x.id === id);
  if (!p) return;
  DB.programmes.forEach(x => { x.active = (x.id === id); });
  activeProgramId = id;
  save();
  renderProgramme();
  renderProgramsList();
}

/* Crée un nouveau programme */
function createProgramme(name, description){
  if (!name || !name.trim()) return null;
  const p = {
    id: uid(),
    name: name.trim(),
    description: (description || '').trim(),
    active: false,
    createdAt: new Date().toISOString().slice(0, 10),
    updatedAt: new Date().toISOString().slice(0, 10)
  };
  DB.programmes.push(p);
  setActiveProgramme(p.id);
  return p;
}

/* Renomme un programme */
function renameProgramme(id, name){
  const p = DB.programmes.find(x => x.id === id);
  if (!p || !name || !name.trim() || p.name === name.trim()) return false;
  p.name = name.trim();
  p.updatedAt = new Date().toISOString().slice(0, 10);
  save();
  renderProgramsList();
  renderProgramme();
  return true;
}

/* Met à jour la description d'un programme */
function updateProgrammeDescription(id, description){
  const p = DB.programmes.find(x => x.id === id);
  if (!p) return false;
  p.description = (description || '').trim();
  p.updatedAt = new Date().toISOString().slice(0, 10);
  save();
  renderProgramsList();
  return true;
}

/* Duplique un programme avec ses journées et exercices */
function duplicateProgramme(id){
  const src = DB.programmes.find(x => x.id === id);
  if (!src) return null;
  const newProg = {
    id: uid(),
    name: src.name + ' (copie)',
    description: src.description,
    active: false,
    createdAt: new Date().toISOString().slice(0, 10),
    updatedAt: new Date().toISOString().slice(0, 10)
  };
  DB.programmes.push(newProg);
  const dayMap = new Map();
  DB.programme.filter(d => d.programId === id).forEach(d => {
    const newDay = {
      id: uid(),
      programId: newProg.id,
      name: d.name,
      type: d.type,
      exercises: d.exercises.map(e => ({ id: uid(), name: e.name, cardio: e.cardio }))
    };
    DB.programme.push(newDay);
    dayMap.set(d.id, newDay.id);
  });
  save();
  renderProgramsList();
  renderProgramme();
  return newProg;
}

/* Supprime un programme avec confirmation */
function deleteProgramme(id){
  const p = DB.programmes.find(x => x.id === id);
  if (!p) return;

  const days = DB.programme.filter(d => d.programId === id);
  const totalSets = days.reduce((n, d) => n + d.exercises.reduce((m, e) => m + e.sets.length, 0), 0);

  if (DB.programmes.length <= 1){
    toast('Impossible de supprimer le dernier programme.');
    return;
  }

  askConfirm('Supprimer le programme ?',
    '"' + p.name + '" et ses ' + days.length + ' journée(s) seront supprimés.' +
    (totalSets ? ' · ' + totalSets + ' série(s) au total.' : '') +
    '\n\nLes séances passées liées à ces journées seront conservées dans l\'historique.',
    'Supprimer', 'Annuler').then(res => {
    if (!res.ok) return;
    DB.programme.filter(d => d.programId === id).forEach(d => { d.programId = null; });
    DB.programmes = DB.programmes.filter(x => x.id !== id);
    if (activeProgramId === id){
      const remaining = DB.programmes[0];
      if (remaining) setActiveProgramme(remaining.id);
      else { activeProgramId = null; renderProgramme(); renderProgramsList(); }
    } else {
      save();
      renderProgramsList();
      renderProgramme();
    }
  });
}
  $(elId).innerHTML = TYPES.map(t =>
/* Rend la liste des programmes (puces de sélection) */
function renderProgramsList(){
  const el = $('programsList');
  if (!el) return;
  if (!DB.programmes.length){
    el.innerHTML = '<div class="empty" style="padding:20px"><div class="empty-text">Aucun programme. Créez-en un pour commencer.</div></div>';
    return;
  }
  el.innerHTML = DB.programmes.map(p => {
    const days = DB.programme.filter(d => d.programId === p.id).length;
    const isActive = p.id === activeProgramId;
    return '<div class="program-item' + (isActive ? ' active' : '') + '" onclick="setActiveProgramme(\'' + p.id + '\')">' +
      '<div class="program-header">' +
      '<span class="program-name" onclick="event.stopPropagation();editProgrammeName(\'' + p.id + '\')">' + esc(p.name) + '</span>' +
      (isActive ? '<span class="chip chip-type">Actif</span>' : '') +
      '</div>' +
      (p.description ? '<div class="program-desc">' + esc(p.description) + '</div>' : '') +
      '<div class="program-meta">' + days + ' journée' + (days !== 1 ? 's' : '') +
      ' · créé le ' + esc(p.createdAt) + '</div>' +
      '<div class="program-actions" style="margin-top:8px">' +
      '<span class="icon-btn" onclick="event.stopPropagation();duplicateProgramme(\'' + p.id + '\')" title="Dupliquer">' + icon('copy') + '</span>' +
      '<span class="icon-btn danger" onclick="event.stopPropagation();deleteProgramme(\'' + p.id + '\')" title="Supprimer">' + icon('trash') + '</span>' +
      '</div>' +
      '</div>';
  }).join('');
}

/* Ouvre le formulaire de création/modification de programme */
function openProgrammeEditor(id){
  const p = id ? DB.programmes.find(x => x.id === id) : null;
  $('progNameInput').value = p ? p.name : '';
  $('progDescInput').value = p ? (p.description || '') : '';
  $('progEditorId').value = p ? p.id : '';
  $('progEditorTitle').textContent = p ? 'Modifier le programme' : 'Nouveau programme';
  openModal('programmeEditorModal');
}

/* Sauvegarde depuis l'éditeur de programme */
function saveProgrammeEditor(){
  const id = $('progEditorId').value;
  const name = $('progNameInput').value.trim();
  const desc = $('progDescInput').value.trim();
  if (!name) { $('progNameInput').focus(); return; }
  if (id){
    renameProgramme(id, name);
    updateProgrammeDescription(id, desc);
  } else {
    createProgramme(name, desc);
  }
  closeModal('programmeEditorModal');
}

/* Ouvre l'édition du nom d'un programme en ligne */
function editProgrammeName(id){
  const p = DB.programmes.find(x => x.id === id);
  if (!p) return;
  const v = prompt('Nom du programme :', p.name);
  if (v && v.trim() && v.trim() !== p.name) renameProgramme(id, v.trim());
}

/* Rend la vue détaillée d'un programme avec ses journées */
function renderProgramView(programId){
  const p = DB.programmes.find(x => x.id === programId);
  if (!p) return;
  const days = DB.programme.filter(d => d.programId === programId);
  const el = $('programView');
  if (!el) return;
  el.innerHTML = '<div class="section-head">' +
    '<div>' +
    '<div class="section-title">' + esc(p.name) + '</div>' +
    '<div class="section-hint">' + (p.description || 'Aucune description') + ' · ' + days + ' journée' + (days !== 1 ? 's' : '') + '</div>' +
    '</div>' +
    '<button class="btn btn-primary btn-sm" onclick="openProgrammeEditor(\'' + p.id + '\')">Modifier</button>' +
    '<button class="btn btn-sm" onclick="openNewDay(\'' + p.id + '\')">+ Nouvelle journée</button>' +
    '</div>' +
    '<div id="programDaysList"></div>';
  const daysEl = $('programDaysList');
  if (!daysEl) return;
  if (!days.length){
    daysEl.innerHTML = '<div class="empty" style="padding:20px"><div class="empty-text">Aucune journée. Ajoutez-en une pour commencer.</div></div>';
    return;
  }
  daysEl.innerHTML = days.map(d => {
    const past = DB.history.filter(h => h.dayId === d.id).length;
    return '<div class="card tap" onclick="openDayDetail(\'' + d.id + '\')">' +
      '<div class="card-header">' +
      '<div style="min-width:0">' +
      '<div class="card-title">' + esc(d.name) + '</div>' +
      '<div class="card-sub">' + d.exercises.length + ' exercice' + (d.exercises.length !== 1 ? 's' : '') +
      (past ? ' · ' + past + ' séance(s) passée(s)' : '') + '</div>' +
      '</div>' + typeChip(d.type) +
      '</div>' +
      '</div>';
  }).join('');
}

/* Rend le sélecteur de programme pour openNewDay */
function renderProgramSelector(elId, selectedId){
  const el = $(elId);
  if (!el) return;
  el.innerHTML = DB.programmes.map(p => {
    const isSelected = p.id === selectedId;
    return '<option value="' + p.id + '"' + (isSelected ? ' selected' : '') + '>' + esc(p.name) + '</option>';
  }).join('');
}

/* Crée une journée dans un programme spécifique */
function saveNewDayInProgram(programId){
  const name = $('dayNameInput').value.trim();
  if (!name) { $('dayNameInput').focus(); return; }
  const type = newDayType;
  DB.programme.push({ id: uid(), programId: programId || null, name: name, type: type, exercises: [] });
  save();
  closeModal('newDayModal');
  renderProgramme();
  renderProgramsList();
}
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
  const progSel = $('dayProgramSelector');
  const programId = progSel ? progSel.value : activeProgramId;
  if (programId){
    saveNewDayInProgram(programId);
  } else {
    DB.programme.push({ id: uid(), name: name, type: newDayType, exercises: [] });
    save();
    closeModal('newDayModal');
    renderAll();
  }
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
  /* Privilégie le catalogue openGym quand il est chargé, sinon fallback LIB legacy. */
  const cat = getCatalogue();
  if (cat.length){
    cat.forEach(ex => push(ex.name, (ex.bodyPart || 'Autre').replace(/\b\w/g, c => c.toUpperCase()), ex.category === 'custom'));
  } else {
    Object.keys(LIB).forEach(g => LIB[g].forEach(n => push(n, g, false)));
  }
  (DB.custom || []).forEach(n => push(n, 'Custom', true));
  return out;
}

function renderLibrary(){
  const d = DB.programme.find(x => x.id === detailDayId);
  const have = new Set((d ? d.exercises : []).map(e => e.name.toLowerCase()));
  const all = libEntries();
  const counts = {};
  all.forEach(e => counts[e.group] = (counts[e.group] || 0) + 1);

  const catGroups = [...new Set((getCatalogue() || []).map(e => e.bodyPart).filter(Boolean))].sort();
  const groups = ['All'].concat(catGroups, counts['Custom'] ? ['Custom'] : []);
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

/* ajout/retrait direct depuis l'écran Library (pas de modale ouverte) */
function libAddToDay(dayId, name){
  const d = DB.programme.find(x => x.id === dayId);
  if (!d) return;
  const i = d.exercises.findIndex(e => e.name.toLowerCase() === name.toLowerCase());
  if (i >= 0){
    d.exercises.splice(i, 1);
    toast('Removed from "' + d.name + '"');
  } else {
    d.exercises.push({ id: uid(), name: name, cardio: isCardioName(name) || undefined });
    toast('Added to "' + d.name + '"');
  }
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

/* ── PARAMÈTRES D'EXERCICE DANS UNE JOURNÉE ── */
function getExerciseParams(ex){
  return {
    sets: ex.sets ?? null,
    reps: ex.reps ?? null,
    weight: ex.weight ?? null,
    rest: ex.rest ?? null,
    notes: ex.notes ?? ''
  };
}

function setExerciseParams(ex, data){
  if (data.sets !== undefined) ex.sets = data.sets;
  if (data.reps !== undefined) ex.reps = data.reps;
  if (data.weight !== undefined) ex.weight = data.weight;
  if (data.rest !== undefined) ex.rest = data.rest;
  if (data.notes !== undefined) ex.notes = data.notes;
  save();
  renderDayExercises();
  renderProgramme();
  renderSeance();
}

function deleteCurrentDay(){
  if (!detailDayId) return;
  deleteDay(detailDayId);
}

Object.assign(window, {
  exoNameSet, othersHaveExo, dropExoRecords, typeChip, renderProgramme,
  renderTodayCard, dayMuscles, suggestDay, muscleChip,
  openNewDay, renderTypePicker, saveNewDay, renamePrompt, applyDayName, deleteDay,
  openDayDetail, renameDay, renderDayExercises, exerciseHistoryLine, libEntries,
  renderLibrary, onLibSearch, toggleLibExercise, libAddToDay, addExercise, renameExercise,
  deleteExercise, deleteCurrentDay, toggleCardio, shareProgramme,
  getActiveProgramme, setActiveProgramme, createProgramme, renameProgramme,
  updateProgrammeDescription, duplicateProgramme, deleteProgramme,
  renderProgramsList, openProgrammeEditor, saveProgrammeEditor, editProgrammeName,
  renderProgramView, renderProgramSelector, saveNewDayInProgram
});

function initExerciseDrag(){
  document.querySelectorAll('.ex-block').forEach(block => {
    block.draggable = true;
    block.addEventListener('dragstart', e => {
      const exId = block.dataset.exId;
      if (!exId) return;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', exId);
      block.style.opacity = '0.5';
      dragExId = exId;
    });
    block.addEventListener('dragend', e => {
      block.style.opacity = '1';
      dragExId = null;
    });
  });

  document.querySelectorAll('.ex-block').forEach(block => {
    block.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      block.classList.add('drag-over');
    });
    block.addEventListener('dragleave', e => {
      if (e.target.closest('.ex-block')) block.classList.remove('drag-over');
    });
    block.addEventListener('drop', e => {
      e.preventDefault();
      block.classList.remove('drag-over');
      const srcId = e.dataTransfer.getData('text/plain');
      const exId = block.dataset.exId;
      if (!srcId || srcId === exId) return;
      const d = DB.programme.find(x => x.id === detailDayId);
      if (!d || !srcId) return;
      const srcIdx = d.exercises.findIndex(e => e.id === srcId);
      const tgtIdx = d.exercises.findIndex(e => e.id === exId);
      if (srcIdx < 0 || tgtIdx < 0) return;
      const ex = d.exercises.splice(srcIdx, 1)[0];
      d.exercises.splice(tgtIdx, 0, ex);
      d.exercises.forEach((e, i) => { e.order = i; });
      save();
      renderDayExercises();
      renderProgramme();
      renderSeance();
    });
  });
}

function getExerciseParams(ex){
  return {
    sets: ex.sets ?? null,
    reps: ex.reps ?? null,
    weight: ex.weight ?? null,
    rest: ex.rest ?? null,
    notes: ex.notes ?? ''
  };
}

function setExerciseParams(ex, data){
  if (data.sets !== undefined) ex.sets = data.sets;
  if (data.reps !== undefined) ex.reps = data.reps;
  if (data.weight !== undefined) ex.weight = data.weight;
  if (data.rest !== undefined) ex.rest = data.rest;
  if (data.notes !== undefined) ex.notes = data.notes;
  save();
  renderDayExercises();
  renderProgramme();
  renderSeance();
}

function exerciseParamsLine(ex){
  const p = getExerciseParams(ex);
  const parts = [];
  if (p.sets !== null && p.sets > 0) parts.push(p.sets + '×');
  if (p.reps !== null && p.reps !== undefined) parts.push(p.reps);
  if (p.weight !== null && p.weight !== undefined) parts.push(p.weight + ' kg');
  if (p.rest !== null && p.rest !== undefined) parts.push(p.rest + 's repos');
  if (p.notes) parts.push('· ' + p.notes);
  return parts.join(' · ') || 'Paramètres non définis';
}

function addDayExercise(dayId, name, setParams = {}){
  const d = DB.programme.find(x => x.id === dayId);
  if (!d) return null;
  if (d.exercises.some(e => e.name.toLowerCase().trim() === name.toLowerCase().trim())){
    toast('Cet exercice existe déjà dans cette journée.');
    return null;
  }
  const exercise = {
    id: uid(),
    name: name,
    sets: setParams.sets ?? null,
    reps: setParams.reps ?? null,
    weight: setParams.weight ?? null,
    rest: setParams.rest ?? null,
    notes: setParams.notes ?? '',
    order: d.exercises.length
  };
  d.exercises.push(exercise);
  d.exercises.sort((a, b) => (a.order || 0) - (b.order || 0));
  save();
  renderDayExercises();
  renderProgramme();
  renderSeance();
  return exercise;
}

function deleteDayExercise(dayId, exId){
  const d = DB.programme.find(x => x.id === dayId);
  if (!d) return;
  const idx = d.exercises.findIndex(e => e.id === exId);
  if (idx < 0) return;
  d.exercises.splice(idx, 1);
  d.exercises.forEach((e, i) => { e.order = i; });
  save();
  renderDayExercises();
  renderProgramme();
  renderSeance();
}

/* ── MODÈLES DE ROUTINES ── */
function saveDayTemplate(dayId, templateName){
  const d = DB.programme.find(x => x.id === dayId);
  if (!d) return;
  const templates = DB.customTemplates || [];
  const t = {
    id: uid(),
    name: templateName,
    dayId: d.id,
    dayName: d.name,
    exercises: d.exercises.map(e => getExerciseState(e)),
    createdAt: new Date().toISOString()
  };
  templates.push(t);
  localStorage.setItem('liftr_dayTemplates', JSON.stringify(templates));
  toast('Modèle enregistré');
}

function loadDayTemplates(){
  try {
    const s = localStorage.getItem('liftr_dayTemplates');
    return s ? JSON.parse(s) : [];
  } catch { return []; }
}

function deleteDayTemplate(id){
  const templates = DB.customTemplates || [];
  DB.customTemplates = templates.filter(t => t.id !== id);
  localStorage.setItem('liftr_dayTemplates', JSON.stringify(DB.customTemplates));
  toast('Modèle supprimé');
}

function importDayFromTemplate(template){
  const d = DB.programme.find(x => x.id === template.dayId);
  if (!d) return;
  d.name = template.dayName;
  d.exercises = template.exercises.map(e => ({
    id: e.id,
    name: e.name,
    order: e.order,
    sets: e.sets,
    reps: e.reps,
    weight: e.weight,
    rest: e.rest,
    notes: e.notes
  }));
  save();
  renderDayExercises();
  renderProgramme();
  renderSeance();
  toast('Routine importée');
}