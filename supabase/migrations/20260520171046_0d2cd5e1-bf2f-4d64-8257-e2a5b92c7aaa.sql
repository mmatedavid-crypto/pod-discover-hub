-- 1) Add avg source podcast rank column
ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS avg_source_podcast_rank numeric NOT NULL DEFAULT 0;

-- 2) Relaxed gated-counts recomputation: only demote 0-episode people
CREATE OR REPLACE FUNCTION public.recompute_person_gated_counts()
 RETURNS TABLE(updated_count integer, single_ep_count integer, zero_ep_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated integer := 0;
  v_single integer := 0;
  v_zero integer := 0;
BEGIN
  WITH gated AS (
    SELECT
      pem.person_id,
      COUNT(DISTINCT e.id)::int AS ep_count,
      COUNT(DISTINCT e.podcast_id)::int AS pod_count
    FROM public.person_episode_mentions pem
    JOIN public.episodes e ON e.id = pem.episode_id
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
      AND COALESCE(pem.relevance_status, 'pending') NOT IN ('rejected','needs_review')
      AND (
        pem.relevance_status = 'accepted'
        OR COALESCE(pem.final_relevance_score, 0) >= 0.75
        OR pem.validation_source = 'manual'
        OR (
          COALESCE(pem.relevance_status, 'pending') = 'pending'
          AND pem.mention_type IN ('host','guest','subject')
          AND COALESCE(pem.confidence, 0) >= 0.80
        )
      )
    GROUP BY pem.person_id
  ),
  upd AS (
    UPDATE public.people pp
    SET
      gated_episode_count = COALESCE(g.ep_count, 0),
      gated_podcast_count = COALESCE(g.pod_count, 0),
      -- New rule: 0 episodes → hide; ≥1 keeps existing flags
      is_public = CASE
        WHEN COALESCE(g.ep_count, 0) = 0 THEN false
        ELSE pp.is_public
      END,
      is_indexable = CASE
        WHEN COALESCE(g.ep_count, 0) = 0 THEN false
        ELSE pp.is_indexable
      END,
      is_browsable_in_people_hub = CASE
        WHEN COALESCE(g.ep_count, 0) = 0 THEN false
        ELSE pp.is_browsable_in_people_hub
      END,
      updated_at = now()
    FROM (
      SELECT pp2.id, g2.ep_count, g2.pod_count
      FROM public.people pp2
      LEFT JOIN gated g2 ON g2.person_id = pp2.id
    ) g
    WHERE pp.id = g.id
      AND (
        pp.gated_episode_count IS DISTINCT FROM COALESCE(g.ep_count, 0)
        OR pp.gated_podcast_count IS DISTINCT FROM COALESCE(g.pod_count, 0)
        OR (COALESCE(g.ep_count, 0) = 0 AND (pp.is_public OR pp.is_indexable OR pp.is_browsable_in_people_hub))
      )
    RETURNING pp.id, COALESCE(g.ep_count, 0) AS ec
  )
  SELECT
    COUNT(*)::int,
    COUNT(*) FILTER (WHERE ec = 1)::int,
    COUNT(*) FILTER (WHERE ec = 0)::int
  INTO v_updated, v_single, v_zero
  FROM upd;

  RETURN QUERY SELECT v_updated, v_single, v_zero;
END;
$function$;

-- 3) Promote eligible people (≥1 gated ep, not flagged bad) — one-time wide promotion
--    Subsequent fine-tuning happens in refresh_people_hub_score.
UPDATE public.people p
SET
  is_public = true,
  is_indexable = true,
  activation_status = CASE
    WHEN activation_status = 'inactive' THEN 'indexable'
    ELSE activation_status
  END
WHERE gated_episode_count >= 1
  AND ai_review_status NOT IN ('needs_human_review','duplicate_candidate')
  AND identity_status NOT IN ('ambiguous','split_needed','needs_review')
  AND COALESCE(ai_duplicate_of_person_id, '00000000-0000-0000-0000-000000000000'::uuid) = '00000000-0000-0000-0000-000000000000'::uuid;

