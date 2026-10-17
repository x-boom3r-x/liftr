/* ==================================================================
   SOCIAL - Timeline : la grille d'exploration du clone.
   Reprend timeline_page.dart (SliverQuiltedGridDelegate 3 colonnes,
   carreaux média du plus récent au plus ancien, barre de recherche en
   lecture seule en tête qui mène à la recherche de personnes).
   Seuls les posts « photo » (image_path) deviennent des vignettes.
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';
import { sb } from './client.js';
import { getAllPosts, mediaUrl } from './feed.js';

let wired = false;

function el(id){ return document.getElementById(id); }
function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function gateOk(){ return typeof window.socialAvailable === 'function' ? window.socialAvailable() : SOCIAL_ENABLED; }

/* Le clone n'affiche que les blocs avec média → on garde les posts photo. */
function gridPosts(){
  return getAllPosts().filter(p => p && !p.deleted_at && p.image_path);
}

function emptyHtml(){
  return '<div class="feed-empty">' +
    '<div class="feed-empty-ico">▦</div>' +
    '<div class="feed-empty-t">Nothing to explore yet</div>' +
    '<div class="feed-empty-s">Photo posts from you and your crew show up here as a mosaic.</div>' +
  '</div>';
}

function tileHtml(p, i){
  const src = mediaUrl(p.image_path, sb());
  if (!src) return '';
  const a = p.author || {};
  const name = a.display_name || a.username || '';
  const wide = i % 5 === 2;   /* carreau double largeur → mosaïque */
  return '<button type="button" class="tl-tile' + (wide ? ' wide' : '') + '" ' +
    'data-act="open" data-post="' + esc(p.id) + '" aria-label="Open post by ' + esc(name) + '">' +
    '<img src="' + esc(src) + '" alt="" loading="lazy">' +
  '</button>';
}

export function renderTimeline(){
  const box = el('timelineList');
  if (!box) return false;
  if (!gateOk()){
    box.innerHTML = '<div class="feed-empty"><div class="feed-empty-t">Sign in and go online to explore.</div></div>';
    return false;
  }
  const posts = gridPosts();
  if (!posts.length){ box.innerHTML = emptyHtml(); return false; }
  box.innerHTML = '<div class="tl-grid">' + posts.map(tileHtml).join('') + '</div>';
  return true;
}

function postOf(id){ return getAllPosts().find(x => x && x.id === id) || null; }

function wire(){
  const box = el('timelineList');
  if (!box || wired) return;
  wired = true;
  box.addEventListener('click', e => {
    const btn = e.target && e.target.closest && e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.getAttribute('data-post') || '';
    if (btn.getAttribute('data-act') === 'open' &&
        typeof window.openComments === 'function'){
      window.openComments(id, postOf(id) || null);
    }
  });
}

export function openTimeline(){
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to explore.'); return false; }
  wire();
  renderTimeline();
  return true;
}

export function initTimeline(){ wire(); }

export function resetTimeline(){
  const box = el('timelineList');
  if (box) box.innerHTML = '';
}
