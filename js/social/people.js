/* ==================================================================
   SOCIAL - graph de follow (annuaire, followers, following)
   Source unique de vérité : le Set `following` de ce module.
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';
import { sb } from './client.js';

const LIMIT = 50;
const SELECT = 'id,username,display_name,avatar_url,bio';

let rows = [];
let mode = 'all';          /* 'all' | 'followers' | 'following' */
let scopeId = null;        /* profil dont on affiche les liens */
let following = new Set(); /* ids que JE suis */

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function gateOk(){ return typeof window.socialAvailable === 'function' ? window.socialAvailable() : SOCIAL_ENABLED; }
function meId(){ return (window.socialUser || {}).id || null; }

export function isFollowed(uid){ return following.has(uid); }
export function mergeFollows(ids){ (ids || []).forEach(id => following.add(id)); }
export function followingIds(){ return [...following]; }

export function personRowHtml(p){
  const name = p.display_name || p.username || 'Athlete';
  const avatar = p.avatar_url
    ? '<img class="av-img" src="' + esc(p.avatar_url) + '" alt="">'
    : esc(String(name).trim().charAt(0).toUpperCase() || '?');
  const isF = following.has(p.id);
  return '<div class="person" data-row="' + esc(p.id) + '">' +
    '<button type="button" class="avatar person-avatar" data-open="' + esc(p.id) + '" ' +
      'aria-label="Open profile">' + avatar + '</button>' +
    '<button type="button" class="person-who" data-open="' + esc(p.id) + '">' +
      '<div class="person-name">' + esc(name) + '</div>' +
      (p.username ? '<div class="person-meta">@' + esc(p.username) + '</div>' : '') +
      (p.bio ? '<div class="person-bio">' + esc(p.bio) + '</div>' : '') +
    '</button>' +
    '<button type="button" class="btn btn-sm ' + (isF ? '' : 'btn-primary') + '" ' +
      'data-follow="' + esc(p.id) + '" aria-pressed="' + (isF ? 'true' : 'false') + '">' +
      (isF ? 'Following' : 'Follow') +
    '</button>' +
    '</div>';
}

function emptyHtml(){
  if (mode === 'followers')
    return '<div class="comment-empty">No followers yet.</div>';
  if (mode === 'following')
    return '<div class="comment-empty">Not following anyone yet.</div>';
  return '<div class="comment-empty">Nobody else here yet — you are the first lifter.</div>';
}

function render(){
  const list = el('peopleList');
  if (!list) return;
  list.innerHTML = rows.length ? rows.map(personRowHtml).join('') : emptyHtml();
  const sub = el('peopleSub');
  if (sub) sub.textContent = SUBS[mode] || SUBS.all;
}

const SUBS = {
  all: 'Lifters on Liftr — follow them to build your crew.',
  followers: 'People who follow this account.',
  following: 'Accounts this person follows.'
};

function repaint(uid){
  const list = el('peopleList');
  if (list){
    const row = list.querySelector('[data-row="' + uid + '"]');
    const p = rows.find(x => x.id === uid);
    if (row && p){
      const tmp = document.createElement('div');
      tmp.innerHTML = personRowHtml(p);
      row.replaceWith(tmp.firstElementChild);
    }
  }
  if (typeof window.onFollowChanged === 'function') window.onFollowChanged(uid, following.has(uid));
}

/* ------------------------------ chargement ------------------------- */
async function load(){
  const c = sb();
  const me = meId();
  if (!c || !me) return false;

  const list = el('peopleList');
  if (list && !rows.length) list.innerHTML = '<div class="comment-empty">Loading…</div>';

  try {
    if (mode === 'all'){
      const [people, mine] = await Promise.all([
        c.from('profiles').select(SELECT).neq('id', me)
          .order('created_at', { ascending: false }).limit(LIMIT),
        c.from('follows').select('followee_id').eq('follower_id', me)
      ]);
      if (people.error) throw new Error(people.error.message);
      rows = people.data || [];
      mergeFollows((mine.data || []).map(r => r.followee_id));
    } else {
      const who = scopeId || me;
      const column = mode === 'followers' ? 'followee_id' : 'follower_id';
      const filter = mode === 'followers' ? 'followee_id' : 'follower_id';
      const { data: links, error } = await c.from('follows')
        .select(column).eq(filter, who).limit(LIMIT);
      if (error) throw new Error(error.message);

      const ids = [...new Set((links || []).map(r => r[column]))];
      if (!ids.length){ rows = []; render(); return true; }

      const [people, mine] = await Promise.all([
        c.from('profiles').select(SELECT).in('id', ids),
        c.from('follows').select('followee_id').eq('follower_id', me)
      ]);
      if (people.error) throw new Error(people.error.message);
      rows = people.data || [];
      mergeFollows((mine.data || []).map(r => r.followee_id));
    }
    render();
    return true;
  } catch(e){
    if (list) list.innerHTML = '<div class="comment-empty">Could not load people.</div>';
    toast((e && e.message) || 'Could not load people.');
    return false;
  }
}

export async function openPeople(nextMode, nextScope){
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to see people.'); return false; }

  mode = nextMode || 'all';
  scopeId = nextScope || null;
  rows = [];
  render();
  if (typeof window.openModal === 'function') window.openModal('peopleModal');
  return await load();
}

export function closePeople(){
  mode = 'all';
  scopeId = null;
  if (typeof window.closeModal === 'function') window.closeModal('peopleModal');
  return true;
}

/* ------------------------------- follow ---------------------------- */
export async function toggleFollow(uid){
  if (!uid) return false;
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to follow.'); return false; }

  const c = sb();
  const me = meId();
  if (!c || !me){ toast('Sign in to follow someone.'); return false; }

  const was = following.has(uid);
  if (was) following.delete(uid); else following.add(uid);
  repaint(uid);

  try {
    const { error } = was
      ? await c.from('follows').delete().eq('follower_id', me).eq('followee_id', uid)
      : await c.from('follows').insert({ follower_id: me, followee_id: uid });
    if (error) throw new Error(error.message || 'Could not update your crew.');
    toast(was ? 'Unfollowed.' : 'Following.');
    return true;
  } catch(e){
    if (was) following.add(uid); else following.delete(uid);
    repaint(uid);
    toast((e && e.message) || 'Could not update your crew.');
    return false;
  }
}

/* ------------------------------- wiring ---------------------------- */
function wire(containerId){
  const box = el(containerId);
  if (!box || box.dataset.wired) return;
  box.dataset.wired = '1';
  box.addEventListener('click', e => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const f = t.closest('[data-follow]');
    if (f){ toggleFollow(f.getAttribute('data-follow')); return; }
    const o = t.closest('[data-open]');
    if (o && typeof window.openProfile === 'function') window.openProfile(o.getAttribute('data-open'));
  });
}

export function initPeople(){ wire('peopleList'); wire('searchList'); }

export function resetPeople(){
  rows = [];
  mode = 'all';
  scopeId = null;
  following.clear();
  const list = el('peopleList');
  if (list) list.innerHTML = '';
}
