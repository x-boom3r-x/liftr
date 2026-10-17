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
  initFeed, openFeed, saveFeedScroll, renderFeed, loadMorePosts, refreshFeedNew,
  submitPost, pickPhoto, removePhoto, compressImage, webpSupported,
  postCardHtml, timeAgo, updateComposer, resetFeed,
  setFeedScope, getFeedScope, refreshCounts, feedFollowChanged,
  toggleLike, vote, toggleSave, repostPost, openRepostSheet,
  startRepostQuote, cancelRepostQuote, openShareComposer, cancelShareDraft,
  sharePost, renderCrew, initCrew, focusComposer, mediaUrl,
  refreshIdentity, deletePost, openPostMenu, openSharedPost,
  openPostTypeSheet, pickPostMusic, toggleCommentsEnabled
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
  sendMessage, sharePostInMessage, initInbox, resetInbox
} from './inbox.js';
import {
  renderStories, initStories, initStoryViewer, openStoryViewer,
  closeStoryViewer, openStoryComposer, pickStoryPhoto, submitStory,
  deleteStory, deleteCurrentStory, resetStories, pickStoryMusic,
  refreshStoryRings, cycleStoryFont, toggleStoryStyle, storyAgain,
  closeStoryComposer, renderStageText
} from './stories.js';
import {
  renderNotes, initNotes, openNoteComposer, submitNote, removeNote,
  resetNotes, pickNoteMusic
} from './notes.js';
import {
  openNotifications, closeNotifications, loadNotifications,
  refreshNotifBadge, markAllRead, initNotifications, resetNotifications
} from './notifications.js';
import { startRealtime, stopRealtime } from './realtime.js';
import {
  initAccount, fillAccount, saveEmail, savePassword, signOutNow, deleteMyAccount
} from './account.js';
import {
  openImageEditor, closeEditor, useEditedImage, initEditor
} from './editor.js';
import {
  openMusicPicker, closeMusicPicker, runMusicSearch, initMusic,
  stopMusic, hydrateMusic, splitMusic, withMusic, musicPlayingId,
  openTrackPage, closeTrackPage, toggleTrackSave, isTrackSaved, savedTracks
} from './music.js';
import {
  initAutoplay, setGlobalMuted, isGlobalMuted, autoplayScan, musicStoryAutoplay
} from './autoplay.js';
import {
  privacyMode, isPrivateProfile, writePrivacy, canSeePosts, filterPrivatePosts
} from './privacy.js';
import { postLinkIn } from './deeplink.js';

Object.assign(window, {
  SOCIAL_CONFIG, SOCIAL_ENABLED, GOOGLE_ENABLED,
  supabaseLoaded, sb, sbAuth,
  socialAvailable, updateSocialGate,
  buildAuthUrl, signInGoogle, restoreSession, signOutSocial,
  buildEmailEndpoint, signInEmail, signUpEmail, ensureMyProfile,
  openAuth, closeAuth, toggleAuthMode, submitAuth,
  initFeed, openFeed, saveFeedScroll, renderFeed, loadMorePosts, refreshFeedNew,
  submitPost, pickPhoto, removePhoto, compressImage, webpSupported,
  postCardHtml, timeAgo, updateComposer, resetFeed,
  setFeedScope, getFeedScope, refreshCounts, feedFollowChanged,
  toggleLike, vote, toggleSave, repostPost, openRepostSheet,
  startRepostQuote, cancelRepostQuote, openShareComposer, cancelShareDraft,
  sharePost, renderCrew, initCrew, focusComposer, mediaUrl,
  refreshIdentity, deletePost, openPostMenu,
  openPostTypeSheet, pickPostMusic, openSharedPost, toggleCommentsEnabled,
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
  sendMessage, sharePostInMessage, initInbox, resetInbox,
  renderStories, initStories, initStoryViewer, openStoryViewer,
  closeStoryViewer, openStoryComposer, pickStoryPhoto, submitStory,
  deleteStory, deleteCurrentStory, resetStories, pickStoryMusic, refreshStoryRings,
  cycleStoryFont, toggleStoryStyle, storyAgain, closeStoryComposer, renderStageText,
  renderNotes, initNotes, openNoteComposer, submitNote, removeNote,
  resetNotes, pickNoteMusic,
  openNotifications, closeNotifications, loadNotifications,
  refreshNotifBadge, markAllRead, initNotifications,
  startRealtime, stopRealtime,
  initAccount, fillAccount, saveEmail, savePassword, signOutNow, deleteMyAccount,
  togglePrivateEdit,
  openImageEditor, closeEditor, useEditedImage, initEditor,
  openMusicPicker, closeMusicPicker, runMusicSearch, initMusic,
  stopMusic, hydrateMusic, splitMusic, withMusic, musicPlayingId,
  openTrackPage, closeTrackPage, toggleTrackSave, isTrackSaved, savedTracks,
  initAutoplay, setGlobalMuted, isGlobalMuted, autoplayScan, musicStoryAutoplay,
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

/* Un partage reçu en message (L4) porte « #p=<id> » : le lien doit
   rester navigable — rejoué à chaque activation de la page (un lien
   ouvert depuis la messagerie recharge l'onglet). On n'intercepte pas
   le hash des autres vues : on ne traite que le préfixe #p=. */
function routeSharedLink(){
  const key = postLinkIn(location.hash || '');
  if (!key) return false;
  if (routeSharedLink.seen === key) return false;   /* déjà traité à ce chargement */
  routeSharedLink.seen = key;
  safe(openSharedPost(key));
  return true;
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
  initAutoplay();
  initEditor();
  initNotifications();
  if (SOCIAL_ENABLED && supabaseLoaded()) restoreSession();
  window.routeSharedLink = routeSharedLink;
  window.addEventListener('hashchange', routeSharedLink);
  /* attente d'une microtask : la session restaure l'état du fil avant
     la révélation du post (sinon openComments perd la course). */
  setTimeout(routeSharedLink, 0);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSocial);
else initSocial();
