/* ==================================================================
   SOCIAL - coquille : navigation Home / Search / Messages / Profile
   (tout est dans l'onglet Feed ; aucune barre d'onglets n'est touchée)
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';

const VIEWS = ['home', 'search', 'inbox', 'thread', 'profile'];

const HEADS = {
  home:    ['Home',    'What your crew lifted today.'],
  search:  ['Search',  'Find lifters by their @username.'],
  inbox:   ['Messages','Direct messages — just the two of you.'],
  thread:  ['Messages',''],
  profile: ['Profile', '']
};

let view = 'home';

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function gateOk(){ return typeof window.socialAvailable === 'function' ? window.socialAvailable() : SOCIAL_ENABLED; }

export function currentSView(){ return view; }

export function setSocialHead(title, hint){
  const t = el('socialTitle');
  if (t) t.textContent = title;
  const h = el('socialHint');
  if (h) h.textContent = hint || '';
}

function paintNav(){
  document.querySelectorAll('#socialNav .snav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === view ||
      (view === 'thread' && b.dataset.view === 'inbox'));
  });
}

function showView(name){
  VIEWS.forEach(v => {
    const box = el('view-' + v);
    if (box) box.classList.toggle('hidden', v !== name);
  });
  const fab = el('newPostFab');
  if (fab) fab.classList.toggle('hidden', name !== 'home');
}

function loader(name){
  try {
    if (name === 'home' && typeof window.openFeed === 'function') return window.openFeed();
    if (name === 'search' && typeof window.openSearch === 'function') return window.openSearch();
    if (name === 'inbox' && typeof window.renderInbox === 'function') return window.renderInbox();
    if (name === 'profile' && typeof window.renderProfile === 'function') return window.renderProfile();
  } catch(e){}
  return undefined;
}

/* `name` null = on reste sur la vue courante (ré-affichage de l'onglet). */
export function setSView(name){
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to use the Feed.'); return false; }
  if (typeof window.stopMusic === 'function') window.stopMusic();

  const next = VIEWS.indexOf(name) >= 0 ? name : view;
  const leaving = view;
  if (leaving === 'home' && next !== 'home' && typeof window.saveFeedScroll === 'function')
    window.saveFeedScroll();

  view = next;
  showView(view);
  paintNav();

  const head = HEADS[view] || HEADS.home;
  setSocialHead(head[0], head[1]);

  if (view !== 'thread') stopThreadPoll();
  const sc = document.querySelector('.app');
  if (sc) sc.scrollTop = 0;
  loader(view);
  return view;
}

/* Revenir sur l'onglet Feed sans forcer de vue. */
export function enterSView(name){ return setSView(name || view); }

/* --- filtres de discussion (polling léger, seulement si visible) --- */
let threadTimer = null;
function stopThreadPoll(){
  if (threadTimer){ clearInterval(threadTimer); threadTimer = null; }
}
export function startThreadPoll(){
  stopThreadPoll();
  threadTimer = setInterval(() => {
    if (view !== 'thread'){ stopThreadPoll(); return; }
    if (typeof window.loadThread === 'function') window.loadThread();
  }, 5000);
}
export { stopThreadPoll };

export function initShell(){
  showView(view);
  paintNav();
  const search = el('searchInput');
  if (search && !search.dataset.wired){
    search.dataset.wired = '1';
    let t = null;
    search.addEventListener('input', () => {
      const clear = el('searchClear');
      if (clear) clear.classList.toggle('hidden', !search.value);
      clearTimeout(t);
      t = setTimeout(() => {
        if (typeof window.runSearch === 'function') window.runSearch(search.value);
      }, 220);
    });
    search.addEventListener('keydown', e => {
      if (e.key === 'Enter'){ e.preventDefault(); if (window.runSearch) window.runSearch(search.value); }
    });
  }
  const body = el('threadBody');
  if (body && !body.dataset.wired){
    body.dataset.wired = '1';
    body.addEventListener('input', () => {
      const btn = el('threadSend');
      if (btn) btn.disabled = !body.value.trim();
      body.style.height = 'auto';
      body.style.height = Math.min(120, body.scrollHeight) + 'px';
    });
    body.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey){
        e.preventDefault();
        if (window.sendMessage) window.sendMessage();
      }
    });
  }
}

export function resetShell(){
  view = 'home';
  stopThreadPoll();
  showView('home');
  paintNav();
  setSocialHead(HEADS.home[0], HEADS.home[1]);
  const s = el('searchInput');
  if (s) s.value = '';
  const clear = el('searchClear');
  if (clear) clear.classList.add('hidden');
  const list = el('searchList');
  if (list) list.innerHTML = '';
  const inbox = el('inboxList');
  if (inbox) inbox.innerHTML = '';
  const dot = el('inboxDot');
  if (dot) dot.classList.add('hidden');
}
