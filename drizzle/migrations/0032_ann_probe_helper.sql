-- Temporary diagnostic helper: measures semantic (vector) lookup latency.
CREATE OR REPLACE FUNCTION public.ann_probe(v vector, ef integer DEFAULT 40)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE n integer;
BEGIN
  PERFORM set_config('hnsw.ef_search', ef::text, true);
  SELECT count(*) INTO n FROM (
    SELECT ee.episode_id FROM public.episode_embeddings ee
    ORDER BY ee.embedding <=> v LIMIT 200
  ) x;
  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.ann_probe(vector, integer) TO anon, authenticated, service_role;
