/* ==================================================================
   SOCIAL - musique : recherche iTunes, pion « ♪trackId[@start-end][!m] »
   dans le corps des contenus, lecteur de prévisualisation, sélecteur,
   page d'une piste (uses + save) et autoplay (via autoplay.js).

   Le morceau est stocké dans le corps sous forme de pion compact
   (♪1234567890 ou ♪1234567890@5-20 pour un extrait) : aucun changement
   de schéma est nécessaire pour l'attacher à une publication, une
   story ou une note (60 car. max). Le pion ancien format (sans @)
   continue d'être lu — extrait plein preview (30 s).
   Le suffixe optionnel « !m » marque un pion MUET : la lecture
   automatique (feed / story) l'ignore ; le bouton ▶ manuel reste
   actif. La fiche (titre / pochette / prévisualisation 30 s) est
   résolue côté client puis mise en cache (sessionStorage, jamais
   localStorage : la liste des clés autorisées est verrouillée par
   les tests).
   ================================================================== */

import { sb } from './client.js';
import { icon, iconS } from '../icons.js';

const API = 'https://itunes.apple.com';
const MARK = '♪';
const MUTED_SUF = '!m';
const CLIP_LEN = 15;   /* durée de l'extrait choisi dans le sélecteur */
const CLIP_MAX = 30;   /* durée max d'un extrait encodé dans le pion */

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function openModal(id){ if (typeof window.openModal === 'function') window.openModal(id); }
function closeModal(id){ if (typeof window.closeModal === 'function') window.closeModal(id); }

/* --------------------------- corpus ♪id[@s-e][!m] ---------------- */
/* Le suffixe est avalé « tel quel » puis validé en JS : un suffixe
   malformé (@abc, @20-5, @0-99, !x) n'empêche pas de lire le trackId —
   seul l'extrait est ignoré (ancien format plein preview). */
function tokenRe(){
  return new RegExp('(?:^|\\s)' + MARK + '(\\d{5,15})([^\\s]*)?(?=\\s|$)');
}

function validClip(start, end){
  return Number.isFinite(start) && Number.isFinite(end) &&
    start >= 0 && end > start && (end - start) <= CLIP_MAX;
}

export function splitMusic(text){
  const s = String(text == null ? '' : text);
  const re = tokenRe();
  const m = s.match(re);
  if (!m) return { text: s.replace(/\s+/g, ' ').trim(), trackId: null, start: 0, end: 0, muted: false };
  const rest = s.replace(re, ' ').replace(/\s+/g, ' ').trim();
  let suffix = m[2] != null ? m[2] : '';
  let muted = false;
  if (suffix.endsWith(MUTED_SUF)){ muted = true; suffix = suffix.slice(0, -MUTED_SUF.length); }
  let start = 0, end = 0;
  if (suffix.startsWith('@')){
    const mm = suffix.slice(1).match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
    if (mm){ start = parseFloat(mm[1]); end = parseFloat(mm[2]); }
  }
  if (!validClip(start, end)) return { text: rest, trackId: m[1], start: 0, end: 0, muted: muted };
  return { text: rest, trackId: m[1], start: start, end: end, muted: muted };
}

export function withMusic(text, trackId, clip){
  const base = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  const id = trackId ? String(trackId) : '';
  if (!id) return base;
  let token = MARK + id;
  const start = clip && +clip.start > 0 ? +clip.start : 0;
  const end = clip && +clip.end > start ? +clip.end : 0;
  if (validClip(start, end)) token += '@' + start + '-' + end;
  if (clip && clip.muted) token += MUTED_SUF;
  if (splitMusic(base).trackId === id) return base;
  return (base ? base + ' ' : '') + token;
}

/* ------------------------------ cache ---------------------------- */
const cache = new Map();
const pending = {};

function storeKey(id){ return 'liftr_music_' + id; }

