-- Run this in your Supabase project's SQL editor (or via `supabase db push`).
-- This is the hand-built reference schema for the "list + form + auth" scaffold's
-- example app (Todo). Future generated apps derive their own tables the same way:
-- one table per resource, owned by user_id, with matching RLS policies.

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  is_done boolean not null default false,
  due_date date,
  created_at timestamptz not null default now()
);

alter table public.todos enable row level security;

create policy "Users can view their own todos"
  on public.todos for select
  using (auth.uid() = user_id);

create policy "Users can insert their own todos"
  on public.todos for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own todos"
  on public.todos for update
  using (auth.uid() = user_id);

create policy "Users can delete their own todos"
  on public.todos for delete
  using (auth.uid() = user_id);
