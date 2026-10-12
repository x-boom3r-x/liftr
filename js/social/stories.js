/* ==================================================================
   SOCIAL - stories (24 h) : rangée du fil, visualiseur, création
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';
import { sb } from './client.js';
import { compressImage, mediaUrl } from './feed.js';
import { openImageEditor } from './editor.js';
import {
  withMusic, splitMusic, musicChipHtml, hydrateMusic, stopMusic,
  getComposerMusic, clearComposerMusic, openMusicPicker, setComposerMusic
} from './music.js';
import {
  musicStoryAutoplay, musicStoryResume, musicStoryForget
} from './autoplay.js';
import {
  setStoryRings, markStorySeen, clearStoryRings, applyStoryRings,
  ringsFresh, ringAuthorsKey, RING_TTL
} from './rings.js';
import { pushLayer, popLayer, installStoryGestures } from '../gestures.js';

const STORY_EDGE = 1080;
const STORY_Q = 0.85;
const MAX_BYTES = 12 * 1024 * 1024;
const SLIDE_MS = 5000;
const FOREVER_MS = 100 * 365 * 24 * 3600 * 1000;   /* « forever » = RLS > now() */
const STORY_SELECT = 'id,author_id,body,image_path,created_at,expires_at,style,' +
  'author:profiles!stories_author_id_fkey(id,username,display_name,avatar_url)';

/* 6 polices 100 % offline : piles de polices système (aucun réseau). */
const STORY_FONTS = [
  { k: 'impact', label: 'Impact' },
  { k: 'black', label: 'Heavy' },
  { k: 'serif', label: 'Serif' },
  { k: 'mono', label: 'Mono' },
  { k: 'cursive', label: 'Script' },
  { k: 'clean', label: 'Clean' }
];

let crewLoaded = false;
let queue = [];        /* auteurs avec story, dans l'ordre de la rangée */
let slides = [];       /* stories de l'auteur courant */
let idx = 0;
let timer = null;
let photo = null;
let photoUrl = null;
let durDays = 1;       /* durée choisie dans le composeur (1 = 24 h) */
let stStyle = null;    /* style texte riche du composeur (jsonb v6) */

/* Style par défaut d'une nouvelle story. x/y en % du stage (0-100),
   r en degrés, z l'échelle du texte. */
function defaultStoryStyle(){
  return { f: 'impact', c: '#ffffff', o: 1, s: 1, b: 0, x: 50, y: 40, r: 0, z: 1.15 };
}

/* bornes côté client (le serveur ne reçoit que cette forme compacte) */
function sanitizeStoryStyle(raw){
  if (!raw || typeof raw !== 'object') return null;
  const f = STORY_FONTS.some(x => x.k === raw.f) ? raw.f : 'impact';
  const c = /^#[0-9a-f]{6}$/i.test(raw.c || '') ? raw.c : '#ffffff';
  const num = (v, lo, hi, dflt) => {
    const n = parseFloat(v);
    return isNaN(n) ? dflt : Math.min(hi, Math.max(lo, n));
  };
  return {
    f: f, c: c,
    o: raw.o ? 1 : 0, s: raw.s ? 1 : 0, b: raw.b ? 1 : 0,
    x: Math.round(num(raw.x, 0, 100, 50)),
    y: Math.round(num(raw.y, 0, 100, 40)),
    r: Math.round(num(raw.r, -180, 180, 0)),
    z: Math.round(num(raw.z, 0.5, 3, 1.15) * 100) / 100
  };
}

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
  /* compteur de stories actives sur « You » (Instagram-like) */
  const count = (u.me && story && story.count > 0)
    ? '<span class="crew-count">' + Math.min(99, story.count) + '</span>' : '';
  return '<button type="button" class="crew-cell' + (u.me ? ' is-me' : '') + state + '" ' + act + '>' +
    '<span class="crew-ring' + (u.me && !story ? ' me' : '') + (story ? '' : ' none') + '">' +
      '<span class="avatar crew-av' + (u.avatar_url ? '' : ' fallback') + '">' + av + '</span>' +
      (u.me && !story ? '<span class="crew-plus" aria-hidden="true">+</span>' : '') +
      count +
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
  /* en-tête de la visionneuse : ouvre le profil de l'auteur.
     NOTE chantier E : .sv-profile fait partie des éléments ignorés par les
     gestes (pause / swipe) de la visionneuse. */
  const prof = el('svProfile');
  if (prof && !prof.dataset.wired){
    prof.dataset.wired = '1';
    prof.addEventListener('click', () => {
      const s = slides[0];
      if (!s || !s.author_id) return;
      closeStoryViewer();
      if (typeof window.openProfile === 'function') window.openProfile(s.author_id);
    });
  }
  const input = el('storyPhoto');
  if (input && !input.dataset.wired){
    input.dataset.wired = '1';
    input.addEventListener('change', onStoryPhoto);
  }
  wireDuration();
  wireStoryStage();
  wireStoryTools();
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

