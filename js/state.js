/* ==================================================================
   LIFTR - etat global partage entre les modules (DB, currentUser, ...)
   ================================================================== */


window.DB = null;
window.currentUser = null;
window.currentTab = 'programme';
window.currentRoot = 'today';         /* racine active : today | feed | gym | nutrition | profil */
window.calCursor = new Date();
window.selectedDate = null;
window.pendingShare = null;
window.socialUser = null;
