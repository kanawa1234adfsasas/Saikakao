-- =====================================================================
-- Catatan pemakaian AI (untuk membatasi biaya dan audit). Jalankan di Supabase -> SQL Editor.
-- =====================================================================
create table if not exists public.ai_logs (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mode       text not null check (mode in ('llm')),
  ok         boolean not null default false,
  ms         integer,
  created_at timestamptz not null default now()
);

alter table public.ai_logs enable row level security;

-- admin hanya melihat dan menulis catatannya sendiri
drop policy if exists "ai_logs_select_own" on public.ai_logs;
create policy "ai_logs_select_own" on public.ai_logs
  for select to authenticated using (user_id = auth.uid() and public.is_admin());

drop policy if exists "ai_logs_insert_own" on public.ai_logs;
create policy "ai_logs_insert_own" on public.ai_logs
  for insert to authenticated with check (user_id = auth.uid() and public.is_admin());

create index if not exists ai_logs_user_hari on public.ai_logs (user_id, created_at desc);
