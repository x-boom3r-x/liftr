/* ==================================================================
   LIFTR - calendrier, semaines, progressions
   ================================================================== */
import { icon } from './icons.js';


/* ==================================================================
   CALENDRIER
   ================================================================== */
const DOW = ['M','T','W','T','F','S','S'];

function shiftMonth(d){ calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + d, 1); renderCalendar(); }
function calToday(){ calCursor = new Date(); selectedDate = todayISO(); renderCalendar(); }
function selectDate(iso){ selectedDate = iso; renderCalendar(); }

function sessionsOn(iso){ return DB.history.filter(h => h.date === iso); }
function progressionsOn(iso){ return DB.progressions.filter(p => p.date === iso); }

function renderCalendar(){
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  $('calMonth').textContent = calCursor.toLocaleDateString('en-US', { month:'long', year:'numeric' });
  $('calDow').innerHTML = DOW.map(d => '<div class="cal-dow">' + d + '</div>').join('');

  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - ((first.getDay() + 6) % 7));
  const today = todayISO();
  let html = '';
  for (let i = 0; i < 42; i++){
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const iso = isoOf(d);
    const out = d.getMonth() !== m;
    const marks = [];
    if (sessionsOn(iso).length) marks.push('<span class="mark"></span>');
    if (progressionsOn(iso).length) marks.push('<span class="mark prg"></span>');
    html += '<button class="cal-day' + (out ? ' out' : '') + (iso === today ? ' today' : '') + (iso === selectedDate ? ' sel' : '') + '"' +
      ' onclick="selectDate(\'' + iso + '\')"><span>' + d.getDate() + '</span>' +
      '<span class="marks">' + marks.join('') + '</span></button>';
  }
  $('calGrid').innerHTML = html;

  renderWeekCard();
}

function renderWeekCard(){
  const sel = parseISO(selectedDate);
  const ws = weekStartOf(sel);
  const we = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + 6);
  const wk = weekKeyOf(sel);

  $('weekLabel').textContent = 'Week of ' + ws.toLocaleDateString('en-US', { day:'numeric', month:'long' });
  $('weekRange').textContent = ws.toLocaleDateString('en-US', { day:'numeric', month:'short' }) + ' → ' +
    we.toLocaleDateString('en-US', { day:'numeric', month:'short', year:'numeric' });

  const wProgs = DB.progressions.filter(p => weekKeyOf(parseISO(p.date)) === wk);
  $('weekProgCount').textContent = wProgs.length + ' progression' + (wProgs.length !== 1 ? 's' : '');

  const w = DB.weeks[wk] || {};
  $('weekNote').value = w.note || '';

  let strip = '';
  for (let i = 0; i < 7; i++){
    const d = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + i);
    const iso = isoOf(d);
    const has = sessionsOn(iso).length || progressionsOn(iso).length;
    strip += '<button class="day-pill' + (iso === selectedDate ? ' sel' : '') + (iso === todayISO() ? ' today' : '') + '"' +
      ' onclick="selectDate(\'' + iso + '\')">' +
      '<div class="dow">' + DOW[i] + '</div><div class="num">' + d.getDate() + '</div>' +
      '<div class="dotmini' + (has ? '' : ' none') + '"></div></button>';
  }
  $('dayStrip').innerHTML = strip;

  renderPlan(ws);

  /* Séances du jour sélectionné (lien Calendrier ↔ Séance ↔ Programme) */
  const daySessions = sessionsOn(selectedDate);
  $('daySessions').innerHTML = daySessions.length
    ? daySessions.map(h => {
        const exists = h.dayId && DB.programme.some(d => d.id === h.dayId);
        return '<div class="hist-item" style="cursor:pointer" onclick="openSessionDetail(\'' + h.id + '\')">' +
          '<div class="hist-top"><div><div class="card-title">' + esc(h.dayName) + '</div>' +
          '<div class="card-sub">' + fmtShort(h.date) + (exists ? ' · active session' : ' · deleted session') + '</div></div>' +
          '<div class="hist-right"><div style="text-align:right"><div style="font-weight:750;font-size:.9rem">' + (h.totalSets || 0) + ' sets</div>' +
          '<div class="card-sub">' + fmtVolume(h.volume || 0) + '</div></div>' + histDelBtn(h) + '</div></div>' +
          (h.note ? '<div class="hist-note">' + icon('memo') + ' ' + esc(h.note) + '</div>' : '') +
          '</div>';
      }).join('')
    : '<div class="empty" style="padding:20px"><div class="empty-text">No session finished on this day.</div></div>';

  const progs = progressionsOn(selectedDate);
  $('progList').innerHTML = progs.length
    ? progs.map(p =>
        '<div class="prog-item"><div>' +
          '<div class="prog-main">' + esc(p.exercise) + ' · ' + p.weight + ' kg × ' + p.reps + (p.assisted ? '+' + p.assisted + 'A' : '') + '</div>' +
          '<div class="prog-meta">' + fmtShort(p.date) + '</div>' +
          (p.note ? '<div class="prog-note">' + esc(p.note) + '</div>' : '') +
        '</div><button class="prog-del" onclick="deleteProgression(\'' + p.id + '\')">×</button></div>'
      ).join('')
    : '<div class="empty" style="padding:22px"><div class="empty-text">Nothing logged for this day.<br>Add your progression right below.</div></div>';

  const names = [...new Set(DB.programme.flatMap(d => d.exercises.map(e => e.name)).concat(DB.custom || []))];
  $('exDatalist').innerHTML = names.map(n => '<option value="' + esc(n) + '">').join('');
}

