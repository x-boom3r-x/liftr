/* ==================================================================
   SOCIAL - Feed : composition, compression photo, liste des posts
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';
import { sb, withMissingColumn, missingColumnField, withMissingFields, acceptedFollows } from './client.js';
import { openImageEditor } from './editor.js';
import { filterPrivatePosts } from './privacy.js';
import { storyRingClass } from './rings.js';
import { sanitizeAttachment, shareEmbedHtml } from './attach.js';
import {
  withMusic, musicChipForBody, hydrateMusic,
  getComposerMusic, clearComposerMusic, openMusicPicker, setComposerMusic
} from './music.js';
import { setGlobalMuted, isGlobalMuted } from './autoplay.js';
import { icon, iconS } from '../icons.js';

const PAGE_SIZE = 20;
const SCROLL_KEY = 'at_feedScroll';
const THUMB_EDGE = 320;      /* côté max de la vignette (blur-up) */
const FULL_Q = 0.85;
const THUMB_Q = 0.8;
const MAX_BYTES = 12 * 1024 * 1024;
const POST_SELECT = 'id,author_id,kind,body,image_path,thumb_path,meta,attachment,comments_enabled,created_at,deleted_at,author:profiles!posts_author_id_fkey(id,username,display_name,avatar_url)';

let posts = [];
let hasMore = false;
let counts = {};          /* post_id -> { c, l, liked, v, rv, r, reposted, saved } */
let reposts = [];         /* reposts récents de mon crew + moi, fusionnés au fil */
let busy = {};            /* verrou par post/action : anti double-tap réseau */
let repostDraft = null;   /* { id, post } : « Repost with comment » en cours */
let shareDraft = null;    /* attachement (H) en attente dans le composeur */
let scope = 'all';        /* 'all' | 'following' | 'top' */
let noFollows = false;    /* filtre « Following » sans aucun abonnement */
let loading = false;
let sending = false;
let photo = null;            /* { full, thumb } : JPEG plein axe + vignette WebP */
let photoUrl = null;
let pendingScroll = null;

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function gateOk(){ return typeof window.socialAvailable === 'function' ? window.socialAvailable() : SOCIAL_ENABLED; }
function meId(){ return (window.socialUser || {}).id || null; }

function blankCounts(){ return { c: 0, l: 0, liked: false, v: 0, rv: 0, r: 0, reposted: false, saved: false }; }

/* Verrou par post/action : renvoie false si une même action est déjà en vol. */
function lock(id, act){
  const key = id + '|' + act;
  if (busy[key]) return false;
  busy[key] = true;
  return true;
}
function unlock(id, act){ delete busy[id + '|' + act]; }

/* Score « Top » : (upvotes − downvotes) pondéré par l'âge. */
function topScore(p){
  const k = counts[p.id] || blankCounts();
  const ageH = Math.max(0, (Date.now() - Date.parse(p.created_at || '')) / 3600000);
  return (k.v || 0) / Math.pow(ageH + 2, 1.5);
}

/* Cœur qui grossit puis disparaît (double-tap). */
function likeBurst(zone){
  try {
    const b = document.createElement('span');
    b.className = 'like-burst';
    b.setAttribute('aria-hidden', 'true');
    b.innerHTML = iconS('heart');
    zone.appendChild(b);
    setTimeout(() => { if (b.parentNode) b.parentNode.removeChild(b); }, 700);
  } catch(e){}
}

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
  if (btn) btn.disabled = sending || !(value.trim() || photo || shareDraft);
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
  /* la photo passe par l'éditeur (recadrage, rotation, filtres) avant
     d'entrer dans le composeur : rien ne part sans avoir été vu. */
  return openImageEditor(
    { file: file, mode: 'post', title: 'Edit photo' },
    edited => applyEditedPhoto(edited));
}

