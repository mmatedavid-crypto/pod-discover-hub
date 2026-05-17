
-- Related episodes by embedding (HU-only, downweight same podcast, podcast diversity)
CREATE OR REPLACE FUNCTION public.get_related_episodes_by_embedding(
  p_episode_id uuid,
  p_limit integer DEFAULT 8,
  p_downweight_same_podcast boolean DEFAULT true
)
RETURNS TABLE(
  episode_id uuid,
  podcast_id uuid,
  similarity double precision,
  final_score double precision,
  title text,
  display_title text,
  slug text,
  ai_summary text,
  summary text,
  description text,
  published_at timestamptz,
  audio_url text,
  image_url text,
  topics text[],
  podcast_slug text,
  podcast_title text,
  podcast_display_title text,
  podcast_image_url text,
  podcast_category text,
  podiverzum_rank numeric,
  rank_label text,
  related_reason text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
  WITH cand AS (
    SELECT
      e.id AS eid,
      ee.podcast_id AS pid,
      (1 - (ee.embedding <=> src_embedding))::float AS sim,
      e.title, e.display_title, e.slug, e.ai_summary, e.summary, e.description,
      e.published_at, e.audio_url, e.image_url, e.topics,
      p.slug AS p_slug, p.title AS p_title, p.display_title AS p_display_title,
      p.image_url AS p_image, p.category AS p_category,
      p.podiverzum_rank AS p_rank, p.rank_label AS p_rank_label,
      CASE WHEN ee.podcast_id = src_podcast_id THEN true ELSE false END AS same_pod
    FROM episode_embeddings ee
    JOIN episodes e ON e.id = ee.episode_id
    JOIN podcasts p ON p.id = ee.podcast_id
    WHERE ee.episode_id <> p_episode_id
      AND p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
      AND COALESCE(p.rss_status,'healthy') NOT IN ('failed','inactive')
      AND COALESCE(p.rank_label,'E') NOT IN ('D','E')
    ORDER BY ee.embedding <=> src_embedding
    LIMIT 60
  ),
  scored AS (
    SELECT
      c.*,
      (
        c.sim * 1.0
        + CASE c.p_rank_label WHEN 'S' THEN 0.08 WHEN 'A' THEN 0.05 WHEN 'B' THEN 0.02 ELSE 0 END
        + CASE WHEN c.published_at IS NOT NULL
               AND c.published_at > now() - interval '90 days' THEN 0.03 ELSE 0 END
        - CASE WHEN p_downweight_same_podcast AND c.same_pod THEN 0.08 ELSE 0 END
        - CASE WHEN COALESCE(length(coalesce(c.ai_summary, c.summary, c.description)),0) < 80 THEN 0.05 ELSE 0 END
      )::float AS fscore
    FROM cand c
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
      WHEN array_length(ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(d.topics)),1) > 0
        THEN 'Hasonló témák: ' || array_to_string(
          (ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(d.topics)))[1:3],
          ', ')
      ELSE 'Hasonló témákat érint.'
    END AS related_reason
  FROM diversified d
  WHERE d.rn_per_pod <= 2
    AND d.sim >= 0.55
  ORDER BY d.fscore DESC
  LIMIT GREATEST(p_limit, 1);
END;
$$;

-- Similar podcasts by embedding (HU-only)
CREATE OR REPLACE FUNCTION public.get_similar_podcasts_by_embedding(
  p_podcast_id uuid,
  p_limit integer DEFAULT 8
)
RETURNS TABLE(
  id uuid,
  similarity double precision,
  final_score double precision,
  title text,
  display_title text,
  slug text,
  summary text,
  description text,
  image_url text,
  category text,
  apple_url text,
  spotify_url text,
  youtube_url text,
  website_url text,
  featured boolean,
  rss_status text,
  podiverzum_rank numeric,
  rank_label text,
  episode_count integer,
  latest_episode_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE src_embedding vector(768);
BEGIN
  SELECT embedding INTO src_embedding
  FROM podcast_embeddings WHERE podcast_id = p_podcast_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH cand AS (
    SELECT p.*, (1 - (pe.embedding <=> src_embedding))::float AS sim
    FROM podcast_embeddings pe
    JOIN podcasts p ON p.id = pe.podcast_id
    WHERE pe.podcast_id <> p_podcast_id
      AND p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
      AND COALESCE(p.rss_status,'healthy') NOT IN ('failed','inactive')
      AND COALESCE(p.rank_label,'E') IN ('S','A','B','C')
    ORDER BY pe.embedding <=> src_embedding
    LIMIT 40
  ),
  stats AS (
    SELECT c.*,
      (SELECT count(*)::int FROM episodes ee WHERE ee.podcast_id = c.id) AS ep_count,
      (SELECT max(ee.published_at) FROM episodes ee WHERE ee.podcast_id = c.id) AS last_ep_at
    FROM cand c
  )
  SELECT
    s.id, s.sim,
    (
      s.sim
      + CASE s.rank_label WHEN 'S' THEN 0.08 WHEN 'A' THEN 0.05 WHEN 'B' THEN 0.02 ELSE 0 END
      + CASE WHEN s.last_ep_at > now() - interval '60 days' THEN 0.04 ELSE 0 END
      + CASE WHEN s.ep_count >= 20 THEN 0.02 ELSE 0 END
    )::float AS fscore,
    s.title, s.display_title, s.slug, s.summary, s.description,
    s.image_url, s.category, s.apple_url, s.spotify_url, s.youtube_url, s.website_url,
    s.featured, s.rss_status, s.podiverzum_rank, s.rank_label,
    s.ep_count, s.last_ep_at
  FROM stats s
  WHERE s.sim >= 0.55
  ORDER BY fscore DESC
  LIMIT GREATEST(p_limit, 1);
END;
$$;
