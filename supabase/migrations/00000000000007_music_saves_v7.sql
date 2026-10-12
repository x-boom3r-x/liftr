-- =====================================================================
-- SOCIAL v7 — music_saves (sauvegarde de pistes)
--
-- À exécuter dans le SQL Editor du projet Supabase : l'agent n'a ni
-- jeton d'accès ni CLI Supabase, il ne peut donc pas appliquer ce
-- fichier lui-même.
--
-- Tant qu'il n'est pas appliqué, l'application garde le comportement
-- actuel : la sauvegarde d'une piste vit dans le localStorage
-- (clé `liftr_music_saves`, listée par la suite de tests) ; la
-- poussée cloud est best-effort et échoue silencieusement.
-- Rien ne casse côté client.
--
-- Idempotent : rejouable tel quel (calqué sur le style de
-- 00000000000004_social_v5.sql — table `post_saves`).
-- =====================================================================

create table if not exists public.music_saves (
  user_id    uuid not null references auth.users(id) on delete cascade,
  track_id   text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, track_id)
);

alter table public.music_saves enable row level security;

-- sauvegardes STRICTEMENT privées (comme post_saves)
drop policy if exists music_saves_own on public.music_saves;
create policy music_saves_own on public.music_saves
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists music_saves_user_idx
  on public.music_saves(user_id, created_at desc);