function cacheGet(id){
  const key = String(id || '');
  if (!key) return null;
  if (cache.has(key)) return cache.get(key);
  try {
    const raw = sessionStorage.getItem(storeKey(key));
    if (raw){
      const t = JSON.parse(raw);
      if (t && t.id){ cache.set(key, t); return t; }
    }
  } catch(e){}
  return null;
}

function cacheSet(t){
  if (!t || !t.id) return null;
  cache.set(String(t.id), t);
  try { sessionStorage.setItem(storeKey(t.id), JSON.stringify(t)); } catch(e){}
  return t;
}

function normTrack(raw){
  if (!raw) return null;
  const id = String(raw.trackId || raw.collectionId || '');
  if (!id) return null;
  return {
    id: id,
    title: String(raw.trackName || raw.collectionName || 'Untitled').slice(0, 120),
    artist: String(raw.artistName || 'Unknown artist').slice(0, 80),
    album: String(raw.collectionName || '').slice(0, 120),
    art: String(raw.artworkUrl100 || raw.artworkUrl60 || ''),
    preview: String(raw.previewUrl || ''),
    ms: +raw.trackTimeMillis || 0
  };
}

/* ---------------------------- recherche --------------------------- */
function normList(rows){
  const all = (rows || []).map(normTrack).filter(Boolean);
  const withPv = all.filter(t => t.preview);
  /* si aucun résultat n'a d'aperçu, on garde quand même la liste :
     l'utilisateur doit voir que la recherche a trouvé quelque chose. */
  return (withPv.length ? withPv : all).map(t => cacheSet(t));
}

/* Secours JSONP (Deezer n'expose pas d'en-tête CORS) : utilisé quand
   iTunes est injoignable ou ne renvoie rien. */
function jsonp(name, url){
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    let done = false;
    let timer = 0;
    const cleanup = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { delete window[name]; } catch(e){ window[name] = undefined; }
      if (s.parentNode) s.parentNode.removeChild(s);
    };
    timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, 9000);
    window[name] = data => { cleanup(); resolve(data); };
    s.onerror = () => { cleanup(); reject(new Error('network')); };
    s.src = url;
    document.head.appendChild(s);
  });
}

function jsonpName(){ return '__liftr_jsonp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

async function searchDeezer(term){
  const name = jsonpName();
  const data = await jsonp(name, 'https://api.deezer.com/search?limit=15&output=jsonp&callback=' + name +
    '&q=' + encodeURIComponent(term));
  return normList(((data && data.data) || []).map(d => ({
    trackId: d.id,
    trackName: d.title,
    artistName: d.artist && d.artist.name,
    collectionName: d.album && d.album.title,
    artworkUrl100: d.album && (d.album.cover_medium || d.album.cover_big),
    previewUrl: d.preview,
    trackTimeMillis: d.duration ? d.duration * 1000 : 0
  })));
}

async function lookupDeezer(key){
  const name = jsonpName();
  const data = await jsonp(name, 'https://api.deezer.com/track/' + encodeURIComponent(key) +
    '?output=jsonp&callback=' + name);
  if (!data || !data.id) return null;
  return cacheSet(normTrack({
    trackId: data.id,
    trackName: data.title,
    artistName: data.artist && data.artist.name,
    collectionName: data.album && data.album.title,
    artworkUrl100: data.album && (data.album.cover_medium || data.album.cover_big),
    previewUrl: data.preview,
    trackTimeMillis: data.duration ? data.duration * 1000 : 0
  }));
}

export async function searchTracks(term, signal){
  const q = String(term || '').trim();
  if (!q) return [];
  const url = API + '/search?term=' + encodeURIComponent(q) +
    '&media=music&entity=song&limit=15';
  let unreachable = null;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: signal || undefined
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const rows = normList(data && data.results);
    if (rows.length) return rows;
  } catch(e){
    if (signal && signal.aborted) throw e;
    unreachable = e;
  }
  /* secours : Deezer en JSONP, puis on rend la main */
  try {
    if (signal && signal.aborted) throw new Error('abort');
    const alt = await searchDeezer(q);
    if (alt.length) return alt;
  } catch(e2){ if (!unreachable) unreachable = e2; }
  if (unreachable) throw new Error('Music search is unreachable. Check your connection, then retry.');
  return [];
}

