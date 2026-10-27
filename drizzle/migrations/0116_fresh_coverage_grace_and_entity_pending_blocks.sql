-- Fresh-episode coverage: judge only work a runner could already have done. An episode whose clean
-- text changed in the last 90 minutes is still in flight (entity runner every 30 min, vectors hourly),
-- and texts under 80 characters are never embedded by design, so neither may raise an alert.
CREATE OR REPLACE FUNCTION public.fresh_episode_coverage_v1(_from_days integer DEFAULT 7, _to_days integer DEFAULT 1)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '20s'
AS $$
  WITH f AS (
    SELECT e.id, e.seo_description, e.ai_entities_version, e.topic_extraction_status,
           (ct.episode_id IS NOT NULL AND ct.cleaner_method LIKE 'deterministic_v4%' AND length(ct.cleaned_text) >= 80) AS embed_eligible,
           COALESCE(ct.updated_at, ct.created_at, e.created_at) < now() - interval '90 minutes' AS settled
      FROM public.episodes e JOIN public.podcasts p ON p.id = e.podcast_id
      LEFT JOIN public.episode_clean_text ct ON ct.episode_id = e.id
     WHERE p.language_decision = 'accept_hungarian' AND e.clean_text_status = 'done'
       AND e.published_at >= now() - make_interval(days => _from_days)
       AND e.published_at < now() - make_interval(days => _to_days)
  )
  SELECT jsonb_build_object(
    'window_days', jsonb_build_array(_to_days, _from_days),
    'clean_episodes', count(*) FILTER (WHERE settled),
    'in_flight', count(*) FILTER (WHERE NOT settled),
    'missing_embedding', count(*) FILTER (WHERE settled AND embed_eligible AND NOT EXISTS (SELECT 1 FROM public.episode_embeddings x WHERE x.episode_id = f.id)),
    'not_embeddable_short_text', count(*) FILTER (WHERE settled AND NOT embed_eligible),
    'missing_seo', count(*) FILTER (WHERE settled AND f.seo_description IS NULL),
    'missing_entities', count(*) FILTER (WHERE settled AND COALESCE(f.ai_entities_version, 0) < 3),
    'topic_pending', count(*) FILTER (WHERE settled AND f.topic_extraction_status IN ('pending', 'error')))
  FROM f
$$;
REVOKE ALL ON FUNCTION public.fresh_episode_coverage_v1(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fresh_episode_coverage_v1(integer, integer) TO service_role;

-- Entity pending must not count episodes the runner has isolated (pipeline_item_blocks): they are
-- skipped every run, so counting them froze the number and made the controller pause a healthy runner.
CREATE OR REPLACE FUNCTION public.count_pipeline_pending(kind text)
 RETURNS bigint
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  n bigint := 0;
BEGIN
  IF kind = 'clean_text_pending' THEN
    SELECT count(*) INTO n FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
    WHERE e.clean_text_status='pending' AND p.language_decision='accept_hungarian';
  ELSIF kind = 'embed_podcast_pending' THEN
    SELECT count(*) INTO n FROM public.podcast_embed_due_v2();
  ELSIF kind = 'seo_jobs_pending' THEN
    SELECT count(*) INTO n FROM ai_enrichment_jobs WHERE status = 'pending';
  ELSIF kind = 'ai_categorize_pending' THEN
    SELECT count(*) INTO n
    FROM podcasts
    WHERE category IS NULL
      AND shadow_rank_tier IN ('S','A','B','C')
      AND language_decision = 'accept_hungarian';
  ELSIF kind = 'episode_classifier_pending' THEN
    SELECT count(*) INTO n
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE p.language_decision = 'accept_hungarian'
      AND p.rank_label IN ('S','A','B','C')
      AND e.ai_summary IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM episode_ai_classifications c
        WHERE c.episode_id = e.id AND c.taxonomy_version = 'v1'
      );
  ELSIF kind = 'entity_backfill_pending' THEN
    SELECT count(*) INTO n
    FROM episodes e
    JOIN podcasts p ON p.id = e.podcast_id
    WHERE (e.ai_entities_version IS NULL OR e.ai_entities_version < 5)
      AND e.clean_text_status = 'done'
      AND p.language_decision = 'accept_hungarian'
      AND NOT EXISTS (
        SELECT 1 FROM pipeline_item_blocks b
        WHERE b.runner = 'entity-backfill-runner' AND b.item_id = e.id AND b.cleared_at IS NULL
      );
  END IF;
  RETURN COALESCE(n, 0);
END;
$function$;