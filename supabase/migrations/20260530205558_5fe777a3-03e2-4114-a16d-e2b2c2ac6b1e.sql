UPDATE app_settings
SET value = value
  || jsonb_build_object(
       'enabled', true,
       'adaptive_enabled', true,
       'resumed_at', now()::text,
       'resumed_by', 'lovable_adaptive_fastlane_restore_2026_05_30'
     )
  - 'paused_at' - 'paused_by' - 'paused_reason',
    updated_at = now()
WHERE key = 'youtube_episode_pairer_controls';

UPDATE app_settings
SET value = COALESCE(value, '{}'::jsonb) || jsonb_build_object('run_youtube_pairer', true),
    updated_at = now()
WHERE key = 'database_quality_fast_lane';