/* ==================================================================
   SOCIAL - graph de follow (annuaire, followers, following)
   Source unique de vérité : le Set `following` de ce module.
   L5 : comptes privés → le suivi passe par une demande (state='pending')
   visible comme « Requested » ; la section « Requests » (mode
   followers de mon profil) affiche les demandes reçues Accept/Decline.
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';
import { sb, withMissingColumn, acceptedFollows, missingColumnField } from './client.js';
import { privacyMode, isPrivateProfile, privacySelect } from './privacy.js';

const LIMIT = 50;
const SELECT = 'id,username,display_name,avatar_url,bio';

let rows = [];
let reqRows = [];        /* demandes reçues (mode followers de mon profil) */
let mode = 'all';          /* 'all' | 'followers' | 'following' */
let scopeId = null;        /* profil dont on affiche les liens */
let following = new Set(); /* ids que JE suis (acceptés) */
let requested = new Set(); /* ids pour lesquels MA demande est en attente */

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function gateOk(){ return typeof window.socialAvailable === 'function' ? window.socialAvailable() : SOCIAL_ENABLED; }
function meId(){ return (window.socialUser || {}).id || null; }

export function isFollowed(uid){ return following.has(uid); }
export function isRequested(uid){ return requested.has(uid); }
export function mergeFollows(ids){ (ids || []).forEach(id => following.add(id)); }

/* Lignes de follows (moi en émetteur) : suivis acceptés + demandes. */
export function mergeLinkRows(list){
  (list || []).forEach(r => {
    if (r && r.state === 'pending' && r.followee_id) requested.add(r.followee_id);
  });
  mergeFollows(acceptedFollows(list).map(r => r.followee_id));
}

export function followingIds(){ return [...following]; }

export function personRowHtml(p){
  const name = p.display_name || p.username || 'Athlete';
  const avatar = p.avatar_url
    ? '<img class="av-img" src="' + esc(p.avatar_url) + '" alt="">'
    : esc(String(name).trim().charAt(0).toUpperCase() || '?');
  const isF = following.has(p.id);
  const isQ = !isF && requested.has(p.id);
  const label = isF ? 'Following' : (isQ ? 'Requested' : 'Follow');
  return '<div class="person" data-row="' + esc(p.id) + '">' +
    '<button type="button" class="avatar person-avatar" data-open="' + esc(p.id) + '" ' +
      'aria-label="Open profile">' + avatar + '</button>' +
    '<button type="button" class="person-who" data-open="' + esc(p.id) + '">' +
      '<div class="person-name">' + esc(name) + '</div>' +
      (p.username ? '<div class="person-meta">@' + esc(p.username) + '</div>' : '') +
      (p.bio ? '<div class="person-bio">' + esc(p.bio) + '</div>' : '') +
    '</button>' +
    '<button type="button" class="btn btn-sm ' + (isF || isQ ? '' : 'btn-primary') + '" ' +
      'data-follow="' + esc(p.id) + '" data-state="' + (isF ? 'accepted' : (isQ ? 'pending' : 'none')) + '" ' +
      'aria-pressed="' + (isF ? 'true' : 'false') + '">' + label + '</button>' +
    '</div>';
}

