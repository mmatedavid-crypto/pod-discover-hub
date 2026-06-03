
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
  joined AS (
    SELECT pp2.id,
           COALESCE(g2.ep_count, 0)  AS ep_count,
           COALESCE(g2.pod_count, 0) AS pod_count,
           pp2.is_public, pp2.is_indexable, pp2.is_browsable_in_people_hub,
           pp2.activation_status, pp2.ai_recommended_action,
           pp2.ai_review_status, pp2.identity_status,
           pp2.gated_episode_count, pp2.gated_podcast_count,
           -- hard-block guard: never auto-activate if AI says hide/reject,
           -- person was split, or is a duplicate/needs human review.
           (COALESCE(pp2.ai_recommended_action,'') NOT IN ('hide','reject')
            AND COALESCE(pp2.ai_review_status,'') NOT IN ('needs_human_review','duplicate_candidate')
            AND COALESCE(pp2.identity_status,'') NOT IN ('split_resolved')
           ) AS not_hard_blocked
    FROM public.people pp2
    LEFT JOIN gated g2 ON g2.person_id = pp2.id
  ),
  upd AS (
    UPDATE public.people pp
    SET
      gated_episode_count = j.ep_count,
      gated_podcast_count = j.pod_count,
      -- 0 ep → hide; ≥1 ep & not hard-blocked → auto turn-on
      is_public = CASE
        WHEN j.ep_count = 0 THEN false
        WHEN j.ep_count >= 1 AND j.not_hard_blocked THEN true
        ELSE pp.is_public
      END,
      is_indexable = CASE
        WHEN j.ep_count = 0 THEN false
        WHEN j.ep_count >= 1 AND j.not_hard_blocked THEN true
        ELSE pp.is_indexable
      END,
      is_browsable_in_people_hub = CASE
        WHEN j.ep_count = 0 THEN false
        WHEN j.ep_count >= 1 AND j.not_hard_blocked THEN true
        ELSE pp.is_browsable_in_people_hub
      END,
      activation_status = CASE
        WHEN j.ep_count = 0 THEN 'inactive'
        WHEN j.ep_count >= 1 AND j.not_hard_blocked THEN 'active'
        ELSE pp.activation_status
      END,
      updated_at = now()
    FROM joined j
    WHERE pp.id = j.id
      AND (
        pp.gated_episode_count IS DISTINCT FROM j.ep_count
        OR pp.gated_podcast_count IS DISTINCT FROM j.pod_count
        OR (j.ep_count = 0 AND (pp.is_public OR pp.is_indexable OR pp.is_browsable_in_people_hub))
        OR (j.ep_count >= 1 AND j.not_hard_blocked AND (
              NOT pp.is_public
              OR NOT pp.is_indexable
              OR NOT pp.is_browsable_in_people_hub
              OR COALESCE(pp.activation_status,'') <> 'active'
           ))
      )
    RETURNING pp.id, j.ep_count AS ec
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

-- Run it now to backfill ~487 affected persons (Sulyok included).
SELECT * FROM public.recompute_person_gated_counts();
