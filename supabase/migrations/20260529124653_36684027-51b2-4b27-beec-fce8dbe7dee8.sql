
-- 1. Lift global incident mode so non-AI background jobs (homepage feed refresh,
--    queue drainer, RSS hunter, sitemap, etc.) can run again.
UPDATE app_settings
SET value = jsonb_build_object(
  'enabled', true,
  'incident_mode', false,
  'resumed_at', now()::text,
  'resumed_by', 'lovable_restore_site_2026_05_29',
  'resumed_note', 'frontend restore — AI runners stay disabled individually',
  'previous_pause_reason', value->>'paused_reason'
)
WHERE key = 'background_jobs';

-- 2. Watchdog: keep it ENFORCING (dry_run=false) so any AI runner that gets
--    accidentally re-enabled and overspends will be auto-paused.
UPDATE app_settings
SET value = COALESCE(value, '{}'::jsonb) || jsonb_build_object(
  'enabled', true,
  'dry_run', false,
  'budget_overshoot_ratio', 1.1
)
WHERE key = 'watchdog_state';

-- 3. AI-cost runners stay DISABLED individually. Re-affirm enabled:false on each
--    so a future code path can't silently flip them via default-true logic.
UPDATE app_settings
SET value = value || jsonb_build_object(
  'enabled', false,
  'kept_disabled_at', now()::text,
  'kept_disabled_reason', 'press_launch_cost_freeze_2026_05_29'
)
WHERE key IN (
  'embed_episode_controls',
  'embed_chunks_controls',
  'entity_backfill_controls',
  'person_bio_generator_controls',
  'person_relevance_judge_controls',
  'person_wikimedia_enricher_controls',
  'organization_wikimedia_enricher_controls',
  'episode_classifier_controls',
  'episode_topic_extractor_controls',
  'topic_judge_controls',
  'organization_ai_review_controls',
  'ai_feed_scout_controls',
  'person_wiki_review_controls',
  'youtube_transcript_controls',
  'stt_controls'
);
