/* ==================================================================
   SOCIAL - Feed : composition, compression photo, liste des posts
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';
import { sb } from './client.js';

const PAGE_SIZE = 20;
const SCROLL_KEY = 'at_feedScroll';
const FULL_EDGE = 1080;      /* côté max de la photo publiée */
const THUMB_EDGE = 320;      /* côté max de la vignette (blur-up) */
const FULL_Q = 0.85;
const THUMB_Q = 0.8;
const MAX_BYTES = 12 * 1024 * 1024;
const POST_SELECT = 'id,author_id,kind,body,image_path,thumb_path,meta,created_at,deleted_at,author:profiles(id,username,display_name,avatar_url)';

let posts = [];
let hasMore = false;
let counts = {};          /* post_id -> { c, l, liked } */
let scope = 'all';        /* 'all' | 'following' */
let noFollows = false;    /* filtre « Following » sans aucun abonnement */
let loading = false;
let sending = false;
let photo = null;            /* { full, thumb } : deux Blobs WebP */
let photoUrl = null;
let pendingScroll = null;

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function gateOk(){ return typeof window.socialAvailable === 'function' ? window.socialAvailable() : SOCIAL_ENABLED; }

/* ------------------------------ temps ------------------------------ */
export function timeAgo(iso){
  const t = Date.parse(iso || '');
  if (isNaN(t)) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  if (s < 604800) return Math.floor(s / 86400) + 'd';
  return new Date(t).toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

/* --------------------------- compression --------------------------- */
let _webp = null;
export function webpSupported(){
  if (_webp === null){
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 1;
      _webp = c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch(e){ _webp = false; }
  }
  return _webp;
}

function decodeImage(file){
  if (typeof createImageBitmap === 'function'){
    return createImageBitmap(file, { imageOrientation: 'from-image' })
      .catch(() => createImageBitmap(file));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { setTimeout(() => URL.revokeObjectURL(url), 0); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
    img.src = url;
  });
}

function encode(canvas, mime, quality){
  return new Promise((resolve, reject) => {
    if (canvas.toBlob) return canvas.toBlob(b => b ? resolve(b) : reject(new Error('encode failed')), mime, quality);
    try {
      const data = canvas.toDataURL(mime, quality);
      const bin = atob(data.split(',')[1]);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      resolve(new Blob([buf], { type: mime }));
    } catch(e){ reject(e); }
  });
}

/* Redimensionne + ré-encode. Exporté pour les tests : c'est le cœur du
   contrat « 1080 px / 320 px en WebP ». */
export async function compressImage(file, maxEdge, quality){
  const src = await decodeImage(file);
  const w0 = src.width || 0, h0 = src.height || 0;
  if (!w0 || !h0){ if (src.close) src.close(); throw new Error('empty image'); }
  const scale = Math.min(1, maxEdge / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * scale));
  const h = Math.max(1, Math.round(h0 * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0B0B0D';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(src, 0, 0, w, h);
  if (src.close) src.close();

  const mime = webpSupported() ? 'image/webp' : 'image/jpeg';
  const blob = await encode(canvas, mime, quality);
  canvas.width = canvas.height = 0;
  return blob;
}

/* ----------------------------- composer ---------------------------- */
export function updateComposer(){
  const ta = el('postBody');
  const value = ta ? ta.value : '';
  const btn = el('postSubmit');
  const count = el('postCount');
  if (count) count.textContent = value.length > 1600 ? (value.length + ' / 2000') : '';
  if (btn) btn.disabled = sending || !(value.trim() || photo);
}

function showPostError(msg){
  const box = el('postError');
  if (!box) return;
  box.textContent = msg || '';
  box.classList.toggle('hidden', !msg);
}

function clearPhoto(){
  if (photoUrl){ URL.revokeObjectURL(photoUrl); photoUrl = null; }
  photo = null;
  const box = el('postPreview');
  if (box) box.classList.add('hidden');
  const img = el('postPreviewImg');
  if (img) img.removeAttribute('src');
}

function setPhoto(full, thumb){
  clearPhoto();
  photo = { full, thumb };
  const img = el('postPreviewImg');
  if (img){
    photoUrl = URL.createObjectURL(thumb);
    img.src = photoUrl;
  }
  const box = el('postPreview');
  if (box) box.classList.remove('hidden');
  updateComposer();
}

export function pickPhoto(){
  const input = el('postPhoto');
  if (!input) return false;
  input.click();
  return true;
}

export function removePhoto(){
  clearPhoto();
  updateComposer();
  return true;
}

export async function onPhotoChosen(e){
  const input = e && e.target;
  const file = input && input.files && input.files[0];
  if (!file) return false;
  if (input) input.value = '';
  if (!/^image\//.test(file.type || '')){ toast('Please choose an image file.'); return false; }
  if (file.size > MAX_BYTES){ toast('That photo is too large (12 MB max).'); return false; }
  try {
    const full = await compressImage(file, FULL_EDGE, FULL_Q);
    const thumb = await compressImage(file, THUMB_EDGE, THUMB_Q);
    setPhoto(full, thumb);
    return true;
  } catch(err){
    toast('Could not read that photo.');
    return false;
  }
}

function renderComposer(){
  const user = window.socialUser || {};
  const name = (user.user_metadata && (user.user_metadata.name || user.user_metadata.display_name)) ||
    user.email || '?';
  const box = el('composerAvatar');
  if (box) box.textContent = String(name).trim().charAt(0).toUpperCase() || '?';
}

function clearComposer(){
  const ta = el('postBody');
  if (ta) ta.value = '';
  clearPhoto();
  showPostError('');
  updateComposer();
}

/* ------------------------------ requête ---------------------------- */
async function fetchPage(offset){
  const c = sb();
  if (!c) return { rows: [], error: 'Social is not configured yet.' };

  let q = c.from('posts').select(POST_SELECT).is('deleted_at', null);

  if (scope === 'following'){
    const me = (window.socialUser || {}).id;
    const { data: f, error: fe } = await c.from('follows').select('followee_id').eq('follower_id', me);
    if (fe) return { rows: [], error: fe.message || 'Could not load your crew.' };
    const ids = (f || []).map(r => r.followee_id);
    if (!ids.length){ noFollows = true; return { rows: [], error: null }; }
    noFollows = false;
    q = q.in('author_id', ids);
  } else {
    noFollows = false;
  }

  const { data, error } = await q
    .order('created_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE - 1);
  if (error) return { rows: [], error: error.message || 'Could not load the feed.' };
  return { rows: data || [], error: null };
}

/* Compteurs de commentaires + likes : best-effort, jamais bloquant. */
async function fetchCounts(){
  counts = {};
  const c = sb();
  if (!c || !posts.length) return;
  const ids = posts.map(p => p.id);
  const me = (window.socialUser || {}).id || null;
  const jobs = [
    c.from('feed_counts').select('post_id,comment_count,like_count').in('post_id', ids)
  ];
  if (me){
    jobs.push(c.from('likes').select('post_id').in('post_id', ids).eq('user_id', me));
  }
  const out = await Promise.all(jobs);
  const rows = out[0] && out[0].data;
  if (rows) rows.forEach(r => {
    counts[r.post_id] = { c: +r.comment_count || 0, l: +r.like_count || 0, liked: false };
  });
  const mine = out[1] && out[1].data;
  if (mine) mine.forEach(r => { if (counts[r.post_id]) counts[r.post_id].liked = true; });
}

export async function refreshCounts(){
  await fetchCounts();
  paint();
}

/* ------------------------------- likes ----------------------------- */
export async function toggleLike(id){
  const c = sb();
  const me = (window.socialUser || {}).id;
  const cur = counts[id] || { c: 0, l: 0, liked: false };
  if (!c || !me || !id) return false;

  const prev = { c: cur.c, l: cur.l, liked: cur.liked };
  counts[id] = { c: cur.c, l: Math.max(0, cur.l + (cur.liked ? -1 : 1)), liked: !cur.liked };
  paintOne(id);

  try {
    let error = null;
    if (prev.liked){
      const r = await c.from('likes').delete().eq('post_id', id).eq('user_id', me);
      error = r && r.error;
    } else {
      const r = await c.from('likes').insert({ post_id: id, user_id: me });
      error = r && r.error;
    }
    if (error) throw new Error(error.message);
    return counts[id].liked;
  } catch(e){
    counts[id] = prev;
    paintOne(id);
    toast((e && e.message) || 'Could not update your like.');
    return prev.liked;
  }
}

export function sharePost(id){
  const p = posts.find(x => x.id === id);
  const url = location.origin + location.pathname;
  const text = (p && p.body ? String(p.body).slice(0, 90) : 'Liftr');
  try {
    if (navigator.share){
      navigator.share({ title: 'Liftr', text: text, url: url }).catch(() => {});
      return true;
    }
  } catch(e){}
  try {
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(url).then(() => toast('Link copied.'), () => toast('Link copied.'));
      return true;
    }
  } catch(e){}
  toast('Link copied.');
  return true;
}

function paintOne(id){
  const list = el('feedList');
  if (!list) return;
  const node = list.querySelector('[data-post="' + id + '"]');
  const p = posts.find(x => x.id === id);
  if (!node || !p) return;
  const tpl = document.createElement('div');
  tpl.innerHTML = postCardHtml(p);
  const fresh = tpl.firstElementChild;
  if (fresh) node.replaceWith(fresh);
}

export function feedFollowChanged(){
  if (scope !== 'following') return false;
  posts = [];
  hasMore = false;
  renderFeed();
  return true;
}

export function getFeedScope(){ return scope; }

export function setFeedScope(next){
  scope = next === 'following' ? 'following' : 'all';
  const bar = document.getElementById('feedFilter');
  if (bar){
    bar.querySelectorAll('.seg').forEach(b => b.classList.toggle('active', b.dataset.scope === scope));
  }
  posts = [];
  hasMore = false;
  noFollows = false;
  pendingScroll = null;
  renderFeed();
  return scope;
}

async function uploadPhoto(c, p){
  const user = window.socialUser || {};
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const base = (user.id || 'anon') + '/' + stamp + '-' + rand;
  const ext = p.full.type === 'image/webp' ? 'webp' : 'jpg';
  const opts = { contentType: p.full.type, cacheControl: '31536000', upsert: false };

  const { error: e1 } = await c.storage.from('posts').upload(base + '.' + ext, p.full, opts);
  if (e1) throw new Error(e1.message || 'Photo upload failed.');
  const { error: e2 } = await c.storage.from('posts').upload(base + '-thumb.' + ext, p.thumb, opts);
  if (e2) throw new Error(e2.message || 'Photo upload failed.');
  return { image_path: base + '.' + ext, thumb_path: base + '-thumb.' + ext };
}
/* ------------------------------- rendu ----------------------------- */
export function mediaUrl(path, c){
  if (!path) return null;
  if (/^https?:/i.test(path)) return path;
  try {
    const r = c && c.storage.from('posts').getPublicUrl(path);
    return (r && r.data && r.data.publicUrl) || null;
  } catch(e){ return null; }
}

function statStrip(p){
  const m = p.meta || null;
  if (!m) return '';
  const num = v => typeof v === 'number' || /^-?\d+([.,]\d+)?$/.test(String(v).trim());
  const withUnit = (v, u) => (num(v) ? v + ' ' + u : String(v));
  const cells = [];
  if (m.volume != null) cells.push(['Volume', withUnit(m.volume, 'kg')]);
  if (m.duration != null) cells.push(['Durée', withUnit(m.duration, 'min')]);
  if (m.intensity != null) cells.push(['Intensité', m.intensity]);
  if (m.reps != null) cells.push(['Reps', m.reps]);
  if (!cells.length) return '';
  let h = '<div class="post-stats">';
  for (let i = 0; i < cells.length; i++){
    h += '<div class="post-stat"><span class="post-stat-v">' + esc(String(cells[i][1])) + '</span>' +
         '<span class="post-stat-k">' + esc(cells[i][0]) + '</span></div>';
  }
  return h + '</div>';
}

export function postCardHtml(p){
  const c = sb();
  const a = p.author || {};
  const uid = a.id || p.author_id || '';
  const name = a.display_name || a.username || 'Athlete';
  const handle = a.username ? '@' + a.username : '';
  const avatar = a.avatar_url
    ? '<img class="post-avatar-img" src="' + esc(a.avatar_url) + '" alt="">'
    : esc(String(name).trim().charAt(0).toUpperCase() || '?');

  const full = mediaUrl(p.image_path, c);
  const thumb = mediaUrl(p.thumb_path, c) || full;
  const media = full
    ? '<div class="post-media">' +
        (thumb && thumb !== full ? '<img class="post-blur" src="' + esc(thumb) + '" alt="" aria-hidden="true">' : '') +
        '<img class="post-img" src="' + esc(full) + '" alt="" loading="lazy">' +
      '</div>'
    : '';
  const body = p.body ? '<div class="post-body">' + esc(p.body) + '</div>' : '';
  const kind = (p.kind && p.kind !== 'text' && p.kind !== 'photo')
    ? '<span class="chip chip-type post-kind">' + esc(p.kind.toUpperCase()) + '</span>' : '';
  const k = counts[p.id] || { c: 0, l: 0, liked: false };

  const foot = '<div class="post-foot">' +
    '<button type="button" class="post-act" data-act="reply" data-post="' + esc(p.id || '') + '" ' +
      'aria-label="Comments">' +
      '<span class="post-act-ico" aria-hidden="true">💬</span>' +
      '<span class="post-act-n" data-n="comments">' + k.c + '</span>' +
      '<span class="post-act-l">Comment' + (k.c === 1 ? '' : 's') + '</span>' +
    '</button>' +
    '<button type="button" class="post-act post-act-like' + (k.liked ? ' on' : '') + '" ' +
      'data-act="like" data-post="' + esc(p.id || '') + '" aria-label="Like">' +
      '<span class="post-act-ico" aria-hidden="true">♥</span>' +
      '<span class="post-act-n post-act-l-like" data-n="likes">' + k.l + '</span>' +
      '<span class="post-act-l">Like</span>' +
    '</button>' +
    '<button type="button" class="post-act post-act-share" data-act="share" ' +
      'data-post="' + esc(p.id || '') + '" aria-label="Share">' +
      '<span class="post-act-ico" aria-hidden="true">↗</span>' +
      '<span class="post-act-l">Share</span>' +
    '</button>' +
    '</div>';

  return '<article class="post" data-post="' + esc(p.id || '') + '">' +
    '<div class="post-head">' +
      '<button type="button" class="avatar post-avatar ring' + (a.avatar_url ? '' : ' fallback') + '" ' +
        'data-act="profile" data-uid="' + esc(uid) + '" aria-label="Open profile">' + avatar + '</button>' +
      '<div class="post-who">' +
        '<div class="post-name">' + esc(name) + '</div>' +
        '<div class="post-meta">' +
          (handle ? '<span class="post-handle">' + esc(handle) + '</span><span class="post-dot" aria-hidden="true">·</span>' : '') +
          '<span class="post-time">' + esc(timeAgo(p.created_at)) + '</span>' +
        '</div>' +
      '</div>' + kind +
    '</div>' +
    body + statStrip(p) + media + foot +
    '</article>';
}

function skeletonHtml(){
  let out = '';
  for (let i = 0; i < 3; i++){
    out += '<div class="post post-skeleton" aria-hidden="true">' +
      '<div class="post-head"><div class="avatar post-avatar sk"></div>' +
      '<div class="post-who"><div class="sk sk-name"></div><div class="sk sk-time"></div></div></div>' +
      '<div class="sk sk-line"></div><div class="sk sk-line short"></div></div>';
  }
  return out;
}

function emptyHtml(){
  if (scope === 'following' && noFollows){
    return '<div class="feed-empty">' +
      '<div class="feed-empty-ico">☺</div>' +
      '<div class="feed-empty-t">No one in your crew yet</div>' +
      '<div class="feed-empty-s">Follow a few lifters and their sessions will show up here.</div>' +
      '<button type="button" class="btn btn-sm" onclick="openPeople()">Find people</button>' +
      '</div>';
  }
  return '<div class="feed-empty">' +
    '<div class="feed-empty-ico">▤</div>' +
    '<div class="feed-empty-t">Nothing here yet</div>' +
    '<div class="feed-empty-s">Be the first to share what you lifted today.</div>' +
    '</div>';
}

function errorHtml(msg){
  return '<div class="feed-empty">' +
    '<div class="feed-empty-ico err">!</div>' +
    '<div class="feed-empty-t">Could not load the feed</div>' +
    '<div class="feed-empty-s">' + esc(msg || 'Check your connection and try again.') + '</div>' +
    '<button type="button" class="btn btn-sm btn-ghost" onclick="renderFeed()">Retry</button>' +
    '</div>';
}

function paint(){
  const list = el('feedList');
  if (!list) return;
  list.innerHTML = posts.length ? posts.map(postCardHtml).join('') : emptyHtml();
  const wrap = el('feedMoreWrap');
  if (wrap) wrap.classList.toggle('hidden', !hasMore);
  if (pendingScroll !== null){
    const y = pendingScroll;
    pendingScroll = null;
    requestAnimationFrame(() => window.scrollTo(0, y));
  }
}

/* ------------------------------ public ----------------------------- */
export async function renderFeed(opts){
  const more = !!(opts && opts.more);
  if (!SOCIAL_ENABLED || loading) return false;
  if (!gateOk()) return false;

  loading = true;
  const list = el('feedList');
  if (!more && list && !posts.length) list.innerHTML = skeletonHtml();
  try {
    const { rows, error } = await fetchPage(more ? posts.length : 0);
    if (error){
      if (!more){
        posts = [];
        hasMore = false;
        if (list) list.innerHTML = errorHtml(error);
        const wrap = el('feedMoreWrap');
        if (wrap) wrap.classList.add('hidden');
      } else toast(error);
      return false;
    }
    posts = more ? posts.concat(rows) : rows;
    hasMore = rows.length === PAGE_SIZE;
    try { await fetchCounts(); } catch(e){}
    paint();
    return true;
  } catch(e){
    if (!more && list){
      posts = [];
      hasMore = false;
      list.innerHTML = errorHtml((e && e.message) || '');
    }
    return false;
  } finally {
    loading = false;
  }
}

export function loadMorePosts(){
  if (loading) return false;
  renderFeed({ more: true });
  return true;
}

export async function submitPost(){
  const ta = el('postBody');
  const body = ((ta && ta.value) || '').replace(/\r\n/g, '\n').trim().slice(0, 2000);
  if (!body && !photo) return false;
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (sending) return false;
  if (!gateOk()){ toast('Sign in and go online to post.'); return false; }

  const c = sb();
  if (!c){ toast('Social is not configured yet.'); return false; }
  const user = window.socialUser || {};
  if (!user.id){ toast('Sign in to post.'); return false; }

  const btn = el('postSubmit');
  sending = true;
  showPostError('');
  if (btn){ btn.disabled = true; btn.textContent = 'Posting…'; }
  try {
    const kind = photo ? 'photo' : 'text';
    const paths = photo ? await uploadPhoto(c, photo) : { image_path: null, thumb_path: null };

    const { data, error } = await c.from('posts').insert({
      author_id: user.id,
      kind: kind,
      body: body,
      image_path: paths.image_path,
      thumb_path: paths.thumb_path
    }).select(POST_SELECT);
    if (error) throw new Error(error.message || 'Could not publish your post.');
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('Could not publish your post.');

    posts = [row].concat(posts.filter(p => p.id !== row.id));
    pendingScroll = null;
    clearComposer();
    paint();
    toast('Posted.');
    return true;
  } catch(e){
    showPostError((e && e.message) || 'Could not publish your post.');
    return false;
  } finally {
    sending = false;
    if (btn){ btn.textContent = 'Post'; updateComposer(); }
  }
}

export function saveFeedScroll(){
  try { sessionStorage.setItem(SCROLL_KEY, String(Math.max(0, Math.round(window.scrollY)))); } catch(e){}
}

export function resetFeed(){
  posts = [];
  hasMore = false;
  counts = {};
  noFollows = false;
  crewLoaded = false;
  photo = null;
  if (photoUrl){ URL.revokeObjectURL(photoUrl); photoUrl = null; }
  pendingScroll = null;
  const ta = el('postBody');
  if (ta) ta.value = '';
  const box = el('postPreview');
  if (box) box.classList.add('hidden');
  const list = el('feedList');
  if (list) list.innerHTML = '';
  const wrap = el('feedMoreWrap');
  if (wrap) wrap.classList.add('hidden');
  showPostError('');
  updateComposer();
}

export function initFeed(){
  const ta = el('postBody');
  if (ta && !ta.dataset.wired){
    ta.dataset.wired = '1';
    ta.addEventListener('input', updateComposer);
  }
  const input = el('postPhoto');
  if (input && !input.dataset.wired){
    input.dataset.wired = '1';
    input.addEventListener('change', onPhotoChosen);
  }
  const rm = el('postRemovePhoto');
  if (rm && !rm.dataset.wired){
    rm.dataset.wired = '1';
    rm.addEventListener('click', removePhoto);
  }
  const list = el('feedList');
  if (list && !list.dataset.wired){
    list.dataset.wired = '1';
    list.addEventListener('click', e => {
      const btn = e.target && e.target.closest && e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      const id = btn.getAttribute('data-post') || '';
      const p = posts.find(x => x.id === id);
      if (act === 'reply'){
        if (typeof window.openComments === 'function') window.openComments(id, p || null);
      } else if (act === 'like'){
        toggleLike(id);
      } else if (act === 'share'){
        sharePost(id);
      } else if (act === 'profile'){
        const uid = btn.getAttribute('data-uid');
        if (uid && typeof window.openProfile === 'function') window.openProfile(uid);
      }
    });
  }
  const crew = el('crewRow');
  if (crew && !crew.dataset.wired){
    crew.dataset.wired = '1';
    crew.addEventListener('click', e => {
      const cell = e.target && e.target.closest && e.target.closest('[data-crew]');
      if (!cell) return;
      const kind = cell.getAttribute('data-crew');
      if (kind === 'compose') focusComposer();
      else if (kind === 'people' && typeof window.openPeople === 'function') window.openPeople();
      else if (kind === 'profile'){
        const uid = cell.getAttribute('data-uid');
        if (uid && typeof window.openProfile === 'function') window.openProfile(uid);
      }
    });
  }
  renderComposer();
  updateComposer();
  renderCrew();
}

/* --------------------------- crew (stories) ------------------------ */
let crewLoaded = false;

export async function renderCrew(){
  const row = el('crewRow');
  if (!row) return;
  const c = sb();
  const me = (window.socialUser || {}).id;
  if (!c || !me){ row.classList.add('hidden'); return; }
  if (crewLoaded) return;
  row.classList.remove('hidden');
  row.innerHTML = '<div class="crew-cell skeleton"><span class="crew-ring"><span class="avatar crew-av sk"></span></span></div>'.repeat(4);
  try {
    const { data: f } = await c.from('follows').select('followee_id').eq('follower_id', me).limit(12);
    const ids = (f || []).map(r => r.followee_id);
    let people = [];
    if (ids.length){
      const { data: pr } = await c.from('profiles')
        .select('id,username,display_name,avatar_url').in('id', ids).limit(12);
      people = pr || [];
    }
    const meP = await myProfile(c, me);
    const you = meP
      ? { id: '', username: meP.username, display_name: meP.display_name || meP.username, avatar_url: meP.avatar_url, me: 1 }
      : { id: '', username: '', display_name: (window.socialUser && window.socialUser.email) || 'You', avatar_url: '', me: 1 };
    let html = crewCell(you) + people.map(x => crewCell(x)).join('');
    if (people.length < 6) html += crewFindCell();
    row.innerHTML = html;
    row.classList.toggle('hidden', !html);
    crewLoaded = true;
  } catch(e){
    row.innerHTML = '';
    row.classList.add('hidden');
    crewLoaded = true;
  }
}

function crewCell(u){
  const name = u.display_name || u.username || 'Athlete';
  const initial = String(name).trim().charAt(0).toUpperCase() || '?';
  const av = u.avatar_url
    ? '<img class="crew-av-img" src="' + esc(u.avatar_url) + '" alt="">'
    : esc(initial);
  const label = u.me ? 'You' : esc(String(name).slice(0, 10));
  const act = u.me ? 'data-crew="compose"' : 'data-crew="profile" data-uid="' + esc(u.id) + '"';
  return '<button type="button" class="crew-cell' + (u.me ? ' is-me' : '') + '" ' + act + '>' +
    '<span class="crew-ring' + (u.me ? ' me' : '') + '">' +
      '<span class="avatar crew-av' + (u.avatar_url ? '' : ' fallback') + '">' + av + '</span>' +
      (u.me ? '<span class="crew-plus" aria-hidden="true">+</span>' : '') +
    '</span>' +
    '<span class="crew-label">' + label + '</span>' +
    '</button>';
}

function crewFindCell(){
  return '<button type="button" class="crew-cell crew-find" data-crew="people">' +
    '<span class="crew-ring find"><span class="avatar crew-av fallback">⌕</span></span>' +
    '<span class="crew-label">Find</span>' +
    '</button>';
}

async function myProfile(c, me){
  const { data } = await c.from('profiles').select('id,username,display_name,avatar_url').eq('id', me).limit(1);
  const row = Array.isArray(data) ? data[0] : data;
  return row || null;
}

export function initCrew(){
  crewLoaded = false;
  renderCrew();
}

/* After a profile change (photo / name): refresh everything. */
export function refreshIdentity(){
  renderComposer();
  crewLoaded = false;
  renderCrew();
}

export function focusComposer(){
  if (typeof window.enterSView === 'function') window.enterSView('home');
  const ta = el('postBody');
  const card = el('composer');
  if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (ta){ try { ta.focus({ preventScroll: true }); } catch(e){ ta.focus(); } }
}

export function openFeed(){
  initFeed();
  try {
    const v = sessionStorage.getItem(SCROLL_KEY);
    pendingScroll = v === null ? 0 : (parseInt(v, 10) || 0);
  } catch(e){ pendingScroll = 0; }
  renderFeed();
}
