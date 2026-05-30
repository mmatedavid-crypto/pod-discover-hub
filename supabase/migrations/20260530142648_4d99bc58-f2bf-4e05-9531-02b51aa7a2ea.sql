-- 20260530172000_entity_extraction_evidence_v5
ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS entity_extraction_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.episode_organization_map
  ADD COLUMN IF NOT EXISTS source_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_episodes_entity_evidence_gin
  ON public.episodes USING gin (entity_extraction_evidence);

UPDATE public.app_settings
SET value = value
  || jsonb_build_object(
    'entity_schema_version', 5,
    'strict_evidence_required', true,
    'note', 'Entity extraction v5 requires literal evidence for people/orgs before public/indexable mapping. Keeps legacy arrays for compatibility.'
  ),
  updated_at = now()
WHERE key = 'entity_backfill_controls';

-- 20260530175000_fast_quality_snapshot_rpc (full content from file)
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
    e.id, e.podcast_id, e.title, e.display_title, e.published_at, e.audio_url,
    e.clean_text_status, e.ai_summary, e.ai_entities_version,
    e.people, e.mentioned, e.companies, e.organizations, e.topics, e.tickers,
    e.episode_rank, e.episode_rank_label, e.episode_rank_reason,
    p.title AS podcast_title, p.display_title AS podcast_display_title,
    p.rank_label, p.podiverzum_rank
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  WHERE p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
    AND p.rss_status <> ALL (ARRAY['failed', 'inactive'])
),
scored AS (
  SELECT e.*,
    array_remove(ARRAY[
      CASE WHEN e.audio_url IS NULL OR length(trim(e.audio_url)) = 0 THEN 'missing_audio' END,
      CASE WHEN e.published_at IS NULL THEN 'missing_published_at' END,
      CASE WHEN e.clean_text_status IS DISTINCT FROM 'done' THEN 'missing_clean_text' END,
      CASE WHEN e.ai_summary IS NULL OR length(trim(e.ai_summary)) < 80 THEN 'missing_summary' END,
      CASE WHEN coalesce(e.ai_entities_version, 0) < 4 THEN 'old_entity_version' END,
      CASE WHEN (
          coalesce(cardinality(e.people), 0)
          + coalesce(cardinality(e.mentioned), 0)
          + coalesce(cardinality(e.companies), 0)
          + coalesce(cardinality(e.topics), 0)
          + coalesce(cardinality(e.tickers), 0)
          + CASE WHEN e.organizations IS NULL OR e.organizations::text IN ('null', '{}', '[]') THEN 0 ELSE 1 END
        ) = 0 THEN 'missing_entities' END,
      CASE WHEN e.episode_rank IS DISTINCT FROM 1 OR e.episode_rank_label IS NOT NULL
          OR coalesce(e.episode_rank_reason, '{}'::jsonb) <> '{}'::jsonb
        THEN 'legacy_episode_rank_active' END
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
issue_rows AS (SELECT * FROM scored WHERE cardinality(issue_codes) > 0),
issue_counts AS (SELECT code, count(*) AS total FROM issue_rows CROSS JOIN LATERAL unnest(issue_codes) AS code GROUP BY code),
recent_issue_counts AS (SELECT code, count(*) AS total FROM issue_rows CROSS JOIN LATERAL unnest(issue_codes) AS code WHERE published_at >= now() - make_interval(days => greatest(_recent_days, 1)) GROUP BY code),
top_episodes AS (
  SELECT coalesce(jsonb_agg(item ORDER BY priority_score DESC), '[]'::jsonb) AS items
  FROM (
    SELECT jsonb_build_object(
        'episode_id', id, 'podcast_id', podcast_id,
        'podcast', coalesce(podcast_display_title, podcast_title),
        'title', coalesce(display_title, title),
        'rank_label', rank_label, 'published_at', published_at,
        'priority_score', priority_score, 'issue_codes', issue_codes
      ) AS item, priority_score
    FROM issue_rows
    ORDER BY priority_score DESC, published_at DESC NULLS LAST
    LIMIT greatest(_sample_limit, 1)
  ) ranked
)
SELECT jsonb_build_object(
  'generated_at', now(), 'mode', 'fast_snapshot',
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

-- person_relevance_judge_controls — fast mode final values
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'person_relevance_judge_controls',
  jsonb_build_object(
    'enabled', true,
    'daily_budget_usd', 25.0,
    'batch_limit', 160,
    'concurrency', 12,
    'max_ai_calls_per_run', 800,
    'min_confidence_for_ai', 0.50,
    'prefer_paid', true,
    'auto_disable_when_empty', true,
    'note', 'Fast mode 2026-05-30: do not throttle quality progress. Keep waste guards, but use high throughput and a circuit-breaker budget only.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

UPDATE public.app_settings
SET value = jsonb_set(
  value, '{per_job_caps_usd}',
  COALESCE(value->'per_job_caps_usd', '{}'::jsonb)
    || jsonb_build_object('person_relevance', 25, 'person_relevance_judge', 25),
  true
) || jsonb_build_object(
  'updated_at', now()::text,
  'updated_note', '2026-05-30: person relevance fast mode. Spend cap is now a runaway circuit breaker, not a throughput throttle.'
),
updated_at = now()
WHERE key = 'ai_budget';