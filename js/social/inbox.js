/* ==================================================================
   SOCIAL - messagerie privée (conversations 1:1)
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';
import { sb } from './client.js';
import { timeAgo } from './feed.js';

const CONV_SELECT = 'id,user_a,user_b,last_message_at,last_preview,last_sender_id';
const PROFILE_SELECT = 'id,username,display_name,avatar_url';
const MSG_SELECT = 'id,body,created_at,sender_id,read_at';
const MSG_LIMIT = 200;

let convos = [];
let peers = {};        /* conversation id -> profil */
let unread = {};       /* conversation id -> nb non lus */
let active = null;     /* conversation courante */
let activePeer = null;
let msgs = [];
let sending = false;

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function gateOk(){ return typeof window.socialAvailable === 'function' ? window.socialAvailable() : SOCIAL_ENABLED; }
function meId(){ return (window.socialUser || {}).id || null; }

function uuidKey(x){ return String(x || '').toLowerCase(); }
function pair(me, other){
  const a = uuidKey(me) < uuidKey(other) ? uuidKey(me) : uuidKey(other);
  const b = uuidKey(me) < uuidKey(other) ? uuidKey(other) : uuidKey(me);
  return { a: a, b: b };
}

function faceHtml(url, name){
  if (url) return '<img class="av-img" src="' + esc(url) + '" alt="">';
  return esc(String(name || '?').trim().charAt(0).toUpperCase() || '?');
}

function nameOf(p){ return (p && (p.display_name || p.username)) || 'Athlete'; }

/* ------------------------------ la boîte --------------------------- */
function paintInbox(){
  const list = el('inboxList');
  if (!list) return;
  if (!convos.length){
    list.innerHTML = '<div class="feed-empty">' +
      '<div class="feed-empty-ico">✉</div>' +
      '<div class="feed-empty-t">No messages yet</div>' +
      '<div class="feed-empty-s">Open a lifter’s profile and tap Message.</div>' +
      '<button type="button" class="btn btn-sm" onclick="setSView(\'search\')">Find people</button>' +
      '</div>';
    return;
  }
  list.innerHTML = convos.map(c => {
    const p = peers[c.id] || {};
    const n = unread[c.id] || 0;
    const last = c.last_preview ? esc(c.last_preview) : 'Say hi';
    return '<button type="button" class="dm" data-conv="' + esc(c.id) + '" ' +
      'data-peer="' + esc(otherOf(c)) + '">' +
      '<span class="avatar dm-av">' + faceHtml(p.avatar_url, nameOf(p)) + '</span>' +
      '<span class="dm-who">' +
        '<span class="dm-name">' + esc(nameOf(p)) + '</span>' +
        '<span class="dm-last">' + last + '</span>' +
      '</span>' +
      '<span class="dm-right">' +
        '<span class="dm-time">' + esc(timeAgo(c.last_message_at)) + '</span>' +
        (n ? '<span class="dm-badge">' + n + '</span>' : '') +
      '</span>' +
      '</button>';
  }).join('');
}

function otherOf(c){
  const me = meId();
  return uuidKey(c.user_a) === uuidKey(me) ? c.user_b : c.user_a;
}

