
UPDATE app_settings
SET value = value
  || jsonb_build_object('enabled', true,
      'auto_resumed_at', now()::text,
      'auto_resumed_reason', 'count_mismatch_fix_2026-05-25')
  - 'auto_paused_at' - 'auto_paused_reason' - 'auto_paused_detail' - 'auto_paused_by',
    updated_at = now()
WHERE key IN (
  'organization_wikimedia_enricher_controls',
  'person_wikimedia_enricher_controls',
  'person_bio_generator_controls'
);

UPDATE app_settings
SET value = jsonb_set(value, '{runners}', '[]'::jsonb, false),
    updated_at = now()
WHERE key = 'queue_health_state';
