/* ==================================================================
   SOCIAL - commentaires sous un post (L5 : fils, repli, on/off)
   - la liste est repliée par défaut (bouton « View N comments ») ;
   - chaque commentaire a un bouton Reply : le fil s'indente (3 niveaux
     max, au-delà tout reste à 48px) via parent_id / root_id ;
   - comments_enabled === false : note visible pour TOUT le monde,
     composeur masqué ; le propriétaire rouvre via le menu du post.
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';
import { sb, withMissingColumn, withMissingFields } from './client.js';
import { timeAgo, mediaUrl } from './feed.js';
import { storyRingClass } from './rings.js';

const MAX_BODY = 1000;
const CMT_SELECT = 'id,body,created_at,post_id,author_id,parent_id,root_id,author:profiles!comments_author_id_fkey(username,display_name,avatar_url)';

let postId = null;
let rows = [];
let sending = false;
let postCur = null;     /* post affiché — porte comments_enabled */
let expanded = false;   /* liste dépliée */
let replyTo = null;     /* commentaire auquel on répond */
let pendingSeq = 0;     /* id local des commentaires en attente (optimiste) */

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function gateOk(){ return typeof window.socialAvailable === 'function' ? window.socialAvailable() : SOCIAL_ENABLED; }

function countLabel(n){ return n + (n === 1 ? ' comment' : ' comments'); }
function commentsOff(){ return !!(postCur && postCur.comments_enabled === false); }

function commentHtml(r, depth){
  const a = r.author || {};
  const name = a.display_name || a.username || 'Athlete';
  const avatar = a.avatar_url
    ? '<img class="post-avatar-img" src="' + esc(a.avatar_url) + '" alt="">'
    : esc(String(name).trim().charAt(0).toUpperCase() || '?');
  const cd = Math.min(depth, 3) * 16;
  /* ligne optimiste (en attente du serveur) : atténuée, sans Reply */
  return '<div class="comment' + (r.pending ? ' comment-pending' : '') + '" style="--cd:' + cd + 'px">' +
    '<button type="button" class="avatar comment-avatar' + storyRingClass(r.author_id) +
      '" data-act="profile" data-uid="' + esc(r.author_id || '') + '" ' +
      'aria-label="Open profile">' + avatar + '</button>' +
    '<div class="comment-main">' +
      '<div class="comment-head">' +
        '<button type="button" class="comment-name" data-act="profile" ' +
          'data-uid="' + esc(r.author_id || '') + '" aria-label="Open profile">' + esc(name) + '</button>' +
        '<span class="comment-time">' + esc(timeAgo(r.created_at)) + '</span>' +
      '</div>' +
      '<div class="comment-body">' + esc(r.body) + '</div>' +
      (r.pending ? '' :
        '<button type="button" class="comment-reply" data-reply="' + esc(r.id || '') + '">Reply</button>') +
    '</div>' +
    '</div>';
}

/* Arbre : racines = sans parent_id (ou parent introuvable), enfants
   rangés par parent_id, profondeur limitée visuellement à 3. */
function render(){
  const list = el('commentList');
  if (list){
    if (!rows.length){
      list.innerHTML = '<div class="comment-empty">No comments yet — be the first.</div>';
    } else {
      const byParent = {};
      const ids = new Set();
      rows.forEach(r => ids.add(r.id));
      const roots = [];
      rows.forEach(r => {
        const pid = r.parent_id || null;
        if (pid && pid !== r.id && ids.has(pid)){
          (byParent[pid] = byParent[pid] || []).push(r);
        } else {
          roots.push(r);
        }
      });
      const out = [];
      const walk = (listR, depth) => {
        listR.forEach(r => {
          out.push(commentHtml(r, depth));
          const kids = byParent[r.id];
          if (kids && kids.length) walk(kids, depth + 1);
        });
      };
      walk(roots, 0);
      list.innerHTML = out.join('');
    }
  }
  const sub = el('commentsSub');
  if (sub) sub.textContent = rows.length ? countLabel(rows.length) : 'Join the conversation.';
  paint();
}

/* États visuels : off / repli / dépli / chip de réponse. */
function setChip(show, handle){
  const chip = el('replyChip');
  if (!chip) return;
  chip.classList.toggle('hidden', !show);
  if (show){
    const txt = el('replyChipText');
    if (txt) txt.textContent = 'Replying to @' + (handle || '');
  }
}

