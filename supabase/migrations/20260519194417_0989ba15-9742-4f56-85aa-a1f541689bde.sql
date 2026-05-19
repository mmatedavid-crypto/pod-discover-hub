CREATE OR REPLACE FUNCTION public.claim_person_judge_batch(_limit int)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH cte AS (
    SELECT pem.id
    FROM person_episode_mentions pem
    JOIN podcasts p ON p.id = pem.podcast_id
    WHERE pem.relevance_status = 'pending'
      AND p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
    ORDER BY pem.confidence DESC NULLS LAST
    LIMIT _limit
    FOR UPDATE OF pem SKIP LOCKED
  )
  UPDATE person_episode_mentions pem
  SET relevance_status = 'in_progress',
      ai_judged_at = now()
  FROM cte
  WHERE pem.id = cte.id
  RETURNING pem.id;
END;
$$;