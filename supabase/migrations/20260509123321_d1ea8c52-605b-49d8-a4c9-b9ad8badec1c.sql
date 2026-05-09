
CREATE OR REPLACE FUNCTION public.select_embed_episode_candidates(_model text, _limit integer)
 RETURNS TABLE(id uuid, podcast_id uuid, title text, display_title text, description text, seo_description text, ai_summary text, topics text[], people text[], companies text[], tickers text[], ingredients text[], podcast_title text, podcast_display_title text, podcast_category text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH eligible_podcasts AS (
    SELECT p.id, p.title AS p_title, p.display_title AS p_display_title, p.category AS p_category, p.rank_label
      FROM public.podcasts p
     WHERE p.rank_label IN ('S','A','B','C')
       AND COALESCE(p.shadow_rank_components->>'health_state','') NOT IN
           ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam')
  )
  SELECT e.id, e.podcast_id, e.title, e.display_title, e.description,
         e.seo_description, e.ai_summary, e.topics, e.people, e.companies,
         e.tickers, e.ingredients,
         ep.p_title, ep.p_display_title, ep.p_category
    FROM eligible_podcasts ep
    CROSS JOIN LATERAL (
      SELECT e.*
        FROM public.episodes e
       WHERE e.podcast_id = ep.id
         AND NOT EXISTS (
           SELECT 1 FROM public.episode_embeddings ee
            WHERE ee.episode_id = e.id AND ee.model = _model
         )
       ORDER BY e.published_at DESC NULLS LAST
       LIMIT GREATEST(1, LEAST(_limit, 200))
    ) e
   ORDER BY array_position(ARRAY['S','A','B','C']::text[], ep.rank_label) NULLS LAST,
            e.published_at DESC NULLS LAST
   LIMIT GREATEST(1, LEAST(_limit, 200));
$function$;
