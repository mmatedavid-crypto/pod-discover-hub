CREATE OR REPLACE FUNCTION public.get_personalized_mood_cards(
  p_viewport text DEFAULT 'desktop',
  p_hour integer DEFAULT NULL,
  p_dow integer DEFAULT NULL
)
RETURNS TABLE(
  slug text,
  title text,
  description text,
  short_description text,
  href text,
  reason_label text,
  sort_order integer,
  energy_level text,
  representative_episode_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_bucket text;
  v_is_weekend boolean;
  v_min_count integer := 8;
BEGIN
  v_limit := CASE lower(COALESCE(p_viewport, 'desktop'))
    WHEN 'mobile' THEN 4
    WHEN 'tablet' THEN 5
    ELSE 6
  END;

  v_bucket := CASE
    WHEN p_hour IS NULL THEN 'afternoon'
    WHEN p_hour BETWEEN 5 AND 10 THEN 'morning'
    WHEN p_hour BETWEEN 11 AND 16 THEN 'afternoon'
    WHEN p_hour BETWEEN 17 AND 22 THEN 'evening'
    ELSE 'night'
  END;

  v_is_weekend := COALESCE(p_dow IN (0, 6), false);

  RETURN QUERY
  WITH base AS (
    SELECT
      m.slug,
      m.title,
      m.description,
      m.short_description,
      m.sort_order,
      m.energy_level,
      m.default_reason_label,
      COALESCE(m.recommended_episode_count, 0) AS recommended_episode_count,
      COALESCE((m.time_affinity ->> v_bucket)::numeric, 0.3) AS aff
    FROM public.mood_collections m
    WHERE m.active = true
  ),
  scored AS (
    SELECT
      b.*,
      b.aff
        + CASE
            WHEN v_is_weekend AND b.slug IN ('hosszu-utra', 'filmekhez', 'kulturahoz', 'mosolyogashoz', 'nyugodt-beszelgetesek') THEN 0.16
            WHEN v_is_weekend AND b.slug IN ('uzleti-inspiracio', 'penzugyi-gondolkodas') THEN -0.08
            ELSE 0
          END
        + CASE
            WHEN b.recommended_episode_count >= 25 THEN 0.05
            WHEN b.recommended_episode_count BETWEEN v_min_count AND 24 THEN 0.02
            ELSE -0.35
          END AS score
    FROM base b
  ),
  eligible AS (
    SELECT * FROM scored WHERE recommended_episode_count >= v_min_count
  ),
  chosen AS (
    SELECT * FROM eligible
    UNION ALL
    SELECT s.* FROM scored s
    WHERE (SELECT count(*) FROM eligible) < v_limit
      AND s.recommended_episode_count > 0
      AND NOT EXISTS (SELECT 1 FROM eligible e WHERE e.slug = s.slug)
  )
  SELECT
    c.slug,
    c.title,
    c.description,
    c.short_description,
    '/hangulatok/' || c.slug AS href,
    CASE
      WHEN c.score >= 0.7 THEN
        CASE v_bucket
          WHEN 'morning' THEN 'Reggelre ajánlva'
          WHEN 'afternoon' THEN 'Most ajánlott'
          WHEN 'evening' THEN 'Estére ajánlva'
          ELSE 'Esti pihenéshez'
        END
      WHEN v_is_weekend AND c.slug IN ('hosszu-utra', 'filmekhez', 'kulturahoz', 'mosolyogashoz') THEN 'Hétvégére ajánlva'
      ELSE COALESCE(c.default_reason_label, 'Válogatott ajánló')
    END AS reason_label,
    c.sort_order,
    c.energy_level,
    c.recommended_episode_count
  FROM chosen c
  ORDER BY c.score DESC, c.sort_order ASC
  LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_personalized_mood_cards(text, integer, integer) TO anon, authenticated;
