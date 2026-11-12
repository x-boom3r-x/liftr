/* ==================================================================
   SOCIAL - centre de notifications (table `notifications`, ecrite par
   les triggers notify_follow / notify_comment / notify_like).
   Lecture seule + marquage lu (read_at). RLS : chacun ne voit et ne
   marque que les siennes.
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';
import { sb } from './client.js';
import { refreshPhonePushState } from './push.js';

const LIMIT = 30;
const PROFILE_SEL = 'id,username,display_name,avatar_url';

let rows = [];
let unread = 0;
let loaded = false;

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function esc(v){
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function gateOk(){ return typeof window.socialAvailable === 'function' ? window.socialAvailable() : SOCIAL_ENABLED; }
function meId(){ return (window.socialUser || {}).id || null; }
function ago(t){ return (typeof window.timeAgo === 'function') ? window.timeAgo(t) : ''; }

/* ------------------------------ rendu ------------------------------ */
function who(n){
  const a = n.actor || {};
  return a.display_name || a.username || 'Someone';
}

function verbText(n){
  const w = esc(who(n));
  if (n.type === 'follow')   return w + ' started following you.';
  if (n.type === 'like')     return w + ' liked your post.';
  if (n.type === 'mention')  return w + ' mentioned you.';
  if (n.type === 'comment'){
    const body = (n.post && n.post.body) ? String(n.post.body).trim().replace(/\s+/g, ' ').slice(0, 80) : '';
    return w + ' commented' + (body ? ': ' + body : ' on your post.');
  }
  return w + ' interacted with you.';
}

function avatarHtml(n){
  const a = n.actor || {};
  const name = a.display_name || a.username || '?';
  return a.avatar_url
    ? '<img class="av-img" src="' + esc(a.avatar_url) + '" alt="">'
    : esc(String(name).trim().charAt(0).toUpperCase() || '?');
}

function notifRowHtml(n){
  return '<button type="button" class="notif' + (n.read_at ? '' : ' notif-unread') + '" ' +
    'data-notif="' + esc(n.id) + '" ' +
    'aria-label="' + esc(verbText(n)) + '">' +
    '<span class="avatar notif-avatar">' + avatarHtml(n) + '</span>' +
    '<span class="notif-body">' +
      '<span class="notif-text">' + verbText(n) + '</span>' +
      '<span class="notif-time">' + esc(ago(n.created_at)) + '</span>' +
    '</span>' +
    (n.read_at ? '' : '<span class="notif-pip" aria-hidden="true"></span>') +
    '</button>';
}

function render(){
  const list = el('notifList');
  if (!list) return;
  list.innerHTML = rows.length
    ? rows.map(notifRowHtml).join('')
    : '<div class="comment-empty">No notifications yet.</div>';
  paintBadge();
}

function paintBadge(){
  const dot = el('notifDot');
  if (dot){
    if (unread > 0){ dot.classList.remove('hidden'); dot.textContent = unread > 9 ? '9+' : String(unread); }
    else { dot.classList.add('hidden'); dot.textContent = ''; }
  }
  const btn = el('notifBtn');
  if (btn) btn.setAttribute('aria-label', unread > 0 ? 'Notifications (' + unread + ' unread)' : 'Notifications');
}

/* ------------------------------ donnees ---------------------------- */
/* Le badge se déduit des lignes chargées (les plus récentes) : pas de
   requête « count » séparée — plus robuste et suffisant pour un badge. */
function recomputeUnread(){
  unread = rows.filter(n => !n.read_at).length;
  paintBadge();
  return unread;
}

export async function refreshNotifBadge(){
  if (loaded) return recomputeUnread();
  /* pas encore chargé : on charge une fois pour peupler le badge */
  await loadNotifications();
  return unread;
}

export async function loadNotifications(){
  const c = sb();
  const me = meId();
  if (!c || !me) return false;
  const list = el('notifList');
  if (list && !rows.length) list.innerHTML = '<div class="comment-empty">Loading…</div>';
  try {
    const { data, error } = await c.from('notifications')
      .select('id,type,post_id,comment_id,read_at,created_at,' +
              'actor:actor_id(' + PROFILE_SEL + '),' +
              'post:post_id(id,body)')
      .eq('user_id', me)
      .order('created_at', { ascending: false })
      .limit(LIMIT);
    if (error){
      if (list) list.innerHTML = '<div class="comment-empty">Could not load notifications.</div>';
      toast(error.message || 'Could not load notifications.');
      return false;
    }
    rows = data || [];
  } catch(e){
    if (list) list.innerHTML = '<div class="comment-empty">Could not load notifications.</div>';
    toast((e && e.message) || 'Could not load notifications.');
    return false;
  }
  loaded = true;
  render();
  recomputeUnread();
  return true;
}

export async function openNotifications(){
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to see notifications.'); return false; }
  rows = [];
  render();
  if (typeof window.openModal === 'function') window.openModal('notifModal');
  refreshPhonePushState();
  return await loadNotifications();
}

export function closeNotifications(){
  if (typeof window.closeModal === 'function') window.closeModal('notifModal');
  return true;
}

/* Marquage lu (best-effort : l'UI est deja a jour avant la requete). */
async function markRead(n){
  if (!n || n.read_at) return;
  n.read_at = new Date().toISOString();
  if (unread > 0) unread -= 1;
  paintBadge();
  const list = el('notifList');
  const row = list && list.querySelector('[data-notif="' + n.id + '"]');
  if (row) row.classList.remove('notif-unread');
  const c = sb();
  const me = meId();
  if (!c || !me) return;
  try {
    await c.from('notifications')
      .update({ read_at: n.read_at })
      .eq('id', n.id).eq('user_id', me);
  } catch(e){}
}

export async function markAllRead(){
  const c = sb();
  const me = meId();
  if (!c || !me) return false;
  const now = new Date().toISOString();
  let error = null;
  try {
    const r = await c.from('notifications')
      .update({ read_at: now })
      .eq('user_id', me).is('read_at', null);
    error = r && r.error;
  } catch(e){ error = e; }
  if (error){ toast((error && error.message) || 'Could not mark all as read.'); return false; }
  rows.forEach(n => { n.read_at = n.read_at || now; });
  unread = 0;
  render();
  toast('All caught up.');
  return true;
}

/* ----------------------------- navigation -------------------------- */
function openTarget(n){
  if ((n.type === 'comment') && n.post_id){
    if (typeof window.openComments === 'function') return window.openComments(n.post_id);
    if (typeof window.openSharedPost === 'function') return window.openSharedPost(n.post_id);
  }
  if ((n.type === 'like' || n.type === 'mention') && n.post_id){
    if (typeof window.openSharedPost === 'function') return window.openSharedPost(n.post_id);
  }
  if (n.actor && n.actor.id && typeof window.openProfile === 'function')
    return window.openProfile(n.actor.id);
}

/* ------------------------------- wiring ---------------------------- */
function wire(){
  const list = el('notifList');
  if (!list || list.dataset.wired) return;
  list.dataset.wired = '1';
  list.addEventListener('click', e => {
    const t = e.target && e.target.closest ? e.target.closest('[data-notif]') : null;
    if (!t) return;
    const n = rows.find(x => x.id === t.getAttribute('data-notif'));
    if (n){ markRead(n); openTarget(n); }
  });
}

export function initNotifications(){ wire(); paintBadge(); }

export function resetNotifications(){
  rows = [];
  unread = 0;
  loaded = false;
  const list = el('notifList');
  if (list) list.innerHTML = '';
  paintBadge();
}

export function notifUnread(){ return unread; }
export function notifLoaded(){ return loaded; }
