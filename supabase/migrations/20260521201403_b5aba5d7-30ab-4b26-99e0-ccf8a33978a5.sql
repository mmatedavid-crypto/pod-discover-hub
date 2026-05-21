create table if not exists public.daily_brief_extras (
  date date primary key,
  on_this_day jsonb not null default '[]'::jsonb,
  quote jsonb,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.daily_brief_extras enable row level security;

create policy "daily_brief_extras public read"
  on public.daily_brief_extras
  for select
  using (true);

create or replace function public.update_daily_brief_extras_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

create trigger trg_daily_brief_extras_updated_at
  before update on public.daily_brief_extras
  for each row execute function public.update_daily_brief_extras_updated_at();