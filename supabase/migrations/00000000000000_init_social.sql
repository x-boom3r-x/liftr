-- ==================================================================
-- LIFTR - volet social (T2/T3/T4)
-- Idempotent : rejouable tel quel.
-- ==================================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------
-- 1. Profils (miroir public de auth.users)
-- ------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text,
  display_name text,
  avatar_url  text,
  bio         text not null default '' check (char_length(bio) <= 300),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username)) where username is not null;

create index if not exists profiles_created_idx on public.profiles (created_at desc);

-- ------------------------------------------------------------------
-- 2. Abonnements
-- ------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create index if not exists follows_followee_idx on public.follows (followee_id, created_at desc);

-- ------------------------------------------------------------------
-- 3. Posts (cartes + photos)
-- ------------------------------------------------------------------
create table if not exists public.posts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles (id) on delete cascade,
  kind       text not null default 'text'
             check (kind in ('text','photo','pr','session')),
  body       text not null default '' check (char_length(body) <= 2000),
  image_path text,
  thumb_path text,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  deleted_at timestamptz
);

create index if not exists posts_recent_idx
  on public.posts (created_at desc) where deleted_at is null;
create index if not exists posts_author_idx
  on public.posts (author_id, created_at desc) where deleted_at is null;

-- ------------------------------------------------------------------
-- 4. Commentaires (pas de DM)
-- ------------------------------------------------------------------
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  author_id  uuid not null references public.profiles (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists comments_post_idx
  on public.comments (post_id, created_at) where deleted_at is null;

-- ------------------------------------------------------------------
-- 5. Notifications
-- ------------------------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  actor_id   uuid references public.profiles (id) on delete set null,
  type       text not null check (type in ('follow','comment','mention')),
  post_id    uuid references public.posts (id) on delete cascade,
  comment_id uuid references public.comments (id) on delete cascade,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx
  on public.notifications (user_id, created_at desc);

-- ------------------------------------------------------------------
-- 6. Miroir des données d'entraînement (sync cloud, LWW)
--    Local = source de vérité. Une ligne par clé ; le plus récent gagne.
-- ------------------------------------------------------------------
create table if not exists public.user_data (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  key        text not null check (char_length(key) between 1 and 100),
  payload    jsonb not null,
  device_id  text not null default '',
  updated_at timestamptz not null default now(),
  deleted    boolean not null default false,
  primary key (user_id, key)
);

create index if not exists user_data_updated_idx on public.user_data (user_id, updated_at desc);

-- ------------------------------------------------------------------
-- 7. updated_at automatique
-- ------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_profiles_touch on public.profiles;
create trigger trg_profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_user_data_touch on public.user_data;
create trigger trg_user_data_touch before update on public.user_data
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------------
-- 8. Profil créé automatiquement à l'inscription
-- ------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'username', split_part(coalesce(new.email, ''), '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'full_name',
             new.raw_user_meta_data ->> 'name',
             split_part(coalesce(new.email, ''), '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------
-- 9. RLS
-- ------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.follows       enable row level security;
alter table public.posts         enable row level security;
alter table public.comments      enable row level security;
alter table public.notifications enable row level security;
alter table public.user_data     enable row level security;

-- profiles
drop policy if exists "profiles_read"  on public.profiles;
drop policy if exists "profiles_ins"   on public.profiles;
drop policy if exists "profiles_upd"   on public.profiles;
create policy "profiles_read" on public.profiles for select using (true);
create policy "profiles_ins"  on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_upd"  on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- follows
drop policy if exists "follows_read" on public.follows;
drop policy if exists "follows_ins"  on public.follows;
drop policy if exists "follows_del"  on public.follows;
create policy "follows_read" on public.follows for select using (true);
create policy "follows_ins"  on public.follows for insert with check (auth.uid() = follower_id);
create policy "follows_del"  on public.follows for delete using (auth.uid() = follower_id);

-- posts
drop policy if exists "posts_read" on public.posts;
drop policy if exists "posts_ins"  on public.posts;
drop policy if exists "posts_upd"  on public.posts;
drop policy if exists "posts_del"  on public.posts;
create policy "posts_read" on public.posts for select using (deleted_at is null);
create policy "posts_ins"  on public.posts for insert with check (auth.uid() = author_id);
create policy "posts_upd"  on public.posts for update
  using (auth.uid() = author_id) with check (auth.uid() = author_id);
create policy "posts_del"  on public.posts for delete using (auth.uid() = author_id);

-- comments
drop policy if exists "comments_read" on public.comments;
drop policy if exists "comments_ins"  on public.comments;
drop policy if exists "comments_upd"  on public.comments;
drop policy if exists "comments_del"  on public.comments;
create policy "comments_read" on public.comments for select using (deleted_at is null);
create policy "comments_ins"  on public.comments for insert with check (auth.uid() = author_id);
create policy "comments_upd"  on public.comments for update
  using (auth.uid() = author_id) with check (auth.uid() = author_id);
create policy "comments_del"  on public.comments for delete using (auth.uid() = author_id);

-- notifications (chacun ne voit et ne marque que les siennes)
drop policy if exists "notifications_read" on public.notifications;
drop policy if exists "notifications_upd"  on public.notifications;
drop policy if exists "notifications_ins"  on public.notifications;
create policy "notifications_read" on public.notifications for select using (auth.uid() = user_id);
create policy "notifications_upd"  on public.notifications for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "notifications_ins"  on public.notifications for insert with check (auth.uid() = user_id);

-- user_data (jamais lu/modifié par quelqu'un d'autre)
drop policy if exists "user_data_all" on public.user_data;
create policy "user_data_all" on public.user_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ------------------------------------------------------------------
-- 10. Notifications : follow / comment
-- ------------------------------------------------------------------
create or replace function public.notify_follow()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.follower_id = new.followee_id then return new; end if;
  insert into public.notifications (user_id, actor_id, type)
  values (new.followee_id, new.follower_id, 'follow');
  return new;
end $$;

drop trigger if exists trg_notify_follow on public.follows;
create trigger trg_notify_follow after insert on public.follows
  for each row execute function public.notify_follow();

create or replace function public.notify_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
begin
  select author_id into owner from public.posts where id = new.post_id;
  if owner is not null and owner <> new.author_id then
    insert into public.notifications (user_id, actor_id, type, post_id, comment_id)
    values (owner, new.author_id, 'comment', new.post_id, new.id);
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_comment on public.comments;
create trigger trg_notify_comment after insert on public.comments
  for each row execute function public.notify_comment();

-- ------------------------------------------------------------------
-- 11. Storage : bucket des photos de post
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posts', 'posts', true, 10485760,
        array['image/webp','image/jpeg','image/png','image/avif'])
on conflict (id) do nothing;

drop policy if exists "posts_media_read" on storage.objects;
drop policy if exists "posts_media_ins" on storage.objects;
drop policy if exists "posts_media_upd" on storage.objects;
drop policy if exists "posts_media_del" on storage.objects;
create policy "posts_media_read" on storage.objects for select using (bucket_id = 'posts');
create policy "posts_media_ins"  on storage.objects for insert
  with check (bucket_id = 'posts' and owner = auth.uid());
create policy "posts_media_upd"  on storage.objects for update
  using (bucket_id = 'posts' and owner = auth.uid());
create policy "posts_media_del"  on storage.objects for delete
  using (bucket_id = 'posts' and owner = auth.uid());

-- ------------------------------------------------------------------
-- 12. Vue : compteurs du fil (évite les N+1)
-- ------------------------------------------------------------------
create or replace view public.feed_counts
with (security_invoker = on) as
select
  p.id as post_id,
  (select count(*) from public.comments c where c.post_id = p.id and c.deleted_at is null) as comment_count
from public.posts p;