export async function renderInbox(){
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to use messages.'); return false; }
  const c = sb();
  const me = meId();
  if (!c || !me) return false;

  const list = el('inboxList');
  if (list && !convos.length) list.innerHTML = '<div class="comment-empty">Loading…</div>';

  try {
    const { data: convs, error } = await c.from('conversations')
      .select(CONV_SELECT)
      .order('last_message_at', { ascending: false })
      .limit(60);
    if (error) throw new Error(error.message || 'Could not load messages.');
    convos = convs || [];

    peers = {};
    unread = {};
    if (convos.length){
      const ids = [...new Set(convos.map(otherOf))];
      const convIds = convos.map(x => x.id);
      const [profs, un] = await Promise.all([
        c.from('profiles').select(PROFILE_SELECT).in('id', ids),
        c.from('messages').select('conversation_id').is('read_at', null)
          .neq('sender_id', me).in('conversation_id', convIds)
      ]);
      (profs.data || []).forEach(p => { peers[p.id] = p; });
      (un.data || []).forEach(r => {
        unread[r.conversation_id] = (unread[r.conversation_id] || 0) + 1;
      });
      convos.forEach(c0 => {
        const p = peers[otherOf(c0)];
        if (p) peers[c0.id] = p;
      });
    }
    paintInbox();
    await refreshInboxBadge();
    if (typeof window.renderNotes === 'function') window.renderNotes();
    return true;
  } catch(e){
    if (list) list.innerHTML = '<div class="feed-empty">' +
      '<div class="feed-empty-ico err">!</div>' +
      '<div class="feed-empty-t">Could not load messages</div>' +
      '<button type="button" class="btn btn-sm btn-ghost" onclick="renderInbox()">Retry</button></div>';
    return false;
  }
}

export async function refreshInboxBadge(){
  const dot = el('inboxDot');
  if (!dot) return 0;
  const total = Object.keys(unread).reduce((s, k) => s + (unread[k] || 0), 0);
  dot.classList.toggle('hidden', !total);
  dot.textContent = total > 9 ? '9+' : (total ? String(total) : '');
  return total;
}

/* ------------------------------ le fil ----------------------------- */
function paintThread(){
  const box = el('threadList');
  if (!box) return;
  const me = meId();
  if (!msgs.length){
    box.innerHTML = '<div class="thread-empty">Say hi 👋</div>';
    return;
  }
  box.innerHTML = msgs.map((m, i) => {
    const mine = uuidKey(m.sender_id) === uuidKey(me);
    const sameAsPrev = i > 0 && uuidKey(msgs[i - 1].sender_id) === uuidKey(m.sender_id);
    return '<div class="bub-row' + (mine ? ' mine' : '') + (sameAsPrev ? ' cont' : '') + '">' +
      '<div class="bub">' + esc(m.body) + '</div>' +
      (sameAsPrev ? '' : '<div class="bub-t">' + esc(timeAgo(m.created_at)) + '</div>') +
      '</div>';
  }).join('');
  box.scrollTop = box.scrollHeight;
}

export async function loadThread(){
  if (!active) return false;
  const c = sb();
  const me = meId();
  if (!c || !me) return false;

  const { data, error } = await c.from('messages')
    .select(MSG_SELECT)
    .eq('conversation_id', active.id)
    .order('created_at', { ascending: true })
    .limit(MSG_LIMIT);
  if (error){ toast(error.message || 'Could not load this conversation.'); return false; }

  msgs = data || [];
  paintThread();

  const stale = msgs.some(m => uuidKey(m.sender_id) !== uuidKey(me) && !m.read_at);
  if (stale){
    const { error: re } = await c.rpc('mark_conversation_read', { p_conv: active.id });
    if (!re){ unread[active.id] = 0; refreshInboxBadge(); }
  }
  return true;
}

async function ensureConversation(peerId){
  const c = sb();
  const me = meId();
  const { a, b } = pair(me, peerId);

  const found = await c.from('conversations').select(CONV_SELECT)
    .eq('user_a', a).eq('user_b', b).limit(1);
  if (found.error) throw new Error(found.error.message || 'Could not open this conversation.');
  const foundRow = Array.isArray(found.data) ? found.data[0] : found.data;
  if (foundRow) return foundRow;

  const created = await c.from('conversations')
    .insert({ user_a: a, user_b: b }).select(CONV_SELECT).limit(1);
  const createdRow = Array.isArray(created.data) ? created.data[0] : created.data;
  if (created.error || !createdRow){
    const again = await c.from('conversations').select(CONV_SELECT)
      .eq('user_a', a).eq('user_b', b).limit(1);
    if (again.error) throw new Error(again.error.message || 'Could not open this conversation.');
    const againRow = Array.isArray(again.data) ? again.data[0] : again.data;
    if (againRow) return againRow;
    throw new Error((created.error && created.error.message) || 'Could not open this conversation.');
  }
  return createdRow;
}

