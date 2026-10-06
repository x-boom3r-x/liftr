/* ==================================================================
   LIFTR - interface : boot, profils, onglets, modals, toast
   ================================================================== */


async function boot(){
  migrateProfileNames();
  const sp = new URLSearchParams(location.search).get('share');
  if (sp) pendingShare = sp;
  await renderProfiles();
  checkNet();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'exNameInput') addExercise();
    if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'addExCustom') addExCustom();
    if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'dayNameInput') saveNewDay();
    if (e.key === 'Enter' && document.activeElement && document.activeElement.id === 'newProfileInput') createProfile();
    if (e.key === 'Enter' && document.activeElement &&
        (document.activeElement.id === 'authEmail' || document.activeElement.id === 'authPass')){
      e.preventDefault();
      if (typeof window.submitAuth === 'function') window.submitAuth();
    }
    if (e.key === 'Escape'){
      const box = document.getElementById('authModal');
      if (box && box.classList.contains('show')) closeModal('authModal');
    }
  });
}

async function renderProfiles(){
  const list = getProfiles();
  const html = await Promise.all(list.map(async name => {
    let d = await idbGetProfile(name);
    if (!d){
      try {
        const raw = localStorage.getItem('at_v2_' + name) || localStorage.getItem('userdata_' + name);
        if (raw) d = JSON.parse(raw);
      } catch(e){}
    }
    let meta = 'No data';
    if (d){
      const days = (d.programme || []).length;
      const hist = (d.history || []).length;
      if (days || hist) meta = days + ' day' + (days>1?'s':'') + ' · ' + hist + ' session' + (hist>1?'s':'');
    }
    return '<button class="profile-card" onclick="setUser(' + JSON.stringify(name).replace(/"/g,'&quot;') + ')">' +
      '<div class="avatar">' + esc(name.trim().charAt(0).toUpperCase() || '?') + '</div>' +
      '<div><div class="profile-name">' + esc(name) + '</div><div class="profile-meta">' + esc(meta) + '</div></div>' +
      '</button>';
  }));
  $('profileList').innerHTML = html.join('');
}

function createProfile(){
  const v = $('newProfileInput').value.trim();
  if (!v) return;
  const list = getProfiles();
  if (!list.includes(v)){ list.push(v); setProfiles(list); }
  $('newProfileInput').value = '';
  renderProfiles();
  setUser(v);
}
/* ---------------- network badge ---------------- */
function checkNet(){
  const on = navigator.onLine;
  const dot = $('netDot'), txt = $('netText');
  if (!dot) return;
  dot.className = 'dot' + (on ? '' : ' off');
  txt.textContent = on ? 'Online' : 'Offline';
  if (typeof window.updateSocialGate === 'function') window.updateSocialGate();
}
window.addEventListener('online', checkNet);
window.addEventListener('offline', checkNet);

/* ---------------- tabs ---------------- */
function showTab(name){
  if (name === 'feed' && typeof window.socialAvailable === 'function' && !window.socialAvailable()) name = 'programme';
  if (currentTab === 'feed' && name !== 'feed' && typeof window.saveFeedScroll === 'function'){
    window.saveFeedScroll();
  }
  currentTab = name;
  localStorage.setItem('at_tab', name);
  ['programme','seance','calendrier','stats','feed'].forEach(t => {
    const el = $('tab-' + t);
    if (el) el.classList.toggle('hidden', t !== name);
  });
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'programme') renderProgramme();
  if (name === 'seance') renderSeance();
  if (name === 'calendrier') renderCalendar();
  if (name === 'stats') renderStats();
  if (name === 'feed' && typeof window.openFeed === 'function') window.openFeed();
  /* le Feed gère son propre scroll (restauration) */
  if (name !== 'feed') window.scrollTo({ top: 0 });
}
function renderAll(){
  const n = (DB.programme || []).length;
  $('progCount').textContent = n + ' day' + (n !== 1 ? 's' : '') + ' in your program';
  if ($('shareCardCount')) $('shareCardCount').textContent = n + ' day' + (n !== 1 ? 's' : '');
  renderProgramme(); renderSeance(); renderCalendar(); renderStats();
  showTab(currentTab);
}

/* ---------------- modals ---------------- */
function openModal(id){ $(id).classList.add('show'); }
function closeModal(id){ $(id).classList.remove('show'); }

/* Confirmation générique (suppressions en cascade) */
let _confirmCb = null;
function askConfirm(title, msg, okLabel, checkLabel){
  return new Promise(resolve => {
    _confirmCb = resolve;
    $('cfTitle').textContent = title;
    $('cfMsg').textContent = msg;
    $('cfOk').textContent = okLabel || 'Delete';
    $('cfCheck').checked = false;
    if (checkLabel){
      $('cfCheckWrap').classList.remove('hidden');
      $('cfCheckLabel').textContent = checkLabel;
      $('cfCheck').checked = false;
    } else $('cfCheckWrap').classList.add('hidden');
    openModal('confirmModal');
  });
}
function closeConfirm(ok){
  const cb = _confirmCb;
  const checked = $('cfCheck').checked;
  _confirmCb = null;
  closeModal('confirmModal');
  if (cb) cb({ ok: !!ok, check: checked });
}
let toastTimer = null;
function toast(msg){
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

Object.assign(window, {
  boot, renderProfiles, createProfile, checkNet, showTab, renderAll,
  openModal, closeModal, askConfirm, closeConfirm, toast
});
