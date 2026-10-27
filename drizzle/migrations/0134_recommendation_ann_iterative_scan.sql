-- Recommendation lookups exclude the seed's own show inside the nearest-neighbour query. With the
-- default HNSW scan only ~40 neighbours are visited before that filter, so shows with many
-- near-identical episodes (bedtime stories, sleep sounds, daily radio segments) got zero
-- recommendations. Iterative scanning (pgvector 0.8) keeps searching until the LIMIT is met.
-- Settings are transaction-local, so they never leak into other queries.
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.similar_episodes(uuid,integer)'::regprocedure);
  d := replace(d, E'BEGIN\n  SELECT ee.embedding, ee.podcast_id INTO src_embedding',
    E'BEGIN\n  PERFORM set_config(''hnsw.iterative_scan'', ''relaxed_order'', true);\n  PERFORM set_config(''hnsw.ef_search'', ''100'', true);\n  SELECT ee.embedding, ee.podcast_id INTO src_embedding');
  IF position('hnsw.iterative_scan' in d) = 0 THEN RAISE EXCEPTION 'similar_episodes patch failed'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.get_related_episodes_by_embedding(uuid,integer,boolean)'::regprocedure);
  d := replace(d, E'BEGIN\n  SELECT ee.embedding, ee.podcast_id INTO src_embedding',
    E'BEGIN\n  PERFORM set_config(''hnsw.iterative_scan'', ''relaxed_order'', true);\n  PERFORM set_config(''hnsw.ef_search'', ''100'', true);\n  SELECT ee.embedding, ee.podcast_id INTO src_embedding');
  IF position('hnsw.iterative_scan' in d) = 0 THEN RAISE EXCEPTION 'get_related patch failed'; END IF;
  -- The episode-page lookup must also leave the seed's own show out of the neighbour query,
  -- otherwise most of its 260 candidates are that show's own episodes and get discarded later.
  d := replace(d, E'FROM episode_embeddings ee WHERE ee.episode_id<>p_episode_id ORDER BY',
    E'FROM episode_embeddings ee WHERE ee.episode_id<>p_episode_id AND (p_downweight_same_podcast=false OR ee.podcast_id<>COALESCE(src_podcast_id,''00000000-0000-0000-0000-000000000000''::uuid)) ORDER BY');
  d := replace(d, E'FROM episode_chunks ec WHERE ec.episode_id<>p_episode_id ORDER BY',
    E'FROM episode_chunks ec WHERE ec.episode_id<>p_episode_id AND (p_downweight_same_podcast=false OR ec.podcast_id<>COALESCE(src_podcast_id,''00000000-0000-0000-0000-000000000000''::uuid)) ORDER BY');
  IF position('ee.podcast_id<>COALESCE(src_podcast_id' in d) = 0 OR position('ec.podcast_id<>COALESCE(src_podcast_id' in d) = 0 THEN
    RAISE EXCEPTION 'get_related own-show filter patch failed';
  END IF;
  EXECUTE d;
END
$do$;