/* ==================================================================
   SOCIAL - notes (60 car., 24 h) au-dessus de la liste des messages
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';
import { sb } from './client.js';
import {
  splitMusic, withMusic, musicChipHtml, hydrateMusic,
  getComposerMusic, clearComposerMusic, openMusicPicker, setComposerMusic
} from './music.js';

const NOTE_SELECT = 'id,author_id,body,created_at,expires_at,updated_at,' +
  'author:profiles!notes_author_id_fkey(id,username,display_name,avatar_url)';
const NOTE_MAX = 60;
const FOREVER_MS = 100 * 365 * 24 * 3600 * 1000;   /* « forever » = RLS > now() */

let loaded = false;
let mine = null;
let others = [];   /* [{ note, author }] */
let profiles = {};
let busy = false;
let durDays = 1;   /* durée choisie dans le composeur (1 = 24 h) */

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function gateOk(){ return typeof window.socialAvailable === 'function' ? window.socialAvailable() : SOCIAL_ENABLED; }
function meId(){ return (window.socialUser || {}).id || null; }

function face(author){
  const name = (author && (author.display_name || author.username)) || '?';
  const url = author && author.avatar_url;
  if (url) return '<img class="note-av-img" src="' + esc(url) + '" alt="">';
  return esc(String(name).trim().charAt(0).toUpperCase() || '?');
}

function cell(note, author, isMe){
  const uid = note.author_id;
  const parts = splitMusic(note.body || '');
  const text = parts.text ? esc(parts.text) : '';
  const bubble = text
    ? '<span class="note-bubble">' + text + '</span>'
    : '<span class="note-bubble empty">+ Note</span>';
  const avatar = isMe
    ? '<span class="avatar note-av">' + (text ? face(author) : '+') + '</span>'
    : '<span class="avatar note-av">' + face(author) + '</span>';
  const attrs = isMe
    ? 'data-note="me"'
    : 'data-note="peer" data-uid="' + esc(uid) + '"';
  const name = isMe
    ? 'You'
    : esc(String(((author && (author.display_name || author.username)) || '').slice(0, 12)));
  const song = parts.trackId
    ? '<div class="note-music">' + musicChipHtml(parts.trackId, '', parts) + '</div>'
    : '';
  return '<div class="note-item">' +
    '<button type="button" class="note-cell' + (isMe ? ' is-me' : '') +
    (text ? '' : ' blank') + '" ' + attrs + ' aria-label="Note from ' + name + '">' +
    bubble + avatar + '</button>' + song + '</div>';
}

function paintNotes(){
  const row = el('notesRow');
  if (!row) return false;
  const me = meId();
  const my = me
    ? (mine || { id: null, author_id: me, body: '', author: profiles[me] || null })
    : null;
  let html = my ? cell(my, my.author, true) : '';
  html += others.map(x => cell(x.note, x.author, false)).join('');
  row.innerHTML = html;
  row.classList.toggle('hidden', !html);
  hydrateMusic(row);
  return true;
}

export async function renderNotes(){
  const row = el('notesRow');
  if (!row) return false;
  const c = sb();
  const me = meId();
  if (!c || !me || !gateOk()){ row.classList.add('hidden'); return false; }
  row.classList.remove('hidden');
  if (loaded){ paintNotes(); return true; }
  row.innerHTML = '';
  try {
    const { data: convs } = await c.from('conversations')
      .select('id,user_a,user_b')
      .or('user_a.eq.' + me + ',user_b.eq.' + me)
      .limit(60);
    const peerIds = (convs || [])
      .map(x => x.user_a === me ? x.user_b : x.user_a)
      .filter(id => id && id !== me);
    const ids = [me].concat(peerIds.filter((v, i, a) => a.indexOf(v) === i));

    const [nRes, pRes] = await Promise.all([
      c.from('notes').select(NOTE_SELECT)
        .in('author_id', ids)
        .gt('expires_at', new Date().toISOString())
        .order('updated_at', { ascending: false }),
      c.from('profiles').select('id,username,display_name,avatar_url').in('id', ids)
    ]);
    if (nRes.error) throw new Error(nRes.error.message || 'Could not load notes.');
    profiles = {};
    (pRes.data || []).forEach(p => { profiles[p.id] = p; });

    mine = null;
    others = [];
    (nRes.data || []).forEach(n => {
      const author = n.author || profiles[n.author_id] ||
        { id: n.author_id, username: '', display_name: '', avatar_url: null };
      n.author = author;
      if (n.author_id === me) mine = n;
      else others.push({ note: n, author: author });
    });
    others.sort((a, b) => String(b.note.updated_at || b.note.created_at)
      .localeCompare(String(a.note.updated_at || a.note.created_at)));

    loaded = true;
    paintNotes();
    return true;
  } catch(e){
    loaded = true;
    mine = mine || null;
    others = [];
    paintNotes();
    return false;
  }
}

