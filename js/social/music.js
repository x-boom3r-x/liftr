/* ==================================================================
   SOCIAL - musique : recherche iTunes, pion « ♪trackId » dans le
   corps des contenus, lecteur de prévisualisation, sélecteur.

   Le morceau est stocké dans le corps sous forme de pion compact
   (♪1234567890) : aucun changement de schéma est nécessaire pour
   l'attacher à une publication, une story ou une note (60 car. max).
   La fiche (titre / pochette / prévisualisation 30 s) est résolue
   côté client puis mise en cache (sessionStorage, jamais localStorage
   : la liste des clés autorisées est verrouillée par les tests).
   ================================================================== */

const API = 'https://itunes.apple.com';
const MARK = '♪';

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function openModal(id){ if (typeof window.openModal === 'function') window.openModal(id); }
function closeModal(id){ if (typeof window.closeModal === 'function') window.closeModal(id); }

/* --------------------------- corpus ♪id --------------------------- */
function tokenRe(){
  return new RegExp('(?:^|\\s)' + MARK + '(\\d{5,15})(?=\\s|$)');
}

export function splitMusic(text){
  const s = String(text == null ? '' : text);
  const re = tokenRe();
  const m = s.match(re);
  if (!m) return { text: s.replace(/\s+/g, ' ').trim(), trackId: null };
  const rest = s.replace(re, ' ').replace(/\s+/g, ' ').trim();
  return { text: rest, trackId: m[1] };
}

export function withMusic(text, trackId){
  const base = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  const id = trackId ? String(trackId) : '';
  if (!id) return base;
  const token = MARK + id;
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
export async function searchTracks(term){
  const q = String(term || '').trim();
  if (!q) return [];
  const url = API + '/search?term=' + encodeURIComponent(q) +
    '&media=music&entity=song&limit=15';
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Music search is unavailable.');
  const data = await res.json();
  const rows = (data && data.results) || [];
  /* on met chaque fiche en cache tout de suite : le bouton « Add » doit
     fonctionner immédiatement, sans attendre un éventuel lookup. */
  return rows.map(normTrack).filter(t => t && t.preview).map(t => cacheSet(t));
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
      if (!res.ok) return null;
      const data = await res.json();
      const rows = (data && data.results) || [];
      const raw = rows.find(r => String(r.trackId) === key) || rows[0];
      const t = normTrack(raw);
      return t ? cacheSet(t) : null;
    } catch(e){
      return null;
    } finally {
      delete pending[key];
    }
  })();
  return pending[key];
}

/* ------------------------------ lecteur --------------------------- */
let audio = null;
let playingId = null;

function paintPlayStates(){
  document.querySelectorAll('[data-mplay]').forEach(btn => {
    const on = String(btn.getAttribute('data-mplay')) === String(playingId || '');
    btn.classList.toggle('on', on);
    const ico = btn.querySelector('.mchip-ico');
    if (ico) ico.textContent = on ? '❚❚' : '▶';
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
  paintPlayStates();
}

function startAudio(track){
  const wasPlaying = String(playingId) === String(track.id);
  stopAudio();
  if (wasPlaying || !track.preview) return false;
  audio = new Audio(track.preview);
  playingId = String(track.id);
  audio.addEventListener('ended', stopAudio);
  audio.addEventListener('error', () => { toast('Preview unavailable.'); stopAudio(); });
  const p = audio.play();
  if (p && typeof p.catch === 'function') p.catch(() => { toast('Preview unavailable.'); stopAudio(); });
  paintPlayStates();
  return true;
}

export function playTrack(id){
  const key = String(id || '');
  if (!key) return false;
  const t = cacheGet(key);
  if (t && t.preview) return startAudio(t);
  resolveTrack(key).then(found => { if (found && found.preview) startAudio(found); });
  return true;
}

export function stopMusic(){ stopAudio(); }
export function musicPlayingId(){ return playingId; }

/* --------------------------- pion en ligne ------------------------ */
export function musicChipHtml(trackId, cls){
  const id = String(trackId || '');
  if (!id) return '';
  const t = cacheGet(id);
  const art = t && t.art
    ? ' style="background-image:url(' + esc(t.art) + ')"' : '';
  return '<div class="mchip ' + (cls || '') + '" data-track="' + esc(id) + '">' +
    '<button type="button" class="mchip-play" data-mplay="' + esc(id) + '" ' +
      'aria-label="Play preview"><span class="mchip-ico" aria-hidden="true">▶</span></button>' +
    '<span class="mchip-art" aria-hidden="true"' + art + '></span>' +
    '<span class="mchip-txt"><b class="mchip-t">' + esc(t ? t.title : 'Music') + '</b>' +
    '<i class="mchip-a">' + esc(t ? t.artist : 'Tap to load') + '</i></span>' +
    '</div>';
}

export function musicChipForBody(body, cls){
  const parts = splitMusic(body);
  return { text: parts.text, html: parts.trackId ? musicChipHtml(parts.trackId, cls) : '' };
}

/* Remplit les pions déjà posés dans le DOM (titre, pochette, play). */
export function hydrateMusic(root){
  const scope = root && root.querySelectorAll ? root : document;
  const chips = scope.querySelectorAll('.mchip[data-track]:not([data-music-on])');
  chips.forEach(chip => {
    chip.setAttribute('data-music-on', '1');
    const id = chip.getAttribute('data-track');
    const play = chip.querySelector('[data-mplay]');
    if (play){
      play.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        playTrack(id);
      });
    }
    if (cacheGet(id)) return;
    resolveTrack(id).then(t => {
      if (!t || !chip.isConnected) return;
      const title = chip.querySelector('.mchip-t');
      const artist = chip.querySelector('.mchip-a');
      const art = chip.querySelector('.mchip-art');
      if (title) title.textContent = t.title;
      if (artist) artist.textContent = t.artist;
      if (art && t.art) art.style.backgroundImage = 'url(' + t.art + ')';
    });
  });
  paintPlayStates();
}

