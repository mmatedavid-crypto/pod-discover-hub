CREATE OR REPLACE VIEW public.v_episode_data_quality_issues AS
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
    e.description,
    ct.cleaned_text,
    ct.cleaner_method,
    ct.source_hash AS clean_source_hash,
    ct.updated_at AS clean_updated_at,
    emb.updated_at AS embedding_updated_at,
    length(trim(coalesce(e.description, ''))) AS raw_length,
    length(trim(coalesce(ct.cleaned_text, ''))) AS clean_length
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  LEFT JOIN public.episode_clean_text ct ON ct.episode_id = e.id
  LEFT JOIN public.episode_embeddings emb ON emb.episode_id = e.id
),
scored AS (
  SELECT
    b.*,
    CASE
      WHEN b.raw_length > 0 THEN b.clean_length::numeric / b.raw_length
      ELSE NULL
    END AS retention_ratio,
    (
      coalesce(cardinality(b.people), 0)
      + coalesce(cardinality(b.mentioned), 0)
      + coalesce(cardinality(b.companies), 0)
      + coalesce(cardinality(b.topics), 0)
      + coalesce(cardinality(b.tickers), 0)
      + CASE
          WHEN b.organizations IS NULL OR b.organizations::text IN ('null', '{}', '[]') THEN 0
          ELSE 1
        END
    ) AS entity_signal_count
  FROM base b
),
issues AS (
  SELECT
    s.*,
    array_remove(ARRAY[
      CASE WHEN s.is_hungarian IS DISTINCT FROM true OR s.language_decision IS DISTINCT FROM 'accept_hungarian' THEN 'podcast_language_not_accepted' END,
      CASE WHEN s.rss_status IN ('failed', 'inactive') THEN 'podcast_rss_unhealthy' END,
      CASE WHEN s.audio_url IS NULL OR length(trim(s.audio_url)) = 0 THEN 'missing_audio' END,
      CASE WHEN s.published_at IS NULL THEN 'missing_published_at' END,
      CASE WHEN s.cleaned_text IS NULL OR s.clean_text_status IS DISTINCT FROM 'done' THEN 'missing_clean_text' END,
      CASE WHEN s.raw_length >= 500 AND s.clean_length < 80 THEN 'overcleaned' END,
      CASE
        WHEN s.raw_length >= 500
          AND s.retention_ratio > 0.90
          AND lower(coalesce(s.description, '')) ~ '(https?://|www[.]|instagram|insta|facebook|tiktok|youtube|spotify|apple podcasts?|patreon|discord|telegram|linkedin|twitter|x[.]com|threads|whatsapp|rss|kovess|kövess|iratkozz|feliratkoz|subscribe|follow us|support us)'
        THEN 'undercleaned'
      END,
      CASE
        WHEN lower(coalesce(s.cleaned_text, '')) ~ '(https?://|www[.]|[a-z0-9._%+-]+@[a-z0-9.-]+[.][a-z]{2,}|instagram|insta|facebook|tiktok|youtube|spotify|apple podcasts?|patreon|discord|telegram|linkedin|twitter|x[.]com|threads|whatsapp|rss|kovess|kövess|iratkozz|feliratkoz|subscribe|follow us|support us)'
        THEN 'dirty_clean_text'
      END,
      CASE WHEN s.embedding_updated_at IS NULL THEN 'missing_embedding' END,
      CASE WHEN s.embedding_updated_at IS NOT NULL AND s.clean_updated_at IS NOT NULL AND s.embedding_updated_at < s.clean_updated_at THEN 'stale_embedding' END,
      CASE WHEN s.ai_summary IS NULL OR length(trim(s.ai_summary)) < 80 THEN 'missing_summary' END,
      CASE WHEN s.ai_entities_version < 4 THEN 'old_entity_version' END,
      CASE WHEN s.entity_signal_count = 0 THEN 'missing_entities' END
    ], NULL) AS issue_codes
  FROM scored s
),
weighted AS (
  SELECT
    i.*,
    (
      CASE i.rank_label WHEN 'S' THEN 50 WHEN 'A' THEN 35 WHEN 'B' THEN 20 WHEN 'C' THEN 10 ELSE 3 END
      + least(greatest(coalesce(i.podiverzum_rank, 0), 0), 10)::integer
      + CASE WHEN i.published_at >= now() - interval '30 days' THEN 20 ELSE 0 END
      + CASE WHEN i.published_at >= now() - interval '7 days' THEN 15 ELSE 0 END
      + CASE WHEN 'overcleaned' = ANY(i.issue_codes) THEN 30 ELSE 0 END
      + CASE WHEN 'undercleaned' = ANY(i.issue_codes) THEN 25 ELSE 0 END
      + CASE WHEN 'dirty_clean_text' = ANY(i.issue_codes) THEN 25 ELSE 0 END
      + CASE WHEN 'missing_clean_text' = ANY(i.issue_codes) THEN 20 ELSE 0 END
      + CASE WHEN 'missing_entities' = ANY(i.issue_codes) THEN 15 ELSE 0 END
      + CASE WHEN 'missing_embedding' = ANY(i.issue_codes) THEN 10 ELSE 0 END
      + CASE WHEN 'missing_audio' = ANY(i.issue_codes) THEN 10 ELSE 0 END
    ) AS priority_score
  FROM issues i
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
  raw_length,
  clean_length,
  retention_ratio,
  entity_signal_count,
  cleaner_method,
  clean_source_hash,
  clean_updated_at,
  embedding_updated_at,
  issue_codes,
  cardinality(issue_codes) AS issue_count,
  priority_score
FROM weighted
WHERE cardinality(issue_codes) > 0;

GRANT SELECT ON public.v_episode_data_quality_issues TO authenticated, service_role;

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
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'recent_days', greatest(_recent_days, 1),
  'eligible_hu_episodes', (SELECT count(*) FROM eligible),
  'recent_eligible_hu_episodes', (SELECT count(*) FROM recent_eligible),
  'episodes_with_issues', (SELECT count(*) FROM issue_rows),
  'recent_episodes_with_issues', (SELECT count(*) FROM recent_issue_rows),
  'issue_counts', coalesce((SELECT jsonb_object_agg(code, total) FROM issue_counts), '{}'::jsonb),
  'recent_issue_counts', coalesce((SELECT jsonb_object_agg(code, total) FROM recent_issue_counts), '{}'::jsonb),
  'top_episodes', (SELECT items FROM top_episodes)
);
$$;

GRANT EXECUTE ON FUNCTION public.get_data_quality_snapshot_v1(integer, integer) TO authenticated, service_role;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'data_quality_controls',
  jsonb_build_object(
    'enabled', true,
    'recent_days', 30,
    'sample_limit', 25,
    'quality_floor_pct', 90,
    'note', 'DB quality observability only. No mutation and no AI spend.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || excluded.value,
    updated_at = now();