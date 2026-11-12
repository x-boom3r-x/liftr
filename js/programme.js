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
  loadCatalogue,
  exerciseGroupLabel
} from './gym/exercises.js';
import { computePlateCombination } from './gym/plates.js';
import { repSequenceOf } from './gym/progression.js';

/* Démarre le chargement du catalogue openGym dès l'import du module. */
loadCatalogue();

let detailDayId = null;
let activeProgramId = null; // ID du programme actuellement sélectionné
let dragExId = null;
let selectedDayExerciseIds = new Set();

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
  return DB.programme
    .map((day, index) => ({ day, index }))
    .filter(x => x.day.programId === active.id)
    .sort((a, b) => (+a.day.order || 0) - (+b.day.order || 0) || a.index - b.index)
    .map(x => x.day);
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
      '</div></div>' +
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
      '</div></div>' +
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
    '</div></div>' +
    (mus.length ? '<div class="today-muscles">' + mus.map(muscleChip).join('') + '</div>' : '') +
    '<div class="today-acts">' +
      '<button class="btn btn-primary btn-sm" onclick="startSession(\'' + sugg.id + '\')">Start session</button>' +
      '<button class="btn btn-sm" onclick="openDayDetail(\'' + sugg.id + '\')">View</button>' +
    '</div></div>';
}

