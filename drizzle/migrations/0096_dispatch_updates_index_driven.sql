-- The two set-based UPDATEs joined episodes to the freshly filled temp table without statistics,
-- so the planner could scan the whole (wide, 30-index) episodes table: ~4.5 s of a 4.8 s dispatch
-- while every measured step took ~0.3 s. Both UPDATEs are now driven by the explicit id array
-- (primary-key lookups) and the temp table is analyzed. Logic and values unchanged.
DO $mig$
DECLARE d text; a text; b text;
BEGIN
  d := pg_get_functiondef('public.dispatch_stale_derivations_v1(integer,boolean)'::regprocedure);
  a := '  IF NOT p_dry_run THEN
    UPDATE public.episodes e SET';
  b := '  ANALYZE _dispatch_act;
  v_ids := ARRAY(SELECT x.episode_id FROM _dispatch_act x);
  IF NOT p_dry_run THEN
    UPDATE public.episodes e SET';
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'update block not found'; END IF;
  d := replace(d, a, b);
  a := '     WHERE e.id = a.episode_id
       AND (a.v_topic = ''queued''';
  b := '     WHERE e.id = ANY (v_ids) AND e.id = a.episode_id
       AND (a.v_topic = ''queued''';
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'episodes where not found'; END IF;
  d := replace(d, a, b);
  a := '     WHERE d.episode_id = a.episode_id;';
  b := '     WHERE d.episode_id = ANY (v_ids) AND d.episode_id = a.episode_id;';
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'eds where not found'; END IF;
  d := replace(d, a, b);
  EXECUTE d;
END $mig$;
REVOKE ALL ON FUNCTION public.dispatch_stale_derivations_v1(integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.dispatch_stale_derivations_v1(integer, boolean) FROM readonly_codex;
GRANT EXECUTE ON FUNCTION public.dispatch_stale_derivations_v1(integer, boolean) TO service_role;