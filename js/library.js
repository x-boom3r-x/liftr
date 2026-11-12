/* ==================================================================
   LIFTR - écran Library (sous-onglet Muscu)
   Bibliothèque d'exercices en plein écran : utilise le catalogue
   openGym (5 632 exercices) comme source, avec recherche FR/EN,
   filtres muscle/équipement/catégorie, carte musculaire, favori,
   récent et exercices personnalisés.

   Source : loadCatalogue() (js/gym/exercises.js) ; libThumb et la
   carte sont disponibles globalement (exercise-demo.js, bodymap.js).
   ================================================================== */

import {
  loadCatalogue,
  searchExercises,
  filterByMuscle,
  filterByEquipment,
  filterByCategory,
  getExercise,
  aliasFrToEn,
  makeCustomExercise,
} from './gym/exercises.js';

/* Local persistence (favoris / récents) pour l'écran Library. */
let libFavorites = new Set();
let libRecent = new Set();

function loadFavorites(){
  try {
    const s = localStorage.getItem('liftr_lib_favs');
    libFavorites = new Set(s ? JSON.parse(s) : []);
  } catch (_) { libFavorites = new Set(); }
}
function saveFavorites(){
  try { localStorage.setItem('liftr_lib_favs', JSON.stringify(Array.from(libFavorites))); } catch (_) {}
}
function loadRecent(){
  try {
    const s = localStorage.getItem('liftr_lib_recents');
    libRecent = new Set(s ? JSON.parse(s) : []);
  } catch (_) { libRecent = new Set(); }
}
function saveRecent(){
  try { localStorage.setItem('liftr_lib_recents', JSON.stringify(Array.from(libRecent))); } catch (_) {}
}
function markRecent(name){
  libRecent.add(name);
  const all = Array.from(libRecent);
  if (all.length > 10) libRecent = new Set(all.slice(all.length - 10));
  saveRecent();
}

/* Catalogue chargé (lazy, en cache) – résolu de façon asynchrone. */
let catalogue = null;
const cataloguePromise = loadCatalogue();

/* ---- État de l'écran ---- */
let libScreenFilter = 'All';
let libScreenQuery = '';
let libScreenSort = 'name';
let libScreenFav = 'All';
let libScreenRec = 'All';

