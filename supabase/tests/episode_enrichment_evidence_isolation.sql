-- Run inside BEGIN/ROLLBACK under an owned backlog lease. No paid API calls.
DO $test$
DECLARE j uuid; tok uuid:=gen_random_uuid(); ids uuid[]; eid uuid; inp jsonb; payload jsonb:='[]'; empty_result jsonb:='{"summary":null,"topics":[],"questions":[],"entities":[],"format":null,"people":[]}'; r jsonb; before_bad jsonb; caught boolean:=false;
BEGIN
 SELECT job_id INTO j FROM episode_enrichment_pilot_items WHERE status='applied' GROUP BY job_id HAVING count(*)>=3 ORDER BY job_id LIMIT 1;
 SELECT array_agg(episode_id ORDER BY ordinal) INTO ids FROM (SELECT episode_id,ordinal FROM episode_enrichment_pilot_items WHERE job_id=j AND status='applied' ORDER BY ordinal LIMIT 3)s;
 UPDATE episode_enrichment_pilot_jobs SET lease_token=tok,lease_until=now()+interval '5 minutes' WHERE id=j;
 FOREACH eid IN ARRAY ids LOOP
  inp:=episode_enrichment_input_v1(eid);
  UPDATE episode_enrichment_pilot_items SET input=inp,fingerprint=inp->>'fingerprint',status='submitted' WHERE episode_id=eid;
  payload:=payload||jsonb_build_array(jsonb_build_object('episode_id',eid,'fingerprint',inp->>'fingerprint','result',empty_result,'errors','[]'::jsonb,'role_items','[]'::jsonb,'cost',0.000001));
 END LOOP;
 SELECT to_jsonb(e) INTO before_bad FROM episodes e WHERE id=ids[2];
 payload:=jsonb_set(payload,'{1,result,questions}','[{"text":"Érvénytelen próba","evidence":{"source":"rss","quote":"This exact evidence never occurs in the episode: isolation-regression-20261116"}}]');
 r:=apply_episode_enrichment_chunk_v1(j,tok,payload);
 IF r#>>'{0,status}'<>'applied' OR r#>>'{1,status}'<>'invalid' OR r#>>'{2,status}'<>'applied' THEN RAISE EXCEPTION 'bad isolation outcomes %',r; END IF;
 IF before_bad IS DISTINCT FROM (SELECT to_jsonb(e) FROM episodes e WHERE id=ids[2]) THEN RAISE EXCEPTION 'invalid item changed public episode'; END IF;
 IF (SELECT error FROM episode_enrichment_pilot_items WHERE episode_id=ids[2])<>'evidence_mismatch' THEN RAISE EXCEPTION 'missing evidence audit'; END IF;
 IF (SELECT cost_usd FROM episode_enrichment_pilot_items WHERE episode_id=ids[2])<>0.000001 THEN RAISE EXCEPTION 'lost paid cost'; END IF;
 IF get_episode_enrichment_public_v1(ids[2]) IS NOT NULL THEN RAISE EXCEPTION 'invalid item public'; END IF;
 IF apply_episode_enrichment_chunk_v1(j,tok,payload) IS DISTINCT FROM r THEN RAISE EXCEPTION 'not idempotent'; END IF;
 UPDATE episode_enrichment_pilot_items SET status='submitted' WHERE episode_id=ids[2];
 payload:=jsonb_set(payload,'{1,result}',jsonb_set(empty_result,'{summary}','{"text":"A test summary that is long enough to be validated.","evidence":[{"source":"rss","quote":"This exact evidence never occurs: summary-regression-20261116"}]}'));
 r:=apply_episode_enrichment_chunk_v1(j,tok,payload);
 IF (SELECT error FROM episode_enrichment_pilot_items WHERE episode_id=ids[2])<>'summary_evidence_mismatch' THEN RAISE EXCEPTION 'summary not isolated'; END IF;
 UPDATE episode_enrichment_pilot_items SET status='submitted' WHERE episode_id=ids[2];
 payload:=jsonb_set(jsonb_set(payload,'{1,result}',empty_result),'{1,role_items}',(SELECT jsonb_agg('{}'::jsonb) FROM generate_series(1,31)));
 BEGIN
  PERFORM apply_episode_enrichment_chunk_v1(j,tok,payload);
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM='too_many_role_items' THEN caught:=true; ELSE RAISE; END IF;
 END;
 IF NOT caught THEN RAISE EXCEPTION 'unrelated guard swallowed'; END IF;
 IF has_function_privilege('anon','apply_episode_enrichment_chunk_v1(uuid,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'anon write access'; END IF;
END $test$;