export async function openThread(peerId){
  if (!peerId) return false;
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to use messages.'); return false; }
  if (uuidKey(peerId) === uuidKey(meId())){
    toast('You cannot message yourself.');
    return false;
  }

  const c = sb();
  if (!c) return false;

  const convo = await ensureConversation(peerId);
  if (!convo) return false;
  active = convo;
  msgs = [];

  if (!peers[peerId]){
    const { data } = await c.from('profiles').select(PROFILE_SELECT).eq('id', peerId).limit(1);
    if (data) peers[peerId] = Array.isArray(data) ? data[0] : data;
  }
  activePeer = peers[peerId] || { id: peerId, username: null, display_name: null, avatar_url: null };

  const av = el('threadAvatar');
  if (av) av.innerHTML = faceHtml(activePeer.avatar_url, nameOf(activePeer));
  const nm = el('threadName');
  if (nm) nm.textContent = nameOf(activePeer);
  const mt = el('threadMeta');
  if (mt) mt.textContent = activePeer.username ? '@' + activePeer.username : '';
  const body = el('threadBody');
  if (body){ body.value = ''; body.style.height = 'auto'; }
  const send = el('threadSend');
  if (send) send.disabled = true;

  if (typeof window.setSocialHead === 'function')
    window.setSocialHead('Messages', activePeer.username ? '@' + activePeer.username : '');

  const box = el('threadList');
  if (box) box.innerHTML = '<div class="thread-empty">Loading…</div>';
  if (typeof window.setSView === 'function') window.setSView('thread');

  await loadThread();
  if (typeof window.startThreadPoll === 'function') window.startThreadPoll();
  return true;
}

export function closeThread(){
  active = null;
  activePeer = null;
  msgs = [];
  if (typeof window.stopThreadPoll === 'function') window.stopThreadPoll();
  if (typeof window.setSView === 'function') window.setSView('inbox');
  else if (typeof window.renderInbox === 'function') window.renderInbox();
  return true;
}

export async function sendMessage(){
  if (sending || !active) return false;
  const ta = el('threadBody');
  const body = ((ta && ta.value) || '').replace(/\r\n/g, '\n').trim().slice(0, 4000);
  if (!body) return false;
  if (!gateOk()){ toast('Sign in and go online to send messages.'); return false; }
  const c = sb();
  const me = meId();
  if (!c || !me){ toast('Sign in to send messages.'); return false; }

  const btn = el('threadSend');
  sending = true;
  if (btn) btn.disabled = true;
  try {
    const { error } = await c.from('messages').insert({
      conversation_id: active.id,
      sender_id: me,
      body: body
    });
    if (error) throw new Error(error.message || 'Could not send your message.');
    if (ta){ ta.value = ''; ta.style.height = 'auto'; }
    await loadThread();
    return true;
  } catch(e){
    toast((e && e.message) || 'Could not send your message.');
    return false;
  } finally {
    sending = false;
    if (btn) btn.disabled = !((ta && ta.value) || '').trim();
  }
}

export function initInbox(){
  const list = el('inboxList');
  if (list && !list.dataset.wired){
    list.dataset.wired = '1';
    list.addEventListener('click', e => {
      const t = e.target && e.target.closest && e.target.closest('[data-peer]');
      if (t) openThread(t.getAttribute('data-peer'));
    });
  }
  if (typeof window.initNotes === 'function') window.initNotes();
}

export function resetInbox(){
  convos = [];
  peers = {};
  unread = {};
  active = null;
  activePeer = null;
  msgs = [];
  sending = false;
  const list = el('inboxList');
  if (list) list.innerHTML = '';
  const box = el('threadList');
  if (box) box.innerHTML = '';
  const dot = el('inboxDot');
  if (dot){ dot.classList.add('hidden'); dot.textContent = ''; }
  if (typeof window.resetNotes === 'function') window.resetNotes();
}
