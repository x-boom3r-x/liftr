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
  setFeedScope, getFeedScope, refreshCounts, feedFollowChanged,
  toggleLike, sharePost, renderCrew, initCrew, focusComposer, mediaUrl,
  refreshIdentity
} from './feed.js';
import {
  openComments, closeComments, submitComment, updateCommentComposer,
  initComments, resetComments
} from './comments.js';
import {
  openPeople, closePeople, toggleFollow, isFollowed, mergeFollows,
  followingIds, personRowHtml, initPeople, resetPeople
} from './people.js';
import {
  setSView, currentSView, enterSView, setSocialHead,
  startThreadPoll, stopThreadPoll, initShell, resetShell
} from './shell.js';
import {
  renderProfile, openProfile, showMyProfile, toggleFollowFromProfile,
  openThreadOfTarget, openEditProfile, pickAvatar, removeAvatar,
  submitProfile, initProfile, resetProfile, setProfileTab, shareProfile
} from './profile.js';
import {
  openSearch, runSearch, clearSearch, renderSearch, resetSearch
} from './search.js';
import {
  renderInbox, refreshInboxBadge, loadThread, openThread, closeThread,
  sendMessage, initInbox, resetInbox
} from './inbox.js';

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
  toggleLike, sharePost, renderCrew, initCrew, focusComposer, mediaUrl,
  refreshIdentity,
  openComments, closeComments, submitComment, updateCommentComposer,
  initComments, resetComments,
  openPeople, closePeople, toggleFollow, isFollowed, mergeFollows,
  followingIds, personRowHtml, initPeople, resetPeople,
  setSView, currentSView, enterSView, setSocialHead,
  startThreadPoll, stopThreadPoll, initShell, resetShell,
  renderProfile, openProfile, showMyProfile, toggleFollowFromProfile,
  openThreadOfTarget, openEditProfile, pickAvatar, removeAvatar,
  submitProfile, initProfile, resetProfile, setProfileTab, shareProfile,
  openSearch, runSearch, clearSearch, renderSearch, resetSearch,
  renderInbox, refreshInboxBadge, loadThread, openThread, closeThread,
  sendMessage, initInbox, resetInbox,
  onFollowChanged
});

/* Un follow bouge : on rafraichit feed, crew, profil et recherche. */
function safe(p){ try { if (p && typeof p.catch === 'function') p.catch(() => {}); } catch(e){} }

function onFollowChanged(uid, isF){
  safe(feedFollowChanged());
  safe(initCrew());
  safe(renderSearch());
  if (currentSView() === 'profile') safe(renderProfile());
}

function initSocial(){
  updateSocialGate();
  initShell();
  initFeed();
  initComments();
  initPeople();
  initProfile();
  initInbox();
  if (SOCIAL_ENABLED && supabaseLoaded()) restoreSession();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSocial);
else initSocial();