function renderProgramme(){
  const el = $('daysList');
  const activeProg = getActiveProgramme();
  const days = getActiveProgrammeDays();
  if (activeProg) activeProgramId = activeProg.id;
  $('progCount').textContent = days.length + ' day' + (days.length !== 1 ? 's' : '') + ' in your program';
  renderTodayCard();
  renderProgramsList();
  if (!days.length){
    el.innerHTML = '<div class="empty"><div class="empty-icon">🗓️</div>' +
      '<div class="empty-text">No day created yet.<br>Start by adding a session (PUSH, PULL, LEGS…)</div>' +
      '<button type="button" class="btn btn-primary btn-sm" onclick="openNewDay(\'' + (activeProg ? activeProg.id : '') + '\')">+ Add your first day</button></div>';
    return;
  }
  el.innerHTML = days.map((d, i) => {
    const past = DB.history.filter(h => h.dayId === d.id).length;
    const id = esc(d.id);
    return '<div class="card tap programme-day" data-day-id="' + id + '" onclick="openDayDetail(\'' + id + '\')">' +
      '<div class="card-header">' +
        '<div style="min-width:0">' +
          '<div class="card-title">' + esc(d.name) + '</div>' +
          '<div class="card-sub">' + d.exercises.length + ' exercise' + (d.exercises.length !== 1 ? 's' : '') +
            (d.exercises.length ? ' · ' + esc(d.exercises.slice(0,3).map(e => e.name).join(', ')) + (d.exercises.length > 3 ? '…' : '') : '') +
            (past ? ' · ' + past + ' past session' + (past > 1 ? 's' : '') : '') +
          '</div>' +
        '</div>' +
        '<div class="card-actions">' +
          '<button type="button" class="icon-btn day-drag-handle" draggable="true" onclick="event.stopPropagation()" aria-label="Réordonner ' + esc(d.name) + '" title="Réordonner">↕</button>' +
          '<button type="button" class="icon-btn" onclick="event.stopPropagation();moveProgrammeDay(\'' + id + '\',-1)" aria-label="Monter ' + esc(d.name) + '" title="Monter"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" class="icon-btn" onclick="event.stopPropagation();moveProgrammeDay(\'' + id + '\',1)" aria-label="Descendre ' + esc(d.name) + '" title="Descendre"' + (i === days.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<span class="icon-btn" onclick="event.stopPropagation();shareProgramme()" ' +
          'title="Share program" aria-label="Share program">' + icon('share') + '</span>' +
          '<span class="icon-btn" onclick="event.stopPropagation();renamePrompt(\'' + d.id + '\')" title="Rename">' + icon('pencil') + '</span>' +
          '<span class="icon-btn danger" onclick="event.stopPropagation();deleteDay(\'' + d.id + '\')" title="Delete">' + icon('trash') + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('') + '<button type="button" class="btn btn-primary btn-sm programme-add-day" onclick="openNewDay(\'' + (activeProg ? activeProg.id : '') + '\')">+ Add another day</button>';
  initProgrammeDayDrag();
}

function printProgrammePdf(){
  const programme = getActiveProgramme();
  const days = getActiveProgrammeDays();
  if (!days.length){ toast('Add a workout day before exporting the plan.'); return; }
  const view = window.open('', '_blank');
  if (!view){ toast('Allow pop-ups to save the plan as a PDF.'); return; }
  const date = new Date().toLocaleDateString(undefined, { year:'numeric', month:'long', day:'numeric' });
  const dayHtml = days.map((day, dayIndex) => {
    const exerciseRows = day.exercises.map((exercise, index) => {
      const parts = [];
      if (exercise.sets != null && exercise.sets !== '') parts.push(exercise.sets + ' sets');
      if (exercise.reps) parts.push(exercise.reps + ' reps');
      if (exercise.weight != null && exercise.weight !== '') parts.push(exercise.weight + ' kg');
      if (exercise.seconds) parts.push(exercise.seconds + ' sec');
      if (exercise.rest != null && exercise.rest !== '') parts.push(exercise.rest + ' sec rest');
      const members = exercise.groupId ? day.exercises.filter(item => item.groupId === exercise.groupId) : [];
      const groupLabel = members.length > 1
        ? '<span class="group">' + (exercise.groupType === 'circuit' ? 'Circuit' : 'Superset') +
          ' · ' + members.map(item => esc(item.name)).join(' + ') + '</span>' : '';
      return '<li><div><b>' + esc(exercise.name) + '</b>' + groupLabel +
        (parts.length ? '<small>' + esc(parts.join(' · ')) + '</small>' : '') +
        (exercise.notes ? '<p>' + esc(exercise.notes) + '</p>' : '') +
        '</div><span class="index">' + String(index + 1).padStart(2, '0') + '</span></li>';
    }).join('');
    return '<section class="day"><header><span>DAY ' + String(dayIndex + 1).padStart(2, '0') + '</span><h2>' + esc(day.name) + '</h2></header>' +
      (exerciseRows ? '<ol>' + exerciseRows + '</ol>' : '<p class="empty">No exercises in this day yet.</p>') + '</section>';
  }).join('');
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>' + esc(programme ? programme.name : 'Training plan') + ' · LIFTR</title><style>' +
    '@page{size:A4;margin:16mm}*{box-sizing:border-box}body{margin:0;color:#182338;font:14px/1.45 Arial,sans-serif}header.brand{display:flex;justify-content:space-between;align-items:flex-end;padding:0 0 18px;border-bottom:3px solid #1374fc}header.brand strong{color:#1374fc;font-size:22px;letter-spacing:.12em}header.brand span{color:#62728a;font-size:12px}h1{margin:22px 0 5px;font-size:30px;letter-spacing:-.04em}p.intro{margin:0 0 23px;color:#62728a}.day{margin:0 0 22px;break-inside:avoid}.day header{display:flex;align-items:baseline;gap:12px;padding:8px 0;border-bottom:1px solid #d5deeb}.day header span{color:#1374fc;font-size:10px;font-weight:700;letter-spacing:.12em}.day h2{margin:0;font-size:19px}.day ol{margin:0;padding:0;list-style:none}.day li{display:flex;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid #e4eaf2}.day li b{display:block;font-size:14px}.day small{display:block;margin-top:3px;color:#62728a}.day p{margin:4px 0 0;color:#62728a;font-size:12px}.group{display:block;margin-top:3px;color:#1374fc;font-size:11px;font-weight:700}.index{color:#8d9ab0;font-size:11px}.empty{color:#62728a}footer{margin-top:26px;padding-top:10px;border-top:1px solid #d5deeb;color:#8390a3;font-size:10px}@media print{footer{position:fixed;bottom:0;left:0;right:0}}</style></head><body>' +
    '<header class="brand"><strong>LIFTR</strong><span>' + esc(date) + '</span></header><h1>' + esc(programme ? programme.name : 'Training plan') + '</h1>' +
    '<p class="intro">' + days.length + ' workout day' + (days.length === 1 ? '' : 's') + ' · Personal training plan</p>' + dayHtml +
    '<footer>Created on this device with LIFTR</footer><script>window.addEventListener("load",()=>setTimeout(()=>window.print(),200));window.addEventListener("afterprint",()=>setTimeout(()=>window.close(),300))<\/script></body></html>';
  view.document.open();
  view.document.write(html);
  view.document.close();
}

function openNewDay(programId){
  $('dayNameInput').value = '';
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
  const active = DB.programmes.find(x => x.active) || DB.programmes[0] || null;
  if (active) activeProgramId = active.id;
  return active;
}

/* Définit le programme actif et persiste le choix */
function setActiveProgramme(id){
  const p = DB.programmes.find(x => x.id === id);
  if (!p) return;
  DB.programmes.forEach(x => { x.active = (x.id === id); });
  activeProgramId = id;
  save();
  renderProgramme();
  renderSeance();
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
  const groupMap = new Map();
  getProgramDays(id).forEach(d => {
    const newDay = {
      id: uid(),
      programId: newProg.id,
      name: d.name,
      type: d.type,
      order: d.order,
      exercises: d.exercises.map((e, index) => {
        const copy = Object.assign({}, e, { id: uid(), order: index });
        if (e.groupId){
          if (!groupMap.has(e.groupId)) groupMap.set(e.groupId, uid());
          copy.groupId = groupMap.get(e.groupId);
        }
        return copy;
      })
    };
    DB.programme.push(newDay);
  });
  newProg.updatedAt = new Date().toISOString().slice(0, 10);
  save();
  renderProgramsList();
  renderProgramme();
  return newProg;
}

/* Supprime un programme avec confirmation */
function deleteProgramme(id){
  const p = DB.programmes.find(x => x.id === id);
  if (!p) return;

  const days = getProgramDays(id);
  const dayIds = new Set(days.map(d => d.id));
  const totalSets = days.reduce((n, d) => n + d.exercises.reduce((m, e) => m + (Number(e.sets) || 0), 0), 0);

  if (DB.programmes.length <= 1){
    toast('Impossible de supprimer le dernier programme.');
    return;
  }
  if (DB.active && dayIds.has(DB.active.dayId)){
    toast('Terminez ou quittez la séance avant de supprimer ce programme.');
    return;
  }

  askConfirm('Supprimer le programme ?',
    '"' + p.name + '" et ses ' + days.length + ' journée(s) seront supprimés.' +
    (totalSets ? ' · ' + totalSets + ' série(s) au total.' : '') +
    '\n\nLes séances passées liées à ces journées seront conservées dans l\'historique.',
    'Supprimer', 'Annuler').then(res => {
    if (!res.ok) return;
    DB.history.forEach(h => { if (dayIds.has(h.dayId)) h.dayId = null; });
    DB.programme = DB.programme.filter(d => d.programId !== id);
    DB.programmes = DB.programmes.filter(x => x.id !== id);
    if (activeProgramId === id){
      activeProgramId = null;
      const remaining = DB.programmes.find(x => x.active) || DB.programmes[0];
      if (remaining) setActiveProgramme(remaining.id);
    }
    DB.programmes.forEach(x => { x.active = x.id === activeProgramId; });
    save();
    renderAll();
  });
}
/* Rend la liste des programmes (puces de sélection) */
function renderProgramsList(){
  const el = $('programsList');
  if (!el) return;
  if (!activeProgramId) getActiveProgramme();
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
  let created = null;
  if (id){
    renameProgramme(id, name);
    updateProgrammeDescription(id, desc);
  } else {
    created = createProgramme(name, desc);
  }
  closeModal('programmeEditorModal');
  if (created) openNewDay(created.id);
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
  const days = getProgramDays(programId);
  const el = $('programView');
  if (!el) return;
  el.innerHTML = '<div class="section-head">' +
    '<div>' +
    '<div class="section-title">' + esc(p.name) + '</div>' +
    '<div class="section-hint">' + esc(p.description || 'Aucune description') + ' · ' + days.length + ' journée' + (days.length !== 1 ? 's' : '') + '</div>' +
    '</div>' +
    '<button class="btn btn-primary btn-sm" onclick="openProgrammeEditor(\'' + p.id + '\')">Modifier</button>' +
    '<button class="btn btn-sm" onclick="openNewDay(\'' + p.id + '\')">+ Nouvelle journée</button>' +
    '</div>' +
    '<div id="programDaysList"></div>';
  const daysEl = $('programDaysList');
  if (!daysEl) return;
  if (!days.length){
    daysEl.innerHTML = '<div class="empty" style="padding:20px"><div class="empty-text">Aucune journée. Ajoutez-en une pour commencer.</div>' +
      '<button type="button" class="btn btn-primary btn-sm" onclick="openNewDay(\'' + p.id + '\')">+ Ajouter la première journée</button></div>';
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
      '</div>' +
      '</div>' +
      '</div>';
  }).join('') + '<button type="button" class="btn btn-sm programme-add-day" onclick="openNewDay(\'' + p.id + '\')">+ Ajouter une journée</button>';
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
  const day = { id: uid(), programId: programId || null, name: name, type: 'CUSTOM', order: getProgramDays(programId).length, exercises: [] };
  DB.programme.push(day);
  save();
  closeModal('newDayModal');
  renderProgramme();
  renderProgramsList();
  openDayDetail(day.id);
  return day;
}
function saveNewDay(){
  const name = $('dayNameInput').value.trim();
  if (!name) { $('dayNameInput').focus(); return; }
  const progSel = $('dayProgramSelector');
  const programId = progSel ? progSel.value : activeProgramId;
  if (programId){
    return saveNewDayInProgram(programId);
  } else {
    const day = { id: uid(), name: name, type: 'CUSTOM', exercises: [] };
    DB.programme.push(day);
    save();
    closeModal('newDayModal');
    renderAll();
    openDayDetail(day.id);
    return day;
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
    renumberProgramDays(d.programId);
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
  selectedDayExerciseIds.clear();
  $('dayTitleInput').value = d.name;
  const copyTarget = $('copyDayTargetProgram');
  if (copyTarget){
    copyTarget.innerHTML = DB.programmes.map(p => '<option value="' + esc(p.id) + '"' + (p.id === d.programId ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('');
  }
  renderDayExercises();
  libFilter = 'All'; libQuery = '';
  const s = $('libSearch'); if (s) s.value = '';
  renderLibrary();
  openModal('dayDetailModal');
  if (!d.exercises.length){
    setTimeout(() => {
      const search = $('libSearch');
      if (!search || detailDayId !== id) return;
      search.scrollIntoView({ block: 'center', behavior: 'auto' });
      search.focus({ preventScroll: true });
    }, 80);
  }
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
  const ids = new Set(d.exercises.map(e => e.id));
  selectedDayExerciseIds = new Set([...selectedDayExerciseIds].filter(id => ids.has(id)));
  const moveOptions = DB.programme.filter(day => day.id !== d.id).map(day => {
    const prog = DB.programmes.find(p => p.id === day.programId);
    return '<option value="' + esc(day.id) + '">' + esc((prog ? prog.name + ' · ' : '') + day.name) + '</option>';
  }).join('');
  const blocks = d.exercises.map((e, i) => {
    const id = esc(e.id);
    const groupMembers = e.groupId ? d.exercises.filter(x => x.groupId === e.groupId) : [];
    const groupType = e.groupType === 'circuit' ? 'circuit' : 'superset';
    const p = getExerciseParams(e);
    return '<div class="ex-block" data-ex-id="' + id + '">' +
      '<div class="ex-name"><span class="ex-heading">' + (i+1) + '. ' + esc(e.name) +
        (e.cardio ? ' <span class="chip chip-cardio">CARDIO</span>' : '') + '</span>' +
        '<span class="card-actions">' +
          '<button type="button" class="icon-btn ex-drag-handle" draggable="true" data-ex-id="' + id + '" aria-label="Réordonner ' + esc(e.name) + '" title="Réordonner">↕</button>' +
          '<button type="button" class="icon-btn" onclick="event.stopPropagation();moveDayExerciseOrder(\'' + id + '\',-1)" aria-label="Monter ' + esc(e.name) + '" title="Monter"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" class="icon-btn" onclick="event.stopPropagation();moveDayExerciseOrder(\'' + id + '\',1)" aria-label="Descendre ' + esc(e.name) + '" title="Descendre"' + (i === d.exercises.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button type="button" class="icon-btn' + (e.cardio ? ' on' : '') + '" onclick="event.stopPropagation();toggleCardio(\'' + id + '\')" title="Cardio exercise (time / distance)" aria-label="Basculer cardio">' + (e.cardio ? icon('run') : icon('flex')) + '</button>' +
          '<button type="button" class="icon-btn" onclick="event.stopPropagation();duplicateDayExercise(\'' + id + '\')" title="Dupliquer" aria-label="Dupliquer ' + esc(e.name) + '">' + icon('copy') + '</button>' +
          '<button type="button" class="icon-btn" onclick="event.stopPropagation();renameExercise(\'' + id + '\')" title="Rename" aria-label="Renommer">' + icon('pencil') + '</button>' +
          '<button type="button" class="icon-btn danger" onclick="event.stopPropagation();deleteExercise(\'' + id + '\')" title="Delete" aria-label="Supprimer">' + icon('trash') + '</button>' +
        '</span>' +
      '</div>' +
      '<div class="card-sub">' + exerciseHistoryLine(e.name, e.cardio) + ' · ' + esc(exerciseParamsLine(e)) + '</div>' +
      (groupMembers.length > 1
        ? '<div class="ex-group-controls"><span class="chip chip-type">' + (groupType === 'circuit' ? 'Circuit' : 'Superset') + '</span>' +
          '<label class="sr-only" for="group-type-' + id + '">Type de groupe</label>' +
          '<select class="input ex-group-type" id="group-type-' + id + '" onchange="setExerciseGroupType(\'' + esc(e.groupId) + '\',this.value)">' +
            '<option value="superset"' + (groupType === 'superset' ? ' selected' : '') + '>Superset</option>' +
            '<option value="circuit"' + (groupType === 'circuit' ? ' selected' : '') + '>Circuit</option>' +
          '</select><button type="button" class="btn btn-sm" onclick="dissolveExerciseGroup(\'' + esc(e.groupId) + '\')">Dissoudre</button></div>'
        : '') +
      '<details class="ex-params"><summary>Objectifs et notes</summary>' +
        '<div class="ex-params-grid">' +
          '<label>Séries<input class="input" id="param-sets-' + id + '" type="number" min="1" step="1" inputmode="numeric" value="' + (p.sets == null ? '' : esc(p.sets)) + '"></label>' +
          '<label>Plafond séries<input class="input" id="param-setsMax-' + id + '" type="number" min="1" max="10" step="1" inputmode="numeric" value="' + (p.setsMax == null ? '' : esc(p.setsMax)) + '" aria-label="Nombre maximum de séries pour la progression triple"></label>' +
          '<label>Répétitions<input class="input" id="param-reps-' + id + '" maxlength="40" value="' + (p.reps == null ? '' : esc(p.reps)) + '" placeholder="8–12 ou 12,10,8"></label>' +
          '<label>Charge (kg)<input class="input" id="param-weight-' + id + '" type="number" min="0" step="0.1" inputmode="decimal" value="' + (p.weight == null ? '' : esc(p.weight)) + '"></label>' +
          '<label>Repos (s)<input class="input" id="param-rest-' + id + '" type="number" min="0" step="1" inputmode="numeric" value="' + (p.rest == null ? '' : esc(p.rest)) + '"></label>' +
          '<label>Durée de maintien (s)<input class="input" id="param-seconds-' + id + '" type="number" min="1" max="86400" step="1" inputmode="numeric" value="' + (p.seconds == null ? '' : esc(p.seconds)) + '"></label>' +
          '<label>Progression<select class="input" id="param-progression-' + id + '">' +
            '<option value="double"' + (p.progression === 'double' ? ' selected' : '') + '>Double</option>' +
            '<option value="triple"' + (p.progression === 'triple' ? ' selected' : '') + '>Triple</option>' +
            '<option value="linear"' + (p.progression === 'linear' ? ' selected' : '') + '>Linéaire</option>' +
            '<option value="greyskull"' + (p.progression === 'greyskull' ? ' selected' : '') + '>Greyskull</option>' +
            '<option value="time"' + (p.progression === 'time' ? ' selected' : '') + '>Temps</option>' +
            '<option value="off"' + (p.progression === 'off' ? ' selected' : '') + '>Manuelle</option>' +
          '</select></label>' +
        '</div><label class="ex-notes-label">Notes<textarea class="textarea" id="param-notes-' + id + '" rows="2" maxlength="500">' + esc(p.notes) + '</textarea></label>' +
        '<button type="button" class="btn btn-sm" onclick="saveExerciseParams(\'' + id + '\')">Enregistrer les objectifs</button>' +
      '</details>' +
      (moveOptions ? '<label class="ex-move-label">Déplacer vers<select class="input" aria-label="Déplacer ' + esc(e.name) + ' vers une journée" onchange="moveDayExercise(\'' + id + '\',this.value);this.value=\'\'"><option value="">Choisir une journée…</option>' + moveOptions + '</select></label>' : '') +
          '<label class="ex-select-label"><input type="checkbox" class="ex-select" value="' + id + '"' + (selectedDayExerciseIds.has(e.id) ? ' checked' : '') + ' onchange="setDayExerciseSelected(\'' + id + '\',this.checked)"> Select to group</label>' +
    '</div>';
  }).join('');
  el.innerHTML = renderExerciseGroupToolbar() + (blocks || '<div class="empty" style="padding:24px"><div class="empty-text">No exercises. Add some below.</div></div>');
  initExerciseDrag();
  updateGroupSelectionUI();
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
    const rawName = String(name).trim();
    const k = rawName.toLowerCase();
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push({ name: rawName, group: group, custom: !!custom });
  };
  /* Privilégie le catalogue openGym quand il est chargé, sinon fallback LIB legacy. */
  const cat = getCatalogue();
  if (cat.length){
    cat.forEach(ex => push(ex.name, exerciseGroupLabel(ex.bodyPart), ex.category === 'custom'));
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

  const catGroups = [...new Set(all.filter(e => !e.custom).map(e => e.group).filter(Boolean))].sort();
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
  else d.exercises.push({ id: uid(), name: name, cardio: isCardioName(name) || undefined, order: d.exercises.length });
  normalizeExerciseGroups(d);
  renumberExercises(d);
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
    d.exercises.push({ id: uid(), name: name, cardio: isCardioName(name) || undefined, order: d.exercises.length });
    toast('Added to "' + d.name + '"');
  }
  normalizeExerciseGroups(d);
  renumberExercises(d);
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
    d.exercises.push({ id: uid(), name: name, cardio: isCardio || undefined, order: d.exercises.length });
    const known = libEntries().some(e => e.name.toLowerCase() === name.toLowerCase());
    if (!known){
      if (!DB.custom) DB.custom = [];
      if (!DB.custom.some(n => n.toLowerCase() === name.toLowerCase())) DB.custom.push(name);
    }
  }
  renumberExercises(d);
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
    normalizeExerciseGroups(d);
    renumberExercises(d);
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
  exoNameSet, othersHaveExo, dropExoRecords, renderProgramme,
  renderTodayCard, dayMuscles, suggestDay, muscleChip,
  openNewDay, saveNewDay, printProgrammePdf, renamePrompt, applyDayName, deleteDay,
  openDayDetail, renameDay, renderDayExercises, exerciseHistoryLine, libEntries,
  renderLibrary, onLibSearch, toggleLibExercise, libAddToDay, addExercise, renameExercise,
  deleteExercise, deleteCurrentDay, toggleCardio, shareProgramme,
  getActiveProgramme, setActiveProgramme, createProgramme, renameProgramme,
  updateProgrammeDescription, duplicateProgramme, deleteProgramme,
  renderProgramsList, openProgrammeEditor, saveProgrammeEditor, editProgrammeName,
  renderProgramView, renderProgramSelector, saveNewDayInProgram,
  getActiveProgrammeDays,
  getExerciseParams, setExerciseParams, exerciseParamsLine, saveExerciseParams,
  addDayExercise, deleteDayExercise, duplicateDayExercise, moveDayExercise,
  copyProgrammeDay, copyCurrentDayToProgram, moveProgrammeDayBefore,
  moveDayExerciseOrder, moveProgrammeDay, reorderDayExercises, groupSelectedExercises, updateGroupSelectionUI,
  setDayExerciseSelected, setExerciseGroupType, dissolveExerciseGroup,
  saveDayTemplate, saveCurrentDayTemplate, loadDayTemplates, deleteDayTemplate, importDayFromTemplate,
  importDayTemplateById, openDayTemplates, renderDayTemplates
});

function initExerciseDrag(){
  const root = $('dayExercises');
  if (!root) return;
  root.querySelectorAll('.ex-drag-handle').forEach(handle => {
    handle.addEventListener('dragstart', e => {
      dragExId = handle.dataset.exId;
      if (!dragExId || !e.dataTransfer) return;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragExId);
      handle.closest('.ex-block').classList.add('dragging');
    });
    handle.addEventListener('dragend', () => {
      const block = handle.closest('.ex-block');
      if (block) block.classList.remove('dragging', 'drag-over');
      dragExId = null;
    });
  });
  root.ondragover = e => {
    const block = e.target.closest('.ex-block');
    if (!block) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    block.classList.add('drag-over');
  };
  root.ondragleave = e => {
    const block = e.target.closest('.ex-block');
    if (block && !block.contains(e.relatedTarget)) block.classList.remove('drag-over');
  };
  root.ondrop = e => {
    const target = e.target.closest('.ex-block');
    if (!target) return;
    e.preventDefault();
    const sourceId = e.dataTransfer && e.dataTransfer.getData('text/plain') || dragExId;
    if (sourceId && sourceId !== target.dataset.exId) reorderDayExercises(detailDayId, sourceId, target.dataset.exId);
    root.querySelectorAll('.ex-block').forEach(block => block.classList.remove('drag-over', 'dragging'));
    dragExId = null;
  };
}

function initProgrammeDayDrag(){
  const root = $('daysList');
  if (!root) return;
  root.querySelectorAll('.day-drag-handle').forEach(handle => {
    handle.addEventListener('dragstart', e => {
      const card = handle.closest('.programme-day');
      if (!card || !e.dataTransfer) return;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.dayId);
      card.classList.add('dragging');
    });
    handle.addEventListener('dragend', () => {
      root.querySelectorAll('.programme-day').forEach(card => card.classList.remove('dragging', 'drag-over'));
    });
  });
  root.ondragover = e => {
    const card = e.target.closest('.programme-day');
    if (!card) return;
    e.preventDefault();
    card.classList.add('drag-over');
  };
  root.ondragleave = e => {
    const card = e.target.closest('.programme-day');
    if (card && !card.contains(e.relatedTarget)) card.classList.remove('drag-over');
  };
  root.ondrop = e => {
    const card = e.target.closest('.programme-day');
    if (!card) return;
    e.preventDefault();
    e.stopPropagation();
    const sourceId = e.dataTransfer && e.dataTransfer.getData('text/plain');
    if (sourceId && sourceId !== card.dataset.dayId) moveProgrammeDayBefore(sourceId, card.dataset.dayId);
    root.querySelectorAll('.programme-day').forEach(item => item.classList.remove('dragging', 'drag-over'));
  };
}

function getExerciseParams(ex){
  return {
    sets: ex && ex.sets != null ? ex.sets : null,
    reps: ex && ex.reps != null ? ex.reps : null,
    weight: ex && ex.weight != null ? ex.weight : null,
    rest: ex && ex.rest != null ? ex.rest : null,
    seconds: ex && ex.seconds != null ? ex.seconds : null,
    setsMax: ex && ex.setsMax != null ? ex.setsMax : null,
    progression: ex && ['double', 'triple', 'linear', 'greyskull', 'time', 'off'].includes(ex.progression)
      ? ex.progression : (ex && Number(ex.seconds) > 0 ? 'time' : 'double'),
    notes: ex && ex.notes ? ex.notes : ''
  };
}

function setExerciseParams(ex, data){
  if (!ex || !data) return false;
  ['sets', 'setsMax', 'reps', 'weight', 'rest', 'seconds', 'progression', 'notes'].forEach(key => {
    if (!Object.prototype.hasOwnProperty.call(data, key)) return;
    let value = data[key];
    if (value === '') value = null;
    if (['sets', 'setsMax', 'weight', 'rest', 'seconds'].includes(key) && value != null){
      value = Number(value);
      if (!Number.isFinite(value) || value < 0) return;
      if (key === 'sets' || key === 'setsMax') value = Math.max(1, Math.round(value));
      if (key === 'setsMax' && (value > 10 || value < Math.max(1, Math.round(Number(ex.sets) || 1)))) return;
      if (key === 'rest' || key === 'seconds') value = Math.round(value);
      if (key === 'seconds' && value > 86400) return;
    }
    if (key === 'reps' && value != null){
      value = String(value).trim() || null;
      const sequence = repSequenceOf(value);
      if (sequence.length) ex.sets = sequence.length;
    }
    if (key === 'progression'){
      if (!['double', 'triple', 'linear', 'greyskull', 'time', 'off'].includes(value)) return;
      if (Number(ex.seconds) > 0 && value !== 'off') value = 'time';
      else if (!(Number(ex.seconds) > 0) && value === 'time') value = 'double';
    }
    if (key === 'notes' && value != null) value = String(value).slice(0, 500);
    ex[key] = value;
  });
  save();
  renderDayExercises();
  renderProgramme();
  renderSeance();
  return true;
}

function exerciseParamsLine(ex){
  const p = getExerciseParams(ex);
  const parts = [];
  if (p.sets != null) parts.push((p.progression === 'triple' && p.setsMax ? p.sets + '–' + p.setsMax : p.sets) + ' séries');
  if (p.reps != null) parts.push(p.reps + ' reps');
  if (p.weight != null) parts.push(p.weight + ' kg');
  if (p.rest != null) parts.push(p.rest + ' s repos');
  if (p.seconds != null) parts.push(p.seconds + ' s maintien');
  parts.push({ double: 'double', triple: 'triple', linear: 'linéaire', greyskull: 'Greyskull', time: 'temps', off: 'manuelle' }[p.progression]);
  return parts.join(' · ') || 'Objectifs non définis';
}

function optionalNumberInput(id, min, integer){
  const input = $(id);
  if (!input) return null;
  const raw = input.value.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || (integer && !Number.isInteger(value))) return NaN;
  return value;
}