async function applyEditedPhoto(blob){
  try {
    const thumb = await compressImage(blob, THUMB_EDGE, THUMB_Q);
    setPhoto(blob, thumb);
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
  clearComposerMusic('post');
  shareDraft = null;
  paintShareBanner();
  showPostError('');
  updateComposer();
}

/* ------------------------------ requête ---------------------------- */
async function fetchPage(offset){
  const c = sb();
  if (!c) return { rows: [], error: 'Social is not configured yet.' };

  /* SELECT direct de la page (les colonnes v8 peuvent manquer : la
     selection est retentee sans elles par withMissingColumn). */
  const queryPage = async cols => {
    let q = c.from('posts').select(cols).is('deleted_at', null);
    if (scope === 'top'){
      /* fenêtre 7 jours, premier centaine : le classement se fait après
         agrégation des votes (fetchCounts). */
      q = q.gte('created_at', new Date(Date.now() - 7 * 864e5).toISOString());
      return await q.order('created_at', { ascending: false }).range(0, 99);
    }
    if (scope === 'following'){
      const me = (window.socialUser || {}).id;
      const fr = await withMissingColumn(
        cc => c.from('follows').select(cc).eq('follower_id', me),
        'followee_id,state');
      if (fr.error) return { data: null, error: fr.error };
      const ids = acceptedFollows(fr.data).map(r => r.followee_id);
      if (!ids.length){ noFollows = true; return { data: [], error: null }; }
      noFollows = false;
      q = q.in('author_id', ids);
    } else {
      noFollows = false;
    }
    return await q.order('created_at', { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
  };
  const { data, error } = await withMissingColumn(queryPage, POST_SELECT);
  if (error) return { rows: [], error: error.message || 'Could not load the feed.' };
  const raw = data || [];
  /* les comptes privés que l'on ne suit pas sont masqués côté client */
  const rows = await filterPrivatePosts(raw);
  if (scope === 'top') return { rows: rows, more: false, error: null };
  if (scope === 'following' && noFollows) return { rows: [], error: null };
  return { rows: rows, more: raw.length === PAGE_SIZE, error: null };
}

/* Compteurs de commentaires + likes : best-effort, jamais bloquant. */
async function fetchCounts(){
  counts = {};
  const c = sb();
  if (!c || !posts.length) return;
  const ids = posts.map(p => p.id);
  const me = (window.socialUser || {}).id || null;
  const jobs = {
    counts: c.from('feed_counts').select('post_id,comment_count,like_count').in('post_id', ids),
    votes: c.from('post_votes').select('post_id,value,user_id').in('post_id', ids),
    reps: c.from('post_reposts').select('post_id,user_id').in('post_id', ids)
  };
  if (me){
    jobs.likes = c.from('likes').select('post_id').in('post_id', ids).eq('user_id', me);
    jobs.saves = c.from('post_saves').select('post_id').in('post_id', ids).eq('user_id', me);
  }
  /* les nouvelles tables (migration v5) peuvent manquer : jamais bloquant. */
  const safe = async p => { try { return await p; } catch(e){ return { data: null, error: { message: String(e && e.message || e) } }; } };
  const [outCounts, outVotes, outReps, outLikes, outSaves] =
    await Promise.all([safe(jobs.counts), safe(jobs.votes), safe(jobs.reps), safe(jobs.likes || null), safe(jobs.saves || null)]);

  Object.keys(counts).forEach(id => delete counts[id]);
  const row = id => counts[id] || (counts[id] = blankCounts());
  const rows = outCounts.data;
  if (rows) rows.forEach(r => {
    const k = row(r.post_id);
    k.c = +r.comment_count || 0;
    k.l = +r.like_count || 0;
  });
  posts.forEach(p => row(p.id));   /* chaque post du fil a une entrée */
  const mine = outLikes && outLikes.data;
  if (mine) mine.forEach(r => { if (counts[r.post_id]) counts[r.post_id].liked = true; });
  const votes = outVotes.data;
  if (votes) votes.forEach(r => {
    const k = counts[r.post_id]; if (!k) return;
    const v = +r.value || 0;
    k.v += v;
    if (me && String(r.user_id || '') === String(me)) k.rv = v;
  });
  const reps = outReps.data;
  if (reps) reps.forEach(r => {
    const k = counts[r.post_id]; if (!k) return;
    k.r += 1;
    if (me && String(r.user_id || '') === String(me)) k.reposted = true;
  });
  const saves = outSaves.data;
  if (saves) saves.forEach(r => { if (counts[r.post_id]) counts[r.post_id].saved = true; });
}

export async function refreshCounts(){
  await fetchCounts();
  paint();
}

/* ------------------------------- likes ----------------------------- */
export async function toggleLike(id){
  const c = sb();
  const me = (window.socialUser || {}).id;
  const cur = counts[id] || (counts[id] = blankCounts());
  if (!c || !me || !id) return false;
  if (!lock(id, 'like')) return cur.liked;

  const prev = { c: cur.c, l: cur.l, liked: cur.liked };
  cur.l = Math.max(0, cur.l + (cur.liked ? -1 : 1));
  cur.liked = !cur.liked;
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
    cur.c = prev.c; cur.l = prev.l; cur.liked = prev.liked;
    paintOne(id);
    toast((e && e.message) || 'Could not update your like.');
    return prev.liked;
  } finally {
    unlock(id, 'like');
  }
}

/* ------------------------------- votes ----------------------------- */
/* ▲ / ▼ : signal de classement « Top ». Re-cliquer le même sens
   retire le vote ; l'autre sens le bascule. */
export async function vote(id, dir){
  const c = sb();
  const me = (window.socialUser || {}).id;
  const cur = counts[id] || (counts[id] = blankCounts());
  if (!c || !me || !id) return false;
  if (dir !== 1 && dir !== -1) return false;
  if (!lock(id, 'vote')) return false;

  const prev = { v: cur.v, rv: cur.rv };
  const nv = cur.rv === dir ? 0 : dir;            /* 0 = on retire son vote */
  cur.v = cur.v - (cur.rv || 0) + nv;
  cur.rv = nv;
  paintOne(id);

  try {
    let error = null;
    if (nv === 0){
      const r = await c.from('post_votes').delete().eq('post_id', id).eq('user_id', me);
      error = r && r.error;
    } else {
      const r = await c.from('post_votes')
        .upsert({ post_id: id, user_id: me, value: nv }, { onConflict: 'user_id,post_id' });
      error = r && r.error;
    }
    if (error) throw new Error(error.message);
    return true;
  } catch(e){
    cur.v = prev.v; cur.rv = prev.rv;
    paintOne(id);
    toast((e && e.message) || 'Could not register your vote.');
    return false;
  } finally {
    unlock(id, 'vote');
  }
}

/* ------------------------------- save ------------------------------ */
/* 🔖 : strictement privé, aucune notification. */
export async function toggleSave(id){
  const c = sb();
  const me = (window.socialUser || {}).id;
  const cur = counts[id] || (counts[id] = blankCounts());
  if (!c || !me || !id) return false;
  if (!lock(id, 'save')) return cur.saved;

  const prev = cur.saved;
  cur.saved = !prev;
  paintOne(id);

  try {
    let error = null;
    if (prev){
      const r = await c.from('post_saves').delete().eq('post_id', id).eq('user_id', me);
      error = r && r.error;
    } else {
      const r = await c.from('post_saves').insert({ post_id: id, user_id: me });
      error = r && r.error;
    }
    if (error) throw new Error(error.message);
    toast(cur.saved ? 'Saved — only you can see it.' : 'Removed from Saved.');
    return cur.saved;
  } catch(e){
    cur.saved = prev;
    paintOne(id);
    toast((e && e.message) || 'Could not update your saves.');
    return prev;
  } finally {
    unlock(id, 'save');
  }
}

/* ------------------------------ reposts ---------------------------- */
function postOf(id){
  return posts.find(x => x.id === id) ||
    ((reposts.find(r => r.post && r.post.id === id) || {}).post) || null;
}

/* Un post partagé en message peut être hors du fil local (L4). */
async function fetchPost(id){
  const c = sb();
  if (!c || !id) return null;
  const { data, error } = await withMissingColumn(
    cols => c.from('posts').select(cols).eq('id', id).eq('deleted_at', 'null').limit(1),
    POST_SELECT);
  if (error || !data || !data.length) return null;
  const row = data[0];
  return filterPrivatePosts([row]).length ? row : null;
}

/* Le destinataire d'un partage (L4) révèle le post : le fil devient la
   vue courante (le lien doit rester navigable), puis la carte s'ouvre
   au-dessus des commentaires. Rejoué à chaque envoi via #p=<id>. */
export async function openSharedPost(id){
  const key = String(id || '').trim();
  if (!key) return false;
  try {
    if (typeof window.showRoot === 'function') window.showRoot('feed');
    else if (typeof window.showTab === 'function') window.showTab('feed');
    if (typeof window.setSView === 'function') window.setSView('home');
    if (typeof window.openFeed === 'function') await window.openFeed();
  } catch(e){}
  const local = postOf(key) || (await fetchPost(key));
  if (!local){ toast('This post is no longer available.'); return false; }
  return typeof window.openComments === 'function' ? window.openComments(key, local) : false;
}

export async function repostPost(id, quote){
  const c = sb();
  const me = (window.socialUser || {}).id;
  const p = postOf(id);
  const cur = counts[id] || (counts[id] = blankCounts());
  if (!c || !me || !id || !p) return false;
  if (String(p.author_id || '') === String(me)){
    toast('You cannot repost your own post.');
    return false;
  }
  if (cur.reposted){
    toast('You already reposted this.');
    return false;
  }
  if (!lock(id, 'repost')) return false;

  const q = (quote || '').trim().slice(0, 400) || null;
  cur.r += 1;
  cur.reposted = true;
  paintOne(id);

  try {
    const { error } = await c.from('post_reposts')
      .insert({ post_id: id, user_id: me, quote: q });
    if (error) throw new Error(error.message || 'Could not repost.');
    toast(q ? 'Reposted with your comment.' : 'Reposted to your crew.');
    /* le fil local suit tout de suite */
    fetchReposts().then(() => { try { paint(); } catch(e){} }).catch(() => {});
    return true;
  } catch(e){
    cur.r = Math.max(0, cur.r - 1);
    cur.reposted = false;
    paintOne(id);
    toast((e && e.message) || 'Could not repost.');
    return false;
  } finally {
    unlock(id, 'repost');
  }
}

export function openRepostSheet(id){
  if (typeof window.openActionSheet !== 'function') return false;
  const p = postOf(id);
  if (!p) return false;
  const me = meId();
  if (String(p.author_id || '') === String(me || '')){
    toast('You cannot repost your own post.');
    return false;
  }
  const cur = counts[id] || blankCounts();
  if (cur.reposted){ toast('You already reposted this.'); return false; }
  window.openActionSheet('Repost', [
    { label: 'Repost', fn: () => { repostPost(id); } },
    { label: 'Repost with comment', fn: () => { startRepostQuote(id); } },
    { label: 'Cancel' }
  ]);
  return true;
}

/* « Repost with comment » : le composeur se met en mode quote. */
export function startRepostQuote(id){
  const p = postOf(id);
  if (!p) return false;
  const me = meId();
  if (String(p.author_id || '') === String(me || '')){
    toast('You cannot repost your own post.');
    return false;
  }
  const cur = counts[id] || blankCounts();
  if (cur.reposted){ toast('You already reposted this.'); return false; }
  repostDraft = { id: id, post: p };
  paintRepostBanner();
  if (typeof window.enterSView === 'function') window.enterSView('home');
  const ta = el('postBody');
  if (ta){ try { ta.focus({ preventScroll: true }); } catch(e){ ta.focus(); } }
  return true;
}

export function cancelRepostQuote(){
  repostDraft = null;
  paintRepostBanner();
  return true;
}

function paintRepostBanner(){
  const box = el('repostBanner');
  if (!box) return;
  if (!repostDraft){ box.classList.add('hidden'); box.innerHTML = ''; return; }
  const p = repostDraft.post || {};
  const a = p.author || {};
  const name = a.display_name || a.username || 'this post';
  const preview = String(p.body || (p.image_path ? 'Photo' : 'Post')).slice(0, 80);
  box.innerHTML = '<span class="repost-banner-ico" aria-hidden="true">⟲</span>' +
    '<span class="repost-banner-txt">Reposting <b>' + esc(name) + '</b> · ' + esc(preview) + '</span>' +
    '<button type="button" class="chip" onclick="cancelRepostQuote()" aria-label="Cancel repost">' + icon('x') + '</button>';
  box.classList.remove('hidden');
}

/* Bannière H : aperçu de la carte partagée (PR / séance / programme)
   dans le composeur, avec annulation. */
function paintShareBanner(){
  const box = el('shareBanner');
  if (!box) return;
  if (!shareDraft){ box.classList.add('hidden'); box.innerHTML = ''; return; }
  box.innerHTML = shareEmbedHtml(shareDraft) +
    '<button type="button" class="chip share-banner-x" onclick="cancelShareDraft()" aria-label="Cancel share">' + icon('x') + '</button>';
  box.classList.remove('hidden');
}

/* Ouvre le Feed (vue Home) avec le composeur pré-rempli d'un
   attachement — appelé depuis les écrans PR / séance / programme.
   showTab('feed') ramène la racine au fil (fix G) et setSView('home')
   rafraîchit le feed via openFeed(). */
export function openShareComposer(att){
  const a = sanitizeAttachment(att);
  if (!a){ toast('This cannot be shared.'); return false; }
  if (typeof window.showTab === 'function') window.showTab('feed');
  else if (typeof window.setSView === 'function') window.setSView('home');
  shareDraft = a;
  paintShareBanner();
  updateComposer();
  const ta = el('postBody');
  if (ta){ try { ta.focus({ preventScroll: true }); } catch(e){ try { ta.focus(); } catch(e){} } }
  return true;
}

export function cancelShareDraft(){
  shareDraft = null;
  paintShareBanner();
  updateComposer();
  return true;
}

/* ------------------------------ partage ---------------------------- */
export function sharePost(id){
  const p = postOf(id);
  const url = location.origin + location.pathname;
  const text = (p && p.body ? String(p.body).slice(0, 90) : 'Liftr');
  const copyLink = () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText){
        navigator.clipboard.writeText(url).then(() => toast('Link copied.'), () => toast('Link copied.'));
        return;
      }
    } catch(e){}
    toast('Link copied.');
  };
  try {
    if (navigator.share){
      navigator.share({ title: 'Liftr', text: text, url: url }).catch(() => {});
      return true;
    }
  } catch(e){}
  /* pas de navigator.share (desktop) : feuille d'actions */
  if (typeof window.openActionSheet === 'function'){
    window.openActionSheet('Share', [
      { label: 'Copy link', fn: copyLink },
      { label: 'Send in message', fn: () => {
          copyLink();
          if (typeof window.setSView === 'function') window.setSView('inbox');
          else if (typeof window.renderInbox === 'function') window.renderInbox();
        } },
      { label: 'Cancel' }
    ]);
    return true;
  }
  copyLink();
  return true;
}