export async function resolveTrack(id){
  const key = String(id || '');
  if (!key) return null;
  const hit = cacheGet(key);
  if (hit) return hit;
  if (pending[key]) return pending[key];

  pending[key] = (async () => {
    try {
      const res = await fetch(API + '/lookup?id=' + encodeURIComponent(key) + '&entity=song',
        { headers: { Accept: 'application/json' } });
      if (res.ok){
        const data = await res.json();
        const rows = (data && data.results) || [];
        const raw = rows.find(r => String(r.trackId) === key) || rows[0];
        const t = normTrack(raw);
        if (t) return cacheSet(t);
      }
    } catch(e){}
    /* secours : la fiche vient peut-être de Deezer (pion ♪id) */
    try {
      const alt = await lookupDeezer(key);
      if (alt) return alt;
    } catch(e2){}
    return null;
  })().finally(() => { delete pending[key]; });
  return pending[key];
}

/* ------------------------------ lecteur --------------------------- */
/* Singleton conservé (audio-controller.js n'est PAS un remplaçant ici) :
   un seul <audio>, stop sur ended/error/fin d'extrait, stop sur
   changement d'onglet, de vue, de slide, de modal et pagehide. */
let audio = null;
let playingId = null;
let clipEnd = 0;

function paintPlayStates(){
  document.querySelectorAll('[data-mplay]').forEach(btn => {
    const on = String(btn.getAttribute('data-mplay')) === String(playingId || '');
    btn.classList.toggle('on', on);
    const ico = btn.querySelector('.mchip-ico');
    if (ico) ico.innerHTML = iconS(on ? 'pause' : 'play');
    btn.setAttribute('aria-label', on ? 'Pause preview' : 'Play preview');
  });
}

function stopAudio(){
  if (audio){
    try { audio.pause(); } catch(e){}
    try { audio.removeAttribute('src'); } catch(e){}
    audio = null;
  }
  playingId = null;
  clipEnd = 0;
  paintPlayStates();
}

/* play() doit être SYNCHRONE dans le handler de clic (exigence iOS) :
   aucun await avant le premier play. Le seek au début de l'extrait se
   fait sur loadedmetadata (une fois les métadonnées disponibles). */
function startAudio(track, clip){
  const wasPlaying = String(playingId) === String(track.id);
  stopAudio();
  if (wasPlaying || !track.preview) return false;
  const start = clip && +clip.start > 0 ? +clip.start : 0;
  clipEnd = clip && +clip.end > start ? +clip.end : 0;
  audio = new Audio(track.preview);
  playingId = String(track.id);
  audio.addEventListener('ended', stopAudio);
  /* pas de toast : play() rejeté ou erreur réseau → retour au ▶ */
  audio.addEventListener('error', () => { stopAudio(); });
  if (start > 0){
    audio.addEventListener('loadedmetadata', () => {
      if (audio){ try { audio.currentTime = start; } catch(e){} }
    }, { once: true });
  }
  if (clipEnd > start){
    audio.addEventListener('timeupdate', () => {
      if (audio && audio.currentTime >= clipEnd) stopAudio();
    });
  }
  const p = audio.play();
  if (p && typeof p.catch === 'function') p.catch(() => { stopAudio(); });
  paintPlayStates();
  return true;
}

export function playTrack(id, clip){
  const key = String(id || '');
  if (!key) return false;
  const t = cacheGet(key);
  if (t){
    if (t.preview) return startAudio(t, clip);
    toast('No preview for this track.');
    return false;
  }
  resolveTrack(key).then(found => {
    if (found && found.preview) startAudio(found, clip);
    else toast('No preview for this track.');
  });
  return true;
}

export function stopMusic(){ stopAudio(); }
export function musicPlayingId(){ return playingId; }