function saveExerciseParams(exId){
  const d = DB.programme.find(x => x.id === detailDayId);
  const ex = d && d.exercises.find(x => x.id === exId);
  if (!ex) return false;
  const sets = optionalNumberInput('param-sets-' + exId, 1, true);
  const setsMax = optionalNumberInput('param-setsMax-' + exId, 1, true);
  const weight = optionalNumberInput('param-weight-' + exId, 0, false);
  const rest = optionalNumberInput('param-rest-' + exId, 0, true);
  const seconds = optionalNumberInput('param-seconds-' + exId, 1, true);
  if ([sets, setsMax, weight, rest, seconds].some(Number.isNaN) || seconds > 86400 || (setsMax != null && (setsMax > 10 || sets != null && setsMax < sets))){
    toast('Vérifiez les séries, la charge, le repos et la durée.');
    return false;
  }
  return setExerciseParams(ex, {
    sets, setsMax, reps: $('param-reps-' + exId).value.trim() || null,
    weight, rest, seconds, progression: $('param-progression-' + exId).value,
    notes: $('param-notes-' + exId).value
  });
}

function getExerciseState(ex){
  return {
    name: ex.name,
    cardio: !!ex.cardio,
    order: Number.isFinite(+ex.order) ? +ex.order : 0,
    sets: ex.sets ?? null,
    setsMax: ex.setsMax ?? null,
    reps: ex.reps ?? null,
    weight: ex.weight ?? null,
    rest: ex.rest ?? null,
    seconds: ex.seconds ?? null,
    progression: ex.progression || (Number(ex.seconds) > 0 ? 'time' : 'double'),
    notes: ex.notes || '',
    groupId: ex.groupId || null,
    groupType: ex.groupType || null
  };
}

