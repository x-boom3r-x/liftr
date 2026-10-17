/* ==================================================================
   SOCIAL - Realtime (Supabase postgres_changes)
   Deux abonnements seulement ; le reste (fil DM, stories) garde son
   polling existant :
     - notifications (les miennes) → badge / pastille « non lues » live
     - posts (INSERT)              → pastille « New posts » ou refresh
   Repli propre : canal coupé, realtime désactivé ou websocket refusé,
   le fil reste utilisable (chargement manuel) et le badge se rafraîchit
   à la prochaine action. Aucune exception propagée, aucun bruit console.
   ================================================================== */
import { sb } from './client.js';
import { SOCIAL_CONFIG } from './config.js';

let channel = null;
let boundUser = null;

function atFeedTop(){
  const sc = document.querySelector('.app');
  return !sc || sc.scrollTop < 80;
}

/* Nouveau post reçu : sur le fil et en haut → refresh direct ; sinon
   (ailleurs, ou défilé vers le bas) → pastille non perturbatrice. */
function onFeedSignal(){
  try {
    const tab = document.getElementById('tab-feed');
    const onFeed = tab && !tab.classList.contains('hidden');
    if (onFeed && atFeedTop()){
      if (typeof window.refreshFeedNew === 'function') window.refreshFeedNew();
      return;
    }
    const pill = document.getElementById('feedNewPill');
    if (pill) pill.classList.remove('hidden');
  } catch(e){}
}

export function startRealtime(userId){
  if (!userId) return stopRealtime();
  if (channel && boundUser === userId) return true;
  stopRealtime();
  if (!SOCIAL_CONFIG || SOCIAL_CONFIG.realtime === false) return false;
  const c = sb();
  if (!c || typeof c.channel !== 'function') return false;
  try {
    channel = c.channel('liftr-' + userId, { config: { broadcast: { self: false } } });
    channel.on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + userId },
      () => {
        try {
          if (typeof window.refreshNotifBadge === 'function') window.refreshNotifBadge();
        } catch(e){}
      });
    channel.on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'posts' },
      payload => {
        try {
          const row = payload && payload.new;
          const me = (window.socialUser || {}).id;
          if (row && me && row.author_id === me) return; /* mon propre post déjà géré */
          onFeedSignal();
        } catch(e){}
      });
    /* callback vide : l'échec de souscription est absorbé en silence */
    channel.subscribe(() => {});
    boundUser = userId;
    return true;
  } catch(e){
    channel = null; boundUser = null;
    return false;
  }
}

export function stopRealtime(){
  if (channel){
    try { channel.unsubscribe(); } catch(e){}
    channel = null; boundUser = null;
  }
  const pill = document.getElementById('feedNewPill');
  if (pill) pill.classList.add('hidden');
}

/* Rebranché depuis les tests pour piloter le signal sans websocket. */
if (typeof window !== 'undefined') window.__liftrFeedSignal = onFeedSignal;
