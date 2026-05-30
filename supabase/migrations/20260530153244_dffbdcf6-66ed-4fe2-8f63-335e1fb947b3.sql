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

CREATE TABLE IF NOT EXISTS public.import_rank_public_quality_guard_20260530 (
  podcast_id uuid PRIMARY KEY,
  old_rank_label text,
  old_podiverzum_rank numeric,
  old_rank_reason jsonb,
  old_shadow_rank numeric,
  old_shadow_rank_tier text,
  old_shadow_rank_components jsonb,
  guard_reason text NOT NULL,
  backup_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.import_rank_public_quality_guard_20260530 TO authenticated;
GRANT ALL ON public.import_rank_public_quality_guard_20260530 TO service_role;

ALTER TABLE public.import_rank_public_quality_guard_20260530 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "import rank guard admin read" ON public.import_rank_public_quality_guard_20260530;
CREATE POLICY "import rank guard admin read"
  ON public.import_rank_public_quality_guard_20260530
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

WITH risky AS (
  SELECT p.*
  FROM public.podcasts p
  WHERE p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
    AND coalesce(p.podiverzum_rank, 0) >= 7
    AND coalesce(p.rank_reason->>'formula', '') <> 'HU_v1'
    AND (
      p.source IN ('queue_drainer', 'queue_bulk_import', 'pi_dump_hu_full')
      OR p.rank_reason->>'from' = 'podiverzum_rank'
      OR p.rank_reason::text ILIKE '%candidate_rank%'
    )
)
INSERT INTO public.import_rank_public_quality_guard_20260530 (
  podcast_id, old_rank_label, old_podiverzum_rank, old_rank_reason,
  old_shadow_rank, old_shadow_rank_tier, old_shadow_rank_components, guard_reason
)
SELECT id, rank_label, podiverzum_rank, rank_reason, shadow_rank, shadow_rank_tier, shadow_rank_components,
  'import_priority_was_used_as_public_quality'
FROM risky
ON CONFLICT (podcast_id) DO NOTHING;

WITH guarded AS (
  SELECT p.id
  FROM public.podcasts p
  JOIN public.import_rank_public_quality_guard_20260530 b ON b.podcast_id = p.id
  WHERE b.guard_reason = 'import_priority_was_used_as_public_quality'
    AND coalesce(p.rank_reason->>'formula', '') <> 'HU_v1'
)
UPDATE public.podcasts p
SET
  podiverzum_rank = 4.50,
  rank_label = 'C',
  rank_reason = jsonb_build_object(
    'formula', 'import_public_rank_guard_v1',
    'source', 'migration_20260530183500',
    'public_rank', 4.50,
    'public_tier', 'C',
    'previous_rank', p.podiverzum_rank,
    'previous_tier', p.rank_label,
    'reason', 'Import priority/candidate_rank is not a public quality score. HU_v1 must promote this podcast.',
    'applied_at', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ),
  rank_updated_at = now(),
  shadow_rank = 4.50,
  shadow_rank_tier = 'C',
  shadow_rank_components = coalesce(p.shadow_rank_components, '{}'::jsonb)
    || jsonb_build_object(
      'import_rank_guard', jsonb_build_object(
        'applied_at', to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'previous_rank', p.podiverzum_rank,
        'previous_tier', p.rank_label,
        'reason', 'candidate_rank_is_import_priority_not_public_quality'
      )
    ),
  shadow_computed_at = now()
FROM guarded g
WHERE p.id = g.id;

UPDATE public.app_settings
SET value = value || jsonb_build_object(
  'import_public_rank_guard_v1', jsonb_build_object(
    'enabled', true,
    'max_initial_public_rank', 4.5,
    'max_initial_public_tier', 'C',
    'note', 'Discovery candidate_rank is import priority only. New/queue imported shows must be promoted by HU_v1/editorial quality, not import heuristics.'
  )
),
updated_at = now()
WHERE key = 'data_quality_controls';

REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_feed;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_evergreen;

CREATE TABLE IF NOT EXISTS public.legacy_public_rank_replacement_20260530 (
  podcast_id uuid PRIMARY KEY,
  title text,
  previous_podiverzum_rank numeric,
  previous_rank_label text,
  previous_rank_reason jsonb,
  previous_shadow_rank numeric,
  previous_shadow_rank_tier text,
  replaced_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.legacy_public_rank_replacement_20260530 TO authenticated;
GRANT ALL ON public.legacy_public_rank_replacement_20260530 TO service_role;
ALTER TABLE public.legacy_public_rank_replacement_20260530 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "legacy rank replacement admin read" ON public.legacy_public_rank_replacement_20260530;
CREATE POLICY "legacy rank replacement admin read"
  ON public.legacy_public_rank_replacement_20260530
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

WITH legacy AS (
  SELECT p.*
  FROM public.podcasts p
  WHERE COALESCE(p.rss_status, '') <> 'deleted'
    AND COALESCE(p.rank_reason->>'formula', '') <> 'HU_v1'
    AND COALESCE(p.rank_reason->>'source', '') NOT IN ('editorial', 'manual', 'admin')
    AND (
      COALESCE(p.podiverzum_rank, 0) > 4.5
      OR p.rank_label IN ('S', 'A', 'B')
      OR COALESCE(p.rank_reason->>'formula', '') IN ('C_v3', 'import_public_rank_v1')
      OR COALESCE(p.rank_reason->>'source', '') IN (
        'formula-c-runner-v1','queue_drainer','queue_bulk_import','queue-import-runner',
        'queue_import_runner','discovery_auto','discovery_seed','pi_dump','pi_dump_hu_full'
      )
      OR p.rank_reason::text ILIKE '%candidate_rank%'
      OR p.rank_reason::text ILIKE '%discovery_seed%'
    )
)
INSERT INTO public.legacy_public_rank_replacement_20260530 (
  podcast_id, title, previous_podiverzum_rank, previous_rank_label,
  previous_rank_reason, previous_shadow_rank, previous_shadow_rank_tier
)
SELECT id, title, podiverzum_rank, rank_label, rank_reason, shadow_rank, shadow_rank_tier
FROM legacy
ON CONFLICT (podcast_id) DO UPDATE SET
  title = EXCLUDED.title,
  previous_podiverzum_rank = EXCLUDED.previous_podiverzum_rank,
  previous_rank_label = EXCLUDED.previous_rank_label,
  previous_rank_reason = EXCLUDED.previous_rank_reason,
  previous_shadow_rank = EXCLUDED.previous_shadow_rank,
  previous_shadow_rank_tier = EXCLUDED.previous_shadow_rank_tier,
  replaced_at = now();

WITH legacy AS (
  SELECT p.*
  FROM public.podcasts p
  WHERE COALESCE(p.rss_status, '') <> 'deleted'
    AND COALESCE(p.rank_reason->>'formula', '') <> 'HU_v1'
    AND COALESCE(p.rank_reason->>'source', '') NOT IN ('editorial', 'manual', 'admin')
    AND (
      COALESCE(p.podiverzum_rank, 0) > 4.5
      OR p.rank_label IN ('S', 'A', 'B')
      OR COALESCE(p.rank_reason->>'formula', '') IN ('C_v3', 'import_public_rank_v1')
      OR COALESCE(p.rank_reason->>'source', '') IN (
        'formula-c-runner-v1','queue_drainer','queue_bulk_import','queue-import-runner',
        'queue_import_runner','discovery_auto','discovery_seed','pi_dump','pi_dump_hu_full'
      )
      OR p.rank_reason::text ILIKE '%candidate_rank%'
      OR p.rank_reason::text ILIKE '%discovery_seed%'
    )
), capped AS (
  SELECT id,
    LEAST(4.5, GREATEST(1, COALESCE(podiverzum_rank, 1))) AS public_rank,
    podiverzum_rank AS old_rank, rank_label AS old_label, rank_reason AS old_reason
  FROM legacy
)
UPDATE public.podcasts p
SET
  podiverzum_rank = c.public_rank,
  rank_label = CASE WHEN c.public_rank >= 4 THEN 'C' WHEN c.public_rank >= 2.5 THEN 'D' ELSE 'E' END,
  rank_reason = jsonb_build_object(
    'formula', 'legacy_public_rank_removed_v1',
    'source', 'migration_20260530185500',
    'previous_podiverzum_rank', c.old_rank,
    'previous_rank_label', c.old_label,
    'previous_rank_reason', c.old_reason,
    'note', 'Legacy discovery/import score removed as public quality source. HU_v1/editorial quality must promote this podcast.'
  ),
  rank_updated_at = now(),
  shadow_rank = c.public_rank,
  shadow_rank_tier = CASE WHEN c.public_rank >= 4 THEN 'C' WHEN c.public_rank >= 2.5 THEN 'D' ELSE 'E' END,
  shadow_rank_components = COALESCE(p.shadow_rank_components, '{}'::jsonb)
    || jsonb_build_object('legacy_public_rank_removed', true, 'removed_at', now(),
      'previous_podiverzum_rank', c.old_rank, 'previous_rank_label', c.old_label),
  shadow_computed_at = now()
FROM capped c
WHERE p.id = c.id;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('formula_c_apply_to_live_rank',
  jsonb_build_object('enabled', false, 'disabled_by', 'migration_20260530185500',
    'reason', 'Formula C may use podiverzum_rank as input, but legacy/import rank is no longer a public quality source.'),
  now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('public_rank_policy',
  jsonb_build_object('version', 2,
    'public_quality_sources', jsonb_build_array('HU_v1', 'editorial', 'manual', 'admin'),
    'import_scores_are_public_quality', false,
    'max_initial_import_public_rank', 4.5,
    'note', 'candidate_rank/discovery score is import priority only and must not create S/A/B public placement.'),
  now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_feed;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_evergreen;

WITH legacy_import AS (
  SELECT p.id, p.podiverzum_rank AS old_rank, p.rank_label AS old_label, p.rank_reason AS old_reason
  FROM public.podcasts p
  WHERE COALESCE(p.rank_reason->>'formula', '') <> 'HU_v1'
    AND COALESCE(p.rank_reason->>'source', '') NOT IN ('editorial', 'manual', 'admin')
    AND (
      COALESCE(p.rank_reason->>'formula', '') IN ('import_public_rank_v1', 'legacy_public_rank_removed_v1', 'import_public_rank_guard_v1')
      OR p.rank_reason::text ILIKE '%candidate_rank%'
      OR p.rank_reason::text ILIKE '%discovery_seed%'
    )
)
UPDATE public.podcasts p
SET
  podiverzum_rank = LEAST(3.5, GREATEST(1, COALESCE(p.podiverzum_rank, 1))),
  rank_label = CASE WHEN LEAST(3.5, GREATEST(1, COALESCE(p.podiverzum_rank, 1))) >= 2.5 THEN 'D' ELSE 'E' END,
  rank_reason = jsonb_build_object(
    'formula', 'legacy_import_rank_indexed_v1',
    'source', 'migration_20260530191500',
    'previous_podiverzum_rank', l.old_rank,
    'previous_rank_label', l.old_label,
    'previous_rank_reason', l.old_reason,
    'note', 'Import/discovery score is not a public quality score. D means indexed/evaluable only; HU_v1/editorial quality must promote.'
  ),
  rank_updated_at = now(),
  shadow_rank = LEAST(3.5, GREATEST(1, COALESCE(p.podiverzum_rank, 1))),
  shadow_rank_tier = CASE WHEN LEAST(3.5, GREATEST(1, COALESCE(p.podiverzum_rank, 1))) >= 2.5 THEN 'D' ELSE 'E' END,
  shadow_rank_components = COALESCE(p.shadow_rank_components, '{}'::jsonb)
    || jsonb_build_object('legacy_import_rank_indexed_only', true, 'indexed_only_at', now(),
      'previous_podiverzum_rank', l.old_rank, 'previous_rank_label', l.old_label),
  shadow_computed_at = now()
FROM legacy_import l
WHERE p.id = l.id;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('public_rank_policy',
  jsonb_build_object('version', 3,
    'public_quality_sources', jsonb_build_array('HU_v1', 'editorial', 'manual', 'admin'),
    'import_scores_are_public_quality', false,
    'max_initial_import_public_rank', 3.5,
    'initial_import_tier', 'D',
    'processing_eligibility_note', 'Processing pipelines include all Hungarian non-spam tiers; rank orders work but does not admit/exclude.',
    'note', 'candidate_rank/discovery score is import priority only and must not create S/A/B/C public quality placement.'),
  now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('rank_dependency_audit_20260530',
  jsonb_build_object(
    'old_rank_was_requirement_for', jsonb_build_array(
      'homepage/feed eligibility and ordering','deep hydration backlog','SEO enrichment enqueue scope',
      'clean text and intelligence reprocessing scope','sitemap/prerender inclusion',
      'search/autocomplete ordering','admin health/coverage counts'),
    'replacement_policy', jsonb_build_object(
      'public_visibility', 'HU_v1/editorial/manual/admin rank only',
      'indexing_processing', 'Hungarian active healthy podcasts may be processed at D tier',
      'import_candidate_rank', 'import priority only, never public quality')),
  now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

UPDATE public.app_settings
SET value = COALESCE(value, '{}'::jsonb)
  || jsonb_build_object('tiers', jsonb_build_array('S', 'A', 'B', 'C', 'D', 'E')),
  updated_at = now()
WHERE key IN ('ai_seo_controls', 'clean_text_autopilot');

REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_feed;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_evergreen;

DROP MATERIALIZED VIEW IF EXISTS public.mv_homepage_evergreen;
DROP MATERIALIZED VIEW IF EXISTS public.mv_homepage_feed;

CREATE MATERIALIZED VIEW public.mv_homepage_feed AS
WITH eligible AS (
  SELECT p.id, p.slug, p.title, p.display_title, p.image_url, p.category,
    p.podiverzum_rank, p.rank_label, p.rss_status, p.featured, p.featured_rank
  FROM public.podcasts p
  WHERE (p.featured OR (COALESCE(p.is_hungarian, false) = true AND p.language_decision = 'accept_hungarian'))
    AND COALESCE(p.rss_status, '') NOT IN ('failed','inactive','deleted')
    AND COALESCE(p.ai_spam_score, 0) < 0.80
    AND COALESCE(p.shadow_rank_components->>'health_state','healthy') IN ('healthy','recovered_rss_url')
),
ranked AS (
  SELECT
    e.id AS episode_id, e.title, e.display_title, e.slug, e.summary, e.description,
    e.published_at, e.audio_url, e.topics,
    el.id AS podcast_id, el.slug AS podcast_slug,
    el.title AS podcast_title, el.display_title AS podcast_display_title,
    el.image_url AS podcast_image_url, el.category AS podcast_category,
    el.podiverzum_rank, el.rank_label, el.rss_status, el.featured, el.featured_rank,
    CASE
      WHEN e.published_at >= now() - interval '72 hours' THEN 'hot'
      WHEN e.published_at >= now() - interval '14 days'  THEN 'fresh'
      ELSE 'recent'
    END AS freshness_bucket,
    ROW_NUMBER() OVER (PARTITION BY el.id ORDER BY e.published_at DESC NULLS LAST) AS pod_rank
  FROM eligible el
  CROSS JOIN LATERAL (
    SELECT *
    FROM public.episodes ep
    WHERE ep.podcast_id = el.id
      AND ep.published_at IS NOT NULL
      AND ep.published_at >= now() - interval '30 days'
      AND ep.title IS NOT NULL
    ORDER BY ep.published_at DESC
    LIMIT 8
  ) e
)
SELECT * FROM ranked;

CREATE UNIQUE INDEX mv_homepage_feed_episode_pkey ON public.mv_homepage_feed (episode_id);
CREATE INDEX mv_homepage_feed_category_pub_idx ON public.mv_homepage_feed (podcast_category, published_at DESC NULLS LAST);
CREATE INDEX mv_homepage_feed_pub_idx ON public.mv_homepage_feed (published_at DESC NULLS LAST);
CREATE INDEX mv_homepage_feed_pod_idx ON public.mv_homepage_feed (podcast_id, pod_rank);
CREATE INDEX mv_homepage_feed_bucket_idx ON public.mv_homepage_feed (freshness_bucket, published_at DESC NULLS LAST);

GRANT SELECT ON public.mv_homepage_feed TO anon, authenticated;

CREATE MATERIALIZED VIEW public.mv_homepage_evergreen AS
WITH eligible AS (
  SELECT p.id, p.slug, p.title, p.display_title, p.image_url, p.category,
         p.podiverzum_rank, p.rank_label, p.rss_status, p.featured
  FROM public.podcasts p
  WHERE (p.featured OR (COALESCE(p.is_hungarian, false) = true AND p.language_decision = 'accept_hungarian'))
    AND COALESCE(p.rss_status, '') NOT IN ('failed','inactive','deleted')
    AND COALESCE(p.ai_spam_score, 0) < 0.80
    AND COALESCE(p.shadow_rank_components->>'health_state','healthy') IN ('healthy','recovered_rss_url')
),
ranked AS (
  SELECT
    e.id AS episode_id, e.title, e.display_title, e.slug,
    e.summary, e.description, e.ai_summary,
    e.published_at, e.audio_url, e.topics,
    el.id AS podcast_id, el.slug AS podcast_slug,
    el.title AS podcast_title, el.display_title AS podcast_display_title,
    el.image_url AS podcast_image_url, el.category AS podcast_category,
    el.podiverzum_rank, el.rank_label, el.rss_status, el.featured,
    ROW_NUMBER() OVER (
      PARTITION BY el.id
      ORDER BY
        CASE el.rank_label WHEN 'S' THEN 6 WHEN 'A' THEN 5 WHEN 'B' THEN 4 WHEN 'C' THEN 3 WHEN 'D' THEN 2 ELSE 1 END DESC,
        el.podiverzum_rank DESC NULLS LAST,
        e.published_at DESC
    ) AS pod_rank
  FROM eligible el
  JOIN public.episodes e ON e.podcast_id = el.id
  WHERE e.ai_summary IS NOT NULL
    AND length(e.ai_summary) > 80
    AND e.published_at IS NOT NULL
    AND e.published_at <  now() - interval '30 days'
    AND e.published_at >= now() - interval '365 days'
    AND e.title IS NOT NULL
)
SELECT * FROM ranked WHERE pod_rank = 1;

CREATE UNIQUE INDEX mv_homepage_evergreen_pkey ON public.mv_homepage_evergreen (episode_id);
CREATE INDEX mv_homepage_evergreen_pod_idx ON public.mv_homepage_evergreen (podcast_id);
CREATE INDEX mv_homepage_evergreen_cat_idx ON public.mv_homepage_evergreen (podcast_category);

GRANT SELECT ON public.mv_homepage_evergreen TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_homepage_feed()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_feed;
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_evergreen;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_homepage_feed() TO anon, authenticated;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('public_admission_policy',
  jsonb_build_object('version', 1,
    'admission_rule', 'Hungarian non-spam podcasts are admitted; rank only orders and weights them.',
    'hard_exclusions', jsonb_build_array('foreign', 'spam', 'failed/inactive/deleted feed', 'frozen bad health state'),
    'rank_role', 'ordering_and_weight_only'),
  now())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();