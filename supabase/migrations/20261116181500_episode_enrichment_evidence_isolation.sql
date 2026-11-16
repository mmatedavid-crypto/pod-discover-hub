-- Keep the existing quote/identity gates; isolate only known per-item evidence failures.
-- A malformed paid response must not roll back other validated items in a <=40 chunk.
CREATE OR REPLACE FUNCTION public.apply_episode_enrichment_chunk_v1(p_job uuid,p_token uuid,p_items jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public SET statement_timeout='60s' AS $function$
DECLARE j episode_enrichment_pilot_jobs; it episode_enrichment_pilot_items; x jsonb; out_rows jsonb:='[]'; run uuid; item_error text;
BEGIN
 IF NOT episode_enrichment_allowed_v1() THEN RAISE EXCEPTION 'disabled'; END IF;
 SELECT * INTO j FROM episode_enrichment_pilot_jobs WHERE id=p_job FOR UPDATE;
 IF j.id IS NULL OR j.lease_token IS DISTINCT FROM p_token OR j.lease_until IS NULL OR j.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'job_lease'; END IF;
 IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 40 THEN RAISE EXCEPTION 'chunk_size'; END IF;
 INSERT INTO person_identity_repair_runs(version,summary) VALUES('episode-rich-v1-chunk',jsonb_build_object('job_id',p_job,'items',jsonb_array_length(p_items),'error_isolation','evidence-only-v1')) RETURNING id INTO run;
 FOR x IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  SELECT * INTO it FROM episode_enrichment_pilot_items WHERE episode_id=(x->>'episode_id')::uuid FOR UPDATE;
  IF it.episode_id IS NULL OR it.job_id IS DISTINCT FROM p_job OR it.fingerprint IS DISTINCT FROM x->>'fingerprint' THEN RAISE EXCEPTION 'chunk_item_mismatch'; END IF;
  IF it.status NOT IN('applied','stale','invalid','api_error') THEN
   IF it.status NOT IN('prepared','submitted') THEN RAISE EXCEPTION 'item_state'; END IF;
   IF x->>'cost' IS NULL OR (x->>'cost')::numeric<0 OR (x->>'cost')::numeric::text IN('NaN','Infinity') THEN RAISE EXCEPTION 'invalid_cost'; END IF;
   INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) VALUES(run,'episode_enrichment_pilot_items',to_jsonb(it));
   IF x ? 'error' THEN
    UPDATE episode_enrichment_pilot_items SET status='invalid',error=left(x->>'error',200),cost_usd=(x->>'cost')::numeric WHERE episode_id=it.episode_id;
   ELSE
    BEGIN
     PERFORM apply_episode_enrichment_item_v1(it.episode_id,it.fingerprint,x->'result',x->'errors',x->'role_items',(x->>'cost')::numeric);
    EXCEPTION WHEN raise_exception THEN
     item_error:=SQLERRM;
     -- Do not swallow lease/state/identity/budget/operational errors.
     IF item_error NOT IN('evidence_mismatch','summary_evidence_mismatch') THEN RAISE; END IF;
     -- The subtransaction has rolled back ALL item-side effects. Retain the paid
     -- proposal privately for inspection; never publish it or pay for it again.
     UPDATE episode_enrichment_pilot_items SET status='invalid',error=item_error,
      result=x->'result',validation_errors=coalesce(x->'errors','[]'::jsonb)||jsonb_build_array(item_error),
      apply_report=jsonb_build_object('status','invalid','reason',item_error,'repair_run',run,'public_writes',0),
      cost_usd=(x->>'cost')::numeric WHERE episode_id=it.episode_id;
    END;
   END IF;
  END IF;
  out_rows:=out_rows||jsonb_build_array((SELECT jsonb_build_object('episode_id',episode_id,'fingerprint',fingerprint,'status',status) FROM episode_enrichment_pilot_items WHERE episode_id=it.episode_id));
 END LOOP;
 UPDATE person_identity_repair_runs SET completed_at=now(),summary=summary||jsonb_build_object('outcomes',out_rows) WHERE id=run;
 RETURN out_rows;
END $function$;
REVOKE ALL ON FUNCTION public.apply_episode_enrichment_chunk_v1(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_episode_enrichment_chunk_v1(uuid,uuid,jsonb) TO service_role;
