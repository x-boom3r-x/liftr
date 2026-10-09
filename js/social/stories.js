/* ==================================================================
   SOCIAL - stories (24 h) : rangée du fil, visualiseur, création
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';
import { sb } from './client.js';
import { compressImage, mediaUrl } from './feed.js';
import { openImageEditor } from './editor.js';
import {
  withMusic, splitMusic, musicChipHtml, hydrateMusic,
  getComposerMusic, clearComposerMusic, openMusicPicker, setComposerMusic
} from './music.js';
import {
  setStoryRings, markStorySeen, clearStoryRings, applyStoryRings,
  ringsFresh, ringAuthorsKey, RING_TTL
} from './rings.js';

const STORY_EDGE = 1080;
const STORY_Q = 0.85;
const MAX_BYTES = 12 * 1024 * 1024;
const SLIDE_MS = 5000;
const FOREVER_MS = 100 * 365 * 24 * 3600 * 1000;   /* « forever » = RLS > now() */
const STORY_SELECT = 'id,author_id,body,image_path,created_at,expires_at,' +
  'author:profiles!stories_author_id_fkey(id,username,display_name,avatar_url)';

let crewLoaded = false;
let queue = [];        /* auteurs avec story, dans l'ordre de la rangée */
let slides = [];       /* stories de l'auteur courant */
let idx = 0;
let timer = null;
let photo = null;
let photoUrl = null;
let durDays = 1;       /* durée choisie dans le composeur (1 = 24 h) */

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function gateOk(){ return typeof window.socialAvailable === 'function' ? window.socialAvailable() : SOCIAL_ENABLED; }
function meId(){ return (window.socialUser || {}).id || null; }

/* --------------------------- rangée du fil -------------------------- */
function cell(u, story){
  const name = u.display_name || u.username || 'Athlete';
  const initial = String(name).trim().charAt(0).toUpperCase() || '?';
  const av = u.avatar_url
    ? '<img class="crew-av-img" src="' + esc(u.avatar_url) + '" alt="">'
    : esc(initial);
  const label = u.me ? 'You' : esc(String(name).slice(0, 10));
  const state = story ? (' ' + (story.seen ? 'seen' : 'live')) : '';
  const act = u.me
    ? (story ? 'data-crew="story" data-uid="' + esc(u.id) + '"' : 'data-crew="compose"')
    : (story ? 'data-crew="story" data-uid="' + esc(u.id) + '"'
             : 'data-crew="profile" data-uid="' + esc(u.id) + '"');
  return '<button type="button" class="crew-cell' + (u.me ? ' is-me' : '') + state + '" ' + act + '>' +
    '<span class="crew-ring' + (u.me && !story ? ' me' : '') + (story ? '' : ' none') + '">' +
      '<span class="avatar crew-av' + (u.avatar_url ? '' : ' fallback') + '">' + av + '</span>' +
      (u.me && !story ? '<span class="crew-plus" aria-hidden="true">+</span>' : '') +
    '</span>' +
    '<span class="crew-label">' + label + '</span>' +
    '</button>';
}

function findCell(){
  return '<button type="button" class="crew-cell crew-find" data-crew="people">' +
    '<span class="crew-ring find none"><span class="avatar crew-av fallback">⌕</span></span>' +
    '<span class="crew-label">Find</span>' +
    '</button>';
}

async function storyState(c, ids){
  const out = {};
  if (!c || !ids.length) return out;
  const [{ data: rows }, { data: seen }] = await Promise.all([
    c.from('stories').select('id,author_id').in('author_id', ids).gt('expires_at', new Date().toISOString()),
    c.from('story_views').select('story_id').eq('viewer_id', meId())
  ]);
  const seenSet = new Set((seen || []).map(r => r.story_id));
  (rows || []).forEach(r => {
    if (!out[r.author_id]) out[r.author_id] = { count: 0, seen: true };
    out[r.author_id].count++;
    if (!seenSet.has(r.id)) out[r.author_id].seen = false;
  });
  return out;
}

