CREATE OR REPLACE FUNCTION public.claim_person_judge_batch(_limit integer)
RETURNS SETOF uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
 RETURN QUERY
 WITH cte AS (
  SELECT pem.id FROM public.person_episode_mentions pem
  JOIN public.podcasts p ON p.id=pem.podcast_id
  JOIN public.people person ON person.id=pem.person_id
  JOIN public.episodes e ON e.id=pem.episode_id
  WHERE pem.relevance_status='pending' AND p.is_hungarian=true AND p.language_decision='accept_hungarian'
  ORDER BY person.is_public DESC NULLS LAST, e.published_at DESC NULLS LAST, pem.confidence DESC NULLS LAST, pem.id
  LIMIT LEAST(GREATEST(_limit,1),800)
  FOR UPDATE OF pem SKIP LOCKED
 )
 UPDATE public.person_episode_mentions pem SET relevance_status='in_progress',ai_judged_at=now()
 FROM cte WHERE pem.id=cte.id RETURNING pem.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_person_judge_batch(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_person_judge_batch(integer) TO service_role;