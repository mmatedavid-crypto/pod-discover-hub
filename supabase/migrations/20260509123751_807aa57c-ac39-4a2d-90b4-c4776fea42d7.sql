
CREATE OR REPLACE FUNCTION public.embed_episode_candidate_stats(_model text)
 RETURNS jsonb
 LANGUAGE plpgsql
 VOLATILE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_cache jsonb;
  v_eligible bigint := 0;
  v_embedded bigint := 0;
  v_age_minutes int := 999999;
BEGIN
  SELECT value INTO v_cache FROM public.app_settings WHERE key='embed_episode_eligible_cache';
  IF v_cache IS NOT NULL THEN
    v_eligible := COALESCE((v_cache->>'eligible_total')::bigint, 0);
    v_age_minutes := EXTRACT(EPOCH FROM (now() - (v_cache->>'computed_at')::timestamptz))::int / 60;
  END IF;

  IF v_age_minutes > 30 OR v_eligible = 0 THEN
    SELECT count(*) INTO v_eligible
      FROM public.episodes e
      JOIN public.podcasts p ON p.id = e.podcast_id
     WHERE p.rank_label IN ('S','A','B','C')
       AND COALESCE(p.shadow_rank_components->>'health_state','') NOT IN
           ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam');
    INSERT INTO public.app_settings(key, value, updated_at)
    VALUES ('embed_episode_eligible_cache',
            jsonb_build_object('eligible_total', v_eligible, 'computed_at', now()),
            now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
  END IF;

  SELECT count(*) INTO v_embedded
    FROM public.episode_embeddings WHERE model = _model;

  RETURN jsonb_build_object(
    'eligible_total', v_eligible,
    'already_embedded', v_embedded,
    'missing_embedding', GREATEST(v_eligible - v_embedded, 0)
  );
END;
$function$;
