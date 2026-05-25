
UPDATE app_settings
SET value = jsonb_set(
      value,
      '{runners}',
      '[
        {"name":"person_relevance_judge","controls_key":"person_relevance_judge_controls","pending_kind":"person_mentions_pending","wake_threshold":20,"stall_runs":10},
        {"name":"person_wikimedia_enricher","controls_key":"person_wikimedia_enricher_controls","pending_kind":"person_wiki_unchecked","wake_threshold":10,"stall_runs":10},
        {"name":"organization_wikimedia_enricher","controls_key":"organization_wikimedia_enricher_controls","pending_kind":"org_wiki_unchecked","wake_threshold":10,"stall_runs":10},
        {"name":"person_bio_generator","controls_key":"person_bio_generator_controls","pending_kind":"person_bio_pending","wake_threshold":10,"stall_runs":10}
      ]'::jsonb,
      false
    )
    - 'samples',
    updated_at = now()
WHERE key = 'queue_health_state';
