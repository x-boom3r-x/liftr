/* ==================================================================
   SOCIAL - commentaires sous un post
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';
import { sb } from './client.js';
import { timeAgo } from './feed.js';

const MAX_BODY = 1000;
const CMT_SELECT = 'id,body,created_at,post_id,author:profiles(username,display_name,avatar_url)';

let postId = null;
let rows = [];
let sending = false;

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function gateOk(){ return typeof window.socialAvailable === 'function' ? window.socialAvailable() : SOCIAL_ENABLED; }

function countLabel(n){ return n + (n === 1 ? ' comment' : ' comments'); }

function commentHtml(r){
  const a = r.author || {};
  const name = a.display_name || a.username || 'Athlete';
  const avatar = a.avatar_url
    ? '<img class="post-avatar-img" src="' + esc(a.avatar_url) + '" alt="">'
    : esc(String(name).trim().charAt(0).toUpperCase() || '?');
  return '<div class="comment">' +
    '<div class="avatar comment-avatar">' + avatar + '</div>' +
    '<div class="comment-main">' +
      '<div class="comment-head">' +
        '<span class="comment-name">' + esc(name) + '</span>' +
        '<span class="comment-time">' + esc(timeAgo(r.created_at)) + '</span>' +
      '</div>' +
      '<div class="comment-body">' + esc(r.body) + '</div>' +
    '</div>' +
    '</div>';
}

function render(){
  const list = el('commentList');
  if (!list) return;
  list.innerHTML = rows.length ? rows.map(commentHtml).join('')
    : '<div class="comment-empty">No comments yet — be the first.</div>';
  const sub = el('commentsSub');
  if (sub) sub.textContent = rows.length ? countLabel(rows.length) : 'Join the conversation.';
}

function clearBody(){
  const ta = el('commentBody');
  if (ta) ta.value = '';
  updateCommentComposer();
}

export function updateCommentComposer(){
  const ta = el('commentBody');
  const btn = el('commentSubmit');
  const has = !!((ta && ta.value) || '').trim();
  if (btn) btn.disabled = sending || !has;
}

async function load(){
  const c = sb();
  if (!c || !postId) return false;
  const list = el('commentList');
  if (list && !rows.length) list.innerHTML = '<div class="comment-empty">Loading…</div>';

  const { data, error } = await c.from('comments')
    .select(CMT_SELECT)
    .eq('post_id', postId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });

  if (error){
    if (list) list.innerHTML = '<div class="comment-empty">Could not load comments.</div>';
    return false;
  }
  rows = data || [];
  render();
  return true;
}

export async function openComments(id){
  if (!id) return false;
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to comment.'); return false; }

  postId = id;
  rows = [];
  clearBody();
  render();
  if (typeof window.openModal === 'function') window.openModal('commentsModal');
  return await load();
}

export function closeComments(){
  if (typeof window.closeModal === 'function') window.closeModal('commentsModal');
  return true;
}

export async function submitComment(){
  const ta = el('commentBody');
  const body = (((ta && ta.value) || '').replace(/\r\n/g, '\n').trim()).slice(0, MAX_BODY);
  if (!body || sending || !postId) return false;
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to comment.'); return false; }

  const c = sb();
  const user = window.socialUser || {};
  if (!c || !user.id){ toast('Sign in to comment.'); return false; }

  const btn = el('commentSubmit');
  sending = true;
  if (btn){ btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const { data, error } = await c.from('comments')
      .insert({ author_id: user.id, post_id: postId, body: body })
      .select(CMT_SELECT);
    if (error) throw new Error(error.message || 'Could not post your comment.');

    const row = Array.isArray(data) ? data[0] : data;
    if (row) rows = rows.concat([row]);
    clearBody();
    render();
    if (typeof window.refreshCounts === 'function') window.refreshCounts();
    return true;
  } catch(e){
    toast((e && e.message) || 'Could not post your comment.');
    return false;
  } finally {
    sending = false;
    if (btn){ btn.textContent = 'Send'; updateCommentComposer(); }
  }
}

export function initComments(){
  const ta = el('commentBody');
  if (ta && !ta.dataset.wired){
    ta.dataset.wired = '1';
    ta.addEventListener('input', updateCommentComposer);
  }
}

export function resetComments(){
  postId = null;
  rows = [];
  sending = false;
  const list = el('commentList');
  if (list) list.innerHTML = '';
  const ta = el('commentBody');
  if (ta) ta.value = '';
  const sub = el('commentsSub');
  if (sub) sub.textContent = 'Join the conversation.';
  updateCommentComposer();
}