/* ------------------- composeur : texte riche (L2) ------------------- */
/* Le texte tapé dans #storyBody est miroité dans une couche déplaçable
   (#stgText) sur l'apercu 9:16. Drag = position, poignée = rotation. */

export function renderStageText(){
  const layer = el('stgText');
  const inner = el('stgTextInner');
  const ta = el('storyBody');
  if (!layer || !inner || !ta || !stStyle) return;
  const text = ta.value.replace(/\r\n/g, '\n').trim();
  inner.textContent = text;
  const tools = el('stgTools');
  if (tools) tools.classList.toggle('hidden', !text);
  layer.className = 'stg-text' + (text ? '' : ' hidden') +
    ' stf-' + stStyle.f +
    (stStyle.o ? ' has-o' : '') + (stStyle.s ? ' has-s' : '') + (stStyle.b ? ' has-b' : '');
  layer.style.left = stStyle.x + '%';
  layer.style.top = stStyle.y + '%';
  layer.style.color = stStyle.c;
  layer.style.transform =
    'translate(-50%,-50%) rotate(' + stStyle.r + 'deg) scale(' + stStyle.z + ')';
  const fc = el('stgFont');
  if (fc){
    const cur = STORY_FONTS.find(x => x.k === stStyle.f) || STORY_FONTS[0];
    fc.textContent = 'Font · ' + cur.label;
  }
  document.querySelectorAll('#stgTools [data-st]').forEach(b =>
    b.classList.toggle('on', !!stStyle[b.getAttribute('data-st')]));
  document.querySelectorAll('#stgColors .stg-sw').forEach(b =>
    b.classList.toggle('on', b.getAttribute('data-color') === stStyle.c));
}

export function cycleStoryFont(){
  if (!stStyle) return false;
  const i = STORY_FONTS.findIndex(x => x.k === stStyle.f);
  stStyle.f = STORY_FONTS[(i + 1) % STORY_FONTS.length].k;
  renderStageText();
  return true;
}

export function toggleStoryStyle(k){
  if (!stStyle || ['o', 's', 'b'].indexOf(k) < 0) return false;
  stStyle[k] = stStyle[k] ? 0 : 1;
  renderStageText();
  return true;
}

