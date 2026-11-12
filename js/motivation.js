/* ==================================================================
   LIFTR - moteur de commentaires contextuels (100 % hors-ligne)

   - detectAfterSession choisit le FILTRE selon les vraies données
     de l'utilisateur.
   - pickComment choisit un texte dans ce filtre, en mémorisant les
     20 derniers affichages + l'ordre d'épuisement de la catégorie.
   - showSessionComment : notification de l'app après CHAQUE séance,
     avec un bouton pour changer de commentaire.
   ================================================================== */

/* ---------- historique d'anti-répétition (localStorage, par profil) ---------- */
function cmtHistKey(){ return 'at_cmt_' + (currentUser || 'default'); }

function readCmtHist(){
  try {
    const raw = localStorage.getItem(cmtHistKey());
    const h = raw ? JSON.parse(raw) : null;
    if (h && typeof h === 'object') return { recent: h.recent || [], used: h.used || {} };
  } catch (e){}
  return { recent: [], used: {} };
}

function writeCmtHist(h){
  try { localStorage.setItem(cmtHistKey(), JSON.stringify(h)); } catch (e){}
}

/* Choix pseudo-aléatoire dans un filtre, sans répéter :
   - les 20 derniers commentaires affichés (tous filtres confondus)
   - tant que la catégorie n'est pas épuisée à 80 % */
function pickComment(filter){
  const list = commentsFor(filter);
  if (!list || !list.length) return null;
  const h = readCmtHist();
  const recent = new Set(h.recent || []);
  const used = new Set(h.used[filter] || []);
  let pool = list.filter(e => !used.has(e.id) && !recent.has(e.id));
  if (!pool.length) pool = list.filter(e => !recent.has(e.id));
  if (!pool.length) pool = list;
  const pick = pool[Math.floor(Math.random() * pool.length)];

  h.recent = (h.recent || []).concat([pick.id]).slice(-20);
  let usedList = (h.used[filter] || []).concat([pick.id]);
  if (usedList.length >= Math.max(20, Math.ceil(list.length * 0.8))) usedList = [pick.id];
  h.used[filter] = usedList;
  writeCmtHist(h);
  return pick;
}

/* ---------- utilitaires de calcul ---------- */
function isoDiff(a, b){
  if (!a || !b || a.length < 10 || b.length < 10) return 0;
  const ta = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const tb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((tb - ta) / 86400000);
}
function avgOf(arr){
  const v = arr.filter(x => isFinite(x));
  if (!v.length) return 0;
  return v.reduce((n, x) => n + x, 0) / v.length;
}
function isStrengthSet(s){ return !s.cardio && (+s.weight || 0) > 0 && (+s.reps || 0) > 0; }

/* Métriques d'une séance : par exercice { e1rm, weight, reps } */
function exMetricsOf(session){
  const map = {};
  (session.exercises || []).forEach(ex => {
    let e1rm = 0, weight = 0, reps = 0;
    (ex.sets || []).forEach(s => {
      if (!isStrengthSet(s)) return;
      const e = e1rmOf(s);
      if (e > e1rm) e1rm = e;
      const w = +s.weight || 0, r = +s.reps || 0;
      if (w > weight){ weight = w; reps = r; }
      else if (w === weight && r > reps){ reps = r; }
    });
    if (e1rm > 0) map[String(ex.name).toLowerCase().trim()] = { e1rm: e1rm, weight: weight, reps: reps };
  });
  return map;
}

/* Meilleures métriques connues AVANT une séance (toutes séances antérieures) */
function priorMetricsOf(prior){
  const map = {};
  prior.forEach(h => {
    const m = exMetricsOf(h);
    Object.keys(m).forEach(key => {
      const cur = map[key];
      if (!cur){
        map[key] = { e1rm: m[key].e1rm, weight: m[key].weight, reps: m[key].reps };
        return;
      }
      if (m[key].e1rm > cur.e1rm) cur.e1rm = m[key].e1rm;
      if (m[key].weight > cur.weight){ cur.weight = m[key].weight; cur.reps = m[key].reps; }
      else if (m[key].weight === cur.weight && m[key].reps > cur.reps) cur.reps = m[key].reps;
    });
  });
  return map;
}

function milestoneNumber(n){
  return n === 10 || n === 25 || (n >= 50 && n % 50 === 0);
}

