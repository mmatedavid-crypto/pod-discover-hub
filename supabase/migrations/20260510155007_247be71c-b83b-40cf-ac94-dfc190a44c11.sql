CREATE OR REPLACE FUNCTION public.purge_search_query_cache(older_than_days integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  -- Only admins (or the cron superuser context) may invoke
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  IF older_than_days < 1 THEN
    older_than_days := 30;
  END IF;

  DELETE FROM public.search_query_cache
  WHERE updated_at < now() - make_interval(days => older_than_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_search_query_cache(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.purge_search_query_cache(integer) TO authenticated, service_role;