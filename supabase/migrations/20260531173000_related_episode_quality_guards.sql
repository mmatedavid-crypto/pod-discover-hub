-- Related episode quality guards:
-- vectors are useful only after basic editorial compatibility checks.

CREATE OR REPLACE FUNCTION public.recommendation_text_group(
  p_title text,
  p_podcast_title text,
  p_category text,
  p_topics text[]
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN lower(coalesce(p_title,'') || ' ' || coalesce(p_podcast_title,'') || ' ' || coalesce(p_category,'') || ' ' || array_to_string(coalesce(p_topics, ARRAY[]::text[]), ' '))
      ~ '(mese|meseradio|meserádió|gyerek|gyermek|ovis|óvodás|altató|tündér|baba|esti mese|kids|children)' THEN 'children'
    WHEN lower(coalesce(p_title,'') || ' ' || coalesce(p_podcast_title,'') || ' ' || coalesce(p_category,'') || ' ' || array_to_string(coalesce(p_topics, ARRAY[]::text[]), ' '))
      ~ '(üzlet|uzlet|business|gazdaság|gazdasag|pénz|penz|tőzsde|tozsde|befektetés|befektetes|milliárdos|milliardos|cég|ceg|vállalkozás|vallalkozas|ingatlan|karrier|menedzsment)' THEN 'business'
    WHEN lower(coalesce(p_title,'') || ' ' || coalesce(p_podcast_title,'') || ' ' || coalesce(p_category,'') || ' ' || array_to_string(coalesce(p_topics, ARRAY[]::text[]), ' '))
      ~ '(közélet|kozelet|politika|politics|hírek|hirek|társadalom|tarsadalom|interjú|interju|közbeszéd|kozbeszed)' THEN 'public_affairs'
    WHEN lower(coalesce(p_title,'') || ' ' || coalesce(p_podcast_title,'') || ' ' || coalesce(p_category,'') || ' ' || array_to_string(coalesce(p_topics, ARRAY[]::text[]), ' '))
      ~ '(egészség|egeszseg|orvos|pszicho|mentális|mentalis|életmód|eletmod|sport)' THEN 'health'
    WHEN lower(coalesce(p_title,'') || ' ' || coalesce(p_podcast_title,'') || ' ' || coalesce(p_category,'') || ' ' || array_to_string(coalesce(p_topics, ARRAY[]::text[]), ' '))
      ~ '(vallás|vallas|hit|keresztény|kereszteny|isten|biblia|egyház|egyhaz|religion)' THEN 'religion'
    ELSE 'general'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.recommendation_has_topic_bridge(
  p_source_topics text[],
  p_candidate_topics text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(coalesce(p_source_topics, ARRAY[]::text[])) s(topic)
    JOIN unnest(coalesce(p_candidate_topics, ARRAY[]::text[])) c(topic)
      ON lower(s.topic) = lower(c.topic)
  );
$function$;

CREATE OR REPLACE FUNCTION public.recommendation_is_compatible(
  p_source_group text,
  p_candidate_group text,
  p_similarity double precision,
  p_has_topic_bridge boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_candidate_group = 'children' AND p_source_group <> 'children' THEN false
    WHEN p_source_group = 'children' AND p_candidate_group <> 'children' AND NOT p_has_topic_bridge THEN false
    WHEN p_source_group <> 'general' AND p_candidate_group <> 'general' AND p_source_group <> p_candidate_group
      THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.72
    WHEN p_source_group <> 'general' AND p_candidate_group = 'general'
      THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.66
    WHEN p_candidate_group <> 'general' AND p_source_group = 'general'
      THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.66
    ELSE p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.56 OR p_source_group = p_candidate_group
  END;
$function$;

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
  src_group text;
BEGIN
  SELECT ee.embedding, ee.podcast_id INTO src_embedding, src_podcast_id
  FROM episode_embeddings ee WHERE ee.episode_id = p_episode_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;

  SELECT
    COALESCE(e.topics, '{}'),
    public.recommendation_text_group(e.title, pod.title, pod.category, e.topics)
  INTO src_topics, src_group
  FROM episodes e
  JOIN podcasts pod ON pod.id = e.podcast_id
  WHERE e.id = p_episode_id;

  RETURN QUERY
  WITH ep_cand AS (
    SELECT ee.episode_id AS eid, ee.podcast_id AS pid,
           (1 - (ee.embedding <=> src_embedding))::float AS sim
    FROM episode_embeddings ee
    WHERE ee.episode_id <> p_episode_id
    ORDER BY ee.embedding <=> src_embedding
    LIMIT 260
  ),
  chunk_cand AS (
    SELECT DISTINCT ON (ec.episode_id)
           ec.episode_id AS eid, ec.podcast_id AS pid,
           (1 - (ec.embedding <=> src_embedding))::float AS sim
    FROM episode_chunks ec
    WHERE ec.episode_id <> p_episode_id
    ORDER BY ec.episode_id, ec.embedding <=> src_embedding
    LIMIT 260
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
      e.published_at, e.audio_url, e.image_url, COALESCE(e.topics, ARRAY[]::text[]) AS topics,
      pod.slug AS p_slug, pod.title AS p_title, pod.display_title AS p_display_title,
      pod.image_url AS p_image, pod.category AS p_category,
      pod.podiverzum_rank AS p_rank, pod.rank_label AS p_rank_label,
      (e.podcast_id = src_podcast_id) AS same_pod,
      public.recommendation_has_topic_bridge(src_topics, e.topics) AS topic_bridge,
      public.recommendation_text_group(e.title, pod.title, pod.category, e.topics) AS candidate_group
    FROM pool p
    JOIN episodes e ON e.id = p.eid
    JOIN podcasts pod ON pod.id = e.podcast_id
    WHERE pod.is_hungarian = true
      AND pod.language_decision = 'accept_hungarian'
      AND COALESCE(pod.rss_status,'healthy') NOT IN ('failed','inactive')
      AND e.audio_url IS NOT NULL
  ),
  scored AS (
    SELECT c.*,
      COALESCE(array_length(
        ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(c.topics)), 1
      ), 0) AS topic_overlap,
      (
        c.sim * 1.0
        + CASE c.p_rank_label WHEN 'S' THEN 0.05 WHEN 'A' THEN 0.03 WHEN 'B' THEN 0.015 ELSE 0 END
        + CASE WHEN c.published_at IS NOT NULL
               AND c.published_at > now() - interval '180 days' THEN 0.03 ELSE 0 END
        + LEAST(
            COALESCE(array_length(
              ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(c.topics)), 1), 0
            ) * 0.05, 0.15
          )
        - CASE WHEN COALESCE(length(coalesce(c.ai_summary, c.summary, c.description)),0) < 80 THEN 0.05 ELSE 0 END
      )::float AS fscore
    FROM cand c
    WHERE (p_downweight_same_podcast = false OR c.same_pod = false)
      AND public.recommendation_is_compatible(src_group, c.candidate_group, c.sim, c.topic_bridge)
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
      WHEN d.sim >= 0.66 THEN 'Erős tartalmi közelség az epizód-index alapján.'
      ELSE 'Tartalmilag rokon epizód.'
    END AS related_reason
  FROM diversified d
  WHERE d.rn_per_pod = 1
    AND d.sim >= 0.50
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
  src_group text;
BEGIN
  SELECT ee.embedding, ee.podcast_id INTO src_embedding, src_podcast_id
  FROM episode_embeddings ee WHERE ee.episode_id = p_episode_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;

  SELECT
    COALESCE(e.topics, '{}'),
    public.recommendation_text_group(e.title, pod.title, pod.category, e.topics)
  INTO src_topics, src_group
  FROM episodes e
  JOIN podcasts pod ON pod.id = e.podcast_id
  WHERE e.id = p_episode_id;

  RETURN QUERY
  WITH ep_cand AS (
    SELECT ee.episode_id AS eid, ee.podcast_id AS pid,
           (1 - (ee.embedding <=> src_embedding))::float AS sim
    FROM episode_embeddings ee
    WHERE ee.episode_id <> p_episode_id
      AND ee.podcast_id <> COALESCE(src_podcast_id,'00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY ee.embedding <=> src_embedding
    LIMIT 260
  ),
  chunk_cand AS (
    SELECT DISTINCT ON (ec.episode_id)
           ec.episode_id AS eid, ec.podcast_id AS pid,
           (1 - (ec.embedding <=> src_embedding))::float AS sim
    FROM episode_chunks ec
    WHERE ec.episode_id <> p_episode_id
      AND ec.podcast_id <> COALESCE(src_podcast_id,'00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY ec.episode_id, ec.embedding <=> src_embedding
    LIMIT 260
  ),
  pool AS (
    SELECT eid, pid, max(sim) AS sim
    FROM (SELECT * FROM ep_cand UNION ALL SELECT * FROM chunk_cand) u
    GROUP BY eid, pid
  ),
  scored AS (
    SELECT e.id AS eid, e.podcast_id AS pid, p.sim,
      e.title, e.display_title, e.slug, e.ai_summary, e.summary, e.description,
      e.published_at, e.audio_url, COALESCE(e.topics, ARRAY[]::text[]) AS topics,
      pod.slug AS p_slug, pod.title AS p_title, pod.display_title AS p_display_title,
      pod.image_url AS p_image, pod.category AS p_category,
      pod.podiverzum_rank AS p_rank, pod.rank_label AS p_rank_label,
      (
        p.sim
        + CASE pod.rank_label WHEN 'S' THEN 0.05 WHEN 'A' THEN 0.03 WHEN 'B' THEN 0.015 ELSE 0 END
        + LEAST(
            COALESCE(array_length(
              ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(e.topics)), 1), 0
            ) * 0.05, 0.15
          )
      )::float AS fscore
    FROM pool p
    JOIN episodes e ON e.id = p.eid
    JOIN podcasts pod ON pod.id = e.podcast_id
    WHERE pod.is_hungarian = true
      AND pod.language_decision = 'accept_hungarian'
      AND COALESCE(pod.rss_status,'healthy') NOT IN ('failed','inactive')
      AND e.audio_url IS NOT NULL
      AND public.recommendation_is_compatible(
        src_group,
        public.recommendation_text_group(e.title, pod.title, pod.category, e.topics),
        p.sim,
        public.recommendation_has_topic_bridge(src_topics, e.topics)
      )
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
    AND d.sim >= 0.50
  ORDER BY d.fscore DESC
  LIMIT GREATEST(p_limit, 1);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_related_episodes_by_embedding(uuid, integer, boolean) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.similar_episodes(uuid, integer) TO anon, authenticated, service_role;