function paint(){
  const off = commentsOff();
  const offBox = el('commentsOff');
  if (offBox) offBox.classList.toggle('hidden', !off);
  const compose = el('commentCompose');
  if (compose) compose.classList.toggle('hidden', off);
  const toggle = el('commentsToggle');
  const list = el('commentList');
  const n = rows.length;
  if (off){
    replyTo = null;
    setChip(false);
    if (toggle) toggle.classList.add('hidden');
    if (list) list.classList.add('hidden');
    return;
  }
  /* n=0 : pas de repli possible, la note reste visible via (expanded || !n)
     — on ne touche PAS à `expanded` (la 1re passe est vide avant load()). */
  if (toggle){
    toggle.classList.toggle('hidden', !n);
    if (n){
      toggle.textContent = expanded ? 'Hide comments' : 'View ' + countLabel(n);
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
  }
  if (list) list.classList.toggle('hidden', !(expanded || !n));
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

  /* appel sans objet post : on récupère au moins les drapeaux */
  if (!postCur){
    const fr = await withMissingColumn(
      cc => c.from('posts').select(cc).eq('id', postId).limit(1),
      'id,author_id,comments_enabled'
    );
    const row = Array.isArray(fr.data) ? fr.data[0] : fr.data;
    if (row) postCur = Object.assign({ id: postId }, row);
  }

  const res = await withMissingColumn(
    cc => c.from('comments').select(cc)
      .eq('post_id', postId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true }),
    CMT_SELECT
  );
  if (res.error){
    if (list) list.innerHTML = '<div class="comment-empty">Could not load comments.</div>';
    return false;
  }
  rows = res.data || [];
  render();
  return true;
}

function renderPost(post){
  const box = el('commentsPost');
  if (!box) return;
  if (!post){ box.innerHTML = ''; box.classList.add('hidden'); return; }
  const a = post.author || {};
  const name = a.display_name || a.username || 'Athlete';
  const avatar = a.avatar_url
    ? '<img class="post-avatar-img" src="' + esc(a.avatar_url) + '" alt="">'
    : esc(String(name).trim().charAt(0).toUpperCase() || '?');
  /* le post doit SE VOIR au-dessus des commentaires : corps + photo */
  const img = post.image_path && mediaUrl(post.image_path, sb())
    ? '<img class="cpost-img" src="' + esc(mediaUrl(post.image_path, sb())) + '" alt="">' : '';
  box.innerHTML =
    '<div class="cpost-head">' +
      '<button type="button" class="avatar post-avatar ring' + storyRingClass(a.id || post.author_id) +
        ' fallback" data-act="profile" data-uid="' + esc(a.id || post.author_id || '') + '" ' +
        'aria-label="Open profile">' + avatar + '</button>' +
      '<div class="post-who"><div class="post-name">' + esc(name) + '</div>' +
        (a.username ? '<div class="post-meta"><span class="post-handle">@' + esc(a.username) + '</span></div>' : '') +
      '</div>' +
    '</div>' +
    (post.body ? '<div class="post-body">' + esc(post.body) + '</div>' : '') +
    img;
  box.classList.remove('hidden');
}

