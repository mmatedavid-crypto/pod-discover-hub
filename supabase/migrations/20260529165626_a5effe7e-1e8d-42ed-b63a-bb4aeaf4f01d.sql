
-- Phase A: Fix formula_c_candidates threshold drift + add kill-switch (default OFF).
-- Single source of truth: app_settings.formula_c_thresholds.

CREATE OR REPLACE FUNCTION public.formula_c_candidates(_limit integer DEFAULT 50)
 RETURNS TABLE(id uuid)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t jsonb;
  s_thr numeric;
  a_thr numeric;
  b_thr numeric;
  c_thr numeric;
  d_thr numeric;
BEGIN
  SELECT value INTO t FROM public.app_settings WHERE key = 'formula_c_thresholds';

  -- Defaults match prior hardcoded ladder; overridden by app_settings when present and monotonic.
  s_thr := 8.5; a_thr := 7.0; b_thr := 5.5; c_thr := 4.0; d_thr := 2.5;

  IF t IS NOT NULL
     AND (t ? 'S') AND (t ? 'A') AND (t ? 'B') AND (t ? 'C') AND (t ? 'D') THEN
    BEGIN
      IF (t->>'S')::numeric > (t->>'A')::numeric
         AND (t->>'A')::numeric > (t->>'B')::numeric
         AND (t->>'B')::numeric > (t->>'C')::numeric
         AND (t->>'C')::numeric > (t->>'D')::numeric THEN
        s_thr := (t->>'S')::numeric;
        a_thr := (t->>'A')::numeric;
        b_thr := (t->>'B')::numeric;
        c_thr := (t->>'C')::numeric;
        d_thr := (t->>'D')::numeric;
      END IF;
    EXCEPTION WHEN others THEN
      -- keep defaults on any parse error
      NULL;
    END;
  END IF;

  RETURN QUERY
  WITH scored AS (
    SELECT p.id, p.created_at, p.podiverzum_rank, p.rank_label, p.shadow_rank, p.shadow_rank_tier,
      CASE
        WHEN p.podiverzum_rank >= s_thr THEN 'S'
        WHEN p.podiverzum_rank >= a_thr THEN 'A'
        WHEN p.podiverzum_rank >= b_thr THEN 'B'
        WHEN p.podiverzum_rank >= c_thr THEN 'C'
        WHEN p.podiverzum_rank >= d_thr THEN 'D'
        ELSE 'E'
      END AS computed_tier
    FROM public.podcasts p
  )
  SELECT scored.id FROM scored
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
END;
$function$;

-- Kill-switch: default OFF. Runner must check this before any live rank write.
INSERT INTO public.app_settings (key, value)
VALUES ('formula_c_apply_to_live_rank', jsonb_build_object(
  'enabled', false,
  'note', 'Phase A kill-switch. When false, formula-c-runner may compute shadow values but MUST NOT write rank_label or podiverzum_rank. Default OFF.',
  'updated_at', now()
))
ON CONFLICT (key) DO NOTHING;
