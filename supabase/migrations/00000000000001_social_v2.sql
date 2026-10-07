-- ==================================================================
-- LIFTR - volet social v2 : likes, avatar, DM, profil Instagram
-- Idempotent : rejouable tel quel.
-- ==================================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------------
-- 1. Likes (coeur du fil type Twitter)
-- ------------------------------------------------------------------
create table if not exists public.likes (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  post_id    uuid not null references public.posts (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);

create index if not exists likes_post_idx on public.likes (post_id, created_at desc);
create index if not exists likes_user_idx on public.likes (user_id, created_at desc);

alter table public.likes enable row level security;

drop policy if exists "likes_read" on public.likes;
drop policy if exists "likes_ins"  on public.likes;
drop policy if exists "likes_del"  on public.likes;
create policy "likes_read" on public.likes for select using (true);
create policy "likes_ins"  on public.likes for insert with check (auth.uid() = user_id);
create policy "likes_del"  on public.likes for delete using (auth.uid() = user_id);

-- notifications : autoriser le type 'like'
alter table public.notifications
  drop constraint if exists notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('follow','comment','mention','like'));

create or replace function public.notify_like()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  owner uuid;
begin
  select author_id into owner from public.posts where id = new.post_id;
  if owner is not null and owner <> new.user_id then
    insert into public.notifications (user_id, actor_id, type, post_id)
    values (owner, new.user_id, 'like', new.post_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_like on public.likes;
create trigger trg_notify_like after insert on public.likes
  for each row execute function public.notify_like();

-- ------------------------------------------------------------------
-- 2. Compteurs du fil : commentaires + likes
-- ------------------------------------------------------------------
create or replace view public.feed_counts
with (security_invoker = on) as
select
  p.id as post_id,
  (select count(*) from public.comments c where c.post_id = p.id and c.deleted_at is null) as comment_count,
  (select count(*) from public.likes      l where l.post_id = p.id)                        as like_count
from public.posts p;

-- ------------------------------------------------------------------
-- 3. Conversations (1:1) + messages
--    user_a < user_b : une seule ligne par paire, quoi qu'on soit l'expéditeur.
-- ------------------------------------------------------------------
create table if not exists public.conversations (
  id             uuid primary key default gen_random_uuid(),
  user_a         uuid not null references public.profiles (id) on delete cascade,
  user_b         uuid not null references public.profiles (id) on delete cascade,
  last_message_at timestamptz not null default now(),
  last_preview   text not null default '' check (char_length(last_preview) <= 160),
  last_sender_id uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  check (user_a < user_b)
);

create unique index if not exists conversations_pair_key
  on public.conversations (user_a, user_b);
create index if not exists conversations_a_idx
  on public.conversations (user_a, last_message_at desc);
create index if not exists conversations_b_idx
  on public.conversations (user_b, last_message_at desc);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 4000),
  created_at      timestamptz not null default now(),
  read_at         timestamptz
);

create index if not exists messages_conv_idx
  on public.messages (conversation_id, created_at);
create index if not exists messages_unread_idx
  on public.messages (conversation_id) where read_at is null;

alter table public.conversations enable row level security;
alter table public.messages      enable row level security;

drop policy if exists "conversations_read" on public.conversations;
drop policy if exists "conversations_ins"  on public.conversations;
drop policy if exists "conversations_upd"  on public.conversations;
drop policy if exists "conversations_del"  on public.conversations;
create policy "conversations_read" on public.conversations for select
  using (auth.uid() in (user_a, user_b));
create policy "conversations_ins" on public.conversations for insert
  with check (auth.uid() in (user_a, user_b));
create policy "conversations_upd" on public.conversations for update
  using (auth.uid() in (user_a, user_b)) with check (auth.uid() in (user_a, user_b));
create policy "conversations_del" on public.conversations for delete
  using (auth.uid() in (user_a, user_b));

create or replace function public.is_conversation_member(p_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversations c
     where c.id = p_conv and (c.user_a = auth.uid() or c.user_b = auth.uid())
  );
$$;

drop policy if exists "messages_read" on public.messages;
drop policy if exists "messages_ins"  on public.messages;
drop policy if exists "messages_del"  on public.messages;
create policy "messages_read" on public.messages for select
  using (public.is_conversation_member(conversation_id));
create policy "messages_ins" on public.messages for insert
  with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id));
-- le corps d'un message n'est jamais modifié ; seul l'expéditeur peut supprimer le sien.
create policy "messages_del" on public.messages for delete
  using (sender_id = auth.uid());

-- dernier aperçu tenu à jour par le serveur (une seule requête côté client)
create or replace function public.bump_conversation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.conversations
     set last_message_at = new.created_at,
         last_preview    = left(new.body, 160),
         last_sender_id  = new.sender_id
   where id = new.conversation_id;
  return new;
end $$;

drop trigger if exists trg_bump_conversation on public.messages;
create trigger trg_bump_conversation after insert on public.messages
  for each row execute function public.bump_conversation();

-- marquer comme lu (l'appelant doit être un participant ; seul le destinataire est marqué)
create or replace function public.mark_conversation_read(p_conv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_conversation_member(p_conv) then return; end if;
  update public.messages
     set read_at = now()
   where conversation_id = p_conv and sender_id <> auth.uid() and read_at is null;
end $$;

revoke execute on function public.mark_conversation_read(uuid) from public;
grant  execute on function public.mark_conversation_read(uuid) to authenticated;

-- utilisé par les policies : tout le monde doit pouvoir l'exécuter
-- (pour anon il renvoie toujours false -> jeu de résultats vide, pas d'erreur).
grant execute on function public.is_conversation_member(uuid) to public, anon, authenticated;

-- ------------------------------------------------------------------
-- 4. Storage : bucket des avatars de profil
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880,
        array['image/webp','image/jpeg','image/png','image/avif'])
on conflict (id) do nothing;

drop policy if exists "avatars_read" on storage.objects;
drop policy if exists "avatars_ins"  on storage.objects;
drop policy if exists "avatars_upd"  on storage.objects;
drop policy if exists "avatars_del"  on storage.objects;
create policy "avatars_read" on storage.objects for select using (bucket_id = 'avatars');
create policy "avatars_ins"  on storage.objects for insert
  with check (bucket_id = 'avatars' and owner = auth.uid());
create policy "avatars_upd"  on storage.objects for update
  using (bucket_id = 'avatars' and owner = auth.uid());
create policy "avatars_del"  on storage.objects for delete
  using (bucket_id = 'avatars' and owner = auth.uid());