/* glisser = déplacer, poignée = tourner (angle depuis le centre du texte) */
function wireStoryStage(){
  const stage = el('storyStage');
  const layer = el('stgText');
  const rot = el('stgRot');
  if (!stage || !layer || !rot || stage.dataset.wired) return;
  stage.dataset.wired = '1';

  let drag = null;
  layer.addEventListener('pointerdown', e => {
    if (!stStyle || (e.target && e.target.closest && e.target.closest('.stg-rot'))) return;
    const r = stage.getBoundingClientRect();
    drag = {
      dx: e.clientX - (r.left + r.width * stStyle.x / 100),
      dy: e.clientY - (r.top + r.height * stStyle.y / 100),
      r: r
    };
    try { layer.setPointerCapture(e.pointerId); } catch(err){}
    e.preventDefault();
  });
  layer.addEventListener('pointermove', e => {
    if (!drag || !stStyle) return;
    const x = ((e.clientX - drag.dx - drag.r.left) / drag.r.width) * 100;
    const y = ((e.clientY - drag.dy - drag.r.top) / drag.r.height) * 100;
    stStyle.x = Math.round(Math.min(97, Math.max(3, x)));
    stStyle.y = Math.round(Math.min(95, Math.max(5, y)));
    renderStageText();
  });
  const drop = () => { drag = null; };
  layer.addEventListener('pointerup', drop);
  layer.addEventListener('pointercancel', drop);

  let turning = false;
  rot.addEventListener('pointerdown', e => {
    if (!stStyle) return;
    turning = true;
    try { rot.setPointerCapture(e.pointerId); } catch(err){}
    e.preventDefault();
    e.stopPropagation();
  });
  rot.addEventListener('pointermove', e => {
    if (!turning || !stStyle) return;
    const r = stage.getBoundingClientRect();
    const cx = r.left + r.width * stStyle.x / 100;
    const cy = r.top + r.height * stStyle.y / 100;
    /* le haut de la poignée = 0°, on ajoute 90° pour aligner atan2 */
    const ang = Math.round(Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI + 90);
    stStyle.r = Math.max(-180, Math.min(180, ang));
    renderStageText();
  });
  const stopTurn = () => { turning = false; };
  rot.addEventListener('pointerup', stopTurn);
  rot.addEventListener('pointercancel', stopTurn);
}

/* pastilles couleur + curseur de taille (branched une fois) */
function wireStoryTools(){
  const colors = el('stgColors');
  if (colors && !colors.dataset.wired){
    colors.dataset.wired = '1';
    colors.addEventListener('click', e => {
      const b = e.target && e.target.closest && e.target.closest('.stg-sw');
      if (!b || !stStyle) return;
      stStyle.c = b.getAttribute('data-color') || stStyle.c;
      renderStageText();
    });
  }
  const size = el('stgSize');
  if (size && !size.dataset.wired){
    size.dataset.wired = '1';
    size.addEventListener('input', () => {
      if (!stStyle) return;
      stStyle.z = Math.round(parseInt(size.value, 10) || 115) / 100;
      renderStageText();
    });
  }
  const ta = el('storyBody');
  if (ta && !ta.dataset.stWired){
    ta.dataset.stWired = '1';
    ta.addEventListener('input', renderStageText);
  }
}

function resetStoryComposerFields(){
  clearStoryPhoto();
  clearComposerMusic('story');
  const ta = el('storyBody');
  if (ta) ta.value = '';
  stStyle = defaultStoryStyle();
  const size = el('stgSize');
  if (size) size.value = String(Math.round(stStyle.z * 100));
  renderStageText();
  const done = el('storyDone');
  if (done) done.classList.add('hidden');
  const acts = el('storyActions');
  if (acts) acts.classList.remove('hidden');
  const err = el('storyError');
  if (err){ err.textContent = ''; err.classList.add('hidden'); }
}

export function openStoryComposer(){
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to post a story.'); return false; }
  resetStoryComposerFields();
  setStoryDuration(1);
  wireStoryStage();
  wireStoryTools();
  const input = el('storyPhoto');
  if (input) input.value = '';
  if (typeof window.openModal === 'function') window.openModal('storyModal');
  const ta = el('storyBody');
  if (ta) setTimeout(() => { try { ta.focus(); } catch(e){} }, 60);
  return true;
}

/* Fermeture complète (bouton Done du strip de succès). */
export function closeStoryComposer(){
  resetStoryComposerFields();
  setStoryDuration(1);
  if (typeof window.closeModal === 'function') window.closeModal('storyModal');
  return true;
}

