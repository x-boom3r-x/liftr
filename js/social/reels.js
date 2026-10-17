/* ==================================================================
   SOCIAL - Reels : feed vertical plein écran (images + audio)
   Fidèle au clone de référence (Flutter) mais en images :
   - 1 media par écran, scroll-snap vertical ;
   - rail d'actions à droite : like (+compteur), comments (+compteur),
     share, ⋯ (delete, propriétaire seul), vignette auteur en bas ;
   - bas-gauche : auteur + bouton Follow, caption, marquee audio ;
   - tap sur le media = like + burst ; pull-to-refresh = re-render.
   Réutilise les posts « photo » du fil (image_path) et les compteurs.
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';
import { sb } from './client.js';
import {
  getPostsForReels, getPostCounts, mediaUrl, timeAgo,
  toggleLike, sharePost, openPostMenu, deletePost
} from './feed.js';
import { isFollowed } from './people.js';
import { musicChipForBody } from './music.js';
import { storyRingClass } from './rings.js';
import { icon, iconS } from '../icons.js';

let list = [];        /* posts reel courants */
let wired = false;
let observer = null;

function el(id){ return document.getElementById(id); }
function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function gateOk(){ return typeof window.socialAvailable === 'function' ? window.socialAvailable() : SOCIAL_ENABLED; }
function meId(){ return (window.socialUser || {}).id || null; }

/* Cœur qui grossit puis disparaît (tap = like). */
function burst(zone){
  try {
    const b = document.createElement('span');
    b.className = 'reel-burst';
    b.setAttribute('aria-hidden', 'true');
    b.innerHTML = iconS('heart');
    zone.appendChild(b);
    setTimeout(() => { if (b.parentNode) b.parentNode.removeChild(b); }, 900);
  } catch(e){}
}

function reelHtml(p){
  const c = sb();
  const a = p.author || {};
  const uid = a.id || p.author_id || '';
  const name = a.display_name || a.username || 'Athlete';
  const isMe = !!(meId() && uid === meId());
  const followed = isFollowed(uid);
  const k = getPostCounts(p.id);

  const avatar = a.avatar_url
    ? '<img class="post-avatar-img" src="' + esc(a.avatar_url) + '" alt="">'
    : esc(String(name).trim().charAt(0).toUpperCase() || '?');

  const full = mediaUrl(p.image_path, c);
  const media = full
    ? '<img class="reel-img" src="' + esc(full) + '" alt="' + esc(name) + '" loading="lazy">' : '';

  /* audio : chip musique du corps du post (marquee) ; caption = le reste */
  const parts = musicChipForBody(p.body || '');
  const caption = parts.text ? '<div class="reel-caption">' + esc(parts.text) + '</div>' : '';
  const audio = parts.html
    ? '<div class="reel-audio">' + parts.html + '</div>'
    : '<div class="reel-audio"><span class="mchip">' + iconS('volume') + '<span class="mchip-run">' + esc(name) + ' · original audio</span></span></div>';

  const follow = isMe ? '' :
    '<button type="button" class="reel-follow' + (followed ? ' on' : '') + '" data-act="follow" ' +
    'data-uid="' + esc(uid) + '" data-post="' + esc(p.id) + '">' + (followed ? 'Following' : 'Follow') + '</button>';

  const meta = '<div class="reel-meta">' +
    '<div class="reel-row">' +
      '<button type="button" class="reel-who" data-act="profile" data-uid="' + esc(uid) + '" ' +
        'data-post="' + esc(p.id) + '" aria-label="Open profile">' +
        '<span class="avatar reel-avatar ring' + storyRingClass(uid) + (a.avatar_url ? '' : ' fallback') + '">' + avatar + '</span>' +
        '<span class="reel-name">' + esc(a.username || name) + '</span>' +
      '</button>' + follow +
    '</div>' + caption + audio +
  '</div>';

  const rail = '<div class="reel-rail">' +
    '<button type="button" class="reel-act reel-like' + (k.liked ? ' on' : '') + '" data-act="like" ' +
      'data-post="' + esc(p.id) + '" aria-label="Like" aria-pressed="' + (k.liked ? 'true' : 'false') + '">' +
      '<span class="reel-ico">' + iconS('heart') + '</span>' +
      '<span class="reel-n" data-n="likes">' + (k.l || 0) + '</span></button>' +
    '<button type="button" class="reel-act reel-comment" data-act="comment" data-post="' + esc(p.id) + '" ' +
      'aria-label="Comments">' +
      '<span class="reel-ico">' + icon('chat') + '</span>' +
      '<span class="reel-n" data-n="comments">' + (k.c || 0) + '</span></button>' +
    '<button type="button" class="reel-act reel-share" data-act="share" data-post="' + esc(p.id) + '" ' +
      'aria-label="Share">' +
      '<span class="reel-ico">' + icon('share') + '</span></button>' +
    (isMe
      ? '<button type="button" class="reel-act reel-more" data-act="menu" data-post="' + esc(p.id) + '" ' +
        'aria-label="More options"><span class="reel-ico" aria-hidden="true">&#8942;</span></button>'
      : '') +
    '<span class="reel-author-thumb" data-act="profile" data-uid="' + esc(uid) + '" ' +
      'data-post="' + esc(p.id) + '" role="button" aria-label="Open profile">' + avatar + '</span>' +
  '</div>';

  return '<article class="reel" data-reel="' + esc(p.id) + '" data-post="' + esc(p.id) + '">' +
    '<div class="reel-media" data-act="likezone" data-post="' + esc(p.id) + '">' + media + '</div>' +
    '<div class="reel-scrim" aria-hidden="true"></div>' + meta + rail +
  '</article>';
}

