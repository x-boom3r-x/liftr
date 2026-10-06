/* ==================================================================
   SOCIAL - annuaire « People » + graph de follow
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';
import { sb } from './client.js';

const LIMIT = 50;

let rows = [];
let following = new Set();

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function gateOk(){ return typeof window.socialAvailable === 'function' ? window.socialAvailable() : SOCIAL_ENABLED; }
function meId(){ return (window.socialUser || {}).id || null; }

function personHtml(p){
  const name = p.display_name || p.username || 'Athlete';
  const avatar = p.avatar_url
    ? '<img class="post-avatar-img" src="' + esc(p.avatar_url) + '" alt="">'
    : esc(String(name).trim().charAt(0).toUpperCase() || '?');
  const isF = following.has(p.id);
  return '<div class="person">' +
    '<div class="avatar person-avatar">' + avatar + '</div>' +
    '<div class="person-who">' +
      '<div class="person-name">' + esc(name) + '</div>' +
      (p.username ? '<div class="person-meta">@' + esc(p.username) + '</div>' : '') +
      (p.bio ? '<div class="person-bio">' + esc(p.bio) + '</div>' : '') +
    '</div>' +
    '<button type="button" class="btn btn-sm ' + (isF ? '' : 'btn-primary') + '" ' +
      'data-follow="' + esc(p.id) + '" aria-pressed="' + (isF ? 'true' : 'false') + '">' +
      (isF ? 'Following' : 'Follow') +
    '</button>' +
    '</div>';
}

function render(){
  const list = el('peopleList');
  if (!list) return;
  list.innerHTML = rows.length ? rows.map(personHtml).join('')
    : '<div class="comment-empty">Nobody else here yet — you are the first lifter.</div>';
}

async function load(){
  const c = sb();
  const me = meId();
  if (!c || !me) return false;

  const list = el('peopleList');
  if (list && !rows.length) list.innerHTML = '<div class="comment-empty">Loading…</div>';

  const [people, follows] = await Promise.all([
    c.from('profiles')
      .select('id,username,display_name,avatar_url,bio,created_at')
      .neq('id', me)
      .order('created_at', { ascending: false })
      .limit(LIMIT),
    c.from('follows').select('followee_id').eq('follower_id', me)
  ]);

  if (people.error){
    if (list) list.innerHTML = '<div class="comment-empty">Could not load people.</div>';
    return false;
  }
  rows = people.data || [];
  following = new Set((follows.data || []).map(r => r.followee_id));
  render();
  return true;
}

export async function openPeople(){
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to see people.'); return false; }

  rows = [];
  following = new Set();
  render();
  if (typeof window.openModal === 'function') window.openModal('peopleModal');
  return await load();
}

export function closePeople(){
  if (typeof window.closeModal === 'function') window.closeModal('peopleModal');
  return true;
}

export function isFollowing(uid){ return following.has(uid); }
export function followingIds(){ return [...following]; }

export async function toggleFollow(uid){
  if (!uid) return false;
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to follow.'); return false; }

  const c = sb();
  const me = meId();
  if (!c || !me){ toast('Sign in to follow someone.'); return false; }

  const was = following.has(uid);
  if (was) following.delete(uid); else following.add(uid);
  render();

  try {
    const { error } = was
      ? await c.from('follows').delete().eq('follower_id', me).eq('followee_id', uid)
      : await c.from('follows').insert({ follower_id: me, followee_id: uid });
    if (error) throw new Error(error.message || 'Could not update your crew.');
    toast(was ? 'Unfollowed.' : 'Following.');
    if (typeof window.feedFollowChanged === 'function') window.feedFollowChanged();
    return true;
  } catch(e){
    if (was) following.add(uid); else following.delete(uid);
    render();
    toast((e && e.message) || 'Could not update your crew.');
    return false;
  }
}

export function initPeople(){
  const list = el('peopleList');
  if (list && !list.dataset.wired){
    list.dataset.wired = '1';
    list.addEventListener('click', e => {
      const btn = e.target && e.target.closest && e.target.closest('[data-follow]');
      if (btn) toggleFollow(btn.getAttribute('data-follow'));
    });
  }
}

export function resetPeople(){
  rows = [];
  following = new Set();
  const list = el('peopleList');
  if (list) list.innerHTML = '';
}
