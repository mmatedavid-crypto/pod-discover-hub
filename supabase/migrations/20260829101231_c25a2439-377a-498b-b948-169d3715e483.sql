REVOKE EXECUTE ON FUNCTION public.search_episode_chunks(vector, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_episode_chunks(vector, integer, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.search_episode_chunks(vector, integer, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.search_episode_chunks(vector, integer, integer) TO service_role;