/* ----------------------------- suppression -------------------------- */
export function openPostMenu(id, source){
  const p = source || postOf(id);
  if (!p) return false;
  if (typeof window.openActionSheet !== 'function') return false;
  const mine = String(p.author_id || '') === String(meId() || '');
  const k = counts[id] || blankCounts();
  const items = [{ label: 'Open post', fn: () => {
      if (typeof window.openComments === 'function') window.openComments(id, p);
    } }];
  if (!mine && !k.reposted){
    items.push({ label: 'Repost', fn: () => { repostPost(id); } });
    items.push({ label: 'Repost with comment', fn: () => { startRepostQuote(id); } });
  }
  items.push({ label: k.saved ? 'Remove from Saved' : 'Save', fn: () => { toggleSave(id); } });
  items.push({ label: 'Share', fn: () => { sharePost(id); } });
  if (mine){
    items.push({
      label: p.comments_enabled === false ? 'Turn on comments' : 'Turn off comments',
      fn: () => { toggleCommentsEnabled(id, p); }
    });
    items.push({ label: 'Delete post', style: 'destructive', fn: () => { deletePost(id, p); } });
  }
  window.openActionSheet(mine ? 'Your post' : 'Post', items);
  return true;
}

/* Le proprietaire ouvre/ferme les commentaires de son post (L5). */
export async function toggleCommentsEnabled(id, source){
  const c = sb();
  const p = source || postOf(id);
  if (!c || !p) return false;
  if (String(p.author_id || '') !== String(meId() || '')){
    toast('You can only moderate your own post.');
    return false;
  }
  const next = !(p.comments_enabled !== false);
  const { error } = await c.from('posts')
    .update({ comments_enabled: next })
    .eq('id', id);
  if (error){
    if (missingColumnField(error)){
      toast('Comments setting goes live once the update is applied.');
    } else {
      toast(error.message || 'Could not update comments setting.');
    }
    return false;
  }
  p.comments_enabled = next;
  paintOne(id);
  toast(next ? 'Comments are on.' : 'Comments are turned off.');
  if (typeof window.refreshCounts === 'function') window.refreshCounts();
  return true;
}

