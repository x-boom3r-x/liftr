/* ==================================================================
   LIFTR - seance en cours
   ================================================================== */
import { icon, iconS } from './icons.js';
import { getCatalogue, loadCatalogue, aliasFrToEn } from './gym/exercises.js';
import { repSequenceOf } from './gym/progression.js';

/* Démarre le chargement du catalogue openGym dès l'import du module. */
loadCatalogue();

let addSetExIdx = null;
let timedHoldInterval = null;

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
    el.innerHTML = '<div class="empty"><div class="empty-icon">' + iconS('flex') + '</div>' +
      '<div class="empty-text">No programmed days yet. You can still start a free session.</div></div>' +
      freeSessionButton(!!DB.active);
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
        '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-top:12px">' +
        '<button class="btn btn-primary btn-sm" style="flex:1" ' + (d.exercises.length && !DB.active ? '' : 'disabled') +
          ' onclick="startSession(\'' + d.id + '\')">Start</button>' +
        '<button class="btn btn-sm" onclick="openDayDetail(\'' + d.id + '\')">Exercises</button>' +
      '</div>' +
    '</div>';
  }).join('') + freeSessionButton(!!DB.active);
}

function freeSessionButton(disabled){
  return '<div class="free-session-cta"><button type="button" class="btn" onclick="startFreeSession()"' +
    (disabled ? ' disabled' : '') + '>Start a free session</button></div>';
}

function plannedSessionExercises(day){
  const groups = new Map();
  day.exercises.forEach(ex => {
    if (!ex.groupId) return;
    if (!groups.has(ex.groupId)) groups.set(ex.groupId, []);
    groups.get(ex.groupId).push(ex.id);
  });
  return day.exercises.map(ex => {
    const timed = Number(ex.seconds) > 0;
    const pyramid = timed ? [] : repSequenceOf(ex.reps);
    const planned = {
      sets: pyramid.length ? pyramid.length : (ex.sets ?? null),
      reps: timed ? null : (ex.reps ?? null),
      weight: timed ? null : (ex.weight ?? null),
      mode: timed ? 'time' : null,
      sec: timed ? Math.max(1, Math.min(86400, Math.round(Number(ex.seconds)))) : null,
      rest: ex.rest ?? null,
      progression: pyramid.length ? 'off' : (ex.progression || (timed ? 'time' : 'double')),
      setsMax: ex.setsMax ?? null,
      notes: ex.notes == null ? '' : String(ex.notes)
    };
    if (pyramid.length) planned.pyramid = pyramid;
    if (ex.groupId){
      const members = groups.get(ex.groupId) || [];
      if (members.length > 1){
        planned.groupId = ex.groupId;
        planned.groupType = ex.groupType === 'circuit' ? 'circuit' : 'superset';
        planned.groupIndex = members.indexOf(ex.id) + 1;
        planned.groupCount = members.length;
      }
    }
    const hasTarget = planned.sets != null || planned.reps != null || planned.weight != null ||
      planned.sec != null || planned.rest != null || planned.notes.trim() || planned.groupId;
    return {
      id: ex.id,
      name: ex.name,
      cardio: !!ex.cardio || undefined,
      planned: hasTarget ? planned : null,
      sets: []
    };
  });
}

function startSession(dayId){
  const d = window.getActiveProgrammeDays().find(x => x.id === dayId);
  if (!d || !d.exercises.length) return;
  if (DB.active && !confirm('A session is already in progress. Replace it?')) return;
  const program = DB.programmes.find(p => p.id === d.programId) || null;
  DB.active = {
    id: uid(),
    sourceType: 'program',
    programId: d.programId || null,
    programName: program ? program.name : null,
    dayId: d.id,
    dayName: d.name,
    startedAt: Date.now(),
    note: '',
    exercises: plannedSessionExercises(d)
  };
  save();
  renderSeance();
  resumeSession();
}

function startFreeSession(){
  if (DB.active && !confirm('A session is already in progress. Replace it?')) return;
  DB.active = {
    id: uid(), sourceType: 'free', programId: null, programName: null,
    dayId: null, dayName: 'Free session', startedAt: Date.now(), note: '', exercises: []
  };
  save();
  renderSeance();
  resumeSession();
}

function resumeSession(){
  if (!DB.active) return;
  syncRestDefaultUI();
  const d = sessionDiff();
  $('activeTitle').textContent = DB.active.dayName;
  $('activeSub').textContent = new Date(DB.active.startedAt).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit' }) +
    ' · ' + DB.active.exercises.reduce((n, e) => n + e.sets.length, 0) + ' sets' +
    (d.planned ? ' · ' + d.done + '/' + d.planned + ' done' : '');
  $('sessNote').value = DB.active.note || '';
  renderActive();
  restLoop();
  openModal('activeModal');
  if (DB.active.holdTimer) openAddSet(DB.active.holdTimer.exIdx);
}

