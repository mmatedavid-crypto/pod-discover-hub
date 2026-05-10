-- Cache for query understanding + embedding (7d TTL, refreshed on read)
CREATE TABLE public.search_query_cache (
  q_norm text PRIMARY KEY,
  understanding jsonb NOT NULL DEFAULT '{}'::jsonb,
  embedding vector(768),
  hits integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_search_query_cache_updated ON public.search_query_cache (updated_at DESC);
ALTER TABLE public.search_query_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qcache public read" ON public.search_query_cache FOR SELECT USING (true);
CREATE POLICY "qcache admin write" ON public.search_query_cache FOR ALL USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Cache for autosuggest typeahead (24h TTL)
CREATE TABLE public.search_suggest_cache (
  prefix text PRIMARY KEY,
  suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  hits integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_search_suggest_cache_updated ON public.search_suggest_cache (updated_at DESC);
ALTER TABLE public.search_suggest_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "scache public read" ON public.search_suggest_cache FOR SELECT USING (true);
CREATE POLICY "scache admin write" ON public.search_suggest_cache FOR ALL USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));