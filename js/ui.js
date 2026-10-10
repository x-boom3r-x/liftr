/* ==================================================================
   LIFTR - interface : boot, profils, onglets, modals, toast
   ================================================================== */


async function boot(){
  migrateProfileNames();
  wireActionSheet();
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
      ['authModal','commentsModal','peopleModal','profileModal','avatarView'].forEach(id => {
        const box = document.getElementById(id);
        if (box && box.classList.contains('show')) closeModal(id);
      });
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
/* Aucun scroll programmaté au changement d'onglet : sur iOS Safari, remonter la
   page fait réapparaître la barre du navigateur, le viewport rétrécit, et la
   tabbar (position:fixed;bottom:0) remonte. Chaque onglet garde la position du
   navigateur (le Feed continue de gérer/restaurer son propre scroll). */

/* Colle la tabbar sur le bas RÉEL de l'écran. Quand iOS réduit la HAUTEUR du
   viewport (barre du navigateur qui réapparaît, clavier), `bottom:0` fixe ne
   suffit plus : la barre remonte et laisse un trou en dessous. On la recale sur
   le bas du visualViewport.

   On utilise UNIQUEMENT `vv.height - innerHeight` et JAMAIS `vv.offsetTop` :
   pendant un rebond de scroll iOS (ou un zoom), offsetTop devient temporairement
   négatif alors que la hauteur visible est inchangée → l'ancienne formule
   appliquait un translateY parasite et la barre restait bloquée trop haut
   ("la barre remonte un peu"). Un viewport réduit = hauteur plus petite. */
let _pinRaf = 0;
function pinTabbar(){
  if (_pinRaf) return;
  _pinRaf = requestAnimationFrame(() => {
    _pinRaf = 0;
    const bar = document.querySelector('.tabbar');
    if (!bar) return;
    const vv = window.visualViewport;
    const delta = vv ? Math.round(vv.height - window.innerHeight) : 0;
    if (delta < -1) bar.style.transform = 'translateY(' + delta + 'px)';
    else if (bar.style.transform) bar.style.transform = '';
  });
}
window.addEventListener('resize', pinTabbar);
window.addEventListener('scroll', pinTabbar, { passive: true });
if (window.visualViewport){
  window.visualViewport.addEventListener('resize', pinTabbar);
  window.visualViewport.addEventListener('scroll', pinTabbar);
}
pinTabbar();

/* --tabbar-h : hauteur RÉELLE de la barre, mesurée (fab / toast s'y calent,
   plus de 78 / 96 px en dur). ResizeObserver : le padding change avec
   l'orientation ou l'apparition de la barre d'accueil. */
const _tabbarEl = document.querySelector('.tabbar');
if (_tabbarEl){
  const _setTabbarH = () =>
    document.documentElement.style.setProperty('--tabbar-h', _tabbarEl.offsetHeight + 'px');
  if (window.ResizeObserver) new ResizeObserver(_setTabbarH).observe(_tabbarEl);
  window.addEventListener('orientationchange', _setTabbarH);
  _setTabbarH();
}

function showTab(name){
  if (typeof window.stopMusic === 'function') window.stopMusic();
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
}
function renderAll(){
  const n = (DB.programme || []).length;
  $('progCount').textContent = n + ' day' + (n !== 1 ? 's' : '') + ' in your program';
  if ($('shareCardCount')) $('shareCardCount').textContent = n + ' day' + (n !== 1 ? 's' : '');
  renderProgramme(); renderSeance(); renderCalendar(); renderStats();
  showTab(currentTab);
}

/* ---------------- modals ---------------- */
function openModal(id){
  if (typeof window.stopMusic === 'function') window.stopMusic();
  $(id).classList.add('show');
}
function closeModal(id){
  if (typeof window.stopMusic === 'function') window.stopMusic();
  $(id).classList.remove('show');
}

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

/* ---------------- action sheet (style iOS) ----------------
   actions : [{ label, style: 'default' | 'destructive', fn }] */
let _sheetActions = [];
function openActionSheet(title, actions){
  _sheetActions = (actions || []).slice();
  const t = $('asTitle');
  t.textContent = title || '';
  t.classList.toggle('hidden', !title);
  $('asList').innerHTML = _sheetActions.map((a, i) =>
    '<button type="button" class="as-item' + (a.style === 'destructive' ? ' danger' : '') +
    '" data-i="' + i + '">' + esc(a.label) + '</button>').join('');
  openModal('actionSheet');
  return true;
}
function closeActionSheet(){
  _sheetActions = [];
  closeModal('actionSheet');
  return true;
}
function wireActionSheet(){
  const list = $('asList');
  if (!list || list.dataset.wired) return;
  list.dataset.wired = '1';
  list.addEventListener('click', e => {
    const btn = e.target && e.target.closest && e.target.closest('[data-i]');
    if (!btn) return;
    const a = _sheetActions[parseInt(btn.getAttribute('data-i'), 10)];
    closeActionSheet();
    if (a && typeof a.fn === 'function') setTimeout(a.fn, 0);
  });
}

Object.assign(window, {
  boot, renderProfiles, createProfile, checkNet, showTab, renderAll, pinTabbar,
  openModal, closeModal, askConfirm, closeConfirm, toast,
  openActionSheet, closeActionSheet
});
