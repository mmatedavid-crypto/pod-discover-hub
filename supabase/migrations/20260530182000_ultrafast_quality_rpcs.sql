CREATE OR REPLACE FUNCTION public.get_data_quality_snapshot_v1(
  _recent_days integer DEFAULT 30,
  _sample_limit integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH eligible AS (
  SELECT
    e.id,
    e.podcast_id,
    e.title,
    e.display_title,
    e.published_at,
    e.audio_url,
    e.clean_text_status,
    e.ai_summary,
    e.ai_entities_version,
    e.people,
    e.mentioned,
    e.companies,
    e.organizations,
    e.topics,
    e.tickers,
    e.episode_rank,
    e.episode_rank_label,
    p.title AS podcast_title,
    p.display_title AS podcast_display_title,
    p.rank_label,
    p.podiverzum_rank
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  WHERE p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
    AND p.rss_status <> ALL (ARRAY['failed', 'inactive'])
),
counts AS (
  SELECT
    count(*) AS eligible_hu_episodes,
    count(*) FILTER (WHERE published_at >= now() - make_interval(days => greatest(_recent_days, 1))) AS recent_eligible_hu_episodes,
    count(*) FILTER (WHERE audio_url IS NULL OR length(trim(audio_url)) = 0) AS missing_audio,
    count(*) FILTER (WHERE published_at IS NULL) AS missing_published_at,
    count(*) FILTER (WHERE clean_text_status IS DISTINCT FROM 'done') AS missing_clean_text,
    count(*) FILTER (WHERE ai_summary IS NULL OR length(trim(ai_summary)) < 80) AS missing_summary,
    count(*) FILTER (WHERE coalesce(ai_entities_version, 0) < 4) AS old_entity_version,
    count(*) FILTER (
      WHERE (
        coalesce(cardinality(people), 0)
        + coalesce(cardinality(mentioned), 0)
        + coalesce(cardinality(companies), 0)
        + coalesce(cardinality(topics), 0)
        + coalesce(cardinality(tickers), 0)
        + CASE WHEN organizations IS NULL OR organizations::text IN ('null', '{}', '[]') THEN 0 ELSE 1 END
      ) = 0
    ) AS missing_entities,
    count(*) FILTER (
      WHERE episode_rank IS DISTINCT FROM 1 OR episode_rank_label IS NOT NULL
    ) AS legacy_episode_rank_active
  FROM eligible
),
recent_counts AS (
  SELECT
    count(*) FILTER (WHERE audio_url IS NULL OR length(trim(audio_url)) = 0) AS missing_audio,
    count(*) FILTER (WHERE published_at IS NULL) AS missing_published_at,
    count(*) FILTER (WHERE clean_text_status IS DISTINCT FROM 'done') AS missing_clean_text,
    count(*) FILTER (WHERE ai_summary IS NULL OR length(trim(ai_summary)) < 80) AS missing_summary,
    count(*) FILTER (WHERE coalesce(ai_entities_version, 0) < 4) AS old_entity_version,
    count(*) FILTER (
      WHERE (
        coalesce(cardinality(people), 0)
        + coalesce(cardinality(mentioned), 0)
        + coalesce(cardinality(companies), 0)
        + coalesce(cardinality(topics), 0)
        + coalesce(cardinality(tickers), 0)
        + CASE WHEN organizations IS NULL OR organizations::text IN ('null', '{}', '[]') THEN 0 ELSE 1 END
      ) = 0
    ) AS missing_entities,
    count(*) FILTER (
      WHERE episode_rank IS DISTINCT FROM 1 OR episode_rank_label IS NOT NULL
    ) AS legacy_episode_rank_active
  FROM eligible
  WHERE published_at >= now() - make_interval(days => greatest(_recent_days, 1))
),
top_episodes AS (
  SELECT coalesce(jsonb_agg(item ORDER BY priority_score DESC), '[]'::jsonb) AS items
  FROM (
    SELECT
      jsonb_build_object(
        'episode_id', id,
        'podcast_id', podcast_id,
        'podcast', coalesce(podcast_display_title, podcast_title),
        'title', coalesce(display_title, title),
        'rank_label', rank_label,
        'published_at', published_at,
        'priority_score', priority_score,
        'issue_codes', issue_codes
      ) AS item,
      priority_score
    FROM (
      SELECT
        *,
        array_remove(ARRAY[
          CASE WHEN audio_url IS NULL OR length(trim(audio_url)) = 0 THEN 'missing_audio' END,
          CASE WHEN clean_text_status IS DISTINCT FROM 'done' THEN 'missing_clean_text' END,
          CASE WHEN ai_summary IS NULL OR length(trim(ai_summary)) < 80 THEN 'missing_summary' END,
          CASE WHEN coalesce(ai_entities_version, 0) < 4 THEN 'old_entity_version' END,
          CASE WHEN episode_rank IS DISTINCT FROM 1 OR episode_rank_label IS NOT NULL THEN 'legacy_episode_rank_active' END
        ], NULL) AS issue_codes,
        (
          CASE rank_label WHEN 'S' THEN 50 WHEN 'A' THEN 35 WHEN 'B' THEN 20 WHEN 'C' THEN 10 ELSE 3 END
          + CASE WHEN published_at >= now() - interval '30 days' THEN 20 ELSE 0 END
          + CASE WHEN published_at >= now() - interval '7 days' THEN 15 ELSE 0 END
        ) AS priority_score
      FROM eligible
      WHERE clean_text_status IS DISTINCT FROM 'done'
        OR ai_summary IS NULL OR length(trim(ai_summary)) < 80
        OR coalesce(ai_entities_version, 0) < 4
        OR audio_url IS NULL OR length(trim(audio_url)) = 0
        OR episode_rank IS DISTINCT FROM 1
        OR episode_rank_label IS NOT NULL
      ORDER BY published_at DESC NULLS LAST
      LIMIT 2000
    ) candidates
    ORDER BY priority_score DESC, published_at DESC NULLS LAST
    LIMIT greatest(_sample_limit, 1)
  ) ranked
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'mode', 'ultrafast_snapshot',
  'recent_days', greatest(_recent_days, 1),
  'eligible_hu_episodes', (SELECT eligible_hu_episodes FROM counts),
  'recent_eligible_hu_episodes', (SELECT recent_eligible_hu_episodes FROM counts),
  'issue_counts', jsonb_build_object(
    'missing_audio', (SELECT missing_audio FROM counts),
    'missing_published_at', (SELECT missing_published_at FROM counts),
    'missing_clean_text', (SELECT missing_clean_text FROM counts),
    'missing_summary', (SELECT missing_summary FROM counts),
    'old_entity_version', (SELECT old_entity_version FROM counts),
    'missing_entities', (SELECT missing_entities FROM counts),
    'legacy_episode_rank_active', (SELECT legacy_episode_rank_active FROM counts)
  ),
  'recent_issue_counts', jsonb_build_object(
    'missing_audio', (SELECT missing_audio FROM recent_counts),
    'missing_published_at', (SELECT missing_published_at FROM recent_counts),
    'missing_clean_text', (SELECT missing_clean_text FROM recent_counts),
    'missing_summary', (SELECT missing_summary FROM recent_counts),
    'old_entity_version', (SELECT old_entity_version FROM recent_counts),
    'missing_entities', (SELECT missing_entities FROM recent_counts),
    'legacy_episode_rank_active', (SELECT legacy_episode_rank_active FROM recent_counts)
  ),
  'top_episodes', (SELECT items FROM top_episodes)
);
$$;

GRANT EXECUTE ON FUNCTION public.get_data_quality_snapshot_v1(integer, integer) TO anon, authenticated, service_role;

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
  SELECT
    e.id AS episode_id,
    e.podcast_id,
    p.title AS podcast_title,
    p.display_title AS podcast_display_title,
    p.rank_label,
    p.podiverzum_rank,
    e.title,
    e.display_title,
    e.published_at,
    CASE
      WHEN e.episode_rank IS DISTINCT FROM 1 OR e.episode_rank_label IS NOT NULL
        THEN 'neutralize_legacy_episode_rank'
      WHEN _include_ai AND e.clean_text_status IS DISTINCT FROM 'done'
        THEN 'clean_text_candidate'
      WHEN _include_ai AND (e.ai_summary IS NULL OR length(trim(e.ai_summary)) < 80 OR coalesce(e.ai_entities_version, 0) < 4)
        THEN 'ai_enrich_from_clean_text'
      WHEN e.audio_url IS NULL OR length(trim(e.audio_url)) = 0
        THEN 'source_health_review'
      ELSE null
    END AS repair_action,
    (
      CASE p.rank_label WHEN 'S' THEN 50 WHEN 'A' THEN 35 WHEN 'B' THEN 20 WHEN 'C' THEN 10 ELSE 3 END
      + CASE WHEN e.published_at >= now() - interval '30 days' THEN 20 ELSE 0 END
      + CASE WHEN e.published_at >= now() - interval '7 days' THEN 15 ELSE 0 END
    ) AS priority_score
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  WHERE p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
    AND p.rss_status <> ALL (ARRAY['failed', 'inactive'])
    AND (
      e.published_at IS NULL
      OR e.published_at >= now() - make_interval(days => greatest(_recent_days, 1))
      OR p.rank_label IN ('S', 'A', 'B')
    )
),
ranked AS (
  SELECT
    *,
    row_number() OVER (
      ORDER BY
        CASE repair_action
          WHEN 'neutralize_legacy_episode_rank' THEN 1
          WHEN 'clean_text_candidate' THEN 2
          WHEN 'ai_enrich_from_clean_text' THEN 3
          ELSE 9
        END,
        priority_score DESC,
        published_at DESC NULLS LAST
    ) AS repair_rank
  FROM eligible
  WHERE repair_action IS NOT NULL
),
limited AS (
  SELECT *
  FROM ranked
  WHERE repair_rank <= greatest(_limit, 1)
),
action_counts AS (
  SELECT repair_action, count(*) AS total
  FROM ranked
  GROUP BY repair_action
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'mode', 'ultrafast_plan',
  'dry_run', true,
  'limit', greatest(_limit, 1),
  'recent_days', greatest(_recent_days, 1),
  'include_ai', _include_ai,
  'eligible_repair_actions', (SELECT count(*) FROM ranked),
  'planned_repair_actions', (SELECT count(*) FROM limited),
  'action_counts', coalesce((SELECT jsonb_object_agg(repair_action, total) FROM action_counts), '{}'::jsonb),
  'items', coalesce((
    SELECT jsonb_agg(jsonb_build_object(
      'rank', repair_rank,
      'episode_id', episode_id,
      'podcast_id', podcast_id,
      'podcast', coalesce(podcast_display_title, podcast_title),
      'title', coalesce(display_title, title),
      'rank_label', rank_label,
      'podiverzum_rank', podiverzum_rank,
      'published_at', published_at,
      'repair_action', repair_action,
      'may_require_ai', repair_action IN ('clean_text_candidate', 'ai_enrich_from_clean_text'),
      'priority_score', priority_score
    ) ORDER BY repair_rank)
    FROM limited
  ), '[]'::jsonb)
);
$$;