function muscleLabel(part){
  return (part || 'Autre').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
function groupLabel(part){
  if (!part) return 'Autre';
  return muscleLabel(part);
}

function buildList(exes){
  return exes.filter(ex => {
    if (libScreenFav !== 'All' && libScreenFav !== 'Custom' && !libFavorites.has(ex.name)) return false;
    if (libScreenFav === 'Custom' && !(ex.category === 'custom')) return false;
    if (libScreenFav === 'Custom' && libFavorites.has(ex.name)) return false;
    if (libScreenRec !== 'All' && libScreenRec !== 'Custom' && !libRecent.has(ex.name)) return false;
    if (libScreenRec === 'Custom' && !libRecent.has(ex.name)) return false;
    if (libScreenQuery.trim()){
      const q = libScreenQuery.trim().toLowerCase();
      const hay = `${ex.name || ''} ${ex.bodyPart || ''} ${ex.aliases_en || ''} ${ex.aliases_fr || ''} ${ex.category || ''} ${ex.equipment || ''} ${ex.target || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

async function renderLibraryScreen(){
  const exes = await cataloguePromise;
  if (!Array.isArray(exes) || !exes.length){
    $('libScreenGrid').innerHTML = '<div class="lib-empty">Le catalogue n\'est pas encore disponible.</div>';
    return;
  }
  let list = buildList(exes);
  if (libScreenFilter === 'Custom') list = list.filter(ex => ex.category === 'custom');
  else if (libScreenFilter !== 'All') list = list.filter(ex => matchesLibraryMuscle(ex, libScreenFilter));

  if (libScreenSort === 'recent') list = list.sort((a,b) => (b._lastUsed||0) - (a._lastUsed||0));
  else if (libScreenSort === 'used') list = list.sort((a,b) => (b.usageCount||0) - (a.usageCount||0));
  else list = list.sort((a,b) => (a.name||'').localeCompare(b.name||''));

  const bodyParts = [...new Set(exes.map(e => e.bodyPart).filter(Boolean))].sort();
  const groups = ['All'].concat(bodyParts, (list.filter(e => e.category === 'custom').length) ? ['Custom'] : []);
  const counts = { All: list.length };
  list.forEach(e => { const g = e.group || e.bodyPart || 'other'; counts[g] = (counts[g] || 0) + 1; });

  const chips = $('libScreenChips');
  if (chips){
    chips.innerHTML = groups.map(g => {
      const n = g === 'All' ? counts[g] : (counts[g] || 0);
      return '<button class="lib-chip' + (libScreenFilter === g ? ' on' : '') + '" data-g="' + g + '">' + esc(g) + ' <span class="n">' + n + '</span></button>';
    }).join('');
    chips.querySelectorAll('.lib-chip').forEach(b => {
      b.onclick = async () => {
        libScreenFilter = (libScreenFilter === b.dataset.g && b.dataset.g !== 'All') ? 'All' : b.dataset.g;
        await renderLibraryScreen();
      };
    });
  }

  const mapEl = $('libScreenMap');
  if (mapEl){
    const clickable = libScreenFilter !== 'All';
    mapEl.innerHTML = bodyMapHtml({ scores: muscleScores(30), selected: clickable ? libScreenFilter : '', select: true, days: 30 });
    mapEl.querySelectorAll('.bm-hit').forEach(el => {
      el.onclick = async () => {
        libScreenFilter = (libScreenFilter === el.dataset.m) ? 'All' : el.dataset.m;
        await renderLibraryScreen();
      };
    });
  }
  const sub = $('libMapSub');
  if (sub) sub.textContent = libScreenFilter === 'All' ? 'Tout le catalogue : ' + list.length + ' exercices' : 'Filtre : ' + libScreenFilter;
  const range = $('libMapRange');
  const programDays = (typeof window.getActiveProgrammeDays === 'function')
    ? getActiveProgrammeDays().length : (DB.programme || []).length;
  const hist = (DB.history || []).length;
  if (range) range.textContent = hist ? '30 D' : 'NEW';

  const grid = $('libScreenGrid');
  if (grid){
    grid.innerHTML = list.length
      ? list.map(ex => {
          const thumb = libThumb(ex.name);
          const isFav = libFavorites.has(ex.name);
          const isRec = libRecent.has(ex.name);
          const nameH = esc(ex.name);
          const hint = [ex.category || '', ex.equipment || '', ex.target || ''].filter(Boolean).join(' · ');
          const row = [nameH];
          if (hint) row.push('<span class="grp">' + esc(hint) + '</span>');
          return '<button class="lib-item' + (isFav ? ' fav' : '') + (isRec ? ' rec' : '') + '" data-name="' + esc(ex.name) + '">' +
            thumb +
            '<span>' + row.join('') + '</span>' +
            '<span class="lib-tick">' + (isFav ? '★' : '›') + '</span>' +
            '</button>';
        }).join('')
      : '<div class="lib-empty">Aucun résultat.</div>';
    grid.querySelectorAll('.lib-item').forEach(b => {
      b.onclick = () => libScreenPick(b.dataset.name);
    });
  }

  const hint = $('libScreenHint');
  if (hint) hint.textContent = list.length + ' exercise' + (list.length !== 1 ? 's' : '') + ' · ' + programDays + ' session' + (programDays !== 1 ? 's' : '') + ' in your program';
}

function normalizeForAlias(s){
  return String(s || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function onLibScreenSearch(v){
  const q = normalizeForAlias(v);
  const alias = aliasFrToEn(q);
  libScreenQuery = alias !== null ? alias : v;
  libScreenFilter = libScreenQuery.trim() ? 'All' : libScreenFilter;
  renderLibraryScreen();
}

function bmPick(muscle){
  if (!muscle) return;
  libScreenFilter = libScreenFilter === muscle ? 'All' : muscle;
  if (currentTab !== 'library') showTab('library');
  else renderLibraryScreen();
}

function matchesLibraryMuscle(ex, filter){
  const part = normalizeForAlias(ex.bodyPart);
  const key = normalizeForAlias(filter);
  if (part === key) return true;
  const anatomy = normalizeForAlias([ex.target || '', ...(ex.secondaryMuscles || [])].join(' '));
  const aliases = {
    back: ['back', 'lats', 'traps', 'rhomboids'], 'upper-back': ['back', 'lats', 'traps', 'rhomboids'],
    'lower-back': ['lower back', 'erectors', 'back'], trapezius: ['traps', 'trapezius'],
    chest: ['chest', 'pectorals'], serratus: ['serratus'],
    shoulders: ['shoulders', 'delts', 'rotator cuff'], deltoids: ['delts', 'shoulders', 'rotator cuff'],
    arms: ['upper arms', 'lower arms', 'biceps', 'triceps', 'forearms'],
    biceps: ['biceps'], triceps: ['triceps'], forearm: ['forearm', 'forearms', 'grip'],
    legs: ['upper legs', 'lower legs', 'quads', 'quadriceps', 'hamstrings', 'adductors', 'glutes', 'calves', 'tibialis', 'hip flexors'],
    quadriceps: ['quads', 'quadriceps'], hamstring: ['hamstrings', 'hamstring'],
    adductors: ['adductors'], 'hip-flexors': ['hip flexors'], calves: ['calves', 'gastrocnemius'], tibialis: ['tibialis'],
    glutes: ['glutes', 'glute'], gluteal: ['glutes', 'glute'],
    core: ['waist', 'abs', 'obliques', 'core'], abs: ['abs', 'core'], obliques: ['obliques']
  };
  const terms = aliases[key] || [key];
  return terms.some(term => part === term || anatomy.includes(term));
}

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
  markRecent(name);
}

function libScreenAddTo(name){
  const days = DB.programme || [];
  if (!days.length){ toast('Create a session first.'); return; }
  openActionSheet('Add “' + name + '” to…', days.map(d => {
    const has = d.exercises.some(e => e.name.toLowerCase() === name.toLowerCase());
    return { label: (has ? '✓ ' : '+ ') + d.name, fn: () => libAddToDay(d.id, name) };
  }));
}

function libAddToDay(dayId, name){
  const d = DB.programme.find(x => x.id === dayId);
  if (!d) return;
  const i = d.exercises.findIndex(e => e.name.toLowerCase() === name.toLowerCase());
  if (i >= 0) d.exercises.splice(i, 1);
  else d.exercises.push({ id: uid(), name: name, cardio: isCardioName(name) || undefined });
  save();
  renderDayExercises(); renderProgramme(); renderSeance(); renderLibrary();
}

function toggleFavorite(name){
  if (libFavorites.has(name)) libFavorites.delete(name);
  else libFavorites.add(name);
  saveFavorites();
  renderLibraryScreen();
}

function toggleRecent(name){
  if (libRecent.has(name)) libRecent.delete(name);
  else { libRecent.add(name); markRecent(name); }
  saveRecent();
  renderLibraryScreen();
}

/* Renderiser & exposer en globals. */
cataloguePromise.then(() => renderLibraryScreen()).catch(() => {});
Object.assign(window, {
  renderLibraryScreen, onLibScreenSearch, bmPick, matchesLibraryMuscle,
  libScreenPick, libScreenAddTo, toggleFavorite, toggleRecent,
  libScreenFilter, libScreenQuery, libScreenSort, libScreenFav, libScreenRec,
});
