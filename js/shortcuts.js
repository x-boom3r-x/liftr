/* Fast, keyboard-accessible routes to the most used LIFTR actions. */
const ICONS = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  training: '<path d="M3 9v6M6 6v12M6 12h12M18 6v12M21 9v6"/>',
  plan: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4m8-4v4M4 9h16M8 13h3m-3 4h8"/>',
  progress: '<path d="M4 19V5m0 14h17M8 15l4-4 3 2 5-6"/>',
  food: '<path d="M4 13a8 8 0 0 0 16 0zM3 10h18M7 7c0-2 1-3 3-4m4 4c0-2 1-3 3-4"/>',
  scan: '<path d="M4 5v14M7 5v14M10 5v14M14 5v14M17 5v14M20 5v14"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 20c.6-4 2.6-6 6-6s5.4 2 6 6m1-9a3 3 0 1 0-1-5m2 8c2.2.5 3.5 2 4 5"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
  message: '<path d="M4 5h16v12H9l-5 4z"/>',
  bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12h4"/>',
  share: '<path d="M12 15V3m-5 5 5-5 5 5M5 13v7h14v-7"/>'
};

const COMMANDS = [
  { id:'today', label:'Accueil', detailLabel:'Ton tableau de bord hors ligne', name: 'Today', detail: 'Your offline dashboard', group: 'LIFTR', icon: 'home', action: () => window.showRoot('today') },
  { id:'workout', label:'Démarrer une séance', detailLabel:'Enregistrer une séance d’entraînement', name: 'Start workout', detail: 'Log a training session', group: 'GYM', icon: 'training', action: () => window.runQuickAction('workout') },
  { id:'plan', label:'Programme', detailLabel:'Créer ou modifier tes journées', name: 'Training plan', detail: 'Build or edit your days', group: 'GYM', icon: 'plan', action: () => window.showRoot('gym', 'programme') },
  { id:'gym-progress', label:'Progrès Gym', detailLabel:'Statistiques, records et tendances', name: 'Training progress', detail: 'Stats, records and trends', group: 'GYM', icon: 'progress', action: () => window.showRoot('gym', 'stats') },
  { id:'diary', label:'Journal alimentaire', detailLabel:'Ajouter des aliments aujourd’hui', name: 'Food diary', detail: 'Add food to today', group: 'NUTRITION', icon: 'food', action: () => window.runQuickAction('meal') },
  { id:'scan', label:'Scanner un aliment', detailLabel:'Rechercher un produit emballé', name: 'Scan a barcode', detail: 'Find a packaged food', group: 'NUTRITION', icon: 'scan', action: () => window.runQuickAction('scan') },
  { id:'foods', label:'Bibliothèque d’aliments', detailLabel:'Rechercher dans tes aliments enregistrés', name: 'Food library', detail: 'Search saved and verified foods', group: 'NUTRITION', icon: 'food', action: () => window.showRoot('nutrition', 'nutri-foods') },
  { id:'nutrition-goals', label:'Objectifs nutritionnels', detailLabel:'Régler tes cibles quotidiennes', name: 'Nutrition goals', detail: 'Set daily targets', group: 'NUTRITION', icon: 'progress', action: () => window.showRoot('nutrition', 'nutri-goal') },
  { id:'social', label:'Fil Social', detailLabel:'Voir les publications de ton cercle', name: 'Social feed', detail: 'See your training crew', group: 'SOCIAL', icon: 'people', action: () => window.showRoot('feed') },
  { id:'people', label:'Découvrir des personnes', detailLabel:'Rechercher des profils Social', name: 'Find lifters', detail: 'Search Social profiles', group: 'SOCIAL', icon: 'search', action: () => window.runQuickAction('search') },
  { id:'messages', label:'Messages', detailLabel:'Ouvrir ta boîte de réception Social', name: 'Messages', detail: 'Open your Social inbox', group: 'SOCIAL', icon: 'message', action: () => window.runQuickAction('messages') },
  { id:'notifications', label:'Notifications Social', detailLabel:'J’aime, commentaires et abonnements', name: 'Notifications', detail: 'Likes, comments and follows', group: 'SOCIAL', icon: 'bell', action: () => window.runQuickAction('notifications') },
  { id:'share', label:'Partager un progrès', detailLabel:'Créer une publication Social', name: 'Share progress', detail: 'Write a Social post', group: 'SOCIAL', icon: 'share', action: () => window.runQuickAction('post') }
];
window.LIFTR_SHORTCUTS = COMMANDS;