function addDayExercise(dayId, name, setParams = {}){
  const d = DB.programme.find(x => x.id === dayId);
  if (!d || !name || typeof name !== 'string') return null;
  if (d.exercises.some(e => e.name.toLowerCase().trim() === name.toLowerCase().trim())){
    toast('Cet exercice existe déjà dans cette journée.');
    return null;
  }
  const exercise = Object.assign({
    id: uid(), name: name.trim(), cardio: isCardioName(name), order: d.exercises.length,
    sets: null, reps: null, weight: null, rest: null, seconds: null, notes: ''
  }, setParams);
  exercise.id = uid();
  exercise.name = name.trim();
  d.exercises.push(exercise);
  renumberExercises(d);
  save();
  renderDayExercises(); renderProgramme(); renderSeance();
  return exercise;
}

function deleteDayExercise(dayId, exId){
  const d = DB.programme.find(x => x.id === dayId);
  if (!d) return false;
  const idx = d.exercises.findIndex(e => e.id === exId);
  if (idx < 0) return false;
  const removed = d.exercises.splice(idx, 1)[0];
  if (removed && removed.groupId) normalizeExerciseGroups(d);
  renumberExercises(d);
  save();
  renderDayExercises(); renderProgramme(); renderSeance();
  return true;
}

function renumberExercises(day){
  day.exercises.forEach((exercise, index) => { exercise.order = index; });
}

