CREATE OR REPLACE FUNCTION public.get_related_episodes_by_embedding(
  p_episode_id uuid,
  p_limit integer DEFAULT 8,
  p_downweight_same_podcast boolean DEFAULT true
)
RETURNS TABLE(
  episode_id uuid, podcast_id uuid, similarity double precision, final_score double precision,
  title text, display_title text, slug text, ai_summary text, summary text, description text,
  published_at timestamp with time zone, audio_url text, image_url text, topics text[],
  podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text,
  podcast_category text, podiverzum_rank numeric, rank_label text, related_reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  src_embedding vector(768);
  src_podcast_id uuid;
  src_topics text[];
BEGIN
  SELECT ee.embedding, ee.podcast_id INTO src_embedding, src_podcast_id
  FROM episode_embeddings ee WHERE ee.episode_id = p_episode_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;

  SELECT COALESCE(e.topics, '{}') INTO src_topics FROM episodes e WHERE e.id = p_episode_id;

  RETURN QUERY
  WITH ep_cand AS (
    SELECT ee.episode_id AS eid, ee.podcast_id AS pid,
           (1 - (ee.embedding <=> src_embedding))::float AS sim
    FROM episode_embeddings ee
    WHERE ee.episode_id <> p_episode_id
    ORDER BY ee.embedding <=> src_embedding
    LIMIT 200
  ),
  chunk_cand AS (
    SELECT DISTINCT ON (ec.episode_id)
           ec.episode_id AS eid, ec.podcast_id AS pid,
           (1 - (ec.embedding <=> src_embedding))::float AS sim
    FROM episode_chunks ec
    WHERE ec.episode_id <> p_episode_id
    ORDER BY ec.episode_id, ec.embedding <=> src_embedding
    LIMIT 200
  ),
  pool AS (
    SELECT eid, pid, max(sim) AS sim
    FROM (SELECT * FROM ep_cand UNION ALL SELECT * FROM chunk_cand) u
    GROUP BY eid, pid
  ),
  cand AS (
    SELECT
      e.id AS eid, e.podcast_id AS pid, p.sim,
      e.title, e.display_title, e.slug, e.ai_summary, e.summary, e.description,
      e.published_at, e.audio_url, e.image_url, e.topics,
      pod.slug AS p_slug, pod.title AS p_title, pod.display_title AS p_display_title,
      pod.image_url AS p_image, pod.category AS p_category,
      pod.podiverzum_rank AS p_rank, pod.rank_label AS p_rank_label,
      (e.podcast_id = src_podcast_id) AS same_pod
    FROM pool p
    JOIN episodes e ON e.id = p.eid
    JOIN podcasts pod ON pod.id = e.podcast_id
    WHERE pod.is_hungarian = true
      AND pod.language_decision = 'accept_hungarian'
      AND COALESCE(pod.rss_status,'healthy') NOT IN ('failed','inactive')
      AND COALESCE(pod.rank_label,'E') NOT IN ('D','E')
      AND e.audio_url IS NOT NULL
  ),
  scored AS (
    SELECT c.*,
      COALESCE(array_length(
        ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(c.topics)), 1
      ), 0) AS topic_overlap,
      (
        c.sim * 1.0
        + CASE c.p_rank_label WHEN 'S' THEN 0.08 WHEN 'A' THEN 0.05 WHEN 'B' THEN 0.02 ELSE 0 END
        + CASE WHEN c.published_at IS NOT NULL
               AND c.published_at > now() - interval '180 days' THEN 0.03 ELSE 0 END
        + LEAST(
            COALESCE(array_length(
              ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(c.topics)), 1), 0
            ) * 0.04, 0.12
          )
        - CASE WHEN COALESCE(length(coalesce(c.ai_summary, c.summary, c.description)),0) < 80 THEN 0.05 ELSE 0 END
      )::float AS fscore
    FROM cand c
    WHERE (p_downweight_same_podcast = false OR c.same_pod = false)
  ),
  diversified AS (
    SELECT s.*,
      row_number() OVER (PARTITION BY s.pid ORDER BY s.fscore DESC) AS rn_per_pod
    FROM scored s
  )
  SELECT
    d.eid, d.pid, d.sim, d.fscore,
    d.title, d.display_title, d.slug, d.ai_summary, d.summary, d.description,
    d.published_at, d.audio_url, d.image_url, d.topics,
    d.p_slug, d.p_title, d.p_display_title, d.p_image, d.p_category,
    d.p_rank, d.p_rank_label,
    CASE
      WHEN d.topic_overlap > 0
        THEN 'Hasonló témák: ' || array_to_string(
          (ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(d.topics)))[1:3], ', ')
      ELSE 'Tartalmilag rokon epizód.'
    END AS related_reason
  FROM diversified d
  WHERE d.rn_per_pod = 1
    AND d.sim >= 0.45
  ORDER BY d.fscore DESC
  LIMIT GREATEST(p_limit, 1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.similar_episodes(
  p_episode_id uuid,
  p_limit integer DEFAULT 6
)
RETURNS TABLE(
  episode_id uuid, podcast_id uuid, similarity double precision,
  title text, display_title text, slug text, ai_summary text, summary text, description text,
  published_at timestamp with time zone, audio_url text, topics text[],
  podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text,
  podcast_category text, podiverzum_rank numeric, rank_label text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  src_embedding vector(768);
  src_podcast_id uuid;
  src_topics text[];
BEGIN
  SELECT ee.embedding, ee.podcast_id INTO src_embedding, src_podcast_id
  FROM episode_embeddings ee WHERE ee.episode_id = p_episode_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;

  SELECT COALESCE(e.topics, '{}') INTO src_topics FROM episodes e WHERE e.id = p_episode_id;

  RETURN QUERY
  WITH ep_cand AS (
    SELECT ee.episode_id AS eid, ee.podcast_id AS pid,
           (1 - (ee.embedding <=> src_embedding))::float AS sim
    FROM episode_embeddings ee
    WHERE ee.episode_id <> p_episode_id
      AND ee.podcast_id <> COALESCE(src_podcast_id,'00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY ee.embedding <=> src_embedding
    LIMIT 200
  ),
  chunk_cand AS (
    SELECT DISTINCT ON (ec.episode_id)
           ec.episode_id AS eid, ec.podcast_id AS pid,
           (1 - (ec.embedding <=> src_embedding))::float AS sim
    FROM episode_chunks ec
    WHERE ec.episode_id <> p_episode_id
      AND ec.podcast_id <> COALESCE(src_podcast_id,'00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY ec.episode_id, ec.embedding <=> src_embedding
    LIMIT 200
  ),
  pool AS (
    SELECT eid, pid, max(sim) AS sim
    FROM (SELECT * FROM ep_cand UNION ALL SELECT * FROM chunk_cand) u
    GROUP BY eid, pid
  ),
  scored AS (
    SELECT e.id AS eid, e.podcast_id AS pid, p.sim,
      e.title, e.display_title, e.slug, e.ai_summary, e.summary, e.description,
      e.published_at, e.audio_url, e.topics,
      pod.slug AS p_slug, pod.title AS p_title, pod.display_title AS p_display_title,
      pod.image_url AS p_image, pod.category AS p_category,
      pod.podiverzum_rank AS p_rank, pod.rank_label AS p_rank_label,
      (
        p.sim
        + CASE pod.rank_label WHEN 'S' THEN 0.08 WHEN 'A' THEN 0.05 WHEN 'B' THEN 0.02 ELSE 0 END
        + LEAST(
            COALESCE(array_length(
              ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(e.topics)), 1), 0
            ) * 0.04, 0.12
          )
      )::float AS fscore
    FROM pool p
    JOIN episodes e ON e.id = p.eid
    JOIN podcasts pod ON pod.id = e.podcast_id
    WHERE pod.is_hungarian = true
      AND pod.language_decision = 'accept_hungarian'
      AND COALESCE(pod.rss_status,'healthy') NOT IN ('failed','inactive')
      AND COALESCE(pod.rank_label,'E') NOT IN ('D','E')
      AND e.audio_url IS NOT NULL
  ),
  diversified AS (
    SELECT s.*, row_number() OVER (PARTITION BY s.pid ORDER BY s.fscore DESC) AS rn_per_pod
    FROM scored s
  )
  SELECT d.eid, d.pid, d.sim,
    d.title, d.display_title, d.slug, d.ai_summary, d.summary, d.description,
    d.published_at, d.audio_url, d.topics,
    d.p_slug, d.p_title, d.p_display_title, d.p_image, d.p_category,
    d.p_rank, d.p_rank_label
  FROM diversified d
  WHERE d.rn_per_pod = 1
    AND d.sim >= 0.45
  ORDER BY d.fscore DESC
  LIMIT GREATEST(p_limit, 1);
END;
$function$;