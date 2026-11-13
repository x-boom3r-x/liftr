import { setLanguage, currentLanguage } from './i18n.js';

const PREF_KEY = () => 'liftr_preferences_' + (window.currentUser || 'guest');
const SHORTCUT_KEY = () => 'liftr_shortcuts_' + (window.currentUser || 'guest');
const DEFAULTS = { textSize:'normal', reducedMotion:false, quotes:true, language:'fr', restTimerNotifications:false };
const $ = id => document.getElementById(id);
function readPrefs(){
  try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(PREF_KEY()) || '{}')); }
  catch(e){ return Object.assign({}, DEFAULTS); }
}
function savePrefs(p){
  try { localStorage.setItem(PREF_KEY(), JSON.stringify(p)); } catch(e){}
}
function applyPrefs(){
  const p = readPrefs();
  document.documentElement.dataset.textSize = ['large','xlarge'].includes(p.textSize) ? p.textSize : 'normal';
  document.documentElement.classList.toggle('liftr-reduce-motion', !!p.reducedMotion);
  document.documentElement.classList.toggle('liftr-quotes-off', !p.quotes);
  const lang = localStorage.getItem('liftr_language') || p.language || 'fr';
  setLanguage(lang);
}
function shortcutIds(){
  try {
    const value = JSON.parse(localStorage.getItem(SHORTCUT_KEY()) || 'null');
    return Array.isArray(value) ? value : (window.LIFTR_SHORTCUTS || []).map(x => x.id);
  } catch(e){ return (window.LIFTR_SHORTCUTS || []).map(x => x.id); }
}
function shortcutSettingsHtml(){
  const selected = new Set(shortcutIds());
  return (window.LIFTR_SHORTCUTS || []).map(x => '<label class="pref-check"><input type="checkbox" name="liftrShortcut" value="' + x.id + '"' + (selected.has(x.id) ? ' checked' : '') + '><span>' + x.name + '</span></label>').join('');
}
function isIOS(){
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalone(){
  return !!navigator.standalone || !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}
function updateNotificationSettings(){
  const status = $('prefNotificationStatus');
  const button = $('prefNotificationPermission');
  const toggle = $('prefRestNotifications');
  if (toggle) toggle.checked = !!readPrefs().restTimerNotifications;
  if (!status || !button) return;
  button.disabled = false;
  if (!window.isSecureContext || typeof window.Notification === 'undefined'){
    status.textContent = 'This browser does not support notifications.';
    button.disabled = true;
  } else if (isIOS() && !isStandalone()){
    status.textContent = 'On iPhone, add LIFTR to the Home Screen before enabling notifications.';
    button.textContent = 'Add to Home Screen first';
    button.disabled = true;
  } else if (Notification.permission === 'granted'){
    status.textContent = 'Notification permission is enabled for this device.';
    button.textContent = 'Notifications allowed';
    button.disabled = true;
  } else if (Notification.permission === 'denied'){
    status.textContent = 'Notifications are blocked in this browser. Allow them in device settings.';
    button.textContent = 'Open device settings';
    button.disabled = true;
  } else {
    status.textContent = 'Tap “Enable phone notifications” to allow alerts.';
    button.textContent = 'Enable phone notifications';
  }
}
async function enableRestTimerNotifications(){
  if (!window.isSecureContext || typeof window.Notification === 'undefined' || (isIOS() && !isStandalone())){
    updateNotificationSettings();
    return false;
  }
  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  if (permission === 'granted'){
    const prefs = readPrefs();
    prefs.restTimerNotifications = true;
    savePrefs(prefs);
    if ($('prefRestNotifications')) $('prefRestNotifications').checked = true;
  }
  updateNotificationSettings();
  if (permission !== 'granted' && typeof window.toast === 'function') toast('Phone notifications were not enabled.');
  return permission === 'granted';
}
function ensureModal(){
  if ($('liftrPreferences')) return;
  const root = document.createElement('div');
  root.id = 'liftrPreferences';
  root.className = 'overlay';
  root.setAttribute('aria-hidden','true');
  root.innerHTML = '<div class="modal liftr-prefs-modal" role="dialog" aria-modal="true" aria-labelledby="liftrPrefsTitle">' +
    '<div class="grabber"></div><div class="modal-top"><div><div class="modal-title" id="liftrPrefsTitle">Settings &amp; personalization</div><div class="modal-sub">Settings are saved on this device. Gym and Nutrition remain available offline.</div></div><button class="modal-x" type="button" onclick="closeAppPreferences()" aria-label="Close">×</button></div>' +
    '<section class="pref-section"><h3>Language &amp; comfort</h3><label class="pref-row"><span>Language</span><select id="prefLanguage" class="input"><option value="fr">Français</option><option value="en">English</option></select></label>' +
    '<label class="pref-row"><span>Text size</span><select id="prefTextSize" class="input"><option value="normal">Normal</option><option value="large">Large</option><option value="xlarge">Extra large</option></select></label>' +
    '<label class="pref-toggle"><span><b>Reduce motion</b><small>Limits movement and transitions.</small></span><input id="prefReducedMotion" type="checkbox"></label>' +
    '<label class="pref-toggle"><span><b>Motivational quotes</b><small>Show motivational messages after a workout.</small></span><input id="prefQuotes" type="checkbox"></label></section>' +
    '<section class="pref-section"><h3>Notifications</h3><label class="pref-toggle"><span><b>Alert me when rest ends</b><small>Send a phone notification when a rest period ends while LIFTR is in the background.</small></span><input id="prefRestNotifications" type="checkbox"></label>' +
    '<div class="pref-notification-status" id="prefNotificationStatus" role="status" aria-live="polite"></div><div class="pref-notification-actions"><button class="btn btn-sm" type="button" id="prefNotificationPermission" onclick="enableRestTimerNotifications()">Enable phone notifications</button><button class="btn btn-sm btn-ghost" type="button" onclick="openNotifications()">Manage Social notifications</button></div>' +
    '<p class="pref-note">The timer keeps its end time on this device. Mobile browsers may pause background work, so an alert can arrive late. A live lock screen timer needs a native iOS or Android app.</p></section>' +
    '<section class="pref-section"><div class="pref-section-head"><div><h3>Shortcuts</h3><p>Choose which actions appear in the ⌘K / Ctrl K search.</p></div><button class="text-link" type="button" onclick="selectAllLiftrShortcuts()">Select all</button></div><div class="pref-shortcuts">' + shortcutSettingsHtml() + '</div></section>' +
    '<div class="modal-actions"><button class="btn" type="button" onclick="closeAppPreferences()">Cancel</button><button class="btn btn-primary" type="button" onclick="saveAppPreferences()">Save settings</button></div></div>';
  root.addEventListener('click', e => { if (e.target === root) closeAppPreferences(); });
  document.body.appendChild(root);
}
function openAppPreferences(){
  ensureModal();
  const p = readPrefs();
  $('prefLanguage').value = localStorage.getItem('liftr_language') || p.language || currentLanguage();
  $('prefTextSize').value = p.textSize;
  $('prefReducedMotion').checked = !!p.reducedMotion;
  $('prefQuotes').checked = !!p.quotes;
  $('prefRestNotifications').checked = !!p.restTimerNotifications;
  updateNotificationSettings();
  $('liftrPreferences').classList.add('show');
  $('liftrPreferences').setAttribute('aria-hidden','false');
  $('prefLanguage').focus({preventScroll:true});
}
function closeAppPreferences(){
  const root = $('liftrPreferences');
  if (!root) return;
  root.classList.remove('show');
  root.setAttribute('aria-hidden','true');
}
function selectAllLiftrShortcuts(){
  document.querySelectorAll('#liftrPreferences [name="liftrShortcut"]').forEach(x => { x.checked = true; });
}
function saveAppPreferences(){
  const p = {
    language: $('prefLanguage').value === 'en' ? 'en' : 'fr',
    textSize: ['large','xlarge'].includes($('prefTextSize').value) ? $('prefTextSize').value : 'normal',
    reducedMotion: $('prefReducedMotion').checked,
    quotes: $('prefQuotes').checked,
    restTimerNotifications: $('prefRestNotifications').checked
  };
  savePrefs(p);
  try { localStorage.setItem('liftr_language', p.language); } catch(e){}
  const picked = Array.from(document.querySelectorAll('#liftrPreferences [name="liftrShortcut"]:checked')).map(x => x.value);
  if (!picked.length){ toast('Garde au moins un raccourci.'); return; }
  try { localStorage.setItem(SHORTCUT_KEY(), JSON.stringify(picked)); } catch(e){}
  applyPrefs();
  if (typeof window.refreshShortcutCommands === 'function') window.refreshShortcutCommands();
  closeAppPreferences();
  if (typeof window.toast === 'function') toast('Préférences enregistrées');
}
function maybeShowFirstUseHelp(){
  ensureModal();
  const key = 'liftr_first_help_' + (window.currentUser || 'guest');
  if (localStorage.getItem(key)) return;
  localStorage.setItem(key, '1');
  setTimeout(() => {
    const root = $('liftrPreferences');
    if (!root || !window.currentUser) return;
    const modal = root.querySelector('.modal');
    modal.insertAdjacentHTML('afterbegin', '<div class="first-help"><span class="help-eyebrow">BIENVENUE SUR LIFTR</span><h2>Tout est prêt pour commencer.</h2><p><b>Gym</b> pour créer un programme, suivre tes séries et tes records. <b>Nutrition</b> pour noter tes repas et enregistrer tes aliments, même hors ligne. <b>Social</b> reste facultatif et nécessite une connexion.</p><div class="help-acts"><button type="button" class="btn btn-sm" onclick="showRoot(\'gym\');closeAppPreferences()">Ouvrir Gym</button><button type="button" class="btn btn-sm" onclick="showRoot(\'nutrition\');closeAppPreferences()">Ouvrir Nutrition</button><button type="button" class="text-link" onclick="this.closest(\'.first-help\').remove()">J’ai compris</button></div></div>');
    openAppPreferences();
  }, 900);
}
function openGettingStartedHelp(){
  ensureModal();
  const modal = $('liftrPreferences').querySelector('.modal');
  const old = modal.querySelector('.first-help');
  if (old) old.remove();
  modal.insertAdjacentHTML('afterbegin', '<div class="first-help"><span class="help-eyebrow">BIENVENUE SUR LIFTR</span><h2>Gym, Nutrition et Social au même endroit.</h2><p><b>Gym</b> : crée ton programme, ajoute tes exercices puis suis séries, repos et records. <b>Nutrition</b> : consigne repas, aliments et recettes; les données restent sur cet appareil. <b>Social</b> : partage tes séances et échange avec d’autres personnes quand tu es connecté.</p><div class="help-acts"><button type="button" class="btn btn-sm" onclick="showRoot(\'gym\');closeAppPreferences()">Ouvrir Gym</button><button type="button" class="btn btn-sm" onclick="showRoot(\'nutrition\');closeAppPreferences()">Ouvrir Nutrition</button><button type="button" class="text-link" onclick="this.closest(\'.first-help\').remove()">J’ai compris</button></div></div>');
  openAppPreferences();
}

window.openAppPreferences = openAppPreferences;
window.closeAppPreferences = closeAppPreferences;
window.saveAppPreferences = saveAppPreferences;
window.selectAllLiftrShortcuts = selectAllLiftrShortcuts;
window.maybeShowFirstUseHelp = maybeShowFirstUseHelp;
window.openGettingStartedHelp = openGettingStartedHelp;
window.getLiftrPreferences = readPrefs;
window.enableRestTimerNotifications = enableRestTimerNotifications;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyPrefs, {once:true}); else applyPrefs();