function renderPlannedGoal(ex){
  const p = ex && ex.planned;
  if (!p) return '';
  const values = [];
  if (p.sets != null && p.sets !== '') values.push(esc(p.sets) + ' sets');
  if (p.mode === 'time'){
    if (p.sec != null) values.push(esc(p.sec) + ' s hold');
  } else if (Array.isArray(p.pyramid) && p.pyramid.length){
    values.push(esc(p.pyramid.map(value => value === 'max' ? 'Max' : value).join(' · ')) + ' reps · pyramid');
  } else if (p.reps != null && p.reps !== '') values.push(esc(p.reps) + ' reps');
  if (p.mode !== 'time' && p.weight != null && p.weight !== '') values.push(fmtNum(p.weight) + ' kg');
  if (p.rest != null && p.rest !== '') values.push(esc(p.rest) + ' s rest');
  const group = p.groupId
    ? '<span class="planned-group">' + (p.groupType === 'circuit' ? 'Circuit' : 'Superset') +
      (p.groupIndex && p.groupCount ? ' · ' + p.groupIndex + '/' + p.groupCount : '') + '</span>'
    : '';
  return '<div class="planned-goal">' +
    '<div class="planned-goal-label">Programmed objective</div>' +
    (values.length ? '<div class="planned-goal-values">' + values.join(' · ') + '</div>' : '') +
    group +
    (p.notes ? '<div class="planned-goal-notes">' + esc(p.notes) + '</div>' : '') +
  '</div>';
}

function renderDropRows(set, exIdx, setIdx){
  if (set.timed || isWarmupSet(set)) return '';
  const drops = Array.isArray(set.drops) ? set.drops : [];
  return '<div class="set-additions">' +
    drops.map((drop, dropIdx) =>
      '<div class="set-addition-row">' +
        '<span class="set-addition-name">Drop ' + (dropIdx + 1) + '</span>' +
        '<span class="set-addition-load">' + fmtNum(drop.weight) + ' kg × ' + fmtNum(drop.reps) + '</span>' +
        '<span class="set-addition-controls">' +
          '<button type="button" aria-label="Decrease drop weight" onclick="stepDropSet(' + exIdx + ',' + setIdx + ',' + dropIdx + ',\'weight\',-0.5)">−</button>' +
          '<button type="button" aria-label="Increase drop weight" onclick="stepDropSet(' + exIdx + ',' + setIdx + ',' + dropIdx + ',\'weight\',0.5)">+</button>' +
          '<button type="button" aria-label="Decrease drop reps" onclick="stepDropSet(' + exIdx + ',' + setIdx + ',' + dropIdx + ',\'reps\',-1)">−</button>' +
          '<button type="button" aria-label="Increase drop reps" onclick="stepDropSet(' + exIdx + ',' + setIdx + ',' + dropIdx + ',\'reps\',1)">+</button>' +
          '<button type="button" class="set-addition-remove" aria-label="Remove drop set" onclick="removeDropSet(' + exIdx + ',' + setIdx + ',' + dropIdx + ')">×</button>' +
        '</span>' +
      '</div>'
    ).join('') +
    (!set.cardio ? '<button type="button" class="set-addition-add" onclick="addDropSet(' + exIdx + ',' + setIdx + ')">+ Drop set</button>' : '') +
  '</div>';
}

function renderRestPauseRows(set, exIdx, setIdx){
  if (set.timed || isWarmupSet(set)) return '';
  const clusters = set.restPause && Array.isArray(set.restPause.clusters) ? set.restPause.clusters : [];
  return '<div class="set-additions set-bursts">' +
    clusters.map((cluster, clusterIdx) =>
      '<div class="set-addition-row">' +
        '<span class="set-addition-name">Burst ' + (clusterIdx + 1) + '</span>' +
        '<span class="set-addition-load">+' + fmtNum(cluster.reps) + ' reps · ' + fmtNum(cluster.restSec) + ' s rest</span>' +
        '<span class="set-addition-controls">' +
          '<button type="button" aria-label="Decrease burst reps" onclick="stepRestPause(' + exIdx + ',' + setIdx + ',' + clusterIdx + ',\'reps\',-1)">−</button>' +
          '<button type="button" aria-label="Increase burst reps" onclick="stepRestPause(' + exIdx + ',' + setIdx + ',' + clusterIdx + ',\'reps\',1)">+</button>' +
          '<button type="button" aria-label="Decrease burst rest" onclick="stepRestPause(' + exIdx + ',' + setIdx + ',' + clusterIdx + ',\'restSec\',-5)">−5s</button>' +
          '<button type="button" aria-label="Increase burst rest" onclick="stepRestPause(' + exIdx + ',' + setIdx + ',' + clusterIdx + ',\'restSec\',5)">+5s</button>' +
          '<button type="button" class="set-addition-remove" aria-label="Remove rest-pause burst" onclick="removeRestPause(' + exIdx + ',' + setIdx + ',' + clusterIdx + ')">×</button>' +
        '</span>' +
      '</div>'
    ).join('') +
    (!set.cardio ? '<button type="button" class="set-addition-add" onclick="addRestPause(' + exIdx + ',' + setIdx + ')">+ Rest-pause burst</button>' : '') +
  '</div>';
}

