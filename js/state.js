/* ==================================================================
   LIFTR - etat global partage entre les modules (DB, currentUser, ...)
   ================================================================== */


window.DB = null;
window.currentUser = null;
window.currentTab = 'programme';
window.currentRoot = 'gym';           /* racine active : feed | gym | nutrition */
window.calCursor = new Date();
window.selectedDate = null;
window.pendingShare = null;
window.socialUser = null;
