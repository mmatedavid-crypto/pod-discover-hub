-- lovable-cron-fallback-reviewed: drain is scheduled only while a weekly measurement run is open (wake-on-enqueue) and the function unschedules it after the run completes (~1.5h per week)
-- Stratified recommendation seeds: up to p_per_category recent accepted-Hungarian episodes with vectors per category.
CREATE OR REPLACE FUNCTION public.sample_search_quality_rec_seeds_v1(p_per_category integer DEFAULT 6, p_salt text DEFAULT 'sq1')
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH c AS (
    SELECT e.id, row_number() OVER (PARTITION BY p.category ORDER BY md5(e.id::text || coalesce(p_salt, 'sq1'))) rn
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
    JOIN public.episode_embeddings ee ON ee.episode_id = e.id
    WHERE p.language_decision = 'accept_hungarian'
      AND e.published_at > now() - interval '180 days'
  )
  SELECT coalesce(array_agg(id), '{}') FROM c WHERE rn <= greatest(1, least(coalesce(p_per_category, 6), 10));
$$;

-- Wake-on-enqueue: schedule the 2-minute drain only while a run is open; the function removes it when done.
CREATE OR REPLACE FUNCTION public.start_search_quality_drain_v1()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.search_quality_runs WHERE status = 'open') THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'search-quality-eval-drain') THEN
    RETURN true;
  END IF;
  PERFORM cron.schedule('search-quality-eval-drain', '*/2 * * * *', $c$SELECT net.http_post(
  url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/search-quality-eval',
  headers := jsonb_build_object('Content-Type','application/json','x-internal-token',(SELECT token FROM public.internal_job_tokens WHERE job = 'search-quality-eval')),
  body := '{"action":"tick","concurrency":3}'::jsonb,
  timeout_milliseconds := 150000
) WHERE EXISTS (SELECT 1 FROM public.search_quality_runs WHERE status = 'open');$c$);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.sample_search_quality_rec_seeds_v1(integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.start_search_quality_drain_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sample_search_quality_rec_seeds_v1(integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.start_search_quality_drain_v1() TO service_role;