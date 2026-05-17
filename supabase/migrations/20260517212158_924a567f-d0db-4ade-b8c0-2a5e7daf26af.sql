-- Tighten one-show exclusion + refresh
CREATE OR REPLACE FUNCTION public.refresh_people_hub_score()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_browsable_before int;
  v_browsable_after int;
  v_one_show_hidden int;
BEGIN
  SELECT count(*) INTO v_browsable_before FROM public.people WHERE is_browsable_in_people_hub = true;

  WITH agg AS (
    SELECT
      p.id AS person_id,
      COUNT(*) FILTER (
        WHERE m.relevance_status = 'accepted'
          AND e.published_at >= now() - interval '30 days'
      ) AS recent_30d,
      MAX(e.published_at) FILTER (WHERE m.relevance_status = 'accepted') AS latest_at
    FROM public.people p
    LEFT JOIN public.person_episode_mentions m ON m.person_id = p.id
    LEFT JOIN public.episodes e ON e.id = m.episode_id
    LEFT JOIN public.podcasts pc ON pc.id = e.podcast_id
      AND pc.is_hungarian = true AND pc.language_decision = 'accept_hungarian'
    GROUP BY p.id
  )
  UPDATE public.people p
  SET
    recent_relevant_episode_count_30d = COALESCE(a.recent_30d, 0),
    latest_accepted_relevant_episode_at = a.latest_at,
    -- STRICT: anyone tied to a single show is treated as one-show
    one_show_host = (COALESCE(p.distinct_podcast_count,0) <= 1)
  FROM agg a
  WHERE a.person_id = p.id;

  UPDATE public.people p
  SET people_hub_score =
    GREATEST(0,
      3.0 * COALESCE(p.recent_relevant_episode_count_30d,0)
    + 2.5 * COALESCE(p.distinct_podcast_count,0)
    + 1.5 * COALESCE(p.strong_mention_count,0)
    + 1.0 * CASE WHEN p.wikipedia_match_status = 'verified' THEN 1 ELSE 0 END
    + 0.5 * CASE WHEN p.editorial_priority THEN COALESCE(p.editorial_priority_level,0)/100.0 ELSE 0 END
    + 0.1 * COALESCE(p.episode_count,0)
    - 5.0 * CASE WHEN p.one_show_host THEN 1 ELSE 0 END
    - 4.0 * CASE WHEN p.identity_status IN ('ambiguous','split_needed','needs_review') THEN 1 ELSE 0 END
    - 3.0 * CASE WHEN p.ai_review_status = 'duplicate_candidate' THEN 1 ELSE 0 END
    );

  UPDATE public.people p
  SET is_browsable_in_people_hub = (
    p.is_public = true
    AND p.activation_status IN ('indexable','public_noindex','manual_approved')
    AND p.ai_review_status NOT IN ('needs_human_review','duplicate_candidate')
    AND p.identity_status NOT IN ('ambiguous','split_needed','needs_review')
    AND (
      -- STRICT: must be multi-show, OR manually approved as browsable
      COALESCE(p.distinct_podcast_count,0) >= 2
      OR p.manual_approval_status = 'approved_browsable'
    )
    AND (
      p.recent_relevant_episode_count_30d > 0
      OR COALESCE(p.strong_mention_count,0) >= 2
      OR p.manual_approval_status = 'approved_browsable'
    )
  );

  SELECT count(*) INTO v_browsable_after FROM public.people WHERE is_browsable_in_people_hub = true;
  SELECT count(*) INTO v_one_show_hidden FROM public.people WHERE one_show_host = true AND is_browsable_in_people_hub = false;

  RETURN jsonb_build_object(
    'browsable_before', v_browsable_before,
    'browsable_after', v_browsable_after,
    'one_show_hidden', v_one_show_hidden
  );
END;
$function$;

-- Run it immediately
SELECT public.refresh_people_hub_score();

-- Safe Hungarian fallback bio for public / indexable / hub-visible people lacking a bio
UPDATE public.people
SET
  ai_bio = name || ' magyar podcast epizódokban előforduló személy. Az alábbi epizódokban kapcsolódó beszélgetések, interjúk vagy említések találhatók.',
  ai_bio_status = COALESCE(NULLIF(ai_bio_status,''),'fallback'),
  ai_bio_generated_at = COALESCE(ai_bio_generated_at, now())
WHERE (ai_bio IS NULL OR length(trim(ai_bio)) < 20)
  AND (is_public = true OR is_indexable = true OR is_browsable_in_people_hub = true);