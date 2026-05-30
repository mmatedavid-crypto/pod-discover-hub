CREATE OR REPLACE VIEW public.v_entity_quality_issues AS
WITH org_issues AS (
  SELECT
    'organization'::text AS entity_kind,
    o.id AS entity_id,
    o.name,
    o.slug,
    o.org_type AS entity_type,
    o.episode_count,
    o.mention_count,
    o.distinct_podcast_count,
    o.is_public,
    o.is_indexable,
    o.is_browsable_in_hub,
    o.ai_review_status,
    o.ai_review_score,
    ARRAY_REMOVE(ARRAY[
      CASE
        WHEN o.ai_review_status = 'reviewed'
          AND COALESCE(o.ai_review_score, 1) <= 0.2
          AND (o.is_indexable OR o.is_browsable_in_hub)
          THEN 'reviewed_low_confidence_still_indexable'
      END,
      CASE
        WHEN o.ai_review_status = 'reviewed'
          AND COALESCE(o.ai_review_summary, '') ~* '(nem (egy )?(valódi|konkrét) szervezet|túl (rövid|általános)|elrejtésre javasolt|nem szervezet|téves kinyerés|nem azonosítható)'
          AND (o.is_indexable OR o.is_browsable_in_hub)
          THEN 'review_summary_rejects_but_indexable'
      END,
      CASE
        WHEN length(regexp_replace(o.name, '\s+', '', 'g')) <= 2
          AND (o.is_indexable OR o.is_browsable_in_hub)
          AND o.distinct_podcast_count < 5
          THEN 'short_ambiguous_org_indexable'
      END,
      CASE
        WHEN o.org_type = 'party'
          AND o.is_indexable
          AND o.ai_review_status = 'pending'
          THEN 'high_value_party_pending_review'
      END,
      CASE
        WHEN o.is_public AND NOT o.is_indexable AND o.episode_count >= 10
          THEN 'high_signal_public_org_not_indexable'
      END
    ], NULL)::text[] AS issue_codes,
    GREATEST(
      CASE
        WHEN o.ai_review_status = 'reviewed'
          AND COALESCE(o.ai_review_score, 1) <= 0.2
          AND (o.is_indexable OR o.is_browsable_in_hub)
          THEN 95 ELSE 0
      END,
      CASE
        WHEN o.ai_review_status = 'reviewed'
          AND COALESCE(o.ai_review_summary, '') ~* '(nem (egy )?(valódi|konkrét) szervezet|túl (rövid|általános)|elrejtésre javasolt|nem szervezet|téves kinyerés|nem azonosítható)'
          AND (o.is_indexable OR o.is_browsable_in_hub)
          THEN 90 ELSE 0
      END,
      CASE
        WHEN length(regexp_replace(o.name, '\s+', '', 'g')) <= 2
          AND (o.is_indexable OR o.is_browsable_in_hub)
          AND o.distinct_podcast_count < 5
          THEN 80 ELSE 0
      END,
      CASE
        WHEN o.org_type = 'party'
          AND o.is_indexable
          AND o.ai_review_status = 'pending'
          THEN 70 ELSE 0
      END,
      CASE
        WHEN o.is_public AND NOT o.is_indexable AND o.episode_count >= 10
          THEN 50 ELSE 0
      END
    ) + LEAST(COALESCE(o.episode_count, 0), 100)::numeric / 100 AS priority_score,
    CASE
      WHEN o.ai_review_status = 'reviewed'
        AND (
          COALESCE(o.ai_review_score, 1) <= 0.2
          OR COALESCE(o.ai_review_summary, '') ~* '(nem (egy )?(valódi|konkrét) szervezet|túl (rövid|általános)|elrejtésre javasolt|nem szervezet|téves kinyerés|nem azonosítható)'
        )
        AND (o.is_indexable OR o.is_browsable_in_hub)
        THEN 'hide_low_confidence_organization'
      WHEN o.org_type = 'party'
        AND o.is_indexable
        AND o.ai_review_status = 'pending'
        THEN 'review_high_value_organization'
      WHEN o.is_public AND NOT o.is_indexable AND o.episode_count >= 10
        THEN 'review_hidden_high_signal_organization'
      ELSE 'entity_metadata_review'
    END AS repair_action,
    false AS may_require_ai,
    CASE
      WHEN o.ai_review_status = 'reviewed'
        AND (
          COALESCE(o.ai_review_score, 1) <= 0.2
          OR COALESCE(o.ai_review_summary, '') ~* '(nem (egy )?(valódi|konkrét) szervezet|túl (rövid|általános)|elrejtésre javasolt|nem szervezet|téves kinyerés|nem azonosítható)'
        )
        AND (o.is_indexable OR o.is_browsable_in_hub)
        THEN 'no_ai_hide_only_keep_mentions_and_profile_row'
      ELSE 'no_ai_review_queue_only'
    END AS safety_policy
  FROM public.organizations o
),
person_issues AS (
  SELECT
    'person'::text AS entity_kind,
    p.id AS entity_id,
    p.name,
    p.slug,
    p.entity_type,
    p.episode_count,
    NULL::integer AS mention_count,
    p.distinct_podcast_count,
    p.is_public,
    p.is_indexable,
    p.is_browsable_in_people_hub AS is_browsable_in_hub,
    p.ai_review_status,
    p.ai_review_score,
    ARRAY_REMOVE(ARRAY[
      CASE
        WHEN p.is_indexable
          AND p.ai_review_status = 'pending'
          AND COALESCE(p.episode_count, 0) >= 10
          THEN 'high_signal_person_pending_review'
      END,
      CASE
        WHEN p.is_indexable
          AND COALESCE(p.identity_ambiguous, false)
          THEN 'ambiguous_person_indexable'
      END,
      CASE
        WHEN p.is_indexable
          AND COALESCE(p.duplicate_candidate, false)
          THEN 'duplicate_person_candidate_indexable'
      END,
      CASE
        WHEN p.is_indexable
          AND length(regexp_replace(p.name, '\s+', '', 'g')) <= 3
          THEN 'short_ambiguous_person_indexable'
      END
    ], NULL)::text[] AS issue_codes,
    GREATEST(
      CASE WHEN p.is_indexable AND p.ai_review_status = 'pending' AND COALESCE(p.episode_count, 0) >= 10 THEN 75 ELSE 0 END,
      CASE WHEN p.is_indexable AND COALESCE(p.identity_ambiguous, false) THEN 90 ELSE 0 END,
      CASE WHEN p.is_indexable AND COALESCE(p.duplicate_candidate, false) THEN 90 ELSE 0 END,
      CASE WHEN p.is_indexable AND length(regexp_replace(p.name, '\s+', '', 'g')) <= 3 THEN 80 ELSE 0 END
    ) + LEAST(COALESCE(p.episode_count, 0), 100)::numeric / 100 AS priority_score,
    CASE
      WHEN p.is_indexable AND (COALESCE(p.identity_ambiguous, false) OR COALESCE(p.duplicate_candidate, false))
        THEN 'review_ambiguous_person'
      WHEN p.is_indexable AND p.ai_review_status = 'pending' AND COALESCE(p.episode_count, 0) >= 10
        THEN 'review_high_signal_person'
      ELSE 'entity_metadata_review'
    END AS repair_action,
    false AS may_require_ai,
    'no_ai_review_queue_only'::text AS safety_policy
  FROM public.people p
),
unioned AS (
  SELECT * FROM org_issues
  UNION ALL
  SELECT * FROM person_issues
)
SELECT *
FROM unioned
WHERE array_length(issue_codes, 1) > 0;

