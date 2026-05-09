-- 1) Extend seo_enrich_runner schedule allowlist to include every-minute
CREATE OR REPLACE FUNCTION public.set_seo_enrich_runner_schedule(_schedule text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE v_jobid int;
BEGIN
  IF _schedule NOT IN ('* * * * *','*/2 * * * *','*/5 * * * *','*/10 * * * *','*/30 * * * *') THEN
    RAISE EXCEPTION 'invalid schedule: %', _schedule;
  END IF;
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname='podiverzum-seo-enrich-runner-5min';
  IF v_jobid IS NULL THEN RAISE EXCEPTION 'seo enrich runner cron not found'; END IF;
  PERFORM cron.alter_job(job_id := v_jobid, schedule := _schedule);
END $function$;

-- Bump current schedule now (37k pending -> every minute)
SELECT public.set_seo_enrich_runner_schedule('* * * * *');

-- 2) Episode embedding candidate selection (mirrors select_embed_candidates for podcasts)
CREATE OR REPLACE FUNCTION public.select_embed_episode_candidates(_model text, _limit integer)
RETURNS TABLE(
  id uuid, podcast_id uuid, title text, display_title text, description text,
  seo_description text, ai_summary text, topics text[], people text[],
  companies text[], tickers text[], ingredients text[], podcast_title text,
  podcast_display_title text, podcast_category text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT e.id, e.podcast_id, e.title, e.display_title, e.description,
         e.seo_description, e.ai_summary, e.topics, e.people, e.companies,
         e.tickers, e.ingredients,
         p.title AS podcast_title, p.display_title AS podcast_display_title, p.category AS podcast_category
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
    LEFT JOIN public.episode_embeddings ee
      ON ee.episode_id = e.id AND ee.model = _model
   WHERE ee.episode_id IS NULL
     AND p.rank_label IN ('S','A','B','C')
     AND COALESCE(p.shadow_rank_components->>'health_state','') NOT IN
         ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam')
   ORDER BY array_position(ARRAY['S','A','B','C']::text[], p.rank_label) NULLS LAST,
            e.published_at DESC NULLS LAST
   LIMIT GREATEST(1, LEAST(_limit, 200));
$function$;

-- 3) Episode embedding stats helper
CREATE OR REPLACE FUNCTION public.embed_episode_candidate_stats(_model text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH eligible AS (
    SELECT e.id
      FROM public.episodes e
      JOIN public.podcasts p ON p.id = e.podcast_id
     WHERE p.rank_label IN ('S','A','B','C')
       AND COALESCE(p.shadow_rank_components->>'health_state','') NOT IN
           ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam')
  ),
  embedded AS (
    SELECT episode_id FROM public.episode_embeddings WHERE model = _model
  )
  SELECT jsonb_build_object(
    'eligible_total', (SELECT count(*) FROM eligible),
    'already_embedded', (SELECT count(*) FROM embedded em JOIN eligible el ON el.id = em.episode_id),
    'missing_embedding', (SELECT count(*) FROM eligible el WHERE NOT EXISTS (SELECT 1 FROM embedded em WHERE em.episode_id = el.id))
  );
$function$;

-- 4) Adaptive cron RPC for episode embed runner
CREATE OR REPLACE FUNCTION public.set_embed_episode_schedule(_schedule text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'cron'
AS $function$
DECLARE v_jobid int;
BEGIN
  IF _schedule NOT IN ('* * * * *','*/2 * * * *','*/5 * * * *','*/15 * * * *','*/30 * * * *') THEN
    RAISE EXCEPTION 'invalid schedule: %', _schedule;
  END IF;
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname='podiverzum-embed-episode-1min';
  IF v_jobid IS NULL THEN RAISE EXCEPTION 'embed episode cron not found'; END IF;
  PERFORM cron.alter_job(job_id := v_jobid, schedule := _schedule);
END $function$;

-- 5) Primary key + indexes on episode_embeddings (for upsert + retrieval performance)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'episode_embeddings_pkey') THEN
    ALTER TABLE public.episode_embeddings ADD CONSTRAINT episode_embeddings_pkey PRIMARY KEY (episode_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_episode_embeddings_podcast ON public.episode_embeddings(podcast_id);

-- HNSW index for cosine similarity (built lazily; safe with empty table)
CREATE INDEX IF NOT EXISTS idx_episode_embeddings_hnsw_cos
  ON public.episode_embeddings
  USING hnsw (embedding vector_cosine_ops);

-- 6) Default control settings for episode embed runner
INSERT INTO public.app_settings(key, value)
VALUES ('embed_episode_controls', jsonb_build_object(
  'enabled', true,
  'model', 'google/text-embedding-004',
  'tiers', jsonb_build_array('S','A','B','C'),
  'batch_size', 50,
  'daily_budget_usd', 1.0
))
ON CONFLICT (key) DO NOTHING;

-- 7) Schedule the new cron job (every minute initially; runner will adapt)
SELECT cron.schedule(
  'podiverzum-embed-episode-1min',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://iqzkayoqqagowvxeaphe.supabase.co/functions/v1/embed-episode-runner',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxemtheW9xcWFnb3d2eGVhcGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDA3NzAsImV4cCI6MjA5MzU3Njc3MH0.KaeRcYcljGjrP_OAcTp_lapPSRsAYRq6gPJ2vYV7fz4"}'::jsonb,
    body := concat('{"trigger":"cron","ts":"', now(), '"}')::jsonb
  );
  $$
);