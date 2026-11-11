-- embed-podcast-runner has been dying on "canceling statement due to statement timeout" since 2026-11-09:
-- get_podcast_embedding_inputs_v2 runs three per-podcast laterals over episode_cards/episode_topic_map
-- (~60ms x batch under cold cache), which can exceed the 8s PostgREST statement timeout.
-- Give the function its own bounded statement timeout; logic is unchanged.
CREATE OR REPLACE FUNCTION public.get_podcast_embedding_inputs_v2(_ids uuid[])
RETURNS TABLE(id uuid, title text, category text, description text, map_topics text[], card_topics text[], recent_titles text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
SET statement_timeout TO '25s'
AS $$
  SELECT p.id,
         coalesce(nullif(p.display_title,''), p.title),
         p.category,
         left(coalesce(p.description, ''), 2000),
         coalesce(mt.v, ARRAY[]::text[]),
         coalesce(ct.v, ARRAY[]::text[]),
         coalesce(rt.v, ARRAY[]::text[])
    FROM public.podcasts p
    LEFT JOIN LATERAL (
      SELECT array_agg(z.n ORDER BY z.c DESC, z.n) AS v FROM (
        SELECT t.name AS n, count(*) AS c
          FROM (SELECT ec.episode_id FROM public.episode_cards ec WHERE ec.podcast_id = p.id
                 ORDER BY ec.published_at DESC NULLS LAST LIMIT 100) r
          JOIN public.episode_topic_map m ON m.episode_id = r.episode_id
          JOIN public.topics t ON t.id = m.topic_id
         GROUP BY t.name ORDER BY count(*) DESC, t.name LIMIT 10) z
    ) mt ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(y.n ORDER BY y.c DESC, y.n) AS v FROM (
        SELECT lower(btrim(tp)) AS n, count(*) AS c
          FROM (SELECT ec.topics FROM public.episode_cards ec WHERE ec.podcast_id = p.id
                 ORDER BY ec.published_at DESC NULLS LAST LIMIT 100) r,
               unnest(coalesce(r.topics, ARRAY[]::text[])) tp
         WHERE btrim(tp) <> ''
         GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 15) y
    ) ct ON true
    LEFT JOIN LATERAL (
      SELECT array_agg(x.title ORDER BY x.published_at DESC NULLS LAST) AS v FROM (
        SELECT ec.title, ec.published_at FROM public.episode_cards ec
         WHERE ec.podcast_id = p.id AND coalesce(ec.title,'') <> ''
         ORDER BY ec.published_at DESC NULLS LAST LIMIT 15) x
    ) rt ON true
   WHERE p.id = ANY(_ids);
$$;
REVOKE ALL ON FUNCTION public.get_podcast_embedding_inputs_v2(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_podcast_embedding_inputs_v2(uuid[]) TO service_role;