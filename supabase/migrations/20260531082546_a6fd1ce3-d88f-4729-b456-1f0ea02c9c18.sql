UPDATE public.app_settings
SET value = value || jsonb_build_object(
      'tiers', jsonb_build_array('S','A'),
      'adaptive_enabled', true,
      'drain_podcast_batch', 2,
      'catchup_podcast_batch', 2,
      'maintenance_podcast_batch', 2,
      'drain_max_videos_per_channel', 80,
      'catchup_max_videos_per_channel', 80,
      'maintenance_max_videos_per_channel', 60,
      'drain_episode_limit', 250,
      'catchup_episode_limit', 200,
      'maintenance_episode_limit', 150,
      'time_budget_ms', 60000,
      'max_ai_calls_per_run', 12,
      'note', 'CPU-safe drain: batch=2, max_videos=80, episode_limit=250, time_budget=60s. Prevents WORKER_RESOURCE_LIMIT.'
    ),
    updated_at = now()
WHERE key = 'youtube_episode_pairer_controls';