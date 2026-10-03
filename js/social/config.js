/* ==================================================================
   SOCIAL - configuration
   ================================================================== */

/* Renseigner ces deux valeurs (Supabase > Project Settings > API)
   active tout le volet social. Tant qu'elles restent vides :
   SOCIAL_ENABLED vaut false, aucune requête réseau n'est émise,
   aucune clé localStorage supplémentaire n'est créée et l'onglet
   Feed reste masqué. L'app reste exactement 100% locale.

   window.LIFTR_SOCIAL_CONFIG (injecté avant le chargement des modules,
   ex. par un script de build) permet de fournir les mêmes valeurs sans
   modifier ce fichier. */
const SOCIAL_CONFIG = Object.assign(
  { supabaseUrl: '', anonKey: '' },
  window.LIFTR_SOCIAL_CONFIG || {}
);

const SOCIAL_ENABLED = !!(SOCIAL_CONFIG.supabaseUrl && SOCIAL_CONFIG.anonKey);

Object.assign(window, { SOCIAL_CONFIG, SOCIAL_ENABLED });

export { SOCIAL_CONFIG, SOCIAL_ENABLED };