function getProgramDays(programId){
  return DB.programme
    .map((day, index) => ({ day, index }))
    .filter(x => x.day.programId === programId)
    .sort((a, b) => (+a.day.order || 0) - (+b.day.order || 0) || a.index - b.index)
    .map(x => x.day);
}

function renumberProgramDays(programId){
  getProgramDays(programId).forEach((day, index) => { day.order = index; });
}

function moveProgrammeDay(dayId, delta){
  const day = DB.programme.find(x => x.id === dayId);
  if (!day) return false;
  const days = getProgramDays(day.programId);
  const index = days.findIndex(x => x.id === dayId);
  const target = index + Number(delta);
  if (index < 0 || target < 0 || target >= days.length) return false;
  [days[index].order, days[target].order] = [days[target].order, days[index].order];
  renumberProgramDays(day.programId);
  save(); renderProgramme();
  return true;
}

function moveProgrammeDayBefore(sourceId, targetId){
  const source = DB.programme.find(x => x.id === sourceId);
  const target = DB.programme.find(x => x.id === targetId);
  if (!source || !target || source.programId !== target.programId) return false;
  const days = getProgramDays(source.programId).filter(x => x.id !== sourceId);
  const targetIndex = days.findIndex(x => x.id === targetId);
  if (targetIndex < 0) return false;
  days.splice(targetIndex, 0, source);
  days.forEach((day, index) => { day.order = index; });
  save(); renderProgramme();
  return true;
}

