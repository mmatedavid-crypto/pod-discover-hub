UPDATE app_settings
SET value = value || jsonb_build_object(
  'min_rank', 6,
  'require_full_backfill', false,
  'max_podcasts_per_run', 300,
  'max_episodes_per_run', 2000,
  'tiers', jsonb_build_array('S','A','B','C')
), updated_at = now()
WHERE key = 'ai_seo_controls';