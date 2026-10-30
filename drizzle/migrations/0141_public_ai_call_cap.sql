CREATE TABLE IF NOT EXISTS public.public_ai_call_budget (
  day date NOT NULL,
  kind text NOT NULL,
  calls integer NOT NULL DEFAULT 0,
  denied integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, kind)
);
GRANT ALL ON public.public_ai_call_budget TO service_role;
GRANT SELECT ON public.public_ai_call_budget TO authenticated;
ALTER TABLE public.public_ai_call_budget ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read public ai call budget" ON public.public_ai_call_budget
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('public_ai_call_caps',
  '{"search_hybrid": 3000, "search_answer": 1500, "search_suggest": 3000, "note": "Daily cap on visitor-triggered paid AI calls; over the cap visitors get the free path. Trusted agent search is exempt."}'::jsonb,
  now())
ON CONFLICT (key) DO NOTHING;

-- Atomically counts one visitor AI call for today; false when the daily cap is reached.
CREATE OR REPLACE FUNCTION public.take_public_ai_call_v1(p_kind text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap integer;
  v_ok boolean;
BEGIN
  IF p_kind IS NULL OR p_kind !~ '^[a-z_]{1,40}$' THEN
    RETURN false;
  END IF;
  SELECT NULLIF(value->>p_kind, '')::integer INTO v_cap FROM public.app_settings WHERE key = 'public_ai_call_caps';
  IF v_cap IS NULL OR v_cap <= 0 THEN
    v_cap := 0;
  END IF;
  INSERT INTO public.public_ai_call_budget AS b (day, kind, calls, denied)
  VALUES (current_date, p_kind, 0, 0)
  ON CONFLICT (day, kind) DO NOTHING;
  UPDATE public.public_ai_call_budget
     SET calls = calls + 1, updated_at = now()
   WHERE day = current_date AND kind = p_kind AND calls < v_cap
  RETURNING true INTO v_ok;
  IF v_ok IS NULL THEN
    UPDATE public.public_ai_call_budget SET denied = denied + 1, updated_at = now()
     WHERE day = current_date AND kind = p_kind;
    RETURN false;
  END IF;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.take_public_ai_call_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_public_ai_call_v1(text) TO service_role;