/* ---------- détection du filtre ---------- */
function detectAfterSession(session, prsHit){
  if (!session) return 'GENERAL_PROGRESS';
  const hist = (typeof DB !== 'undefined' && DB && DB.history) || [];
  const prior = hist.filter(h => h.id !== session.id);
  const cur = exMetricsOf(session);
  const prev = priorMetricsOf(prior);

  /* 1. NEW_PR */
  if (prsHit > 0) return 'NEW_PR';

  let strengthUp = false, repsUp = false, setback = false;
  Object.keys(cur).forEach(key => {
    const p = prev[key];
    if (!p) return;
    if (cur[key].weight > p.weight) strengthUp = true;                       /* charge plus lourde */
    else if (cur[key].weight === p.weight && cur[key].reps > p.reps) repsUp = true; /* plus de reps, même poids */
    else if (cur[key].e1rm > p.e1rm + 0.05) strengthUp = true;               /* e1RM en hausse malgré tout */
    if (p.e1rm > 0 && cur[key].e1rm < p.e1rm * 0.95) setback = true;         /* repli net */
  });

  /* 2. STRENGTH_PROGRESS */
  if (strengthUp) return 'STRENGTH_PROGRESS';
  /* 3. REPS_PROGRESS */
  if (repsUp) return 'REPS_PROGRESS';

  /* 4. VOLUME_PROGRESS : au-dessus de la moyenne des 3 séances précédentes */
  if (prior.length){
    const avg3 = avgOf(prior.slice(0, 3).map(h => +h.volume || 0));
    if (avg3 > 0 && (+session.volume || 0) > avg3 * 1.05) return 'VOLUME_PROGRESS';
  }

  /* 5. COMEBACK : 14 jours ou plus sans séance avant celle-ci */
  if (prior.length && isoDiff(prior[0].date, session.date) >= 14) return 'COMEBACK';

  /* 6. HARD_SESSION : séance nettement plus chargée que la normale */
  if (prior.length >= 3){
    const aSets = avgOf(prior.slice(0, 5).map(h => +h.totalSets || 0));
    const aVol = avgOf(prior.slice(0, 5).map(h => +h.volume || 0));
    if ((+session.totalSets || 0) >= Math.max(aSets * 1.4, aSets + 5) ||
        (aVol > 0 && (+session.volume || 0) >= aVol * 1.5)) return 'HARD_SESSION';
  }

  /* 7. MILESTONE : palier de séances ou nouveau meilleur volume */
  if (milestoneNumber(hist.length)) return 'MILESTONE';
  if (prior.length >= 3){
    const maxVol = Math.max.apply(null, prior.map(h => +h.volume || 0));
    if (maxVol > 0 && (+session.volume || 0) > maxVol) return 'MILESTONE';
  }

  /* 8. SETBACK : repli net sur un exercice (jamais un jugement) */
  if (setback) return 'SETBACK';

  /* 9. CONSISTENCY : au moins 4 séances sur les 14 jours précédant celle-ci */
  if (prior.length){
    const recent = prior.filter(h => {
      const d = isoDiff(h.date, session.date);
      return d >= 0 && d <= 14;
    });
    if (recent.length >= 4) return 'CONSISTENCY';
  }

  /* 10. GENERAL_PROGRESS */
  return 'GENERAL_PROGRESS';
}

/* ---------- notification de l'app après chaque séance ---------- */
const NOTIF_MS = 15000;
let _sessionNote = null;
let _notifTimer = null;
let _notifSummary = '';
let _notifSessionId = null;   /* H : partage de la séance depuis la notif */

function lastLiftr(){ return _sessionNote; }

function hideSessionComment(){
  const el = $('liftrNotif');
  if (el) el.classList.remove('show');
  if (_notifTimer){ clearTimeout(_notifTimer); _notifTimer = null; }
  _notifSessionId = null;
}

/* H : partager la séance terminée — ouvre le composer du Feed pré-rempli */
function shareSession(){
  if (!_notifSessionId) return false;
  const att = (typeof window.sessionAttachment === 'function')
    ? window.sessionAttachment(_notifSessionId) : null;
  if (!att){ toast('This session cannot be shared yet.'); return false; }
  hideSessionComment();
  return (typeof window.openShareComposer === 'function') && window.openShareComposer(att);
}

function changeLiftrComment(){
  if (!_sessionNote) return;
  const c = pickComment(_sessionNote.filter);
  if (c) _sessionNote = { id: c.id, filter: c.filter, comment: c.comment };
  renderNotif();
  /* relance le compte à rebours d'auto-masquage */
  if (_notifTimer) clearTimeout(_notifTimer);
  _notifTimer = setTimeout(hideSessionComment, NOTIF_MS);
}

function renderNotif(){
  const sumEl = $('liftrSum');
  const txtEl = $('liftrText');
  const markEl = $('liftrMark');
  const filter = _sessionNote ? _sessionNote.filter : '';
  const labels = { NEW_PR: 'PERSONAL RECORD', MILESTONE: 'TRAINING MILESTONE', GOAL_REACHED: "TODAY'S GOAL" };
  if (sumEl) sumEl.textContent = _notifSummary;
  if (markEl) markEl.textContent = labels[filter] || 'LIFTR';
  if (txtEl){
    txtEl.setAttribute('data-filter', filter);
    txtEl.setAttribute('data-id', _sessionNote ? _sessionNote.id : '');
    txtEl.textContent = _sessionNote ? _sessionNote.comment : '';
  }
}

function presentAchievement(filter, summary, sessionId){
  const c = pickComment(filter);
  _sessionNote = c ? { id: c.id, filter: filter, comment: c.comment } : null;
  _notifSummary = summary || '';
  _notifSessionId = sessionId || null;
  renderNotif();
  const shareBtn = $('liftrShare');
  if (shareBtn) shareBtn.classList.toggle('hidden', !_notifSessionId);

  const el = $('liftrNotif');
  if (el){
    el.classList.remove('show', 'is-achievement', 'is-pr', 'is-milestone', 'is-goal');
    const style = filter === 'NEW_PR' ? 'is-pr'
      : filter === 'MILESTONE' ? 'is-milestone'
      : filter === 'GOAL_REACHED' ? 'is-goal' : '';
    if (style) el.classList.add('is-achievement', style);
    void el.offsetWidth; /* relance l'animation d'entrée */
    el.classList.add('show');
  }
  if (_notifTimer) clearTimeout(_notifTimer);
  _notifTimer = setTimeout(hideSessionComment, NOTIF_MS);
}

function showSessionComment(session, prsHit, summary){
  presentAchievement(detectAfterSession(session, prsHit), summary, session && session.id);
}

function showGoalAchievement(summary){
  presentAchievement('GOAL_REACHED', summary, null);
}

Object.assign(window, {
  pickComment, detectAfterSession, showSessionComment, showGoalAchievement,
  changeLiftrComment, hideSessionComment, lastLiftr, isoDiff, shareSession
});
