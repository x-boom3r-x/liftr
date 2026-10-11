-- =====================================================================
-- SOCIAL v5 — votes (Top), reposts, enregistrements, partage structuré
--
-- À exécuter dans le SQL Editor du projet Supabase : l'agent n'a ni
-- jeton d'accès ni CLI Supabase, il ne peut donc pas appliquer ce
-- fichier lui-même.
--
-- Tant qu'il n'est pas appliqué, l'application garde le comportement
-- actuel : les requêtes vers ces tables échouent en silence (compteurs
-- best-effort) et les boutons ▲▼ ⟲ 🔖 affichent un toast d'erreur
-- avec retour arrière optimiste. Rien ne casse côté client.
--
-- Idempotent : rejouable tel quel (calqué sur le style de
-- 00000000000001_social_v2.sql et 00000000000003_social_v4.sql).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Posts : type 'program' + pièce jointe structurée (§H)
-- ---------------------------------------------------------------------
alter table public.posts
  drop constraint if exists posts_kind_check;
alter table public.posts
  add constraint posts_kind_check
  check (kind in ('text','photo','pr','session','program'));

alter table public.posts
  add column if not exists attachment jsonb;
alter table public.posts
  drop constraint if exists posts_attachment_size_check;
alter table public.posts
  add constraint posts_attachment_size_check
  check (attachment is null or pg_column_size(attachment) < 16384);

-- ---------------------------------------------------------------------
-- 2. Votes (▲ upvote / ▼ downvote) — signal de classement « Top ».
--    ♥ Like reste la table public.likes existante (appréciation
--    sociale + notification via trg_notify_like) : deux actions
--    distinctes, deux tables.
-- ---------------------------------------------------------------------
create table if not exists public.post_votes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  value      smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists post_votes_post_idx
  on public.post_votes (post_id, created_at desc);
create index if not exists post_votes_user_idx
  on public.post_votes (user_id, created_at desc);

alter table public.post_votes enable row level security;

drop policy if exists "votes_read"  on public.post_votes;
drop policy if exists "votes_ins"   on public.post_votes;
drop policy if exists "votes_upd"   on public.post_votes;
drop policy if exists "votes_del"   on public.post_votes;
create policy "votes_read" on public.post_votes for select using (true);
create policy "votes_ins"  on public.post_votes for insert
  with check (auth.uid() = user_id);
create policy "votes_upd"  on public.post_votes for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "votes_del"  on public.post_votes for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 3. Reposts — un repost apparaît chez les abonnés du reposteur.
--    (user_id, post_id) en clé : impossible de reposter deux fois le
--    même post, et jamais son propre post (contrôlé côté client ; le
--    serveur refuse le doublon).
-- ---------------------------------------------------------------------
create table if not exists public.post_reposts (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  quote      text check (quote is null or char_length(quote) <= 400),
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists post_reposts_post_idx
  on public.post_reposts (post_id, created_at desc);
create index if not exists post_reposts_user_idx
  on public.post_reposts (user_id, created_at desc);

alter table public.post_reposts enable row level security;

drop policy if exists "reposts_read"  on public.post_reposts;
drop policy if exists "reposts_ins"   on public.post_reposts;
drop policy if exists "reposts_del"   on public.post_reposts;
create policy "reposts_read" on public.post_reposts for select using (true);
create policy "reposts_ins"  on public.post_reposts for insert
  with check (auth.uid() = user_id);
create policy "reposts_del"  on public.post_reposts for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 4. Enregistrements (🔖 Saved) — STRICTEMENT privé : seule la personne
--    concernée lit ou écrit ses propres lignes. Aucune notification.
-- ---------------------------------------------------------------------
create table if not exists public.post_saves (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists post_saves_post_idx
  on public.post_saves (post_id, created_at desc);
create index if not exists post_saves_user_idx
  on public.post_saves (user_id, created_at desc);

alter table public.post_saves enable row level security;

drop policy if exists "saves_own" on public.post_saves;
create policy "saves_own" on public.post_saves
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