export function initNotes(){
  const row = el('notesRow');
  if (row && !row.dataset.wired){
    row.dataset.wired = '1';
    row.addEventListener('click', e => {
      const b = e.target && e.target.closest && e.target.closest('[data-note]');
      if (!b) return;
      if (b.getAttribute('data-note') === 'me') openNoteComposer();
      else {
        const uid = b.getAttribute('data-uid');
        if (uid && typeof window.openThread === 'function') window.openThread(uid);
      }
    });
  }
  wireDuration();
}

/* Durée de la note : 24 h par défaut, 7 j, 30 j, ou « forever ». */
function setNoteDuration(days){
  durDays = Math.max(0, parseInt(days, 10) || 0);
  const box = el('noteDur');
  if (box){
    box.querySelectorAll('.seg').forEach(b =>
      b.classList.toggle('active', parseInt(b.getAttribute('data-dur'), 10) === durDays));
  }
  return durDays;
}

function wireDuration(){
  const box = el('noteDur');
  if (!box || box.dataset.wired) return;
  box.dataset.wired = '1';
  box.addEventListener('click', e => {
    const b = e.target && e.target.closest && e.target.closest('[data-dur]');
    if (b) setNoteDuration(b.getAttribute('data-dur'));
  });
}

export function pickNoteMusic(){
  return openMusicPicker(t => setComposerMusic('note', t));
}

/* ----------------------------- composer ---------------------------- */
function showError(msg){
  const box = el('noteError');
  if (!box) return;
  box.textContent = msg || '';
  box.classList.toggle('hidden', !msg);
}

export function openNoteComposer(){
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to use notes.'); return false; }
  const body = el('noteBody');
  if (body) body.value = mine ? splitMusic(mine.body || '').text : '';
  showError('');
  const rm = el('noteRemove');
  if (rm) rm.classList.toggle('hidden', !(mine && mine.id));
  /* on restitue la durée et la musique déjà posées sur la note */
  if (mine && mine.id){
    const until = Date.parse(mine.expires_at || '');
    setNoteDuration(isNaN(until) ? 1 : Math.max(1, Math.round((until - Date.now()) / 86400000)));
    const prev = splitMusic(mine.body || '');
    setComposerMusic('note', prev.trackId ? { id: prev.trackId } : null);
  } else {
    setNoteDuration(1);
    clearComposerMusic('note');
  }
  if (typeof window.openModal === 'function') window.openModal('noteModal');
  if (body) setTimeout(() => { try { body.focus(); } catch(e){} }, 60);
  return true;
}

/* Le corps fait 60 caractères : on réserve la place du pion musical
   (avec extrait éventuel @s-e, ~17 car. au total). */
function packNote(text, track){
  const base = String(text || '');
  if (!track || !track.id) return base.slice(0, NOTE_MAX);
  const token = withMusic('', track.id, track);
  const room = Math.max(0, NOTE_MAX - token.length - 1);
  return withMusic(base.slice(0, room), track.id, track);
}

export async function submitNote(){
  if (busy) return false;
  const c = sb();
  const me = meId();
  if (!c || !me){ showError('Sign in to leave a note.'); return false; }
  const body = el('noteBody');
  const raw = ((body && body.value) || '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
  const track = getComposerMusic('note');
  const text = packNote(raw, track);
  if (!text){ showError('Write something first.'); return false; }

  const btn = el('noteSubmit');
  busy = true;
  if (btn){ btn.disabled = true; btn.textContent = 'Sharing…'; }
  showError('');
  try {
    const now = Date.now();
    const ttl = durDays > 0 ? durDays * 86400000 : FOREVER_MS;
    const { error } = await c.from('notes').upsert({
      author_id: me,
      body: text,
      created_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
      expires_at: new Date(now + ttl).toISOString()
    }, { onConflict: 'author_id' });
    if (error) throw new Error(error.message || 'Could not share your note.');
    loaded = false;
    if (typeof window.closeModal === 'function') window.closeModal('noteModal');
    await renderNotes();
    toast('Note shared.');
    return true;
  } catch(e){
    showError((e && e.message) || 'Could not share your note.');
    return false;
  } finally {
    busy = false;
    if (btn){ btn.disabled = false; btn.textContent = 'Share'; }
  }
}

export async function removeNote(){
  const c = sb();
  if (!c || !mine || !mine.id) return false;
  const btn = el('noteRemove');
  if (btn){ btn.disabled = true; btn.textContent = 'Removing…'; }
  try {
    const { error } = await c.from('notes').delete().eq('id', mine.id);
    if (error) throw new Error(error.message || 'Could not remove your note.');
    if (typeof window.closeModal === 'function') window.closeModal('noteModal');
    loaded = false;
    mine = null;
    await renderNotes();
    toast('Note removed.');
    return true;
  } catch(e){
    showError((e && e.message) || 'Could not remove your note.');
    return false;
  } finally {
    if (btn){ btn.disabled = false; btn.textContent = 'Remove'; }
  }
}

export function resetNotes(){
  loaded = false;
  mine = null;
  others = [];
  profiles = {};
  durDays = 1;
  clearComposerMusic('note');
  const row = el('notesRow');
  if (row){ row.innerHTML = ''; row.classList.add('hidden'); }
}
