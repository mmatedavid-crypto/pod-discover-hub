-- Revert 0134: iterative HNSW scanning made several recommendation lookups exceed the 8s
-- statement timeout. Restore the previous function bodies exactly.
DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.similar_episodes(uuid,integer)'::regprocedure);
  d := replace(d, E'  PERFORM set_config(''hnsw.iterative_scan'', ''relaxed_order'', true);\n  PERFORM set_config(''hnsw.ef_search'', ''100'', true);\n', '');
  IF position('hnsw.iterative_scan' in d) > 0 THEN RAISE EXCEPTION 'similar_episodes revert failed'; END IF;
  EXECUTE d;

  d := pg_get_functiondef('public.get_related_episodes_by_embedding(uuid,integer,boolean)'::regprocedure);
  d := replace(d, E'  PERFORM set_config(''hnsw.iterative_scan'', ''relaxed_order'', true);\n  PERFORM set_config(''hnsw.ef_search'', ''100'', true);\n', '');
  d := replace(d, E' AND (p_downweight_same_podcast=false OR ee.podcast_id<>COALESCE(src_podcast_id,''00000000-0000-0000-0000-000000000000''::uuid))', '');
  d := replace(d, E' AND (p_downweight_same_podcast=false OR ec.podcast_id<>COALESCE(src_podcast_id,''00000000-0000-0000-0000-000000000000''::uuid))', '');
  IF position('hnsw.iterative_scan' in d) > 0 OR position('ee.podcast_id<>COALESCE(src_podcast_id' in d) > 0 THEN
    RAISE EXCEPTION 'get_related revert failed';
  END IF;
  EXECUTE d;
END
$do$;