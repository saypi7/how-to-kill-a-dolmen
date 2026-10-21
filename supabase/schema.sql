-- Optional: run once in the Supabase SQL editor.
-- The Go server writes results using its server-only service role key.
create table if not exists public.game_results (
  id text primary key,
  room_code text not null,
  winner integer check (winner in (0, 1)),
  reason text not null,
  players jsonb not null,
  base_hp jsonb not null,
  finished_at timestamptz not null default now()
);

alter table public.game_results enable row level security;
revoke all on table public.game_results from anon, authenticated;
grant insert on table public.game_results to service_role;

create index if not exists game_results_finished_at_idx
  on public.game_results (finished_at desc);
