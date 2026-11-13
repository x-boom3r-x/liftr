import { sb } from './client.js';
import { SOCIAL_ENABLED } from './config.js';

let groups = [];
let selected = null;
let busy = false;
const $ = id => document.getElementById(id);
function me(){ return (window.socialUser || {}).id || null; }
function esc(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function toast(s){ if (window.toast) window.toast(s); }
function code(){
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, n => chars[n % chars.length]).join('');
}
function ensure(){
  if ($('liftrGroups')) return;
  const overlay = document.createElement('div');
  overlay.id = 'liftrGroups';
  overlay.className = 'overlay';
  overlay.setAttribute('aria-hidden','true');
  overlay.innerHTML = '<div class="modal social-groups-modal" role="dialog" aria-modal="true" aria-labelledby="groupsTitle"><div class="grabber"></div><div class="modal-top"><div><div class="modal-title" id="groupsTitle">Groupes et défis privés</div><div class="modal-sub">Petits cercles, invitation par code, progression partagée.</div></div><button class="modal-x" type="button" onclick="closeSocialGroups()" aria-label="Fermer">×</button></div><div id="groupsContent"><div class="comment-empty">Chargement…</div></div></div>';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeSocialGroups(); });
  document.body.appendChild(overlay);
}
function formHtml(){
  return '<div class="group-join"><input class="input" id="groupInviteCode" maxlength="12" placeholder="Code d’invitation"><button class="btn btn-sm" onclick="joinSocialGroup()">Rejoindre</button></div>' +
    '<details class="group-create"><summary>Créer un groupe ou un défi privé</summary><div class="group-create-fields">' +
    '<input class="input" id="groupName" maxlength="80" placeholder="Nom du groupe" required>' +
    '<textarea class="input" id="groupDescription" maxlength="240" rows="2" placeholder="Description (facultative)"></textarea>' +
    '<label class="group-field"><span>Format</span><select class="input" id="groupMode"><option value="group">Groupe privé</option><option value="challenge">Défi privé</option></select></label>' +
    '<div class="group-challenge-fields"><input class="input" id="groupTarget" type="number" min="0" max="100000" value="12" aria-label="Objectif"><input class="input" id="groupUnit" maxlength="20" value="séances" aria-label="Unité"><input class="input" id="groupEnd" type="date" aria-label="Date de fin"></div>' +
    '<button class="btn btn-primary btn-sm" onclick="createSocialGroup()">Créer et obtenir un code</button></div></details>';
}
function renderGroupCard(g){
  return '<button class="social-group-card' + (selected === g.id ? ' active' : '') + '" type="button" onclick="selectSocialGroup(' + JSON.stringify(g.id).replace(/"/g,'&quot;') + ')">' +
    '<span class="social-group-mark" aria-hidden="true">' + (g.mode === 'challenge' ? 'D' : 'G') + '</span><span><b>' + esc(g.name) + '</b><small>' + (g.mode === 'challenge' ? 'Défi privé' : 'Groupe privé') + (g.ends_on ? ' · jusqu’au ' + esc(g.ends_on) : '') + '</small></span><span class="social-group-arrow">›</span></button>';
}
async function render(){
  const host = $('groupsContent');
  const c = sb();
  if (!host || !c) return;
  host.innerHTML = '<div class="comment-empty">Chargement des groupes…</div>';
  const { data, error } = await c.from('social_groups').select('id,owner_id,name,description,mode,invite_code,target_value,target_unit,ends_on,created_at').order('created_at',{ascending:false});
  if (error){ host.innerHTML = '<div class="feed-empty"><div class="feed-empty-t">Les groupes privés ne sont pas encore activés sur le serveur.</div><div class="feed-empty-s">La mise à jour Social doit être appliquée avant de pouvoir les utiliser.</div></div>'; return false; }
  groups = data || [];
  const current = groups.find(g => g.id === selected);
  host.innerHTML = formHtml() + (groups.length ? '<div class="social-groups-list">' + groups.map(renderGroupCard).join('') + '</div>' : '<div class="comment-empty">Aucun groupe pour le moment. Crée un cercle privé ou rejoins-en un avec un code.</div>') +
    (current ? '<section id="groupDetail" class="group-detail"><div class="group-detail-head"><div><h3>' + esc(current.name) + '</h3><p>' + esc(current.description || (current.mode === 'challenge' ? 'Objectif : ' + current.target_value + ' ' + current.target_unit : 'Un espace privé pour votre crew.')) + '</p></div></div>' +
      '<div class="group-membership-actions"><button class="chip" onclick="copySocialGroupCode(' + JSON.stringify(current.invite_code).replace(/"/g,'&quot;') + ')">Code · ' + esc(current.invite_code) + '</button>' +
        (current.owner_id === me() ? '<button class="chip group-danger" onclick="deleteSocialGroup(' + JSON.stringify(current.id).replace(/"/g,'&quot;') + ')">Supprimer</button>' : '<button class="chip group-danger" onclick="leaveSocialGroup(' + JSON.stringify(current.id).replace(/"/g,'&quot;') + ')">Quitter</button>') + '</div>' +
      (current.mode === 'challenge' ? '<div class="challenge-target">Cible : <b>' + esc(current.target_value) + ' ' + esc(current.target_unit) + '</b>' + (current.ends_on ? ' · fin ' + esc(current.ends_on) : '') + '</div>' : '') +
      '<div class="group-entry-form"><input class="input" id="groupEntryValue" type="number" min="0.1" step="any" value="1" aria-label="Contribution"><input class="input" id="groupEntryNote" maxlength="180" placeholder="Séance, progrès ou note"><button class="btn btn-primary btn-sm" onclick="addSocialGroupEntry(' + JSON.stringify(current.id).replace(/"/g,'&quot;') + ')">Partager</button></div><div id="groupEntries" class="group-entries"><div class="comment-empty">Chargement…</div></div></section>' : '');
  if (current) renderEntries(current);
  return true;
}
async function renderEntries(group){
  const host = $('groupEntries'), c = sb();
  if (!host || !c) return;
  const { data, error } = await c.from('social_group_entries').select('id,user_id,value,note,recorded_at,created_at').eq('group_id',group.id).order('created_at',{ascending:false}).limit(60);
  if (error){ host.innerHTML = '<div class="comment-empty">Impossible de charger les contributions.</div>'; return; }
  const entries = data || [];
  if (!entries.length){ host.innerHTML = '<div class="comment-empty">Aucune contribution pour le moment.</div>'; return; }
  const ids = [...new Set(entries.map(x => x.user_id))];
  const profiles = await c.from('profiles').select('id,username,display_name').in('id',ids);
  const names = Object.fromEntries((profiles.data || []).map(x => [x.id, x.display_name || x.username || 'Membre']));
  const sums = {};
  entries.forEach(x => { sums[x.user_id] = (sums[x.user_id] || 0) + (+x.value || 0); });
  const board = Object.entries(sums).sort((a,b) => b[1]-a[1]).map(([id,value],i) => '<div class="group-rank"><span>' + (i+1) + '</span><b>' + esc(names[id] || 'Membre') + '</b><strong>' + value + ' ' + esc(group.target_unit || 'séances') + '</strong></div>').join('');
  host.innerHTML = (group.mode === 'challenge' ? '<div class="group-leaderboard"><div class="section-hint">Classement</div>' + board + '</div>' : '') +
    entries.map(x => '<article class="group-entry"><b>' + esc(names[x.user_id] || 'Membre') + '</b><span>' + esc(x.value) + ' ' + esc(group.target_unit || 'séances') + (x.note ? ' · ' + esc(x.note) : '') + '</span><time>' + esc(x.recorded_at) + '</time></article>').join('');
}
async function openSocialGroups(){
  if (!SOCIAL_ENABLED || !(window.socialAvailable && window.socialAvailable())){ toast('Connecte-toi à Social pour accéder aux groupes.'); return false; }
  ensure(); selected = null;
  $('liftrGroups').classList.add('show'); $('liftrGroups').setAttribute('aria-hidden','false');
  await render();
  return true;
}
function closeSocialGroups(){ const el = $('liftrGroups'); if (el){ el.classList.remove('show'); el.setAttribute('aria-hidden','true'); } }
async function createSocialGroup(){
  if (busy) return;
  const name = String($('groupName')?.value || '').trim();
  if (name.length < 2){ $('groupName')?.focus(); toast('Ajoute un nom de groupe.'); return; }
  busy = true;
  try {
    const c = sb();
    const { data, error } = await c.rpc('create_social_group', {
      p_name:name, p_mode:$('groupMode').value, p_description:$('groupDescription').value,
      p_invite_code:code(), p_target_value:+$('groupTarget').value || 0,
      p_target_unit:String($('groupUnit').value || 'séances').trim(), p_ends_on:$('groupEnd').value || null
    });
    if (error) throw error;
    selected = data; await render(); toast('Groupe privé créé. Partage le code aux personnes invitées.');
  } catch(e){ toast('Création indisponible. Vérifie que la mise à jour Social est appliquée.'); }
  finally { busy = false; }
}
async function joinSocialGroup(){
  const input = $('groupInviteCode'), value = String(input?.value || '').trim().toUpperCase();
  if (value.length < 6){ input?.focus(); toast('Saisis le code d’invitation.'); return; }
  try {
    const { data, error } = await sb().rpc('join_social_group',{p_invite_code:value});
    if (error) throw error;
    selected = data; await render(); toast('Tu as rejoint le groupe privé.');
  } catch(e){ toast('Code invalide ou mise à jour Social non appliquée.'); }
}
function selectSocialGroup(id){ selected = id; render(); }
async function addSocialGroupEntry(groupId){
  const value = +$('groupEntryValue')?.value || 0, note = String($('groupEntryNote')?.value || '').trim();
  if (!(value > 0)){ toast('Saisis une contribution supérieure à zéro.'); return; }
  const { error } = await sb().from('social_group_entries').insert({ group_id:groupId, user_id:me(), value, note });
  if (error){ toast('Impossible de partager cette contribution.'); return; }
  $('groupEntryNote').value = '';
  const group = groups.find(x => x.id === groupId);
  if (group) renderEntries(group);
}
async function copySocialGroupCode(value){
  try { await navigator.clipboard.writeText(value); toast('Code copié.'); }
  catch(e){ window.prompt('Copie ce code d’invitation',value); }
}

async function leaveSocialGroup(groupId){
  const ok = await window.askConfirm('Quitter ce groupe ?', 'Tu ne verras plus ses messages de progression. Tu pourras rejoindre à nouveau avec un code valide.', 'Quitter');
  if (!ok || !ok.ok) return false;
  const { error } = await sb().from('social_group_members').delete().eq('group_id',groupId).eq('user_id',me());
  if (error){ toast('Impossible de quitter ce groupe.'); return false; }
  selected = null; await render(); toast('Tu as quitté le groupe.'); return true;
}
async function deleteSocialGroup(groupId){
  const ok = await window.askConfirm('Supprimer ce groupe ?', 'Le groupe, ses membres et ses contributions seront supprimés.', 'Supprimer');
  if (!ok || !ok.ok) return false;
  const { error } = await sb().from('social_groups').delete().eq('id',groupId).eq('owner_id',me());
  if (error){ toast('Impossible de supprimer ce groupe.'); return false; }
  selected = null; await render(); toast('Groupe supprimé.'); return true;
}

Object.assign(window,{openSocialGroups,closeSocialGroups,createSocialGroup,joinSocialGroup,selectSocialGroup,addSocialGroupEntry,copySocialGroupCode});
Object.assign(window,{leaveSocialGroup,deleteSocialGroup});

export { openSocialGroups, closeSocialGroups, createSocialGroup, joinSocialGroup,
  selectSocialGroup, addSocialGroupEntry, copySocialGroupCode, leaveSocialGroup, deleteSocialGroup };
