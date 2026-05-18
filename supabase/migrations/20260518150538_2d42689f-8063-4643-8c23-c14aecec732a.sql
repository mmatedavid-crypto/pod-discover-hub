
-- 1) Add foreign keys so PostgREST !inner embeds resolve in topic-judge-runner
ALTER TABLE public.episode_topic_relevance_reviews
  ADD CONSTRAINT etrr_episode_fk FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE,
  ADD CONSTRAINT etrr_topic_fk   FOREIGN KEY (topic_id)   REFERENCES public.topics(id)   ON DELETE CASCADE;

ALTER TABLE public.episode_category_overrides
  ADD CONSTRAINT eco_episode_fk  FOREIGN KEY (episode_id) REFERENCES public.episodes(id) ON DELETE CASCADE,
  ADD CONSTRAINT eco_category_fk FOREIGN KEY (category_slug) REFERENCES public.categories(slug) ON DELETE CASCADE;

-- 2) Vector match RPC for topic candidate generation (HU-gated)
CREATE OR REPLACE FUNCTION public.match_hu_episodes_by_embedding(
  query_embedding vector(768),
  match_count integer DEFAULT 200,
  min_similarity double precision DEFAULT 0.6
)
RETURNS TABLE(episode_id uuid, podcast_id uuid, similarity double precision)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT ee.episode_id, ee.podcast_id,
         1 - (ee.embedding <=> query_embedding) AS similarity
  FROM episode_embeddings ee
  JOIN podcasts p ON p.id = ee.podcast_id
  WHERE p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
    AND (1 - (ee.embedding <=> query_embedding)) >= min_similarity
  ORDER BY ee.embedding <=> query_embedding
  LIMIT match_count;
$$;