export async function renderStories(){
  const row = el('crewRow');
  if (!row) return false;
  const c = sb();
  const me = meId();
  if (!c || !me || !gateOk()){ row.classList.add('hidden'); return false; }
  if (crewLoaded) return true;

  row.classList.remove('hidden');
  row.innerHTML = '<div class="crew-cell skeleton">' +
    '<span class="crew-ring none"><span class="avatar crew-av sk"></span></span>' +
    '<span class="crew-label">&nbsp;</span></div>'.repeat(4);
  try {
    const { data: f } = await c.from('follows').select('followee_id').eq('follower_id', me).limit(12);
    const ids = (f || []).map(r => r.followee_id);
    const all = [me].concat(ids);

    const [profs, st] = await Promise.all([
      ids.length
        ? c.from('profiles').select('id,username,display_name,avatar_url').in('id', all)
        : c.from('profiles').select('id,username,display_name,avatar_url').eq('id', me),
      storyState(c, all)
    ]);
    const rows = (profs.data || []);
    const people = rows.filter(p => p.id !== me);
    const mine = rows.find(p => p.id === me) || null;

    queue = rows.map(p => ({ id: p.id, name: p.display_name || p.username || 'Athlete' }))
      .filter(x => st[x.id]);
    /* alimente le Set partagé : les avatars de post / profil / commentaires
       portent alors has-story (et seen) sans requête supplémentaire */
    setStoryRings(st);
    applyStoryRings();

    const you = mine
      ? { id: me, username: mine.username, display_name: mine.display_name || mine.username,
          avatar_url: mine.avatar_url, me: 1 }
      : { id: me, username: '', display_name: 'You', avatar_url: '', me: 1 };

    let html = cell(you, st[me]) + people.map(x => cell(x, st[x.id])).join('');
    if (people.length < 6) html += findCell();
    row.innerHTML = html;
    row.classList.toggle('hidden', !html);
    crewLoaded = true;
    return true;
  } catch(e){
    row.innerHTML = '';
    row.classList.add('hidden');
    crewLoaded = true;
    return false;
  }
}

/* ---------------- anneaux partagés : rafraîchissement ----------------
   Le Set unique vit dans ./rings.js ; ici on l'alimente en dehors du
   rendu de la rangée : timer 60 s (expiration), retour en avant-plan,
   et (via renderStories) après publication / suppression d'une story. */
export async function refreshStoryRings(force){
  const c = sb();
  const me = meId();
  if (!c || !me || !gateOk()) return false;
  if (!force && ringsFresh()) return true;
  const before = ringAuthorsKey();
  try {
    const { data: f } = await c.from('follows').select('followee_id')
      .eq('follower_id', me).limit(200);
    const ids = [me].concat((f || []).map(r => r.followee_id));
    const st = await storyState(c, ids);
    setStoryRings(st);
    applyStoryRings();
    if (ringAuthorsKey() !== before){
      /* le jeu d'auteurs a bougé : une story est apparue ou a expiré */
      crewLoaded = false;
      if (typeof window.renderStories === 'function') window.renderStories();
    }
    return true;
  } catch(e){ return false; }
}

let ringsWired = false;
function wireRingRefresh(){
  if (ringsWired) return;
  ringsWired = true;
  /* une story qui arrive à terme doit disparaître des anneaux et de la
     rangée sans aucune interaction de l'utilisateur */
  setInterval(() => { refreshStoryRings(true); }, RING_TTL);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshStoryRings(true);
  });
}

export function initStories(){
  const row = el('crewRow');
  if (row && !row.dataset.wired){
    row.dataset.wired = '1';
    row.addEventListener('click', e => {
      const b = e.target && e.target.closest && e.target.closest('[data-crew]');
      if (!b) return;
      const kind = b.getAttribute('data-crew');
      if (kind === 'compose') openStoryComposer();
      else if (kind === 'story') openStoryViewer(b.getAttribute('data-uid'));
      else if (kind === 'people' && typeof window.openPeople === 'function') window.openPeople();
      else if (kind === 'profile'){
        const uid = b.getAttribute('data-uid');
        if (uid && typeof window.openProfile === 'function') window.openProfile(uid);
      }
    });
  }
  const input = el('storyPhoto');
  if (input && !input.dataset.wired){
    input.dataset.wired = '1';
    input.addEventListener('change', onStoryPhoto);
  }
  wireDuration();
  wireRingRefresh();
}