/* --------------------------- pion en ligne ------------------------ */
export function musicChipHtml(trackId, cls, clip){
  const id = String(trackId || '');
  if (!id) return '';
  const t = cacheGet(id);
  const start = clip && +clip.start > 0 ? ' data-start="' + esc(+clip.start) + '"' : '';
  const end = clip && +clip.end > +clip.start ? ' data-end="' + esc(+clip.end) + '"' : '';
  const muted = clip && clip.muted ? ' data-muted="1"' : '';
  const art = t && t.art
    ? ' style="background-image:url(' + esc(t.art) + ')"' : '';
  return '<div class="mchip ' + (cls || '') + (clip && clip.muted ? ' is-muted' : '') +
    '" data-track="' + esc(id) + '"' + start + end + muted + '>' +
    '<button type="button" class="mchip-play" data-mplay="' + esc(id) + '" ' +
      'aria-label="Play preview"><span class="mchip-ico" aria-hidden="true">' + iconS('play') + '</span></button>' +
    '<span class="mchip-art" aria-hidden="true"' + art + '></span>' +
    '<span class="mchip-txt"><b class="mchip-t">' + esc(t ? t.title : 'Music') + '</b>' +
    '<i class="mchip-a">' + esc(t ? t.artist : 'Tap to load') +
    (clip && clip.muted ? ' · muted' : '') + '</i></span>' +
    '</div>';
}

export function musicChipForBody(body, cls){
  const parts = splitMusic(body);
  return { text: parts.text, html: parts.trackId ? musicChipHtml(parts.trackId, cls, parts) : '' };
}

/* Remplit les pions déjà posés dans le DOM (titre, pochette, play).
   Le clic sur le corps de la chip (hors ▶) ouvre la page de la piste. */
export function hydrateMusic(root){
  const scope = root && root.querySelectorAll ? root : document;
  const chips = scope.querySelectorAll('.mchip[data-track]:not([data-music-on])');
  chips.forEach(chip => {
    chip.setAttribute('data-music-on', '1');
    const id = chip.getAttribute('data-track');
    const clipOf = () => {
      const cs = parseFloat(chip.getAttribute('data-start')) || 0;
      const ce = parseFloat(chip.getAttribute('data-end')) || 0;
      const cm = chip.getAttribute('data-muted') === '1';
      return { start: cs, end: ce > cs ? ce : 0, muted: cm };
    };
    const play = chip.querySelector('[data-mplay]');
    if (play){
      play.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const clip = clipOf();
        playTrack(id, clip.end > clip.start ? clip : null);
      });
    }
    if (!chip.classList.contains('is-editable')){
      chip.addEventListener('click', e => {
        if (e.target.closest && e.target.closest('[data-mplay]')) return;
        e.preventDefault();
        e.stopPropagation();
        openTrackPage(id, clipOf());
      });
    }
    if (cacheGet(id)) return;
    resolveTrack(id).then(t => {
      if (!t || !chip.isConnected) return;
      const title = chip.querySelector('.mchip-t');
      const artist = chip.querySelector('.mchip-a');
      const art = chip.querySelector('.mchip-art');
      if (title) title.textContent = t.title;
      if (artist) artist.textContent = t.artist + (chip.getAttribute('data-muted') === '1' ? ' · muted' : '');
      if (art && t.art) art.style.backgroundImage = 'url(' + t.art + ')';
    });
  });
  paintPlayStates();
  if (typeof window.autoplayScan === 'function') window.autoplayScan(scope);
}

/* ------------------- page d'une piste (uses + save) -------------- */
/* Accessible depuis n'importe quelle chip (feed, story, composeur) :
   liste les posts / stories qui portent le pion ♪id + permet de
   sauvegarder la piste (localStorage + table music_saves, best-effort). */
const SAVES_KEY = 'liftr_music_saves';

function savedLocal(){
  try {
    const a = JSON.parse(localStorage.getItem(SAVES_KEY) || '[]');
    return Array.isArray(a) ? a.map(String) : [];
  } catch(e){ return []; }
}

function savedWrite(arr){
  try { localStorage.setItem(SAVES_KEY, JSON.stringify(arr.slice(0, 200))); } catch(e){}
}

