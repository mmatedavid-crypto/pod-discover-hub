-- Isolated shadow jobs: no references in inputs, no public-data apply path.
CREATE TABLE public.person_blind_benchmark_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), repair_run_id uuid NOT NULL REFERENCES person_identity_repair_runs(id),
 status text NOT NULL DEFAULT 'prepared' CHECK(status IN('prepared','uploading','submitting','submitted','ingested','aborted')),
 lease_token uuid, lease_until timestamptz, openai_batch_id text, openai_input_file_id text,
 reserved_cost_usd numeric NOT NULL DEFAULT 0 CHECK(reserved_cost_usd>=0),
 actual_cost_usd numeric NOT NULL DEFAULT 0 CHECK(actual_cost_usd>=0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.person_blind_benchmark_items (
 job_id uuid NOT NULL REFERENCES person_blind_benchmark_jobs(id), episode_id uuid NOT NULL,
 input jsonb NOT NULL, status text NOT NULL DEFAULT 'prepared' CHECK(status IN('prepared','evaluated','error')),
 raw_result jsonb, validated_result jsonb, error text, cost_usd numeric NOT NULL DEFAULT 0 CHECK(cost_usd>=0),
 PRIMARY KEY(job_id,episode_id)
);
ALTER TABLE public.person_blind_benchmark_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.person_blind_benchmark_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.person_blind_benchmark_jobs,public.person_blind_benchmark_items FROM anon,authenticated;
GRANT ALL ON public.person_blind_benchmark_jobs,public.person_blind_benchmark_items TO service_role;
CREATE TRIGGER person_blind_benchmark_budget BEFORE INSERT OR UPDATE ON public.person_blind_benchmark_jobs
 FOR EACH ROW EXECUTE FUNCTION public.external_ai_budget_job_sync('person_blind_benchmark','evidence_pilot');

CREATE FUNCTION public.person_blind_benchmark_step_v1(p_action text,p_token uuid DEFAULT NULL,p_payload jsonb DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET statement_timeout='15s' AS $$
DECLARE j person_blind_benchmark_jobs; it person_blind_benchmark_items; t uuid; amount numeric;
BEGIN
 -- Releasing only an owned lease remains possible during an emergency pause.
 IF p_action='release' THEN
  UPDATE person_blind_benchmark_jobs SET lease_token=NULL,lease_until=NULL WHERE lease_token=p_token;
  RETURN jsonb_build_object('released',true);
 END IF;
 IF NOT episode_enrichment_allowed_v1(false) OR NOT EXISTS(SELECT 1 FROM app_settings WHERE key='person_blind_benchmark_controls' AND value->>'enabled'='true') THEN
  IF p_action='claim' THEN RETURN jsonb_build_object('skipped','benchmark_disabled'); END IF;
  RAISE EXCEPTION 'benchmark_disabled';
 END IF;
 IF p_action='claim' THEN
  SELECT * INTO j FROM person_blind_benchmark_jobs WHERE status NOT IN('ingested','aborted') AND (lease_until IS NULL OR lease_until<=now()) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF j.id IS NULL THEN RETURN jsonb_build_object('skipped','no_benchmark_job'); END IF;
  IF (SELECT count(*) FROM person_blind_benchmark_items WHERE job_id=j.id) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'benchmark_size'; END IF;
  t:=gen_random_uuid(); UPDATE person_blind_benchmark_jobs SET lease_token=t,lease_until=now()+interval '5 minutes' WHERE id=j.id RETURNING * INTO j;
  RETURN to_jsonb(j)||jsonb_build_object('items',(SELECT jsonb_agg(jsonb_build_object('episode_id',episode_id,'input',input,'status',status) ORDER BY episode_id) FROM person_blind_benchmark_items WHERE job_id=j.id));
 END IF;
 SELECT * INTO j FROM person_blind_benchmark_jobs WHERE lease_token=p_token AND lease_until>now() FOR UPDATE;
 IF j.id IS NULL THEN RAISE EXCEPTION 'benchmark_lease'; END IF;
 IF p_action='guard' THEN RETURN jsonb_build_object('allowed',true); END IF;
 INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) VALUES(j.repair_run_id,'person_blind_benchmark_jobs',to_jsonb(j));
 IF p_action='reserve' THEN
  IF j.status NOT IN('prepared','uploading') OR j.openai_batch_id IS NOT NULL THEN RAISE EXCEPTION 'benchmark_state'; END IF;
  amount:=(p_payload->>'amount')::numeric;
  IF amount IS NULL OR amount<=0 OR amount>0.10 OR amount::text IN('NaN','Infinity') THEN RAISE EXCEPTION 'benchmark_amount'; END IF;
  UPDATE person_blind_benchmark_jobs SET status='uploading',reserved_cost_usd=amount WHERE id=j.id;
 ELSIF p_action='submitting' THEN
  IF j.status<>'uploading' OR j.reserved_cost_usd<=0 OR coalesce(p_payload->>'file_id','')='' THEN RAISE EXCEPTION 'benchmark_state'; END IF;
  UPDATE person_blind_benchmark_jobs SET status='submitting',openai_input_file_id=p_payload->>'file_id' WHERE id=j.id;
 ELSIF p_action='submitted' THEN
  IF j.status<>'submitting' OR coalesce(p_payload->>'batch_id','')='' THEN RAISE EXCEPTION 'benchmark_state'; END IF;
  UPDATE person_blind_benchmark_jobs SET status='submitted',openai_batch_id=p_payload->>'batch_id' WHERE id=j.id;
 ELSIF p_action='result' THEN
  IF j.status<>'submitted' THEN RAISE EXCEPTION 'benchmark_state'; END IF;
  SELECT * INTO it FROM person_blind_benchmark_items WHERE job_id=j.id AND episode_id=(p_payload->>'episode_id')::uuid FOR UPDATE;
  IF it.episode_id IS NULL THEN RAISE EXCEPTION 'benchmark_item'; END IF;
  IF it.status='prepared' THEN
   amount:=(p_payload->>'cost')::numeric;
   IF amount IS NULL OR amount<0 OR amount>j.reserved_cost_usd OR amount::text IN('NaN','Infinity') THEN RAISE EXCEPTION 'benchmark_cost'; END IF;
   INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) VALUES(j.repair_run_id,'person_blind_benchmark_items',to_jsonb(it));
   UPDATE person_blind_benchmark_items SET raw_result=p_payload->'raw',validated_result=p_payload->'validated',error=p_payload->>'error',cost_usd=amount,status=CASE WHEN p_payload->>'error' IS NULL THEN 'evaluated' ELSE 'error' END WHERE job_id=j.id AND episode_id=it.episode_id;
  END IF;
 ELSIF p_action='finish' THEN
  IF j.status<>'submitted' OR coalesce(p_payload->>'batch_status','') NOT IN('completed','expired','cancelled','failed') THEN RAISE EXCEPTION 'benchmark_state'; END IF;
  INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) SELECT j.repair_run_id,'person_blind_benchmark_items',to_jsonb(i) FROM person_blind_benchmark_items i WHERE job_id=j.id AND status='prepared';
  UPDATE person_blind_benchmark_items SET status='error',error='terminal_batch_without_output' WHERE job_id=j.id AND status='prepared';
  SELECT sum(cost_usd) INTO amount FROM person_blind_benchmark_items WHERE job_id=j.id;
  UPDATE person_blind_benchmark_jobs SET status='ingested',actual_cost_usd=coalesce(amount,0) WHERE id=j.id;
 ELSE RAISE EXCEPTION 'benchmark_action'; END IF;
 RETURN jsonb_build_object('ok',true,'job_id',j.id,'action',p_action);
END $$;
REVOKE ALL ON FUNCTION public.person_blind_benchmark_step_v1(text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.person_blind_benchmark_step_v1(text,uuid,jsonb) TO service_role;
