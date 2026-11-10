/* ==================================================================
   SOCIAL - attachments (H) : partage d'exploit / séance / programme
   Le schéma est versionné (v:1) et validé DES DEUX CÔTÉS :
   - à l'envoi via les constructeurs prAttachment / sessionAttachment /
     programAttachment (le local est déjà propre) ;
   - à la réception via sanitizeAttachment : whitelist de champs,
     v === 1, nombres bornés, chaînes ≤ 80 car., tableaux ≤ 12 jours
     × 20 exercices, JSON < 16 Ko. Tout champ inconnu est ignoré et le
     rendu ne passe que par esc() (textContent via innerHTML échappé) :
     un attachement invalide = post affiché sans carte, jamais une
      exception.
   ================================================================== */
import { iconS } from '../icons.js';

const MAX_JSON = 16 * 1024;   /* < 16 Ko (contrainte de la colonne) */
const MAX_DAYS = 12;
const MAX_EXOS = 20;
const STR_MAX = 80;
const REPS_MAX = 100;
const KG_MAX = 1000;
const SETS_MAX = 50;
const VOL_MAX = 1e7;

const fmtKg = window.fmtKg || (n => String(n));
const fmtVolume = window.fmtVolume || (n => fmtKg(n));

function str(raw){
  if (typeof raw !== 'string') return null;
  const s = raw.trim().slice(0, STR_MAX);
  return s || null;
}
function num(raw, max, positive){
  const n = +raw;
  if (!isFinite(n) || n <= 0 || n > max) return null;
  return n;
}
function dateStr(raw){
  const s = String(raw || '');
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function repsOrRange(raw){
  if (typeof raw === 'string') return raw.trim().slice(0, 8) || null;
  const n = num(raw, REPS_MAX);
  return n == null ? null : n;
}

/* ------------------------- validation réception ------------------- */
function sanitizePr(a){
  const exercise = str(a.exercise);
  const kg = num(a.kg, KG_MAX, true);
  const reps = num(a.reps, REPS_MAX, true);
  if (!exercise || kg == null || reps == null) return null;
  return { v: 1, type: 'pr', exercise: exercise, kg: kg, reps: reps,
    e1rm: num(a.e1rm, KG_MAX) || null,
    prevE1rm: num(a.prevE1rm, KG_MAX) || null,
    date: dateStr(a.date) };
}
function sanitizeSession(a){
  const title = str(a.title) || 'Session';
  const durationMin = num(a.durationMin, 1440);
  const volume = num(a.volume, VOL_MAX);
  const raw = Array.isArray(a.exercises) ? a.exercises.slice(0, MAX_EXOS) : [];
  const exercises = raw
    .map(e => (e && typeof e === 'object')
      ? { name: str(e.name), topKg: num(e.topKg, KG_MAX) || null,
          topReps: num(e.topReps, REPS_MAX) || null, sets: num(e.sets, SETS_MAX) || null }
      : null)
    .filter(x => x && x.name);
  return { v: 1, type: 'session', title: title, date: dateStr(a.date),
    durationMin: durationMin, volume: volume, exercises: exercises };
}
function sanitizeProgram(a){
  const name = str(a.name) || 'Program';
  const raw = Array.isArray(a.days) ? a.days.slice(0, MAX_DAYS) : [];
  const days = raw
    .map(d => (d && typeof d === 'object')
      ? { name: str(d.name),
          exercises: (Array.isArray(d.exercises) ? d.exercises.slice(0, MAX_EXOS) : [])
            .map(e => (e && typeof e === 'object')
              ? { name: str(e.name), sets: num(e.sets, SETS_MAX) || null,
                  reps: repsOrRange(e.reps) }
              : null)
            .filter(x => x && x.name) }
      : null)
    .filter(x => x && x.name && x.exercises.length);
  if (!days.length) return null;
  return { v: 1, type: 'program', name: name, days: days };
}

/* Whitelist : v === 1, type connu, JSON < 16 Ko. Renvoie null si
   l'attachement est invalide — le post s'affiche alors sans carte. */
export function sanitizeAttachment(raw){
  if (!raw || typeof raw !== 'object') return null;
  if (+raw.v !== 1) return null;
  let json = '';
  try { json = JSON.stringify(raw); } catch(e){ return null; }
  if (json.length >= MAX_JSON) return null;
  const t = String(raw.type || '');
  if (t === 'pr') return sanitizePr(raw);
  if (t === 'session') return sanitizeSession(raw);
  if (t === 'program') return sanitizeProgram(raw);
  return null;
}

/* --------------------------- rendu (carte) ------------------------ */
const _imp = {};    /* registre temporaire : data-imp -> attachement */
let _impSeq = 0;

export function shareEmbedHtml(att){
  const a = sanitizeAttachment(att);
  if (!a) return '';
  if (a.type === 'pr'){
    const dE = (a.e1rm && a.prevE1rm && a.e1rm > a.prevE1rm)
      ? ' · +' + fmtKg(Math.round((a.e1rm - a.prevE1rm) * 10) / 10) + ' kg vs previous' : '';
    return '<div class="share-embed pr">' +
      '<div class="se-head"><span aria-hidden="true">🏆</span> Personal record</div>' +
      '<div class="se-title">' + esc(a.exercise) + '</div>' +
      '<div class="se-big">' + esc(fmtKg(a.kg)) + '<small>kg × ' + esc(fmtKg(a.reps)) + '</small></div>' +
      '<div class="se-meta">' +
        (a.e1rm ? 'e1RM ' + esc(fmtKg(a.e1rm)) + ' kg' : '') +
        dE + (a.date ? (a.e1rm || dE ? ' · ' : '') + esc(a.date) : '') +
      '</div></div>';
  }
  if (a.type === 'session'){
    const rows = [];
    if (a.durationMin) rows.push(['Duration', a.durationMin + ' min']);
    if (a.volume) rows.push(['Volume', fmtVolume(a.volume) + ' kg']);
    if (a.exercises.length) rows.push(['Exercises', String(a.exercises.length)]);
    return '<div class="share-embed session">' +
      '<div class="se-head"><span aria-hidden="true">🏋️</span> Session summary</div>' +
      '<div class="se-title">' + esc(a.title) + (a.date ? ' · ' + esc(a.date) : '') + '</div>' +
      (rows.length
        ? '<div class="se-rows">' + rows.map(r =>
            '<div class="se-row"><span>' + esc(r[0]) + '</span><b>' + esc(r[1]) + '</b></div>').join('') +
          '</div>'
        : '') +
      '</div>';
  }
  /* program */
  const exos = a.days.reduce((n, d) => n + d.exercises.length, 0);
  const id = 'sa' + (++_impSeq);
  _imp[id] = a;
  return '<div class="share-embed program">' +
    '<div class="se-head"><span aria-hidden="true">' + iconS('clipboard') + '</span> Shared program</div>' +
    '<div class="se-title">' + esc(a.name) + ' — ' + a.days.length + ' day' + (a.days.length !== 1 ? 's' : '') + '</div>' +
    '<div class="se-rows">' +
      '<div class="se-row"><span>Days</span><b>' + a.days.length + '</b></div>' +
      '<div class="se-row"><span>Exercises</span><b>' + exos + '</b></div>' +
    '</div>' +
    '<button type="button" class="btn btn-primary btn-sm se-cta" ' +
      'data-imp="' + esc(id) + '" onclick="importSharedProgram(this)">Import this program</button>' +
    '</div>';
}

/* Le CTA « Import this program » convertit l'attachement vers le format
   d'import DÉJÀ EXISTANT (js/share.js : parseShare/applyImport) — aucune
   deuxième logique d'import n'est écrite ici. */
function programToSharePayload(a){
  return {
    app: 'liftr', kind: 'programme', v: 1,
    from: 'Shared post', at: new Date().toISOString(),
    programme: a.days.map((d, i) => ({
      id: 'share-day-' + i, name: d.name, type: 'PUSH',
      exercises: d.exercises.map((e, j) => ({ id: 'share-' + i + '-' + j, name: e.name }))
    })),
    custom: []
  };
}

export function importSharedProgram(btn){
  const id = btn && btn.getAttribute && btn.getAttribute('data-imp');
  const a = id && _imp[id];
  if (!a) return false;
  const payload = programToSharePayload(a);
  /* merge par défaut : un import depuis un post n'écrase jamais en
     silence un programme local (la spec H5) */
  if (typeof window.openImport === 'function') window.openImport(JSON.stringify(payload), true);
  return true;
}

/* ------------------- constructeurs (envoi local) ------------------ */
export function prAttachment(key){
  const pr = ((window.DB && DB.prs) || {})[key];
  if (!pr) return null;
  const log = ((window.DB && DB.prLog) || []).find(l => l.key === key && l.date === pr.date) || null;
  return { v: 1, type: 'pr',
    exercise: pr.name || key,
    kg: +pr.weight || 0, reps: +pr.reps || 0,
    e1rm: e1rmOf({ weight: +pr.weight || 0, reps: +pr.reps || 0, assisted: +pr.assisted || 0 }) || null,
    prevE1rm: (log && log.prev && e1rmOf(log.prev)) || null,
    date: pr.date };
}

export function sessionAttachment(id){
  const h = ((window.DB && DB.history) || []).find(x => x.id === id);
  if (!h) return null;
  const exercises = (h.exercises || []).filter(e => !e.cardio).map(e => {
    let topKg = 0, topReps = 0, topE = 0;
    (e.sets || []).forEach(s => {
      if (s.cardio) return;
      const kg = +s.weight || 0, r = +s.reps || 0, v = e1rmOf(s) || 0;
      if (kg > 0 && v >= topE){ topE = v; topKg = kg; topReps = r; }
    });
    return { name: e.name, topKg: topKg || null, topReps: topReps || null,
      sets: (e.sets || []).length };
  }).filter(x => x.name);
  return { v: 1, type: 'session',
    title: h.dayName || 'Session', date: h.date,
    durationMin: (h.startedAt && h.endedAt)
      ? Math.max(1, Math.round((h.endedAt - h.startedAt) / 60000)) : null,
    volume: +h.volume || 0, exercises: exercises };
}

export function programAttachment(){
  const days = (typeof window.getActiveProgrammeDays === 'function')
    ? getActiveProgrammeDays() : ((window.DB && DB.programme) || []);
  if (!days.length) return null;
  const name = days.length <= 3
    ? days.map(d => d.name).join(' ')
    : 'Program (' + days.length + ' days)';
  return { v: 1, type: 'program', name: String(name).slice(0, STR_MAX),
    days: days.slice(0, MAX_DAYS).map(d => ({
      name: String(d.name).slice(0, STR_MAX),
      exercises: (d.exercises || []).slice(0, MAX_EXOS)
        .map(e => ({ name: String(e.name).slice(0, STR_MAX) }))
        .filter(e => e.name)
    })).filter(d => d.exercises.length) };
}