function reorderDayExercises(dayId, sourceId, targetId){
  const d = DB.programme.find(x => x.id === dayId);
  if (!d) return false;
  const from = d.exercises.findIndex(x => x.id === sourceId);
  const to = d.exercises.findIndex(x => x.id === targetId);
  if (from < 0 || to < 0 || from === to) return false;
  const [exercise] = d.exercises.splice(from, 1);
  d.exercises.splice(to, 0, exercise);
  renumberExercises(d);
  save(); renderDayExercises(); renderProgramme(); renderSeance();
  return true;
}

function moveDayExerciseOrder(exId, delta){
  const d = DB.programme.find(x => x.id === detailDayId);
  if (!d) return false;
  const from = d.exercises.findIndex(x => x.id === exId);
  const to = from + Number(delta);
  if (from < 0 || to < 0 || to >= d.exercises.length) return false;
  [d.exercises[from], d.exercises[to]] = [d.exercises[to], d.exercises[from]];
  renumberExercises(d);
  save(); renderDayExercises(); renderProgramme(); renderSeance();
  return true;
}

function duplicateDayExercise(exId){
  const d = DB.programme.find(x => x.id === detailDayId);
  const index = d && d.exercises.findIndex(x => x.id === exId);
  if (!d || index < 0) return null;
  const copy = Object.assign({}, d.exercises[index], { id: uid() });
  d.exercises.splice(index + 1, 0, copy);
  renumberExercises(d);
  save(); renderDayExercises(); renderProgramme(); renderSeance();
  return copy;
}

