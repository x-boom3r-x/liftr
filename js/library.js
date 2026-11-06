/* ==================================================================
   LIFTR - écran Library (sous-onglet Muscu)
   Bibliothèque d'exercices en plein écran : carte musculaire cliquable,
   filtres par groupe, recherche, fiche rapide (démo + ajout au programme).
   ================================================================== */

let libScreenFilter = 'All';
let libScreenQuery = '';

function libScreenCounts(){
  const all = (typeof window.libEntries === 'function') ? libEntries() : [];
  const counts = { All: all.length };
  all.forEach(e => { counts[e.group] = (counts[e.group] || 0) + 1; });
  return { all: all, counts: counts };
}

function libScreenList(){
  const { all, counts } = libScreenCounts();
  const q = libScreenQuery.toLowerCase().trim();
  const list = all.filter(e =>
    (libScreenFilter === 'All' || e.group === libScreenFilter || e.group === 'Custom') &&
    (!q || e.name.toLowerCase().includes(q) || e.group.toLowerCase().includes(q))
  );
  return { list: list, counts: counts, total: all.length };
}

function renderLibraryScreen(){
  const { list, counts, total } = libScreenList();
  const days = (DB.programme || []).length;
  const hist = (DB.history || []).length;

  /* carte musculaire : filtre actif mis en évidence */
  const mapEl = $('libScreenMap');
  if (mapEl){
    const clickable = libScreenFilter !== 'All';
    mapEl.innerHTML = bodyMapHtml({
      scores: muscleScores(30),
      selected: clickable ? libScreenFilter : '',
      select: true,
      days: 30
    });
  }
  const sub = $('libMapSub');
  if (sub){
    sub.textContent = libScreenFilter === 'All'
      ? 'Tap a muscle to filter the library'
      : 'Filtered on ' + libScreenFilter + ' · tap it again to reset';
  }

  /* chips de groupes */
  const chips = $('libScreenChips');
  if (chips){
    const groups = ['All'].concat(Object.keys(LIB),
      counts['Custom'] ? ['Custom'] : []);
    chips.innerHTML = groups.map(g => {
      const n = g === 'All' ? total : (counts[g] || 0);
      return '<button class="lib-chip' + (libScreenFilter === g ? ' on' : '') +
        '" data-g="' + g + '">' + esc(g) + ' <span class="n">' + n + '</span></button>';
    }).join('');
    chips.querySelectorAll('.lib-chip').forEach(b => {
      b.onclick = () => {
        libScreenFilter = (libScreenFilter === b.dataset.g && b.dataset.g !== 'All')
          ? 'All' : b.dataset.g;
        renderLibraryScreen();
      };
    });
  }

  /* grille */
  const grid = $('libScreenGrid');
  if (grid){
    grid.innerHTML = list.length
      ? list.map(e =>
          '<button class="lib-item" data-name="' + esc(e.name) + '">' +
            libThumb(e.name) +
            '<span>' + esc(e.name) + '<span class="grp">' + esc(e.group) + '</span></span>' +
            '<span class="lib-tick">›</span>' +
          '</button>').join('')
      : '<div class="lib-empty">No result.<br>Try another muscle or search.</div>';
    grid.querySelectorAll('.lib-item').forEach(b => {
      b.onclick = () => libScreenPick(b.dataset.name);
    });
  }

  const hint = $('libScreenHint');
  if (hint){
    hint.textContent = list.length + ' exercise' + (list.length !== 1 ? 's' : '') +
      (libScreenFilter !== 'All' ? ' · ' + libScreenFilter : '') +
      ' · ' + days + ' session' + (days !== 1 ? 's' : '') + ' in your program';
  }
  const range = $('libMapRange');
  if (range) range.textContent = hist ? '30 D' : 'NEW';
}

function onLibScreenSearch(v){
  libScreenQuery = v;
  if (v.trim() && libScreenFilter !== 'All') libScreenFilter = 'All';
  renderLibraryScreen();
}

/* Clic sur une zone de la carte musculaire (global, appelé par le SVG) */
function bmPick(muscle){
  if (!muscle) return;
  libScreenFilter = (libScreenFilter === muscle) ? 'All' : muscle;
  if (currentTab !== 'library') showTab('library');
  else renderLibraryScreen();
}

/* Fiche rapide d'un exercice : démo + ajout au programme */
function libScreenPick(name){
  const days = DB.programme || [];
  const acts = [];
  acts.push({ label: 'Watch the demo', fn: () => openDemo(name) });
  if (!days.length){
    acts.push({ label: 'Create a session first to add it', fn: () => showTab('programme') });
  } else {
    acts.push({ label: 'Add to a session…', fn: () => libScreenAddTo(name) });
  }
  openActionSheet(name, acts);
}

function libScreenAddTo(name){
  const days = DB.programme || [];
  if (!days.length){ toast('Create a session first.'); return; }
  openActionSheet('Add “' + name + '” to…', days.map(d => {
    const has = d.exercises.some(e => e.name.toLowerCase() === name.toLowerCase());
    return {
      label: (has ? '✓ ' : '+ ') + d.name,
      fn: () => libAddToDay(d.id, name)
    };
  }));
}

Object.assign(window, {
  renderLibraryScreen, onLibScreenSearch, bmPick,
  libScreenPick, libScreenAddTo
});
