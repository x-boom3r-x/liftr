-- =====================================================================
-- SOCIAL v4 — compte privé / public
--
-- À exécuter dans le SQL Editor du projet Supabase : l'agent n'a ni
-- jeton d'accès ni CLI Supabase, il ne peut donc pas appliquer ce
-- fichier lui-même.
--
-- Tant qu'il n'est pas appliqué, l'application bascule toute seule en
-- mode « bio » : le même drapeau est conservé sous forme de marqueur
-- invisible (U+2063privateU+2063) dans `profiles.bio` et le filtrage se
-- fait côté client. L'interface est identique, mais les contenus d'un
-- compte privé restent lisibles par API. Cette migration rend le
-- cachage réel côté serveur.
-- =====================================================================

-- 1. Le drapeau, sur le profil.
alter table public.profiles
  add column if not exists is_private boolean not null default false;

create index if not exists profiles_is_private_idx
  on public.profiles (is_private) where is_private;

-- 2. Lecture : tout le monde peut voir le champ `is_private` (il sert
--    à afficher le badge et à déverrouiller ou non la grille), mais
--    plus personne ne lit les contenus d'un compte privé qu'il ne
--    suit pas.
drop policy if exists "posts_read" on public.posts;
create policy "posts_read" on public.posts for select using (
  deleted_at is null
  and (
    not exists (
      select 1 from public.profiles p
      where p.id = posts.author_id and p.is_private
    )
    or posts.author_id = auth.uid()
    or exists (
      select 1 from public.follows f
      where f.followee_id = posts.author_id
        and f.follower_id = auth.uid()
    )
  )
);

drop policy if exists "comments_read" on public.comments;
create policy "comments_read" on public.comments for select using (
  deleted_at is null
  and (
    not exists (
      select 1 from public.profiles p
      where p.id = comments.author_id and p.is_private
    )
    or comments.author_id = auth.uid()
    or exists (
      select 1 from public.follows f
      where f.followee_id = comments.author_id
        and f.follower_id = auth.uid()
    )
  )
);

drop policy if exists "notes_read" on public.notes;
create policy "notes_read" on public.notes for select using (
  expires_at > now()
  and (
    not exists (
      select 1 from public.profiles p
      where p.id = notes.author_id and p.is_private
    )
    or notes.author_id = auth.uid()
    or exists (
      select 1 from public.follows f
      where f.followee_id = notes.author_id
        and f.follower_id = auth.uid()
    )
  )
);

drop policy if exists "stories_read" on public.stories;
create policy "stories_read" on public.stories for select using (
  expires_at > now()
  and (
    not exists (
      select 1 from public.profiles p
      where p.id = stories.author_id and p.is_private
    )
    or stories.author_id = auth.uid()
    or exists (
      select 1 from public.follows f
      where f.followee_id = stories.author_id
        and f.follower_id = auth.uid()
    )
  )
);

-- 3. Écriture : seule la personne concernée peut basculer son compte.
--    (recréée à l'identique de `00000000000000_init_social.sql` : la
--    migration reste idempotente même si elle est réappliquée.)
drop policy if exists "profiles_upd" on public.profiles;
create policy "profiles_upd" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- 4. La vue `feed_counts` est créée avec `security_invoker` dans le
--    init : elle hérite automatiquement de `posts_read`, rien à faire.
