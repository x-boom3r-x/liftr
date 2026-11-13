/* ==================================================================
   LIFTR - interface : boot, profils, onglets, modals, toast
   ================================================================== */
import { pushLayer, popLayer, dragToDismiss, installEdgeBack } from './gestures.js';

async function boot(){
  migrateProfileNames();
  wireActionSheet();
  const sp = new URLSearchParams(location.search).get('share');
  if (sp) pendingShare = sp;
  await renderProfiles();
  checkNet();
  if ('serviceWorker' in navigator){
    const sw = navigator.serviceWorker;
    const build = document.documentElement.getAttribute('data-build') || '';
    const jsBuild = window.__LIFTR_BUILD__ || '';
    const hadController = !!sw.controller;

    // Une PWA ouverte avec l'ancien worker peut garder l'ancien écran après
    // l'activation du worker mis à jour. Recharge une fois quand ils diffèrent.
    if (hadController && build && build === jsBuild){
      sw.addEventListener('controllerchange', () => {
        const key = 'liftr-controller-reload-build';
        try {
          if (sessionStorage.getItem(key) === build) return;
          sessionStorage.setItem(key, build);
        } catch(e){}
        location.reload();
      });
    }

    sw.register('sw.js', { updateViaCache: 'none' })
      .then(registration => registration.update().catch(()=>{}))
      .catch(()=>{});
  }
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
      ['authModal','commentsModal','peopleModal','profileModal','avatarView','demoModal'].forEach(id => {
        const box = document.getElementById(id);
        if (box && box.classList.contains('show')) closeModal(id);
      });
    }
  });
  wireSheetGestures();
  wireSubnavs();
  installEdgeBack(document.body, { ignore: 'input,textarea,select,[data-no-swipe],.crew,.notes,.ex-chips' });
  document.body.style.touchAction = '';
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
/* Aucun scroll programmé au changement d'onglet : chaque écran garde sa position,
   et le Feed continue de gérer/restaurer son propre scroll. */

/* Safari can leave fixed-position elements at the layout viewport edge while its
   browser chrome changes the visible viewport. Match the shell to WebKit's visible
   viewport; the tabbar reserves the home-indicator inset inside that height. */
function syncAppViewport(){
  const shell = document.getElementById('mainApp');
  const viewport = window.visualViewport;
  if (!shell || !viewport || Math.abs(viewport.scale - 1) > 0.01) return;
  /* The visible viewport can end above the layout viewport on iOS. Keep the
     dock's background continuous through that leftover strip; controls stay
     inside the visual viewport and above the home-indicator safe area. */
  const viewportBottomGap = Math.max(0, window.innerHeight - (viewport.offsetTop + viewport.height));
  document.documentElement.style.setProperty('--viewport-bottom-gap', viewportBottomGap + 'px');
  shell.style.top = viewport.offsetTop + 'px';
  shell.style.left = viewport.offsetLeft + 'px';
  shell.style.right = 'auto';
  shell.style.bottom = 'auto';
  shell.style.width = viewport.width + 'px';
  shell.style.height = viewport.height + 'px';
}
function pinTabbar(){ syncAppViewport(); }
if (window.visualViewport){
  syncAppViewport();
  window.visualViewport.addEventListener('resize', syncAppViewport, { passive: true });
  window.visualViewport.addEventListener('scroll', syncAppViewport, { passive: true });
}
window.addEventListener('resize', syncAppViewport, { passive: true });
window.addEventListener('orientationchange', syncAppViewport, { passive: true });

/* --tabbar-h : hauteur RÉELLE de la barre, mesurée (fab / toast s'y calent,
   plus de 78 / 96 px en dur). ResizeObserver : le padding change avec
   l'orientation ou l'apparition de la barre d'accueil. */
const _tabbarEl = document.querySelector('.tabbar');
if (_tabbarEl){
  const _setTabbarH = () =>
    document.documentElement.style.setProperty('--tabbar-h', window.innerWidth >= 900 ? '0px' : _tabbarEl.offsetHeight + 'px');
  if (window.ResizeObserver) new ResizeObserver(_setTabbarH).observe(_tabbarEl);
  window.addEventListener('orientationchange', _setTabbarH);
  window.addEventListener('resize', _setTabbarH);
  _setTabbarH();
}

/* ---- Chantier F (build 84 : 4 racines + bouton Publier) ----
   showTab garde son contrat (un onglet concret) ; la couche root le mappe.
   Les boutons de sous-nav portent data-tab="<onglet concret>" : les
   selecteurs de tests (button[data-tab=seance]…) restent valides. */
