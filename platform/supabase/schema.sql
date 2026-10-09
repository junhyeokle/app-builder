-- Platform-level table (distinct from any generated app's own tables).
-- Tracks a platform user's app-building projects: the chat/spec state and
-- where to find the generated artifacts (preview + APK).

create table if not exists public.platform_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  slug text not null unique,
  app_name text,
  spec jsonb,
  status text not null default 'chatting', -- chatting | generating | ready | failed
  apk_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.platform_projects enable row level security;

create policy "Users can view their own projects"
  on public.platform_projects for select
  using (auth.uid() = user_id);

create policy "Users can insert their own projects"
  on public.platform_projects for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own projects"
  on public.platform_projects for update
  using (auth.uid() = user_id);

create policy "Users can delete their own projects"
  on public.platform_projects for delete
  using (auth.uid() = user_id);
