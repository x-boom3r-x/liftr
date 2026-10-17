/* ==================================================================
   SOCIAL - connexion (Google + email/mot de passe), session, panneau
   ================================================================== */
import { SOCIAL_CONFIG, SOCIAL_ENABLED } from './config.js';
import { sbAuth, sb } from './client.js';

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
  if (window.socialUser){
    ensureMyProfile();
    if (typeof window.startRealtime === 'function'){
      try { window.startRealtime((window.socialUser || {}).id); } catch(e){}
    }
  }
  return window.socialUser;
}

/* Le trigger SQL crée le profil au signup. Si la ligne manque (trigger
   absent, base réinitialisée, signup sans metadata), on la crée ici pour
   que le nouvel inscrit apparaisse tout de suite dans « Find people ».
   Best-effort : jamais bloquant, jamais d'exception propagée. */
export function ensureMyProfile(){
  try {
    const c = sb();
    const user = window.socialUser;
    if (!c || !user || !user.id) return false;
    const p = Promise.resolve(
      c.from('profiles').select('id').eq('id', user.id).limit(1)
    ).then(res => {
      if (res.error) return false;
      const row = Array.isArray(res.data) ? res.data[0] : res.data;
      if (row) return false;
      const base = String((user.email || '').split('@')[0] || '')
        .toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24);
      let username = base.length >= 3 ? base : (base + 'lifter').slice(0, 24);
      if (username.length < 3) username = 'lifter' + Date.now().toString(36);
      const meta = user.user_metadata || {};
      const display = String(meta.name || meta.display_name || username).slice(0, 50);
      return c.from('profiles').insert({
        id: user.id, username: username, display_name: display
      }).then(r2 => {
        if (r2.error) return false;
        /* la ligne existe maintenant : elle apparaît dans « Find people » */
        if (typeof window.resetSearch === 'function') window.resetSearch();
        return true;
      });
    }).catch(() => false);
    if (typeof p.catch === 'function') p.catch(() => {});
    return true;
  } catch(e){
    return false;
  }
}

export async function signOutSocial(){
  const auth = sbAuth();
  if (auth){ try { await auth.signOut(); } catch(e){} }
  window.socialUser = null;
  if (typeof window.resetFeed === 'function') window.resetFeed();
  if (typeof window.resetComments === 'function') window.resetComments();
  if (typeof window.resetPeople === 'function') window.resetPeople();
  if (typeof window.resetShell === 'function') window.resetShell();
  if (typeof window.resetProfile === 'function') window.resetProfile();
  if (typeof window.resetSearch === 'function') window.resetSearch();
  if (typeof window.resetInbox === 'function') window.resetInbox();
  if (typeof window.resetNotifications === 'function') window.resetNotifications();
  if (typeof window.stopRealtime === 'function'){
    try { window.stopRealtime(); } catch(e){}
  }
  if (typeof window.updateSocialGate === 'function') window.updateSocialGate();
}

/* ---------- email / mot de passe ---------- */

function adoptUser(user){
  window.socialUser = user || null;
  if (typeof window.updateSocialGate === 'function') window.updateSocialGate();
  if (window.socialUser){
    ensureMyProfile();
    if (typeof window.refreshNotifBadge === 'function'){
      try { window.refreshNotifBadge(); } catch(e){}
    }
    if (typeof window.startRealtime === 'function'){
      try { window.startRealtime((window.socialUser || {}).id); } catch(e){}
    }
  }
}

/* Endpoint Supabase — pur, testable sans navigateur. */
export function buildEmailEndpoint(opts){
  opts = opts || {};
  const base = String(opts.supabaseUrl || SOCIAL_CONFIG.supabaseUrl || '').replace(/\/+$/, '');
  if (!base) return null;
  return opts.kind === 'signup'
    ? base + '/auth/v1/signup'
    : base + '/auth/v1/token?grant_type=password';
}

/* Retourne null en cas de succès, sinon le message à afficher. */
export async function signInEmail(email, password){
  const auth = sbAuth();
  if (!auth) return 'Social is not configured yet.';
  const { data, error } = await auth.signInWithPassword({ email, password });
  if (error) return error.message || 'Sign-in failed.';
  adoptUser(data && data.user);
  return null;
}

export async function signUpEmail(email, password){
  const auth = sbAuth();
  if (!auth) return 'Social is not configured yet.';
  const { data, error } = await auth.signUp({ email, password });
  if (error) return error.message || 'Sign-up failed.';
  if (data && data.session){ adoptUser(data.user); return null; }
  return 'Check your inbox to confirm your email.';
}

/* ---------- panneau de connexion ---------- */

let authMode = 'signin';

function el(id){ return document.getElementById(id); }

function syncAuthForm(){
  const signup = authMode === 'signup';
  const title = el('authTitle');
  const submit = el('authSubmit');
  const toggle = el('authToggle');
  const pass = el('authPass');
  if (title) title.textContent = signup ? 'Create account' : 'Sign in';
  if (submit) submit.textContent = signup ? 'Create account' : 'Sign in';
  if (toggle) toggle.textContent = signup ? 'I already have an account' : 'Create an account';
  if (pass) pass.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');
}

function showAuthError(msg){
  const box = el('authError');
  if (!box) return;
  box.textContent = msg || '';
  box.classList.toggle('hidden', !msg);
}

export function openAuth(mode){
  if (!SOCIAL_ENABLED){ socialToast('Social is not configured yet.'); return false; }
  authMode = (mode === 'signup') ? 'signup' : 'signin';
  syncAuthForm();
  showAuthError('');
  const email = el('authEmail');
  const pass = el('authPass');
  if (email) email.value = '';
  if (pass) pass.value = '';
  if (typeof window.openModal === 'function') window.openModal('authModal');
  if (email) setTimeout(() => { try { email.focus(); } catch(e){} }, 60);
  return true;
}

export function closeAuth(){
  showAuthError('');
  if (typeof window.closeModal === 'function') window.closeModal('authModal');
}

export function toggleAuthMode(){
  authMode = (authMode === 'signup') ? 'signin' : 'signup';
  showAuthError('');
  syncAuthForm();
  return authMode;
}

export async function submitAuth(){
  const email = ((el('authEmail') && el('authEmail').value) || '').trim();
  const pass = (el('authPass') && el('authPass').value) || '';
  const btn = el('authSubmit');
  const signup = authMode === 'signup';
  const label = signup ? 'Create account' : 'Sign in';

  if (!email || !pass){ showAuthError('Email and password are required.'); return false; }
  if (!SOCIAL_ENABLED){ showAuthError('Social is not configured yet.'); return false; }
  showAuthError('');

  if (btn){ btn.disabled = true; btn.textContent = 'Please wait…'; }
  try {
    const msg = signup ? await signUpEmail(email, pass) : await signInEmail(email, pass);
    if (msg){ showAuthError(msg); return false; }
    if (el('authPass')) el('authPass').value = '';
    closeAuth();
    socialToast(signup ? 'Account created — welcome!' : 'Signed in.');
    return true;
  } catch(e){
    showAuthError((e && e.message) || 'Something went wrong.');
    return false;
  } finally {
    if (btn){ btn.disabled = false; btn.textContent = label; }
  }
}