-- 4) Rewrite hub-score with new formula
CREATE OR REPLACE FUNCTION public.refresh_people_hub_score()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_browsable_before int;
  v_browsable_after int;
  v_indexable_after int;
BEGIN
  SELECT count(*) INTO v_browsable_before FROM public.people WHERE is_browsable_in_people_hub = true;

  -- Recompute recency + avg source podcast rank in one pass
  WITH agg AS (
    SELECT
      p.id AS person_id,
      COUNT(*) FILTER (
        WHERE m.relevance_status = 'accepted'
          AND e.published_at >= now() - interval '30 days'
      ) AS recent_30d,
      MAX(e.published_at) FILTER (WHERE m.relevance_status = 'accepted') AS latest_at,
      AVG(pc.podiverzum_rank) FILTER (
        WHERE pc.is_hungarian = true
          AND pc.language_decision = 'accept_hungarian'
          AND pc.podiverzum_rank IS NOT NULL
      ) AS avg_rank
    FROM public.people p
    LEFT JOIN public.person_episode_mentions m ON m.person_id = p.id
    LEFT JOIN public.episodes e ON e.id = m.episode_id
    LEFT JOIN public.podcasts pc ON pc.id = e.podcast_id
    GROUP BY p.id
  )
  UPDATE public.people p
  SET
    recent_relevant_episode_count_30d = COALESCE(a.recent_30d, 0),
    latest_accepted_relevant_episode_at = a.latest_at,
    avg_source_podcast_rank = COALESCE(a.avg_rank, 0),
    one_show_host = (COALESCE(p.distinct_podcast_count,0) <= 1)
  FROM agg a
  WHERE a.person_id = p.id;

  -- New score formula. Component weights:
  --   gated_episode_count        : 0.8 per ep, capped at 40 → max 32
  --   gated_podcast_count        : 4.0 per distinct podcast, capped at 30 → max 120
  --   host_count                 : 2.0 per host appearance, capped at 20 → max 40
  --   guest_count                : 1.5 per guest appearance, capped at 30 → max 45
  --   strong_mention_count       : 1.0 per strong mention, capped at 20 → max 20
  --   recent_30d                 : 3.0 per recent ep, capped at 10 → max 30
  --   recency days fresh bonus   : up to 10 if last accepted ep within 30d, linearly decays to 0 at 365d
  --   avg podcast quality (rank) : (avg_rank / 5) * 8, capped → max ~16 if avg rank ~10
  --   wikipedia verified         : +5
  --   editorial boost            : up to +20 (priority_level/100 * 20)
  -- Penalties:
  --   needs_human_review / duplicate_candidate: massive (-50) so they sink
  --   identity_status problems   : -10
  UPDATE public.people p
  SET people_hub_score =
    GREATEST(0,
        0.8  * LEAST(COALESCE(p.gated_episode_count,0), 40)
      + 4.0  * LEAST(COALESCE(p.gated_podcast_count,0), 30)
      + 2.0  * LEAST(COALESCE(p.host_count,0), 20)
      + 1.5  * LEAST(COALESCE(p.guest_count,0), 30)
      + 1.0  * LEAST(COALESCE(p.strong_mention_count,0), 20)
      + 3.0  * LEAST(COALESCE(p.recent_relevant_episode_count_30d,0), 10)
      + CASE
          WHEN p.latest_accepted_relevant_episode_at IS NULL THEN 0
          ELSE GREATEST(
            0,
            10.0 * (1.0 - LEAST(
              EXTRACT(EPOCH FROM (now() - p.latest_accepted_relevant_episode_at)) / (365.0 * 86400.0),
              1.0
            ))
          )
        END
      + LEAST(16.0, (COALESCE(p.avg_source_podcast_rank,0) / 5.0) * 8.0)
      + CASE WHEN p.wikipedia_match_status = 'verified' THEN 5.0 ELSE 0 END
      + CASE WHEN p.editorial_priority THEN (COALESCE(p.editorial_priority_level,0)::numeric / 100.0) * 20.0 ELSE 0 END
      - CASE WHEN p.ai_review_status IN ('needs_human_review','duplicate_candidate') THEN 50.0 ELSE 0 END
      - CASE WHEN p.identity_status IN ('ambiguous','split_needed','needs_review') THEN 10.0 ELSE 0 END
    );

  -- New browsable rule: any person with ≥1 gated episode, not flagged bad
  UPDATE public.people p
  SET is_browsable_in_people_hub = (
    COALESCE(p.gated_episode_count,0) >= 1
    AND p.is_public = true
    AND p.activation_status IN ('indexable','public_noindex','manual_approved')
    AND p.ai_review_status NOT IN ('needs_human_review','duplicate_candidate')
    AND p.identity_status NOT IN ('ambiguous','split_needed','needs_review')
    AND COALESCE(p.ai_duplicate_of_person_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = '00000000-0000-0000-0000-000000000000'::uuid
  );

  SELECT count(*) INTO v_browsable_after FROM public.people WHERE is_browsable_in_people_hub = true;
  SELECT count(*) INTO v_indexable_after FROM public.people WHERE is_indexable = true;

  RETURN jsonb_build_object(
    'browsable_before', v_browsable_before,
    'browsable_after', v_browsable_after,
    'indexable_after', v_indexable_after
  );
END;
$function$;

-- 5) Helpful index for paginated list ordering
CREATE INDEX IF NOT EXISTS people_hub_browse_idx
  ON public.people (is_browsable_in_people_hub, people_hub_score DESC, gated_episode_count DESC)
  WHERE is_browsable_in_people_hub = true;

