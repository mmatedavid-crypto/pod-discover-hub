-- Run in one connection, then SELECT pg_temp.episode_batch_integration_test(<owned token>).
-- All test data and control changes are rolled back by the enclosing exception subtransaction.
CREATE OR REPLACE FUNCTION pg_temp.episode_batch_integration_test(p_token uuid) RETURNS jsonb LANGUAGE plpgsql AS $test$
DECLARE eid uuid; v jsonb; q text; result jsonb; applied jsonb; rendered jsonb; undone jsonb; original_summary text; ctx text;
BEGIN
 BEGIN
  IF NOT EXISTS(SELECT 1 FROM app_settings WHERE key='person_backlog_completion_controls' AND value->>'run_token'=p_token::text AND (value->>'lease_until')::timestamptz>now()) THEN RAISE EXCEPTION 'lease'; END IF;
  IF has_table_privilege('anon','public.episode_enrichment_pilot_items','SELECT') THEN RAISE EXCEPTION 'private_table_exposed'; END IF;
  IF has_function_privilege('anon','public.episode_enrichment_input_v1(uuid)','execute') THEN RAISE EXCEPTION 'private_sources_exposed'; END IF;
  UPDATE app_settings SET value=jsonb_set(jsonb_set(value,'{enabled}','true'),'{public_enabled}','true') WHERE key='episode_enrichment_pilot_controls';
  BEGIN
   INSERT INTO episode_enrichment_pilot_jobs(reserved_cost_usd) VALUES(10000000);
   RAISE EXCEPTION 'budget_ceiling_bypassed';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM NOT LIKE 'external_ai_%exceeded' THEN RAISE; END IF; END;
  SELECT i.episode_id INTO eid FROM episode_enrichment_pilot_items i JOIN episodes e ON e.id=i.episode_id WHERE length(coalesce(e.ai_summary,''))=0 AND length(e.description)>150 ORDER BY i.ordinal LIMIT 1;
  IF eid IS NULL THEN RAISE EXCEPTION 'missing_test_episode'; END IF;
  SELECT ai_summary INTO original_summary FROM episodes WHERE id=eid;
  v:=episode_enrichment_input_v1(eid);
  SELECT left(s->>'text',150) INTO q FROM jsonb_array_elements(v->'sources')s WHERE s->>'id'='rss';
  UPDATE episode_enrichment_pilot_items SET input=v,fingerprint=v->>'fingerprint',status='prepared' WHERE episode_id=eid;
  result:=jsonb_build_object('summary',jsonb_build_object('text',q,'evidence',jsonb_build_array(jsonb_build_object('source','rss','quote',q))),'questions',jsonb_build_array(jsonb_build_object('text','Tranzakciós teszt','evidence',jsonb_build_object('source','rss','quote',q))),'entities','[]'::jsonb,'topics','[]'::jsonb,'people','[]'::jsonb,'format',null);
  BEGIN
   PERFORM apply_episode_enrichment_item_v1(eid,v->>'fingerprint',jsonb_set(result,'{questions,0,evidence,quote}','"NEM LETEZO BIZONYITEK A FORRASBAN"'),'[]','[]',0);
   RAISE EXCEPTION 'forged_quote_was_accepted';
  EXCEPTION WHEN OTHERS THEN IF SQLERRM<>'evidence_mismatch' THEN RAISE; END IF; END;
  UPDATE episode_enrichment_pilot_items SET fingerprint='old-source' WHERE episode_id=eid;
  applied:=apply_episode_enrichment_item_v1(eid,'old-source',result,'[]','[]',0);
  IF applied->>'status'<>'stale' THEN RAISE EXCEPTION 'stale_source_not_blocked'; END IF;
  UPDATE episode_enrichment_pilot_items SET fingerprint=v->>'fingerprint',status='prepared' WHERE episode_id=eid;
  applied:=apply_episode_enrichment_item_v1(eid,v->>'fingerprint',result,'[]','[]',0);
  IF (SELECT status FROM episode_enrichment_pilot_items WHERE episode_id=eid)<>'applied' THEN RAISE EXCEPTION 'apply_failed'; END IF;
  IF apply_episode_enrichment_item_v1(eid,v->>'fingerprint',result,'[]','[]',0) IS DISTINCT FROM applied THEN RAISE EXCEPTION 'non_idempotent'; END IF;
  rendered:=get_episode_enrichment_public_v1(eid);
  IF rendered IS NULL OR rendered ? 'sources' OR rendered ? 'people' OR rendered ? 'evidence' THEN RAISE EXCEPTION 'public_projection_failed'; END IF;
  undone:=undo_episode_enrichment_item_v1(eid,p_token);
  IF undone->>'status'<>'rolled_back' THEN RAISE EXCEPTION 'undo_failed:%',undone; END IF;
  IF (SELECT ai_summary FROM episodes WHERE id=eid) IS DISTINCT FROM original_summary THEN RAISE EXCEPTION 'summary_restore_failed'; END IF;
  RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='test_passed_rolled_back';
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS ctx=PG_EXCEPTION_CONTEXT; RETURN jsonb_build_object('passed',SQLSTATE='ZX001','message',SQLERRM,'context',ctx); END;
END $test$;