export async function deletePost(id, source){
  const c = sb();
  const idx = posts.findIndex(x => x.id === id);
  const p = idx >= 0 ? posts[idx] : (source || null);
  if (!p || !c) return false;
  if (String(p.author_id || '') !== String(meId() || '')){
    toast('You can only delete your own posts.');
    return false;
  }

  if (typeof window.askConfirm === 'function'){
    const r = await window.askConfirm(
      'Delete this post?',
      'The post, its photo, its comments and its likes disappear for everyone. This cannot be undone.',
      'Delete');
    if (!r || !r.ok) return false;
  }

  const had = idx >= 0;
  const keepCount = counts[id];
  if (had){
    posts.splice(idx, 1);
    delete counts[id];
    paint();
  }

  try {
    const { error } = await c.from('posts').delete().eq('id', id);
    if (error) throw new Error(error.message || 'Could not delete this post.');
    const paths = [p.image_path, p.thumb_path].filter(Boolean);
    if (paths.length) c.storage.from('posts').remove(paths).catch(() => {});
    toast('Post deleted.');
    const view = document.getElementById('view-profile');
    if (view && !view.classList.contains('hidden') &&
        typeof window.renderProfile === 'function') window.renderProfile();
    return true;
  } catch(e){
    if (had){
      posts.splice(Math.min(idx, posts.length), 0, p);
      if (keepCount) counts[id] = keepCount;
      paint();
    }
    toast((e && e.message) || 'Could not delete this post.');
    return false;
  }
}

