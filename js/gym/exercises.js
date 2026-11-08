/* ── js/gym/exercises.js ────────────────────────────────────────────────
    Catalogue d'exercices openGym (5 632 entrées) – porté en vanilla JS.
    Licence : les textes d'exercices sont AGPL/MIT, mais ce module ne
    contient que des données pures (id/name/part/equip/cat) et des
    fonctions de recherche/filtre ; aucun code AGPL n'est copié.
    Usage (ESM) : import { searchExercises, getExercise, filterByMuscle }
                    from './gym/exercises.js';
  -------------------------------------------------------------------------*/

const EXO_ALIASES = (() => {
  // Mapping français → nom anglais openGym (et inversement partiel)
  const frToEn = {
    // Bras
    'développé couché': 'bench press',
    'curl haltères': 'dumbbell curl',
    'extension triceps': 'triceps extension',
    'row haltères': 'dumbbell row',
    'curl biceps': 'biceps curl',
    // Jambes
    'squat': 'squat',
    'levé de mollet': 'calf raise',
    'extension leg': 'leg extension',
    'fente': 'lunge',
    'soulevé de terre': 'deadlift',
    // Poitrine/épaules
    'développé incliné': 'incline press',
    'développé décliné': 'decline press',
    'développé militaire': 'overhead press',
    'épaules': 'shoulder press',
    'élévation latérale': 'lateral raise',
    // Dos
    'traction': 'pull-up',
    'rowing': 'barbell row',
    // Pectoraux
    'écarté haltères': 'dumbbell fly',
    'pompes': 'push-ups',
    // Abdominaux
    'crunch': 'crunch',
    'gainage': 'plank',
    // Général
    'dips': 'dips',
  };
  const enToFr = {};
  Object.keys(frToEn).forEach(k => { enToFr[frToEn[k]] = k; });
  return { frToEn, enToFr };
})();

/* ------------------------------------------------------------------ */
/*  Catalogue – chargé à la demande (lazy)                           */
/* ------------------------------------------------------------------ */

let catalogue = null; // rempli par loadCatalogue()
const CATALOGUE_URL = 'data/exercises-catalogue.json'; // chargé depuis la racine du projet

// Démarre le chargement dès l'import du module (cache partagé)
const cataloguePromise = loadCatalogue();

/* Accès synchrone au catalogue déjà chargé (tableau vide si pas encore prêt). */
export function getCatalogue() {
  return Array.isArray(catalogue) ? catalogue : [];
}

/* Indique si le catalogue est déjà chargé. */
export function catalogueReady() {
  return Array.isArray(catalogue);
}

async function loadCatalogue() {
  if (catalogue) return catalogue;
  try {
    const resp = await fetch(CATALOGUE_URL, { cache: 'force-cache' });
    if (!resp.ok) throw new Error(`catalogue ${resp.status}`);
    catalogue = (await resp.json()).records; // openGym archive: {source,size,count,records[]}
    // Build lowercase index pour recherche rapide
    catalogue.forEach(ex => {
      ex._lower = (ex.name || '').toLowerCase();
      ex._search = `${ex._lower} ${(ex.bodyPart || '').toLowerCase()} ${(ex.category || '').toLowerCase()}`;
    });
    // Build alias map : nom anglais → entrée catalogue
    catalogue.forEach(ex => {
      if (ex.name) {
        const fr = EXO_ALIASES.enToFr[ex.name.toLowerCase()];
        if (fr) ex._frAlias = fr;
      }
    });
    return catalogue;
  } catch (e) {
    console.warn('[gym/exercises] impossible de charger le catalogue :', e);
    catalogue = [];
    return [];
  }
}

/* ------------------------------------------------------------------ */
/*  Recherche                                                            */
/* ------------------------------------------------------------------ */

 /**
  * Cherche des exercices dont le nom (ou alias FR) contient le terme.
  * term : chaîne de caractères (en français ou anglais)
  * returns : tableau d'objets catalogue
  */
export function searchExercises(term) {
  return loadCatalogue().then(exes => {
    if (!term) return exes;
    const q = term.toLowerCase();
    return exes.filter(e =>
      e._lower.includes(q) ||
      (e._frAlias && e._frAlias.includes(q)) ||
      e._search.includes(q)
    );
  });
}

/* ------------------------------------------------------------------ */
/*  Filtres                                                               */
/* ------------------------------------------------------------------ */

 /**
  * Filtre par groupe musculaire principal (bodyPart).
  * muscle : 'chest' | 'back' | 'legs' | etc. (minuscule ou tel quel)
  */
export function filterByMuscle(muscle) {
  return loadCatalogue().then(exes => {
    const m = (muscle || '').toLowerCase();
    if (!m) return exes;
    return exes.filter(e => {
      const bp = (e.bodyPart || '').toLowerCase();
      return bp === m || e.secondaryMuscles?.some(s => s.toLowerCase() === m);
    });
  });
}

/**
  * Filtre par équipement (barres, machines, haltères, none/bodyweight).
  * equip : 'dumbbell' | 'barbell' | 'machine' | 'cable' | 'bodyweight'
  */
export function filterByEquipment(equip) {
  return loadCatalogue().then(exes => {
    const e = (equip || '').toLowerCase();
    if (!e) return exes;
    return exes.filter(x => (x.equipment || '').toLowerCase() === e);
  });
}

/**
  * Filtre par catégorie (strength, cardio, mobility, etc.).
  * cat : chaîne (minuscule ou telle quelle)
  */
export function filterByCategory(cat) {
  return loadCatalogue().then(exes => {
    const c = (cat || '').toLowerCase();
    if (!c) return exes;
    return exes.filter(x => (x.category || '').toLowerCase() === c);
  });
}

/* ------------------------------------------------------------------ */
/*  Récupération d'une entrée par ID                                      */
/* ------------------------------------------------------------------ */

export function getExercise(id) {
  return loadCatalogue().then(exes => exes.find(e => e.id === id) || null);
}

/* ------------------------------------------------------------------ */
/*  Helper : correspondance français ↔ anglais                         */
/* ------------------------------------------------------------------ */

export function aliasFrToEn(frName) {
  return EXO_ALIASES.frToEn[frName.toLowerCase()] || null;
}

export function aliasEnToFr(enName) {
  return EXO_ALIASES.enToFr[enName.toLowerCase()] || null;
}

/* ------------------------------------------------------------------ */
/*  Exercice "custom" – créé par l'utilisateur                         */
/* ------------------------------------------------------------------ */

export function makeCustomExercise(name, notes = '') {
  // Création d'une entrée "virtuelle" qui s'insère dans DB.custom
  return {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name,
    _lower: name.toLowerCase(),
    _search: name.toLowerCase(),
    bodyPart: notes?.bodyPart || 'other',
    equipment: notes?.equipment || 'dumbbell',
    target: notes?.target || '',
    secondaryMuscles: notes?.secondaryMuscles || [],
    category: 'custom',
    description: '',
    instructions: notes?.instructions || '',
  };
}

/* ------------------------------------------------------------------ */
/*  Initialisation au chargement de la page (optionnel)               */
/* ------------------------------------------------------------------ */

// Si tu veux que le catalogue se charge tout de suite au plutôt :
// loadCatalogue().then(() => console.log('[gym/exercises] catalogue prêt,', catalogue.length, 'exercices'));

export default { searchExercises, filterByMuscle, filterByEquipment, filterByCategory, getExercise, aliasFrToEn, aliasEnToFr, makeCustomExercise, getCatalogue, catalogueReady, loadCatalogue };