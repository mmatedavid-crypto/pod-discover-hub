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
WITH eligible AS MATERIALIZED (
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
    e.episode_rank_reason,
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
scored AS (
  SELECT
    e.*,
    array_remove(ARRAY[
      CASE WHEN e.audio_url IS NULL OR length(trim(e.audio_url)) = 0 THEN 'missing_audio' END,
      CASE WHEN e.published_at IS NULL THEN 'missing_published_at' END,
      CASE WHEN e.clean_text_status IS DISTINCT FROM 'done' THEN 'missing_clean_text' END,
      CASE WHEN e.ai_summary IS NULL OR length(trim(e.ai_summary)) < 80 THEN 'missing_summary' END,
      CASE WHEN coalesce(e.ai_entities_version, 0) < 4 THEN 'old_entity_version' END,
      CASE
        WHEN (
          coalesce(cardinality(e.people), 0)
          + coalesce(cardinality(e.mentioned), 0)
          + coalesce(cardinality(e.companies), 0)
          + coalesce(cardinality(e.topics), 0)
          + coalesce(cardinality(e.tickers), 0)
          + CASE WHEN e.organizations IS NULL OR e.organizations::text IN ('null', '{}', '[]') THEN 0 ELSE 1 END
        ) = 0 THEN 'missing_entities'
      END,
      CASE
        WHEN e.episode_rank IS DISTINCT FROM 1
          OR e.episode_rank_label IS NOT NULL
          OR coalesce(e.episode_rank_reason, '{}'::jsonb) <> '{}'::jsonb
        THEN 'legacy_episode_rank_active'
      END
    ], NULL) AS issue_codes,
    (
      CASE e.rank_label WHEN 'S' THEN 50 WHEN 'A' THEN 35 WHEN 'B' THEN 20 WHEN 'C' THEN 10 ELSE 3 END
      + least(greatest(coalesce(e.podiverzum_rank, 0), 0), 10)::integer
      + CASE WHEN e.published_at >= now() - interval '30 days' THEN 20 ELSE 0 END
      + CASE WHEN e.published_at >= now() - interval '7 days' THEN 15 ELSE 0 END
      + CASE WHEN e.clean_text_status IS DISTINCT FROM 'done' THEN 20 ELSE 0 END
      + CASE WHEN coalesce(e.ai_entities_version, 0) < 4 THEN 15 ELSE 0 END
      + CASE WHEN e.ai_summary IS NULL OR length(trim(e.ai_summary)) < 80 THEN 10 ELSE 0 END
    ) AS priority_score
  FROM eligible e
),
issue_rows AS (
  SELECT *
  FROM scored
  WHERE cardinality(issue_codes) > 0
),
issue_counts AS (
  SELECT code, count(*) AS total
  FROM issue_rows
  CROSS JOIN LATERAL unnest(issue_codes) AS code
  GROUP BY code
),
recent_issue_counts AS (
  SELECT code, count(*) AS total
  FROM issue_rows
  CROSS JOIN LATERAL unnest(issue_codes) AS code
  WHERE published_at >= now() - make_interval(days => greatest(_recent_days, 1))
  GROUP BY code
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
    FROM issue_rows
    ORDER BY priority_score DESC, published_at DESC NULLS LAST
    LIMIT greatest(_sample_limit, 1)
  ) ranked
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'mode', 'fast_snapshot',
  'recent_days', greatest(_recent_days, 1),
  'eligible_hu_episodes', (SELECT count(*) FROM eligible),
  'recent_eligible_hu_episodes', (SELECT count(*) FROM eligible WHERE published_at >= now() - make_interval(days => greatest(_recent_days, 1))),
  'episodes_with_issues', (SELECT count(*) FROM issue_rows),
  'recent_episodes_with_issues', (SELECT count(*) FROM issue_rows WHERE published_at >= now() - make_interval(days => greatest(_recent_days, 1))),
  'issue_counts', coalesce((SELECT jsonb_object_agg(code, total) FROM issue_counts), '{}'::jsonb),
  'recent_issue_counts', coalesce((SELECT jsonb_object_agg(code, total) FROM recent_issue_counts), '{}'::jsonb),
  'top_episodes', (SELECT items FROM top_episodes)
);
$$;

