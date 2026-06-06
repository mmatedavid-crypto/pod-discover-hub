GRANT EXECUTE ON FUNCTION public.get_related_episodes_by_embedding(uuid, integer, boolean) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.similar_episodes(uuid, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.smart_player_discover(uuid, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_similar_podcasts_by_embedding(uuid, integer) TO anon, authenticated;