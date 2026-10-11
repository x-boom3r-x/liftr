/* ==================================================================
   SOCIAL - point d'entree (dormant tant que la config est vide)
   ================================================================== */
import { SOCIAL_CONFIG, SOCIAL_ENABLED, GOOGLE_ENABLED } from './config.js';
import { supabaseLoaded, sb, sbAuth } from './client.js';
import { socialAvailable, updateSocialGate } from './gate.js';
import {
  buildAuthUrl, signInGoogle, restoreSession, signOutSocial,
  buildEmailEndpoint, signInEmail, signUpEmail, ensureMyProfile,
  openAuth, closeAuth, toggleAuthMode, submitAuth
} from './auth.js';
import {
  initFeed, openFeed, saveFeedScroll, renderFeed, loadMorePosts,
  submitPost, pickPhoto, removePhoto, compressImage, webpSupported,
  postCardHtml, timeAgo, updateComposer, resetFeed,
  setFeedScope, getFeedScope, refreshCounts, feedFollowChanged,
  toggleLike, vote, toggleSave, repostPost, openRepostSheet,
  startRepostQuote, cancelRepostQuote, openShareComposer, cancelShareDraft,
  sharePost, renderCrew, initCrew, focusComposer, mediaUrl,
  refreshIdentity, deletePost, openPostMenu,
  openPostTypeSheet, pickPostMusic
} from './feed.js';
import {
  sanitizeAttachment, shareEmbedHtml, importSharedProgram,
  prAttachment, sessionAttachment, programAttachment
} from './attach.js';
import {
  openComments, closeComments, submitComment, updateCommentComposer,
  initComments, resetComments
} from './comments.js';
import {
  openPeople, closePeople, toggleFollow, isFollowed, mergeFollows,
  followingIds, personRowHtml, initPeople, resetPeople
} from './people.js';
import {
setSView, currentSView, enterSView, setSocialHead, profileBack, feedBack,
startThreadPoll, stopThreadPoll, initShell, resetShell
} from './shell.js';
import {
  renderProfile, openProfile, showMyProfile, toggleFollowFromProfile,
  openThreadOfTarget, openEditProfile, openAvatarView, pickAvatar, removeAvatar,
  submitProfile, initProfile, resetProfile, setProfileTab, shareProfile,
  togglePrivateEdit, popProfileLayer
} from './profile.js';
import {
  openSearch, runSearch, clearSearch, renderSearch, resetSearch
} from './search.js';
import {
  renderInbox, refreshInboxBadge, loadThread, openThread, closeThread,
  sendMessage, initInbox, resetInbox
} from './inbox.js';
import {
  renderStories, initStories, initStoryViewer, openStoryViewer,
  closeStoryViewer, openStoryComposer, pickStoryPhoto, submitStory,
  deleteStory, deleteCurrentStory, resetStories, pickStoryMusic,
  refreshStoryRings
} from './stories.js';
import {
  renderNotes, initNotes, openNoteComposer, submitNote, removeNote,
  resetNotes, pickNoteMusic
} from './notes.js';
import {
  initAccount, fillAccount, saveEmail, savePassword, signOutNow, deleteMyAccount
} from './account.js';
import {
  openImageEditor, closeEditor, useEditedImage, initEditor
} from './editor.js';
import {
  openMusicPicker, closeMusicPicker, runMusicSearch, initMusic,
  stopMusic, hydrateMusic, splitMusic, withMusic, musicPlayingId
} from './music.js';
import {
  privacyMode, isPrivateProfile, writePrivacy, canSeePosts, filterPrivatePosts
} from './privacy.js';

Object.assign(window, {
  SOCIAL_CONFIG, SOCIAL_ENABLED, GOOGLE_ENABLED,
  supabaseLoaded, sb, sbAuth,
  socialAvailable, updateSocialGate,
  buildAuthUrl, signInGoogle, restoreSession, signOutSocial,
  buildEmailEndpoint, signInEmail, signUpEmail, ensureMyProfile,
  openAuth, closeAuth, toggleAuthMode, submitAuth,
  initFeed, openFeed, saveFeedScroll, renderFeed, loadMorePosts,
  submitPost, pickPhoto, removePhoto, compressImage, webpSupported,
  postCardHtml, timeAgo, updateComposer, resetFeed,
  setFeedScope, getFeedScope, refreshCounts, feedFollowChanged,
  toggleLike, vote, toggleSave, repostPost, openRepostSheet,
  startRepostQuote, cancelRepostQuote, openShareComposer, cancelShareDraft,
  sharePost, renderCrew, initCrew, focusComposer, mediaUrl,
  refreshIdentity, deletePost, openPostMenu,
  openPostTypeSheet, pickPostMusic,
  sanitizeAttachment, shareEmbedHtml, importSharedProgram,
  prAttachment, sessionAttachment, programAttachment,
  openComments, closeComments, submitComment, updateCommentComposer,
  initComments, resetComments,
  openPeople, closePeople, toggleFollow, isFollowed, mergeFollows,
  followingIds, personRowHtml, initPeople, resetPeople,
  setSView, currentSView, enterSView, setSocialHead, profileBack, feedBack,
  startThreadPoll, stopThreadPoll, initShell, resetShell,
  renderProfile, openProfile, showMyProfile, toggleFollowFromProfile,
  openThreadOfTarget, openEditProfile, openAvatarView, pickAvatar, removeAvatar,
  submitProfile, initProfile, resetProfile, setProfileTab, shareProfile,
  popProfileLayer,
  openSearch, runSearch, clearSearch, renderSearch, resetSearch,
  renderInbox, refreshInboxBadge, loadThread, openThread, closeThread,
  sendMessage, initInbox, resetInbox,
  renderStories, initStories, initStoryViewer, openStoryViewer,
  closeStoryViewer, openStoryComposer, pickStoryPhoto, submitStory,
  deleteStory, deleteCurrentStory, resetStories, pickStoryMusic, refreshStoryRings,
  renderNotes, initNotes, openNoteComposer, submitNote, removeNote,
  resetNotes, pickNoteMusic,
  initAccount, fillAccount, saveEmail, savePassword, signOutNow, deleteMyAccount,
  togglePrivateEdit,
  openImageEditor, closeEditor, useEditedImage, initEditor,
  openMusicPicker, closeMusicPicker, runMusicSearch, initMusic,
  stopMusic, hydrateMusic, splitMusic, withMusic, musicPlayingId,
  privacyMode, isPrivateProfile, writePrivacy, canSeePosts, filterPrivatePosts,
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
  initStories();
  initStoryViewer();
  initComments();
  initPeople();
  initProfile();
  initAccount();
  initInbox();
  initMusic();
  initEditor();
  if (SOCIAL_ENABLED && supabaseLoaded()) restoreSession();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSocial);
else initSocial();
