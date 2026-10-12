-- =====================================================================
-- SOCIAL v6 — style des stories (texte riche)
--
-- À exécuter dans le SQL Editor du projet Supabase : l'agent n'a ni
-- jeton d'accès ni CLI Supabase, il ne peut donc pas appliquer ce
-- fichier lui-même.
--
-- Tant qu'il n'est pas appliqué, l'application garde le comportement
-- actuel : le composeur n'envoie pas la colonne `style` (insert sans
-- elle), la visionneuse bascule sur la légende texte classique.
-- Rien ne casse côté client.
--
-- Idempotent : rejouable tel quel (calqué sur le style de
-- 00000000000001_social_v2.sql … 00000000000004_social_v5.sql).
--
-- Forme du jsonb (clés courtes, versionnables) :
--   { "t": "texte libre ignoré (corps dans body)",
--     "f": "impact|black|serif|mono|cursive|clean",
--     "c": "#rrggbb", "o": 0|1, "s": 0|1, "b": 0|1,
--     "x": 0-100, "y": 0-100,   -- position en % du stage
--     "r": -180..180,           -- rotation (deg)
--     "z": 0.5..3 }             -- échelle du texte
-- =====================================================================

alter table public.stories
  add column if not exists style jsonb;

comment on column public.stories.style is
  'Texte riche de la story : police, couleur, contour, ombre, boîte, position, rotation, échelle. Null = légende simple (body).';