GRANT EXECUTE ON FUNCTION public.get_data_quality_snapshot_v1(integer, integer) TO authenticated, service_role;

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
WITH candidates AS MATERIALIZED (
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
      WHEN e.episode_rank IS DISTINCT FROM 1
        OR e.episode_rank_label IS NOT NULL
        OR coalesce(e.episode_rank_reason, '{}'::jsonb) <> '{}'::jsonb
      THEN 'neutralize_legacy_episode_rank'
      WHEN e.clean_text_status IS DISTINCT FROM 'done'
      THEN 'clean_text_candidate'
      WHEN e.ai_summary IS NULL OR length(trim(e.ai_summary)) < 80 OR coalesce(e.ai_entities_version, 0) < 4
      THEN 'ai_enrich_from_clean_text'
      WHEN e.audio_url IS NULL OR length(trim(e.audio_url)) = 0
      THEN 'source_health_review'
      ELSE null
    END AS repair_action,
    array_remove(ARRAY[
      CASE WHEN e.episode_rank IS DISTINCT FROM 1 OR e.episode_rank_label IS NOT NULL OR coalesce(e.episode_rank_reason, '{}'::jsonb) <> '{}'::jsonb THEN 'legacy_episode_rank_active' END,
      CASE WHEN e.clean_text_status IS DISTINCT FROM 'done' THEN 'missing_clean_text' END,
      CASE WHEN e.ai_summary IS NULL OR length(trim(e.ai_summary)) < 80 THEN 'missing_summary' END,
      CASE WHEN coalesce(e.ai_entities_version, 0) < 4 THEN 'old_entity_version' END,
      CASE WHEN e.audio_url IS NULL OR length(trim(e.audio_url)) = 0 THEN 'missing_audio' END
    ], NULL) AS issue_codes,
    (
      CASE p.rank_label WHEN 'S' THEN 50 WHEN 'A' THEN 35 WHEN 'B' THEN 20 WHEN 'C' THEN 10 ELSE 3 END
      + least(greatest(coalesce(p.podiverzum_rank, 0), 0), 10)::integer
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
eligible AS (
  SELECT
    *,
    repair_action IN ('clean_text_candidate', 'ai_enrich_from_clean_text') AS may_require_ai,
    CASE repair_action
      WHEN 'neutralize_legacy_episode_rank' THEN 1
      WHEN 'clean_text_candidate' THEN 2
      WHEN 'ai_enrich_from_clean_text' THEN 3
      WHEN 'source_health_review' THEN 4
      ELSE 9
    END AS action_order
  FROM candidates
  WHERE repair_action IS NOT NULL
    AND (_include_ai OR repair_action NOT IN ('clean_text_candidate', 'ai_enrich_from_clean_text'))
),
ranked AS (
  SELECT *, row_number() OVER (ORDER BY action_order ASC, priority_score DESC, published_at DESC NULLS LAST) AS repair_rank
  FROM eligible
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
items AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
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
    'priority_score', priority_score
  ) ORDER BY repair_rank), '[]'::jsonb) AS rows
  FROM limited
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'mode', 'fast_plan',
  'dry_run', true,
  'limit', greatest(_limit, 1),
  'recent_days', greatest(_recent_days, 1),
  'include_ai', _include_ai,
  'eligible_repair_actions', (SELECT count(*) FROM eligible),
  'planned_repair_actions', (SELECT count(*) FROM limited),
  'action_counts', coalesce((SELECT jsonb_object_agg(repair_action, total) FROM action_counts), '{}'::jsonb),
  'items', (SELECT rows FROM items)
);
$$;

GRANT EXECUTE ON FUNCTION public.get_data_repair_plan_v1(integer, integer, boolean) TO authenticated, service_role;
