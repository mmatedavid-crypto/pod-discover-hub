CREATE OR REPLACE FUNCTION public.merge_ai_spend(p_day date, p_delta jsonb, p_total_amount numeric DEFAULT 0, p_calls integer DEFAULT 0)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
  v numeric;
  merged jsonb := '{}'::jsonb;
BEGIN
  INSERT INTO public.ai_spend_daily (day, spend_usd, calls, by_kind, updated_at)
  VALUES (p_day, COALESCE(p_total_amount,0), COALESCE(p_calls,0), '{}'::jsonb, now())
  ON CONFLICT (day) DO NOTHING;

  -- Lock the row to serialize the merge
  PERFORM 1 FROM public.ai_spend_daily WHERE day = p_day FOR UPDATE;

  SELECT by_kind INTO merged FROM public.ai_spend_daily WHERE day = p_day;
  IF merged IS NULL THEN merged := '{}'::jsonb; END IF;

  FOR k, v IN
    SELECT key, NULLIF(value::text,'null')::numeric FROM jsonb_each_text(p_delta)
  LOOP
    merged := merged || jsonb_build_object(k, COALESCE((merged ->> k)::numeric, 0) + COALESCE(v, 0));
  END LOOP;

  UPDATE public.ai_spend_daily
  SET by_kind = merged,
      spend_usd = spend_usd + COALESCE(p_total_amount, 0),
      calls = calls + COALESCE(p_calls, 0),
      updated_at = now()
  WHERE day = p_day;
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_ai_spend(date, jsonb, numeric, integer) TO anon, authenticated, service_role;