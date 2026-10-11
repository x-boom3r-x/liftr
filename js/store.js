/* ==================================================================
   LIFTR - persistance, profils, session utilisateur
   ================================================================== */


/* ---------------- persistence ---------------- */
function storeKey(){ return 'at_v2_' + currentUser; }

function defaultDB(){
  return { programme: [], history: [], progressions: [], weeks: {}, prs: {}, prLog: [], custom: [], weightLog: [], active: null };
}

/* Ecriture : localStorage en miroir (immédiat) + IndexedDB (coalescé) */
let _saveTimer = null;
let _pendingIdb = null;
let _quotaWarned = false;

function save(){
  if (!currentUser || !DB) return;
  const key = 'at_v2_' + currentUser;
  const snap = JSON.stringify(DB);
  try {
    localStorage.setItem(key, snap);
    localStorage.setItem(key + '_t', String(Date.now()));
    _quotaWarned = false;
  } catch (e){
    /* quota dépassé : l'IDB reste la source de vérité, on prévient une fois */
    if (!_quotaWarned){
      _quotaWarned = true;
      if (document.getElementById('toast')) toast('Storage full — export your backup (Program → Backup).');
    }
  }
  _pendingIdb = { name: currentUser, snap: snap };
  if (!_saveTimer) _saveTimer = setTimeout(flushIdb, 50);
}

function flushIdb(){
  if (_saveTimer){ clearTimeout(_saveTimer); _saveTimer = null; }
  if (!_pendingIdb) return;
  const p = _pendingIdb; _pendingIdb = null;
  let data = null;
  try { data = JSON.parse(p.snap); } catch (e){ return; }
  idbPutProfile(p.name, data).catch(() => {});
}

/* Dernière écriture avant fermeture (fermeture de l'app en arrière-plan) */
window.addEventListener('pagehide', flushIdb);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushIdb();
});

/* Repare les donnees incompletes (entrees sans id = suppression impossible) */
function normalizeDB(){
  if (!Array.isArray(DB.programme)) DB.programme = [];
  if (!Array.isArray(DB.history)) DB.history = [];
  if (!Array.isArray(DB.progressions)) DB.progressions = [];
  if (!DB.weeks || typeof DB.weeks !== 'object') DB.weeks = {};
  if (!DB.prs || typeof DB.prs !== 'object') DB.prs = {};
  if (!Array.isArray(DB.prLog)) DB.prLog = [];
  if (!Array.isArray(DB.custom)) DB.custom = [];
  DB.prLog = DB.prLog.filter(l => l && l.date && l.name);
  if (!Array.isArray(DB.weightLog)) DB.weightLog = [];
  DB.weightLog = DB.weightLog.filter(w => w && w.date && +w.kg > 0);
  DB.weightLog.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  DB.programme.forEach(d => {
    if (!d.id) d.id = uid();
    if (!d.name) d.name = 'Session';
    if (!Array.isArray(d.exercises)) d.exercises = [];
    d.exercises.forEach(e => {
      if (!e.id) e.id = uid();
      if (!e.name) e.name = 'Exercise';
    });
  });

  const dayIds = new Set(DB.programme.map(d => d.id));
  DB.history.forEach(h => {
    if (!h.id) h.id = uid();
    if (!h.date) h.date = todayISO();
    if (!h.dayName) h.dayName = 'Session';
    if (h.dayId != null && !dayIds.has(h.dayId)) h.dayId = null;
    if (!Array.isArray(h.exercises)) h.exercises = [];
    h.exercises.forEach(e => { if (!Array.isArray(e.sets)) e.sets = []; });
    const sets = h.exercises.reduce((n, e) => n + e.sets.length, 0);
    const vol = h.exercises.reduce((n, e) => n + e.sets.reduce((m, s) => m + volumeOf(s), 0), 0);
    if (!h.totalSets) h.totalSets = sets;
    if (!h.volume) h.volume = Math.round(vol);
    if (!h.note) h.note = '';
  });

  DB.progressions.forEach(p => {
    if (!p.id) p.id = uid();
    if (!p.exercise) p.exercise = '';
    if (!p.date) p.date = todayISO();
    if (typeof p.weight !== 'number') p.weight = +p.weight || 0;
    if (typeof p.reps !== 'number') p.reps = +p.reps || 0;
    if (typeof p.assisted !== 'number') p.assisted = +p.assisted || 0;
  });
}

function resetProfileData(){
  askConfirm('Erase everything?',
    'Program, past sessions, stats, records and progressions of "' + currentUser + '" will be deleted.\n\nProfiles and the app\'s other data are kept.',
    'Erase everything')
  .then(res => {
    if (!res.ok) return;
    DB = defaultDB();
    save();
    closeModal('dayDetailModal');
    closeModal('daySheetModal');
    renderAll();
    toast('Data erased ✓');
  });
}
/* Chargement : on garde la source la plus fraiche.
   Chaque save() écrit le localStorage en synchrone puis flush l'IDB (+50 ms),
   donc l'IDB peut être en retard si on recharge pendant la fenêtre de coalescing.
   Sans horodatage localStorage (données seedées / version antérieure), on fait
   confiance au miroir — il est au moins aussi récent que l'IDB. */
