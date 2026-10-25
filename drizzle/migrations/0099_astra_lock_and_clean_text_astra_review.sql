-- 1) Scheduler-only start for paid Astra runs: per-job token readable only by the service role / cron.
CREATE TABLE IF NOT EXISTS public.internal_job_tokens (
  job text PRIMARY KEY,
  token text NOT NULL DEFAULT (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.internal_job_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.internal_job_tokens TO service_role;
ALTER TABLE public.internal_job_tokens ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    EXECUTE 'REVOKE ALL ON public.internal_job_tokens FROM readonly_codex';
  END IF;
END $$;
INSERT INTO public.internal_job_tokens (job) VALUES ('entity-astra-audit') ON CONFLICT (job) DO NOTHING;

SELECT cron.alter_job(
  job_id := (SELECT jobid FROM cron.job WHERE jobname = 'entity-astra-audit-hourly'),
  command := $cmd$SELECT net.http_post(
  url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/entity-astra-audit',
  headers := jsonb_build_object('Content-Type','application/json','x-internal-token',(SELECT token FROM public.internal_job_tokens WHERE job = 'entity-astra-audit')),
  body := '{"trigger":"cron"}'::jsonb
);$cmd$
);

-- 2) Advisory Astra review of clean-text rows waiting for a human decision (no text writes).
CREATE TABLE IF NOT EXISTS public.clean_text_astra_review_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model text NOT NULL,
  prompt_version text NOT NULL,
  item_count int NOT NULL,
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','completed','failed')),
  reserved_usd numeric NOT NULL CHECK (reserved_usd >= 0),
  actual_usd numeric,
  input_tokens int,
  output_tokens int,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.clean_text_astra_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL,
  input_hash text NOT NULL,
  prompt_version text NOT NULL,
  repair_kind text,
  queue_status text,
  had_proposal boolean NOT NULL DEFAULT false,
  call_id uuid REFERENCES public.clean_text_astra_review_calls(id),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','completed','failed')),
  recommendation text CHECK (recommendation IN ('use_proposed','keep_current','owner_decides')),
  confidence numeric,
  missing_facts jsonb,
  reason text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episode_id, input_hash, prompt_version)
);
REVOKE ALL ON public.clean_text_astra_review_calls, public.clean_text_astra_reviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.clean_text_astra_review_calls, public.clean_text_astra_reviews TO service_role;
ALTER TABLE public.clean_text_astra_review_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clean_text_astra_reviews ENABLE ROW LEVEL SECURITY;

INSERT INTO public.app_settings (key, value) VALUES ('clean_text_astra_review_controls', jsonb_build_object(
  'enabled', true, 'model', 'openai/gpt-6-astra', 'total_cap_usd', 8, 'daily_cap_usd', 5,
  'note', 'Tulajdonos 2026-10-25: a kézi átnézésre váró tisztított leírásokat előbb az Astra nézze át; csak javaslat, szöveget nem ír.'
)) ON CONFLICT (key) DO NOTHING;

