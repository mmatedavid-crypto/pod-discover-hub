CREATE OR REPLACE VIEW public.v_episode_quality_indicator_audit AS
WITH base AS (
  SELECT
    e.id AS episode_id,
    e.podcast_id,
    p.title AS podcast_title,
    p.display_title AS podcast_display_title,
    p.rank_label,
    p.podiverzum_rank,
    p.is_hungarian,
    p.language_decision,
    p.rss_status,
    p.shadow_rank_components,
    e.title,
    e.display_title,
    e.published_at,
    e.audio_url,
    e.episode_rank AS legacy_episode_rank,
    e.episode_rank_label AS legacy_episode_rank_label,
    e.episode_rank_reason AS legacy_episode_rank_reason,
    e.episode_rank_updated_at AS legacy_episode_rank_updated_at,
    coalesce(dq.issue_codes, '{}'::text[]) AS data_issue_codes,
    coalesce(dq.issue_count, 0) AS data_issue_count,
    CASE p.rank_label
      WHEN 'S' THEN 100
      WHEN 'A' THEN 70
      WHEN 'B' THEN 40
      WHEN 'C' THEN 20
      WHEN 'D' THEN 5
      WHEN 'E' THEN 5
      ELSE 10
    END AS tier_weight,
    CASE
      WHEN e.published_at IS NULL THEN 0
      WHEN e.published_at >= now() - interval '24 hours' THEN 60
      WHEN e.published_at >= now() - interval '72 hours' THEN 40
      WHEN e.published_at >= now() - interval '7 days' THEN 25
      WHEN e.published_at >= now() - interval '14 days' THEN 10
      ELSE 0
    END AS freshness_weight
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  LEFT JOIN public.v_episode_data_quality_issues dq ON dq.episode_id = e.id
),
scored AS (
  SELECT
    b.*,
    least(greatest(coalesce(b.podiverzum_rank, 0), 0), 10) AS displayed_quality_score,
    (
      b.tier_weight
      + b.freshness_weight
      + least(greatest(coalesce(b.podiverzum_rank, 0), 0), 10)
    ) AS computed_episode_score
  FROM base b
),
issues AS (
  SELECT
    s.*,
    array_remove(ARRAY[
      CASE WHEN s.podiverzum_rank IS NULL THEN 'podcast_quality_missing' END,
      CASE WHEN s.podiverzum_rank IS NOT NULL AND (s.podiverzum_rank < 0 OR s.podiverzum_rank > 10) THEN 'podcast_quality_out_of_range' END,
      CASE WHEN s.rank_label IS NOT NULL AND s.rank_label <> ALL (ARRAY['S', 'A', 'B', 'C', 'D', 'E']) THEN 'rank_label_invalid' END,
      CASE WHEN s.rank_label = 'S' AND coalesce(s.podiverzum_rank, 0) < 7 THEN 'rank_label_score_mismatch' END,
      CASE WHEN s.rank_label = 'A' AND coalesce(s.podiverzum_rank, 0) < 5 THEN 'rank_label_score_mismatch' END,
      CASE WHEN s.rank_label IN ('D', 'E') AND coalesce(s.podiverzum_rank, 0) > 7 THEN 'rank_label_score_mismatch' END,
      CASE
        WHEN s.legacy_episode_rank IS DISTINCT FROM 1
          OR s.legacy_episode_rank_label IS NOT NULL
          OR coalesce(s.legacy_episode_rank_reason, '{}'::jsonb) <> '{}'::jsonb
        THEN 'legacy_episode_rank_active'
      END,
      CASE
        WHEN s.legacy_episode_rank IS NOT NULL
          AND s.legacy_episode_rank IS DISTINCT FROM 1
          AND abs(s.legacy_episode_rank - s.computed_episode_score) > 30
        THEN 'legacy_episode_rank_diverges'
      END,
      CASE
        WHEN s.podiverzum_rank >= 7
          AND (
            s.data_issue_count >= 3
            OR 'missing_audio' = ANY(s.data_issue_codes)
            OR 'podcast_rss_unhealthy' = ANY(s.data_issue_codes)
            OR 'overcleaned' = ANY(s.data_issue_codes)
            OR 'dirty_clean_text' = ANY(s.data_issue_codes)
          )
        THEN 'high_quality_indicator_on_bad_data'
      END
    ], NULL) AS quality_issue_codes
  FROM scored s
),
weighted AS (
  SELECT
    i.*,
    (
      CASE WHEN 'high_quality_indicator_on_bad_data' = ANY(i.quality_issue_codes) THEN 40 ELSE 0 END
      + CASE WHEN 'legacy_episode_rank_active' = ANY(i.quality_issue_codes) THEN 25 ELSE 0 END
      + CASE WHEN 'legacy_episode_rank_diverges' = ANY(i.quality_issue_codes) THEN 25 ELSE 0 END
      + CASE WHEN 'podcast_quality_out_of_range' = ANY(i.quality_issue_codes) THEN 30 ELSE 0 END
      + CASE WHEN 'rank_label_score_mismatch' = ANY(i.quality_issue_codes) THEN 20 ELSE 0 END
      + CASE i.rank_label WHEN 'S' THEN 20 WHEN 'A' THEN 14 WHEN 'B' THEN 8 ELSE 2 END
      + CASE WHEN i.published_at >= now() - interval '30 days' THEN 10 ELSE 0 END
    ) AS quality_priority_score
  FROM issues i
)
SELECT
  episode_id,
  podcast_id,
  podcast_title,
  podcast_display_title,
  rank_label,
  podiverzum_rank,
  displayed_quality_score,
  computed_episode_score,
  legacy_episode_rank,
  legacy_episode_rank_label,
  legacy_episode_rank_reason,
  legacy_episode_rank_updated_at,
  title,
  display_title,
  published_at,
  audio_url,
  data_issue_codes,
  data_issue_count,
  quality_issue_codes,
  cardinality(quality_issue_codes) AS quality_issue_count,
  quality_priority_score
