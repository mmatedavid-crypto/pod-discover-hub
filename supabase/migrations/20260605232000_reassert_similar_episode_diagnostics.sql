-- Reassert recommendation diagnostics for the dormant smart-player surface.
-- Public execution remains locked by smart_player_recommendation_surface_policy,
-- but internal/service-role consumers should receive an explainable reason for
-- every cross-podcast similar episode candidate.

CREATE OR REPLACE FUNCTION public.similar_episodes(
  p_episode_id uuid,
  p_limit integer DEFAULT 6
)
RETURNS TABLE(
  episode_id uuid, podcast_id uuid, similarity double precision,
  title text, display_title text, slug text, ai_summary text, summary text, description text,
  published_at timestamp with time zone, audio_url text, topics text[],
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
  src_people text[];
  src_companies text[];
  src_group text;
BEGIN
  SELECT ee.embedding, ee.podcast_id INTO src_embedding, src_podcast_id
  FROM episode_embeddings ee WHERE ee.episode_id = p_episode_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;

  SELECT
    COALESCE(e.topics, '{}'),
    COALESCE(e.people, '{}') || COALESCE(e.mentioned, '{}'),
    COALESCE(e.companies, '{}'),
    public.recommendation_text_group(e.title, pod.title, pod.category, e.topics)
  INTO src_topics, src_people, src_companies, src_group
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
      COALESCE(e.people, ARRAY[]::text[]) || COALESCE(e.mentioned, ARRAY[]::text[]) AS people_all,
      COALESCE(e.companies, ARRAY[]::text[]) AS companies,
      pod.slug AS p_slug, pod.title AS p_title, pod.display_title AS p_display_title,
      pod.image_url AS p_image, pod.category AS p_category,
      pod.podiverzum_rank AS p_rank, pod.rank_label AS p_rank_label,
      COALESCE(array_length(
        ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(COALESCE(e.topics, ARRAY[]::text[]))), 1
      ), 0) AS topic_overlap,
      COALESCE(array_length(
        ARRAY(SELECT unnest(src_people) INTERSECT SELECT unnest(COALESCE(e.people, ARRAY[]::text[]) || COALESCE(e.mentioned, ARRAY[]::text[]))), 1
      ), 0) AS people_overlap,
      COALESCE(array_length(
        ARRAY(SELECT unnest(src_companies) INTERSECT SELECT unnest(COALESCE(e.companies, ARRAY[]::text[]))), 1
      ), 0) AS company_overlap,
      (
        p.sim
        + CASE pod.rank_label WHEN 'S' THEN 0.05 WHEN 'A' THEN 0.03 WHEN 'B' THEN 0.015 ELSE 0 END
        + LEAST(
            COALESCE(array_length(
              ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(COALESCE(e.topics, ARRAY[]::text[]))), 1), 0
            ) * 0.05, 0.15
          )
        + LEAST(
            COALESCE(array_length(
              ARRAY(SELECT unnest(src_people) INTERSECT SELECT unnest(COALESCE(e.people, ARRAY[]::text[]) || COALESCE(e.mentioned, ARRAY[]::text[]))), 1), 0
            ) * 0.08, 0.20
          )
        + LEAST(
            COALESCE(array_length(
              ARRAY(SELECT unnest(src_companies) INTERSECT SELECT unnest(COALESCE(e.companies, ARRAY[]::text[]))), 1), 0
            ) * 0.07, 0.18
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
        public.recommendation_has_content_bridge(
          src_topics, e.topics,
          src_people, COALESCE(e.people, ARRAY[]::text[]) || COALESCE(e.mentioned, ARRAY[]::text[]),
          src_companies, e.companies
        )
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
    d.p_rank, d.p_rank_label,
    CASE
      WHEN d.people_overlap > 0 THEN 'Kapcsolódó személyek alapján.'
      WHEN d.company_overlap > 0 THEN 'Kapcsolódó szervezet vagy márka alapján.'
      WHEN d.topic_overlap > 0
        THEN 'Hasonló témák: ' || array_to_string(
          (ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(d.topics)))[1:3], ', ')
      WHEN d.sim >= 0.82 THEN 'Erős tartalmi közelség az epizód-index alapján.'
      ELSE 'Tartalmilag rokon epizód.'
    END AS related_reason
  FROM diversified d
  WHERE d.rn_per_pod = 1
    AND d.sim >= 0.50
  ORDER BY d.fscore DESC
  LIMIT GREATEST(p_limit, 1);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.similar_episodes(uuid, integer) TO service_role;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'recommendation_diagnostics_policy',
  jsonb_build_object(
    'version', 1,
    'related_reason_required', true,
    'applies_to', jsonb_build_array('get_related_episodes_by_embedding', 'similar_episodes', 'personalized-home-rails'),
    'reason_sources', jsonb_build_array('shared_people', 'shared_companies', 'shared_topics', 'strong_clean_text_embedding_similarity'),
    'public_surface_locked_until_quality_trusted', true,
    'reasserted_by', '20260605232000_reassert_similar_episode_diagnostics',
    'note', 'Dormant smart-player and personalized recommendation surfaces must carry concise Hungarian diagnostics before public reactivation.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