export function savedTracks(){ return savedLocal(); }
export function isTrackSaved(id){ return savedLocal().indexOf(String(id || '')) >= 0; }

export function toggleTrackSave(id){
  const key = String(id || '');
  if (!key) return false;
  const arr = savedLocal();
  const at = arr.indexOf(key);
  if (at >= 0) arr.splice(at, 1); else arr.unshift(key);
  savedWrite(arr);
  paintTrackSave();
  /* cloud best-effort : offline / non connecté → le local fait foi */
  try {
    const c = sb();
    const me = (window.socialUser || {}).id || null;
    if (c && me){
      if (at >= 0){
        c.from('music_saves').delete().eq('track_id', key).eq('user_id', me)
          .then(() => {}, () => {});
      } else {
        c.from('music_saves').upsert({ track_id: key, user_id: me },
          { onConflict: 'user_id,track_id' }).then(() => {}, () => {});
      }
    }
  } catch(e){}
  return true;
}

function trackAvatar(row){
  const p = row.author || {};
  const name = p.display_name || p.username || 'Someone';
  const initial = String(name).charAt(0).toUpperCase();
  return '<span class="track-av" aria-hidden="true">' + esc(initial) + '</span>';
}

function trackRowHtml(kind, row){
  const parts = splitMusic(row.body || '');
  return '<button type="button" class="track-row" data-kind="' + esc(kind) + '" ' +
    'data-row-id="' + esc(row.id) + '" data-author="' + esc(row.author_id || '') + '">' +
    trackAvatar(row) +
    '<span class="track-row-txt"><b>' + esc(parts.text || '♪') + '</b>' +
    '<i>' + esc((row.author && (row.author.display_name || row.author.username)) || 'Someone') +
    '</i></span></button>';
}

let trackUses = { posts: [], stories: [] };

async function loadTrackUses(id){
  const key = String(id || '');
  const uses = { posts: [], stories: [] };
  try {
    const c = sb();
    if (c){
      /* joker « * » natif de PostgREST : évite un « % » brut dans l'URL */
      const like = '*' + MARK + key + '*';
      const [po, st2] = await Promise.all([
        c.from('posts').select('id,body,kind,created_at,author_id,author:profiles(username,display_name)')
          .ilike('body', like).order('created_at', { ascending: false }).limit(20),
        c.from('stories').select('id,body,author_id,created_at,author:profiles(username,display_name)')
          .ilike('body', like).order('created_at', { ascending: false }).limit(20)
      ]);
      if (po && !po.error && Array.isArray(po.data)) uses.posts = po.data;
      if (st2 && !st2.error && Array.isArray(st2.data)) uses.stories = st2.data;
    }
  } catch(e){}
  /* jointure author absente (mock / best-effort) : on garde les lignes */
  return uses;
}

function paintTrackUses(){
  const box = el('trackUses');
  if (!box) return;
  const posts = trackUses.posts || [];
  const stories = trackUses.stories || [];
  const one = (kind, rows) => rows.length
    ? '<div class="track-sec-title">' + kind + '</div>' + rows.map(r => trackRowHtml(kind === 'Posts' ? 'post' : 'story', r)).join('')
    : '';
  const html = one('Stories', stories) + one('Posts', posts);
  box.innerHTML = html || '<div class="music-hint">Not used in any post or story yet.</div>';
}

function paintTrackSave(){
  const btn = el('trackSaveBtn');
  if (!btn) return;
  const id = btn.getAttribute('data-track') || '';
  const on = isTrackSaved(id);
  btn.innerHTML = on ? icon('check') + 'Saved' : 'Save';
  btn.classList.toggle('sel', on);
}

