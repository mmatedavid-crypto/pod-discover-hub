-- Helper that builds a compact halfvec index for transcript-chunk search.
CREATE OR REPLACE FUNCTION public.build_chunks_halfvec_once()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '50min'
SET maintenance_work_mem TO '512MB'
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_episode_chunks_hnsw_half') THEN
    RETURN 'already_present';
  END IF;
  CREATE INDEX idx_episode_chunks_hnsw_half
    ON public.episode_chunks
    USING hnsw ((embedding::halfvec(768)) halfvec_cosine_ops);
  RETURN 'built';
END;
$$;

REVOKE ALL ON FUNCTION public.build_chunks_halfvec_once() FROM public;
GRANT EXECUTE ON FUNCTION public.build_chunks_halfvec_once() TO service_role;
