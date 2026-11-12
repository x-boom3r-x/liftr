/* LIFTR vector illustrations: small, geometric, inline and offline-safe. */
const ART = {
  training: '<path d="M10 26v12M16 22v20M48 22v20M54 26v12M16 32h32"/><path d="M8 24v16M56 24v16" stroke="var(--primary)"/>',
  calendar: '<rect x="10" y="12" width="44" height="42" rx="6"/><path d="M10 23h44M21 8v9M43 8v9M20 32h4M31 32h4M42 32h4M20 42h4M31 42h4"/><path d="m40 43 3 3 7-8" stroke="var(--primary)"/>',
  award: '<circle cx="32" cy="27" r="17"/><path d="m25 43-4 13 11-5 11 5-4-13" stroke="var(--primary)"/><path d="m32 17 3.1 6.3 6.9 1-5 4.9 1.2 6.8L32 32.8l-6.2 3.2 1.2-6.8-5-4.9 6.9-1z"/>',
  community: '<circle cx="24" cy="23" r="7"/><circle cx="43" cy="25" r="6"/><path d="M9 51c1-10 6-15 15-15s14 5 15 15M36 39c8-3 17 2 19 11"/><path d="M18 54h28" stroke="var(--primary)"/>',
  message: '<path d="M10 13h31a7 7 0 0 1 7 7v14a7 7 0 0 1-7 7H25l-11 8v-9a7 7 0 0 1-4-6V20a7 7 0 0 1 7-7z"/><path d="M25 48h18l9 6v-9a7 7 0 0 0 4-6v-9" stroke="var(--primary)"/>',
  scan: '<path d="M11 12v40M17 12v40M22 12v40M29 12v40M34 12v40M42 12v40M47 12v40M53 12v40"/><path d="M7 8h8M7 8v8M57 8h-8M57 8v8M7 56h8M7 56v-8M57 56h-8M57 56v-8" stroke="var(--primary)"/>',
  meal: '<path d="M11 33a21 21 0 0 0 42 0z"/><path d="M8 28h48M18 21c0-6 4-10 9-12M32 21c0-6 4-10 9-12"/><path d="M23 43h18" stroke="var(--primary)"/>'
};

export function illustration(name, extraClass = ''){
  const art = ART[name] || ART.training;
  const cls = extraClass ? ' liftr-illustration--' + extraClass : '';
  return '<svg class="liftr-illustration' + cls + '" viewBox="0 0 64 64" fill="none" ' +
    'stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true" focusable="false">' + art + '</svg>';
}
