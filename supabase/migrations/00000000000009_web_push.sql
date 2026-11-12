-- Web Push registrations are private to their signed-in Social account.
create extension if not exists pg_net;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%'),
  subscription jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists push_subscriptions_insert_own on public.push_subscriptions;
create policy push_subscriptions_insert_own on public.push_subscriptions
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists push_subscriptions_update_own on public.push_subscriptions;
create policy push_subscriptions_update_own on public.push_subscriptions
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists push_subscriptions_delete_own on public.push_subscriptions;
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete to authenticated using (auth.uid() = user_id);

-- The shared webhook secret is stored in Supabase Vault, never in this migration.
create or replace function public.dispatch_liftr_social_push()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, vault, net
as $$
declare
  dispatch_secret text;
begin
  select decrypted_secret into dispatch_secret
    from vault.decrypted_secrets
    where name = 'liftr_push_dispatch_secret'
    limit 1;
  if dispatch_secret is null then return new; end if;

  perform net.http_post(
    url := 'https://fgpbhosklbcaapijmnkj.supabase.co/functions/v1/send-social-push',
    body := jsonb_build_object(
      'type', 'INSERT', 'schema', 'public', 'table', 'notifications',
      'record', to_jsonb(new), 'old_record', null
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || dispatch_secret
    ),
    timeout_milliseconds := 1000
  );
  return new;
end;
$$;

revoke all on function public.dispatch_liftr_social_push() from public, anon, authenticated;

drop trigger if exists liftr_social_push_after_notification on public.notifications;
create trigger liftr_social_push_after_notification
  after insert on public.notifications
  for each row execute function public.dispatch_liftr_social_push();
