-- ==================================================================
-- LIFTR - volet social v3 : stories (24 h), notes de conversation,
--         suppression complète du compte.
-- Idempotent : rejouable tel quel.
-- ==================================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------
-- 1. Stories (photo et/ou texte, expirent au bout de 24 h)
-- ------------------------------------------------------------------
create table if not exists public.stories (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null default '' check (char_length(body) <= 400),
  image_path text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  check (body <> '' or image_path is not null)
);

create index if not exists stories_live_idx on public.stories (author_id, expires_at desc);
create index if not exists stories_expiry_idx on public.stories (expires_at);

alter table public.stories enable row level security;

drop policy if exists "stories_read" on public.stories;
drop policy if exists "stories_ins"  on public.stories;
drop policy if exists "stories_del"  on public.stories;
create policy "stories_read" on public.stories for select using (expires_at > now());
create policy "stories_ins"  on public.stories for insert
  with check (auth.uid() = author_id and expires_at > now());
create policy "stories_del"  on public.stories for delete using (auth.uid() = author_id);

-- ------------------------------------------------------------------
-- 2. Vues de story (pour l'anneau « déjà vu »)
-- ------------------------------------------------------------------
create table if not exists public.story_views (
  story_id  uuid not null references public.stories (id) on delete cascade,
  viewer_id uuid not null references public.profiles (id) on delete cascade,
  seen_at   timestamptz not null default now(),
  primary key (story_id, viewer_id)
);

alter table public.story_views enable row level security;

drop policy if exists "story_views_read" on public.story_views;
drop policy if exists "story_views_ins"  on public.story_views;
drop policy if exists "story_views_upd"  on public.story_views;
create policy "story_views_read" on public.story_views for select using (viewer_id = auth.uid());
create policy "story_views_ins"  on public.story_views for insert
  with check (viewer_id = auth.uid());
create policy "story_views_upd"  on public.story_views for update
  using (viewer_id = auth.uid()) with check (viewer_id = auth.uid());

-- ------------------------------------------------------------------
-- 3. Notes (une par personne, 60 caractères, 24 h) : bulles au-dessus
--    de la liste des conversations.
-- ------------------------------------------------------------------
create table if not exists public.notes (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 60),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

-- une seule note à la fois par auteur (remplacement = upsert)
create unique index if not exists notes_author_key on public.notes (author_id);
create index if not exists notes_expiry_idx on public.notes (expires_at);

alter table public.notes enable row level security;

drop policy if exists "notes_read" on public.notes;
drop policy if exists "notes_ins"  on public.notes;
drop policy if exists "notes_upd"  on public.notes;
drop policy if exists "notes_del"  on public.notes;
create policy "notes_read" on public.notes for select using (expires_at > now());
create policy "notes_ins"  on public.notes for insert
  with check (auth.uid() = author_id and expires_at > now());
create policy "notes_upd"  on public.notes for update
  using (auth.uid() = author_id) with check (auth.uid() = author_id);
create policy "notes_del"  on public.notes for delete using (auth.uid() = author_id);

-- ------------------------------------------------------------------
-- 4. Storage : bucket des stories
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stories', 'stories', true, 10485760,
        array['image/webp','image/jpeg','image/png','image/avif'])
on conflict (id) do nothing;

drop policy if exists "stories_media_read" on storage.objects;
drop policy if exists "stories_media_ins"  on storage.objects;
drop policy if exists "stories_media_upd"  on storage.objects;
drop policy if exists "stories_media_del"  on storage.objects;
create policy "stories_media_read" on storage.objects for select using (bucket_id = 'stories');
create policy "stories_media_ins"  on storage.objects for insert
  with check (bucket_id = 'stories' and owner = auth.uid());
create policy "stories_media_upd"  on storage.objects for update
  using (bucket_id = 'stories' and owner = auth.uid());
create policy "stories_media_del"  on storage.objects for delete
  using (bucket_id = 'stories' and owner = auth.uid());

-- ------------------------------------------------------------------
-- 5. Suppression complète du compte
--    Les fichiers (avatars / posts / stories) sont retirés côté client
--    avant l'appel ; tout le reste part en cascade depuis auth.users.
-- ------------------------------------------------------------------
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $$
declare
  v_id uuid := auth.uid();
begin
  if v_id is null then
    raise exception 'You are not signed in.';
  end if;
  delete from auth.users where id = v_id;
end $$;

revoke execute on function public.delete_my_account() from public, anon;
grant  execute on function public.delete_my_account() to authenticated;
