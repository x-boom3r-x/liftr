/* ==================================================================
   SOCIAL - profil façon Instagram : photo, @pseudo, stats, grille
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';
import { sb } from './client.js';
import { compressImage, mediaUrl } from './feed.js';
import { storyRingClass } from './rings.js';
import {
  privacyMode, isPrivateProfile, stripPrivacy, withPrivacy,
  canSeePosts, writePrivacy
} from './privacy.js';

const AVATAR_EDGE = 512;
const AVATAR_Q = 0.85;
const USER_RE = /^[a-z0-9_]{3,24}$/;
const GRID_LIMIT = 90;

const POST_GRID = 'id,author_id,body,image_path,thumb_path,kind,created_at';

let targetId = null;      /* null = moi */
let current = null;       /* dernier profil rendu */
let counts = { posts: 0, followers: 0, following: 0 };
let following = false;
let grid = [];
let gridCounts = {};      /* post_id -> { c, l } */
let liked = [];
let ptab = 'grid';
let busy = false;

let avatarFile = null;    /* nouveau Blob en attente */
let avatarDrop = false;   /* supprimer la photo actuelle */
let previewUrl = null;
let pendingPrivate = false;  /* état du bascule « Private » dans la modale */

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function gateOk(){ return typeof window.socialAvailable === 'function' ? window.socialAvailable() : SOCIAL_ENABLED; }
function meId(){ return (window.socialUser || {}).id || null; }
function head(title, hint){
  if (typeof window.setSocialHead === 'function') window.setSocialHead(title, hint);
}

function faceHtml(url, name){
  if (url) return '<img class="av-img" src="' + esc(url) + '" alt="">';
  return esc(String(name || '?').trim().charAt(0).toUpperCase() || '?');
}

/* ------------------------------ rendu ------------------------------ */
function paintProfile(){
  const isMe = !!current && current.id === meId();
  const name = (current && current.display_name) || (current && current.username) || 'Athlete';
  const handle = current && current.username ? '@' + current.username : '@—';

  const av = el('profAvatarBtn');
  if (av){
    av.innerHTML = faceHtml(current && current.avatar_url, name);
    av.setAttribute('data-uid', String((current && current.id) || ''));
    const ring = storyRingClass(current && current.id);
    av.classList.toggle('has-story', ring.indexOf('has-story') >= 0);
    av.classList.toggle('seen', ring.indexOf('seen') >= 0);
  }
  if (el('profAvatarBtn')) el('profAvatarBtn').setAttribute('aria-label',
    isMe ? 'Change your profile photo' : name);

  const set = (id, v) => { const n = el(id); if (n) n.textContent = v; };
  set('statPosts', String(counts.posts));
  set('statFollowersBtn', String(counts.followers));
  set('statFollowingBtn', String(counts.following));
  set('profName', name);
  set('profHandle', handle);

  const bio = el('profBio');
  if (bio){
    const b = stripPrivacy((current && current.bio) || '');
    bio.textContent = b;
    bio.classList.toggle('hidden', !b);
  }

  const priv = el('profPriv');
  if (priv) priv.classList.toggle('hidden', !isPrivateProfile(current));

  const actions = el('profActions');
  if (actions){
    actions.innerHTML = isMe
      ? '<button type="button" class="btn btn-primary" id="editProfileBtn" ' +
          'onclick="openEditProfile()">Edit profile</button>' +
        '<button type="button" class="btn btn-ghost" onclick="shareProfile()">Share</button>'
      : '<button type="button" class="btn ' + (following ? '' : 'btn-primary') + '" id="profFollowBtn" ' +
          'onclick="toggleFollowFromProfile()" aria-pressed="' + (following ? 'true' : 'false') + '">' +
          (following ? 'Following' : 'Follow') + '</button>' +
        '<button type="button" class="btn btn-ghost" id="profMessageBtn" onclick="openThreadOfTarget()">' +
          'Message</button>';
  }

  const tabs = el('profTabs');
  if (tabs){
    const likedBtn = tabs.querySelector('[data-ptab="liked"]');
    if (likedBtn) likedBtn.classList.toggle('hidden', !isMe);
    if (!isMe && ptab !== 'grid') ptab = 'grid';
    tabs.querySelectorAll('.ptab').forEach(b =>
      b.classList.toggle('active', b.dataset.ptab === ptab));
  }
  paintTiles();
  paintLiked();

  head('Profile', handle);
}

