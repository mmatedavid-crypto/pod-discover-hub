-- Person bio generation stays closed for deceased/historical topic-only people.
-- If there is no explicit editor-approved archival exception, these subjects can
-- be discussed as episode topics, but the runner must skip before creating an
-- enrichment job or spending AI budget.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'person_bio_generation_policy',
  jsonb_build_object(
    'version', 4,
    'temporal_topic_only_skip', true,
    'requires_manual_or_archival_exception', true,
    'skip_before_enrichment_job', true,
    'skip_before_ai_call', true,
    'unchanged_input_skip_before_job', true,
    'input_hash_required', true,
    'unchanged_input_estimated_cost_usd', 0,
    'dead_without_podcast_role_policy', 'topic_only_no_generated_podcast_persona',
    'no_podcast_role_copy_rule', 'A deceased or historical identity without explicit podcast role evidence may be shown only as a topic or mention, not as a podcast guest, host, or interviewee.',
    'observation_copy_rule', 'Without explicit role evidence, generated person bios may only describe topic/mention context, never guest/interviewee/host participation.',
    'edge_function', 'person-bio-generator',
    'reasserted_by', '20260606015000_person_bio_topic_only_no_job_policy_v4'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
