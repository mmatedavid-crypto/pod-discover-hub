
-- Smart Player v2: chunk-level moment matching + entity overlap + vector neighbor
-- Returns up to p_limit rows per match_kind, cross-podcast only.

DROP FUNCTION IF EXISTS public.smart_player_discover(uuid, integer);

CREATE OR REPLACE FUNCTION public.smart_player_discover(
  p_episode_id uuid,
  p_limit integer DEFAULT 6
)
RETURNS TABLE (
  match_kind text,                     -- 'chunk_moment' | 'entity_overlap' | 'vector_neighbor'
  episode_id uuid,
  podcast_id uuid,
  title text,
  display_title text,
  slug text,
  image_url text,
  audio_url text,
  podcast_slug text,
  podcast_title text,
  podcast_display_title text,
  podcast_image_url text,
  published_at timestamptz,
  similarity double precision,
  best_chunk_idx integer,
  best_char_start integer,
  snippet text,
  seek_seconds integer,
  shared_persons text[],
  shared_orgs text[],
  shared_topics text[],
  why_label text,
  sort_score double precision
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  src_podcast_id uuid;
  src_topics text[];
  src_people text[];
  src_org_names text[];
BEGIN
  -- Load source episode metadata
  SELECT e.podcast_id,
         COALESCE(e.topics, ARRAY[]::text[]),
         COALESCE(e.people, ARRAY[]::text[]),
         COALESCE(
           ARRAY(SELECT jsonb_array_elements(e.organizations) ->> 'name'
                  WHERE jsonb_typeof(e.organizations) = 'array'),
           ARRAY[]::text[]
         )
  INTO src_podcast_id, src_topics, src_people, src_org_names
  FROM public.episodes e
  WHERE e.id = p_episode_id;

  IF src_podcast_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH
  -- 1) source chunks: top 6 longest = richest moments
  src_chunks AS (
    SELECT ec.chunk_idx, ec.char_start, ec.embedding, length(ec.content) AS clen
    FROM public.episode_chunks ec
    WHERE ec.episode_id = p_episode_id
    ORDER BY clen DESC
    LIMIT 6
  ),
  -- 2) for each source chunk, find best cross-podcast chunk matches via HNSW
  chunk_candidates AS (
    SELECT
      ec.episode_id AS cand_ep,
      ec.podcast_id AS cand_pod,
      ec.chunk_idx,
      ec.char_start,
      ec.content,
      1 - (ec.embedding <=> sc.embedding) AS sim
    FROM src_chunks sc
    CROSS JOIN LATERAL (
      SELECT ec2.episode_id, ec2.podcast_id, ec2.chunk_idx, ec2.char_start, ec2.content, ec2.embedding
      FROM public.episode_chunks ec2
      WHERE ec2.podcast_id <> src_podcast_id
      ORDER BY ec2.embedding <=> sc.embedding
      LIMIT 25
    ) ec
  ),
  chunk_best AS (
    SELECT DISTINCT ON (cand_ep)
      cand_ep AS episode_id,
      cand_pod AS podcast_id,
      chunk_idx,
      char_start,
      content,
      sim
    FROM chunk_candidates
    ORDER BY cand_ep, sim DESC
  ),
  -- 3) episode-level vector neighbors (cross-podcast), pulled from existing helper
  vec_neighbors AS (
    SELECT se.episode_id, se.podcast_id, se.similarity
    FROM public.similar_episodes(p_episode_id, 25) se
    WHERE se.podcast_id <> src_podcast_id
  ),
  -- 4) entity-overlap candidates (cross-podcast)
  ent_candidates AS (
    SELECT
      e.id AS episode_id,
      e.podcast_id,
      ARRAY(SELECT unnest(COALESCE(e.people, ARRAY[]::text[])) INTERSECT SELECT unnest(src_people))   AS s_people,
      ARRAY(SELECT unnest(COALESCE(e.topics, ARRAY[]::text[])) INTERSECT SELECT unnest(src_topics))   AS s_topics,
      ARRAY(
        SELECT unnest(
          COALESCE(
            ARRAY(SELECT jsonb_array_elements(e.organizations) ->> 'name'
                   WHERE jsonb_typeof(e.organizations) = 'array'),
            ARRAY[]::text[]
          )
        )
        INTERSECT SELECT unnest(src_org_names)
      ) AS s_orgs,
      e.published_at
    FROM public.episodes e
    WHERE e.id <> p_episode_id
      AND e.podcast_id <> src_podcast_id
      AND (
        (src_people  <> ARRAY[]::text[] AND e.people  && src_people)  OR
        (src_topics  <> ARRAY[]::text[] AND e.topics  && src_topics)  OR
        (src_org_names <> ARRAY[]::text[] AND jsonb_typeof(e.organizations) = 'array'
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements(e.organizations) o
            WHERE (o ->> 'name') = ANY(src_org_names)
          ))
      )
    ORDER BY e.published_at DESC NULLS LAST
    LIMIT 200
  ),
  ent_scored AS (
    SELECT
      ec.episode_id,
      ec.podcast_id,
      ec.s_people,
      ec.s_topics,
      ec.s_orgs,
      (cardinality(ec.s_people) * 3 + cardinality(ec.s_orgs) * 2 + cardinality(ec.s_topics))::double precision AS sc
    FROM ent_candidates ec
    WHERE cardinality(ec.s_people) + cardinality(ec.s_orgs) + cardinality(ec.s_topics) > 0
  ),
  -- 5) shape each rail with a sort_score, then diversify per-podcast in the SELECT
  chunk_rail AS (
    SELECT
      'chunk_moment'::text AS match_kind,
      cb.episode_id,
      cb.podcast_id,
      cb.chunk_idx AS best_chunk_idx,
      cb.char_start AS best_char_start,
      LEFT(regexp_replace(cb.content, E'\\s+', ' ', 'g'), 180) AS snippet,
      GREATEST(0, FLOOR(cb.char_start::numeric / 15))::int AS seek_seconds,
      cb.sim AS similarity,
      ARRAY[]::text[] AS s_people,
      ARRAY[]::text[] AS s_orgs,
      ARRAY[]::text[] AS s_topics,
      cb.sim AS sort_score
    FROM chunk_best cb
    WHERE cb.sim >= 0.55
  ),
  ent_rail AS (
    SELECT
      'entity_overlap'::text AS match_kind,
      es.episode_id,
      es.podcast_id,
      NULL::int AS best_chunk_idx,
      NULL::int AS best_char_start,
      NULL::text AS snippet,
      NULL::int AS seek_seconds,
      NULL::double precision AS similarity,
      es.s_people,
      es.s_orgs,
      es.s_topics,
      es.sc AS sort_score
    FROM ent_scored es
  ),
  vec_rail AS (
    SELECT
      'vector_neighbor'::text AS match_kind,
      vn.episode_id,
      vn.podcast_id,
      NULL::int AS best_chunk_idx,
      NULL::int AS best_char_start,
      NULL::text AS snippet,
      NULL::int AS seek_seconds,
      vn.similarity,
      ARRAY[]::text[] AS s_people,
      ARRAY[]::text[] AS s_orgs,
      ARRAY[]::text[] AS s_topics,
      vn.similarity AS sort_score
    FROM vec_neighbors vn
  ),
  unioned AS (
    SELECT * FROM chunk_rail
    UNION ALL SELECT * FROM ent_rail
    UNION ALL SELECT * FROM vec_rail
  ),
  -- per-rail diversification: one episode per podcast, top p_limit per rail
  ranked AS (
    SELECT
      u.*,
      ROW_NUMBER() OVER (PARTITION BY u.match_kind, u.podcast_id ORDER BY u.sort_score DESC) AS pod_rn,
      ROW_NUMBER() OVER (PARTITION BY u.match_kind ORDER BY u.sort_score DESC) AS kind_rn
    FROM unioned u
  )
  SELECT
    r.match_kind,
    r.episode_id,
    r.podcast_id,
    e.title,
    e.display_title,
    e.slug,
    e.image_url,
    e.audio_url,
    p.slug AS podcast_slug,
    p.title AS podcast_title,
    p.display_title AS podcast_display_title,
    p.image_url AS podcast_image_url,
    e.published_at,
    r.similarity,
    r.best_chunk_idx,
    r.best_char_start,
    r.snippet,
    r.seek_seconds,
    r.s_people  AS shared_persons,
    r.s_orgs    AS shared_orgs,
    r.s_topics  AS shared_topics,
    CASE r.match_kind
      WHEN 'chunk_moment'    THEN 'Hasonló pillanat ' || COALESCE(to_char(r.seek_seconds / 60, 'FM00') || ':' || to_char(r.seek_seconds % 60, 'FM00'), '') || ' körül'
      WHEN 'entity_overlap'  THEN 'Közös: ' || array_to_string(
                                    (SELECT array_agg(x) FROM (
                                       SELECT unnest(r.s_people) AS x
                                       UNION ALL SELECT unnest(r.s_orgs)
                                       UNION ALL SELECT unnest(r.s_topics)
                                       LIMIT 3
                                     ) t),
                                    ', ')
      WHEN 'vector_neighbor' THEN ROUND((r.similarity * 100)::numeric)::text || '% témaegyezés'
      ELSE NULL
    END AS why_label,
    r.sort_score
  FROM ranked r
  JOIN public.episodes e ON e.id = r.episode_id
  JOIN public.podcasts p ON p.id = r.podcast_id
  WHERE r.pod_rn = 1
    AND r.kind_rn <= p_limit
    AND e.audio_url IS NOT NULL
    AND COALESCE(p.rss_status, 'active') NOT IN ('failed', 'inactive')
    AND p.language ILIKE 'hu%'
  ORDER BY r.match_kind, r.sort_score DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.smart_player_discover(uuid, integer) TO anon, authenticated, service_role;
