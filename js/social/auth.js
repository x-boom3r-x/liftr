/* ==================================================================
   SOCIAL - connexion Google, restauration de session, déconnexion
   ================================================================== */
import { SOCIAL_CONFIG } from './config.js';
import { sbAuth } from './client.js';

function socialToast(msg){
  if (typeof window.toast === 'function') window.toast(msg);
}

/* URL d'autorisation Supabase — pur, testable sans navigateur. */
export function buildAuthUrl(opts){
  opts = opts || {};
  const base = String(opts.supabaseUrl || SOCIAL_CONFIG.supabaseUrl || '').replace(/\/+$/, '');
  if (!base) return null;
  const q = new URLSearchParams({
    provider: opts.provider || 'google',
    redirect_to: opts.redirectTo || (location.origin + location.pathname)
  });
  if (opts.scopes) q.set('scopes', opts.scopes);
  return base + '/auth/v1/authorize?' + q.toString();
}

export async function signInGoogle(){
  const redirect = location.origin + location.pathname;
  const auth = sbAuth();
  if (auth){
    const { error } = await auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: redirect, scopes: 'openid email profile' }
    });
    if (error){ socialToast(error.message || 'Sign-in failed.'); return false; }
    return true;
  }
  const url = buildAuthUrl({ redirectTo: redirect });
  if (!url){ socialToast('Social is not configured yet.'); return false; }
  location.assign(url);
  return true;
}

export async function restoreSession(){
  const auth = sbAuth();
  if (!auth){ window.socialUser = null; return null; }
  try {
    const { data, error } = await auth.getSession();
    window.socialUser = (!error && data && data.session && data.session.user) ? data.session.user : null;
  } catch(e){
    window.socialUser = null;
  }
  if (typeof window.updateSocialGate === 'function') window.updateSocialGate();
  return window.socialUser;
}

export async function signOutSocial(){
  const auth = sbAuth();
  if (auth){ try { await auth.signOut(); } catch(e){} }
  window.socialUser = null;
  if (typeof window.updateSocialGate === 'function') window.updateSocialGate();
}