function renderActive(){
  const el = $('activeExercises');
  if (!DB.active) return;
  el.innerHTML = DB.active.exercises.map((ex, i) => {
    const timed = !!(ex.planned && ex.planned.mode === 'time');
    return '<div class="ex-block">' +
      '<div class="ex-name"><span class="ex-title">' + esc(ex.name) +
        (ex.cardio ? '<span class="chip chip-cardio">CARDIO</span>' : '') +
        (timed ? '<span class="chip chip-type">TIMED</span>' : '') +
        (ex.extra ? '<span class="chip chip-extra">New</span>' : '') +
        '</span>' + demoBtn(ex.name) + '<span class="ex-tags">' +
        '<span class="chip chip-type">' + ex.sets.length + (ex.cardio ? ' run' + (ex.sets.length !== 1 ? 's' : '') : timed ? ' hold' + (ex.sets.length !== 1 ? 's' : '') : '×') + '</span>' +
        (ex.extra ? '<span class="icon-btn danger ex-del" onclick="removeActiveExercise(\'' + ex.id + '\')" title="Remove from this session">×</span>' : '') +
        '</span></div>' +
      renderPlannedGoal(ex) +
      activeHistLine(ex.name, ex.cardio, ex.planned) +
      (ex.sets.length
        ? ex.sets.map((s, si) =>
            '<div class="set-entry">' +
              '<div class="set-row"><div class="set-num">' + (si + 1) + '</div>' +
              '<div class="set-values">' + setLine(s) + '</div>' +
              '<button class="set-del" onclick="removeSet(' + i + ',' + si + ')">×</button></div>' +
              renderDropRows(s, i, si) +
              renderRestPauseRows(s, i, si) +
            '</div>'
          ).join('')
        : '<div class="ex-empty">' + (ex.cardio ? 'No runs' : timed ? 'No holds' : 'No sets') + (ex.extra ? ' yet' : ' — not done today') + '</div>') +
      '<button class="add-set-btn" onclick="openAddSet(' + i + ')">+ ' + (ex.cardio ? 'Run' : timed ? 'Hold' : 'Set') + '</button>' +
    '</div>'
  }).join('');
  renderProgramDiff();
}

function openAddSet(exIdx){
  /* Réouverture pendant qu'on ajuste déjà les valeurs : on garde ce que
     l'utilisateur vient de taper, on ne re-préremplit pas par-dessus. */
  const box = $('addSetModal');
  const alreadyOpen = !!(box && box.classList.contains('show'));
  if (DB.active.holdTimer && DB.active.holdTimer.exIdx !== exIdx){
    toast('Finish or cancel the active timed hold first.');
    return;
  }
  addSetExIdx = exIdx;
  const ex = DB.active.exercises[exIdx];
  const last = ex.sets.length ? ex.sets[ex.sets.length - 1] : null;
  const isCardio = !!ex.cardio;
  const isTimed = !isCardio && !!(ex.planned && ex.planned.mode === 'time');
  const strength = $('strengthFields'), cardioBox = $('cardioFields'), timeBox = $('timeFields');
  if (strength) strength.hidden = isCardio || isTimed;
  if (cardioBox) cardioBox.hidden = !isCardio;
  if (timeBox) timeBox.hidden = !isTimed;
  const warmupRow = $('warmupFlagRow'), failureRow = $('failureFlagRow');
  if (warmupRow) warmupRow.hidden = isCardio;
  if (failureRow) failureRow.hidden = isCardio || isTimed;
  const okBtn = $('saveSetBtn');
  if (okBtn) okBtn.textContent = isCardio ? 'Save run' : isTimed ? 'Save hold' : 'Save set';
  const sub = $('addSetModal').querySelector('.modal-sub');
  if (sub){
    sub.hidden = isCardio;
    sub.textContent = isTimed
      ? 'Start the hold timer when you begin. You can finish early and save the time actually held.'
      : 'Assisted reps count when the movement is helped (partner, machine).';
  }
  const plannedHint = $('plannedSetPrefill');
  if (plannedHint) plannedHint.hidden = true;

  if (alreadyOpen){
    if (DB.active.holdTimer){ syncTimedHoldUI(); startTimedHoldLoop(); }
    return;
  }

  if ($('effortInput')) $('effortInput').value = '';
  if ($('effortScale')) $('effortScale').value = 'rir';
  if ($('cardioRpeInput')) $('cardioRpeInput').value = '';
  if ($('warmupInput')) $('warmupInput').checked = false;
  if ($('failureInput')) $('failureInput').checked = false;
  setEffortScale();
  syncSetFlags();

  if (isCardio){
    const p = last && last.cardio ? last : (cardioHistory(ex.name) || null);
    $('addSetTitle').textContent = 'Run · ' + ex.name;
    if ($('cardioMinInput')) $('cardioMinInput').value = p ? (p.min || 30) : 30;
    if ($('cardioKmInput')) $('cardioKmInput').value = p ? (p.km || 5) : 5;
  } else if (isTimed){
    $('addSetTitle').textContent = 'Timed hold · ' + ex.name;
    const p = ex.planned || {};
    const previous = last && last.timed ? last.sec : null;
    const target = plannedNumber(p.sec, true);
    if ($('holdSecondsInput')) $('holdSecondsInput').value = target || previous || 30;
    if (plannedHint){
      plannedHint.textContent = target
        ? 'Programmed hold target: ' + target + ' seconds. The timer records the time actually held.'
        : 'Enter the hold duration, then start the timer.';
      plannedHint.hidden = false;
    }
  } else {
    $('addSetTitle').textContent = 'Set · ' + ex.name;
    const p = ex.planned || {};
    const targetWeight = plannedNumber(p.weight, false);
    const sequence = repSequenceOf(p.reps);
    const workIndex = ex.sets.filter(isWorkingSet).length;
    const rowTarget = sequence.length ? sequence[Math.min(workIndex, sequence.length - 1)] : null;
    const targetReps = sequence.length
      ? (rowTarget === 'max' ? null : Number(rowTarget))
      : plannedNumber(p.reps, true);
    $('weightInput').value = last ? last.weight : (targetWeight == null ? 20 : targetWeight);
    $('repsInput').value = sequence.length
      ? (targetReps == null ? 10 : targetReps)
      : (last ? last.reps : (targetReps == null ? 10 : targetReps));
    $('assistedInput').value = 0;
    if (sequence.length && rowTarget === 'max' && plannedHint) plannedHint.textContent = 'Set target: Max reps. Record the clean reps you actually completed.';
    else if (plannedHint) plannedHint.textContent = 'Prefilled from the programmed target. Saved values are your actual results.';
    if (!last && plannedHint && (targetWeight != null || targetReps != null)) plannedHint.hidden = false;
    else if (sequence.length && plannedHint) plannedHint.hidden = false;
  }
  renderSetContext(ex.name, isCardio);
  openModal('addSetModal');
  if (isTimed) syncTimedHoldUI();
  if (DB.active.holdTimer) startTimedHoldLoop();
}