function tileHtml(p, countsRow){
  const url = mediaUrl(p.image_path, sb());
  const inner = url
    ? '<img src="' + esc(url) + '" alt="" loading="lazy">'
    : '<span class="ptile-text">' + esc((p.body || '').slice(0, 120)) + '</span>';
  const stats = countsRow
    ? '<span class="ptile-stats"><span aria-hidden="true">♥ ' + (countsRow.l || 0) + '</span>' +
      '<span aria-hidden="true">💬 ' + (countsRow.c || 0) + '</span></span>'
    : '';
  return '<button type="button" class="ptile' + (url ? '' : ' txt') + '" ' +
    'data-post="' + esc(p.id || '') + '" aria-label="Open post">' + inner + stats + '</button>';
}

function emptyTile(msg, sub){
  return '<div class="feed-empty"><div class="feed-empty-ico">▤</div>' +
    '<div class="feed-empty-t">' + esc(msg) + '</div>' +
    (sub ? '<div class="feed-empty-s">' + esc(sub) + '</div>' : '') + '</div>';
}

function paintTiles(){
  const g = el('profGrid');
  const wrap = el('profGridLiked');
  if (g) g.classList.toggle('hidden', ptab !== 'grid');
  if (wrap) wrap.classList.add('hidden');
  if (!g) return;
  const isMe = !!current && current.id === meId();
  if (current && !isMe && isPrivateProfile(current) && !following){
    g.className = 'prof-grid empty';
    g.innerHTML = emptyTile('This account is private', 'Follow to see their posts.');
    return;
  }
  if (!grid.length){
    g.className = 'prof-grid empty';
    g.innerHTML = isMe
      ? emptyTile('No posts yet', 'Share your first session from Home.')
      : emptyTile('Nothing posted yet', '');
    return;
  }
  g.className = 'prof-grid';
  g.innerHTML = grid.map(p => tileHtml(p, gridCounts[p.id])).join('');
}

function paintLiked(){
  const wrap = el('profGridLiked');
  if (!wrap) return;
  wrap.classList.toggle('hidden', ptab !== 'liked');
  if (ptab !== 'liked') return;
  if (!liked.length){
    wrap.className = 'prof-grid empty';
    wrap.innerHTML = emptyTile('No liked posts yet', 'Tap the upvote on a post to keep it here.');
    return;
  }
  wrap.className = 'prof-grid';
  wrap.innerHTML = liked.map(p => tileHtml(p, null)).join('');
}

export function setProfileTab(next){
  ptab = next === 'liked' ? 'liked' : 'grid';
  paintProfile();
  if (ptab === 'liked' && !liked.length) loadLiked();
  return ptab;
}

function skeleton(){
  const set = (id, v) => { const n = el(id); if (n) n.textContent = v; };
  set('statPosts', '—'); set('statFollowersBtn', '—'); set('statFollowingBtn', '—');
  set('profName', '…'); set('profHandle', '…');
  const av = el('profAvatarBtn');
  if (av) av.textContent = '…';
  const bio = el('profBio'); if (bio) bio.classList.add('hidden');
  const priv = el('profPriv'); if (priv) priv.classList.add('hidden');
  const g = el('profGrid'); if (g){ g.className = 'prof-grid empty'; g.innerHTML = ''; }
  const a = el('profActions'); if (a) a.innerHTML = '';
}

/* ------------------------------ données ---------------------------- */
function fetchGridCounts(c, ids){
  if (!c || !ids.length) return;
  Promise.resolve(c.from('feed_counts').select('post_id,comment_count,like_count').in('post_id', ids))
    .then(res => {
      if (res.error || !res.data) return;
      const map = {};
      res.data.forEach(r => { map[r.post_id] = { c: +r.comment_count || 0, l: +r.like_count || 0 }; });
      gridCounts = map;
      if (ptab === 'grid') paintTiles();
    })
    .catch(() => {});
}

async function loadLiked(c){
  const id = (current && current.id) || targetId || meId();
  c = c || sb();
  if (!c || !id) return;
  try {
    const { data: lk } = await c.from('likes')
      .select('post_id,created_at')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(GRID_LIMIT);
    const ids = (lk || []).map(x => x.post_id).filter(Boolean);
    if (!ids.length){ liked = []; paintLiked(); return; }
    const { data } = await c.from('posts')
      .select(POST_GRID)
      .in('id', ids)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    liked = data || [];
  } catch(e){ liked = []; }
  paintLiked();
}

