-- Private Social groups/challenges, moderation controls and notification prefs.
-- Additive, RLS protected, and safe to re-run.

create table if not exists public.social_user_blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.social_user_blocks enable row level security;
drop policy if exists "social_blocks_read_related" on public.social_user_blocks;
drop policy if exists "social_blocks_insert_own" on public.social_user_blocks;
drop policy if exists "social_blocks_delete_own" on public.social_user_blocks;
create policy "social_blocks_read_related" on public.social_user_blocks for select
  using (auth.uid() = blocker_id);
create policy "social_blocks_insert_own" on public.social_user_blocks for insert
  with check (auth.uid() = blocker_id);
create policy "social_blocks_delete_own" on public.social_user_blocks for delete
  using (auth.uid() = blocker_id);
grant select, insert, delete on public.social_user_blocks to authenticated;
create or replace function public.is_social_blocked_by(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.social_user_blocks b
    where b.blocker_id = p_profile_id and b.blocked_id = auth.uid()
  )
$$;
revoke all on function public.is_social_blocked_by(uuid) from public;
grant execute on function public.is_social_blocked_by(uuid) to anon, authenticated;
create or replace function public.is_social_user_blocked(p_target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and exists (
    select 1 from public.social_user_blocks b where
      (b.blocker_id = auth.uid() and b.blocked_id = p_target) or
      (b.blocker_id = p_target and b.blocked_id = auth.uid())
  )
$$;
revoke all on function public.is_social_user_blocked(uuid) from public;
grant execute on function public.is_social_user_blocked(uuid) to anon, authenticated;

create table if not exists public.social_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_user_id uuid not null references public.profiles (id) on delete cascade,
  post_id uuid references public.posts (id) on delete set null,
  category text not null check (category in ('spam','harassment','unsafe','impersonation','other')),
  details text not null default '' check (char_length(details) <= 1000),
  created_at timestamptz not null default now(),
  check (reporter_id <> target_user_id)
);
alter table public.social_reports enable row level security;
drop policy if exists "social_reports_insert_own" on public.social_reports;
drop policy if exists "social_reports_read_own" on public.social_reports;
create policy "social_reports_insert_own" on public.social_reports for insert
  with check (auth.uid() = reporter_id);
create policy "social_reports_read_own" on public.social_reports for select
  using (auth.uid() = reporter_id);
grant select, insert on public.social_reports to authenticated;

create table if not exists public.social_notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  follow boolean not null default true,
  "like" boolean not null default true,
  comment boolean not null default true,
  mention boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.social_notification_preferences enable row level security;
drop policy if exists "social_notif_prefs_own" on public.social_notification_preferences;
create policy "social_notif_prefs_own" on public.social_notification_preferences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
grant select, insert, update, delete on public.social_notification_preferences to authenticated;

create table if not exists public.social_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  description text not null default '' check (char_length(description) <= 240),
  mode text not null default 'group' check (mode in ('group','challenge')),
  invite_code text not null unique check (char_length(invite_code) between 6 and 12),
  target_value numeric not null default 0 check (target_value >= 0 and target_value <= 100000),
  target_unit text not null default 'séances' check (char_length(target_unit) <= 20),
  ends_on date,
  created_at timestamptz not null default now()
);
create table if not exists public.social_group_members (
  group_id uuid not null references public.social_groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key (group_id,user_id)
);
create table if not exists public.social_group_entries (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.social_groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  value numeric not null default 1 check (value > 0 and value <= 100000),
  note text not null default '' check (char_length(note) <= 180),
  recorded_at date not null default current_date,
  created_at timestamptz not null default now()
);
create index if not exists social_group_members_user_idx on public.social_group_members(user_id,joined_at desc);
create index if not exists social_group_entries_group_idx on public.social_group_entries(group_id,recorded_at desc);
create or replace function public.is_social_group_member(p_group_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.social_group_members m where m.group_id = p_group_id and m.user_id = auth.uid())
$$;
revoke all on function public.is_social_group_member(uuid) from public;
grant execute on function public.is_social_group_member(uuid) to anon, authenticated;
alter table public.social_groups enable row level security;
alter table public.social_group_members enable row level security;
alter table public.social_group_entries enable row level security;
drop policy if exists "social_groups_read_members" on public.social_groups;
drop policy if exists "social_groups_update_owner" on public.social_groups;
drop policy if exists "social_groups_delete_owner" on public.social_groups;
drop policy if exists "social_members_read_group" on public.social_group_members;
drop policy if exists "social_entries_read_members" on public.social_group_entries;
drop policy if exists "social_entries_insert_member" on public.social_group_entries;
drop policy if exists "social_members_leave" on public.social_group_members;
create policy "social_groups_read_members" on public.social_groups for select using (
  public.is_social_group_member(id)
);
create policy "social_groups_update_owner" on public.social_groups for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "social_groups_delete_owner" on public.social_groups for delete using (auth.uid() = owner_id);
create policy "social_members_read_group" on public.social_group_members for select using (
  public.is_social_group_member(group_id)
);
create policy "social_members_leave" on public.social_group_members for delete using (
  auth.uid() = user_id and role = 'member'
);
create policy "social_entries_read_members" on public.social_group_entries for select using (
  public.is_social_group_member(group_id)
);
create policy "social_entries_insert_member" on public.social_group_entries for insert with check (
  auth.uid() = user_id and public.is_social_group_member(group_id)
);
grant select, update, delete on public.social_groups to authenticated;
grant select, delete on public.social_group_members to authenticated;
grant select, insert on public.social_group_entries to authenticated;

