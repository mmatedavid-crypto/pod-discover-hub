-- Topic and person episode lists used to be fetched with PostgREST embedded
-- joins filtered on podcasts.language_decision. Under background-pipeline load
-- those plans exceeded the 3s anon statement timeout and the pages rendered as
-- if the catalogue were empty. These narrow SECURITY DEFINER functions do the
-- join server-side, return only the fields the episode cards need, and run with
-- a longer local statement timeout.

CREATE OR REPLACE FUNCTION public.topic_episodes(_topic_id uuid, _limit integer DEFAULT 120)
RETURNS TABLE (
  id uuid,
  title text,
  display_title text,
  slug text,
  image_url text,
  published_at timestamptz,
  ai_summary text,
  summary text,
  audio_url text,
  people text[],
  mentioned text[],
  podcast_id uuid,
  podcast_slug text,
  podcast_title text,
  podcast_display_title text,
  podcast_image_url text,
  podcast_category text,
  podcast_rank numeric,
  podcast_rank_label text,
  source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH rejected AS (
    SELECT episode_id FROM episode_topic_relevance_reviews
    WHERE topic_id = _topic_id AND status = 'rejected'
  ),
  accepted AS (
    SELECT episode_id, 'review'::text AS source FROM episode_topic_relevance_reviews
    WHERE topic_id = _topic_id AND status = 'accepted'
  ),
  mapped AS (
    SELECT episode_id, 'map'::text AS source FROM episode_topic_map
    WHERE topic_id = _topic_id
  ),
  candidates AS (
    SELECT episode_id, source FROM accepted
    UNION
    SELECT episode_id, source FROM mapped
  ),
  ranked AS (
    SELECT episode_id, min(CASE WHEN source = 'review' THEN 0 ELSE 1 END) AS pref,
           min(source) AS source
    FROM candidates
    WHERE episode_id NOT IN (SELECT episode_id FROM rejected)
    GROUP BY episode_id
  )
  SELECT e.id, e.title, e.display_title, e.slug, e.image_url, e.published_at,
         e.ai_summary, e.summary, e.audio_url, e.people, e.mentioned, e.podcast_id,
         p.slug, p.title, p.display_title, p.image_url, p.category,
         p.podiverzum_rank, p.rank_label, r.source
  FROM ranked r
  JOIN episodes e ON e.id = r.episode_id
  JOIN podcasts p ON p.id = e.podcast_id
  WHERE p.language_decision = 'accept_hungarian'
  ORDER BY r.pref, e.published_at DESC NULLS LAST
  LIMIT greatest(1, least(coalesce(_limit, 120), 300));
$$;

CREATE OR REPLACE FUNCTION public.person_episodes(_person_id uuid, _limit integer DEFAULT 120)
RETURNS TABLE (
  id uuid,
  title text,
  display_title text,
  slug text,
  image_url text,
  published_at timestamptz,
  ai_summary text,
  summary text,
  audio_url text,
  people text[],
  mentioned text[],
  podcast_id uuid,
  podcast_slug text,
  podcast_title text,
  podcast_display_title text,
  podcast_image_url text,
  podcast_category text,
  podcast_rank numeric,
  podcast_rank_label text,
  mention_type text,
  relevance_score numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH m AS (
    SELECT episode_id,
           min(mention_type) AS mention_type,
           max(final_relevance_score) AS relevance_score
    FROM person_episode_mentions
    WHERE person_id = _person_id
      AND coalesce(relevance_status, 'accepted') <> 'rejected'
    GROUP BY episode_id
  )
  SELECT e.id, e.title, e.display_title, e.slug, e.image_url, e.published_at,
         e.ai_summary, e.summary, e.audio_url, e.people, e.mentioned, e.podcast_id,
         p.slug, p.title, p.display_title, p.image_url, p.category,
         p.podiverzum_rank, p.rank_label, m.mention_type, m.relevance_score
  FROM m
  JOIN episodes e ON e.id = m.episode_id
  JOIN podcasts p ON p.id = e.podcast_id
  WHERE p.language_decision = 'accept_hungarian'
  ORDER BY m.relevance_score DESC NULLS LAST, e.published_at DESC NULLS LAST
  LIMIT greatest(1, least(coalesce(_limit, 120), 300));
$$;

GRANT EXECUTE ON FUNCTION public.topic_episodes(uuid, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.person_episodes(uuid, integer) TO anon, authenticated, service_role;