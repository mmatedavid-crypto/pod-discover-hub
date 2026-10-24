-- smart_player_discover always failed with "column reference episode_id is ambiguous"
-- (OUT parameter vs CTE column), so the player silently fell back to unrelated recent
-- episodes. Resolve unqualified names to columns; logic otherwise unchanged.
DO $mig$
DECLARE d text; n int;
BEGIN
  d := pg_get_functiondef('public.smart_player_discover(uuid,integer)'::regprocedure);
  IF position('#variable_conflict' in d) = 0 THEN
    n := (length(d) - length(replace(d, E'AS $function$\nDECLARE', ''))) / length(E'AS $function$\nDECLARE');
    IF n <> 1 THEN RAISE EXCEPTION 'smart_player_discover header not found (%).', n; END IF;
    d := replace(d, E'AS $function$\nDECLARE', E'AS $function$\n#variable_conflict use_column\nDECLARE');
    EXECUTE d;
  END IF;
END $mig$;