drop policy if exists "profiles_read" on public.profiles;
create policy "profiles_read" on public.profiles for select using (
  auth.uid() = id or not public.is_social_blocked_by(id)
);
drop policy if exists "follows_read" on public.follows;
create policy "follows_read" on public.follows for select using (
  not public.is_social_user_blocked(follower_id) and not public.is_social_user_blocked(followee_id)
);
drop policy if exists "follows_ins" on public.follows;
create policy "follows_ins" on public.follows for insert with check (
  auth.uid() = follower_id
  and not public.is_social_user_blocked(followee_id)
  and (
    state = 'pending'
    or (state = 'accepted' and not exists (
      select 1 from public.profiles p where p.id = follows.followee_id and p.is_private
    ))
  )
);
drop policy if exists "follows_upd" on public.follows;
create policy "follows_upd" on public.follows for update
  using (auth.uid() = followee_id and not public.is_social_user_blocked(follower_id))
  with check (auth.uid() = followee_id and state = 'accepted' and not public.is_social_user_blocked(follower_id));

create or replace function public.create_social_group(
  p_name text, p_mode text, p_description text, p_invite_code text,
  p_target_value numeric default 0, p_target_unit text default 'séances', p_ends_on date default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  insert into public.social_groups(owner_id,name,mode,description,invite_code,target_value,target_unit,ends_on)
  values (auth.uid(), left(trim(p_name),80), case when p_mode='challenge' then 'challenge' else 'group' end,
    left(coalesce(p_description,''),240), upper(left(trim(p_invite_code),12)), greatest(0,coalesce(p_target_value,0)), left(coalesce(p_target_unit,'séances'),20), p_ends_on)
  returning id into v_id;
  insert into public.social_group_members(group_id,user_id,role) values (v_id,auth.uid(),'owner');
  return v_id;
end $$;

create or replace function public.join_social_group(p_invite_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'authentication_required'; end if;
  select id into v_id from public.social_groups where invite_code = upper(trim(p_invite_code));
  if v_id is null then raise exception 'invite_not_found'; end if;
  insert into public.social_group_members(group_id,user_id,role) values (v_id,auth.uid(),'member') on conflict do nothing;
  return v_id;
end $$;
revoke all on function public.create_social_group(text,text,text,text,numeric,text,date) from public, anon;
revoke all on function public.join_social_group(text) from public, anon;
grant execute on function public.create_social_group(text,text,text,text,numeric,text,date) to authenticated;
grant execute on function public.join_social_group(text) to authenticated;

-- Mutual block: hide content in both directions at the database boundary.
drop policy if exists "posts_read" on public.posts;
create policy "posts_read" on public.posts for select using (
  deleted_at is null
  and not exists (select 1 from public.social_user_blocks b where
    (b.blocker_id = auth.uid() and b.blocked_id = posts.author_id) or
    (b.blocker_id = posts.author_id and b.blocked_id = auth.uid()))
  and (
    not exists (select 1 from public.profiles p where p.id = posts.author_id and p.is_private)
    or posts.author_id = auth.uid()
    or exists (select 1 from public.follows f where f.followee_id = posts.author_id and f.follower_id = auth.uid() and f.state = 'accepted')
  )
);
drop policy if exists "comments_read" on public.comments;
create policy "comments_read" on public.comments for select using (
  deleted_at is null
  and not exists (select 1 from public.social_user_blocks b where
    (b.blocker_id = auth.uid() and b.blocked_id = comments.author_id) or
    (b.blocker_id = comments.author_id and b.blocked_id = auth.uid()))
  and (
    not exists (select 1 from public.profiles p where p.id = comments.author_id and p.is_private)
    or comments.author_id = auth.uid()
    or exists (select 1 from public.follows f where f.followee_id = comments.author_id and f.follower_id = auth.uid() and f.state = 'accepted')
  )
);
drop policy if exists "notes_read" on public.notes;
create policy "notes_read" on public.notes for select using (
  expires_at > now()
  and not exists (select 1 from public.social_user_blocks b where
    (b.blocker_id = auth.uid() and b.blocked_id = notes.author_id) or
    (b.blocker_id = notes.author_id and b.blocked_id = auth.uid()))
  and (
    not exists (select 1 from public.profiles p where p.id = notes.author_id and p.is_private)
    or notes.author_id = auth.uid()
    or exists (select 1 from public.follows f where f.followee_id = notes.author_id and f.follower_id = auth.uid() and f.state = 'accepted')
  )
);
drop policy if exists "stories_read" on public.stories;
create policy "stories_read" on public.stories for select using (
  expires_at > now()
  and not exists (select 1 from public.social_user_blocks b where
    (b.blocker_id = auth.uid() and b.blocked_id = stories.author_id) or
    (b.blocker_id = stories.author_id and b.blocked_id = auth.uid()))
  and (
    not exists (select 1 from public.profiles p where p.id = stories.author_id and p.is_private)
    or stories.author_id = auth.uid()
    or exists (select 1 from public.follows f where f.followee_id = stories.author_id and f.follower_id = auth.uid() and f.state = 'accepted')
  )
);

-- A block also closes the existing direct-message channel in both directions.
create or replace function public.is_conversation_member(p_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.conversations c
     where c.id = p_conv
       and auth.uid() in (c.user_a, c.user_b)
       and not public.is_social_user_blocked(
         case when auth.uid() = c.user_a then c.user_b else c.user_a end
       )
  )
$$;
revoke all on function public.is_conversation_member(uuid) from public;
grant execute on function public.is_conversation_member(uuid) to anon, authenticated;

drop policy if exists "conversations_read" on public.conversations;
drop policy if exists "conversations_ins" on public.conversations;
drop policy if exists "conversations_upd" on public.conversations;
create policy "conversations_read" on public.conversations for select using (
  auth.uid() in (user_a, user_b)
  and not public.is_social_user_blocked(case when auth.uid() = user_a then user_b else user_a end)
);
create policy "conversations_ins" on public.conversations for insert with check (
  auth.uid() in (user_a, user_b)
  and not public.is_social_user_blocked(case when auth.uid() = user_a then user_b else user_a end)
);
create policy "conversations_upd" on public.conversations for update
  using (auth.uid() in (user_a, user_b)
    and not public.is_social_user_blocked(case when auth.uid() = user_a then user_b else user_a end))
  with check (auth.uid() in (user_a, user_b)
    and not public.is_social_user_blocked(case when auth.uid() = user_a then user_b else user_a end));
drop policy if exists "messages_read" on public.messages;
drop policy if exists "messages_ins" on public.messages;
create policy "messages_read" on public.messages for select
  using (public.is_conversation_member(conversation_id));
create policy "messages_ins" on public.messages for insert
  with check (sender_id = auth.uid() and public.is_conversation_member(conversation_id));

-- Blocked and private posts cannot be reached through likes or comments by id.
drop policy if exists "likes_read" on public.likes;
drop policy if exists "likes_ins" on public.likes;
create policy "likes_read" on public.likes for select using (
  exists (select 1 from public.posts p where p.id = likes.post_id)
);
create policy "likes_ins" on public.likes for insert with check (
  auth.uid() = user_id and exists (select 1 from public.posts p where p.id = likes.post_id)
);
drop policy if exists "comments_ins" on public.comments;
create policy "comments_ins" on public.comments for insert with check (
  auth.uid() = author_id and exists (select 1 from public.posts p where p.id = comments.post_id)
);
drop policy if exists "notifications_read" on public.notifications;
create policy "notifications_read" on public.notifications for select using (
  auth.uid() = user_id and not public.is_social_user_blocked(actor_id)
);
