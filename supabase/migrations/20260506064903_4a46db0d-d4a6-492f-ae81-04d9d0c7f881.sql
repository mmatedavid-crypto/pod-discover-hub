
create table if not exists public.pi_dump_imports (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date,
  source text not null default 'podcast_index_dump',
  status text not null default 'open', -- open | ingesting | processing | done | failed
  feeds_received integer not null default 0,
  feeds_scanned integer not null default 0,
  candidates_accepted integer not null default 0,
  candidates_rejected integer not null default 0,
  auto_added integer not null default 0,
  queued integer not null default 0,
  hidden_low_rank integer not null default 0,
  skipped_duplicates integer not null default 0,
  failed_rss_tests integer not null default 0,
  notes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.pi_dump_imports enable row level security;
create policy "pi_dump_imports public read" on public.pi_dump_imports for select using (true);
create policy "pi_dump_imports admin write" on public.pi_dump_imports for all
  using (has_role(auth.uid(),'admin'::app_role)) with check (has_role(auth.uid(),'admin'::app_role));

create table if not exists public.pi_feed_staging (
  id uuid primary key default gen_random_uuid(),
  import_id uuid references public.pi_dump_imports(id) on delete cascade,
  pi_id bigint,
  rss_url text not null,
  title text,
  website_url text,
  image_url text,
  description text,
  language text,
  author text,
  episode_count integer,
  newest_item_at timestamptz,
  last_http_status integer,
  dead boolean not null default false,
  score integer,
  decision text, -- auto_add | queued | hidden | rejected | imported | failed
  reject_reason text,
  processed boolean not null default false,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (rss_url)
);
create index if not exists pi_feed_staging_processed_idx on public.pi_feed_staging(processed) where processed = false;
create index if not exists pi_feed_staging_import_idx on public.pi_feed_staging(import_id);
alter table public.pi_feed_staging enable row level security;
create policy "pi_feed_staging public read" on public.pi_feed_staging for select using (true);
create policy "pi_feed_staging admin write" on public.pi_feed_staging for all
  using (has_role(auth.uid(),'admin'::app_role)) with check (has_role(auth.uid(),'admin'::app_role));

create trigger pi_dump_imports_touch before update on public.pi_dump_imports
  for each row execute function public.touch_updated_at();
