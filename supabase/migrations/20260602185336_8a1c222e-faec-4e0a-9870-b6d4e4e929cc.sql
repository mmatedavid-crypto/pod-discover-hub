UPDATE app_settings
SET value = jsonb_set(value, '{tiers}', '["S","A","B","C"]'::jsonb)
         || jsonb_build_object(
              'tiers_expanded_at', now()::text,
              'tiers_expanded_reason', 'yt_coverage_drain_2026_06_02'
            )
WHERE key='youtube_episode_pairer_controls';