const TAB_ROOTS = {
  today: 'gym',
  feed: 'feed',
  programme: 'gym', seance: 'gym', library: 'gym', calendrier: 'gym', stats: 'gym',
  profil: 'profil',
  'nutri-today': 'nutrition', 'nutri-meals': 'nutrition',
  'nutri-foods': 'nutrition', 'nutri-goal': 'nutrition',
  'nutri-week': 'nutrition'
};
const ROOT_DEFAULT = {
  feed: 'feed',
  gym: 'today',
  nutrition: 'nutri-today',
  profil: 'profil'
};
const ALL_TABS = ['today','programme','seance','library','calendrier','stats','feed',
  'nutri-today','nutri-meals','nutri-foods','nutri-goal','nutri-week','profil'];
const SUBNAV = {
  gym: [['today','Today'],['programme','Plan'],['seance','Workout'],['stats','Progress']],
  nutrition: [['nutri-today','Today'],['nutri-meals','Diary'],['nutri-foods','Foods'],['nutri-goal','Goals']]
};
const lastSub = { gym: 'today', nutrition: 'nutri-today', profil: 'profil' };

function rootOf(tab){ return TAB_ROOTS[tab] || 'gym'; }

/* Le tableau de bord local est l'accueil fiable; Social reste une racine
   distincte qui demande une connexion réseau. */
function feedGateOk(){
  return typeof window.socialAvailable === 'function' ? window.socialAvailable() : true;
}

/* Chaque connexion démarre sur le tableau de bord local : les sous-vues
   sont conservées pendant la navigation, pas comme écran de reconnexion. */
function pickInitialTab(){
  return 'today';
}

function showRoot(root, sub){
  const aliasRoot = root === 'today' ? 'gym' : root;
  const wantRoot = ROOT_DEFAULT[aliasRoot] ? aliasRoot : 'gym';
  if (wantRoot === 'gym'){
    const tab = sub && ALL_TABS.includes(sub) && rootOf(sub) === 'gym'
      ? sub
      : lastSub.gym || ROOT_DEFAULT.gym;
    showTab(tab);
    return;
  }
  if (wantRoot === 'feed' && !feedGateOk()){
    toast('Sign in and go online to use Social.');
    showTab('today');
    return;
  }
  const tab = sub && ALL_TABS.includes(sub) && rootOf(sub) === wantRoot
    ? sub
    : lastSub[wantRoot] || ROOT_DEFAULT[wantRoot];
  showTab(tab);
}

function runQuickAction(action){
  if (action === 'workout') return showRoot('gym', 'seance');
  if (action === 'meal') return showRoot('nutrition', 'nutri-meals');
  if (action === 'scan'){
    showRoot('nutrition', 'nutri-foods');
    setTimeout(() => { if (typeof window.openScanner === 'function') window.openScanner(); }, 160);
    return true;
  }
  if (action === 'post'){
    if (!feedGateOk()) return showRoot('feed');
    showRoot('feed');
    setTimeout(() => { if (typeof window.focusComposer === 'function') window.focusComposer(); }, 180);
    return true;
  }
  if (action === 'notifications'){
    if (!feedGateOk()) return showRoot('feed');
    showRoot('feed');
    setTimeout(() => { if (typeof window.openNotifications === 'function') window.openNotifications(); }, 220);
    return true;
  }
  if (action === 'messages' || action === 'search'){
    if (!feedGateOk()) return showRoot('feed');
    showRoot('feed');
    setTimeout(() => {
      if (typeof window.setSView === 'function') window.setSView(action === 'messages' ? 'inbox' : 'search');
    }, 180);
    return true;
  }
  return false;
}

/* Une SEULE barre de sous-nav, déplacée selon la racine active (F2) :
   visible pour Gym et Nutrition, cachée pour Feed. Les boutons portent
   data-tab="<onglet concret>" : les selecteurs de tests restent valables. */
function wireSubnavs(){
  const main = document.querySelector('main.app');
  if (!main || document.getElementById('rootSubnav')) return;
  const nav = document.createElement('nav');
  nav.className = 'subnav hidden';
  nav.id = 'rootSubnav';
  nav.setAttribute('aria-label', 'Sections');
  main.insertBefore(nav, main.firstChild);
}