async function migrate(){
  let data = null;
  let lsData = null;
  try { const raw = localStorage.getItem(storeKey()); if (raw) lsData = JSON.parse(raw); }
  catch(e){ lsData = null; }

  const rec = await idbGetProfileMeta(currentUser);
  const idbData = (rec && rec.db) ? rec.db : null;

  if (lsData && idbData){
    const tsRaw = localStorage.getItem(storeKey() + '_t');
    const lsTs = tsRaw != null ? (+tsRaw || 0) : Infinity;
    const idbTs = +rec.savedAt || 0;
    data = (idbTs > lsTs) ? idbData : lsData;
  } else {
    data = idbData || lsData;
  }

  if (data){
    DB = Object.assign(defaultDB(), data);
    normalizeDB(); save();
    return;
  }
  DB = defaultDB();
  const legacy = localStorage.getItem('userdata_' + currentUser);
  if (legacy){
    try {
      JSON.parse(legacy).forEach(d => {
        DB.programme.push({
          id: uid(),
          name: d.name || 'Day',
          type: TYPES.includes((d.type||'').toUpperCase()) ? d.type.toUpperCase() : 'PUSH',
          exercises: (d.exercises || []).map(e => ({ id: uid(), name: e.name || 'Exercise' }))
        });
      });
    } catch(e){}
  }
  const lh = localStorage.getItem('history_' + currentUser);
  if (lh){
    try {
      JSON.parse(lh).forEach(h => {
        DB.history.push({
          id: uid(),
          date: (h.date || '').slice(0,10) || todayISO(),
          dayName: h.dayName || 'Session',
          exercises: (h.exercises || []).map(e => ({
            id: uid(), name: e.name || '',
            sets: (e.sets || []).map(s => ({ weight: +s.weight || 0, reps: +s.reps || 0, assisted: +s.assisted || 0 }))
          })),
          totalSets: h.totalSets || 0,
          volume: h.totalVolume || 0,
          note: ''
        });
      });
    } catch(e){}
  }
  const lp = localStorage.getItem('prs_' + currentUser);
  if (lp){ try { DB.prs = JSON.parse(lp) || {}; } catch(e){} }
  normalizeDB();
  save();
}

const DEFAULT_PROFILES = ['Mouataz', 'Riad'];
const RENAME_PROFILES = { 'Moi': 'Mouataz', 'Mon ami': 'Riad' };

function getProfiles(){
  try { return JSON.parse(localStorage.getItem('at_profiles')) || DEFAULT_PROFILES.slice(); }
  catch(e){ return DEFAULT_PROFILES.slice(); }
}
function setProfiles(p){ localStorage.setItem('at_profiles', JSON.stringify(p)); }

/* Anciens profils par défaut renommés (les données suivent) */
function migrateProfileNames(){
  let list = null;
  try { list = JSON.parse(localStorage.getItem('at_profiles')); } catch(e){}
  const legacy = Object.keys(RENAME_PROFILES);
  const hasLegacyData = legacy.some(n =>
    ['at_v2_', 'userdata_', 'history_', 'prs_'].some(p => localStorage.getItem(p + n) != null));
  if (!Array.isArray(list)){
    if (!hasLegacyData) return;
    list = legacy.slice();
  }
  if (!list.some(n => RENAME_PROFILES[n])) return;
  const next = list.map(n => {
    const t = RENAME_PROFILES[n];
    return (t && !list.includes(t)) ? t : n;
  });
  Object.keys(RENAME_PROFILES).forEach(oldName => {
    const newName = RENAME_PROFILES[oldName];
    ['at_v2_', 'userdata_', 'history_', 'prs_'].forEach(prefix => {
      const v = localStorage.getItem(prefix + oldName);
      if (v != null && localStorage.getItem(prefix + newName) == null){
        localStorage.setItem(prefix + newName, v);
        localStorage.removeItem(prefix + oldName);
      }
    });
  });
  const last = localStorage.getItem('at_lastUser');
  if (last && RENAME_PROFILES[last]) localStorage.setItem('at_lastUser', RENAME_PROFILES[last]);
  localStorage.setItem('at_profiles', JSON.stringify(next));
}
async function setUser(name){
  currentUser = name;
  await migrate();
  localStorage.setItem('at_lastUser', name);
  $('welcomeScreen').classList.add('hidden');
  $('mainApp').classList.remove('hidden');
  $('headerUser').textContent = name;
  selectedDate = todayISO();
  calCursor = new Date();
  /* Chantier F : onglet racine initial (Feed si connecté+online, sinon Gym),
     mémorisé en localStorage ; un éventuel ?tab= explicite prime. */
  const wantTab = new URLSearchParams(location.search).get('tab');
  const validTabs = window.ALL_TABS || ['programme','seance','calendrier','stats','feed'];
  currentTab = (wantTab && validTabs.includes(wantTab)) ? wantTab : pickInitialTab();
  if (DB.active) currentTab = 'seance';
  renderAll();
  showTab(currentTab);
  if (wantTab) history.replaceState(null, '', location.pathname);
  if (pendingShare){
    const code = pendingShare; pendingShare = null;
    history.replaceState(null, '', location.pathname);
    setTimeout(() => openImport(code), 260);
  }
  checkNet();
}

function switchUser(){
  if (DB && DB.active){ alert('Finish or quit the current session before switching profile.'); return; }
  if (!confirm('Switch profile? Your data is saved.')) return;
  save();
  currentUser = null; DB = null;
  localStorage.removeItem('at_lastUser');
  $('mainApp').classList.add('hidden');
  $('welcomeScreen').classList.remove('hidden');
  renderProfiles();
}

Object.assign(window, {
  storeKey, defaultDB, save, normalizeDB, resetProfileData, migrate,
  DEFAULT_PROFILES, RENAME_PROFILES, getProfiles, setProfiles, migrateProfileNames,
  setUser, switchUser
});