/* « Add another » : on garde la durée, on vide le reste. */
export function storyAgain(){
  resetStoryComposerFields();
  const ta = el('storyBody');
  if (ta) setTimeout(() => { try { ta.focus(); } catch(e){} }, 60);
  return true;
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
  const url = s.image_path ? mediaUrl(s.image_path, sb(), 'stories') : null;
  const parts = splitMusic(s.body || '');
  const sty = sanitizeStoryStyle(s.style);
  const text = (parts.text || '').trim();
  stage.classList.toggle('plain', !url);
  stage.classList.remove('is-916');
  if (url) stage.style.setProperty('--sv-src', 'url("' + String(url).replace(/"/g, '%22') + '")');
  else stage.style.removeProperty('--sv-src');
  stage.innerHTML =
    (url ? '<img class="sv-img" src="' + esc(url) + '" alt="">' : '') +
    /* style riche (v6) : couche positionnée ; sinon légende classique */
    (sty && text
      ? '<div class="sv-text stf-' + sty.f +
          (sty.o ? ' has-o' : '') + (sty.s ? ' has-s' : '') + (sty.b ? ' has-b' : '') +
          '" style="left:' + sty.x + '%;top:' + sty.y + '%;color:' + sty.c +
          ';transform:translate(-50%,-50%) rotate(' + sty.r + 'deg) scale(' + sty.z + ')">' +
          esc(text) + '</div>'
      : '<div class="sv-caption' + (url ? ' over' : '') + '">' + esc(text) + '</div>') +
    (parts.trackId ? '<div class="sv-music">' + musicChipHtml(parts.trackId, '', parts) + '</div>' : '');
  if (url){
    const img = stage.querySelector('.sv-img');
    if (img){
      /* photo déjà cadrée 9:16 par l'éditeur : plein cadre (cover) ;
         sinon : contain + fond flou (var(--sv-src)) */
      const mark916 = () => {
        if (!img.naturalWidth || !img.naturalHeight) return;
        const r = img.naturalWidth / img.naturalHeight;
        stage.classList.toggle('is-916', Math.abs(r - 9 / 16) < 0.02);
      };
      if (img.complete) mark916();
      else img.addEventListener('load', mark916, { once: true });
      /* image introuvable : jamais de stage muet */
      img.addEventListener('error', () => {
        img.remove();
        stage.classList.remove('is-916');
        stage.classList.add('plain');
        stage.style.removeProperty('--sv-src');
        const cap = stage.querySelector('.sv-caption');
        if (cap && !(cap.textContent || '').trim()) cap.textContent = 'Photo unavailable.';
      }, { once: true });
    }
  }
  hydrateMusic(stage);
  initStoryViewer();
  /* pattern Instagram : la musique de la story démarre à l'affichage
     du slide (mute global ou pion !m → rien ne démarre) */
  musicStoryAutoplay(parts);

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
  stopMusic();
  if (idx + 1 < slides.length){ idx++; paintSlide(); return; }
  const cur = slides[0] && slides[0].author_id;
  const at = queue.findIndex(q => q.id === cur);
  const nxt = at >= 0 ? queue[at + 1] : null;
  if (nxt){ openStoryViewer(nxt.id, at + 1); return; }
  closeStoryViewer();
}

function prevSlide(){
  stopTimer();
  stopMusic();
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
  pushLayer('storyView', closeStoryViewer);
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
  stopMusic();
  musicStoryForget();
  popLayer('storyView');
  const box = el('storyView');
  if (box) box.classList.remove('show');
  slides = [];
  idx = 0;
  /* les anneaux seen sont deja appliques en direct a chaque paint
     (markStorySeen + applyStoryRings) : pas de re-fetch du crew ici. */
  applyStoryRings();
  return true;
}

/* --------------------------- création ------------------------------- */
function clearStoryPhoto(){
  if (photoUrl){ URL.revokeObjectURL(photoUrl); photoUrl = null; }
  photo = null;
  const img = el('storyStageImg');
  if (img){ img.removeAttribute('src'); img.classList.add('hidden'); }
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
    { file: file, mode: 'story', title: 'Edit story photo' },
    async edited => {
      try {
        photo = await compressImage(edited, STORY_EDGE, STORY_Q);
        const img = el('storyStageImg');
        if (img){
          if (photoUrl) URL.revokeObjectURL(photoUrl);
          photoUrl = URL.createObjectURL(photo);
          img.src = photoUrl;
          img.classList.remove('hidden');
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
  if (track && track.id) body = withMusic(body.slice(0, 380), track.id, track);
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
    /* style riche (v6) : présent seulement s'il y a du texte ; le mock
       comme la vraie table rejettent les colonnes inconnues, donc on
       n'envoie `style` qu'après la migration v6 — sinon on retente
       sans (best-effort, comme les reposts du chantier G). */
    const hasText = !!(body && String(body).trim());
    const styled = hasText ? sanitizeStoryStyle(stStyle) : null;
    const row = {
      author_id: me, body: body, image_path: image_path,
      expires_at: new Date(now + ttl).toISOString()
    };
    if (styled){
      row.style = styled;
      const { error } = await c.from('stories').insert(row);
      if (error && /style/i.test(error.message || '')){
        delete row.style;
        const retry = await c.from('stories').insert(row);
        if (retry.error) throw new Error(retry.error.message || 'Could not share your story.');
      } else if (error) throw new Error(error.message || 'Could not share your story.');
    } else {
      const { error } = await c.from('stories').insert(row);
      if (error) throw new Error(error.message || 'Could not share your story.');
    }

    /* strip « Story shared. » : Add another / Done — le modal reste ouvert
       pour enchaîner sans rouvrir (Instagram-like). */
    crewLoaded = false;
    refreshStoryRings(true);
    if (typeof window.renderStories === 'function') window.renderStories();
    if (ta) ta.value = '';
    clearStoryPhoto();
    clearComposerMusic('story');
    stStyle = defaultStoryStyle();
    renderStageText();
    const acts = el('storyActions');
    if (acts) acts.classList.add('hidden');
    const done = el('storyDone');
    if (done) done.classList.remove('hidden');
    const again = el('storyAgainBtn');
    if (again) again.focus();
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
    refreshStoryRings(true);
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
  /* chantier E : swipe bas = fermer, swipe gauche/droite = auteur suivant /
     précédent, appui long = pause (relâcher = reprise). */
  const viewer = el('storyView');
  if (viewer && !viewer.dataset.gestures){
    viewer.dataset.gestures = '1';
    installStoryGestures(viewer, {
      close: closeStoryViewer,
      nextUser: () => stepAuthor(1),
      prevUser: () => stepAuthor(-1),
      /* appui long = pause : timer ET musique s'arrêtent ;
         relâcher = reprise des deux */
      pause: () => { stopTimer(); stopMusic(); },
      resume: () => {
        if (slides.length && !timer) timer = setTimeout(nextSlide, SLIDE_MS);
        musicStoryResume();
      },
    });
  }
}

/* Enchaînement horizontal sur la file des auteurs (geste swipe). */
function stepAuthor(delta){
  const cur = slides[0] && slides[0].author_id;
  const at = queue.findIndex(q => q && q.id === cur);
  if (at < 0) return;
  const nxt = queue[at + delta];
  if (nxt) openStoryViewer(nxt.id, at + delta);
  else if (delta > 0) closeStoryViewer();
}

export function resetStories(){
  crewLoaded = false;
  queue = [];
  slides = [];
  idx = 0;
  durDays = 1;
  stStyle = defaultStoryStyle();
  clearComposerMusic('story');
  stopTimer();
  clearStoryPhoto();
  const row = el('crewRow');
  if (row) row.innerHTML = '';
  clearStoryRings();
  applyStoryRings();
}
