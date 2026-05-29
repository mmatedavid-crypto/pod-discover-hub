
-- 1) Resume person_bio_generator
UPDATE app_settings
SET value = (value
    || jsonb_build_object('enabled', true,
                          'auto_paused_by', NULL,
                          'auto_paused_reason', NULL,
                          'auto_paused_at', NULL,
                          'auto_paused_detail', NULL,
                          'auto_resumed_at', to_jsonb(now()),
                          'auto_resumed_reason', 'manual_equilibrium_false_positive')),
    updated_at = now()
WHERE key = 'person_bio_generator_controls';

-- 2) Register activity_kind on each runner + reset sample history for person_bio_generator
UPDATE app_settings
SET value = jsonb_set(
    jsonb_set(value, '{history,person_bio_generator}', '{"samples":[],"p1":null,"p2":null}'::jsonb, true),
    '{runners}',
    '[
      {"name":"person_relevance_judge","controls_key":"person_relevance_judge_controls","pending_kind":"person_mentions_pending","wake_threshold":20,"stall_runs":10,"activity_kind":"person_mentions_activity","activity_window_min":20},
      {"name":"person_wikimedia_enricher","controls_key":"person_wikimedia_enricher_controls","pending_kind":"person_wiki_unchecked","wake_threshold":10,"stall_runs":10,"activity_kind":"person_wiki_activity","activity_window_min":20},
      {"name":"organization_wikimedia_enricher","controls_key":"organization_wikimedia_enricher_controls","pending_kind":"org_wiki_unchecked","wake_threshold":10,"stall_runs":10,"activity_kind":"org_wiki_activity","activity_window_min":20},
      {"name":"person_bio_generator","controls_key":"person_bio_generator_controls","pending_kind":"person_bio_pending","wake_threshold":10,"stall_runs":10,"activity_kind":"person_bio_activity","activity_window_min":30}
    ]'::jsonb, true),
    updated_at = now()
WHERE key = 'queue_health_state';