export function openTrackPage(trackId, clip){
  const id = String(trackId || '');
  if (!id) return false;
  const t = cacheGet(id);
  const box = el('trackModal');
  if (!box) return false;
  const head = el('trackHead');
  if (head) head.innerHTML =
    '<span class="music-art" aria-hidden="true"' +
    (t && t.art ? ' style="background-image:url(' + esc(t.art) + ')"' : '') + '></span>' +
    '<span class="track-txt"><b>' + esc(t ? t.title : 'Music') + '</b>' +
    '<i>' + esc(t ? t.artist : 'Tap to load') + '</i></span>' +
    '<button type="button" class="music-play" data-mplay="' + esc(id) + '" ' +
    'aria-label="Play preview"><span class="mchip-ico" aria-hidden="true">' + iconS('play') + '</span></button>';
  const save = el('trackSaveBtn');
  if (save){
    save.setAttribute('data-track', id);
    paintTrackSave();
  }
  hydrateMusic(head);
  trackUses = { posts: [], stories: [] };
  paintTrackUses();
  openModal('trackModal');
  loadTrackUses(id).then(uses => {
    if (!box.isConnected) return;
    trackUses = uses;
    paintTrackUses();
  });
  return true;
}

export function closeTrackPage(){
  stopAudio();
  closeModal('trackModal');
  return true;
}

/* ----------------------- sélecteur (modale) ----------------------- */
let pickCb = null;
let searchTimer = null;
let searchAbort = null;
let selectedId = null;
let clipStart = 0;

function showMusicError(msg){
  const box = el('musicError');
  if (!box) return;
  box.textContent = msg || '';
  box.classList.toggle('hidden', !msg);
}

function rowHtml(t){
  const art = t.art ? ' style="background-image:url(' + esc(t.art) + ')"' : '';
  return '<div class="music-row" data-track="' + esc(t.id) + '">' +
    '<span class="music-art" aria-hidden="true"' + art + '></span>' +
    '<span class="music-txt"><b>' + esc(t.title) + '</b><i>' + esc(t.artist) + '</i></span>' +
    '<button type="button" class="music-play" data-mplay="' + esc(t.id) + '" ' +
      'aria-label="Play preview"><span class="mchip-ico" aria-hidden="true">' + iconS('play') + '</span></button>' +
    '</div>';
}

function paintRows(rows){
  const list = el('musicList');
  if (!list) return;
  list.innerHTML = rows.length
    ? rows.map(rowHtml).join('')
    : '<div class="music-hint">No result. Try another title or artist.</div>';
  hydrateMusic(list);
}

function selectRow(id){
  const key = String(id || '');
  const hit = key ? cacheGet(key) : null;
  if (!hit){ toast('Could not load that track.'); return false; }
  selectedId = key;
  clipStart = 0;
  document.querySelectorAll('#musicList .music-row').forEach(r => {
    r.classList.toggle('sel', r.getAttribute('data-track') === selectedId);
  });
  const use = el('musicUseBtn');
  if (use) use.disabled = !selectedId;
  paintClip();
  return true;
}

function paintClip(){
  const box = el('musicClip');
  const t = selectedId ? cacheGet(selectedId) : null;
  const dur = t && t.ms ? t.ms / 1000 : 30;
  const maxStart = Math.max(0, Math.min(CLIP_LEN, dur - CLIP_LEN));
  if (box) box.classList.toggle('show', !!(t && t.preview));
  const range = el('musicClipRange');
  const out = el('musicClipOut');
  if (range){
    range.max = String(Math.floor(maxStart));
    range.value = String(Math.min(Math.floor(clipStart), Math.floor(maxStart)));
  }
  if (out){
    const start = Math.min(clipStart, maxStart);
    out.textContent = Math.round(start) + 's → ' + Math.round(start + CLIP_LEN) + 's';
  }
}

function useTrack(){
  const t = selectedId ? cacheGet(selectedId) : null;
  const cb = pickCb;
  if (!t){ toast('Could not load that track.'); return false; }
  const dur = t.ms ? t.ms / 1000 : 30;
  const maxStart = Math.max(0, Math.min(CLIP_LEN, dur - CLIP_LEN));
  const start = Math.max(0, Math.min(clipStart, maxStart));
  const end = Math.min(start + CLIP_LEN, dur);
  const track = Object.assign({}, t, {
    start: start, end: end, clipStart: start, clipEnd: end
  });
  if (cb) cb(track);
  closeMusicPicker();
  return true;
}

