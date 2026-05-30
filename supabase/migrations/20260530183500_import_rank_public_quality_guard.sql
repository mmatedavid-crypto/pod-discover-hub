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
  podcast_id,
  old_rank_label,
  old_podiverzum_rank,
  old_rank_reason,
  old_shadow_rank,
  old_shadow_rank_tier,
  old_shadow_rank_components,
  guard_reason
)
SELECT
  id,
  rank_label,
  podiverzum_rank,
  rank_reason,
  shadow_rank,
  shadow_rank_tier,
  shadow_rank_components,
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
