/* ==================================================================
   SOCIAL - configuration
   ================================================================== */

/* Renseigner supabaseUrl + anonKey (Supabase > Project Settings > API)
   active tout le volet social. Tant qu'ils restent vides :
   SOCIAL_ENABLED vaut false, aucune requête réseau n'est émise,
   aucune clé localStorage supplémentaire n'est créée et l'onglet
   Feed reste masqué. L'app reste exactement 100% locale.

   googleAuth: true affiche le bouton « Continue with Google » — à
   passer à true une fois l'OAuth client Google renseigné côté projet
   Supabase (Auth > Providers > Google).

   window.LIFTR_SOCIAL_CONFIG (injecté avant le chargement des modules,
   ex. par un script de build) permet de fournir les mêmes valeurs sans
   modifier ce fichier.

   La clé publishable/anon est PUBLIQUE par conception : elle ne donne
   que les droits définis par les policies RLS. La clé secrète
   (sb_secret_...) ne doit JAMAIS figurer ici. */
const SOCIAL_CONFIG = Object.assign(
  { supabaseUrl: '', anonKey: '', googleAuth: false },
  {
    supabaseUrl: 'https://fgpbhosklbcaapijmnkj.supabase.co',
    anonKey: 'sb_publishable_U1CSWnUnYIeQfxItuEtTqA_fLX46y7y',
    googleAuth: false
  },
  window.LIFTR_SOCIAL_CONFIG || {}
);

const SOCIAL_ENABLED = !!(SOCIAL_CONFIG.supabaseUrl && SOCIAL_CONFIG.anonKey);
const GOOGLE_ENABLED = SOCIAL_ENABLED && !!SOCIAL_CONFIG.googleAuth;

Object.assign(window, { SOCIAL_CONFIG, SOCIAL_ENABLED, GOOGLE_ENABLED });

export { SOCIAL_CONFIG, SOCIAL_ENABLED, GOOGLE_ENABLED };