function paintOne(id){
    const list = el('feedList');
    if (!list) return;
    const node = list.querySelector('[data-post="' + id + '"]');
    const p = posts.find(x => x.id === id) ||
      ((reposts.find(r => r.post && r.post.id === id) || {}).post) || null;
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
  scope = (next === 'following' || next === 'top') ? next : 'all';
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
  /* la photo pleine taille et la vignette peuvent être encodées
     différemment (JPEG plein axe / WebP 320 px) : extension par blob. */
  const extOf = b => (b && b.type === 'image/webp') ? 'webp' : 'jpg';
  const extFull = extOf(p.full), extThumb = extOf(p.thumb);

  const { error: e1 } = await c.storage.from('posts').upload(base + '.' + extFull, p.full,
    { contentType: p.full.type, cacheControl: '31536000', upsert: false });
  if (e1) throw new Error(e1.message || 'Photo upload failed.');
  const { error: e2 } = await c.storage.from('posts').upload(base + '-thumb.' + extThumb, p.thumb,
    { contentType: p.thumb.type, cacheControl: '31536000', upsert: false });
  if (e2) throw new Error(e2.message || 'Photo upload failed.');
  return { image_path: base + '.' + extFull, thumb_path: base + '-thumb.' + extThumb };
}
/* ------------------------------- rendu ----------------------------- */
export function mediaUrl(path, c, bucket){
  if (!path) return null;
  if (/^https?:/i.test(path)) return path;
  try {
    const r = c && c.storage.from(bucket || 'posts').getPublicUrl(path);
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
  const parts = musicChipForBody(p.body || '');
  const body = parts.text ? '<div class="post-body">' + esc(parts.text) + '</div>' : '';
  const music = parts.html ? '<div class="post-music">' + parts.html + '</div>' : '';
  /* carte partagée (H) : rendue uniquement si l'attachement passe la
     validation de réception, sinon le post s'affiche sans carte */
  const embed = p.attachment ? shareEmbedHtml(p.attachment) : '';
  const kind = (p.kind && p.kind !== 'text' && p.kind !== 'photo')
    ? '<span class="chip chip-type post-kind">' + esc(p.kind.toUpperCase()) + '</span>' : '';
  const k = counts[p.id] || blankCounts();
  const more =
    '<button type="button" class="post-more" data-act="menu" data-post="' + esc(p.id || '') + '" ' +
    'aria-label="Post options" title="Post options"><span aria-hidden="true">⋯</span></button>';
  /* M3 : mute global dans chaque post (icône en tête, pattern IG) */
  const muteIco = isGlobalMuted() ? 'mute' : 'volume';
  const mute =
    '<button type="button" class="post-mute" data-act="mute" ' +
    'aria-label="' + (isGlobalMuted() ? 'Unmute music' : 'Mute music') + '" ' +
    'aria-pressed="' + (isGlobalMuted() ? 'true' : 'false') + '" title="Mute music">' +
    iconS(muteIco) + '</button>';

  /* Rangée G1 : votes / like / coms / repost / save / share — icônes seules,
     tenue sans débordement de 320 à 430 px (voir css .post-foot). */
  const foot = '<div class="post-foot">' +
    '<span class="post-vote">' +
      '<button type="button" class="post-act post-act-up' + (k.rv === 1 ? ' on' : '') + '" ' +
        'data-act="up" data-post="' + esc(p.id || '') + '" ' +
        'aria-label="Upvote" aria-pressed="' + (k.rv === 1 ? 'true' : 'false') + '" title="Upvote">' +
        '<span class="post-act-ico" aria-hidden="true">' + iconS('up') + '</span></button>' +
      '<span class="post-act-n post-vote-n" data-n="votes">' + (k.v || 0) + '</span>' +
      '<button type="button" class="post-act post-act-down' + (k.rv === -1 ? ' on' : '') + '" ' +
        'data-act="down" data-post="' + esc(p.id || '') + '" ' +
        'aria-label="Downvote" aria-pressed="' + (k.rv === -1 ? 'true' : 'false') + '" title="Downvote">' +
        '<span class="post-act-ico" aria-hidden="true">' + iconS('down') + '</span></button>' +
    '</span>' +
    '<button type="button" class="post-act post-act-like' + (k.liked ? ' on' : '') + '" ' +
      'data-act="like" data-post="' + esc(p.id || '') + '" ' +
      'aria-label="Like" aria-pressed="' + (k.liked ? 'true' : 'false') + '" title="Like">' +
      '<span class="post-act-ico" aria-hidden="true">' + icon('heart') + '</span>' +
      '<span class="post-act-n" data-n="likes">' + k.l + '</span>' +
    '</button>' +
    '<button type="button" class="post-act" data-act="reply" data-post="' + esc(p.id || '') + '" ' +
      'aria-label="Comments">' +
      '<span class="post-act-ico" aria-hidden="true">' + icon('chat') + '</span>' +
      '<span class="post-act-n" data-n="comments">' + k.c + '</span>' +
    '</button>' +
    '<button type="button" class="post-act post-act-repost' + (k.reposted ? ' on' : '') + '" ' +
      'data-act="repost" data-post="' + esc(p.id || '') + '" ' +
      'aria-label="Repost" aria-pressed="' + (k.reposted ? 'true' : 'false') + '" title="Repost">' +
      '<span class="post-act-ico" aria-hidden="true">' + icon('repost') + '</span>' +
      '<span class="post-act-n" data-n="reposts">' + k.r + '</span>' +
    '</button>' +
    /* ⋯ (menu) reste dans l''en-tête de la carte : une seule occurrence */
    '<button type="button" class="post-act post-act-save' + (k.saved ? ' on' : '') + '" ' +
      'data-act="save" data-post="' + esc(p.id || '') + '" ' +
      'aria-label="Save" aria-pressed="' + (k.saved ? 'true' : 'false') + '" title="Save">' +
      '<span class="post-act-ico" aria-hidden="true">' + icon('bookmark') + '</span></button>' +
    '<button type="button" class="post-act post-act-share" data-act="share" ' +
      'data-post="' + esc(p.id || '') + '" aria-label="Share" title="Share">' +
      '<span class="post-act-ico" aria-hidden="true">' + icon('share') + '</span></button>' +
    '</div>';

  return '<article class="post" data-post="' + esc(p.id || '') + '">' +
    '<div class="post-head">' +
      '<button type="button" class="avatar post-avatar ring' + storyRingClass(uid) + (a.avatar_url ? '' : ' fallback') + '" ' +
        'data-act="profile" data-uid="' + esc(uid) + '" aria-label="Open profile">' + avatar + '</button>' +
      '<div class="post-who">' +
        '<div class="post-name">' + esc(name) + '</div>' +
        '<div class="post-meta">' +
          (handle ? '<span class="post-handle">' + esc(handle) + '</span><span class="post-dot" aria-hidden="true">·</span>' : '') +
          '<span class="post-time">' + esc(timeAgo(p.created_at)) + '</span>' +
        '</div>' +
      '</div>' + kind + mute + more +
    '</div>' +
    body + music + embed + statStrip(p) + media + foot +
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
  if (scope === 'top'){
    return '<div class="feed-empty">' +
      '<div class="feed-empty-ico">' + iconS('up') + '</div>' +
      '<div class="feed-empty-t">No top posts this week</div>' +
      '<div class="feed-empty-s">Upvote posts to shape the ranking — the Top tab refreshes every 7 days.</div>' +
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

/* ------------------------------ reposts ----------------------------
   Reposts récents de mon crew (abonnements) + moi, fusionnés au fil.
   Best-effort : si la migration v5 n'est pas appliquée, le fil reste
   identique (aucun repost affiché). */
async function fetchReposts(){
  reposts = [];
  const c = sb();
  const me = meId();
  if (!c || !me || scope === 'top') return;
  let ids = [me];
  try {
    const fr = await withMissingColumn(
      cc => c.from('follows').select(cc).eq('follower_id', me),
      'followee_id,state');
    if (fr.data) ids = ids.concat(acceptedFollows(fr.data).map(r => r.followee_id));
  } catch(e){}
  let rows = [];
  try {
    const { data } = await c.from('post_reposts')
      .select('post_id,user_id,quote,created_at,by:profiles!post_reposts_user_id_fkey(id,username,display_name,avatar_url)')
      .in('user_id', ids)
      .order('created_at', { ascending: false })
      .range(0, 59);
    rows = data || [];
  } catch(e){ return; }
  if (!rows.length) return;
  const pids = [];
  rows.forEach(r => { if (pids.indexOf(r.post_id) < 0) pids.push(r.post_id); });
  let orig = [];
  try {
    const pr = await withMissingColumn(
      cols => c.from('posts').select(cols).in('id', pids).is('deleted_at', null),
      POST_SELECT);
    orig = pr.data || [];
  } catch(e){ return; }
  const priv = await filterPrivatePosts(orig);
  const byId = {};
  priv.forEach(p => { byId[p.id] = p; });
  reposts = rows.filter(r => byId[r.post_id]).map(r => ({
    id: 'rp-' + (r.user_id || '') + '-' + r.post_id,
    post_id: r.post_id,
    quote: r.quote || '',
    created_at: r.created_at,
    by: r.by || {},
    post: byId[r.post_id]
  }));
}

function repostCardHtml(r){
  const by = r.by || {};
  const name = by.display_name || by.username || 'Someone';
  const head = '<div class="post-repost-by">' +
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/>' +
    '<path d="m7 22-4-4-4 4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>' +
    '<span>' + esc(name) + ' reposted</span></div>';
  const quote = r.quote
    ? '<div class="post-repost-quote">' + esc(r.quote) + '</div>' : '';
  return '<div class="post-repost" data-repost="' + esc(r.id) + '">' + head + quote +
    postCardHtml(r.post) + '</div>';
}

function paint(){
  const list = el('feedList');
  if (!list) return;
  if (!posts.length && !reposts.length){
    list.innerHTML = emptyHtml();
  } else {
    let entries = posts.map(p => ({ t: Date.parse(p.created_at || '') || 0, html: postCardHtml(p) }));
    if (scope !== 'top'){
      reposts.forEach(r => {
        entries.push({ t: Date.parse(r.created_at || '') || 0, html: repostCardHtml(r) });
      });
      /* Recent/All : plus récent d'abord ; Top garde l'ordre du score (renderFeed) */
      entries.sort((a, b) => b.t - a.t);
    }
    list.innerHTML = entries.map(e => e.html).join('');
  }
  hydrateMusic(list);
  const wrap = el('feedMoreWrap');
  if (wrap) wrap.classList.toggle('hidden', !hasMore || scope === 'top');
  if (pendingScroll !== null){
    const y = pendingScroll;
    pendingScroll = null;
    requestAnimationFrame(() => {
      const sc = document.querySelector('.app');
      if (sc) sc.scrollTop = y;
    });
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
    const page = await fetchPage(more ? posts.length : 0);
    const rows = page.rows;
    const error = page.error;
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
    hasMore = page.more === true;
    try { await fetchCounts(); } catch(e){}
    if (scope === 'top'){
      posts.sort((a, b) => topScore(b) - topScore(a));
    } else if (!more){
      try { await fetchReposts(); } catch(e){}
    }
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
  let body = ((ta && ta.value) || '').replace(/\r\n/g, '\n').trim().slice(0, 2000);
  /* mode « Repost with comment » : le texte devient la quote du repost,
     aucun post n'est créé. */
  if (repostDraft){
    if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
    if (sending) return false;
    if (!gateOk()){ toast('Sign in and go online to post.'); return false; }
    const id = repostDraft.id;
    const quote = body;
    repostDraft = null;
    paintRepostBanner();
    if (ta) ta.value = '';
    updateComposer();
    return repostPost(id, quote);
  }
  const track = getComposerMusic('post');
  if (track && track.id) body = withMusic(body.slice(0, 1990), track.id, track);
  /* attachement H : revalidé à l'envoi (le draft peut avoir vieilli) */
  const att = shareDraft ? sanitizeAttachment(shareDraft) : null;
  if (!body && !photo && !att) return false;
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
    const kind = att ? att.type : (photo ? 'photo' : 'text');
    const paths = photo ? await uploadPhoto(c, photo) : { image_path: null, thumb_path: null };

    const payload = {
      author_id: user.id,
      kind: kind,
      body: body,
      image_path: paths.image_path,
      thumb_path: paths.thumb_path,
      attachment: att
    };
    /* Colonnes v5/v8 absentes : retirees automatiquement du payload et
       du RETURNING (withMissingFields), publication best-effort. */
    const res = await withMissingFields(
      (p, cols) => c.from('posts').insert(p).select(cols),
      payload, POST_SELECT,
      (bad, p) => { if (bad === 'attachment') p.kind = photo ? 'photo' : 'text'; });
    const error = res.error, data = res.data;
    const dropped = res.dropped || [];
    if (!error && att && dropped.indexOf('attachment') >= 0){
      toast('Posted — the shared card will appear once the update is live.');
    }
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
  try {
    const sc = document.querySelector('.app');
    sessionStorage.setItem(SCROLL_KEY, String(Math.max(0, Math.round(sc ? sc.scrollTop : 0))));
  } catch(e){}
}

export function resetFeed(){
  posts = [];
  hasMore = false;
  counts = {};
  reposts = [];
  repostDraft = null;
  busy = {};
  noFollows = false;
  if (typeof window.resetStories === 'function') window.resetStories();
  photo = null;
  clearComposerMusic('post');
  if (photoUrl){ URL.revokeObjectURL(photoUrl); photoUrl = null; }
  pendingScroll = null;
  const ta = el('postBody');
  if (ta) ta.value = '';
  const box = el('postPreview');
  if (box) box.classList.add('hidden');
  paintRepostBanner();
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
      const p = postOf(id);
      if (act === 'reply'){
        if (typeof window.openComments === 'function') window.openComments(id, p || null);
      } else if (act === 'like'){
        toggleLike(id);
      } else if (act === 'up'){
        vote(id, 1);
      } else if (act === 'down'){
        vote(id, -1);
      } else if (act === 'repost'){
        openRepostSheet(id);
      } else if (act === 'save'){
        toggleSave(id);
      } else if (act === 'share'){
        sharePost(id);
      } else if (act === 'menu'){
        openPostMenu(id);
      } else if (act === 'mute'){
        setGlobalMuted(!isGlobalMuted());
      } else if (act === 'profile'){
        const uid = btn.getAttribute('data-uid');
        if (uid && typeof window.openProfile === 'function') window.openProfile(uid);
      }
    });
    /* Double-tap (TikTok) sur le média / le texte : like + burst.
       Jamais d'unlike au double-tap ; cooldown par zone anti-doublon
       entre la détection tactile et l'événement dblclick simulate. */
    const lastTap = { t: 0, el: null };
    let burstAt = 0;
    const onDoubleTap = zone => {
      const card = zone.closest('.post');
      if (!card) return;
      const id = card.getAttribute('data-post');
      const now = Date.now();
      if (now - burstAt < 400) return;
      burstAt = now;
      /* paintOne remplace la carte : le burst attend la fin du like
         puis se pose sur la carte fraîche (sinon il est détruit au repaint) */
      const burstFresh = () => {
        const list = el('feedList');
        const fresh = (list && list.querySelector('[data-post="' + id + '"]')) || card;
        const z = fresh.querySelector('.post-media, .post-body') || fresh;
        likeBurst(z);
      };
      const cur = counts[id];
      if (!cur || !cur.liked){
        try {
          const r = toggleLike(id);
          if (r && typeof r.then === 'function') r.then(burstFresh, burstFresh);
          else burstFresh();
        } catch(e){ burstFresh(); }
      } else {
        likeBurst(zone);   /* déjà liké : aucun repaint, la zone est stable */
      }
    };
    list.addEventListener('dblclick', e => {
      const zone = e.target && e.target.closest && e.target.closest('.post-media, .post-body');
      if (zone) onDoubleTap(zone);
    });
    list.addEventListener('touchend', e => {
      const zone = e.target && e.target.closest && e.target.closest('.post-media, .post-body');
      if (!zone) return;
      const now = Date.now();
      if (now - lastTap.t < 350 && lastTap.el === zone){
        lastTap.t = 0; lastTap.el = null;
        onDoubleTap(zone);
      } else {
        lastTap.t = now; lastTap.el = zone;
      }
    }, { passive: true });
  }
  if (typeof window.initStories === 'function') window.initStories();
  renderComposer();
  updateComposer();
  renderCrew();
}

/* --------------------------- crew (stories) ------------------------
   La rangée est pilotee par ./stories.js (anneaux 24 h, visionneuse). */
export function renderCrew(){
  if (typeof window.renderStories === 'function') return window.renderStories();
  return false;
}

export function initCrew(){
  if (typeof window.resetStories === 'function') window.resetStories();
  if (typeof window.initStories === 'function') window.initStories();
  return renderCrew();
}

/* After a profile change (photo / name): refresh everything. */
export function refreshIdentity(){
  renderComposer();
  return initCrew();
}

export function focusComposer(){
  if (typeof window.enterSView === 'function') window.enterSView('home');
  const ta = el('postBody');
  const card = el('composer');
  if (card) card.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (ta){ try { ta.focus({ preventScroll: true }); } catch(e){ ta.focus(); } }
}

/* Le bouton « + » ouvre un choix de type de publication. */
export function openPostTypeSheet(){
  if (typeof window.openActionSheet !== 'function') return false;
  window.openActionSheet('New post', [
    { label: 'Text', fn: () => focusComposer() },
    { label: 'Photo', fn: () => { focusComposer(); setTimeout(pickPhoto, 80); } },
    { label: 'Music', fn: () => { focusComposer(); setTimeout(pickPostMusic, 80); } },
    { label: 'Story', fn: () => {
        if (typeof window.openStoryComposer === 'function') window.openStoryComposer();
      } },
    { label: 'Note', fn: () => {
        if (typeof window.openNoteComposer === 'function') window.openNoteComposer();
      } }
  ]);
  return true;
}

export function pickPostMusic(){
  return openMusicPicker(t => setComposerMusic('post', t));
}

export function openFeed(){
  initFeed();
  try {
    const v = sessionStorage.getItem(SCROLL_KEY);
    pendingScroll = v === null ? 0 : (parseInt(v, 10) || 0);
  } catch(e){ pendingScroll = 0; }
  renderFeed();
}