function plannedNumber(value, integer){
  if (value == null || String(value).trim() === '') return null;
  const match = String(value).match(/\d+(?:[.,]\d+)?/);
  if (!match) return null;
  const number = Number(match[0].replace(',', '.'));
  return Number.isFinite(number) ? (integer ? Math.round(number) : number) : null;
}

function restForExercise(ex){
  const target = ex && ex.planned ? ex.planned.rest : null;
  if (target == null || String(target).trim() === '') return Math.max(0, Math.min(900, Number(DB.restDefaultSecs ?? 90)));
  const seconds = plannedNumber(target, true);
  return seconds == null ? Math.max(0, Math.min(900, Number(DB.restDefaultSecs ?? 90))) : Math.max(0, Math.min(900, seconds));
}

function restAfterSet(ex){
  const planned = ex && ex.planned;
  if (!planned || !planned.groupId) return restForExercise(ex);
  const members = (DB.active && DB.active.exercises || []).filter(item => item.planned && item.planned.groupId === planned.groupId);
  if (members.length < 2 || Number(planned.groupIndex) < Number(planned.groupCount)) return 0;
  const explicit = members.map(item => item.planned.rest).filter(value => value != null && String(value).trim() !== '')
    .map(value => plannedNumber(value, true)).filter(value => value != null);
  return explicit.length ? Math.max(...explicit) : Math.max(0, Math.min(900, Number(DB.restDefaultSecs ?? 90)));
}

