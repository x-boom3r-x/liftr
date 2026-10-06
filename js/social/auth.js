/* ==================================================================
   SOCIAL - connexion (Google + email/mot de passe), session, panneau
   ================================================================== */
import { SOCIAL_CONFIG, SOCIAL_ENABLED } from './config.js';
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
  if (typeof window.resetFeed === 'function') window.resetFeed();
  if (typeof window.resetComments === 'function') window.resetComments();
  if (typeof window.resetPeople === 'function') window.resetPeople();
  if (typeof window.updateSocialGate === 'function') window.updateSocialGate();
}

/* ---------- email / mot de passe ---------- */

function adoptUser(user){
  window.socialUser = user || null;
  if (typeof window.updateSocialGate === 'function') window.updateSocialGate();
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
