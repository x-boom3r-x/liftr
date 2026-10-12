-- =====================================================================
-- SOCIAL L5 — demandes d'abonnement, commentaires pilotables, reponses
--
-- PREREQUIS : appliquer `00000000000003_social_v4.sql` AVANT celle-ci
-- (les policies ci-dessous lisent `profiles.is_private`).
-- Idempotent : une reexecution n'a aucun effet de bord.
-- =====================================================================

-- 1. follows — etat de l'abonnement. Les lignes existantes restent
--    « accepted » (le default) : aucun abonnement actuel ne devient
--    une demande en attente.
alter table public.follows
  add column if not exists state text not null default 'accepted'
  check (state in ('pending','accepted'));

create index if not exists follows_pending_idx
  on public.follows (followee_id, created_at desc) where state = 'pending';

-- 2. posts — le proprietaire peut couper les commentaires d'un post.
alter table public.posts
  add column if not exists comments_enabled boolean not null default true;

-- 3. comments — reponses en fils complets : `parent_id` pointe vers le
--    commentaire repondu, `root_id` vers la tete du fil (requetes).
alter table public.comments
  add column if not exists parent_id uuid references public.comments (id) on delete cascade;
alter table public.comments
  add column if not exists root_id uuid references public.comments (id) on delete cascade;

create index if not exists comments_parent_idx on public.comments (parent_id);
create index if not exists comments_root_idx
  on public.comments (root_id, created_at) where deleted_at is null;

-- 4. notifications — reservation du type « follow_request » (aucun ecran
--    ne l'affiche aujourd'hui ; le stockage est prete pour la suite).
do $$
begin
  if exists (select 1 from pg_constraint where conname = 'notifications_type_check') then
    alter table public.notifications drop constraint notifications_type_check;
  end if;
  alter table public.notifications add constraint notifications_type_check
    check (type in ('follow','comment','mention','follow_request'));
end $$;

-- 5. Un abonnement en attenne ne donne acces a RIEN : les quatre
--    policies de visibilite de v4 exigent maintenant state='accepted'.
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
        and f.state = 'accepted'
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
        and f.state = 'accepted'
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
        and f.state = 'accepted'
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
        and f.state = 'accepted'
    )
  )
);

-- 6. follows — ecriture selon l'etat :
--    * le suiveur peut creer une demande (pending) dans tous les cas ;
--    * il ne peut PAS s'auto-accepter sur un compte prive (sinon le
--      flux de demande serait contournable en un insert) ;
--    * seul le titulaire peut passer pending -> accepted ;
--    * le suiveur annule, le titulaire refuse : la suppression est
--      ouverte aux deux cotes.
drop policy if exists "follows_ins" on public.follows;
create policy "follows_ins" on public.follows for insert with check (
  auth.uid() = follower_id
  and (
    state = 'pending'
    or (
      state = 'accepted'
      and not exists (
        select 1 from public.profiles p
        where p.id = follows.followee_id and p.is_private
      )
    )
  )
);

drop policy if exists "follows_upd" on public.follows;
create policy "follows_upd" on public.follows for update
  using (auth.uid() = follows.followee_id)
  with check (auth.uid() = follows.followee_id and state = 'accepted');

drop policy if exists "follows_del" on public.follows;
create policy "follows_del" on public.follows for delete
  using (auth.uid() = follower_id or auth.uid() = followee_id);

-- 7. Commentaires coupos : plus aucune insertion, y compris par le
--    proprietaire du post (il rouvre les commentaires pour ecrire).
drop policy if exists "comments_ins" on public.comments;
create policy "comments_ins" on public.comments for insert with check (
  auth.uid() = author_id
  and exists (
    select 1 from public.posts p
    where p.id = comments.post_id and p.comments_enabled
  )
);