CREATE INDEX IF NOT EXISTS people_normalized_name_trgm_idx
  ON public.people USING gin (normalized_name gin_trgm_ops);

-- 6) Server-side paginated list (sort by score, optional name search)
CREATE OR REPLACE FUNCTION public.list_people_hub(
  p_limit integer DEFAULT 60,
  p_offset integer DEFAULT 0,
  p_search text DEFAULT NULL
)
RETURNS TABLE(
  id uuid,
  slug text,
  name text,
  disambiguation_label text,
  short_bio text,
  ai_bio text,
  episode_count integer,
  podcast_count integer,
  distinct_podcast_count integer,
  gated_episode_count integer,
  gated_podcast_count integer,
  host_count integer,
  guest_count integer,
  strong_mention_count integer,
  recent_relevant_episode_count_30d integer,
  latest_accepted_relevant_episode_at timestamptz,
  people_hub_score numeric,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH base AS (
    SELECT *
    FROM public.people p
    WHERE p.is_browsable_in_people_hub = true
      AND (
        p_search IS NULL
        OR length(trim(p_search)) < 2
        OR p.normalized_name ILIKE '%' || lower(trim(p_search)) || '%'
        OR p.name ILIKE '%' || trim(p_search) || '%'
      )
  ),
  counted AS (
    SELECT COUNT(*)::bigint AS tc FROM base
  )
  SELECT
    b.id, b.slug, b.name, b.disambiguation_label, b.short_bio, b.ai_bio,
    b.episode_count, b.podcast_count, b.distinct_podcast_count,
    b.gated_episode_count, b.gated_podcast_count,
    b.host_count, b.guest_count, b.strong_mention_count,
    b.recent_relevant_episode_count_30d,
    b.latest_accepted_relevant_episode_at,
    b.people_hub_score,
    c.tc AS total_count
  FROM base b CROSS JOIN counted c
  ORDER BY b.people_hub_score DESC NULLS LAST, b.gated_episode_count DESC, b.name ASC
  LIMIT GREATEST(LEAST(p_limit, 200), 1)
  OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION public.list_people_hub(integer, integer, text) TO anon, authenticated;