/* ----------------------- sélecteur (modale) ----------------------- */
let pickCb = null;
let searchTimer = null;

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
      'aria-label="Play preview"><span class="mchip-ico" aria-hidden="true">▶</span></button>' +
    '<button type="button" class="btn btn-sm btn-primary music-add" data-add="' + esc(t.id) + '">Add</button>' +
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

export function openMusicPicker(cb){
  pickCb = typeof cb === 'function' ? cb : null;
  const input = el('musicInput');
  if (input) input.value = '';
  showMusicError('');
  const list = el('musicList');
  if (list) list.innerHTML = '<div class="music-hint">Search a song, then tap Add.</div>';
  openModal('musicModal');
  if (input) setTimeout(() => { try { input.focus(); } catch(e){} }, 60);
  return true;
}

export function closeMusicPicker(){
  pickCb = null;
  stopAudio();
  closeModal('musicModal');
  return true;
}

export async function runMusicSearch(){
  const input = el('musicInput');
  const term = ((input && input.value) || '').trim();
  if (!term){ showMusicError('Type a title or an artist.'); return false; }
  const list = el('musicList');
  if (list) list.innerHTML = '<div class="music-hint">Searching…</div>';
  showMusicError('');
  try {
    const rows = await searchTracks(term);
    paintRows(rows);
    return true;
  } catch(e){
    showMusicError((e && e.message) || 'Music search is unavailable.');
    if (list) list.innerHTML = '';
    return false;
  }
}

function chooseTrack(id){
  const t = cacheGet(id);
  const cb = pickCb;
  if (!t){ toast('Could not load that track.'); return false; }
  if (cb) cb(t);
  closeMusicPicker();
  return true;
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
    ? musicChipHtml(t.id, 'is-editable') +
      '<button type="button" class="mchip-rm" data-mrm="' + esc(t.id) + '" ' +
      'aria-label="Remove music">&times;</button>'
    : '';
  paintPlayStates();
}

/* ------------------------------ wiring ---------------------------- */
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
      const add = t.closest('[data-add]');
      if (add){ chooseTrack(add.getAttribute('data-add')); return; }
      const play = t.closest('[data-mplay]');
      if (play){ playTrack(play.getAttribute('data-mplay')); return; }
      const row = t.closest('[data-track]');
      if (row) chooseTrack(row.getAttribute('data-track'));
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
      const play = t.closest('[data-mplay]');
      if (play) playTrack(play.getAttribute('data-mplay'));
    });
  });
}

export function resetMusic(){
  pickCb = null;
  stopAudio();
  Object.keys(SLOTS).forEach(k => { slots[k] = null; paintSlot(k); });
}