export async function openComments(id, post){
  if (!id) return false;
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to comment.'); return false; }

  postId = id;
  rows = [];
  sending = false;
  expanded = false;
  replyTo = null;
  postCur = post || null;
  clearBody();
  setChip(false);
  renderPost(post || null);
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
  if (commentsOff()){ toast('Comments are turned off.'); return false; }
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to comment.'); return false; }

  const c = sb();
  const user = window.socialUser || {};
  if (!c || !user.id){ toast('Sign in to comment.'); return false; }

  /* --------- insertion optimiste : la ligne apparaît tout de suite ---- */
  const btn = el('commentSubmit');
  const savedReply = replyTo;
  const tmpId = 'pending-' + (++pendingSeq) + '-' + Date.now();
  const um = user.user_metadata || {};
  const dname = um.display_name || um.name ||
    (user.email ? String(user.email).split('@')[0] : '') || 'You';
  const optimistic = {
    id: tmpId,
    body: body,
    created_at: new Date().toISOString(),
    post_id: postId,
    author_id: user.id,
    parent_id: (savedReply && savedReply.id) ? savedReply.id : null,
    root_id: (savedReply && (savedReply.root_id || savedReply.id)) || null,
    pending: true,
    author: { username: um.username || null, display_name: dname, avatar_url: null }
  };

  sending = true;
  if (btn){ btn.disabled = true; btn.textContent = 'Sending…'; }
  rows = rows.concat([optimistic]);
  expanded = true;                    /* la nouvelle réponse se voit */
  replyTo = null;
  setChip(false);
  clearBody();
  render();

  try {
    /* parent_id / root_id n'existent pas avant v8 : withMissingFields
       les retire du payload (la réponse retombe en racine) et du select. */
    const payload = { author_id: user.id, post_id: postId, body: body };
    if (savedReply && savedReply.id){
      payload.parent_id = savedReply.id;
      payload.root_id = savedReply.root_id || savedReply.id;
    }
    const res = await withMissingFields(
      (p, cols) => c.from('comments').insert(p).select(cols),
      payload, CMT_SELECT
    );
    if (res.error) throw new Error(res.error.message || 'Could not post your comment.');

    /* la ligne serveur (vrai id, avatar, horodatage) remplace la locale */
    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    rows = row
      ? rows.map(r => (r.id === tmpId ? row : r))
      : rows.filter(r => r.id !== tmpId);
    render();
    if (typeof window.refreshCounts === 'function') window.refreshCounts();
    return true;
  } catch(e){
    /* rollback : on retire la ligne et on rend le brouillon + la cible */
    rows = rows.filter(r => r.id !== tmpId);
    replyTo = savedReply || null;
    if (savedReply){
      const a = savedReply.author || {};
      setChip(true, a.username || a.display_name || 'Athlete');
    }
    const box = el('commentBody');
    if (box) box.value = body;
    updateCommentComposer();
    render();
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
  const closeBtn = el('commentsCloseBtn');
  if (closeBtn && !closeBtn.dataset.wired){
    closeBtn.dataset.wired = '1';
    closeBtn.addEventListener('click', () => closeComments());
  }
  const toggle = el('commentsToggle');
  if (toggle && !toggle.dataset.wired){
    toggle.dataset.wired = '1';
    toggle.addEventListener('click', () => {
      expanded = !expanded;
      paint();
    });
  }
  const chipX = el('replyChipX');
  if (chipX && !chipX.dataset.wired){
    chipX.dataset.wired = '1';
    chipX.addEventListener('click', () => {
      replyTo = null;
      setChip(false);
      const box = el('commentBody');
      if (box) box.focus();
    });
  }
  /* avatars et noms : profil ; bouton Reply : fil de réponse */
  [['commentList'], ['commentsPost']].forEach(pair => {
    const box = el(pair[0]);
    if (!box || box.dataset.profWired) return;
    box.dataset.profWired = '1';
    box.addEventListener('click', e => {
      const t = e.target && e.target.closest ? e.target : null;
      if (!t) return;
      const rp = t.closest('[data-reply]');
      if (rp && box.id === 'commentList'){
        const row = rows.find(r => r.id === rp.getAttribute('data-reply'));
        if (row){
          const a = row.author || {};
          replyTo = row;
          setChip(true, a.username || a.display_name || 'Athlete');
          expanded = true;
          paint();
          const input = el('commentBody');
          if (input) input.focus();
        }
        return;
      }
      const prof = t.closest('[data-act="profile"][data-uid]');
      if (!prof) return;
      const uid = prof.getAttribute('data-uid');
      if (!uid) return;
      closeComments();
      if (typeof window.openProfile === 'function') window.openProfile(uid);
    });
  });
}

export function resetComments(){
  postId = null;
  rows = [];
  sending = false;
  postCur = null;
  expanded = false;
  replyTo = null;
  const list = el('commentList');
  if (list){ list.innerHTML = ''; list.classList.remove('hidden'); }
  const ta = el('commentBody');
  if (ta) ta.value = '';
  const sub = el('commentsSub');
  if (sub) sub.textContent = 'Join the conversation.';
  const offBox = el('commentsOff');
  if (offBox) offBox.classList.add('hidden');
  const toggle = el('commentsToggle');
  if (toggle) toggle.classList.add('hidden');
  const compose = el('commentCompose');
  if (compose) compose.classList.remove('hidden');
  setChip(false);
  renderPost(null);
  updateCommentComposer();
}
