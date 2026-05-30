-- Decouple processing eligibility from the deprecated import/discovery rank.
-- Public quality remains HU_v1/editorial/manual/admin. Imported rows start at D
-- so candidate_rank cannot grant C/S/A/B visibility or pipeline priority.

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
  rank_label = CASE
    WHEN LEAST(3.5, GREATEST(1, COALESCE(p.podiverzum_rank, 1))) >= 2.5 THEN 'D'
    ELSE 'E'
  END,
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
  shadow_rank_tier = CASE
    WHEN LEAST(3.5, GREATEST(1, COALESCE(p.podiverzum_rank, 1))) >= 2.5 THEN 'D'
    ELSE 'E'
  END,
  shadow_rank_components = COALESCE(p.shadow_rank_components, '{}'::jsonb)
    || jsonb_build_object(
      'legacy_import_rank_indexed_only', true,
      'indexed_only_at', now(),
      'previous_podiverzum_rank', l.old_rank,
      'previous_rank_label', l.old_label
    ),
  shadow_computed_at = now()
FROM legacy_import l
WHERE p.id = l.id;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'public_rank_policy',
  jsonb_build_object(
    'version', 3,
    'public_quality_sources', jsonb_build_array('HU_v1', 'editorial', 'manual', 'admin'),
    'import_scores_are_public_quality', false,
    'max_initial_import_public_rank', 3.5,
    'initial_import_tier', 'D',
      'processing_eligibility_note', 'Processing pipelines include all Hungarian non-spam tiers; rank orders work but does not admit/exclude.',
      'note', 'candidate_rank/discovery score is import priority only and must not create S/A/B/C public quality placement.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'rank_dependency_audit_20260530',
  jsonb_build_object(
    'old_rank_was_requirement_for', jsonb_build_array(
      'homepage/feed eligibility and ordering',
      'deep hydration backlog',
      'SEO enrichment enqueue scope',
      'clean text and intelligence reprocessing scope',
      'sitemap/prerender inclusion',
      'search/autocomplete ordering',
      'admin health/coverage counts'
    ),
    'replacement_policy', jsonb_build_object(
      'public_visibility', 'HU_v1/editorial/manual/admin rank only',
      'indexing_processing', 'Hungarian active healthy podcasts may be processed at D tier',
      'import_candidate_rank', 'import priority only, never public quality'
    )
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = EXCLUDED.value,
  updated_at = now();

UPDATE public.app_settings
SET value = COALESCE(value, '{}'::jsonb)
  || jsonb_build_object('tiers', jsonb_build_array('S', 'A', 'B', 'C', 'D', 'E')),
  updated_at = now()
WHERE key IN ('ai_seo_controls', 'clean_text_autopilot');

REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_feed;
REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_homepage_evergreen;
