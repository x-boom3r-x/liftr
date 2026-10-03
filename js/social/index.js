/* ==================================================================
   SOCIAL - point d'entree (dormant tant que la config est vide)
   ================================================================== */
import { SOCIAL_CONFIG, SOCIAL_ENABLED, GOOGLE_ENABLED } from './config.js';
import { supabaseLoaded, sb, sbAuth } from './client.js';
import { socialAvailable, updateSocialGate } from './gate.js';
import {
  buildAuthUrl, signInGoogle, restoreSession, signOutSocial,
  buildEmailEndpoint, signInEmail, signUpEmail,
  openAuth, closeAuth, toggleAuthMode, submitAuth
} from './auth.js';

Object.assign(window, {
  SOCIAL_CONFIG, SOCIAL_ENABLED, GOOGLE_ENABLED,
  supabaseLoaded, sb, sbAuth,
  socialAvailable, updateSocialGate,
  buildAuthUrl, signInGoogle, restoreSession, signOutSocial,
  buildEmailEndpoint, signInEmail, signUpEmail,
  openAuth, closeAuth, toggleAuthMode, submitAuth
});

function initSocial(){
  updateSocialGate();
  if (SOCIAL_ENABLED && supabaseLoaded()) restoreSession();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSocial);
else initSocial();