let matches = COMMANDS;
let activeIndex = -1;
let returnFocus = null;

function byId(id){ return document.getElementById(id); }
function normalized(value){
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function visibleCommands(){
  try {
    const user = window.currentUser || 'guest';
    const saved = JSON.parse(localStorage.getItem('liftr_shortcuts_' + user) || 'null');
    return Array.isArray(saved) && saved.length ? COMMANDS.filter(item => saved.includes(item.id)) : COMMANDS;
  } catch(e){ return COMMANDS; }
}
function icon(name){
  return '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || ICONS.home) + '</svg>';
}
function draw(){
  const host = byId('shortcutResults');
  if (!host) return;
  const q = normalized(byId('shortcutQuery')?.value);
  matches = visibleCommands().filter(item => normalized([item.name, item.label, item.detail, item.group].join(' ')).includes(q));
  activeIndex = matches.length ? Math.min(Math.max(activeIndex, 0), matches.length - 1) : -1;
  if (!matches.length){
    host.innerHTML = '<div class="shortcut-empty">No matching action. Try “workout”, “food” or “messages”.</div>';
    return;
  }
  const french = document.documentElement.lang === 'fr';
  host.innerHTML = matches.map((item, index) =>
    '<button type="button" class="shortcut-option' + (index === activeIndex ? ' is-active' : '') + '" ' +
      'data-shortcut-index="' + index + '" aria-current="' + (index === activeIndex ? 'true' : 'false') + '">' +
      '<span class="shortcut-option-icon">' + icon(item.icon) + '</span>' +
      '<span class="shortcut-option-copy"><b>' + (french ? item.label : item.name) + '</b><small>' + (french ? item.detailLabel : item.detail) + '</small></span>' +
      '<span class="shortcut-option-group">' + item.group + '</span>' +
    '</button>'
  ).join('');
}
function openShortcutPalette(){
  const dialog = byId('shortcutDialog');
  if (!dialog) return false;
  returnFocus = document.activeElement;
  activeIndex = 0;
  byId('shortcutQuery').value = '';
  draw();
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => byId('shortcutQuery')?.focus());
  return true;
}
function closeShortcutPalette(){
  const dialog = byId('shortcutDialog');
  if (dialog?.open) dialog.close();
  byId('shortcutQuery').value = '';
  if (returnFocus && typeof returnFocus.focus === 'function') returnFocus.focus();
  returnFocus = null;
}
function choose(index){
  const item = matches[index];
  if (!item) return false;
  closeShortcutPalette();
  setTimeout(() => item.action(), 30);
  return true;
}
function initShortcuts(){
  const dialog = byId('shortcutDialog');
  const input = byId('shortcutQuery');
  const keyHint = byId('shortcutKeyHint');
  if (!dialog || !input) return;
  const apple = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  if (keyHint) keyHint.textContent = apple ? '⌘ K' : 'Ctrl K';
  input.addEventListener('input', () => { activeIndex = 0; draw(); });
  byId('shortcutResults').addEventListener('click', event => {
    const button = event.target.closest('[data-shortcut-index]');
    if (button) choose(Number(button.dataset.shortcutIndex));
  });
  byId('shortcutResults').addEventListener('pointerover', event => {
    const button = event.target.closest('[data-shortcut-index]');
    if (!button) return;
    activeIndex = Number(button.dataset.shortcutIndex);
    byId('shortcutResults').querySelectorAll('[data-shortcut-index]').forEach(option => {
      const active = Number(option.dataset.shortcutIndex) === activeIndex;
      option.classList.toggle('is-active', active);
      option.setAttribute('aria-current', active ? 'true' : 'false');
    });
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeShortcutPalette(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) closeShortcutPalette(); });
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k'){
      event.preventDefault();
      if (dialog.open) closeShortcutPalette(); else openShortcutPalette();
      return;
    }
    if (!dialog.open) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp'){
      event.preventDefault();
      if (!matches.length) return;
      activeIndex = (activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      draw();
      return;
    }
    if (event.key === 'Enter'){
      event.preventDefault();
      choose(activeIndex < 0 ? 0 : activeIndex);
    }
  });
}

Object.assign(window, { openShortcutPalette, closeShortcutPalette });
window.refreshShortcutCommands = () => { if (byId('shortcutDialog')?.open) draw(); };
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initShortcuts);
else initShortcuts();
