CREATE OR REPLACE VIEW public.v_data_repair_queue
WITH (security_invoker = on) AS
WITH data_issues AS (
  SELECT
    q.episode_id,
    q.podcast_id,
    q.podcast_title,
    q.podcast_display_title,
    q.rank_label,
    q.podiverzum_rank,
    q.title,
    q.display_title,
    q.published_at,
    q.issue_codes,
    q.priority_score,
    CASE
      WHEN q.issue_codes && ARRAY['missing_clean_text', 'overcleaned', 'undercleaned', 'dirty_clean_text']::text[]
        THEN 'clean_text_candidate'
      WHEN q.issue_codes && ARRAY['missing_summary', 'old_entity_version', 'missing_entities']::text[]
        THEN 'ai_enrich_from_clean_text'
      WHEN q.issue_codes && ARRAY['missing_embedding', 'stale_embedding']::text[]
        THEN 'rebuild_episode_embedding'
      WHEN q.issue_codes && ARRAY['missing_audio', 'podcast_rss_unhealthy']::text[]
        THEN 'source_health_review'
      ELSE 'metadata_review'
    END AS repair_action,
    CASE
      WHEN q.issue_codes && ARRAY['missing_clean_text', 'overcleaned', 'undercleaned', 'dirty_clean_text']::text[]
        THEN true
      WHEN q.issue_codes && ARRAY['missing_summary', 'old_entity_version', 'missing_entities']::text[]
        THEN true
      WHEN q.issue_codes && ARRAY['missing_embedding', 'stale_embedding']::text[]
        THEN false
      ELSE false
    END AS may_require_ai,
    CASE
      WHEN q.issue_codes && ARRAY['missing_clean_text', 'overcleaned', 'undercleaned', 'dirty_clean_text']::text[]
        THEN 'candidate_gate_then_promote_changed_only'
      WHEN q.issue_codes && ARRAY['missing_summary', 'old_entity_version', 'missing_entities']::text[]
        THEN 'skip_if_ai_enrich_input_hash_unchanged'
      WHEN q.issue_codes && ARRAY['missing_embedding', 'stale_embedding']::text[]
        THEN 'delete_embedding_after_clean_text_or_enrich_success'
      WHEN q.issue_codes && ARRAY['missing_audio', 'podcast_rss_unhealthy']::text[]
        THEN 'no_ai_source_fix_or_hide_from_quality_surfaces'
      ELSE 'manual_or_rule_based_review'
    END AS safety_policy
  FROM public.v_episode_data_quality_issues q
),
quality_issues AS (
  SELECT
    q.episode_id,
    q.podcast_id,
    q.podcast_title,
    q.podcast_display_title,
    q.rank_label,
    q.podiverzum_rank,
    q.title,
    q.display_title,
    q.published_at,
    q.quality_issue_codes AS issue_codes,
    q.quality_priority_score AS priority_score,
    CASE
      WHEN q.quality_issue_codes && ARRAY['legacy_episode_rank_active', 'legacy_episode_rank_diverges']::text[]
        THEN 'neutralize_legacy_episode_rank'
      WHEN q.quality_issue_codes && ARRAY['high_quality_indicator_on_bad_data', 'podcast_quality_out_of_range', 'rank_label_score_mismatch', 'rank_label_invalid', 'podcast_quality_missing']::text[]
        THEN 'quality_indicator_review'
      ELSE 'quality_metadata_review'
    END AS repair_action,
    false AS may_require_ai,
    CASE
      WHEN q.quality_issue_codes && ARRAY['legacy_episode_rank_active', 'legacy_episode_rank_diverges']::text[]
        THEN 'no_ai_reset_legacy_fields_only_after_explicit_apply'
      ELSE 'no_ai_review_rank_formula_inputs_before_public_display_changes'
    END AS safety_policy
  FROM public.v_episode_quality_indicator_audit q
),
unioned AS (
  SELECT * FROM data_issues
  UNION ALL
  SELECT * FROM quality_issues
),
deduped AS (
  SELECT
    u.*,
    row_number() OVER (
      PARTITION BY u.episode_id, u.repair_action
      ORDER BY u.priority_score DESC, u.published_at DESC NULLS LAST
    ) AS rn
  FROM unioned u
)
SELECT
  episode_id,
  podcast_id,
  podcast_title,
  podcast_display_title,
  rank_label,
  podiverzum_rank,
  title,
  display_title,
  published_at,
  repair_action,
  issue_codes,
  may_require_ai,
  safety_policy,
  priority_score,
  CASE repair_action
    WHEN 'clean_text_candidate' THEN 1
    WHEN 'ai_enrich_from_clean_text' THEN 2
    WHEN 'rebuild_episode_embedding' THEN 3
    WHEN 'neutralize_legacy_episode_rank' THEN 4
    WHEN 'quality_indicator_review' THEN 5
    WHEN 'source_health_review' THEN 6
    ELSE 9
  END AS action_order
