-- Run under an owned backlog lease, inside BEGIN/ROLLBACK. No API calls.
DO $$
DECLARE j episode_enrichment_pilot_jobs; it episode_enrichment_pilot_items; token uuid:=gen_random_uuid(); r jsonb; failed boolean;
BEGIN
 SELECT * INTO it FROM episode_enrichment_pilot_items WHERE status='applied' ORDER BY ordinal LIMIT 1;
 SELECT * INTO j FROM episode_enrichment_pilot_jobs WHERE id=it.job_id FOR UPDATE;
 IF j.status<>'ingested' THEN RAISE EXCEPTION 'test requires settled job'; END IF;
 UPDATE episode_enrichment_pilot_jobs SET lease_token=token,lease_until=now()+interval '5 minutes' WHERE id=j.id;
 failed:=false;
 BEGIN PERFORM apply_episode_enrichment_chunk_v1(j.id,gen_random_uuid(),jsonb_build_array(jsonb_build_object('episode_id',it.episode_id,'fingerprint',it.fingerprint))); EXCEPTION WHEN OTHERS THEN IF SQLERRM='job_lease' THEN failed:=true; ELSE RAISE; END IF; END;
 IF NOT failed THEN RAISE EXCEPTION 'foreign lease accepted'; END IF;
 failed:=false;
 BEGIN PERFORM apply_episode_enrichment_chunk_v1(j.id,token,(SELECT jsonb_agg('{}'::jsonb) FROM generate_series(1,41))); EXCEPTION WHEN OTHERS THEN IF SQLERRM='chunk_size' THEN failed:=true; ELSE RAISE; END IF; END;
 IF NOT failed THEN RAISE EXCEPTION 'oversized chunk accepted'; END IF;
 r:=apply_episode_enrichment_chunk_v1(j.id,token,jsonb_build_array(jsonb_build_object('episode_id',it.episode_id,'fingerprint',it.fingerprint)));
 IF r#>>'{0,status}'<>'applied' THEN RAISE EXCEPTION 'idempotence failed'; END IF;
 UPDATE episode_enrichment_pilot_items SET status='submitted' WHERE episode_id=it.episode_id;
 r:=apply_episode_enrichment_chunk_v1(j.id,token,jsonb_build_array(jsonb_build_object('episode_id',it.episode_id,'fingerprint',it.fingerprint,'error','test_refusal','cost',0)));
 IF r#>>'{0,status}'<>'invalid' THEN RAISE EXCEPTION 'error output was not recorded'; END IF;
 UPDATE episode_enrichment_pilot_items SET status='submitted' WHERE episode_id=it.episode_id;
 r:=finish_episode_enrichment_job_v1(j.id,token,'completed');
 IF (SELECT status FROM episode_enrichment_pilot_items WHERE episode_id=it.episode_id)<>'api_error' THEN RAISE EXCEPTION 'missing terminal output'; END IF;
 IF episode_enrichment_content_quote_v1('A Fesztivál Akadémia Budapest támogatója a Kulturális és Innovációs Minisztérium.') THEN RAISE EXCEPTION 'sponsor published'; END IF;
 IF episode_enrichment_content_quote_v1('A felvételek a Brokkoli Studios Budapestben készültek:') THEN RAISE EXCEPTION 'studio credit published'; END IF;
 IF NOT episode_enrichment_content_quote_v1('A Zend Framework használatáról beszélgetünk.') THEN RAISE EXCEPTION 'valid content excluded'; END IF;
 IF has_function_privilege('anon','apply_episode_enrichment_chunk_v1(uuid,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'anon write access'; END IF;
 IF has_function_privilege('authenticated','finish_episode_enrichment_job_v1(uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'authenticated write access'; END IF;
END $$;
SELECT 'passed: leases, <=40, idempotence, errors, settlement, promo filters, ACLs' as verification;
