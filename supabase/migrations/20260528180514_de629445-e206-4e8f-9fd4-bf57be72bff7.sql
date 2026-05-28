CREATE OR REPLACE FUNCTION public.smart_player_discover(p_episode_id uuid, p_limit integer DEFAULT 6)
 RETURNS TABLE(match_kind text, episode_id uuid, podcast_id uuid, title text, display_title text, slug text, image_url text, audio_url text, podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text, published_at timestamp with time zone, similarity double precision, best_chunk_idx integer, best_char_start integer, snippet text, seek_seconds integer, shared_persons text[], shared_orgs text[], shared_topics text[], why_label text, sort_score double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  src_podcast_id uuid;
  src_topics     text[];
  src_person_ids uuid[];
  src_org_ids    uuid[];
BEGIN
  -- Source episode + canonical entity ids (identity-resolved, not name strings)
  SELECT e.podcast_id,
         COALESCE(e.topics, ARRAY[]::text[])
    INTO src_podcast_id, src_topics
  FROM public.episodes e
  WHERE e.id = p_episode_id;

  IF src_podcast_id IS NULL THEN
    RETURN;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT pem.person_id), ARRAY[]::uuid[])
    INTO src_person_ids
  FROM public.person_episode_mentions pem
  WHERE pem.episode_id = p_episode_id
    AND pem.relevance_status = 'accepted';

  SELECT COALESCE(array_agg(DISTINCT eom.organization_id), ARRAY[]::uuid[])
    INTO src_org_ids
  FROM public.episode_organization_map eom
  WHERE eom.episode_id = p_episode_id;

  RETURN QUERY
  WITH
  -- 1) source chunks
  src_chunks AS (
    SELECT ec.chunk_idx, ec.char_start, ec.embedding, length(ec.content) AS clen
    FROM public.episode_chunks ec
    WHERE ec.episode_id = p_episode_id
    ORDER BY clen DESC
    LIMIT 6
  ),
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
      chunk_idx, char_start, content, sim
    FROM chunk_candidates
    ORDER BY cand_ep, sim DESC
  ),
  vec_neighbors AS (
    SELECT se.episode_id, se.podcast_id, se.similarity
    FROM public.similar_episodes(p_episode_id, 25) se
    WHERE se.podcast_id <> src_podcast_id
  ),

  -- ENTITY OVERLAP — canonical IDs, not name strings
  -- Cross-podcast episodes sharing person_id or organization_id, plus topic-text overlap
  person_hits AS (
    SELECT pem.episode_id, pem.podcast_id, pem.person_id
    FROM public.person_episode_mentions pem
    WHERE pem.relevance_status = 'accepted'
      AND pem.person_id = ANY(src_person_ids)
      AND pem.podcast_id <> src_podcast_id
      AND pem.episode_id <> p_episode_id
  ),
  org_hits AS (
    SELECT eom.episode_id, eom.podcast_id, eom.organization_id
    FROM public.episode_organization_map eom
    WHERE eom.organization_id = ANY(src_org_ids)
      AND eom.podcast_id <> src_podcast_id
      AND eom.episode_id <> p_episode_id
  ),
  topic_hits AS (
    SELECT
      e.id AS episode_id,
      e.podcast_id,
      ARRAY(SELECT unnest(COALESCE(e.topics, ARRAY[]::text[])) INTERSECT SELECT unnest(src_topics)) AS s_topics
    FROM public.episodes e
    WHERE src_topics <> ARRAY[]::text[]
      AND e.podcast_id <> src_podcast_id
      AND e.id <> p_episode_id
      AND e.topics && src_topics
    LIMIT 400
  ),
  ent_candidates AS (
    SELECT episode_id, podcast_id FROM person_hits
    UNION
    SELECT episode_id, podcast_id FROM org_hits
    UNION
    SELECT episode_id, podcast_id FROM topic_hits WHERE cardinality(s_topics) > 0
  ),
  ent_aggregated AS (
    SELECT
      ec.episode_id,
      ec.podcast_id,
      COALESCE(
        (SELECT array_agg(DISTINCT p.name) FROM public.people p
          WHERE p.id IN (SELECT person_id FROM person_hits ph WHERE ph.episode_id = ec.episode_id)),
        ARRAY[]::text[]
      ) AS s_people,
      COALESCE(
        (SELECT array_agg(DISTINCT o.name) FROM public.organizations o
          WHERE o.id IN (SELECT organization_id FROM org_hits oh WHERE oh.episode_id = ec.episode_id)),
        ARRAY[]::text[]
      ) AS s_orgs,
      COALESCE(
        (SELECT th.s_topics FROM topic_hits th WHERE th.episode_id = ec.episode_id LIMIT 1),
        ARRAY[]::text[]
      ) AS s_topics
    FROM ent_candidates ec
  ),
  ent_scored AS (
    SELECT
      ea.episode_id, ea.podcast_id, ea.s_people, ea.s_orgs, ea.s_topics,
      (cardinality(ea.s_people) * 3 + cardinality(ea.s_orgs) * 2 + cardinality(ea.s_topics))::double precision AS sc
    FROM ent_aggregated ea
    WHERE cardinality(ea.s_people) + cardinality(ea.s_orgs) + cardinality(ea.s_topics) > 0
  ),

  chunk_rail AS (
    SELECT
      'chunk_moment'::text AS match_kind,
      cb.episode_id, cb.podcast_id,
      cb.chunk_idx AS best_chunk_idx,
      cb.char_start AS best_char_start,
      LEFT(regexp_replace(cb.content, E'\\s+', ' ', 'g'), 180) AS snippet,
      GREATEST(0, FLOOR(cb.char_start::numeric / 15))::int AS seek_seconds,
      cb.sim AS similarity,
      ARRAY[]::text[] AS s_people, ARRAY[]::text[] AS s_orgs, ARRAY[]::text[] AS s_topics,
      cb.sim AS sort_score
    FROM chunk_best cb
    WHERE cb.sim >= 0.55
  ),
  ent_rail AS (
    SELECT
      'entity_overlap'::text AS match_kind,
      es.episode_id, es.podcast_id,
      NULL::int, NULL::int, NULL::text, NULL::int, NULL::double precision,
      es.s_people, es.s_orgs, es.s_topics,
      es.sc AS sort_score
    FROM ent_scored es
  ),
  vec_rail AS (
    SELECT
      'vector_neighbor'::text AS match_kind,
      vn.episode_id, vn.podcast_id,
      NULL::int, NULL::int, NULL::text, NULL::int,
      vn.similarity,
      ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[],
      vn.similarity AS sort_score
    FROM vec_neighbors vn
  ),
  unioned AS (
    SELECT * FROM chunk_rail
    UNION ALL SELECT * FROM ent_rail
    UNION ALL SELECT * FROM vec_rail
  ),
  ranked AS (
    SELECT u.*,
      ROW_NUMBER() OVER (PARTITION BY u.match_kind, u.podcast_id ORDER BY u.sort_score DESC) AS pod_rn,
      ROW_NUMBER() OVER (PARTITION BY u.match_kind ORDER BY u.sort_score DESC) AS kind_rn
    FROM unioned u
  )
  SELECT
    r.match_kind, r.episode_id, r.podcast_id,
    e.title, e.display_title, e.slug, e.image_url, e.audio_url,
    p.slug AS podcast_slug, p.title AS podcast_title, p.display_title AS podcast_display_title, p.image_url AS podcast_image_url,
    e.published_at,
    r.similarity, r.best_chunk_idx, r.best_char_start, r.snippet, r.seek_seconds,
    r.s_people AS shared_persons, r.s_orgs AS shared_orgs, r.s_topics AS shared_topics,
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