function copyProgrammeDay(dayId, targetProgramId){
  const source = DB.programme.find(x => x.id === dayId);
  const target = DB.programmes.find(x => x.id === targetProgramId);
  if (!source || !target) return null;
  const groupMap = new Map();
  const sameProgram = source.programId === targetProgramId;
  const copy = {
    id: uid(), programId: targetProgramId,
    name: source.name + (sameProgram ? ' (copie)' : ''), type: source.type,
    order: getProgramDays(targetProgramId).length,
    exercises: source.exercises.map((exercise, index) => {
      const next = Object.assign({}, exercise, { id: uid(), order: index });
      if (exercise.groupId){
        if (!groupMap.has(exercise.groupId)) groupMap.set(exercise.groupId, uid());
        next.groupId = groupMap.get(exercise.groupId);
      }
      return next;
    })
  };
  DB.programme.push(copy);
  save(); renderProgramme(); renderSeance(); renderProgramsList();
  return copy;
}

function copyCurrentDayToProgram(){
  const target = $('copyDayTargetProgram');
  if (!target || !detailDayId) return null;
  const copy = copyProgrammeDay(detailDayId, target.value);
  if (copy) toast('Journée copiée avec ses objectifs.');
  return copy;
}

function moveDayExercise(exId, targetDayId){
  const source = DB.programme.find(x => x.id === detailDayId);
  const target = DB.programme.find(x => x.id === targetDayId);
  if (!source || !target || source.id === target.id) return false;
  const index = source.exercises.findIndex(x => x.id === exId);
  if (index < 0) return false;
  if (target.exercises.some(x => x.name.toLowerCase().trim() === source.exercises[index].name.toLowerCase().trim())){
    toast('Cet exercice existe déjà dans la journée cible.');
    return false;
  }
  const [exercise] = source.exercises.splice(index, 1);
  delete exercise.groupId;
  delete exercise.groupType;
  target.exercises.push(exercise);
  normalizeExerciseGroups(source);
  renumberExercises(source); renumberExercises(target);
  renumberProgramDays(source.programId); renumberProgramDays(target.programId);
  save(); renderDayExercises(); renderProgramme(); renderSeance(); renderProgramsList();
  toast('Exercice déplacé');
  return true;
}

function normalizeExerciseGroups(day){
  const groups = new Map();
  day.exercises.forEach(ex => {
    if (!ex.groupId) return;
    if (!groups.has(ex.groupId)) groups.set(ex.groupId, []);
    groups.get(ex.groupId).push(ex);
  });
  groups.forEach(members => {
    if (members.length < 2){
      members.forEach(ex => { delete ex.groupId; delete ex.groupType; });
      return;
    }
    const type = members.some(ex => ex.groupType === 'circuit') ? 'circuit' : 'superset';
    members.forEach(ex => { ex.groupType = type; });
  });
}

function renderExerciseGroupToolbar(){
  const selected = selectedDayExerciseIds.size;
  return '<div class="exercise-group-toolbar">' +
    '<span id="groupSelectionCount" aria-live="polite">' + (selected < 2 ? 'Select 2 or more exercises to link them' : selected + ' exercises selected') + '</span>' +
    '<label class="sr-only" for="exerciseGroupType">Type de groupe</label>' +
    '<select class="input" id="exerciseGroupType" aria-label="Group style" onchange="updateGroupSelectionUI()"><option value="superset">Superset</option><option value="circuit">Circuit</option></select>' +
    '<button type="button" class="btn btn-sm" id="groupSelectedBtn" onclick="groupSelectedExercises()"' + (selected < 2 ? ' disabled' : '') + '>' + (selected < 2 ? 'Create superset' : 'Create ' + (($('exerciseGroupType') && $('exerciseGroupType').value === 'circuit') ? 'circuit' : 'superset')) + '</button>' +
  '</div>';
}

function updateGroupSelectionUI(){
  const count = $('groupSelectionCount');
  const button = $('groupSelectedBtn');
  const selected = selectedDayExerciseIds.size;
  if (count) count.textContent = selected < 2 ? 'Select 2 or more exercises to link them' : selected + ' exercises selected';
  if (button){
    button.disabled = selected < 2;
    const type = $('exerciseGroupType') && $('exerciseGroupType').value === 'circuit' ? 'circuit' : 'superset';
    button.textContent = selected < 2 ? 'Create superset' : 'Create ' + type;
  }
}

