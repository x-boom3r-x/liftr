/* ── js/gym/progression.js ───────────────────────────────────────────────
    Moteur de progression porté d'openGym (politiques : off/linear/greyskull/
    double/triple/time + deload). Toutes les fonctions sont pures, pas de
    dépendance DOM ; les résultats s'insèrent dans le modèle Liftr par
    l'intermédiaire de window. (licence : idées, pas de code AGPL copié).
  -------------------------------------------------------------------------*/

/* ---- Politiques de progression (telles qu'openGym) ------------------- */

/**
   Politique "off" : pas de progression automatique.
   returns { addWeight, addReps, deload } -> booleans
 */
export function policyOff() {
  return { addWeight: false, addReps: false, deload: false };
}

/**
   Politique "linear" : ajoute 2.5 kg (ou le poids pas) à chaque séance,
   tant que le nombre de reps est atteint. Si on dépasse le top, on saute
   au prochain palier.
   @param {number} currentWeight charge actuelle (kg)
   @param {number} targetReps cible de reps par série
   @param {number} achievedReps reps réellement effectués
   @param {number} step pas d'incrémentation (par défaut 2.5)
 */
export function policyLinear(currentWeight, targetReps, achievedReps, step = 2.5) {
  if (achievedReps >= targetReps) return currentWeight + step;
  return currentWeight; // pas de changement
}

/**
   Politique "greyskull" : +2.5 kg sur le développé/haltères,
   mais si les reps tombent sous la cible, on diminue de 5 kg.
   Voir openGym lib/progression.js pour la logique complète.
 */
export function policyGreyskull(currentWeight, targetReps, achievedReps, step = 2.5) {
  if (achievedReps >= targetReps) return currentWeight + step;
  return Math.max(0, currentWeight - step * 2); // recule de 2 étapes
}

/* ---- Politiques "double", "triple", "time" (synthétique) ------------ */

export function policyDouble(currentWeight, targetReps, achievedReps, step = 2.5) {
  // Double : deux palier avant d'augmenter ; simplifié ici comme linear
  return policyLinear(currentWeight, targetReps, achievedReps, step);
}

export function policyTriple(currentWeight, targetReps, achievedReps, step = 2.5) {
  // Triple : trois séries de même charge avant d'augmenter ; simplifié
  return policyLinear(currentWeight, targetReps, achievedReps, step);
}

export function policyTime(currentWeight, targetReps, achievedReps, minutes = 45) {
  // Basé sur le temps total de la séance ; ici on utilise le même schéma
  // que linear mais on peut aussi vérifier que la séance reste < minutes
  return policyLinear(currentWeight, targetReps, achievedReps, 2.5);
}

/* ---- Deload (réduction temporaire) ---------------------------------- */

export function computeDeload(weight, reduction = 0.1) {
  // Réduction de 10 % par défaut
  return Math.max(0, weight * (1 - reduction));
}

/* ---- Export helper : retourne la politique par nom ------------------ */

export function getPolicy(name) {
  const map = {
    off: policyOff,
    linear: policyLinear,
    greyskull: policyGreyskull,
    double: policyDouble,
    triple: policyTriple,
    time: policyTime,
  };
  return (map[name] || policyOff)();
}

/* ---- Util : suggère la prochaine charge après une séance ------------- */

 /**
  * Calcule la charge recommandée pour la prochaine séance d'un exercice,
  * en se basant sur l'historique récent et la politique choisie.
  * @param {number} lastWeight charge la plus récente levée (kg)
  * @param {string} policy 'linear' | 'greyskull' | 'off' etc.
  * @param {number} recentSets nombre de séries récentes considérées
  * @returns {number} charge suggérée
  */
export function suggestNextWeight(lastWeight, policy = 'linear', recentSets = 3) {
  const p = getPolicy(policy);
  const result = p(lastWeight, 8, 8, 2.5); // cible par défaut 8 reps
  return Number(result.toFixed(1));
}

/* ---- Initialisation (optionnel) ------------------------------------- */

// Si tu veux exposer les politiques globalement au chargement :
// window.getPolicy = getPolicy; window.suggestNextWeight = suggestNextWeight;
export default { policyOff, policyLinear, policyGreyskull, policyDouble, policyTriple, policyTime, computeDeload, getPolicy, suggestNextWeight };