export async function renderProfile(){
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to see profiles.'); return false; }
  const c = sb();
  const me = meId();
  const id = targetId || me;
  if (!c || !id) return false;

  const isMe = id === me;
  skeleton();

  try {
    await privacyMode();
    const reqs = [
      c.from('profiles').select('*').eq('id', id).limit(1),
      c.from('posts').select(POST_GRID, { count: 'exact' })
        .eq('author_id', id).is('deleted_at', null)
        .order('created_at', { ascending: false }).limit(GRID_LIMIT),
      c.from('follows').select('follower_id', { count: 'exact', head: true }).eq('followee_id', id),
      c.from('follows').select('followee_id', { count: 'exact', head: true }).eq('follower_id', id)
    ];
    if (!isMe) reqs.push(c.from('follows').select('followee_id')
      .eq('follower_id', me).eq('followee_id', id).limit(1));

    const res = await Promise.all(reqs);
    if (res[1].error) throw new Error(res[1].error.message || 'Could not load this profile.');

    const row0 = Array.isArray(res[0] && res[0].data) ? res[0].data[0] : (res[0] && res[0].data);
    current = Object.assign(
      { id: id, username: null, display_name: null, bio: '', avatar_url: null },
      row0 || {}
    );
    grid = res[1].data || [];
    gridCounts = {};
    liked = [];
    counts = {
      posts: res[1].count || grid.length,
      followers: res[2].count || 0,
      following: res[3].count || 0
    };
    const rel = res[4] && (Array.isArray(res[4].data) ? res[4].data[0] : res[4].data);
    following = isMe ? false : !!rel;
    /* compte privé non suivi : la grille reste verrouillée */
    if (!isMe && isPrivateProfile(current) && !following) grid = [];
    paintProfile();
    fetchGridCounts(c, grid.map(p => p.id));
    if (ptab === 'liked') loadLiked(c);
    return true;
  } catch(e){
    toast((e && e.message) || 'Could not load this profile.');
    const g = el('profGrid');
    if (g){
      g.className = 'prof-grid empty';
      g.innerHTML = '<div class="feed-empty"><div class="feed-empty-ico err">!</div>' +
        '<div class="feed-empty-t">Could not load this profile</div>' +
        '<button type="button" class="btn btn-sm btn-ghost" onclick="renderProfile()">Retry</button></div>';
    }
    return false;
  }
}

export function openProfile(id){
  targetId = (id && id !== meId()) ? id : null;
  if (typeof window.setSView === 'function') window.setSView('profile');
  else renderProfile();
  return true;
}

export function showMyProfile(){
  targetId = null;
  return openProfile(null);
}

export function toggleFollowFromProfile(){
  const id = targetId || (current && current.id);
  if (!id) return false;
  if (typeof window.toggleFollow !== 'function') return false;

  const before = following;
  following = !before;
  counts.followers = Math.max(0, counts.followers + (following ? 1 : -1));
  paintProfile();

  window.toggleFollow(id).then(ok => {
    if (ok) return;
    following = before;
    counts.followers = Math.max(0, counts.followers + (following ? 1 : -1));
    paintProfile();
  });
  return true;
}

export function openThreadOfTarget(){
  const id = targetId || (current && current.id);
  if (!id) return false;
  if (typeof window.openThread === 'function') window.openThread(id);
  return true;
}

export function shareProfile(){
  const handle = current && current.username ? '@' + current.username : 'Liftr';
  const url = location.origin + location.pathname;
  try {
    if (navigator.share){
      navigator.share({ title: handle + ' on Liftr', url: url }).catch(() => {});
      return true;
    }
  } catch(e){}
  try {
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(() => toast('Profile link copied.'),
        () => toast('Profile link copied.'));
      return true;
    }
  } catch(e){}
  toast('Profile link copied.');
  return true;
}

/* --------------------------- édition ------------------------------ */
function showError(msg){
  const box = el('profileError');
  if (!box) return;
  box.textContent = msg || '';
  box.classList.toggle('hidden', !msg);
}

function clearPreview(){
  if (previewUrl){ URL.revokeObjectURL(previewUrl); previewUrl = null; }
}

function paintPreview(){
  const box = el('editAvatarPreview');
  if (!box) return;
  const name = (el('editName') && el('editName').value) || (current && current.display_name) || '';
  if (previewUrl) box.innerHTML = '<img class="av-img" src="' + esc(previewUrl) + '" alt="">';
  else if (!avatarDrop && current && current.avatar_url)
    box.innerHTML = '<img class="av-img" src="' + esc(current.avatar_url) + '" alt="">';
  else box.textContent = faceHtml(null, name);
  const rm = el('editAvatarRemove');
  if (rm) rm.classList.toggle('hidden', !!(avatarDrop || avatarFile) ||
    !(current && current.avatar_url));
}