GRANT SELECT ON public.v_entity_quality_issues TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_entity_quality_snapshot_v1(
  _limit integer DEFAULT 100
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH issues AS (
  SELECT *
  FROM public.v_entity_quality_issues
),
issue_counts AS (
  SELECT issue_code, count(*) AS total
  FROM issues, unnest(issue_codes) AS issue_code
  GROUP BY issue_code
),
action_counts AS (
  SELECT repair_action, count(*) AS total
  FROM issues
  GROUP BY repair_action
),
top_queue AS (
  SELECT *
  FROM issues
  ORDER BY priority_score DESC, episode_count DESC NULLS LAST, name
  LIMIT greatest(_limit, 1)
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'limit', greatest(_limit, 1),
  'total_issue_rows', (SELECT count(*) FROM issues),
  'issue_counts', COALESCE((SELECT jsonb_object_agg(issue_code, total) FROM issue_counts), '{}'::jsonb),
  'action_counts', COALESCE((SELECT jsonb_object_agg(repair_action, total) FROM action_counts), '{}'::jsonb),
  'top_queue', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'entity_kind', entity_kind,
      'entity_id', entity_id,
      'name', name,
      'slug', slug,
      'entity_type', entity_type,
      'episode_count', episode_count,
      'mention_count', mention_count,
      'distinct_podcast_count', distinct_podcast_count,
      'is_public', is_public,
      'is_indexable', is_indexable,
      'is_browsable_in_hub', is_browsable_in_hub,
      'ai_review_status', ai_review_status,
      'ai_review_score', ai_review_score,
      'issue_codes', issue_codes,
      'repair_action', repair_action,
      'may_require_ai', may_require_ai,
      'safety_policy', safety_policy,
      'priority_score', priority_score
    ) ORDER BY priority_score DESC, episode_count DESC NULLS LAST, name)
    FROM top_queue
  ), '[]'::jsonb)
);
$$;

GRANT EXECUTE ON FUNCTION public.get_entity_quality_snapshot_v1(integer) TO authenticated, service_role;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'entity_quality_controls',
  jsonb_build_object(
    'enabled', true,
    'dry_run', true,
    'batch_limit', 100,
    'allowed_apply_actions', jsonb_build_array('hide_low_confidence_organization'),
    'note', 'No-AI entity quality repair. Keeps rows and mentions; only hides reviewed low-confidence organizations from public index/hub.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

UPDATE public.app_settings
SET value = jsonb_set(
  value,
  '{runners}',
  (
    SELECT COALESCE(jsonb_agg(r), '[]'::jsonb)
    FROM jsonb_array_elements(COALESCE(value->'runners', '[]'::jsonb)) r
    WHERE r->>'name' <> 'entity_quality_apply_runner'
  )
  || jsonb_build_array(
    jsonb_build_object(
      'name', 'entity_quality_apply_runner',
      'controls_key', 'entity_quality_controls',
      'progress_key', 'entity_quality_controls',
      'spend_key', null,
      'cadence_minutes', 0,
      'min_processed_for_error_rate', 1
    )
  ),
  true
),
updated_at = now()
WHERE key = 'watchdog_state';