/* Durée de la story : 24 h par défaut, 3 j, 7 j, ou « forever ». */
function setStoryDuration(days){
  durDays = Math.max(0, parseInt(days, 10) || 0);
  const box = el('storyDur');
  if (box){
    box.querySelectorAll('.seg').forEach(b =>
      b.classList.toggle('active', parseInt(b.getAttribute('data-dur'), 10) === durDays));
  }
  return durDays;
}

function wireDuration(){
  const box = el('storyDur');
  if (!box || box.dataset.wired) return;
  box.dataset.wired = '1';
  box.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('[data-dur]');
    if (b) setStoryDuration(b.getAttribute('data-dur'));
  });
}

export function pickStoryMusic(){
  return openMusicPicker(t => setComposerMusic('story', t));
}

/* --------------------------- visualiseur ---------------------------- */
function stopTimer(){
  if (timer){ clearTimeout(timer); timer = null; }
}

function paintProgress(){
  const bar = el('svProgress');
  if (!bar) return;
  const n = slides.length || 1;
  bar.innerHTML = '';
  for (let i = 0; i < n; i++){
    const seg = document.createElement('i');
    seg.className = 'sv-seg' + (i < idx ? ' done' : (i === idx ? ' on' : ''));
    seg.innerHTML = '<span></span>';
    bar.appendChild(seg);
  }
  const seg = bar.children[idx];
  const fill = seg && seg.firstElementChild;
  if (!fill) return;
  if (fill.animate){
    try {
      fill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
        { duration: SLIDE_MS, easing: 'linear', fill: 'forwards' });
      return;
    } catch(e){}
  }
  fill.style.transform = 'scaleX(1)';
}

function paintSlide(){
  const s = slides[idx];
  const stage = el('svStage');
  if (!stage || !s) return;
  const url = s.image_path ? mediaUrl(s.image_path, sb()) : null;
  const parts = splitMusic(s.body || '');
  stage.classList.toggle('plain', !url);
  stage.innerHTML =
    (url ? '<img class="sv-img" src="' + esc(url) + '" alt="">' : '') +
    '<div class="sv-caption' + (url ? ' over' : '') + '">' + esc(parts.text || '') + '</div>' +
    (parts.trackId ? '<div class="sv-music">' + musicChipHtml(parts.trackId) + '</div>' : '');
  hydrateMusic(stage);
  initStoryViewer();

  const t = el('svTime');
  if (t) t.textContent = typeof window.timeAgo === 'function' ? window.timeAgo(s.created_at) : '';
  const del = el('svDelete');
  if (del) del.classList.toggle('hidden', String(s.author_id) !== String(meId() || ''));

  paintProgress();
  markSeen(s);
  stopTimer();
  timer = setTimeout(nextSlide, SLIDE_MS);
}

function nextSlide(){
  stopTimer();
  if (idx + 1 < slides.length){ idx++; paintSlide(); return; }
  const cur = slides[0] && slides[0].author_id;
  const at = queue.findIndex(q => q.id === cur);
  const nxt = at >= 0 ? queue[at + 1] : null;
  if (nxt){ openStoryViewer(nxt.id, at + 1); return; }
  closeStoryViewer();
}

function prevSlide(){
  stopTimer();
  if (idx > 0){ idx--; paintSlide(); return; }
  closeStoryViewer();
}

async function markSeen(s){
  const c = sb();
  const me = meId();
  if (!c || !me || s.__seen) return;
  s.__seen = true;
  try {
    await c.from('story_views').upsert({ story_id: s.id, viewer_id: me },
      { onConflict: 'story_id,viewer_id' });
    /* vue immédiatement : l'anneau de l'auteur passe en « seen » partout */
    if (markStorySeen(s.author_id)) applyStoryRings();
  } catch(e){}
}

/* openStoryViewer(uid, queuePos) : queuePos = position dans la rangée
   (pour enchaîner automatiquement sur la personne suivante). */