/* ---------------- plan hebdomadaire : DB.weeks[wk].plan[iso] = { dayId, status } ---------------- */
let planPickDate = null;

function planEntry(iso){
  const w = DB.weeks[weekKeyOf(parseISO(iso))];
  return (w && w.plan && w.plan[iso]) ? w.plan[iso] : null;
}

/* État affiché, dérivé : skip explicite · done = séance rattachée ce jour · missed = date passée */
function planStatus(iso){
  const e = planEntry(iso);
  if (!e) return 'none';
  if (e.status === 'skip' || !e.dayId) return 'skip';
  if (sessionsOn(iso).some(h => h.dayId === e.dayId)) return 'done';
  if (iso < todayISO()) return 'missed';
  return 'todo';
}

function setPlanEntry(iso, entry){
  const wk = weekKeyOf(parseISO(iso));
  if (!DB.weeks[wk]) DB.weeks[wk] = {};
  if (!DB.weeks[wk].plan) DB.weeks[wk].plan = {};
  if (entry) DB.weeks[wk].plan[iso] = entry;
  else delete DB.weeks[wk].plan[iso];
  save();
  renderWeekCard();
}

function renderPlan(ws){
  let html = '', done = 0, assigned = 0;
  for (let i = 0; i < 7; i++){
    const d = new Date(ws.getFullYear(), ws.getMonth(), ws.getDate() + i);
    const iso = isoOf(d);
    const e = planEntry(iso);
    const st = planStatus(iso);
    if (e && e.dayId) assigned++;
    if (st === 'done') done++;

    let name = '—', stIco = '';
    if (e && e.dayId){
      const day = DB.programme.find(x => x.id === e.dayId);
      name = day ? day.name : 'Deleted day';
      stIco = st === 'done' ? icon('check') : st === 'missed' ? icon('x') : icon('circle');
    } else if (st === 'skip'){
      name = 'Rest'; stIco = '−';
    }
    html += '<button class="plan-cell ' + st + (iso === todayISO() ? ' today' : '') + '"' +
      ' onclick="openPlanPick(\'' + iso + '\')" title="' + fmtShort(iso) + '">' +
      '<span class="dow">' + DOW[i] + '</span>' +
      '<span class="nm' + (name === '—' ? ' dim' : '') + '">' + esc(name) + '</span>' +
      (stIco ? '<span class="st">' + stIco + '</span>' : '') +
      '</button>';
  }
  $('planRow').innerHTML = html;
  $('planSummary').textContent = assigned
    ? done + '/' + assigned + ' done'
    : 'Nothing planned';
}

function openPlanPick(iso){
  planPickDate = iso;
  const e = planEntry(iso);
  $('planPickTitle').textContent = 'Schedule · ' + fmtShort(iso);
  $('planClearBtn').style.display = e ? '' : 'none';
  const fromProgramme = DB.programme.map(d =>
    '<button class="plan-choice' + (e && e.dayId === d.id ? ' sel' : '') + '" onclick="planSet(\'' + d.id + '\')">' +
      '<span class="pc-name">' + esc(d.name) + '</span>' + typeChip(d.type) + '</button>'
  ).join('');
  const repos = '<button class="plan-choice' + (e && !e.dayId ? ' sel' : '') + '" onclick="planSet(null)">' +
    '<span class="pc-name">Rest</span><span class="chip chip-rest">REST</span></button>';
  $('planChoices').innerHTML = repos + (fromProgramme ||
    '<div class="empty" style="padding:14px 0"><div class="empty-text">No day in your program — create one first.</div></div>');
  openModal('planPickModal');
}

function planSet(dayId){
  if (!planPickDate) return;
  setPlanEntry(planPickDate, { dayId: dayId, status: dayId ? 'todo' : 'skip' });
  closeModal('planPickModal');
}

function planClear(){
  if (!planPickDate) return;
  setPlanEntry(planPickDate, null);
  closeModal('planPickModal');
}

function saveWeekNote(){
  const wk = weekKeyOf(parseISO(selectedDate));
  if (!DB.weeks[wk]) DB.weeks[wk] = {};
  DB.weeks[wk].note = $('weekNote').value;
  save();
}

function addProgression(){
  const ex = $('prgEx').value.trim();
  if (!ex){ $('prgEx').focus(); return; }
  const weight = Math.max(0, parseFloat($('prgWeight').value) || 0);
  const reps = Math.max(0, parseInt($('prgReps').value) || 0);
  const assisted = Math.max(0, parseInt($('prgAssisted').value) || 0);
  if (reps + assisted < 1){ $('prgReps').focus(); return; }

  DB.progressions.unshift({
    id: uid(), date: selectedDate, exercise: ex,
    weight, reps, assisted, note: $('prgNote').value.trim()
  });
  updatePR(ex, weight, reps, assisted);
  $('prgEx').value = ''; $('prgNote').value = '';
  save(); renderCalendar(); renderStats();
}

function deleteProgression(id){
  DB.progressions = DB.progressions.filter(p => p.id !== id);
  save(); renderCalendar(); renderStats();
}

Object.assign(window, {
  DOW, shiftMonth, calToday, selectDate, sessionsOn, progressionsOn,
  renderCalendar, renderWeekCard, saveWeekNote, addProgression, deleteProgression,
  planEntry, planStatus, setPlanEntry, renderPlan, openPlanPick, planSet, planClear
});
