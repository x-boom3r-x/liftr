/* ==================================================================
   SOCIAL - recherche d'utilisateurs (type Instagram)
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';
import { sb, withMissingColumn } from './client.js';
import { personRowHtml, mergeLinkRows } from './people.js';

const LIMIT = 30;
const SELECT = 'id,username,display_name,avatar_url,bio';

let rows = [];
let query = '';

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function gateOk(){ return typeof window.socialAvailable === 'function' ? window.socialAvailable() : SOCIAL_ENABLED; }
function meId(){ return (window.socialUser || {}).id || null; }

function sanitize(q){
  return String(q || '').replace(/[,()\\%'"*]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function renderSearch(){
  const list = el('searchList');
  if (!list) return;
  if (!rows.length){
    list.innerHTML = query
      ? '<div class="comment-empty">No lifter matches “' + esc(query) + '”.</div>'
      : '<div class="comment-empty">Search for a lifter by name or @username.</div>';
    return;
  }
  list.innerHTML = rows.map(personRowHtml).join('');
}

async function fetchRows(){
  const c = sb();
  const me = meId();
  if (!c || !me) return { error: 'Not signed in.' };

  let q = c.from('profiles').select(SELECT).neq('id', me);
  const term = sanitize(query);
  if (term) q = q.or('username.ilike.%' + term + '%,display_name.ilike.%' + term + '%');

  const { data, error } = await q
    .order('created_at', { ascending: false })
    .limit(LIMIT);
  if (error) return { error: error.message || 'Search failed.' };
  return { rows: data || [] };
}

async function hydrate(){
  const c = sb();
  const me = meId();
  if (!c || !me) return;
  const fr = await withMissingColumn(
    cc => c.from('follows').select(cc).eq('follower_id', me),
    'followee_id,state');
  /* suivis + demandes : le bouton de la ligne reflète les deux */
  mergeLinkRows(fr.data || []);
}

export async function openSearch(){
  if (!SOCIAL_ENABLED){ toast('Social is not configured yet.'); return false; }
  if (!gateOk()){ toast('Sign in and go online to search.'); return false; }

  const list = el('searchList');
  if (list && !rows.length) list.innerHTML = '<div class="comment-empty">Loading…</div>';
  const input = el('searchInput');
  if (input) setTimeout(() => { try { input.focus(); } catch(e){} }, 60);

  const res = await fetchRows();
  if (res.error){
    if (list) list.innerHTML = '<div class="comment-empty">Could not search right now.</div>';
    return false;
  }
  rows = res.rows;
  await hydrate();
  renderSearch();
  return true;
}

export async function runSearch(q){
  if (!SOCIAL_ENABLED) return false;
  if (!gateOk()) return false;
  query = String(q || '').trim();
  const list = el('searchList');
  if (!list) return false;
  if (!query){ rows = []; return openSearch(); }

  list.innerHTML = '<div class="comment-empty">Searching…</div>';
  const res = await fetchRows();
  if (res.error){ list.innerHTML = '<div class="comment-empty">Could not search right now.</div>'; return false; }
  rows = res.rows;
  await hydrate();
  renderSearch();
  return true;
}

export function clearSearch(){
  const input = el('searchInput');
  if (input) input.value = '';
  const clear = el('searchClear');
  if (clear) clear.classList.add('hidden');
  query = '';
  return openSearch();
}

export function resetSearch(){
  rows = [];
  query = '';
  const list = el('searchList');
  if (list) list.innerHTML = '';
}
