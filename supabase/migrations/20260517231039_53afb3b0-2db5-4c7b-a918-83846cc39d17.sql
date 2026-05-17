
ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS gated_episode_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS gated_podcast_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.recompute_person_gated_counts()
RETURNS TABLE(updated_count integer, single_ep_count integer, zero_ep_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      is_public = CASE
        WHEN COALESCE(g.ep_count, 0) = 0 THEN false
        ELSE pp.is_public
      END,
      is_indexable = CASE
        WHEN COALESCE(g.ep_count, 0) < 2 THEN false
        ELSE pp.is_indexable
      END,
      is_browsable_in_people_hub = CASE
        WHEN COALESCE(g.ep_count, 0) < 2 THEN false
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
        OR (COALESCE(g.ep_count, 0) < 2 AND (pp.is_indexable = true OR pp.is_browsable_in_people_hub = true))
        OR (COALESCE(g.ep_count, 0) = 0 AND pp.is_public = true)
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
$$;

SELECT * FROM public.recompute_person_gated_counts();

CREATE INDEX IF NOT EXISTS idx_people_gated_episode_count ON public.people(gated_episode_count);
