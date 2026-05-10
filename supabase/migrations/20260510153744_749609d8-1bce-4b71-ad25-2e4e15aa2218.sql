ALTER TABLE public.search_query_cache
  ADD COLUMN IF NOT EXISTS rerank jsonb,
  ADD COLUMN IF NOT EXISTS rerank_updated_at timestamptz;