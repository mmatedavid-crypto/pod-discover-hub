DO $mig$
DECLARE f text; d text;
BEGIN
  FOREACH f IN ARRAY ARRAY['similar_episodes','get_related_episodes_by_embedding','smart_player_discover','match_hu_episodes_by_embedding','match_user_episodes','match_episodes_by_taste_vector','match_episodes_by_centroid','get_mood_episode_recommendations'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=f;
    -- chunk candidates: nearest-neighbour search first, then best chunk per episode
    d := replace(d, 'chunk_cand AS (SELECT DISTINCT ON (ec.episode_id) ec.episode_id AS eid, ec.podcast_id AS pid, (1-(ec.embedding<=>src_embedding))::float AS sim',
                    'chunk_cand AS (SELECT DISTINCT ON (x.eid) x.eid, x.pid, x.sim FROM (SELECT ec.episode_id AS eid, ec.podcast_id AS pid, (1-(ec.embedding::halfvec(768)<=>src_embedding::halfvec(768)))::float AS sim');
    d := replace(d, 'ORDER BY ec.episode_id, ec.embedding<=>src_embedding LIMIT 260)',
                    'ORDER BY ec.embedding::halfvec(768)<=>src_embedding::halfvec(768) LIMIT 800) x ORDER BY x.eid, x.sim DESC)');
    d := regexp_replace(d, '\m(ee|ec2|ec)\.embedding\s*<=>\s*(\(SELECT [^)]*\)|[A-Za-z_][A-Za-z0-9_.]*)', '(\1.embedding::halfvec(768) <=> (\2)::halfvec(768))', 'g');
    EXECUTE d;
  END LOOP;
END $mig$;

CREATE INDEX IF NOT EXISTS idx_episodes_topic_pending_done ON public.episodes (podcast_id) WHERE topic_extraction_status='pending' AND clean_text_status='done';
CREATE INDEX IF NOT EXISTS idx_episodes_entity_pending ON public.episodes (ai_entities_version) WHERE clean_text_status='done' AND ai_summary IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_episodes_org_cursor ON public.episodes (updated_at) WHERE ai_entities_version >= 3 AND organizations IS NOT NULL;
DROP INDEX IF EXISTS public.idx_episode_embeddings_hnsw_cos;
DROP INDEX IF EXISTS public.episode_chunks_embedding_hnsw;