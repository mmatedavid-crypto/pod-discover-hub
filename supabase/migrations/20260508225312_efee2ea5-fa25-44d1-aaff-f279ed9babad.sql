
CREATE OR REPLACE FUNCTION public.formula_c_candidates(_limit integer DEFAULT 50)
RETURNS TABLE(id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scored AS (
    SELECT p.id, p.created_at, p.podiverzum_rank, p.rank_label, p.shadow_rank, p.shadow_rank_tier,
      CASE
        WHEN p.podiverzum_rank >= 8.5 THEN 'S'
        WHEN p.podiverzum_rank >= 7.0 THEN 'A'
        WHEN p.podiverzum_rank >= 5.5 THEN 'B'
        WHEN p.podiverzum_rank >= 4.0 THEN 'C'
        WHEN p.podiverzum_rank >= 2.5 THEN 'D'
        ELSE 'E'
      END AS computed_tier
    FROM public.podcasts p
  )
  SELECT id FROM scored
  WHERE rank_label IS NULL
     OR shadow_rank IS NULL
     OR rank_label NOT IN ('S','A','B','C','D','E')
     OR rank_label <> computed_tier
     OR shadow_rank_tier IS DISTINCT FROM computed_tier
  ORDER BY
    (CASE
       WHEN rank_label IS NULL
         OR rank_label NOT IN ('S','A','B','C','D','E')
         OR shadow_rank IS NULL THEN 0
       ELSE 1
     END),
    created_at DESC,
    podiverzum_rank DESC
  LIMIT GREATEST(1, LEAST(_limit, 200));
$$;

CREATE OR REPLACE FUNCTION public.formula_c_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scored AS (
    SELECT p.id, p.podiverzum_rank, p.rank_label, p.shadow_rank, p.shadow_rank_tier,
      CASE
        WHEN p.podiverzum_rank >= 8.5 THEN 'S'
        WHEN p.podiverzum_rank >= 7.0 THEN 'A'
        WHEN p.podiverzum_rank >= 5.5 THEN 'B'
        WHEN p.podiverzum_rank >= 4.0 THEN 'C'
        WHEN p.podiverzum_rank >= 2.5 THEN 'D'
        ELSE 'E'
      END AS computed_tier
    FROM public.podcasts p
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'total_podcasts', (SELECT count(*) FROM public.podcasts),
    'null_rank_label', (SELECT count(*) FROM scored WHERE rank_label IS NULL),
    'legacy_label_count', (SELECT count(*) FROM scored WHERE rank_label IS NOT NULL AND rank_label NOT IN ('S','A','B','C','D','E')),
    'mismatch_count', (SELECT count(*) FROM scored WHERE rank_label IN ('S','A','B','C','D','E') AND rank_label <> computed_tier),
    'shadow_null_count', (SELECT count(*) FROM scored WHERE shadow_rank IS NULL),
    'shadow_tier_mismatch', (SELECT count(*) FROM scored WHERE shadow_rank_tier IS DISTINCT FROM computed_tier),
    'remaining_needing_change', (
      SELECT count(*) FROM scored
       WHERE rank_label IS NULL
          OR shadow_rank IS NULL
          OR rank_label NOT IN ('S','A','B','C','D','E')
          OR rank_label <> computed_tier
          OR shadow_rank_tier IS DISTINCT FROM computed_tier
    ),
    'rank_label_distribution', (
      SELECT COALESCE(jsonb_object_agg(label, c), '{}'::jsonb)
      FROM (SELECT COALESCE(rank_label,'(null)') AS label, count(*) c FROM public.podcasts GROUP BY rank_label) t
    ),
    'latest_rank_updated_at', (SELECT max(rank_updated_at) FROM public.podcasts),
    'latest_shadow_computed_at', (SELECT max(shadow_computed_at) FROM public.podcasts),
    'last_run', (SELECT value FROM public.app_settings WHERE key='formula_c_runner')
  );
$$;