FROM deduped
WHERE rn = 1;

GRANT SELECT ON public.v_data_repair_queue TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_data_repair_plan_v1(
  _limit integer DEFAULT 100,
  _recent_days integer DEFAULT 90,
  _include_ai boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH eligible AS (
  SELECT q.*
  FROM public.v_data_repair_queue q
  WHERE (_include_ai OR q.may_require_ai = false)
    AND (
      q.published_at IS NULL
      OR q.published_at >= now() - make_interval(days => greatest(_recent_days, 1))
      OR q.rank_label IN ('S', 'A', 'B')
    )
),
ranked AS (
  SELECT
    e.*,
    row_number() OVER (
      ORDER BY e.action_order ASC, e.priority_score DESC, e.published_at DESC NULLS LAST
    ) AS repair_rank
  FROM eligible e
),
limited AS (
  SELECT *
  FROM ranked
  WHERE repair_rank <= greatest(_limit, 1)
),
action_counts AS (
  SELECT repair_action, count(*) AS total
  FROM eligible
  GROUP BY repair_action
),
limited_action_counts AS (
  SELECT repair_action, count(*) AS total
  FROM limited
  GROUP BY repair_action
),
ai_counts AS (
  SELECT may_require_ai::text AS ai_bucket, count(*) AS total
  FROM eligible
  GROUP BY may_require_ai
),
items AS (
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'rank', repair_rank,
        'episode_id', episode_id,
        'podcast_id', podcast_id,
        'podcast', coalesce(podcast_display_title, podcast_title),
        'title', coalesce(display_title, title),
        'rank_label', rank_label,
        'podiverzum_rank', podiverzum_rank,
        'published_at', published_at,
        'repair_action', repair_action,
        'issue_codes', issue_codes,
        'may_require_ai', may_require_ai,
        'safety_policy', safety_policy,
        'priority_score', priority_score
      )
      ORDER BY repair_rank
    ),
    '[]'::jsonb
  ) AS rows
  FROM limited
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'dry_run', true,
  'limit', greatest(_limit, 1),
  'recent_days', greatest(_recent_days, 1),
  'include_ai', _include_ai,
  'eligible_repair_actions', (SELECT count(*) FROM eligible),
  'planned_repair_actions', (SELECT count(*) FROM limited),
  'action_counts', coalesce((SELECT jsonb_object_agg(repair_action, total) FROM action_counts), '{}'::jsonb),
  'planned_action_counts', coalesce((SELECT jsonb_object_agg(repair_action, total) FROM limited_action_counts), '{}'::jsonb),
  'ai_counts', coalesce((SELECT jsonb_object_agg(ai_bucket, total) FROM ai_counts), '{}'::jsonb),
  'items', (SELECT rows FROM items),
  'next_safe_steps', jsonb_build_array(
    'Review clean_text_candidate first; candidates are generated into staging and promoted only after quality gate.',
    'Run ai_enrich_from_clean_text only with input-hash dedupe and daily budget caps.',
    'Rebuild embeddings only after clean text or enrichment changed successfully.',
    'Neutralize legacy episode rank only as a no-AI explicit apply step.',
    'Keep source_health_review rows out of high-confidence surfaces until audio/RSS is healthy.'
  )
);
$$;

GRANT EXECUTE ON FUNCTION public.get_data_repair_plan_v1(integer, integer, boolean) TO authenticated, service_role;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'data_repair_controls',
  jsonb_build_object(
    'enabled', true,
    'dry_run', true,
    'recent_days', 90,
    'batch_limit', 100,
    'include_ai', false,
    'note', 'Planner only. No mutation and no AI spend until an explicit apply runner is added.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();