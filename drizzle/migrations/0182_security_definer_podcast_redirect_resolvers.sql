ALTER FUNCTION public.resolve_podcast_redirect_v1(TEXT, TEXT, INTEGER, INTEGER)
  SECURITY DEFINER SET search_path = public;

ALTER FUNCTION public.resolve_canonical_episode_by_id_v1(UUID)
  SECURITY DEFINER SET search_path = public;

ALTER FUNCTION public.is_publicly_visible_hu_podcast(UUID)
  SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.resolve_podcast_redirect_v1(TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_podcast_redirect_v1(TEXT, TEXT, INTEGER, INTEGER) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.resolve_canonical_episode_by_id_v1(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_canonical_episode_by_id_v1(UUID) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_publicly_visible_hu_podcast(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_publicly_visible_hu_podcast(UUID) TO anon, authenticated, service_role;