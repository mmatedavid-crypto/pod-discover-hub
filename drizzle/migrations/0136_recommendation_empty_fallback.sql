-- Shows with many near-identical episodes (bedtime stories, sleep sounds, daily radio segments) got
-- zero recommendations: the default HNSW scan only reaches the seed's own show, which is excluded.
-- Only when the normal lookup returns nothing, run one bounded fallback: vectors from other shows,
-- iterative scan capped at 4,000 visited tuples, no chunk scan. Normal lookups are unchanged.
DO $do$
DECLARE
  fn text;
  d text;
  q_start int;
  q_end int;
  main_q text;
  fb_q text;
  tail_pos int;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.similar_episodes(uuid,integer)', 'public.get_related_episodes_by_embedding(uuid,integer,boolean)'] LOOP
    d := pg_get_functiondef(fn::regprocedure);
    IF position('recommendation_empty_fallback' in d) > 0 THEN CONTINUE; END IF;
    q_start := position('RETURN QUERY' in d);
    q_end := position('LIMIT GREATEST(p_limit,1);' in d);
    IF q_start = 0 OR q_end = 0 THEN RAISE EXCEPTION '% : query block not found', fn; END IF;
    main_q := substr(d, q_start, q_end - q_start + length('LIMIT GREATEST(p_limit,1);'));
    fb_q := replace(main_q, 'FROM episode_chunks ec WHERE ec.episode_id<>p_episode_id', 'FROM episode_chunks ec WHERE false AND ec.episode_id<>p_episode_id');
    IF position('ee.podcast_id<>COALESCE(src_podcast_id' in fb_q) = 0 THEN
      fb_q := replace(fb_q, 'FROM episode_embeddings ee WHERE ee.episode_id<>p_episode_id ORDER BY',
        'FROM episode_embeddings ee WHERE ee.episode_id<>p_episode_id AND ee.podcast_id<>COALESCE(src_podcast_id,''00000000-0000-0000-0000-000000000000''::uuid) ORDER BY');
    END IF;
    IF position('WHERE false AND ec.episode_id' in fb_q) = 0 OR position('ee.podcast_id<>COALESCE(src_podcast_id' in fb_q) = 0 THEN
      RAISE EXCEPTION '% : fallback rewrite failed', fn;
    END IF;
    tail_pos := q_end + length('LIMIT GREATEST(p_limit,1);');
    d := substr(d, 1, tail_pos - 1)
      || E'\n  -- recommendation_empty_fallback\n  IF NOT FOUND THEN\n'
      || E'    PERFORM set_config(''hnsw.iterative_scan'', ''relaxed_order'', true);\n'
      || E'    PERFORM set_config(''hnsw.max_scan_tuples'', ''4000'', true);\n    '
      || fb_q
      || E'\n  END IF;'
      || substr(d, tail_pos);
    EXECUTE d;
  END LOOP;
END
$do$;