-- Drop unused trigram / array GIN indexes left over from pre-hybrid search.
-- Search v2 uses search_tsv (FTS) + episode_embeddings; these indexes have 0 scans
-- and only added write overhead. Frontend fallbacks (lib/search.ts, EntityPage) do
-- not benefit from them in practice (EntityPage uses .not is null + JS filter).

DROP INDEX IF EXISTS public.idx_episodes_companies_gin;
DROP INDEX IF EXISTS public.idx_episodes_people_gin;
DROP INDEX IF EXISTS public.idx_episodes_ingredients_gin;
DROP INDEX IF EXISTS public.idx_episodes_tickers_gin;
DROP INDEX IF EXISTS public.idx_episodes_topics_gin;
DROP INDEX IF EXISTS public.idx_podcasts_search_text_trgm;
DROP INDEX IF EXISTS public.idx_podcasts_description_trgm;