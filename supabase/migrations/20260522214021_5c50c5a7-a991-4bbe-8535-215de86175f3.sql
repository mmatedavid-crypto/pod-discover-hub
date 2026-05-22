-- Remove public read policies on internal pipeline tables; admin-only access remains via existing admin write policies.
-- Add explicit admin SELECT policies where only an ALL/write policy exists, to preserve admin readability.

DROP POLICY IF EXISTS "eer public read" ON public.entity_extraction_runs;
DROP POLICY IF EXISTS "plrq public read" ON public.podcast_language_review_queue;
DROP POLICY IF EXISTS "eac public read" ON public.episode_ai_classifications;
DROP POLICY IF EXISTS "eco public read" ON public.episode_category_overrides;
DROP POLICY IF EXISTS "etrr public read" ON public.episode_topic_relevance_reviews;
DROP POLICY IF EXISTS "pbb public read" ON public.podcast_boilerplate_blocks;
DROP POLICY IF EXISTS "rss_url_history public read" ON public.rss_url_history;
DROP POLICY IF EXISTS "bench_comp public read" ON public.search_benchmark_competitors;
DROP POLICY IF EXISTS "golden public read" ON public.search_golden_queries;
DROP POLICY IF EXISTS "sti public read" ON public.suggested_taxonomy_items;
DROP POLICY IF EXISTS "topic_figure_seed public read" ON public.topic_figure_seed;