-- Atomic reservation: serialized, checks owner caps before any paid call.
CREATE OR REPLACE FUNCTION public.reserve_clean_text_astra_review_v1(p_model text, p_prompt_version text, p_reserve_usd numeric, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c jsonb; total numeric; today numeric; call_id uuid; it jsonb; reserved jsonb := '[]'::jsonb; skipped int := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('clean_text_astra_review'));
  SELECT value INTO c FROM app_settings WHERE key = 'clean_text_astra_review_controls';
  IF c IS NULL OR (c->>'enabled')::boolean IS DISTINCT FROM true THEN RETURN jsonb_build_object('ok', false, 'reason', 'disabled'); END IF;
  IF p_reserve_usd IS NULL OR p_reserve_usd <= 0 THEN RETURN jsonb_build_object('ok', false, 'reason', 'bad_reserve'); END IF;
  SELECT coalesce(sum(CASE WHEN status = 'reserved' THEN reserved_usd ELSE coalesce(actual_usd, reserved_usd) END), 0) INTO total FROM clean_text_astra_review_calls;
  SELECT coalesce(sum(CASE WHEN status = 'reserved' THEN reserved_usd ELSE coalesce(actual_usd, reserved_usd) END), 0) INTO today
    FROM clean_text_astra_review_calls WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  IF total + p_reserve_usd > coalesce((c->>'total_cap_usd')::numeric, 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'total_cap', 'spent_usd', total);
  END IF;
  IF today + p_reserve_usd > coalesce((c->>'daily_cap_usd')::numeric, 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'daily_cap', 'spent_today_usd', today);
  END IF;
  INSERT INTO clean_text_astra_review_calls (model, prompt_version, item_count, reserved_usd)
    VALUES (p_model, p_prompt_version, jsonb_array_length(p_items), p_reserve_usd) RETURNING id INTO call_id;
  FOR it IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    IF EXISTS (SELECT 1 FROM clean_text_astra_reviews r WHERE r.episode_id = (it->>'episode_id')::uuid AND r.input_hash = it->>'input_hash'
               AND r.prompt_version = p_prompt_version AND r.status IN ('completed','reserved')) THEN
      skipped := skipped + 1; CONTINUE;
    END IF;
    INSERT INTO clean_text_astra_reviews (episode_id, input_hash, prompt_version, repair_kind, queue_status, had_proposal, call_id, status)
      VALUES ((it->>'episode_id')::uuid, it->>'input_hash', p_prompt_version, it->>'repair_kind', it->>'queue_status', coalesce((it->>'had_proposal')::boolean, false), call_id, 'reserved')
      ON CONFLICT (episode_id, input_hash, prompt_version) DO UPDATE
        SET call_id = EXCLUDED.call_id, status = 'reserved', error = NULL, updated_at = now();
    reserved := reserved || jsonb_build_array(it->>'episode_id');
  END LOOP;
  IF jsonb_array_length(reserved) = 0 THEN
    DELETE FROM clean_text_astra_review_calls WHERE id = call_id;
    RETURN jsonb_build_object('ok', true, 'call_id', NULL, 'reserved', reserved, 'skipped_existing', skipped);
  END IF;
  RETURN jsonb_build_object('ok', true, 'call_id', call_id, 'reserved', reserved, 'skipped_existing', skipped);
END $$;

CREATE OR REPLACE FUNCTION public.settle_clean_text_astra_review_v1(p_call_id uuid, p_status text, p_actual_usd numeric, p_input_tokens int, p_output_tokens int, p_error text, p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE it jsonb; n int := 0;
BEGIN
  UPDATE clean_text_astra_review_calls SET status = p_status, actual_usd = p_actual_usd, input_tokens = p_input_tokens,
    output_tokens = p_output_tokens, error = p_error, settled_at = now() WHERE id = p_call_id AND status = 'reserved';
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_reserved'); END IF;
  FOR it IN SELECT * FROM jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) LOOP
    UPDATE clean_text_astra_reviews SET status = 'completed', recommendation = it->>'recommendation',
      confidence = (it->>'confidence')::numeric, missing_facts = it->'missing_facts', reason = left(it->>'reason', 500), updated_at = now()
      WHERE call_id = p_call_id AND episode_id = (it->>'episode_id')::uuid AND status = 'reserved';
    n := n + 1;
  END LOOP;
  UPDATE clean_text_astra_reviews SET status = 'failed', error = coalesce(p_error, 'missing_from_output'), updated_at = now()
    WHERE call_id = p_call_id AND status = 'reserved';
  RETURN jsonb_build_object('ok', true, 'settled_items', n);
END $$;

REVOKE ALL ON FUNCTION public.reserve_clean_text_astra_review_v1(text, text, numeric, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_clean_text_astra_review_v1(uuid, text, numeric, int, int, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_clean_text_astra_review_v1(text, text, numeric, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_clean_text_astra_review_v1(uuid, text, numeric, int, int, text, jsonb) TO service_role;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    EXECUTE 'REVOKE ALL ON public.clean_text_astra_review_calls, public.clean_text_astra_reviews FROM readonly_codex';
    EXECUTE 'REVOKE ALL ON FUNCTION public.reserve_clean_text_astra_review_v1(text, text, numeric, jsonb) FROM readonly_codex';
    EXECUTE 'REVOKE ALL ON FUNCTION public.settle_clean_text_astra_review_v1(uuid, text, numeric, int, int, text, jsonb) FROM readonly_codex';
  END IF;
END $$;