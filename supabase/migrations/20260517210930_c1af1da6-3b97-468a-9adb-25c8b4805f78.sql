CREATE OR REPLACE FUNCTION public.recompute_mood_recommended_counts()
RETURNS TABLE(mood_slug text, count integer, weak boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m record;
  c integer;
BEGIN
  FOR m IN SELECT slug FROM mood_collections WHERE active = true LOOP
    BEGIN
      SELECT COUNT(*) INTO c
      FROM get_mood_episode_recommendations(m.slug, 30, ARRAY[]::uuid[]);
    EXCEPTION WHEN OTHERS THEN
      c := 0;
    END;
    UPDATE mood_collections
      SET recommended_episode_count = COALESCE(c, 0), updated_at = now()
      WHERE slug = m.slug;
    mood_slug := m.slug;
    count := COALESCE(c, 0);
    weak := COALESCE(c, 0) < 6;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_mood_recommended_counts() FROM public;
GRANT EXECUTE ON FUNCTION public.recompute_mood_recommended_counts() TO service_role;