export async function openStoryViewer(uid, queuePos){
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to see stories.'); return false; }
  const c = sb();
  const me = meId();
  if (!c || !me) return false;
  if (!uid) uid = me;
  if (typeof queuePos !== 'number'){
    const at = queue.findIndex(q => q.id === uid);
    queuePos = at >= 0 ? at : -1;
  }
  if (queuePos < 0 && !queue.length) queue = [{ id: uid }];

  const box = el('storyView');
  if (box) box.classList.add('show');
  const stage = el('svStage');
  if (stage) stage.innerHTML = '<div class="sv-loading">Loading…</div>';
  stopTimer();

  try {
    const { data, error } = await c.from('stories')
      .select(STORY_SELECT)
      .eq('author_id', uid)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message || 'Could not load this story.');

    slides = data || [];
    idx = 0;

    /* l'auteur suivant n'a plus de story : on enchaîne tout seul */
    if (!slides.length && queuePos >= 0 && queuePos + 1 < queue.length){
      stopTimer();
      openStoryViewer(queue[queuePos + 1].id, queuePos + 1);
      return true;
    }

    const a = slides[0] && slides[0].author;
    const name = (a && (a.display_name || a.username)) || (uid === me ? 'Your story' : 'Story');
    const nm = el('svName'); if (nm) nm.textContent = name;
    const av = el('svAvatar');
    if (av){
      av.innerHTML = (a && a.avatar_url)
        ? '<img class="av-img" src="' + esc(a.avatar_url) + '" alt="">'
        : esc(String(name).trim().charAt(0).toUpperCase() || '?');
    }

    if (!slides.length){
      if (stage) stage.innerHTML = '<div class="sv-empty">No active story.</div>';
      const bar = el('svProgress'); if (bar) bar.innerHTML = '';
      const del = el('svDelete'); if (del) del.classList.add('hidden');
      return true;
    }
    paintSlide();
    return true;
  } catch(e){
    if (stage) stage.innerHTML = '<div class="sv-empty">' + esc((e && e.message) || 'Could not load.') + '</div>';
    return false;
  }
}

export function closeStoryViewer(){
  stopTimer();
  const box = el('storyView');
  if (box) box.classList.remove('show');
  slides = [];
  idx = 0;
  crewLoaded = false;
  if (typeof window.renderStories === 'function') window.renderStories();
  return true;
}

/* --------------------------- création ------------------------------- */
function clearStoryPhoto(){
  if (photoUrl){ URL.revokeObjectURL(photoUrl); photoUrl = null; }
  photo = null;
  const box = el('storyPreview');
  if (box) box.classList.add('hidden');
}

export function openStoryComposer(){
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to post a story.'); return false; }
  clearStoryPhoto();
  setStoryDuration(1);
  clearComposerMusic('story');
  const ta = el('storyBody');
  if (ta) ta.value = '';
  const err = el('storyError');
  if (err){ err.textContent = ''; err.classList.add('hidden'); }
  const input = el('storyPhoto');
  if (input) input.value = '';
  if (typeof window.openModal === 'function') window.openModal('storyModal');
  if (ta) setTimeout(() => { try { ta.focus(); } catch(e){} }, 60);
  return true;
}

export function pickStoryPhoto(){
  const input = el('storyPhoto');
  if (!input) return false;
  input.click();
  return true;
}

