CREATE OR REPLACE FUNCTION public.add_ai_spend(p_day date, p_kind text, p_amount numeric, p_calls integer DEFAULT 1)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.ai_spend_daily (day, spend_usd, calls, by_kind, updated_at)
  VALUES (p_day, COALESCE(p_amount,0), COALESCE(p_calls,0),
          jsonb_build_object(p_kind, COALESCE(p_amount,0)), now())
  ON CONFLICT (day) DO UPDATE
  SET spend_usd = public.ai_spend_daily.spend_usd + COALESCE(p_amount,0),
      calls     = public.ai_spend_daily.calls + COALESCE(p_calls,0),
      by_kind   = public.ai_spend_daily.by_kind
                  || jsonb_build_object(
                       p_kind,
                       COALESCE((public.ai_spend_daily.by_kind ->> p_kind)::numeric, 0) + COALESCE(p_amount,0)
                     ),
      updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.add_ai_spend(date, text, numeric, integer) TO anon, authenticated, service_role;