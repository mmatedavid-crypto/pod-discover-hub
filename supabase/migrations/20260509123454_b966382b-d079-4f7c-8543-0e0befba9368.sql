
CREATE OR REPLACE FUNCTION public.embed_episode_candidate_stats(_model text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_eligible bigint := 0;
  v_embedded bigint := 0;
BEGIN
  SELECT count(*) INTO v_eligible
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
   WHERE p.rank_label IN ('S','A','B','C')
     AND COALESCE(p.shadow_rank_components->>'health_state','') NOT IN
         ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam');

  SELECT count(*) INTO v_embedded
    FROM public.episode_embeddings ee
    JOIN public.episodes e ON e.id = ee.episode_id
    JOIN public.podcasts p ON p.id = e.podcast_id
   WHERE ee.model = _model
     AND p.rank_label IN ('S','A','B','C');

  RETURN jsonb_build_object(
    'eligible_total', v_eligible,
    'already_embedded', v_embedded,
    'missing_embedding', GREATEST(v_eligible - v_embedded, 0)
  );
END;
$function$;
