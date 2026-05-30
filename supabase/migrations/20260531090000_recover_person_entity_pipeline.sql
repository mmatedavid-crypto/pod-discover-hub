-- Recover canonical person page creation after the fast-lane self-disabled.
-- Keep this pass focused on the no-AI person mapper so episode.people arrays
-- are promoted into people/person_episode_mentions without being blocked by
-- heavier entity/org workers.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'database_quality_fast_lane',
  jsonb_build_object(
    'enabled', true,
    'consecutive_errors', 0,
    'run_data_repair', false,
    'run_entity_quality', false,
    'run_youtube_pairer', false,
    'run_best_text_source', true,
    'best_text_source_limit', 1000,
    'run_clean_text', false,
    'run_entity_backfill', false,
    'run_person_entity_extractor', true,
    'person_entity_limit', 20000,
    'run_organizations_backfill', false,
    'run_topic_extractor', false,
    'max_runtime_ms', 150000,
    'auto_stop_at_errors', 10,
    'last_errors', jsonb_build_array(),
    'note', '2026-05-31: recover person entity mapper after partial people cache caused slug conflicts; focus fast lane on person canonicalization.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || jsonb_build_object(
    'enabled', true,
    'consecutive_errors', 0,
    'run_data_repair', false,
    'run_entity_quality', false,
    'run_youtube_pairer', false,
    'run_best_text_source', true,
    'best_text_source_limit', 1000,
    'run_clean_text', false,
    'run_entity_backfill', false,
    'run_person_entity_extractor', true,
    'person_entity_limit', 20000,
    'run_organizations_backfill', false,
    'run_topic_extractor', false,
    'max_runtime_ms', 150000,
    'auto_stop_at_errors', 10,
    'last_errors', jsonb_build_array(),
    'note', '2026-05-31: recover person entity mapper after partial people cache caused slug conflicts; focus fast lane on person canonicalization.'
  ),
  updated_at = now();