export async function onStoryPhoto(e){
  const input = e && e.target;
  const file = input && input.files && input.files[0];
  if (!file) return false;
  if (input) input.value = '';
  if (!/^image\//.test(file.type || '')){ toast('Please choose an image file.'); return false; }
  if (file.size > MAX_BYTES){ toast('That photo is too large (12 MB max).'); return false; }
  /* la photo de story est éditée (recadrage 9:16, filtres) avant partage */
  return openImageEditor(
    { file: file, maxEdge: STORY_EDGE, aspect: '9:16', title: 'Edit story photo' },
    async edited => {
      try {
        photo = await compressImage(edited, STORY_EDGE, STORY_Q);
        const box = el('storyPreview');
        if (box){
          if (photoUrl) URL.revokeObjectURL(photoUrl);
          photoUrl = URL.createObjectURL(photo);
          const img = box.querySelector('img');
          if (img) img.src = photoUrl;
          box.classList.remove('hidden');
        }
        return true;
      } catch(err){
        toast('Could not read that photo.');
        return false;
      }
    });
}

let sending = false;
export async function submitStory(){
  if (sending) return false;
  const ta = el('storyBody');
  let body = ((ta && ta.value) || '').replace(/\r\n/g, '\n').trim().slice(0, 400);
  const track = getComposerMusic('story');
  if (track && track.id) body = withMusic(body.slice(0, 380), track.id);
  if (!body && !photo) return false;
  const c = sb();
  const me = meId();
  if (!c || !me){ toast('Sign in to post a story.'); return false; }

  const btn = el('storySubmit');
  sending = true;
  if (btn){ btn.disabled = true; btn.textContent = 'Sharing…'; }
  try {
    let image_path = null;
    if (photo){
      const ext = photo.type === 'image/webp' ? 'webp' : 'jpg';
      const path = me + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
      const { error: up } = await c.storage.from('stories').upload(path, photo, {
        contentType: photo.type, cacheControl: '31536000', upsert: false
      });
      if (up) throw new Error(up.message || 'Could not upload your story.');
      image_path = path;
    }
    const now = Date.now();
    const ttl = durDays > 0 ? durDays * 86400000 : FOREVER_MS;
    const { error } = await c.from('stories').insert({
      author_id: me, body: body, image_path: image_path,
      expires_at: new Date(now + ttl).toISOString()
    });
    if (error) throw new Error(error.message || 'Could not share your story.');

    if (typeof window.closeModal === 'function') window.closeModal('storyModal');
    clearStoryPhoto();
    clearComposerMusic('story');
    if (ta) ta.value = '';
    crewLoaded = false;
    if (typeof window.renderStories === 'function') window.renderStories();
    toast('Story shared.');
    return true;
  } catch(e){
    const err = el('storyError');
    if (err){ err.textContent = (e && e.message) || 'Could not share your story.'; err.classList.remove('hidden'); }
    return false;
  } finally {
    sending = false;
    if (btn){ btn.disabled = false; btn.textContent = 'Share'; }
  }
}

export async function deleteStory(id){
  const c = sb();
  if (!c || !id) return false;
  const s = slides.find(x => x.id === id);
  if (!s || String(s.author_id) !== String(meId() || '')) return false;
  const r = typeof window.askConfirm === 'function'
    ? await window.askConfirm('Delete this story?', 'It disappears for everyone right away.', 'Delete')
    : { ok: true };
  if (!r || !r.ok) return false;
  try {
    const { error } = await c.from('stories').delete().eq('id', id);
    if (error) throw new Error(error.message || 'Could not delete this story.');
    if (s.image_path) c.storage.from('stories').remove([s.image_path]).catch(() => {});
    slides = slides.filter(x => x.id !== id);
    if (!slides.length){ closeStoryViewer(); }
    else { if (idx >= slides.length) idx = slides.length - 1; paintSlide(); }
    crewLoaded = false;
    if (typeof window.renderStories === 'function') window.renderStories();
    toast('Story deleted.');
    return true;
  } catch(e){
    toast((e && e.message) || 'Could not delete this story.');
    return false;
  }
}

export function deleteCurrentStory(){
  const s = slides[idx];
  if (!s) return false;
  return deleteStory(s.id);
}

export function initStoryViewer(){
  const stage = el('svStage');
  if (!stage || stage.querySelector('.sv-hit')) return;
  const hit = document.createElement('div');
  hit.className = 'sv-hit';
  hit.innerHTML = '<button type="button" class="sv-tap left" aria-label="Previous"></button>' +
                  '<button type="button" class="sv-tap right" aria-label="Next"></button>';
  stage.appendChild(hit);
  hit.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('.sv-tap');
    if (!b) return;
    if (b.classList.contains('left')) prevSlide();
    else nextSlide();
  });
}

export function resetStories(){
  crewLoaded = false;
  queue = [];
  slides = [];
  idx = 0;
  durDays = 1;
  clearComposerMusic('story');
  stopTimer();
  clearStoryPhoto();
  const row = el('crewRow');
  if (row) row.innerHTML = '';
  clearStoryRings();
  applyStoryRings();
}