FROM weighted
WHERE cardinality(quality_issue_codes) > 0;

GRANT SELECT ON public.v_episode_quality_indicator_audit TO authenticated, service_role;

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
  SELECT e.id
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  WHERE p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
    AND p.rss_status <> ALL (ARRAY['failed', 'inactive'])
),
recent_eligible AS (
  SELECT e.id
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  WHERE p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
    AND p.rss_status <> ALL (ARRAY['failed', 'inactive'])
    AND e.published_at >= now() - make_interval(days => greatest(_recent_days, 1))
),
issue_rows AS (
  SELECT q.*
  FROM public.v_episode_data_quality_issues q
  JOIN eligible e ON e.id = q.episode_id
),
recent_issue_rows AS (
  SELECT q.*
  FROM public.v_episode_data_quality_issues q
  JOIN recent_eligible e ON e.id = q.episode_id
),
quality_rows AS (
  SELECT q.*
  FROM public.v_episode_quality_indicator_audit q
  JOIN eligible e ON e.id = q.episode_id
),
recent_quality_rows AS (
  SELECT q.*
  FROM public.v_episode_quality_indicator_audit q
  JOIN recent_eligible e ON e.id = q.episode_id
),
issue_counts AS (
  SELECT code, count(*) AS total
  FROM issue_rows q
  CROSS JOIN LATERAL unnest(q.issue_codes) AS code
  GROUP BY code
),
recent_issue_counts AS (
  SELECT code, count(*) AS total
  FROM recent_issue_rows q
  CROSS JOIN LATERAL unnest(q.issue_codes) AS code
  GROUP BY code
),
quality_issue_counts AS (
  SELECT code, count(*) AS total
  FROM quality_rows q
  CROSS JOIN LATERAL unnest(q.quality_issue_codes) AS code
  GROUP BY code
),
recent_quality_issue_counts AS (
  SELECT code, count(*) AS total
  FROM recent_quality_rows q
  CROSS JOIN LATERAL unnest(q.quality_issue_codes) AS code
  GROUP BY code
),
top_episodes AS (
  SELECT coalesce(jsonb_agg(item ORDER BY priority_score DESC), '[]'::jsonb) AS items
  FROM (
    SELECT
      jsonb_build_object(
        'episode_id', episode_id,
        'podcast_id', podcast_id,
        'podcast', coalesce(podcast_display_title, podcast_title),
        'title', coalesce(display_title, title),
        'rank_label', rank_label,
        'published_at', published_at,
        'priority_score', priority_score,
        'issue_codes', issue_codes,
        'raw_length', raw_length,
        'clean_length', clean_length,
        'retention_ratio', retention_ratio,
        'entity_signal_count', entity_signal_count
      ) AS item,
      priority_score
    FROM issue_rows
    ORDER BY priority_score DESC, published_at DESC NULLS LAST
    LIMIT greatest(_sample_limit, 1)
  ) ranked
),
top_quality_indicator_episodes AS (
  SELECT coalesce(jsonb_agg(item ORDER BY quality_priority_score DESC), '[]'::jsonb) AS items
  FROM (
    SELECT
      jsonb_build_object(
        'episode_id', episode_id,
        'podcast_id', podcast_id,
        'podcast', coalesce(podcast_display_title, podcast_title),
        'title', coalesce(display_title, title),
        'rank_label', rank_label,
        'podiverzum_rank', podiverzum_rank,
        'computed_episode_score', computed_episode_score,
        'legacy_episode_rank', legacy_episode_rank,
        'published_at', published_at,
        'quality_priority_score', quality_priority_score,
        'quality_issue_codes', quality_issue_codes,
        'data_issue_codes', data_issue_codes
      ) AS item,
      quality_priority_score
    FROM quality_rows
    ORDER BY quality_priority_score DESC, published_at DESC NULLS LAST
    LIMIT greatest(_sample_limit, 1)
  ) ranked
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'recent_days', greatest(_recent_days, 1),
  'eligible_hu_episodes', (SELECT count(*) FROM eligible),
  'recent_eligible_hu_episodes', (SELECT count(*) FROM recent_eligible),
  'episodes_with_issues', (SELECT count(*) FROM issue_rows),
  'recent_episodes_with_issues', (SELECT count(*) FROM recent_issue_rows),
  'episodes_with_quality_indicator_issues', (SELECT count(*) FROM quality_rows),
  'recent_episodes_with_quality_indicator_issues', (SELECT count(*) FROM recent_quality_rows),
  'issue_counts', coalesce((SELECT jsonb_object_agg(code, total) FROM issue_counts), '{}'::jsonb),
  'recent_issue_counts', coalesce((SELECT jsonb_object_agg(code, total) FROM recent_issue_counts), '{}'::jsonb),
  'quality_indicator_issue_counts', coalesce((SELECT jsonb_object_agg(code, total) FROM quality_issue_counts), '{}'::jsonb),
  'recent_quality_indicator_issue_counts', coalesce((SELECT jsonb_object_agg(code, total) FROM recent_quality_issue_counts), '{}'::jsonb),
  'top_episodes', (SELECT items FROM top_episodes),
  'top_quality_indicator_episodes', (SELECT items FROM top_quality_indicator_episodes)
);
$$;

GRANT EXECUTE ON FUNCTION public.get_data_quality_snapshot_v1(integer, integer) TO authenticated, service_role;