function setDayExerciseSelected(exId, checked){
  if (checked) selectedDayExerciseIds.add(exId);
  else selectedDayExerciseIds.delete(exId);
  updateGroupSelectionUI();
}

function groupSelectedExercises(){
  const d = DB.programme.find(x => x.id === detailDayId);
  const members = d ? d.exercises.filter(ex => selectedDayExerciseIds.has(ex.id)) : [];
  if (!d || members.length < 2){ toast('Sélectionnez au moins deux exercices.'); return false; }
  const priorGroups = new Set(members.map(ex => ex.groupId).filter(Boolean));
  priorGroups.forEach(id => d.exercises.filter(ex => ex.groupId === id).forEach(ex => { delete ex.groupId; delete ex.groupType; }));
  const groupId = uid();
  const type = $('exerciseGroupType').value === 'circuit' ? 'circuit' : 'superset';
  members.forEach(ex => { ex.groupId = groupId; ex.groupType = type; });
  normalizeExerciseGroups(d);
  selectedDayExerciseIds.clear();
  save(); renderDayExercises(); renderProgramme();
  return true;
}

function setExerciseGroupType(groupId, type){
  const d = DB.programme.find(x => x.id === detailDayId);
  if (!d || !groupId) return false;
  const value = type === 'circuit' ? 'circuit' : 'superset';
  d.exercises.filter(ex => ex.groupId === groupId).forEach(ex => { ex.groupType = value; });
  save(); renderDayExercises();
  return true;
}

function dissolveExerciseGroup(groupId){
  const d = DB.programme.find(x => x.id === detailDayId);
  if (!d || !groupId) return false;
  d.exercises.filter(ex => ex.groupId === groupId).forEach(ex => { delete ex.groupId; delete ex.groupType; });
  save(); renderDayExercises();
  return true;
}

/* Les modèles sont propres au profil. L'ancienne clé globale est lue une fois
   pour conserver les modèles créés par les premières versions. */
function dayTemplateKey(){ return 'liftr_dayTemplates_' + (currentUser || 'guest'); }

function loadDayTemplates(){
  try {
    const scoped = localStorage.getItem(dayTemplateKey());
    if (scoped) return JSON.parse(scoped).filter(t => t && t.id && Array.isArray(t.exercises));
    const legacy = localStorage.getItem('liftr_dayTemplates');
    const templates = legacy ? JSON.parse(legacy) : [];
    return Array.isArray(templates) ? templates.filter(t => t && t.id && Array.isArray(t.exercises)) : [];
  } catch { return []; }
}

function saveDayTemplate(dayId, templateName){
  const day = DB.programme.find(x => x.id === dayId);
  if (!day) return null;
  const name = String(templateName || prompt('Nom du modèle :', day.name) || '').trim();
  if (!name) return null;
  const templates = loadDayTemplates();
  const template = {
    id: uid(), name, dayName: day.name, type: day.type || 'PUSH',
    exercises: day.exercises.map(getExerciseState),
    createdAt: new Date().toISOString()
  };
  templates.push(template);
  localStorage.setItem(dayTemplateKey(), JSON.stringify(templates));
  toast('Modèle enregistré');
  return template;
}

function saveCurrentDayTemplate(){
  return detailDayId ? saveDayTemplate(detailDayId) : null;
}

function deleteDayTemplate(id){
  const templates = loadDayTemplates().filter(t => t.id !== id);
  localStorage.setItem(dayTemplateKey(), JSON.stringify(templates));
  renderDayTemplates();
  toast('Modèle supprimé');
}

function importDayFromTemplate(template, targetProgramId){
  if (!template || !Array.isArray(template.exercises)) return null;
  const programId = targetProgramId || (getActiveProgramme() || {}).id;
  if (!programId || !DB.programmes.some(p => p.id === programId)) return null;
  const groupMap = new Map();
  const day = {
    id: uid(), programId, name: String(template.dayName || template.name || 'Journée').slice(0, 40),
    type: TYPES.includes(String(template.type || '').toUpperCase()) ? String(template.type).toUpperCase() : 'PUSH',
    order: getProgramDays(programId).length,
    exercises: template.exercises.map((e, index) => {
      const copy = Object.assign({}, e, { id: uid(), order: index });
      if (e.groupId){
        if (!groupMap.has(e.groupId)) groupMap.set(e.groupId, uid());
        copy.groupId = groupMap.get(e.groupId);
      }
      return copy;
    })
  };
  DB.programme.push(day);
  save(); renderProgramme(); renderSeance(); renderProgramsList();
  toast('Routine importée comme nouvelle journée');
  return day;
}

function renderDayTemplates(){
  const el = $('dayTemplatesList');
  if (!el) return;
  const templates = loadDayTemplates();
  el.innerHTML = templates.length ? templates.map(t =>
    '<div class="template-item"><div><div class="card-title">' + esc(t.name) + '</div>' +
    '<div class="card-sub">' + t.exercises.length + ' exercice(s)' + (t.createdAt ? ' · ' + esc(new Date(t.createdAt).toLocaleDateString()) : '') + '</div></div>' +
    '<div class="card-actions"><button type="button" class="btn btn-primary btn-sm" onclick="importDayTemplateById(\'' + esc(t.id) + '\')">Utiliser</button>' +
    '<button type="button" class="icon-btn danger" aria-label="Supprimer le modèle" onclick="deleteDayTemplate(\'' + esc(t.id) + '\')">' + icon('trash') + '</button></div></div>'
  ).join('') : '<div class="empty"><div class="empty-text">Aucun modèle enregistré.</div></div>';
}

function openDayTemplates(){ renderDayTemplates(); openModal('dayTemplatesModal'); }

function importDayTemplateById(id){
  const template = loadDayTemplates().find(t => t.id === id);
  if (!template) return false;
  const day = importDayFromTemplate(template);
  if (day) closeModal('dayTemplatesModal');
  return !!day;
}