export function openEditProfile(){
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to edit your profile.'); return false; }
  if (!current) renderProfile();

  avatarFile = null;
  avatarDrop = false;
  clearPreview();
  showError('');

  const set = (id, v) => { const n = el(id); if (n) n.value = v; };
  set('editUsername', (current && current.username) || '');
  set('editName', (current && current.display_name) || '');
  const plainBio = stripPrivacy((current && current.bio) || '');
  set('editBio', plainBio);
  const cnt = el('editBioCount');
  if (cnt) cnt.textContent = plainBio.length + ' / 300';
  setPrivateSwitch(isPrivateProfile(current));

  const input = el('editAvatarFile');
  if (input) input.value = '';
  paintPreview();
  if (typeof window.fillAccount === 'function') window.fillAccount();

  if (typeof window.openModal === 'function') window.openModal('profileModal');
  return true;
}

export function pickAvatar(){
  const input = el('editAvatarFile');
  if (!input) return false;
  input.click();
  return true;
}

/* Compte privé : bascule dans la modale, appliquée à l'enregistrement. */
function setPrivateSwitch(on){
  pendingPrivate = !!on;
  const sw = el('editPrivate');
  if (sw){
    sw.classList.toggle('on', pendingPrivate);
    sw.setAttribute('aria-checked', pendingPrivate ? 'true' : 'false');
  }
  return pendingPrivate;
}

export function togglePrivateEdit(){
  return setPrivateSwitch(!pendingPrivate);
}

export function removeAvatar(){
  avatarFile = null;
  avatarDrop = true;
  clearPreview();
  paintPreview();
  return true;
}