GRANT EXECUTE ON FUNCTION public.get_data_repair_plan_v1(integer, integer, boolean) TO anon, authenticated, service_role;

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
  SELECT
    'organization'::text AS entity_kind,
    id AS entity_id,
    name,
    slug,
    org_type AS entity_type,
    episode_count,
    mention_count,
    distinct_podcast_count,
    is_public,
    is_indexable,
    is_browsable_in_hub,
    ai_review_status,
    ai_review_score,
    array_remove(ARRAY[
      CASE WHEN ai_review_status = 'reviewed' AND coalesce(ai_review_score, 1) <= 0.2 AND (is_indexable OR is_browsable_in_hub) THEN 'reviewed_low_confidence_still_indexable' END,
      CASE WHEN length(regexp_replace(name, '\s+', '', 'g')) <= 2 AND (is_indexable OR is_browsable_in_hub) AND distinct_podcast_count < 5 THEN 'short_ambiguous_org_indexable' END,
      CASE WHEN org_type = 'party' AND is_indexable AND ai_review_status = 'pending' THEN 'high_value_party_pending_review' END,
      CASE WHEN is_public AND NOT is_indexable AND episode_count >= 10 THEN 'high_signal_public_org_not_indexable' END
    ], NULL) AS issue_codes,
    CASE
      WHEN ai_review_status = 'reviewed' AND coalesce(ai_review_score, 1) <= 0.2 AND (is_indexable OR is_browsable_in_hub)
        THEN 'hide_low_confidence_organization'
      WHEN org_type = 'party' AND is_indexable AND ai_review_status = 'pending'
        THEN 'review_high_value_organization'
      WHEN is_public AND NOT is_indexable AND episode_count >= 10
        THEN 'review_hidden_high_signal_organization'
      ELSE 'entity_metadata_review'
    END AS repair_action,
    false AS may_require_ai,
    (
      CASE WHEN ai_review_status = 'reviewed' AND coalesce(ai_review_score, 1) <= 0.2 AND (is_indexable OR is_browsable_in_hub) THEN 95 ELSE 0 END
      + CASE WHEN length(regexp_replace(name, '\s+', '', 'g')) <= 2 AND (is_indexable OR is_browsable_in_hub) AND distinct_podcast_count < 5 THEN 80 ELSE 0 END
      + CASE WHEN org_type = 'party' AND is_indexable AND ai_review_status = 'pending' THEN 70 ELSE 0 END
      + least(coalesce(episode_count, 0), 100)::numeric / 100
    ) AS priority_score
  FROM public.organizations
),
filtered AS (
  SELECT *
  FROM issues
  WHERE cardinality(issue_codes) > 0
),
issue_counts AS (
  SELECT code, count(*) AS total
  FROM filtered, unnest(issue_codes) AS code
  GROUP BY code
),
action_counts AS (
  SELECT repair_action, count(*) AS total
  FROM filtered
  GROUP BY repair_action
),
top_queue AS (
  SELECT *
  FROM filtered
  ORDER BY priority_score DESC, episode_count DESC NULLS LAST, name
  LIMIT greatest(_limit, 1)
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'mode', 'ultrafast_entity_snapshot',
  'limit', greatest(_limit, 1),
  'total_issue_rows', (SELECT count(*) FROM filtered),
  'issue_counts', coalesce((SELECT jsonb_object_agg(code, total) FROM issue_counts), '{}'::jsonb),
  'action_counts', coalesce((SELECT jsonb_object_agg(repair_action, total) FROM action_counts), '{}'::jsonb),
  'top_queue', coalesce((
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
      'priority_score', priority_score
    ) ORDER BY priority_score DESC, episode_count DESC NULLS LAST, name)
    FROM top_queue
  ), '[]'::jsonb)
);
$$;

GRANT EXECUTE ON FUNCTION public.get_entity_quality_snapshot_v1(integer) TO anon, authenticated, service_role;
