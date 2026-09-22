CREATE OR REPLACE FUNCTION public.podcast_episode_counts(_ids uuid[])
RETURNS TABLE(podcast_id uuid, episode_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT e.podcast_id, count(*)::bigint
  FROM public.episodes e
  WHERE e.podcast_id = ANY(_ids)
  GROUP BY e.podcast_id
$function$;

GRANT EXECUTE ON FUNCTION public.podcast_episode_counts(uuid[]) TO anon, authenticated, service_role;