function requestRowHtml(p){
  const name = p.display_name || p.username || 'Athlete';
  const avatar = p.avatar_url
    ? '<img class="av-img" src="' + esc(p.avatar_url) + '" alt="">'
    : esc(String(name).trim().charAt(0).toUpperCase() || '?');
  return '<div class="person" data-req="' + esc(p.id) + '">' +
    '<button type="button" class="avatar person-avatar" data-open="' + esc(p.id) + '" ' +
      'aria-label="Open profile">' + avatar + '</button>' +
    '<button type="button" class="person-who" data-open="' + esc(p.id) + '">' +
      '<div class="person-name">' + esc(name) + '</div>' +
      (p.username ? '<div class="person-meta">@' + esc(p.username) + '</div>' : '') +
    '</button>' +
    '<span class="req-actions">' +
      '<button type="button" class="btn btn-sm btn-primary" data-accept="' + esc(p.id) + '">Accept</button>' +
      '<button type="button" class="btn btn-sm btn-ghost" data-decline="' + esc(p.id) + '">Decline</button>' +
    '</span>' +
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
  const req = reqRows.length
    ? '<div class="people-sec">Requests</div>' + reqRows.map(requestRowHtml).join('')
    : '';
  list.innerHTML = req + (rows.length ? rows.map(personRowHtml).join('') : emptyHtml());
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
/* Mes liens (moi → ...) : suivis acceptés + demandes en attente. */
async function refreshMyLinks(c, me){
  const res = await withMissingColumn(
    cc => c.from('follows').select(cc).eq('follower_id', me).limit(LIMIT),
    'followee_id,state'
  );
  const all = res.data || [];
  requested.clear();
  mergeLinkRows(all);
}

/* Demandes REÇUES (... → moi) : uniquement sur mon propre profil. */
async function loadRequests(c, me){
  reqRows = [];
  if (mode !== 'followers' || (scopeId || me) !== me) return;
  const res = await withMissingColumn(
    cc => c.from('follows').select(cc).eq('followee_id', me).limit(LIMIT),
    'follower_id,state'
  );
  const pend = [...new Set((res.data || [])
    .filter(r => r.state === 'pending')
    .map(r => r.follower_id).filter(Boolean))];
  if (!pend.length) return;
  const { data, error } = await c.from('profiles').select(SELECT).in('id', pend);
  if (!error) reqRows = data || [];
}

async function load(){
  const c = sb();
  const me = meId();
  if (!c || !me) return false;

  const list = el('peopleList');
  if (list && !rows.length) list.innerHTML = '<div class="comment-empty">Loading…</div>';

  try {
    await privacyMode();
    if (mode === 'all'){
      const [people] = await Promise.all([
        c.from('profiles').select(SELECT + privacySelect()).neq('id', me)
          .order('created_at', { ascending: false }).limit(LIMIT),
        refreshMyLinks(c, me)
      ]);
      if (people.error) throw new Error(people.error.message);
      rows = people.data || [];
      reqRows = [];
    } else {
      const who = scopeId || me;
      /* followers : liens dont je suis la cible (followee_id=who), ids =
         émetteurs ; following : liens émis par who, ids = cibles. */
      const column = mode === 'followers' ? 'follower_id' : 'followee_id';
      const filter = mode === 'followers' ? 'followee_id' : 'follower_id';
      const res = await withMissingColumn(
        cc => c.from('follows').select(cc).eq(filter, who).limit(LIMIT),
        'follower_id,followee_id,state'
      );
      if (res.error) throw new Error(res.error.message);

      const links = acceptedFollows(res.data || []);
      const ids = [...new Set(links.map(r => r[column]).filter(Boolean))];
      if (!ids.length){
        rows = [];
        await Promise.all([refreshMyLinks(c, me), loadRequests(c, me)]);
        render();
        return true;
      }

      const [people] = await Promise.all([
        c.from('profiles').select(SELECT + privacySelect()).in('id', ids),
        refreshMyLinks(c, me)
      ]);
      if (people.error) throw new Error(people.error.message);
      rows = people.data || [];
    }
    await loadRequests(c, me);
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
  reqRows = [];
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

/* ------------------------- follow / demande ------------------------ */
/* Compte privé détecté ? (interrogé à la volée pour éviter toute
   incohérence entre annuaire, recherche et profil). */
async function targetIsPrivate(c, uid){
  try {
    await privacyMode();
    const { data } = await c.from('profiles')
      .select('id,bio' + privacySelect()).eq('id', uid).limit(1);
    const p = Array.isArray(data) ? data[0] : data;
    return isPrivateProfile(p);
  } catch(e){ return false; }
}

/* intent : 'auto' (défaut) | 'follow' | 'request' | 'unfollow' | 'cancel'.
   Un suivi public insère SANS state (accepté par défaut, safe avant/après
   v8) ; un compte privé insère state:'pending' — si la colonne manque
   (v8 non appliquée) la ligne retombe en abonnement accepté. */
export async function toggleFollow(uid, intent){
  if (!uid) return false;
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to follow.'); return false; }

  const c = sb();
  const me = meId();
  if (!c || !me){ toast('Sign in to follow someone.'); return false; }

  const wasF = following.has(uid);
  const wasQ = requested.has(uid);
  let act = (intent === 'follow' || intent === 'request' ||
              intent === 'unfollow' || intent === 'cancel') ? intent : null;
  if (!act){
    if (wasF) act = 'unfollow';
    else if (wasQ) act = 'cancel';
    else act = (await targetIsPrivate(c, uid)) ? 'request' : 'follow';
  }

  const snapF = new Set(following);
  const snapQ = new Set(requested);
  if (act === 'unfollow' || act === 'cancel'){
    following.delete(uid); requested.delete(uid);
  } else if (act === 'request'){
    following.delete(uid); requested.add(uid);
  } else {
    requested.delete(uid); following.add(uid);
  }
  repaint(uid);

  try {
    if (act === 'unfollow' || act === 'cancel'){
      const { error } = await c.from('follows').delete()
        .eq('follower_id', me).eq('followee_id', uid);
      if (error) throw new Error(error.message || 'Could not update your crew.');
      toast(act === 'cancel' ? 'Request canceled.' : 'Unfollowed.');
    } else {
      const payload = { follower_id: me, followee_id: uid };
      if (act === 'request') payload.state = 'pending';
      let r = await c.from('follows').insert(payload);
      if (r.error && act === 'request' && missingColumnField(r.error) === 'state'){
        delete payload.state;
        r = await c.from('follows').insert(payload);
        if (!r.error){
          /* v8 absente : accepté d'office — on reflète la base */
          requested.delete(uid);
          following.add(uid);
          toast('Following.');
          repaint(uid);
          return true;
        }
      }
      if (r.error) throw new Error(r.error.message || 'Could not update your crew.');
      toast(act === 'request' ? 'Request sent.' : 'Following.');
    }
    repaint(uid);        /* re-équilibre profil / crew / recherche */
    return true;
  } catch(e){
    following = snapF;
    requested = snapQ;
    repaint(uid);
    toast((e && e.message) || 'Could not update your crew.');
    return false;
  }
}

/* --------------------------- demandes reçues ----------------------- */
async function acceptRequest(uid){
  const c = sb();
  const me = meId();
  if (!c || !me || !uid) return false;
  const { error } = await c.from('follows')
    .update({ state: 'accepted' })
    .eq('follower_id', uid).eq('followee_id', me);
  if (error){
    if (missingColumnField(error) === 'state')
      toast('Requests go live once the update is applied.');
    else toast(error.message || 'Could not accept this request.');
    return false;
  }
  reqRows = reqRows.filter(r => r.id !== uid);
  await load();                 /* ANA compte maintenant dans la liste */
  toast('Request accepted.');
  if (typeof window.onFollowChanged === 'function') window.onFollowChanged(uid, false);
  return true;
}

async function declineRequest(uid){
  const c = sb();
  const me = meId();
  if (!c || !me || !uid) return false;
  const { error } = await c.from('follows').delete()
    .eq('follower_id', uid).eq('followee_id', me);
  if (error){ toast(error.message || 'Could not decline this request.'); return false; }
  reqRows = reqRows.filter(r => r.id !== uid);
  render();
  toast('Request declined.');
  if (typeof window.onFollowChanged === 'function') window.onFollowChanged(uid, false);
  return true;
}

/* ------------------------------- wiring ---------------------------- */
function wire(containerId){
  const box = el(containerId);
  if (!box || box.dataset.wired) return;
  box.dataset.wired = '1';
  box.addEventListener('click', e => {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    const ac = t.closest('[data-accept]');
    if (ac){ acceptRequest(ac.getAttribute('data-accept')); return; }
    const dc = t.closest('[data-decline]');
    if (dc){ declineRequest(dc.getAttribute('data-decline')); return; }
    const f = t.closest('[data-follow]');
    if (f){ toggleFollow(f.getAttribute('data-follow')); return; }
    const o = t.closest('[data-open]');
    if (o && typeof window.openProfile === 'function') window.openProfile(o.getAttribute('data-open'));
  });
}

export function initPeople(){ wire('peopleList'); wire('searchList'); }

export function resetPeople(){
  rows = [];
  reqRows = [];
  mode = 'all';
  scopeId = null;
  following.clear();
  requested.clear();
  const list = el('peopleList');
  if (list) list.innerHTML = '';
}
