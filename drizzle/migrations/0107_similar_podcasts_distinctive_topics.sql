-- Shared-topic bridges only count distinctive labels: a topic carried by more than 15% of
-- podcasts (közélet, társadalom, gazdaság, ...) says nothing about two shows being alike.
CREATE OR REPLACE FUNCTION public.get_similar_podcasts_by_embedding(p_podcast_id uuid, p_limit integer DEFAULT 8)
RETURNS TABLE(id uuid, similarity double precision, final_score double precision, title text, display_title text, slug text, summary text, description text, image_url text, category text, apple_url text, spotify_url text, youtube_url text, website_url text, featured boolean, rss_status text, podiverzum_rank numeric, rank_label text, episode_count integer, latest_episode_at timestamp with time zone)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '8s'
AS $function$
DECLARE
  src_embedding vector(768);
  src_group text;
  src_topics text[];
  rare_topics text[];
  max_df numeric;
BEGIN
  SELECT pe.embedding,
         coalesce(pe.rec_group, public.recommendation_text_group(NULL, coalesce(p.display_title, p.title), p.category, pe.top_topics[1:3])),
         coalesce(pe.top_topics, ARRAY[]::text[])
    INTO src_embedding, src_group, src_topics
    FROM podcast_embeddings pe JOIN podcasts p ON p.id = pe.podcast_id
   WHERE pe.podcast_id = p_podcast_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;

  SELECT greatest(30, count(*) * 0.15) INTO max_df FROM podcast_embeddings WHERE top_topics IS NOT NULL;
  SELECT coalesce(array_agg(t), ARRAY[]::text[]) INTO rare_topics FROM (
    SELECT st.t FROM unnest(src_topics) st(t)
     WHERE (SELECT count(*) FROM podcast_embeddings pe2 WHERE st.t = ANY(pe2.top_topics)) <= max_df
  ) z;

  RETURN QUERY
  WITH cand AS (
    SELECT p.*, (1 - (pe.embedding <=> src_embedding))::float AS sim,
           coalesce(pe.rec_group, public.recommendation_text_group(NULL, coalesce(p.display_title, p.title), p.category, pe.top_topics[1:3])) AS grp,
           coalesce((SELECT count(*) FROM unnest(coalesce(pe.top_topics, ARRAY[]::text[])) t WHERE t = ANY(rare_topics)), 0)::int AS shared
    FROM podcast_embeddings pe
    JOIN podcasts p ON p.id = pe.podcast_id
    WHERE pe.podcast_id <> p_podcast_id
      AND p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
      AND COALESCE(p.rss_status,'healthy') NOT IN ('failed','inactive')
      AND COALESCE(p.shadow_rank_components->>'health_state','') NOT IN
          ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam')
      AND COALESCE(p.rank_label,'E') IN ('S','A','B','C','D')
    ORDER BY pe.embedding <=> src_embedding
    LIMIT 80
  ),
  compat AS (
    SELECT c.* FROM cand c
     WHERE c.sim >= 0.55
       AND public.recommendation_is_compatible_v2(src_group, c.grp, c.sim, c.shared, false)
  ),
  stats AS (
    SELECT c.*, agg.ep_count, agg.last_ep_at
    FROM compat c
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS ep_count, max(ec.published_at) AS last_ep_at
      FROM episode_cards ec WHERE ec.podcast_id = c.id
    ) agg ON true
  )
  SELECT
    s.id, s.sim,
    (
      s.sim
      + CASE WHEN s.grp = src_group THEN 0.03 ELSE 0 END
      + least(s.shared, 4) * 0.015
      + CASE s.rank_label WHEN 'S' THEN 0.05 WHEN 'A' THEN 0.035 WHEN 'B' THEN 0.02 WHEN 'C' THEN 0.01 ELSE 0 END
      + CASE WHEN s.last_ep_at > now() - interval '60 days' THEN 0.02 ELSE 0 END
      + CASE WHEN s.ep_count >= 20 THEN 0.01 ELSE 0 END
    )::float AS fscore,
    s.title, s.display_title, s.slug, s.summary, s.description,
    s.image_url, s.category, s.apple_url, s.spotify_url, s.youtube_url, s.website_url,
    s.featured, s.rss_status, s.podiverzum_rank, s.rank_label,
    coalesce(s.ep_count, 0), s.last_ep_at
  FROM stats s
  WHERE s.rank_label <> 'D' OR s.last_ep_at > now() - interval '120 days'
  ORDER BY fscore DESC
  LIMIT GREATEST(LEAST(p_limit, 24), 1);
END;
$function$;
