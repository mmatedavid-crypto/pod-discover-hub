UPDATE app_settings
SET value = jsonb_build_object(
  'enabled', true,
  'dry_run', false,
  'created_at', COALESCE(value->'created_at', to_jsonb(now())),
  'runners', jsonb_build_array(
    jsonb_build_object('name','person_relevance_judge','controls_key','person_relevance_judge_controls','pending_kind','person_mentions_pending','wake_threshold',20,'stall_runs',10),
    jsonb_build_object('name','person_wikimedia_enricher','controls_key','person_wikimedia_enricher_controls','pending_kind','person_wiki_unchecked','wake_threshold',10,'stall_runs',10),
    jsonb_build_object('name','organization_wikimedia_enricher','controls_key','organization_wikimedia_enricher_controls','pending_kind','org_wiki_unchecked','wake_threshold',10,'stall_runs',10),
    jsonb_build_object('name','person_bio_generator','controls_key','person_bio_generator_controls','pending_kind','person_bio_pending','wake_threshold',10,'stall_runs',10)
  ),
  'history', '{}'::jsonb,
  'live_since', to_jsonb(now())
),
updated_at = now()
WHERE key = 'queue_health_state';

INSERT INTO app_settings (key, value, updated_at) VALUES
  ('person_wikimedia_enricher_controls', jsonb_build_object('enabled', true, 'note', 'Managed by queue-health-controller', 'created_at', to_jsonb(now())), now()),
  ('organization_wikimedia_enricher_controls', jsonb_build_object('enabled', true, 'note', 'Managed by queue-health-controller', 'created_at', to_jsonb(now())), now()),
  ('person_bio_generator_controls', jsonb_build_object('enabled', true, 'daily_budget_usd', 20, 'note', 'Managed by queue-health-controller', 'created_at', to_jsonb(now())), now())
ON CONFLICT (key) DO UPDATE SET
  value = app_settings.value || jsonb_build_object('enabled', true, 'auto_paused_by', NULL, 'auto_paused_reason', NULL, 'auto_paused_at', NULL),
  updated_at = now();

UPDATE person_episode_mentions
SET relevance_status = 'pending'
WHERE relevance_status = 'in_progress'
  AND created_at < now() - interval '15 minutes';

UPDATE app_settings
SET value = value || jsonb_build_object(
  'enabled', true,
  'auto_disable_when_empty', true,
  'manually_paused_at', NULL,
  'manually_paused_reason', NULL,
  'reactivated_at', to_jsonb(now()),
  'reactivated_reason', 'Managed by queue-health-controller: auto-pause when empty, auto-resume when work appears.'
),
updated_at = now()
WHERE key = 'person_relevance_judge_controls';