export function openMusicPicker(cb){
  pickCb = typeof cb === 'function' ? cb : null;
  selectedId = null;
  clipStart = 0;
  const input = el('musicInput');
  if (input) input.value = '';
  showMusicError('');
  const list = el('musicList');
  const saved = savedLocal();
  if (list){
    if (saved.length){
      /* titres froids (sessionStorage vidé) : on résout à la volée */
      const rowsHtml = saved.map(id => {
        const t = cacheGet(id) || { id: id, title: 'Music', artist: '', art: '' };
        return rowHtml(t);
      }).join('');
      list.innerHTML = '<div class="music-hint">Saved</div>' + rowsHtml +
        '<div class="music-hint">Search a song, then tap a row.</div>';
      list.querySelectorAll('.music-row').forEach(r => {
        const rid = r.getAttribute('data-track');
        if (cacheGet(rid)) return;
        resolveTrack(rid).then(t => {
          if (!t || !r.isConnected) return;
          const b = r.querySelector('b'), i = r.querySelector('i');
          if (b) b.textContent = t.title;
          if (i) i.textContent = t.artist;
        });
      });
    } else {
      list.innerHTML = '<div class="music-hint">Search a song, then tap a row.</div>';
    }
  }
  const use = el('musicUseBtn');
  if (use) use.disabled = true;
  paintClip();
  openModal('musicModal');
  if (input) setTimeout(() => { try { input.focus(); } catch(e){} }, 60);
  return true;
}

export function closeMusicPicker(){
  pickCb = null;
  selectedId = null;
  clipStart = 0;
  if (searchAbort){ try { searchAbort.abort(); } catch(e){} searchAbort = null; }
  stopAudio();
  closeModal('musicModal');
  return true;
}

let searchSeq = 0;
export async function runMusicSearch(){
  const input = el('musicInput');
  const term = ((input && input.value) || '').trim();
  if (!term){ showMusicError('Type a title or an artist.'); return false; }
  const seq = ++searchSeq;
  if (searchAbort){ try { searchAbort.abort(); } catch(e){} }
  searchAbort = new AbortController();
  const signal = searchAbort.signal;
  const list = el('musicList');
  if (list) list.innerHTML = '<div class="music-hint">Searching…</div>';
  showMusicError('');
  try {
    const rows = await searchTracks(term, signal);
    if (seq !== searchSeq || signal.aborted) return false;
    paintRows(rows);
    return true;
  } catch(e){
    if (seq !== searchSeq || (signal && signal.aborted)) return false;
    showMusicError((e && e.message) || 'Music search is unreachable. Check your connection, then retry.');
    if (list) list.innerHTML = '';
    return false;
  }
}

/* ----------------- emplacements dans les composeurs ---------------- */
const SLOTS = { post: 'postMusicSlot', story: 'storyMusicSlot', note: 'noteMusicSlot' };
const slots = { post: null, story: null, note: null };

export function getComposerMusic(target){ return slots[target] || null; }

export function setComposerMusic(target, track){
  if (!SLOTS[target]) return false;
  slots[target] = track || null;
  paintSlot(target);
  return true;
}

export function clearComposerMusic(target){ return setComposerMusic(target, null); }

function paintSlot(target){
  const box = el(SLOTS[target]);
  if (!box) return;
  const t = slots[target];
  box.classList.toggle('hidden', !t);
  box.innerHTML = t
    ? musicChipHtml(t.id, 'is-editable', t) +
      '<button type="button" class="mchip-auto' + (t.muted ? ' off' : '') +
      '" data-mauto="1" aria-pressed="' + (t.muted ? 'false' : 'true') + '" ' +
      'aria-label="Toggle autoplay">' + (t.muted ? 'Autoplay off' : 'Autoplay on') + '</button>' +
      '<button type="button" class="mchip-rm" data-mrm="' + esc(t.id) + '" ' +
      'aria-label="Remove music">&times;</button>'
    : '';
  paintPlayStates();
}

