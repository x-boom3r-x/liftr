/* ==================================================================
   LIFTR - seance en cours
   ================================================================== */
import { icon, iconS } from './icons.js';
import { getCatalogue, loadCatalogue, aliasFrToEn } from './gym/exercises.js';

/* Démarre le chargement du catalogue openGym dès l'import du module. */
loadCatalogue();

let addSetExIdx = null;

/* ==================================================================
   SEANCE
   ================================================================== */
function renderSeance(){
  const banner = $('sessionBanner');
  if (DB.active){
    const d = sessionDiff();
    banner.innerHTML =
      '<div class="sess-banner">' +
        '<div><div class="t">Session in progress</div><div class="s">' + esc(DB.active.dayName) + ' · ' +
          DB.active.exercises.reduce((n, e) => n + e.sets.length, 0) + ' sets' +
          (d.planned ? ' · ' + d.done + '/' + d.planned + ' done' : '') + '</div></div>' +
        '<button class="btn btn-primary btn-sm" onclick="resumeSession()">Resume</button>' +
      '</div>';
  } else if (DB.history.length){
    const h = DB.history[0];
    banner.innerHTML =
      '<div class="card tap" onclick="openSessionDetail(\'' + h.id + '\')">' +
        '<div class="card-header">' +
          '<div><div class="card-title">Last session · ' + esc(h.dayName) + '</div>' +
          '<div class="card-sub">' + fmtShort(h.date) + ' · ' + (h.totalSets || 0) + ' sets · ' +
            fmtVolume(h.volume || 0) + ' → view details</div></div>' +
          '<div class="hist-right"><span class="chip chip-type">Stats</span>' + histDelBtn(h) + '</div>' +
        '</div>' +
      '</div>';
  } else banner.innerHTML = '';

  const el = $('seanceDays');
  const days = window.getActiveProgrammeDays();
  if (!days || !days.length){
    const emptyText = 'Create a session first in the Program tab.';
    el.innerHTML = '<div class="empty"><div class="empty-icon">' + iconS('flex') + '</div>' +
      '<div class="empty-text">' + emptyText + '</div></div>';
    return;
  }
  el.innerHTML = days.map(d => {
    const past = DB.history.filter(h => h.dayId === d.id).length;
    return '<div class="card">' +
      '<div class="card-header">' +
        '<div style="min-width:0">' +
          '<div class="card-title">' + esc(d.name) + '</div>' +
          '<div class="card-sub">' + (d.exercises.length ? esc(d.exercises.map(e => e.name).join(' · ')) : 'No exercises') +
            (past ? ' · done ' + past + ' time' + (past > 1 ? 's' : '') : '') + '</div>' +
        '</div>' + typeChip(d.type) +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:12px">' +
        '<button class="btn btn-primary btn-sm" style="flex:1" ' + (d.exercises.length && !DB.active ? '' : 'disabled') +
          ' onclick="startSession(\'' + d.id + '\')">Start</button>' +
        '<button class="btn btn-sm" onclick="openDayDetail(\'' + d.id + '\')">Exercises</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function startSession(dayId){
  const d = window.getActiveProgrammeDays().find(x => x.id === dayId);
  if (!d || !d.exercises.length) return;
  if (DB.active && !confirm('A session is already in progress. Replace it?')) return;
  DB.active = {
    id: uid(),
    dayId: d.id,
    dayName: d.name,
    startedAt: Date.now(),
    note: '',
    exercises: d.exercises.map(e => ({ id: e.id, name: e.name, cardio: !!e.cardio || undefined, sets: [] }))
  };
  save();
  renderSeance();
  resumeSession();
}

function resumeSession(){
  if (!DB.active) return;
  const d = sessionDiff();
  $('activeTitle').textContent = DB.active.dayName;
  $('activeSub').textContent = new Date(DB.active.startedAt).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' }) +
    ' · ' + DB.active.exercises.reduce((n, e) => n + e.sets.length, 0) + ' sets' +
    (d.planned ? ' · ' + d.done + '/' + d.planned + ' done' : '');
  $('sessNote').value = DB.active.note || '';
  renderActive();
  restLoop();
  openModal('activeModal');
}

function renderActive(){
  const el = $('activeExercises');
  if (!DB.active) return;
  el.innerHTML = DB.active.exercises.map((ex, i) =>
    '<div class="ex-block">' +
      '<div class="ex-name"><span class="ex-title">' + esc(ex.name) +
        (ex.cardio ? '<span class="chip chip-cardio">CARDIO</span>' : '') +
        (ex.extra ? '<span class="chip chip-extra">New</span>' : '') +
        '</span>' + demoBtn(ex.name) + '<span class="ex-tags">' +
        '<span class="chip chip-type">' + ex.sets.length + (ex.cardio ? ' run' + (ex.sets.length !== 1 ? 's' : '') : '×') + '</span>' +
        (ex.extra ? '<span class="icon-btn danger ex-del" onclick="removeActiveExercise(\'' + ex.id + '\')" title="Remove from this session">×</span>' : '') +
        '</span></div>' +
      activeHistLine(ex.name, ex.cardio) +
      (ex.sets.length
        ? ex.sets.map((s, si) =>
            '<div class="set-row"><div class="set-num">' + (si + 1) + '</div>' +
            '<div class="set-values">' + setLine(s) + '</div>' +
            '<button class="set-del" onclick="removeSet(' + i + ',' + si + ')">×</button></div>'
          ).join('')
        : '<div class="ex-empty">' + (ex.cardio ? 'No runs' : 'No sets') + (ex.extra ? ' yet' : ' — not done today') + '</div>') +
      '<button class="add-set-btn" onclick="openAddSet(' + i + ')">+ ' + (ex.cardio ? 'Run' : 'Set') + '</button>' +
    '</div>'
  ).join('');
  renderProgramDiff();
}

function openAddSet(exIdx){
  /* Réouverture pendant qu'on ajuste déjà les valeurs : on garde ce que
     l'utilisateur vient de taper, on ne re-préremplit pas par-dessus. */
  const box = $('addSetModal');
  const alreadyOpen = !!(box && box.classList.contains('show'));
  addSetExIdx = exIdx;
  const ex = DB.active.exercises[exIdx];
  const last = ex.sets.length ? ex.sets[ex.sets.length - 1] : null;
  const isCardio = !!ex.cardio;
  const strength = $('strengthFields'), cardioBox = $('cardioFields');
  if (strength) strength.hidden = isCardio;
  if (cardioBox) cardioBox.hidden = !isCardio;
  const okBtn = $('addSetModal').querySelector('.modal-actions .btn-primary');
  if (okBtn) okBtn.textContent = isCardio ? 'Save run' : 'Save set';
  const sub = $('addSetModal').querySelector('.modal-sub');
  if (sub) sub.hidden = isCardio;

  if (alreadyOpen) return;

  if (isCardio){
    const p = last && last.cardio ? last : (cardioHistory(ex.name) || null);
    $('addSetTitle').textContent = 'Run · ' + ex.name;
    if ($('cardioMinInput')) $('cardioMinInput').value = p ? (p.min || 30) : 30;
    if ($('cardioKmInput')) $('cardioKmInput').value = p ? (p.km || 5) : 5;
  } else {
    $('addSetTitle').textContent = 'Set · ' + ex.name;
    $('weightInput').value = last ? last.weight : 20;
    $('repsInput').value = last ? last.reps : 10;
    $('assistedInput').value = 0;
  }
  renderSetContext(ex.name, isCardio);
  openModal('addSetModal');
}

function applySuggestion(){
  const ex = (DB.active && addSetExIdx != null) ? DB.active.exercises[addSetExIdx] : null;
  const sug = ex ? suggestFor(ex.name, ex.cardio) : null;
  if (!sug) return;
  $('weightInput').value = sug.weight;
  $('repsInput').value = sug.reps;
  $('assistedInput').value = 0;
}
/* Steppers : alignés sur le pas de l'input, bornés, jamais de flottant parasite.
   Tout passe par `snap` (arrondi par division exacte) pour ne jamais produire
   82.30000000000001 ni sortir des bornes. */
function snap(v, step, min, max){
  const k = Math.round(1 / step);
  const clamped = Math.min(max, Math.max(min, v));
  return Math.min(max, Math.max(min, Math.round(clamped * k) / k));
}
function stepTo(input, d, step, min, max){
  if (!input) return;
  const cur = parseFloat(input.value);
  const base = isNaN(cur) ? min : cur;
  input.value = String(snap(base + d, step, min, max));
}
function stepWeight(d){ stepTo($('weightInput'), d, 0.1, 0, 999); }
function stepReps(d){ stepTo($('repsInput'), d, 1, 0, 999); }
function stepAssisted(d){ stepTo($('assistedInput'), d, 1, 0, 999); }
function stepCardioMin(d){ stepTo($('cardioMinInput'), d, 1, 1, 1440); }
function stepCardioKm(d){ stepTo($('cardioKmInput'), d, 0.1, 0, 9999); }

function readNum(input, step, min, max){
  const v = parseFloat((input && input.value) || '');
  return snap(isNaN(v) ? min : v, step, min, max);
}

function saveSet(){
  if (addSetExIdx === null || !DB.active) return;
  const ex = DB.active.exercises[addSetExIdx];
  if (ex.cardio){
    const min = readNum($('cardioMinInput'), 1, 1, 1440);
    const km = readNum($('cardioKmInput'), 0.1, 0, 9999);
    if (!min) return;
    ex.sets.push({ cardio: true, min: min, km: km });
  } else {
    const weight = readNum($('weightInput'), 0.1, 0, 999);
    const reps = readNum($('repsInput'), 1, 0, 999);
    const assisted = readNum($('assistedInput'), 1, 0, 999);
    if (reps + assisted < 1) return;
    ex.sets.push({ weight: weight, reps: reps, assisted: assisted });
  }
  save();
  closeModal('addSetModal');
  addSetExIdx = null;
  resumeSession();
  startRest(DB.active.restSecs || 90);
}

/* ---------------- écart avec le programme (pas fait / ajouté) ---------------- */
function sessionDiff(){
  if (!DB.active) return { missing: [], added: [], planned: 0, done: 0 };
  const planned = DB.active.exercises.filter(e => !e.extra);
  const missing = planned.filter(e => !e.sets.length);
  const added = DB.active.exercises.filter(e => e.extra && e.sets.length);
  return { missing: missing, added: added, planned: planned.length, done: planned.length - missing.length };
}

/* Panneau « Compared with your program » : détecte ce qui n'a pas été fait
   et ce qui a été ajouté pendant la séance, et laisse décider si le programme change. */
function renderProgramDiff(){
  const el = $('sessRecap');
  if (!el) return;
  const d = sessionDiff();
  if (!d.missing.length && !d.added.length){ el.hidden = true; el.innerHTML = ''; return; }
  if (!DB.active.picks) DB.active.picks = {};
  const day = DB.active.dayId ? DB.programme.find(x => x.id === DB.active.dayId) : null;
  const dayName = day ? day.name : DB.active.dayName;

  let html = '<div class="recap-head">' +
    '<span class="recap-title">Compared with your program</span>' +
    '<span class="recap-score">' + d.done + '/' + d.planned + ' done</span></div>';

  html += d.added.map(ex => {
    const pick = DB.active.picks[ex.id] || '';
    const opts = ['<option value="">New here — keep it out of my program</option>',
      '<option value="add"' + (pick === 'add' ? ' selected' : '') + '>Add "' + esc(ex.name) + '" to ' + esc(dayName) + '</option>'];
    d.missing.forEach(m => {
      const val = 'replace:' + m.id;
      const taken = Object.keys(DB.active.picks).some(k => k !== ex.id && DB.active.picks[k] === val);
      opts.push('<option value="' + val + '"' + (pick === val ? ' selected' : '') + (taken ? ' disabled' : '') +
        '>Replace "' + esc(m.name) + '" in ' + esc(dayName) + '</option>');
    });
    return '<div class="recap-row">' +
      '<div class="recap-name">' + esc(ex.name) + ' <span class="chip chip-extra">New</span>' +
        '<span class="recap-meta">' + ex.sets.length + (ex.cardio ? ' run' : '×') + '</span></div>' +
      '<select class="input recap-sel" data-ex="' + ex.id + '" onchange="setRecapPick(this.dataset.ex, this.value)">' +
        opts.join('') + '</select>' +
    '</div>';
  }).join('');

  if (d.missing.length){
    html += '<div class="recap-sub">Not done today' + (d.added.length ? ' — replace one above, or leave it as planned' : '') + '</div>';
    html += d.missing.map(m => {
      const key = 'replace:' + m.id;
      const by = d.added.find(a => DB.active.picks[a.id] === key);
      return '<div class="recap-row recap-miss">' +
        '<div class="recap-name">' + esc(m.name) + '</div>' +
        '<div class="recap-tag">' + (by ? '↔ replaced by ' + esc(by.name) : 'Skipped · stays in your program') + '</div>' +
      '</div>';
    }).join('');
  }

  el.innerHTML = html;
  el.hidden = false;
}

function setRecapPick(exId, val){
  if (!DB.active) return;
  if (!DB.active.picks) DB.active.picks = {};
  if (val) DB.active.picks[exId] = val;
  else delete DB.active.picks[exId];
  save();
  renderProgramDiff();
}

/* Applique les choix (ajout / remplacement) sur le jour du programme */
function applyProgramPicks(picks, diff){
  const info = [];
  const day = DB.active.dayId ? DB.programme.find(x => x.id === DB.active.dayId) : null;
  if (!day){
    diff.added.forEach(a => info.push({ name: a.name, action: 'kept' }));
    return info;
  }
  let changed = false;
  diff.added.forEach(a => {
    const p = (picks || {})[a.id] || '';
    const already = day.exercises.some(e => e.name.toLowerCase() === a.name.toLowerCase());
    if (p === 'add' && !already){
      day.exercises.push({ id: uid(), name: a.name, cardio: a.cardio });
      changed = true;
      info.push({ name: a.name, action: 'added' });
    } else if (p.indexOf('replace:') === 0){
      const targetId = p.slice(8);
      const i = day.exercises.findIndex(e => e.id === targetId);
      if (i >= 0){
        const replacedName = day.exercises[i].name;
        day.exercises[i] = { id: uid(), name: a.name, cardio: a.cardio };
        changed = true;
        info.push({ name: a.name, action: 'replaced', replaces: replacedName });
      } else info.push({ name: a.name, action: 'kept' });
    } else info.push({ name: a.name, action: 'kept' });
  });
  if (changed) save();
  return info;
}

/* ---------------- ajouter un exercice pendant la séance ---------------- */
let addExFilter = 'All';
let addExQuery = '';

function openAddEx(){
  if (!DB.active) return;
  addExFilter = 'All'; addExQuery = '';
  const s = $('addExSearch'); if (s) s.value = '';
  const c = $('addExCustom'); if (c) c.value = '';
  renderAddEx();
  openModal('addExModal');
  setTimeout(() => { const i = $('addExSearch'); if (i) i.focus(); }, 120);
}

function normalizeForAlias(s){
  return String(s || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function onAddExSearch(v){
  const q = normalizeForAlias(v);
  const alias = aliasFrToEn(q);
  addExQuery = alias !== null ? alias : v;
  if (addExQuery.trim() && addExFilter !== 'All') addExFilter = 'All';
  renderAddEx();
}

function renderAddEx(){
  if (!DB.active || !$('addExGrid')) return;
  const have = new Set(DB.active.exercises.map(e => e.name.toLowerCase()));
  const all = libEntries();
  const counts = {};
  all.forEach(e => counts[e.group] = (counts[e.group] || 0) + 1);
  const catGroups = [...new Set(all.filter(e => !e.custom).map(e => e.group).filter(Boolean))].sort();
  const groups = ['All'].concat(catGroups, counts['Custom'] ? ['Custom'] : []);

  $('addExChips').innerHTML = groups.map(g => {
    const n = g === 'All' ? all.length : (counts[g] || 0);
    return '<button class="lib-chip' + (addExFilter === g ? ' on' : '') + '" data-g="' + g + '">' +
      esc(g) + ' <span class="n">' + n + '</span></button>';
  }).join('');
  $('addExChips').querySelectorAll('.lib-chip').forEach(b => b.onclick = () => { addExFilter = b.dataset.g; renderAddEx(); });

  const q = addExQuery.toLowerCase().trim();
  const list = all.filter(e =>
    (addExFilter === 'All' || e.group === addExFilter) &&
    (!q || e.name.toLowerCase().includes(q) || e.group.toLowerCase().includes(q))
  );
  $('addExGrid').innerHTML = list.length
    ? list.map(e => {
        const on = have.has(e.name.toLowerCase());
        return '<button class="lib-item' + (on ? ' on' : '') + '" data-name="' + esc(e.name) + '">' +
          libThumb(e.name) +
          '<span>' + esc(e.name) + '<span class="grp">' + esc(e.group) + '</span></span>' +
          '<span class="lib-tick">' + (on ? icon('check') : '+') + '</span></button>';
      }).join('')
    : '<div class="lib-empty">No result.<br>Type it below, it stays in this session only.</div>';
  $('addExGrid').querySelectorAll('.lib-item').forEach(b => b.onclick = () => toggleSessionExercise(b.dataset.name));

  $('addExHint').textContent = list.length + ' exercise' + (list.length !== 1 ? 's' : '') + ' shown' +
    (have.size ? ' · ' + have.size + ' in this session' : '');
}

function addSessionExercise(name){
  const ex = { id: uid(), name: name, extra: true, cardio: isCardioName(name) || undefined, sets: [] };
  DB.active.exercises.push(ex);
  if (!DB.active.picks) DB.active.picks = {};
  return ex;
}

function toggleSessionExercise(name){
  if (!DB.active) return;
  const i = DB.active.exercises.findIndex(e => e.name.toLowerCase() === name.toLowerCase());
  if (i >= 0){
    const ex = DB.active.exercises[i];
    if (ex.sets.length && !confirm('Remove "' + name + '" from this session?\n' + ex.sets.length + ' set(s) will be lost.')) {
      renderAddEx();
      return;
    }
    DB.active.exercises.splice(i, 1);
    if (DB.active.picks) delete DB.active.picks[ex.id];
    toast('"' + name + '" removed from this session');
  } else {
    addSessionExercise(name);
    toast('"' + name + '" added to this session');
  }
  save();
  renderAddEx();
  resumeSession();
}

function addExCustom(){
  const input = $('addExCustom');
  const name = input ? input.value.trim() : '';
  if (!name || !DB.active) { if (input) input.focus(); return; }
  if (DB.active.exercises.some(e => e.name.toLowerCase() === name.toLowerCase())){
    toast('Already in this session');
    input.value = '';
    return;
  }
  addSessionExercise(name);
  if (!libEntries().some(e => e.name.toLowerCase() === name.toLowerCase())){
    if (!DB.custom) DB.custom = [];
    if (!DB.custom.some(n => n.toLowerCase() === name.toLowerCase())) DB.custom.push(name);
  }
  save();
  input.value = '';
  renderAddEx();
  resumeSession();
  toast('"' + name + '" added to this session');
  input.focus();
}

function removeActiveExercise(exId){
  if (!DB.active) return;
  const i = DB.active.exercises.findIndex(e => e.id === exId);
  if (i < 0) return;
  const ex = DB.active.exercises[i];
  if (!ex.extra) return;
  if (ex.sets.length && !confirm('Remove "' + ex.name + '" from this session?\n' + ex.sets.length + ' set(s) will be lost.')) return;
  DB.active.exercises.splice(i, 1);
  if (DB.active.picks) delete DB.active.picks[ex.id];
  save();
  resumeSession();
  toast('"' + ex.name + '" removed from this session');
}

/* ---------------- timer de repos ---------------- */
let _restLoop = null;

function startRest(secs){
  if (!DB.active) return;
  DB.active.restSecs = Math.max(10, +secs || 90);
  DB.active.restUntil = Date.now() + DB.active.restSecs * 1000;
  DB.active.restDone = false;
  save();
  restTick();
  restLoop();
}

function restAdd(d){
  if (!DB.active) return;
  if (!DB.active.restUntil){ startRest(90); return; }
  DB.active.restUntil = Math.max(Date.now(), DB.active.restUntil + d * 1000);
  DB.active.restSecs = Math.max(10, (DB.active.restSecs || 90) + d);
  if (DB.active.restUntil <= Date.now()) DB.active.restDone = true;
  save();
  restTick();
}

function restSkip(){
  if (!DB.active) return;
  DB.active.restUntil = Date.now();
  DB.active.restDone = true;
  save();
  restTick();
}

function restTick(){
  const bar = $('restBar');
  if (!bar) return;
  if (!DB.active || !DB.active.restUntil){
    bar.classList.remove('done');
    $('restStartBtn').style.display = '';
    $('restRunning').style.display = 'none';
    $('restTime').textContent = 'Rest';
    return;
  }
  const left = DB.active.restUntil - Date.now();
  if (left <= 0){
    $('restTime').textContent = 'Ready!';
    $('restStartBtn').style.display = 'none';
    $('restRunning').style.display = '';
    if (!DB.active.restDone){
      DB.active.restDone = true;
      save();
      toast('Rest over');
      if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
    }
    bar.classList.add('done');
    return;
  }
  const s = Math.ceil(left / 1000);
  $('restTime').textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  $('restStartBtn').style.display = 'none';
  $('restRunning').style.display = '';
  bar.classList.remove('done');
}

function restLoop(){
  if (_restLoop) return;
  restTick();
  _restLoop = setInterval(restTick, 500);
}

function restStopLoop(){
  if (_restLoop){ clearInterval(_restLoop); _restLoop = null; }
}

function removeSet(exIdx, setIdx){
  DB.active.exercises[exIdx].sets.splice(setIdx, 1);
  save(); renderActive(); resumeSession();
}

function saveSessNote(){ if (DB.active){ DB.active.note = $('sessNote').value; save(); } }

function cancelSession(){
  if (!DB.active) return;
  const sets = DB.active.exercises.reduce((n, e) => n + e.sets.length, 0);
  if (!confirm('Quit this session? ' + (sets ? sets + ' set(s) will be lost.' : ''))) return;
  DB.active = null; save();
  restStopLoop();
  closeModal('activeModal'); renderSeance();
}

function finishSession(){
  if (!DB.active) return;
  let totalSets = 0, volume = 0, performed = 0;
  DB.active.exercises.forEach(ex => {
    totalSets += ex.sets.length;
    if (ex.sets.length) performed++;
    ex.sets.forEach(s => volume += volumeOf(s));
  });
  const ct = cardioTotals(DB.active.exercises);
  const n = totalSets;
  const mixed = ct.min && volume;
  const unit = mixed ? 'line' + (n !== 1 ? 's' : '') : (ct.min ? 'run' + (n !== 1 ? 's' : '') : 'set' + (n !== 1 ? 's' : ''));
  const what = mixed ? fmtVolume(volume) + ' volume' + (ct.min ? ' + ' + fmtNum(ct.km) + ' km' : '')
    : (ct.min ? fmtNum(ct.km) + ' km · ' + ct.min + ' min' : fmtVolume(volume) + ' volume');
  if (!totalSets){
    if (!confirm('No sets recorded. Finish anyway?')) return;
  } else if (!confirm('Finish the session "' + DB.active.dayName + '"?\n' + n + ' ' + unit + ' · ' + what)) return;

  const diff = sessionDiff();
  const addedInfo = applyProgramPicks(DB.active.picks, diff);
  const progNote = addedInfo.filter(a => a.action !== 'kept').map(a =>
    a.action === 'added' ? '+ ' + a.name : a.name + ' replaces ' + (a.replaces || '?')).join(' · ');

  DB.history.unshift({
    missing: diff.missing.map(m => m.name),
    added: addedInfo,
    id: uid(),
    date: todayISO(),
    dayId: DB.active.dayId,
    dayName: DB.active.dayName,
    startedAt: DB.active.startedAt,
    endedAt: Date.now(),
    note: DB.active.note || '',
    exercises: DB.active.exercises.filter(e => e.sets.length),
    totalSets: totalSets,
    volume: Math.round(volume),
    performed: performed,
    cardioMin: ct.min,
    cardioKm: ct.km
  });

  let prsHit = 0;
  DB.active.exercises.forEach(ex => ex.sets.forEach(s => { if (!s.cardio && updatePR(ex.name, s.weight, s.reps, s.assisted)) prsHit++; }));
  DB.active = null;
  save();
  restStopLoop();
  if (prsHit && navigator.vibrate) navigator.vibrate([60, 50, 60, 50, 160]);
  closeModal('activeModal');
  renderAll();
  showSessionComment(DB.history[0], prsHit,
    n + ' ' + unit + ' · ' + what +
    (prsHit ? '\nRecord broken · ' + prsHit + ' PR' + (prsHit > 1 ? 's' : '') : '') +
    (progNote ? '\nProgram: ' + progNote : '') +
    (diff.missing.length ? '\nNot done today: ' + diff.missing.map(m => m.name).join(', ') : ''));
}

function updatePR(name, weight, reps, assisted){
  const key = name.toLowerCase().trim();
  const cur = DB.prs[key];
  const better = !cur || weight > cur.weight || (weight === cur.weight && reps > cur.reps);
  if (!better) return false;
  const prev = cur ? { weight: cur.weight, reps: cur.reps, assisted: cur.assisted || 0 } : null;
  DB.prs[key] = { name, weight, reps, assisted: assisted || 0, date: todayISO() };
  if (!Array.isArray(DB.prLog)) DB.prLog = [];
  DB.prLog.unshift({
    date: todayISO(), key: key, name: name,
    weight: weight, reps: reps, assisted: assisted || 0, prev: prev
  });
  return true;
}

Object.assign(window, {
  renderSeance, startSession, resumeSession, renderActive, openAddSet,
  stepWeight, stepReps, stepAssisted, stepCardioMin, stepCardioKm, saveSet, removeSet, saveSessNote,
  cancelSession, finishSession, updatePR, applySuggestion,
  sessionDiff, renderProgramDiff, setRecapPick, applyProgramPicks,
  openAddEx, onAddExSearch, renderAddEx, toggleSessionExercise, addSessionExercise,
  addExCustom, removeActiveExercise,
  startRest, restAdd, restSkip, restTick, restLoop, restStopLoop
});
