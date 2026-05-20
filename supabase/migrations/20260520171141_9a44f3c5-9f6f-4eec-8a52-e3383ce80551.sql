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
    )
  WHERE p.id IS NOT NULL;

  UPDATE public.people p
  SET is_browsable_in_people_hub = (
    COALESCE(p.gated_episode_count,0) >= 1
    AND p.is_public = true
    AND p.activation_status IN ('indexable','public_noindex','manual_approved')
    AND p.ai_review_status NOT IN ('needs_human_review','duplicate_candidate')
    AND p.identity_status NOT IN ('ambiguous','split_needed','needs_review')
    AND COALESCE(p.ai_duplicate_of_person_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = '00000000-0000-0000-0000-000000000000'::uuid
  )
  WHERE p.id IS NOT NULL;

  SELECT count(*) INTO v_browsable_after FROM public.people WHERE is_browsable_in_people_hub = true;
  SELECT count(*) INTO v_indexable_after FROM public.people WHERE is_indexable = true;

  RETURN jsonb_build_object(
    'browsable_before', v_browsable_before,
    'browsable_after', v_browsable_after,
    'indexable_after', v_indexable_after
  );
END;
$function$;
