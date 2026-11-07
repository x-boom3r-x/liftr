/* ── js/gym/plates.js ────────────────────────────────────────────────────
    Calculateur de disques (fractionnels) pour barre olympique.
    Donne la combinaison de disques (2.5, 5, 10, 20, 25 kg) qui s'approche
    le plus de la charge cible, tel que utilisé dans openGym.
    Tous les calculs sont pures ; pas de dépendance tierce.
  -------------------------------------------------------------------------*/

/* ---- Unités par défaut (kg) ------------------------------------------- */

const DEFAULT_PLATES = [2.5, 5, 10, 20, 25]; // en kg ; la barre est à 20 kg

/* ---- Charge totale = barre + somme des disques des deux cotés ---------- */

function totalLoad(barWeight, sidePlates) {
  // sidePlates = tableau de disques d'un seul côté
  return barWeight + sidePlates.reduce((sum, w) => sum + w, 0) * 2;
}

/* ---- Trouve la combinaison de disques la plus proche de la cible ------ */

 /**
   Renvoie les disques à mettre de chaque côté de la barre pour approcher
   la charge cible, en utilisant les disques disponibles.
   @param {number} target target en kg (incluant la barre)
   @param {number} barWeight poids de la barre (défaut 20)
   @param {Array<number>} availableDisks disques dispo (défaut 2.5|5|10|20|25)
   @returns {{ left: number[], right: number[], total: number }} objet avec
     left/right = tableaux de disques (kg) de chaque côté, total = charge totale
   */
export function computePlateCombination(target, barWeight = 20, availableDisks = DEFAULT_PLATES) {
  const plates = [...availableDisks].sort((a, b) => a - b);
  const extra = target - barWeight; // à répartir des deux côtés
  if (extra <= 0) return { left: [], right: [], total: barWeight };

  // On cherche la combinaison qui se rapproche le plus de extra/2 par côté
  const half = extra / 2;
  const combination = findCombination(plates, half);

  const left = combination.slice();
  const right = combination.slice();
  const total = totalLoad(barWeight, left);

  return { left, right, total };
}

/** Helper : recherche récursive pour trouver la combinaison de disques */
function findCombination(plates, target, index = plates.length - 1, current = []) {
  // Si on a atteint le début ou que la cible est atteinte/approchée
  if (index < 0 || current.reduce((a, b) => a + b, 0) >= target) {
    return current;
  }
  // Essaye d'ajouter le disque courant
  const withPlate = [...current, plates[index]];
  const sumWith = withPlate.reduce((a, b) => a + b, 0);
  // SiAdding ce disque ne dépasse pas la cible (avec marge de tolerance)
  const tolerance = 0.5; // tolérance de 0.5 kg
  if (sumWith <= target + tolerance) {
    // Continue avec ce disque
    const result = findCombination(plates, target, index - 1, withPlate);
    // Si le résultat trouvé sans ce disque est meilleur (plus proche), retourne celui-ci
    if (result && result.reduce((a, b) => a + b, 0) <= sumWith) return result;
  }
  // Sinon, essaie sans ce disque
  return findCombination(plates, target, index - 1, current);
}

/* ---- Aide : affiche la liste de disques sous forme HTML -------------- */

function platesHtml({ left, right, total }) {
  const plateList = plates => plates.map(p => `<span class="plate">${p} kg</span>`).join(' ');
  return `
    <div class="plates-result">
      <div>Barre : ${total - (left.reduce((a,b)=>a+b,0)*2 + right.reduce((a,b)=>a+b,0)*2, 0)} kg</div>
      <div>Côté gauche : ${plateList(left)}</div>
      <div>Côté droit : ${plateList(right)}</div>
      <strong>Charge totale : ${total} kg</strong>
    </div>
  `;
}

/* ---- Export ---------------------------------------------------------- */
