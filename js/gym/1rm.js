/* ── js/gym/1rm.js ───────────────────────────────────────────────────────
    Calcul de 1RM (1 Repetition Maximum) à partir de charges/reps connues.
    Porté des formules openGym (epley, brzycki, mcglothin) ; résultats
    purs, utilisables dans le modèle Liftr (window.prs / DB.prs).
    Licence : idées seules, pas de code AGPL réutilisé.
  -------------------------------------------------------------------------*/

/* ---- Formules de estimation 1RM --------------------------------------- */

/**
   Formule Epley : 1RM = weight × (1 + reps / 30)
 */
export function epley(weight, reps) {
  return weight * (1 + reps / 30);
}

/**
   Formule Brzycki : 1RM = weight × (36 / (36 + reps))
   (plus conservatice pour des hauts reps)
 */
export function brzycki(weight, reps) {
  return weight * 36 / (36 + reps);
}

/**
   Formule McGlothin : 1RM = (weight × 7.5) + (weight × reps / 5) + 1
   (équivalent approximatif ; kept for completeness)
 */
export function mcglothin(weight, reps) {
  return (weight * 7.5 + weight * reps / 5 + 1);
}

/**
   Formule Waller : 1RM = weight × (100 / (101.3 - 2.67123 * reps))
   (fonctionne bien pour reps <= 10)
 */
export function waller(weight, reps) {
  return weight * 100 / (101.3 - 2.67123 * reps);
}

/* ---- Moyen : moyenne de plusieurs formules ---------------------------- */

export function average1rm(weight, reps, methods = ['epley', 'brzycki', 'waller']) {
  const vals = methods.map(m => {
    const fn = { epley, brzycki, mcglothin, waller }[m];
    return fn ? fn(weight, reps) : null;
  }).filter(v => v !== null);
  if (vals.length === 0) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  return Number((sum / vals.length).toFixed(2));
}

/* ---- Helper : déduit un 1RM depuis l'historique Liftr --------------- */

 /**
   Parcourt DB.history et extrait les meilleures séries d'un exercice
   pour estimer le 1RM via la formule choisie.
   @param {string} exerciseName nom de l'exercice (tels que dans DB)
   @param {string} method 'epley' | 'brzycki' | 'average'
   @returns {number|undefined} 1RM estimé ou undefined
   */
export function estimate1rmFromHistory(exerciseName, method = 'average') {
  const hits = (window.DB && window.DB.history || [])
    .filter(h => h && h.exercises)
    .reduce((acc, h) => {
      (h.exercises || []).forEach(ex => {
        if ((ex.name || '').toLowerCase() === exerciseName.toLowerCase()) {
          (ex.sets || []).forEach(s => {
            if (s && (s.warmup === true || s.phase === 'warmup')) return;
            const w = s.weight;
            const r = s.reps;
            if (!isNaN(w) && !isNaN(r) && r > 0) {
              acc.push({ weight: w, reps: r });
            }
          });
        }
      });
      return acc;
    }, []);

  if (hits.length === 0) return undefined;

  // On garde la série avec le plus de poids (le record "proche" du 1RM)
  hits.sort((a, b) => b.weight - a.weight);
  const best = hits[0];

  const fn = { epley, brzycki, average }[method];
  return fn ? fn(best.weight, best.reps) : undefined;
}

/* ---- Export ---------------------------------------------------------- */

export default { epley, brzycki, mcglothin, waller, average1rm, estimate1rmFromHistory };
