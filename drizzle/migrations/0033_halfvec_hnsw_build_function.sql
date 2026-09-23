-- Helper that builds the smaller semantic-search index with a long timeout.
CREATE OR REPLACE FUNCTION public.build_halfvec_hnsw_once()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '50min'
SET maintenance_work_mem TO '512MB'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_episode_embeddings_hnsw_half') THEN
    RETURN 'already_present';
  END IF;

  CREATE INDEX idx_episode_embeddings_hnsw_half
    ON public.episode_embeddings
    USING hnsw ((embedding::halfvec(768)) halfvec_cosine_ops);

  RETURN 'built';
END;
$$;

REVOKE ALL ON FUNCTION public.build_halfvec_hnsw_once() FROM public;
GRANT EXECUTE ON FUNCTION public.build_halfvec_hnsw_once() TO service_role;
