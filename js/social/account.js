/* ==================================================================
   SOCIAL - gestion de compte : email, mot de passe, session, delete
   ================================================================== */
import { SOCIAL_ENABLED } from './config.js';
import { sb, sbAuth } from './client.js';

let busy = false;

function el(id){ return document.getElementById(id); }
function toast(msg){ if (typeof window.toast === 'function') window.toast(msg); }
function gateOk(){ return typeof window.socialAvailable === 'function' ? window.socialAvailable() : SOCIAL_ENABLED; }
function meId(){ return (window.socialUser || {}).id || null; }

function showError(msg){
  const box = el('acctError');
  if (!box) return;
  box.textContent = msg || '';
  box.classList.toggle('hidden', !msg);
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* Remplit les champs avec la session courante (sans ecraser une saisie). */
export function fillAccount(){
  const email = el('acctEmail');
  const user = window.socialUser || {};
  if (email && !email.dataset.touched) email.value = user.email || '';
  if (email && !email.dataset.wired){
    email.dataset.wired = '1';
    email.addEventListener('input', () => { email.dataset.touched = '1'; showError(''); });
    email.addEventListener('keydown', e => {
      if (e.key === 'Enter'){ e.preventDefault(); saveEmail(); }
    });
  }
  const pass = el('acctPass');
  if (pass && !pass.dataset.wired){
    pass.dataset.wired = '1';
    pass.addEventListener('input', () => showError(''));
    pass.addEventListener('keydown', e => {
      if (e.key === 'Enter'){ e.preventDefault(); savePassword(); }
    });
  }
  showError('');
}

/* ------------------------------- email ----------------------------- */
export async function saveEmail(){
  if (busy) return false;
  if (!gateOk()){ showError('Sign in and go online to change your email.'); return false; }
  const auth = sbAuth();
  const input = el('acctEmail');
  const email = ((input && input.value) || '').trim();
  if (!EMAIL_RE.test(email)){ showError('That email does not look right.'); return false; }
  if (email === (window.socialUser || {}).email){ showError('This is your current email.'); return false; }
  if (!auth){ showError('Social is not configured yet.'); return false; }

  const btn = el('acctEmailSave');
  if (btn){ btn.dataset.idle = 'Save'; btn.disabled = true; btn.textContent = 'Saving…'; }
  busy = true;
  showError('');
  try {
    const { error } = await auth.updateUser({ email: email });
    if (error) throw new Error(error.message || 'Could not update your email.');
    if (input) delete input.dataset.touched;
    toast('Check your inbox to confirm ' + email + '.');
    return true;
  } catch(e){
    showError((e && e.message) || 'Could not update your email.');
    return false;
  } finally {
    busy = false;
    if (btn){ btn.disabled = false; btn.textContent = 'Save'; }
  }
}

/* ----------------------------- password ---------------------------- */
export async function savePassword(){
  if (busy) return false;
  if (!gateOk()){ showError('Sign in and go online to change your password.'); return false; }
  const auth = sbAuth();
  const input = el('acctPass');
  const pass = (input && input.value) || '';
  if (pass.length < 8){ showError('Use at least 8 characters.'); return false; }
  if (pass.length > 72){ showError('That password is too long.'); return false; }
  if (!auth){ showError('Social is not configured yet.'); return false; }

  const btn = el('acctPassSave');
  if (btn){ btn.dataset.idle = 'Update'; btn.disabled = true; btn.textContent = 'Saving…'; }
  busy = true;
  showError('');
  try {
    const { error } = await auth.updateUser({ password: pass });
    if (error) throw new Error(error.message || 'Could not update your password.');
    if (input) input.value = '';
    toast('Password updated.');
    return true;
  } catch(e){
    showError((e && e.message) || 'Could not update your password.');
    return false;
  } finally {
    busy = false;
    if (btn){ btn.disabled = false; btn.textContent = 'Update'; }
  }
}

/* --------------------------- sign out ------------------------------ */
export function signOutNow(){
  if (typeof window.signOutSocial === 'function') window.signOutSocial();
  if (typeof window.closeModal === 'function') window.closeModal('profileModal');
  return true;
}

/* ------------------------- delete account -------------------------- */
export async function deleteMyAccount(){
  if (busy) return false;
  if (!SOCIAL_ENABLED){ showError('Social is not configured yet.'); return false; }
  if (!gateOk()){ showError('Sign in and go online to delete your account.'); return false; }
  const c = sb();
  const me = meId();
  if (!c || !me){ showError('Sign in to delete your account.'); return false; }

  const r = typeof window.askConfirm === 'function'
    ? await window.askConfirm(
        'Delete your account?',
        'Your profile, posts, photos, stories, notes, messages and follows are ' +
        'permanently deleted. Your training data on this device is not touched. ' +
        'This cannot be undone.',
        'Delete my account')
    : { ok: false };
  if (!r || !r.ok) return false;

  busy = true;
  showError('');
  try {
    const { error } = await c.rpc('delete_my_account');
    if (error) throw new Error(error.message || 'Could not delete your account.');

    try { if (window.localStorage) localStorage.removeItem('liftr-auth'); } catch(e){}
    if (typeof window.signOutSocial === 'function'){ try { await window.signOutSocial(); } catch(e){} }
    window.socialUser = null;
    if (typeof window.updateSocialGate === 'function') window.updateSocialGate();
    if (typeof window.closeModal === 'function') window.closeModal('profileModal');
    toast('Your account has been deleted.');
    setTimeout(() => { try { location.reload(); } catch(e){} }, 900);
    return true;
  } catch(e){
    showError((e && e.message) || 'Could not delete your account.');
    toast((e && e.message) || 'Could not delete your account.');
    return false;
  } finally {
    busy = false;
  }
}

export function initAccount(){
  fillAccount();
}