/* ------------------------------ wiring ---------------------------- */
let lifecycleWired = false;

export function initMusic(){
  const input = el('musicInput');
  if (input && !input.dataset.wired){
    input.dataset.wired = '1';
    input.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(runMusicSearch, 350);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter'){ e.preventDefault(); clearTimeout(searchTimer); runMusicSearch(); }
    });
  }
  const btn = el('musicSearchBtn');
  if (btn && !btn.dataset.wired){
    btn.dataset.wired = '1';
    btn.addEventListener('click', () => { clearTimeout(searchTimer); runMusicSearch(); });
  }

  const list = el('musicList');
  if (list && !list.dataset.wired){
    list.dataset.wired = '1';
    list.addEventListener('click', e => {
      const t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      const play = t.closest('[data-mplay]');
      if (play){ playTrack(play.getAttribute('data-mplay')); return; }
      const row = t.closest('[data-track]');
      if (row) selectRow(row.getAttribute('data-track'));
    });
  }

  const use = el('musicUseBtn');
  if (use && !use.dataset.wired){
    use.dataset.wired = '1';
    use.addEventListener('click', useTrack);
  }
  const range = el('musicClipRange');
  if (range && !range.dataset.wired){
    range.dataset.wired = '1';
    range.addEventListener('input', () => {
      clipStart = Math.max(0, parseFloat(range.value) || 0);
      paintClip();
    });
  }

  Object.keys(SLOTS).forEach(target => {
    const box = el(SLOTS[target]);
    if (!box || box.dataset.wired) return;
    box.dataset.wired = '1';
    box.addEventListener('click', e => {
      const t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      const rm = t.closest('[data-mrm]');
      if (rm){ setComposerMusic(target, null); return; }
      const auto = t.closest('[data-mauto]');
      if (auto){
        const cur = slots[target];
        if (cur){ cur.muted = !cur.muted; paintSlot(target); }
        return;
      }
      const play = t.closest('[data-mplay]');
      if (play){
        const chip = play.closest('.mchip');
        const cs = chip ? parseFloat(chip.getAttribute('data-start')) || 0 : 0;
        const ce = chip ? parseFloat(chip.getAttribute('data-end')) || 0 : 0;
        playTrack(play.getAttribute('data-mplay'), ce > cs ? { start: cs, end: ce } : null);
      }
    });
  });

  /* page d'une piste : save + navigation vers le post / la story */
  const tModal = el('trackModal');
  if (tModal && !tModal.dataset.wired){
    tModal.dataset.wired = '1';
    const save = el('trackSaveBtn');
    if (save) save.addEventListener('click', () => {
      toggleTrackSave(save.getAttribute('data-track'));
    });
    const uses = el('trackUses');
    if (uses) uses.addEventListener('click', e => {
      const row = e.target && e.target.closest ? e.target.closest('[data-row-id]') : null;
      if (!row) return;
      const kind = row.getAttribute('data-kind');
      const rid = row.getAttribute('data-row-id');
      const author = row.getAttribute('data-author');
      closeTrackPage();
      if (kind === 'story'){
        if (typeof window.openStoryViewer === 'function') window.openStoryViewer(author);
      } else {
        if (typeof window.openFeed === 'function') window.openFeed();
        setTimeout(() => {
          const post = document.querySelector('#feedList [data-post="' + rid + '"]');
          if (post && post.scrollIntoView) post.scrollIntoView({ block: 'center' });
        }, 120);
      }
    });
  }

  if (!lifecycleWired){
    lifecycleWired = true;
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopAudio(); });
    window.addEventListener('pagehide', () => stopAudio());
  }
}

export function resetMusic(){
  pickCb = null;
  selectedId = null;
  clipStart = 0;
  if (searchAbort){ try { searchAbort.abort(); } catch(e){} searchAbort = null; }
  stopAudio();
  Object.keys(SLOTS).forEach(k => { slots[k] = null; paintSlot(k); });
}
