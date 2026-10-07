/* ==================================================================
   SOCIAL - client Supabase (créé à la demande, jamais au boot)
   ================================================================== */
import { SOCIAL_CONFIG, SOCIAL_ENABLED } from './config.js';

let _client = null;

export function supabaseLoaded(){
  return typeof window.supabase !== 'undefined' &&
    !!window.supabase && typeof window.supabase.createClient === 'function';
}

/* Client unique. Retourne null tant que le social est coupé. */
export function sb(){
  if (!SOCIAL_ENABLED || !supabaseLoaded()) return null;
  if (!_client){
    _client = window.supabase.createClient(SOCIAL_CONFIG.supabaseUrl, SOCIAL_CONFIG.anonKey, {
      auth: {
        persistSession: true,
        /* JWT d'une heure : sans rafraichissement automatique, les boutons du
           feed echouent silencieusement (401) des que l'onglet vieillit. */
        autoRefreshToken: true,
        /* Sans cela, le retour OAuth (#access_token=...) n'est jamais lu :
           la session Google n'ouvre jamais, l'utilisateur reste deconnecte. */
        detectSessionInUrl: true,
        storageKey: 'liftr-auth'
      }
    });
  }
  return _client;
}

export function sbAuth(){
  const c = sb();
  return c ? c.auth : null;
}
