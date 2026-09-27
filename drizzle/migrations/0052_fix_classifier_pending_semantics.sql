CREATE OR REPLACE FUNCTION public.count_pipeline_pending(kind text)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n bigint := 0;
BEGIN
  IF kind = 'embed_podcast_pending' THEN
    SELECT count(*) INTO n
    FROM podcasts p
    WHERE p.rank_label IN ('S','A','B','C')
      AND p.language_decision = 'accept_hungarian'
      AND NOT EXISTS (
        SELECT 1 FROM podcast_embeddings pe
        WHERE pe.podcast_id = p.id AND pe.model = 'google/gemini-embedding-001'
      );
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
      AND p.language_decision = 'accept_hungarian';
  END IF;
  RETURN COALESCE(n, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.count_pipeline_pending(text) TO service_role;