export async function onAvatarChosen(e){
  const input = e && e.target;
  const file = input && input.files && input.files[0];
  if (!file) return false;
  if (input) input.value = '';
  if (!/^image\//.test(file.type || '')){ toast('Please choose an image file.'); return false; }
  if (file.size > 12 * 1024 * 1024){ toast('That photo is too large (12 MB max).'); return false; }
  try {
    avatarFile = await compressImage(file, AVATAR_EDGE, AVATAR_Q);
    avatarDrop = false;
    clearPreview();
    previewUrl = URL.createObjectURL(avatarFile);
    paintPreview();
    return true;
  } catch(err){
    toast('Could not read that photo.');
    return false;
  }
}

/* `avatars/<uid>/avatar-...` -> chemin objet (pour nettoyer l'ancienne photo) */
function avatarKeyFromUrl(url){
  if (!url) return null;
  const mark = '/avatars/';
  const i = url.indexOf(mark);
  if (i < 0) return null;
  return url.slice(i + mark.length).split('?')[0] || null;
}

function dropAvatarFile(c, url){
  const key = avatarKeyFromUrl(url);
  if (!c || !key) return;
  try { c.storage.from('avatars').remove([key]).catch(() => {}); } catch(e){}
}

async function uploadAvatar(c, blob){
  const id = meId();
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  /* chemin unique : le CDN garde `cache-control: 1 an` sur la meme URL,
     donc re-televerser sur le meme chemin affiche l'ancienne photo. */
  const path = id + '/avatar-' + Date.now() + '-' +
    Math.random().toString(36).slice(2, 8) + '.' + ext;
  const { error } = await c.storage.from('avatars').upload(path, blob, {
    contentType: blob.type, cacheControl: '31536000', upsert: false
  });
  if (error) throw new Error(error.message || 'Could not upload your photo.');
  const r = c.storage.from('avatars').getPublicUrl(path);
  const url = (r && r.data && r.data.publicUrl) || '';
  if (!url) throw new Error('Could not upload your photo.');
  const prev = (current && current.avatar_url) || null;
  if (prev && avatarKeyFromUrl(prev) !== path) dropAvatarFile(c, prev);
  return url;
}

export async function submitProfile(){
  if (busy) return false;
  if (!SOCIAL_ENABLED){ showError('Social is not configured yet.'); return false; }
  if (!gateOk()){ showError('Sign in and go online to save your profile.'); return false; }
  const c = sb();
  const me = meId();
  if (!c || !me){ showError('Sign in to edit your profile.'); return false; }

  const username = ((el('editUsername') && el('editUsername').value) || '')
    .trim().toLowerCase().replace(/^@+/, '');
  const display = ((el('editName') && el('editName').value) || '').trim().slice(0, 50);
  const bio = ((el('editBio') && el('editBio').value) || '').trim().slice(0, 300);

  if (!USER_RE.test(username)){ showError('Username must be 3–24 chars: a–z, 0–9, _'); return false; }
  if (!display){ showError('Please add a name.'); return false; }
  showError('');

  const btn = el('profileSubmit');
  busy = true;
  if (btn){ btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    let url = current && current.avatar_url ? current.avatar_url : null;
    if (avatarFile) url = await uploadAvatar(c, avatarFile);
    else if (avatarDrop){ dropAvatarFile(c, url); url = null; }

    /* le drapeau privé vit dans la colonne `is_private` si elle existe,
       sinon dans un marqueur invisible du bio (voir js/social/privacy.js) */
    const mode = await privacyMode();
    const privacyChanged = pendingPrivate !== isPrivateProfile(current);
    const bioOut = mode === 'column' ? bio : withPrivacy(bio, pendingPrivate);

    const { error } = await c.from('profiles')
      .update({ username: username, display_name: display, bio: bioOut, avatar_url: url })
      .eq('id', me);
    if (error) throw new Error(friendlyProfileError(error));
    if (privacyChanged && mode === 'column') await writePrivacy(pendingPrivate);

    current = Object.assign({}, current || { id: me },
      { username: username, display_name: display, bio: bioOut, avatar_url: url });
    paintProfile();

    if (typeof window.closeModal === 'function') window.closeModal('profileModal');
    if (typeof window.refreshIdentity === 'function') window.refreshIdentity();
    if (typeof window.renderFeed === 'function' && !targetId) window.renderFeed();
    toast('Profile updated.');
    return true;
  } catch(e){
    showError((e && e.message) || 'Could not save your profile.');
    return false;
  } finally {
    busy = false;
    if (btn){ btn.disabled = false; btn.textContent = 'Save'; }
  }
}

function friendlyProfileError(error){
  const msg = (error && error.message) || '';
  if (/duplicate|unique|23505/i.test(msg)) return 'That username is already taken.';
  return msg || 'Could not save your profile.';
}

function wireTiles(id, source){
  const box = el(id);
  if (!box || box.dataset.wired) return;
  box.dataset.wired = '1';
  box.addEventListener('click', e => {
    const t = e.target && e.target.closest && e.target.closest('[data-post]');
    if (!t) return;
    const pid = t.getAttribute('data-post');
    const post = source().find(p => p.id === pid);
    if (!post) return;
    if (String(post.author_id || '') === String(meId() || '') &&
        typeof window.openPostMenu === 'function'){
      window.openPostMenu(pid, post);
      return;
    }
    if (typeof window.openComments === 'function') window.openComments(pid, post);
  });
}

export function initProfile(){
  const input = el('editAvatarFile');
  if (input && !input.dataset.wired){
    input.dataset.wired = '1';
    input.addEventListener('change', onAvatarChosen);
  }
  const bio = el('editBio');
  if (bio && !bio.dataset.wired){
    bio.dataset.wired = '1';
    bio.addEventListener('input', () => {
      const c = el('editBioCount');
      if (c) c.textContent = bio.value.length + ' / 300';
    });
  }
  wireTiles('profGrid', () => grid);
  wireTiles('profGridLiked', () => liked);
  const tabs = el('profTabs');
  if (tabs && !tabs.dataset.wired){
    tabs.dataset.wired = '1';
    tabs.addEventListener('click', e => {
      const b = e.target && e.target.closest && e.target.closest('.ptab');
      if (b) setProfileTab(b.dataset.ptab);
    });
  }
  const av = el('profAvatarBtn');
  if (av && !av.dataset.wired){
    av.dataset.wired = '1';
    av.addEventListener('click', () => {
      if (targetId || !gateOk()) return;
      openEditProfile();
    });
  }
  const f1 = el('statFollowersBtn');
  if (f1 && !f1.dataset.wired){
    f1.dataset.wired = '1';
    f1.addEventListener('click', () => {
      if (typeof window.openPeople === 'function') window.openPeople('followers', targetId || (current && current.id));
    });
  }
  const f2 = el('statFollowingBtn');
  if (f2 && !f2.dataset.wired){
    f2.dataset.wired = '1';
    f2.addEventListener('click', () => {
      if (typeof window.openPeople === 'function') window.openPeople('following', targetId || (current && current.id));
    });
  }
}

export function resetProfile(){
  targetId = null;
  current = null;
  counts = { posts: 0, followers: 0, following: 0 };
  following = false;
  pendingPrivate = false;
  grid = [];
  gridCounts = {};
  liked = [];
  ptab = 'grid';
  avatarFile = null;
  avatarDrop = false;
  clearPreview();
}
