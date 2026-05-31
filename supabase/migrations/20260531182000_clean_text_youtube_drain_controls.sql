-- Keep the data-quality drain focused on deterministic text/source work.
-- Entity backfills are heavier and should not disable the clean-text/YouTube lane.

DROP POLICY IF EXISTS "episode best text source readonly audit" ON public.episode_best_text_source;
DROP POLICY IF EXISTS "episode clean text candidates readonly audit" ON public.episode_clean_text_candidates;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    CREATE POLICY "episode best text source readonly audit"
      ON public.episode_best_text_source
      FOR SELECT
      TO readonly_codex
      USING (true);

    CREATE POLICY "episode clean text candidates readonly audit"
      ON public.episode_clean_text_candidates
      FOR SELECT
      TO readonly_codex
      USING (true);
  END IF;
END $$;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'clean_text_autopilot',
  jsonb_build_object(
    'enabled', true,
    'dry_run', false,
    'mode', 'bad_or_old',
    'tiers', jsonb_build_array('S','A','B','C','D','E'),
    'stage_limit', 1000,
    'candidate_batch', 500,
    'promote_limit', 500,
    'ai_enrich_limit', 0,
    'daily_budget_usd', 0,
    'consecutive_errors', 0,
    'auto_stop_at_errors', 5,
    'note', 'Deterministic v4 drain can run without AI and falls back to direct old/missing clean-text selection.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'enabled', true,
    'dry_run', false,
    'mode', 'bad_or_old',
    'stage_limit', 1000,
    'candidate_batch', 500,
    'promote_limit', 500,
    'ai_enrich_limit', 0,
    'daily_budget_usd', 0,
    'consecutive_errors', 0,
    'note', 'Deterministic v4 drain can run without AI and falls back to direct old/missing clean-text selection.'
  ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_best_text_source_controls',
  jsonb_build_object(
    'enabled', true,
    'batch_limit', 5000,
    'youtube_min_confidence', 0.78,
    'spotify_min_confidence', 0.55,
    'prefer_external_gain_chars', 150,
    'rescan_after_days', 7,
    'policy', 'best_text_source_v1_confirmed_youtube_first'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'enabled', true,
    'batch_limit', 5000,
    'policy', 'best_text_source_v1_confirmed_youtube_first'
  ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'database_quality_fast_lane',
  jsonb_build_object(
    'enabled', true,
    'run_youtube_pairer', true,
    'run_best_text_source', true,
    'best_text_source_limit', 5000,
    'run_clean_text', true,
    'run_data_repair', false,
    'run_entity_quality', false,
    'run_entity_backfill', false,
    'run_person_entity_extractor', false,
    'run_organizations_backfill', false,
    'run_topic_extractor', false,
    'consecutive_errors', 0,
    'auto_stop_at_errors', 5,
    'max_runtime_ms', 145000,
    'note', 'Focused deterministic drain: YouTube pairing, best text source, clean text v4. Heavy entity jobs are decoupled.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'enabled', true,
    'run_youtube_pairer', true,
    'run_best_text_source', true,
    'best_text_source_limit', 5000,
    'run_clean_text', true,
    'run_data_repair', false,
    'run_entity_quality', false,
    'run_entity_backfill', false,
    'run_person_entity_extractor', false,
    'run_organizations_backfill', false,
    'run_topic_extractor', false,
    'consecutive_errors', 0,
    'note', 'Focused deterministic drain: YouTube pairing, best text source, clean text v4. Heavy entity jobs are decoupled.'
  ),
  updated_at = now();
