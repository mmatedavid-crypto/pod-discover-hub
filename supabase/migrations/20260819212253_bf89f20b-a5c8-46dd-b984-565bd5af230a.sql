CREATE TABLE IF NOT EXISTS public.ctr_snippet_optimizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  url text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  window_days integer,
  impressions integer,
  clicks integer,
  ctr numeric,
  position numeric,
  top_queries jsonb,
  old_seo_title text,
  old_seo_description text,
  new_seo_title text,
  new_seo_description text,
  model_used text,
  status text NOT NULL DEFAULT 'applied',
  error_message text
);

CREATE INDEX IF NOT EXISTS ctr_snippet_optimizations_url_idx ON public.ctr_snippet_optimizations (url, created_at DESC);
CREATE INDEX IF NOT EXISTS ctr_snippet_optimizations_created_idx ON public.ctr_snippet_optimizations (created_at DESC);

GRANT ALL ON public.ctr_snippet_optimizations TO service_role;
ALTER TABLE public.ctr_snippet_optimizations ENABLE ROW LEVEL SECURITY;