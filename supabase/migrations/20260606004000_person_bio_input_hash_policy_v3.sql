-- Person bio generation must not spend AI budget on unchanged evidence.
-- The edge function stores an input_hash in ai_bio_sources / overview_sources
-- and skips before creating a job or making AI calls when the evidence snapshot
-- has not changed.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'person_bio_generation_policy',
  jsonb_build_object(
    'version', 3,
    'temporal_topic_only_skip', true,
    'requires_manual_or_archival_exception', true,
    'input_hash_required', true,
    'unchanged_input_skip_before_job', true,
    'unchanged_input_estimated_cost_usd', 0,
    'observation_copy_rule', 'Without explicit role evidence, generated person bios may only describe topic/mention context, never guest/interviewee/host participation.',
    'edge_function', 'person-bio-generator'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