function emptyHtml(){
  return '<div class="feed-empty reel-empty">' +
    '<div class="feed-empty-ico">▶</div>' +
    '<div class="feed-empty-t">No reels yet</div>' +
    '<div class="feed-empty-s">Share a photo post and it will show up here as a reel.</div>' +
    '<button type="button" class="btn btn-sm" onclick="renderReels()">Refresh</button>' +
  '</div>';
}

export function renderReels(){
  const box = el('reelsList');
  if (!box) return false;
  if (!gateOk()){
    box.innerHTML = '<div class="feed-empty"><div class="feed-empty-t">Sign in and go online to watch Reels.</div></div>';
    return false;
  }
  list = getPostsForReels();
  if (!list.length){
    box.innerHTML = emptyHtml();
    return false;
  }
  box.innerHTML = list.map(reelHtml).join('');
  watchActive();
  return true;
}

/* Suivi de l'item visible : marque .active (utile pour tests + lazy). */
function watchActive(){
  const box = el('reelsList');
  if (!box) return;
  try { if (observer) observer.disconnect(); } catch(e){}
  const items = box.querySelectorAll('.reel');
  if (!items.length) return;
  items[0].classList.add('active');
  if (typeof IntersectionObserver === 'undefined') return;
  observer = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting && en.intersectionRatio > 0.6){
        items.forEach(i => i.classList.remove('active'));
        en.target.classList.add('active');
      }
    });
  }, { root: box, threshold: [0.6] });
  items.forEach(i => observer.observe(i));
}

/* Maj d'un bouton like + compteur sur un reel (sans repaint le fil). */
function paintReelLike(id){
  const k = getPostCounts(id);
  document.querySelectorAll('#reelsList .reel-like[data-post="' + id + '"]').forEach(btn => {
    btn.classList.toggle('on', !!k.liked);
    btn.setAttribute('aria-pressed', k.liked ? 'true' : 'false');
    const n = btn.querySelector('[data-n="likes"]');
    if (n) n.textContent = k.l || 0;
  });
}

function paintReelComments(id){
  const k = getPostCounts(id);
  document.querySelectorAll('#reelsList .reel-comment[data-post="' + id + '"]').forEach(btn => {
    const n = btn.querySelector('[data-n="comments"]');
    if (n) n.textContent = k.c || 0;
  });
}

function postOf(id){ return list.find(x => x && x.id === id) || null; }

function onLike(id, zone){
  const before = !!(getPostCounts(id) || {}).liked;
  const fire = () => {
    const now = !!(getPostCounts(id) || {}).liked;
    paintReelLike(id);
    if (zone && now && !before) burst(zone);
  };
  try {
    const r = toggleLike(id);
    if (r && typeof r.then === 'function') r.then(fire, fire);
    else fire();
  } catch(e){ fire(); }
}

function onFollow(uid, btn){
  if (!uid) return;
  const done = () => {
    const f = isFollowed(uid);
    if (btn){
      btn.classList.toggle('on', f);
      btn.textContent = f ? 'Following' : 'Follow';
    }
    /* même auteur sur d'autres reels : cohérence */
    document.querySelectorAll('#reelsList .reel-follow[data-uid="' + uid + '"]').forEach(b => {
      b.classList.toggle('on', f);
      b.textContent = f ? 'Following' : 'Follow';
    });
  };
  try {
    const r = typeof window.toggleFollow === 'function' ? window.toggleFollow(uid) : null;
    if (r && typeof r.then === 'function') r.then(done, done);
    else done();
  } catch(e){ done(); }
}

function wire(){
  const box = el('reelsList');
  if (!box || wired) return;
  wired = true;
  box.addEventListener('click', e => {
    const btn = e.target && e.target.closest && e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');
    const id = btn.getAttribute('data-post') || '';
    const p = postOf(id);
    if (act === 'likezone' || act === 'like'){
      onLike(id, act === 'likezone' ? btn : null);
    } else if (act === 'comment'){
      if (typeof window.openComments === 'function') window.openComments(id, p || null);
    } else if (act === 'share'){
      sharePost(id);
    } else if (act === 'menu'){
      openPostMenu(id);
    } else if (act === 'follow'){
      onFollow(btn.getAttribute('data-uid'), btn);
    } else if (act === 'profile'){
      const uid = btn.getAttribute('data-uid');
      if (uid && typeof window.openProfile === 'function') window.openProfile(uid);
    }
  });
}

export function openReels(){
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to watch Reels.'); return false; }
  /* les posts du fil alimentent les reels : on s'assure qu'ils sont là */
  if (!getPostsForReels().length && typeof window.openFeed === 'function'){
    try { window.openFeed(); } catch(e){}
  }
  wire();
  renderReels();
  const box = el('reelsList');
  if (box) box.scrollTop = 0;
  return true;
}

export function initReels(){ wire(); }

export function resetReels(){
  list = [];
  const box = el('reelsList');
  if (box) box.innerHTML = '';
  try { if (observer) observer.disconnect(); } catch(e){}
  observer = null;
}
