-- The dispatcher hashed the full clean text of every stale candidate (~2 700) on every call
-- before picking the newest few; under runner load this alone exceeded the 8 s API timeout.
-- Now it locks the newest 2×limit candidates first and verifies the live-text hash only on
-- those. Eligibility, actions, ceilings, tick and serialization unchanged.
DO $mig$
DECLARE d text; a text; b text;
BEGIN
  d := pg_get_functiondef('public.dispatch_stale_derivations_v1(integer,boolean)'::regprocedure);
  a := '         AND e.clean_text_status = ''done''
         AND public.clean_text_content_hash(c.cleaned_text) = d.clean_hash
       ORDER BY e.published_at DESC NULLS LAST
       LIMIT v_lim
       FOR UPDATE OF d SKIP LOCKED) s;';
  b := '         AND e.clean_text_status = ''done''
       ORDER BY e.published_at DESC NULLS LAST
       LIMIT v_lim * 2
       FOR UPDATE OF d SKIP LOCKED) s
   WHERE public.clean_text_content_hash(s.cleaned_text) = s.clean_hash
   ORDER BY s.published_at DESC NULLS LAST
   LIMIT v_lim;';
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'selection block not found'; END IF;
  d := replace(d, a, b);
  a := '             length(btrim(coalesce(c.cleaned_text, ''''))) AS clen';
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'clen column not found'; END IF;
  d := replace(d, a, a || ', c.cleaned_text');
  EXECUTE d;
END $mig$;