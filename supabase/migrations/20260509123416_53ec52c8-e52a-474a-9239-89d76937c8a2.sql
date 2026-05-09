
CREATE OR REPLACE FUNCTION public.select_embed_episode_candidates(_model text, _limit integer)
 RETURNS TABLE(id uuid, podcast_id uuid, title text, display_title text, description text, seo_description text, ai_summary text, topics text[], people text[], companies text[], tickers text[], ingredients text[], podcast_title text, podcast_display_title text, podcast_category text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_remaining int := GREATEST(1, LEAST(_limit, 200));
  v_tier text;
  v_rec record;
BEGIN
  FOREACH v_tier IN ARRAY ARRAY['S','A','B','C']::text[] LOOP
    EXIT WHEN v_remaining <= 0;
    FOR v_rec IN
      SELECT p.id AS pid, p.title AS p_title, p.display_title AS p_display_title, p.category AS p_category
        FROM public.podcasts p
       WHERE p.rank_label = v_tier
         AND COALESCE(p.shadow_rank_components->>'health_state','') NOT IN
             ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam')
       ORDER BY p.podiverzum_rank DESC NULLS LAST
    LOOP
      EXIT WHEN v_remaining <= 0;
      FOR id, podcast_id, title, display_title, description, seo_description,
          ai_summary, topics, people, companies, tickers, ingredients,
          podcast_title, podcast_display_title, podcast_category IN
        SELECT e.id, e.podcast_id, e.title, e.display_title, e.description,
               e.seo_description, e.ai_summary, e.topics, e.people, e.companies,
               e.tickers, e.ingredients,
               v_rec.p_title, v_rec.p_display_title, v_rec.p_category
          FROM public.episodes e
         WHERE e.podcast_id = v_rec.pid
           AND NOT EXISTS (
             SELECT 1 FROM public.episode_embeddings ee
              WHERE ee.episode_id = e.id AND ee.model = _model
           )
         ORDER BY e.published_at DESC NULLS LAST
         LIMIT v_remaining
      LOOP
        RETURN NEXT;
        v_remaining := v_remaining - 1;
        EXIT WHEN v_remaining <= 0;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$function$;
