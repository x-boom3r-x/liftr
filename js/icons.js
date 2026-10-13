/* ==================================================================
   M3 — icônes SVG partagées : stroke 24×24, currentColor, sans
   dépendance externe. icon(name) = trait, iconS(name) = plein
   (votes, lecture). Le nom voyage dans data-i pour les tests.
   ================================================================== */

const ICONS = {
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  pencil: '<path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>' +
    '<path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z"/>',
  heart: '<path d="M12 21s-7.5-4.6-9.3-9.2C1.4 8.4 3.4 5 6.6 5c2 0 3.6 1.1 4.4 2.6h2C13.8 6.1 15.4 5 17.4 5c3.2 0 5.2 3.4 3.9 6.8C19.5 16.4 12 21 12 21z"/>',
  up: '<path d="M12 5l8 14H4z"/>',
  down: '<path d="M12 19L4 5h16z"/>',
  play: '<path d="M8 5.5v13l11-6.5z"/>',
  pause: '<path d="M7 5h3.2v14H7z"/><path d="M13.8 5H17v14h-3.2z"/>',
  bookmark: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z"/>',
  share: '<path d="M7 17 17 7"/><path d="M8 7h9v9"/>',
  chat: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4L4 21l1.2-3.6A8.4 8.4 0 1 1 21 11.5z"/>',
  mail: '<path d="M3 6.5 12 13l9-6.5"/><rect x="3" y="5" width="18" height="14" rx="2"/>',
  repost: '<path d="m17 2 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>' +
    '<path d="m7 22-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  volume: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 9.5a4 4 0 0 1 0 5"/><path d="M18.5 7a8 8 0 0 1 0 10"/>',
  mute: '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>',
  flame: '<path d="M12 22c4.4 0 7-2.9 7-6.7 0-3.2-2-5.3-3.6-7.1C13.9 6.5 13 4.6 13 2c-3 1.6-5 4.8-5 8.3 0 1.2.3 2.3.9 3.1-.6-.2-1.2-.6-1.6-1.2C6.2 13.4 5 15.1 5 17c0 3.1 2.6 5 7 5z"/>',
  memo: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>' +
    '<path d="M8 13h8"/><path d="M8 17h5"/>',
  run: '<circle cx="13.5" cy="4" r="1.6"/><path d="m9 21 2-5-2.5-2 1-5 3.5 2 2 3"/><path d="m6 12 2.5-3"/><path d="m15 21-1.5-4"/>',
  flex: '<path d="m6.5 6.5 11 11"/><path d="m21 21-1-1"/><path d="m3 3 1 1"/><path d="m18 22 4-4"/>' +
    '<path d="m2 6 4-4"/><path d="m3 10 7 7"/><path d="m14 4 7 7"/>',
  scale: '<path d="M12 3v18"/><path d="M5 8h14"/><path d="M5 8 2.5 14h5z"/><path d="m19 8-2.5 6h5z"/><path d="M8 21h8"/>',
  chartup: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m7 14 4-4 3 3 5-6"/><path d="M15 7h4v4"/>',
  clipboard: '<path d="M9 3h6v3H9z"/><path d="M8 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>',
  trophy: '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/>' +
    '<path d="M7 6H4.5A1.5 1.5 0 0 0 3 7.5v.5a4 4 0 0 0 4 4"/><path d="M17 6h2.5A1.5 1.5 0 0 1 21 7.5v.5a4 4 0 0 1-4 4"/>',
  mobile: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  dot: '<circle cx="12" cy="12" r="3.5"/>'
};

const SOLID = { up: 1, down: 1, play: 1, pause: 1 };

function icon(name, solid){
  const fill = solid || SOLID[name];
  return '<svg class="ico" data-i="' + name + '" viewBox="0 0 24 24" fill="' +
    (fill ? 'currentColor' : 'none') + '" stroke="' + (fill ? 'none' : 'currentColor') +
    '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (ICONS[name] || '') + '</svg>';
}
function iconS(name){ return icon(name, true); }

export { icon, iconS };
window.icon = icon;
window.iconS = iconS;
