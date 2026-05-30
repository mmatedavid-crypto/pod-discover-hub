-- Remove legacy discovery/import scores as public quality rank sources.
-- Keep podiverzum_rank/rank_label fields for compatibility, but rebase non-HU_v1
-- imported ranks to conservative C/D/E until the quality pipeline promotes them.

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
        'formula-c-runner-v1',
        'queue_drainer',
        'queue_bulk_import',
        'queue-import-runner',
        'queue_import_runner',
        'discovery_auto',
        'discovery_seed',
        'pi_dump',
        'pi_dump_hu_full'
      )
      OR p.rank_reason::text ILIKE '%candidate_rank%'
      OR p.rank_reason::text ILIKE '%discovery_seed%'
    )
)
INSERT INTO public.legacy_public_rank_replacement_20260530 (
  podcast_id,
  title,
  previous_podiverzum_rank,
  previous_rank_label,
  previous_rank_reason,
  previous_shadow_rank,
  previous_shadow_rank_tier
)
SELECT
  id,
  title,
  podiverzum_rank,
  rank_label,
  rank_reason,
  shadow_rank,
  shadow_rank_tier
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
        'formula-c-runner-v1',
        'queue_drainer',
        'queue_bulk_import',
        'queue-import-runner',
        'queue_import_runner',
        'discovery_auto',
        'discovery_seed',
        'pi_dump',
        'pi_dump_hu_full'
      )
      OR p.rank_reason::text ILIKE '%candidate_rank%'
      OR p.rank_reason::text ILIKE '%discovery_seed%'
    )
), capped AS (
  SELECT
    id,
    LEAST(4.5, GREATEST(1, COALESCE(podiverzum_rank, 1))) AS public_rank,
    podiverzum_rank AS old_rank,
    rank_label AS old_label,
    rank_reason AS old_reason
  FROM legacy
)
UPDATE public.podcasts p
SET
  podiverzum_rank = c.public_rank,
  rank_label = CASE
    WHEN c.public_rank >= 4 THEN 'C'
    WHEN c.public_rank >= 2.5 THEN 'D'
    ELSE 'E'
  END,
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
  shadow_rank_tier = CASE
    WHEN c.public_rank >= 4 THEN 'C'
    WHEN c.public_rank >= 2.5 THEN 'D'
    ELSE 'E'
  END,
  shadow_rank_components = COALESCE(p.shadow_rank_components, '{}'::jsonb)
    || jsonb_build_object(
      'legacy_public_rank_removed', true,
      'removed_at', now(),
      'previous_podiverzum_rank', c.old_rank,
      'previous_rank_label', c.old_label
    ),
  shadow_computed_at = now()
FROM capped c
WHERE p.id = c.id;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'formula_c_apply_to_live_rank',
  jsonb_build_object(
    'enabled', false,
    'disabled_by', 'migration_20260530185500',
    'reason', 'Formula C may use podiverzum_rank as input, but legacy/import rank is no longer a public quality source.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'public_rank_policy',
  jsonb_build_object(
    'version', 2,
    'public_quality_sources', jsonb_build_array('HU_v1', 'editorial', 'manual', 'admin'),
    'import_scores_are_public_quality', false,
    'max_initial_import_public_rank', 4.5,
    'note', 'candidate_rank/discovery score is import priority only and must not create S/A/B public placement.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = now();

REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_feed;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_evergreen;