function renderSubnavs(root){
  const nav = document.getElementById('rootSubnav');
  if (!nav) return;
  const items = SUBNAV[root];
  if (!items){ nav.classList.add('hidden'); nav.innerHTML = ''; return; }
  nav.classList.remove('hidden');
  nav.innerHTML = items.map(([t, l]) => {
    const active = t === currentTab;
    const attrs = ' data-tab="' + t + '" data-sub="' + t + '" onclick="showTab(' + JSON.stringify(t).replace(/"/g, '&quot;') + ')"';
    return '<button type="button" class="subnav-item' + (active ? ' active' : '') + '"' + attrs +
      (active ? ' aria-current="page"' : '') + '>' + l + '</button>';
  }).join('');
}

function showTab(name){
  if (typeof window.stopMusic === 'function') window.stopMusic();
  if (name === 'nutri-week') name = 'nutri-goal';
  if (!ALL_TABS.includes(name)) name = 'today';
  if (name === 'feed' && !feedGateOk()) name = 'today';
  if (currentTab === 'feed' && name !== 'feed' && typeof window.saveFeedScroll === 'function'){
    window.saveFeedScroll();
  }
  currentTab = name;
  currentRoot = rootOf(name);
  lastSub[currentRoot] = name;
  localStorage.setItem('at_tab', name);
  ALL_TABS.forEach(t => {
    const el = $('tab-' + t);
    if (el) el.classList.toggle('hidden', t !== name);
  });
  /* onglets racine : l'actif = la racine de l'onglet courant */
  document.querySelectorAll('.tabbar .tab').forEach(b => {
    const on = b.dataset.tab === currentRoot;
    b.classList.toggle('active', on);
    b.setAttribute('aria-current', on ? 'true' : 'false');
  });
  const profileShortcut = document.querySelector('.header-profile');
  if (profileShortcut) profileShortcut.setAttribute('aria-current', currentRoot === 'profil' ? 'page' : 'false');
  if (name === 'today'){ renderProgramme(); if (typeof window.renderToday === 'function') window.renderToday(); }
  if (name === 'programme'){ renderProgramme(); if (typeof window.renderProgramsList === 'function') window.renderProgramsList(); }
  if (name === 'seance') renderSeance();
  if (name === 'library' && typeof window.renderLibraryScreen === 'function') window.renderLibraryScreen();
  if (name === 'calendrier') renderCalendar();
  if (name === 'stats') renderStats();
  if (name === 'profil' && typeof window.renderProfilScreen === 'function') window.renderProfilScreen();
  if (name === 'feed'){
    /* le panneau Feed peut être ouvert alors que la sous-vue sociale est
       encore profil / inbox / search : l'onglet racine ramène au fil (F/G) */
    if (typeof window.setSView === 'function') window.setSView('home');
    else if (typeof window.openFeed === 'function') window.openFeed();
  }
  if (typeof window.renderNutrition === 'function') window.renderNutrition(name);
  renderSubnavs(currentRoot);
}
function renderAll(){
  const n = (DB.programme || []).length;
  $('progCount').textContent = n + ' day' + (n !== 1 ? 's' : '') + ' in your program';
  if ($('shareCardCount')) $('shareCardCount').textContent = n + ' day' + (n !== 1 ? 's' : '');
  if (typeof window.renderProgramsList === 'function') window.renderProgramsList();
  renderProgramme(); renderSeance(); renderCalendar(); renderStats();
  showTab(currentTab);
}

/* ---------------- modals ---------------- */
function openModal(id){
  if (typeof window.stopMusic === 'function') window.stopMusic();
  $(id).classList.add('show');
  pushLayer(id, () => closeModal(id));
}
function closeModal(id){
  if (typeof window.stopMusic === 'function') window.stopMusic();
  $(id).classList.remove('show');
  popLayer(id);
}

/* Chantier E — la feuille d'une modale suit le doigt sur son .grabber.
   La fermeture re-clic le fond de l'overlay : chaque modal garde son propre
   handler onclick (closeModal / closeEditor / closeMusicPicker…). */
function wireSheetGestures(){
  document.querySelectorAll('.overlay .grabber').forEach(g => {
    if (g.dataset.gw) return;
    g.dataset.gw = '1';
    const sheet = g.closest('.modal') || g.parentElement;
    const overlay = g.closest('.overlay');
    if (!sheet || !overlay) return;
    dragToDismiss(sheet, {
      handle: g,
      close: () => overlay.dispatchEvent(new MouseEvent('click', { bubbles: true })),
    });
  });
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

/* ---- écran Profil (racine de la nav basse) ----
   État civil du profil local + actions. Refonte complète prévue dans une
   phase ultérieure : ici, juste de quoi rendre le bouton utile. */
function renderProfilScreen(){
  const el = $('profilContent');
  if (!el) return;
  const name = currentUser || 'Guest';
  const days = (DB.programme || []).length;
  const sess = (DB.history || []).length;
  const prs = Object.keys(DB.prs || {}).length;

  const rows = [];
  rows.push({
    t: 'Switch profile',
    s: (getProfiles().length) + ' profile' + (getProfiles().length !== 1 ? 's' : '') + ' on this device',
    btn: '<button class="btn btn-sm" onclick="switchUser()">Switch</button>'
  });
  rows.push({
    t: 'Backup & restore',
    s: 'Save or restore this profile in one file.',
    btn: '<button class="btn btn-sm" onclick="exportBackup()">Export</button>' +
         '<button class="btn btn-sm" style="margin-left:6px" onclick="$(\'backupFile\').click()">Restore</button>'
  });
  rows.push({
    t: 'App preferences',
    s: 'Language, text size, motion and shortcuts.',
    btn: '<button class="btn btn-sm" onclick="openAppPreferences()">Settings</button>'
  });
  rows.push({
    t: 'Getting started',
    s: 'A quick guide to Gym, Nutrition and Social.',
    btn: '<button class="btn btn-sm" onclick="openGettingStartedHelp()">Open guide</button>'
  });
  rows.push({
    t: 'Privacy and blocked profiles',
    s: 'Manage the profiles you have blocked on Social.',
    btn: '<button class="btn btn-sm" onclick="openBlockedProfiles()">Manage</button>'
  });
  rows.push({
    t: 'Training progress',
    s: 'Review your sessions, records and trends.',
    btn: '<button class="btn btn-sm" onclick="showTab(\'stats\')">View progress</button>'
  });
  rows.push({
    t: 'Licences & acknowledgements',
    s: 'Open-source software, code and media credits.',
    btn: '<a class="btn btn-sm" href="/NOTICE.md">Read notices</a>' +
         '<a class="btn btn-sm" style="margin-left:6px" href="/LICENSE">License text</a>'
  });
  if (typeof window.socialAvailable === 'function' && socialAvailable()){
    rows.push({
      t: 'The Feed',
      s: 'Signed in as ' + esc((window.socialUser && socialUser.email) || 'you'),
      btn: '<button class="btn btn-sm" onclick="signOutSocial()">Sign out</button>'
    });
  } else {
    rows.push({
      t: 'The Feed',
      s: 'Optional — your training data stays on this device',
      btn: '<button class="btn btn-sm btn-primary" onclick="openAuth()">Sign in</button>'
    });
  }
  if (typeof window.hasInstallPrompt === 'function' && hasInstallPrompt()){
    rows.push({
      t: 'Install Liftr',
      s: 'Add it to your home screen',
      btn: '<button class="btn btn-sm btn-primary" onclick="installApp()">Install</button>'
    });
  }

  el.innerHTML =
    '<div class="profil-hero">' +
      '<div class="avatar">' + esc(name.trim().charAt(0).toUpperCase() || '?') + '</div>' +
      '<div><div class="ph-name">' + esc(name) + '</div>' +
      '<div class="ph-meta">Local profile · build ' + esc(window.__LIFTR_BUILD__ || '') + '</div></div>' +
    '</div>' +
    '<div class="profil-stats">' +
      '<div class="profil-stat"><div class="ps-n">' + days + '</div><div class="ps-l">Days</div></div>' +
      '<div class="profil-stat"><div class="ps-n">' + sess + '</div><div class="ps-l">Sessions</div></div>' +
      '<div class="profil-stat"><div class="ps-n">' + prs + '</div><div class="ps-l">Records</div></div>' +
    '</div>' +
    rows.map(r =>
      '<div class="profil-row"><div><div class="pr-t">' + esc(r.t) + '</div>' +
      '<div class="pr-s">' + r.s + '</div></div><div>' + r.btn + '</div></div>'
    ).join('');

  const hint = $('profilHint');
  if (hint) hint.textContent = sess + ' session' + (sess !== 1 ? 's' : '') +
    ' · ' + days + ' day' + (days !== 1 ? 's' : '') + ' in your program';
}

function openSocialNavigation(){
  return openActionSheet('Social sections', [
    { label: 'Home feed', fn: () => window.setSView && window.setSView('home') },
    { label: 'Search people', fn: () => window.setSView && window.setSView('search') },
    { label: 'Reels', fn: () => window.setSView && window.setSView('reels') },
    { label: 'Messages', fn: () => window.setSView && window.setSView('inbox') },
    { label: 'Private groups & challenges', fn: () => window.openSocialGroups && window.openSocialGroups() },
    { label: 'My profile', fn: () => window.showMyProfile && window.showMyProfile() }
  ]);
}

Object.assign(window, {
  boot, renderProfiles, createProfile, checkNet, showTab, showRoot, renderAll, pinTabbar,
  openModal, closeModal, askConfirm, closeConfirm, toast,
  openActionSheet, closeActionSheet,
  pickInitialTab, openSocialNavigation, renderProfilScreen, runQuickAction, ALL_TABS
});
