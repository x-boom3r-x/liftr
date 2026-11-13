-- Social notification controls. Additive and safe to re-run.
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
