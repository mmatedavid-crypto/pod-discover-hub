CREATE OR REPLACE FUNCTION public.hu_content_intelligence_v2(_ids uuid[])
RETURNS TABLE(
  podcast_id uuid,
  episode_count int,
  audio_coverage numeric,
  summary_coverage numeric,
  topic_coverage numeric,
  entity_coverage numeric,
  avg_description_len numeric,
  recent_episode_count int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      e.podcast_id, e.id, e.audio_url, e.ai_summary, e.summary, e.description,
      e.topics, e.people, e.mentioned, e.companies, e.organizations, e.published_at
    FROM public.episodes e
    WHERE e.podcast_id = ANY(_ids)
      AND e.published_at >= now() - interval '365 days'
  ), agg AS (
    SELECT
      b.podcast_id,
      count(*)::int AS episode_count,
      count(*) FILTER (WHERE b.published_at >= now() - interval '90 days')::int AS recent_episode_count,
      avg(CASE WHEN b.audio_url IS NOT NULL AND length(b.audio_url) > 8 THEN 1 ELSE 0 END)::numeric AS audio_coverage,
      avg(CASE WHEN coalesce(length(b.ai_summary), length(b.summary), 0) >= 80 THEN 1 ELSE 0 END)::numeric AS summary_coverage,
      avg(CASE WHEN coalesce(array_length(b.topics, 1), 0) > 0 THEN 1 ELSE 0 END)::numeric AS topic_coverage,
      avg(CASE WHEN
        coalesce(array_length(b.people, 1), 0)
        + coalesce(array_length(b.mentioned, 1), 0)
        + coalesce(array_length(b.companies, 1), 0)
        + CASE WHEN jsonb_typeof(b.organizations) = 'array' THEN jsonb_array_length(b.organizations) ELSE 0 END > 0
        THEN 1 ELSE 0 END)::numeric AS entity_coverage,
      avg(length(coalesce(b.description, '')))::numeric AS avg_description_len
    FROM base b
    GROUP BY b.podcast_id
  )
  SELECT
    ids.id AS podcast_id,
    coalesce(a.episode_count, 0)::int,
    coalesce(a.audio_coverage, 0)::numeric,
    coalesce(a.summary_coverage, 0)::numeric,
    coalesce(a.topic_coverage, 0)::numeric,
    coalesce(a.entity_coverage, 0)::numeric,
    coalesce(a.avg_description_len, 0)::numeric,
    coalesce(a.recent_episode_count, 0)::int
  FROM unnest(_ids) AS ids(id)
  LEFT JOIN agg a ON a.podcast_id = ids.id;
$$;

GRANT EXECUTE ON FUNCTION public.hu_content_intelligence_v2(uuid[]) TO authenticated, service_role, anon;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'hu_formula_v2_policy',
  jsonb_build_object(
    'version', 1,
    'status', 'shadow',
    'manual_seed_required', false,
    'writes_live_rank', false,
    'formula', 'HU_v2',
    'max_score', 10,
    'thresholds', jsonb_build_object('S', 8.2, 'A', 6.4, 'B', 5.1, 'C', 3.8, 'D', 2.4),
    'components', jsonb_build_object(
      'market', 2.0, 'trust', 1.3, 'freshness', 1.2, 'category_activity', 1.3,
      'content_intelligence', 1.6, 'platform_availability', 0.7,
      'distinctiveness', 0.6, 'curation', 0.3
    ),
    'principles', jsonb_build_array(
      'Hungarian non-spam podcasts are admitted; rank only orders and weights.',
      'Chart popularity is useful but capped so it cannot dominate niche quality.',
      'Activity is category-normalized to avoid punishing slower premium formats.',
      'Episode data quality, topics, entities, summaries and audio coverage increase confidence.',
      'News/bulletin cadence is capped so many short items do not look like quality.'
    )
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();