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
import {
  initFeed, openFeed, saveFeedScroll, renderFeed, loadMorePosts,
  submitPost, pickPhoto, removePhoto, compressImage, webpSupported,
  postCardHtml, timeAgo, updateComposer, resetFeed,
  setFeedScope, getFeedScope, refreshCounts, feedFollowChanged
} from './feed.js';
import {
  openComments, closeComments, submitComment, updateCommentComposer,
  initComments, resetComments
} from './comments.js';
import {
  openPeople, closePeople, toggleFollow, isFollowing, followingIds,
  initPeople, resetPeople
} from './people.js';

Object.assign(window, {
  SOCIAL_CONFIG, SOCIAL_ENABLED, GOOGLE_ENABLED,
  supabaseLoaded, sb, sbAuth,
  socialAvailable, updateSocialGate,
  buildAuthUrl, signInGoogle, restoreSession, signOutSocial,
  buildEmailEndpoint, signInEmail, signUpEmail,
  openAuth, closeAuth, toggleAuthMode, submitAuth,
  initFeed, openFeed, saveFeedScroll, renderFeed, loadMorePosts,
  submitPost, pickPhoto, removePhoto, compressImage, webpSupported,
  postCardHtml, timeAgo, updateComposer, resetFeed,
  setFeedScope, getFeedScope, refreshCounts, feedFollowChanged,
  openComments, closeComments, submitComment, updateCommentComposer,
  initComments, resetComments,
  openPeople, closePeople, toggleFollow, isFollowing, followingIds,
  initPeople, resetPeople
});

function initSocial(){
  updateSocialGate();
  initFeed();
  initComments();
  initPeople();
  if (SOCIAL_ENABLED && supabaseLoaded()) restoreSession();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSocial);
else initSocial();
