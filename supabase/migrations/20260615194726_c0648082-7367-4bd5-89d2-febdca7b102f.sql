
-- 1) Helper RPC to count pending work for each enrolled runner.
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
    SELECT count(*) INTO n
    FROM ai_enrichment_jobs
    WHERE status = 'pending';
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
      AND NOT EXISTS (
        SELECT 1 FROM episode_ai_classifications c
        WHERE c.episode_id = e.id AND c.classification_status = 'classified'
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

-- 2) Update queue-health-controller registry with the 5 new runners.
UPDATE app_settings
SET value = jsonb_set(value, '{runners}',
  (value->'runners') || jsonb_build_array(
    jsonb_build_object('name','embed_podcast',         'controls_key','embed_controls',                'pending_kind','embed_podcast_pending',         'wake_threshold',1,  'stall_runs',9999),
    jsonb_build_object('name','seo_enrich',            'controls_key','ai_seo_controls',               'pending_kind','seo_jobs_pending',              'wake_threshold',5,  'stall_runs',9999),
    jsonb_build_object('name','ai_categorize',         'controls_key','ai_categorize_controls',        'pending_kind','ai_categorize_pending',         'wake_threshold',1,  'stall_runs',9999),
    jsonb_build_object('name','episode_classifier',    'controls_key','episode_ai_classifier_controls','pending_kind','episode_classifier_pending',    'wake_threshold',20, 'stall_runs',9999),
    jsonb_build_object('name','entity_backfill',       'controls_key','entity_backfill_controls',      'pending_kind','entity_backfill_pending',       'wake_threshold',20, 'stall_runs',9999)
  )),
  updated_at = now()
WHERE key = 'queue_health_state';

-- 3) Clear the 2026-05-29 emergency pause flag on these controls so the controller
-- can manage them. The controller will immediately re-pause whichever has pending=0,
-- and pipeline-watchdog still protects against cost overruns.
UPDATE app_settings
SET value = (value - 'paused_at' - 'paused_by' - 'paused_reason' - 'budget_capped_at' - 'budget_capped_reason' - 'auto_paused_reason' - 'auto_paused_at')
            || jsonb_build_object('enabled', true, 'auto_paused_by', null),
    updated_at = now()
WHERE key IN ('embed_controls','ai_seo_controls','ai_categorize_controls','episode_ai_classifier_controls','entity_backfill_controls');

-- 4) Remove the spotify-transcript cron — Spotify does not return transcripts.
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT jobid FROM cron.job WHERE jobname ILIKE '%spotify-transcript%' LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;
END $$;

-- 5) Drop the now-unused spotify transcript setting.
DELETE FROM app_settings WHERE key = 'spotify_transcript_controls';
