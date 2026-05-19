
create table if not exists public.search_golden_queries (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  query_type text not null,
  expected_intent text,
  expected_podcast_slug text,
  expected_entity text,
  must_include jsonb not null default '[]'::jsonb,
  must_exclude jsonb not null default '[]'::jsonb,
  notes text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (query)
);
alter table public.search_golden_queries enable row level security;
create policy "golden public read" on public.search_golden_queries for select to public using (true);
create policy "golden admin write" on public.search_golden_queries for all to public using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));

create table if not exists public.search_benchmark_runs (
  id uuid primary key default gen_random_uuid(),
  label text,
  created_at timestamptz not null default now(),
  created_by uuid,
  engine text,
  query_count integer not null default 0,
  precision_at_3 numeric,
  precision_at_5 numeric,
  ndcg_at_10 numeric,
  mrr numeric,
  zero_result_rate numeric,
  false_positive_rate numeric,
  intent_accuracy numeric,
  latency_p50 numeric,
  latency_p95 numeric,
  notes text
);
alter table public.search_benchmark_runs enable row level security;
create policy "bench_runs public read" on public.search_benchmark_runs for select to public using (true);
create policy "bench_runs admin write" on public.search_benchmark_runs for all to public using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));

create table if not exists public.search_benchmark_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.search_benchmark_runs(id) on delete cascade,
  golden_id uuid not null references public.search_golden_queries(id) on delete cascade,
  query text not null,
  detected_intent text,
  confidence_band text,
  used_vector boolean,
  used_cohere boolean,
  used_hyde boolean,
  used_podcast_pin boolean,
  used_must_gate boolean,
  used_fallback boolean,
  latency_ms integer,
  result_count integer not null default 0,
  top_results jsonb not null default '[]'::jsonb,
  raw_meta jsonb not null default '{}'::jsonb,
  scores jsonb not null default '{}'::jsonb,
  precision_at_3 numeric,
  precision_at_5 numeric,
  ndcg_at_10 numeric,
  reciprocal_rank numeric,
  intent_correct boolean,
  notes text,
  scored_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, golden_id)
);
alter table public.search_benchmark_results enable row level security;
create policy "bench_results public read" on public.search_benchmark_results for select to public using (true);
create policy "bench_results admin write" on public.search_benchmark_results for all to public using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));

create table if not exists public.search_benchmark_competitors (
  id uuid primary key default gen_random_uuid(),
  golden_id uuid not null references public.search_golden_queries(id) on delete cascade,
  source text not null,
  top_results jsonb not null default '[]'::jsonb,
  scores jsonb not null default '{}'::jsonb,
  precision_at_5 numeric,
  notes text,
  collected_at timestamptz not null default now(),
  collected_by uuid
);
alter table public.search_benchmark_competitors enable row level security;
create policy "bench_comp public read" on public.search_benchmark_competitors for select to public using (true);
create policy "bench_comp admin write" on public.search_benchmark_competitors for all to public using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));

create index if not exists idx_bench_results_run on public.search_benchmark_results(run_id);
create index if not exists idx_bench_results_golden on public.search_benchmark_results(golden_id);
create index if not exists idx_bench_comp_golden on public.search_benchmark_competitors(golden_id);
