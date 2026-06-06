-- Person bio generation must fail closed for deceased/historical identities.
-- A long-dead subject can be an episode topic, but not a generated
-- podcast guest/host biography unless an editor explicitly approves an
-- archival profile.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'person_bio_generation_policy',
  jsonb_build_object(
    'version', 2,
    'temporal_topic_only_skip', true,
    'requires_manual_or_archival_exception', true,
    'observation_copy_rule', 'Without explicit role evidence, generated person bios may only describe topic/mention context, never guest/interviewee/host participation.',
    'edge_function', 'person-bio-generator'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