function applySuggestion(){
  const ex = (DB.active && addSetExIdx != null) ? DB.active.exercises[addSetExIdx] : null;
  const sug = ex ? suggestFor(ex.name, ex.cardio, ex.planned) : null;
  if (!sug) return;
  if (sug.timed){
    if ($('holdSecondsInput')) $('holdSecondsInput').value = sug.sec;
    return;
  }
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
function stepHoldSec(d){ stepTo($('holdSecondsInput'), d, 1, 1, 86400); }

function syncTimedHoldUI(){
  const timer = DB.active && DB.active.holdTimer;
  const running = !!(timer && timer.exIdx === addSetExIdx);
  const input = $('holdSecondsField'), controls = $('holdTimerControls');
  if (input) input.hidden = running;
  if (controls) controls.hidden = !running;
  const start = $('startHoldBtn'), finish = $('finishHoldBtn'), cancel = $('cancelHoldBtn');
  if (start) start.hidden = running;
  if (finish) finish.hidden = !running;
  if (cancel) cancel.hidden = !running;
  const saveBtn = $('saveSetBtn');
  if (saveBtn) saveBtn.hidden = running;
  const warmup = $('warmupInput');
  if (running && warmup) warmup.checked = !!timer.warmup;
  if (running) updateTimedHoldDisplay();
}

function updateTimedHoldDisplay(){
  const timer = DB.active && DB.active.holdTimer;
  if (!timer) return;
  const elapsed = Math.max(0, Math.floor((Date.now() - timer.startedAt) / 1000));
  const remaining = Math.max(0, timer.targetSec - elapsed);
  const clock = $('holdCountdown');
  const held = $('holdElapsed');
  if (clock) clock.textContent = remaining ? remaining + ' s remaining' : '0 s remaining';
  if (held) held.textContent = 'Held ' + Math.min(timer.targetSec, elapsed) + ' s';
  if (elapsed >= timer.targetSec) finishTimedHold(true);
}

function startTimedHoldLoop(){
  if (timedHoldInterval) clearInterval(timedHoldInterval);
  if (!DB.active || !DB.active.holdTimer) return;
  updateTimedHoldDisplay();
  if (!DB.active || !DB.active.holdTimer) return;
  timedHoldInterval = setInterval(updateTimedHoldDisplay, 200);
}

function startTimedHold(){
  const ex = DB.active && DB.active.exercises[addSetExIdx];
  if (!ex || !ex.planned || ex.planned.mode !== 'time' || DB.active.holdTimer) return;
  const sec = readNum($('holdSecondsInput'), 1, 1, 86400);
  DB.active.holdTimer = {
    exIdx: addSetExIdx,
    startedAt: Date.now(),
    targetSec: sec,
    warmup: !!($('warmupInput') && $('warmupInput').checked)
  };
  save();
  syncTimedHoldUI();
  startTimedHoldLoop();
}

function finishTimedHold(auto = false){
  const timer = DB.active && DB.active.holdTimer;
  if (!timer) return false;
  const elapsed = Math.max(0, Math.floor((Date.now() - timer.startedAt) / 1000));
  if (!auto && elapsed < 1){ toast('Hold for at least one second before saving.'); return false; }
  const ex = DB.active.exercises[timer.exIdx];
  if (!ex) return false;
  const set = { timed: true, sec: Math.max(1, Math.min(timer.targetSec, elapsed)) };
  if (timer.warmup) set.phase = 'warmup';
  ex.sets.push(set);
  delete DB.active.holdTimer;
  if (timedHoldInterval){ clearInterval(timedHoldInterval); timedHoldInterval = null; }
  save();
  closeModal('addSetModal');
  addSetExIdx = null;
  resumeSession();
  startRest(restAfterSet(ex));
  if (auto){
    if (navigator.vibrate) navigator.vibrate([80, 60, 120]);
    toast('Timed hold complete · ' + set.sec + ' seconds.');
  } else toast('Hold saved · ' + set.sec + ' seconds.');
  return true;
}

function cancelTimedHold(){
  if (!DB.active || !DB.active.holdTimer) return;
  delete DB.active.holdTimer;
  if (timedHoldInterval){ clearInterval(timedHoldInterval); timedHoldInterval = null; }
  save();
  syncTimedHoldUI();
}

function readNum(input, step, min, max){
  const v = parseFloat((input && input.value) || '');
  return snap(isNaN(v) ? min : v, step, min, max);
}

function readOptionalEffort(input, min){
  if (!input || String(input.value).trim() === '') return null;
  const value = Number(input.value);
  if (!Number.isFinite(value) || value < min || value > 10) return null;
  return Math.round(value * 2) / 2;
}

function stepEffort(dir){
  const input = $('effortInput');
  if (!input) return;
  const min = $('effortScale') && $('effortScale').value === 'rpe' ? 6 : 0;
  const current = readOptionalEffort(input, min);
  const next = current == null ? (dir > 0 ? min : null) : Math.min(10, Math.max(min, current + dir * 0.5));
  input.value = next == null ? '' : String(next);
}

function setEffortScale(){
  const input = $('effortInput');
  const scale = $('effortScale');
  if (!input || !scale) return;
  const min = scale.value === 'rpe' ? 6 : 0;
  input.min = String(min);
  if (input.value !== '' && Number(input.value) < min) input.value = '';
}

function syncSetFlags(){
  const warmup = $('warmupInput'), failure = $('failureInput');
  if (!warmup || !failure) return;
  if (warmup.checked){
    failure.checked = false;
    if ($('effortInput')) $('effortInput').value = '';
    const field = $('strengthEffortField');
    if (field) field.hidden = true;
  } else {
    const field = $('strengthEffortField');
    if (field) field.hidden = false;
  }
  if (failure.checked) warmup.checked = false;
  failure.disabled = warmup.checked;
}

function saveSet(){
  if (addSetExIdx === null || !DB.active) return;
  const ex = DB.active.exercises[addSetExIdx];
  if (ex.cardio){
    const min = readNum($('cardioMinInput'), 1, 1, 1440);
    const km = readNum($('cardioKmInput'), 0.1, 0, 9999);
    if (!min) return;
    const set = { cardio: true, min: min, km: km };
    const rpe = readOptionalEffort($('cardioRpeInput'), 6);
    if ($('cardioRpeInput') && $('cardioRpeInput').value.trim() && rpe == null){ toast('RPE must be between 6 and 10.'); return; }
    if (rpe != null) set.rpe = rpe;
    ex.sets.push(set);
  } else if (ex.planned && ex.planned.mode === 'time'){
    if (DB.active.holdTimer){ finishTimedHold(false); return; }
    const sec = readNum($('holdSecondsInput'), 1, 1, 86400);
    const set = { timed: true, sec };
    if ($('warmupInput') && $('warmupInput').checked) set.phase = 'warmup';
    ex.sets.push(set);
  } else {
    const weight = readNum($('weightInput'), 0.1, 0, 999);
    const reps = readNum($('repsInput'), 1, 0, 999);
    const assisted = readNum($('assistedInput'), 1, 0, 999);
    if (reps + assisted < 1) return;
    const set = { weight: weight, reps: reps, assisted: assisted };
    const sequence = repSequenceOf(ex.planned && ex.planned.reps);
    const workIndex = ex.sets.filter(isWorkingSet).length;
    if (sequence.length && sequence[Math.min(workIndex, sequence.length - 1)] === 'max') set.max = true;
    const scale = $('effortScale') && $('effortScale').value === 'rpe' ? 'rpe' : 'rir';
    const effort = readOptionalEffort($('effortInput'), scale === 'rpe' ? 6 : 0);
    if ($('effortInput') && $('effortInput').value.trim() && effort == null){
      toast(scale === 'rpe' ? 'RPE must be between 6 and 10.' : 'RIR must be between 0 and 10.');
      return;
    }
    if (effort != null) set[scale] = effort;
    if ($('warmupInput') && $('warmupInput').checked) set.phase = 'warmup';
    else if ($('failureInput') && $('failureInput').checked) set.failure = true;
    ex.sets.push(set);
  }
  save();
  closeModal('addSetModal');
  addSetExIdx = null;
  resumeSession();
  startRest(restAfterSet(ex));
}

function addDropSet(exIdx, setIdx){
  const ex = DB.active && DB.active.exercises[exIdx];
  const set = ex && ex.sets[setIdx];
  if (!set || ex.cardio || set.timed || isWarmupSet(set)) return;
  if (!Array.isArray(set.drops)) set.drops = [];
  const previous = set.drops.length ? set.drops[set.drops.length - 1] : set;
  const weight = Math.max(0, Math.round((Number(previous.weight) || 0) * 0.8 * 2) / 2);
  const reps = Math.max(1, Math.round(Number(previous.reps) || 1));
  set.drops.push({ weight, reps });
  save();
  renderActive();
  resumeSession();
}

function stepDropSet(exIdx, setIdx, dropIdx, field, delta){
  const set = DB.active && DB.active.exercises[exIdx] && DB.active.exercises[exIdx].sets[setIdx];
  const drop = set && Array.isArray(set.drops) ? set.drops[dropIdx] : null;
  if (!drop || (field !== 'weight' && field !== 'reps')) return;
  const step = field === 'weight' ? 0.5 : 1;
  const min = field === 'weight' ? 0 : 1;
  const max = field === 'weight' ? 999 : 999;
  const value = Number(drop[field]) || 0;
  drop[field] = Math.round(Math.min(max, Math.max(min, value + delta)) / step) * step;
  save();
  renderActive();
}

function removeDropSet(exIdx, setIdx, dropIdx){
  const set = DB.active && DB.active.exercises[exIdx] && DB.active.exercises[exIdx].sets[setIdx];
  if (!set || !Array.isArray(set.drops)) return;
  set.drops.splice(dropIdx, 1);
  if (!set.drops.length) delete set.drops;
  save();
  renderActive();
}

function addRestPause(exIdx, setIdx){
  const ex = DB.active && DB.active.exercises[exIdx];
  const set = ex && ex.sets[setIdx];
  if (!set || ex.cardio || set.timed || isWarmupSet(set) || !(Number(set.reps) > 0)) return;
  if (!set.restPause || !Array.isArray(set.restPause.clusters)) set.restPause = { clusters: [] };
  const previous = set.restPause.clusters.length
    ? Number(set.restPause.clusters[set.restPause.clusters.length - 1].reps) || Number(set.reps)
    : Number(set.reps);
  set.restPause.clusters.push({ reps: Math.max(1, Math.floor(previous / 2)), restSec: 15 });
  save();
  renderActive();
}

function stepRestPause(exIdx, setIdx, clusterIdx, field, delta){
  const set = DB.active && DB.active.exercises[exIdx] && DB.active.exercises[exIdx].sets[setIdx];
  const cluster = set && set.restPause && Array.isArray(set.restPause.clusters) ? set.restPause.clusters[clusterIdx] : null;
  if (!cluster || (field !== 'reps' && field !== 'restSec')) return;
  const min = field === 'reps' ? 1 : 0;
  const max = field === 'reps' ? 999 : 900;
  cluster[field] = Math.min(max, Math.max(min, (Number(cluster[field]) || 0) + delta));
  save();
  renderActive();
}

function removeRestPause(exIdx, setIdx, clusterIdx){
  const set = DB.active && DB.active.exercises[exIdx] && DB.active.exercises[exIdx].sets[setIdx];
  if (!set || !set.restPause || !Array.isArray(set.restPause.clusters)) return;
  set.restPause.clusters.splice(clusterIdx, 1);
  if (!set.restPause.clusters.length) delete set.restPause;
  save();
  renderActive();
}

/* ---------------- écart avec le programme (pas fait / ajouté) ---------------- */
function sessionDiff(){
  if (!DB.active) return { missing: [], added: [], planned: 0, done: 0 };
  const planned = DB.active.exercises.filter(e => !e.extra);
  const missing = planned.filter(e => !e.sets.some(isWorkingSet));
  const added = DB.active.exercises.filter(e => e.extra && e.sets.some(isWorkingSet));
  return { missing: missing, added: added, planned: planned.length, done: planned.length - missing.length };
}

/* Panneau « Compared with your program » : détecte ce qui n'a pas été fait
   et ce qui a été ajouté pendant la séance, et laisse décider si le programme change. */
function renderProgramDiff(){
  const el = $('sessRecap');
  if (!el) return;
  if (DB.active && DB.active.sourceType === 'free'){
    el.hidden = true;
    el.innerHTML = '';
    return;
  }
  const d = sessionDiff();
  if (!d.missing.length && !d.added.length){ el.hidden = true; el.innerHTML = ''; return; }
  if (!DB.active.picks) DB.active.picks = {};
  const day = DB.active.dayId ? DB.programme.find(x => x.id === DB.active.dayId) : null;
  const dayName = day ? day.name : DB.active.dayName;
  const hasProgramPlan = DB.active.exercises.some(e => !e.extra);

  let html = '<div class="recap-head">' +
    '<span class="recap-title">' + (hasProgramPlan ? 'Compared with your program' : 'Added during session') + '</span>' +
    '<span class="recap-score">' + d.done + '/' + d.planned + ' done</span></div>';

  html += d.added.map(ex => {
    const pick = DB.active.picks[ex.id] || '';
    if (!day){
      return '<div class="recap-row">' +
        '<div class="recap-name">' + esc(ex.name) + ' <span class="chip chip-extra">New</span>' +
          '<span class="recap-meta">' + ex.sets.length + (ex.cardio ? ' run' : '×') + '</span></div>' +
        '<div class="recap-tag">Kept in this session only — no linked program day</div>' +
      '</div>';
    }
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
        '<div class="recap-tag">' + (by ? '↔ replaced by ' + esc(by.name) :
          (day ? 'Skipped · stays in your program' : 'Skipped · kept in the original session plan')) + '</div>' +
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

function defaultRestSeconds(){
  return Math.max(0, Math.min(900, Math.round(Number((DB && DB.restDefaultSecs) ?? 90))));
}

function syncRestDefaultUI(){
  const seconds = defaultRestSeconds();
  const select = $('restDefaultSelect');
  const button = $('restStartBtn');
  if (select) select.value = String(seconds);
  if (button) button.textContent = seconds ? 'Start ' + seconds + 's' : 'Rest off';
}

function saveRestDefault(value){
  if (!DB) return;
  DB.restDefaultSecs = Math.max(0, Math.min(900, Math.round(Number(value) || 0)));
  save();
  syncRestDefaultUI();
}

function startRest(secs){
  if (!DB.active) return;
  const requested = secs == null ? defaultRestSeconds() : Number(secs);
  if (Number.isFinite(requested) && requested <= 0){
    delete DB.active.restUntil;
    DB.active.restSecs = 0;
    DB.active.restDone = true;
    save();
    restTick();
    restLoop();
    return;
  }
  DB.active.restSecs = Math.max(10, Number.isFinite(requested) ? requested : defaultRestSeconds());
  DB.active.restUntil = Date.now() + DB.active.restSecs * 1000;
  DB.active.restDone = false;
  save();
  restTick();
  restLoop();
}

function restAdd(d){
  if (!DB.active) return;
  if (!DB.active.restUntil){ startRest(); return; }
  DB.active.restUntil = Math.max(Date.now(), DB.active.restUntil + d * 1000);
  DB.active.restSecs = Math.max(10, (DB.active.restSecs || 90) + d);
  DB.active.restDone = DB.active.restUntil <= Date.now();
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
      notifyRestTimerFinished();
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

function notifyRestTimerFinished(){
  const prefs = typeof window.getLiftrPreferences === 'function' ? window.getLiftrPreferences() : null;
  if (!prefs || !prefs.restTimerNotifications || document.visibilityState === 'visible' ||
      !window.isSecureContext || typeof window.Notification === 'undefined' || Notification.permission !== 'granted') return;
  const french = document.documentElement.lang === 'fr';
  const title = french ? 'Pause terminée' : 'Rest complete';
  const options = {
    body: french ? 'Prépare ta prochaine série.' : 'Get ready for your next set.',
    icon: './liftr-icon-192-v109.png',
    badge: './liftr-icon-192-v109.png',
    tag: 'liftr-rest-timer',
    renotify: true,
    data: { url: new URL('./index.html', location.href).href }
  };
  if ('serviceWorker' in navigator){
    navigator.serviceWorker.ready.then(registration => {
      if (typeof registration.showNotification === 'function') return registration.showNotification(title, options);
      try { new Notification(title, options); } catch(e){}
    }).catch(() => {});
  } else {
    try { new Notification(title, options); } catch(e){}
  }
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
  if (timedHoldInterval){ clearInterval(timedHoldInterval); timedHoldInterval = null; }
  DB.active = null; save();
  restStopLoop();
  closeModal('activeModal'); renderSeance();
}

function finishSession(){
  if (!DB.active) return;
  if (DB.active.holdTimer){ toast('Finish or cancel the timed hold before ending the session.'); return; }
  let totalSets = 0, workingSets = 0, volume = 0, performed = 0, holdSec = 0;
  DB.active.exercises.forEach(ex => {
    totalSets += ex.sets.length;
    if (ex.sets.length) performed++;
    ex.sets.forEach(s => {
      if (isWorkingSet(s)) workingSets++;
      volume += volumeOf(s);
      if (s.timed) holdSec += Number(s.sec) || 0;
    });
  });
  const ct = cardioTotals(DB.active.exercises);
  const n = totalSets;
  const activities = [
    volume ? fmtVolume(volume) + ' volume' : '',
    ct.min ? fmtNum(ct.km) + ' km · ' + ct.min + ' min' : '',
    holdSec ? fmtNum(holdSec) + ' s held' : ''
  ].filter(Boolean);
  const mixed = activities.length > 1;
  const unit = mixed ? 'line' + (n !== 1 ? 's' : '') :
    ct.min ? 'run' + (n !== 1 ? 's' : '') :
    holdSec ? 'hold' + (n !== 1 ? 's' : '') : 'set' + (n !== 1 ? 's' : '');
  const what = activities.join(' · ') || '0 volume';
  if (!totalSets){
    if (!confirm('No sets recorded. Finish anyway?')) return;
  } else if (!confirm('Finish the session "' + DB.active.dayName + '"?\n' + n + ' ' + unit + ' · ' + what)) return;

  const diff = sessionDiff();
  const addedInfo = DB.active.sourceType === 'free' ? [] : applyProgramPicks(DB.active.picks, diff);
  const progNote = addedInfo.filter(a => a.action !== 'kept').map(a =>
    a.action === 'added' ? '+ ' + a.name : a.name + ' replaces ' + (a.replaces || '?')).join(' · ');

  DB.history.unshift({
    missing: diff.missing.map(m => m.name),
    added: addedInfo,
    id: uid(),
    date: todayISO(),
    dayId: DB.active.dayId,
    dayName: DB.active.dayName,
    sourceType: DB.active.sourceType || null,
    programId: DB.active.programId || null,
    programName: DB.active.programName || null,
    startedAt: DB.active.startedAt,
    endedAt: Date.now(),
    note: DB.active.note || '',
    plannedExercises: DB.active.sourceType === 'program'
      ? DB.active.exercises.filter(e => !e.extra).map(e => ({
          id: e.id, name: e.name, cardio: !!e.cardio || undefined,
          planned: e.planned ? { ...e.planned } : null
        }))
      : [],
    exercises: DB.active.exercises.filter(e => e.sets.length),
    totalSets: totalSets,
    workingSets: workingSets,
    volume: Math.round(volume),
    holdSec: holdSec,
    performed: performed,
    cardioMin: ct.min,
    cardioKm: ct.km
  });

  let prsHit = 0;
  DB.active.exercises.forEach(ex => ex.sets.forEach(s => {
    if (!s.cardio && !s.timed && isWorkingSet(s) && Number(s.weight) > 0 && Number(s.reps) > 0 && updatePR(ex.name, s.weight, s.reps, s.assisted)) prsHit++;
  }));
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
  renderSeance, startSession, startFreeSession, resumeSession, renderActive, openAddSet,
  stepWeight, stepReps, stepAssisted, stepCardioMin, stepCardioKm, stepHoldSec, stepEffort, setEffortScale, syncSetFlags, saveSet, removeSet, saveSessNote,
  startTimedHold, finishTimedHold, cancelTimedHold,
  cancelSession, finishSession, updatePR, applySuggestion,
  sessionDiff, renderProgramDiff, setRecapPick, applyProgramPicks,
  openAddEx, onAddExSearch, renderAddEx, toggleSessionExercise, addSessionExercise,
  addExCustom, removeActiveExercise,
  addDropSet, stepDropSet, removeDropSet, addRestPause, stepRestPause, removeRestPause,
  startRest, restAdd, restSkip, restTick, restLoop, restStopLoop, saveRestDefault
});
