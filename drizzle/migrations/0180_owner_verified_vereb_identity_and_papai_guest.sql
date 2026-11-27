DO $cleanup$
#variable_conflict use_variable
DECLARE
 run uuid; version text := 'owner_catalogue_cleanup_2026_11_27'; src uuid := '9c781d74-b582-4e36-85d2-390f2e48c785'; canon uuid := '3c43c4d3-1349-448d-9109-1b31750e3e34'; anita uuid := 'eddfb592-9bfc-4bf5-9c6f-7e089ed7d414'; ep uuid := '6a71df24-ba02-4276-9496-fa72be1aae19'; rec record; before_m jsonb; before_d jsonb; mid uuid; evidence jsonb;
BEGIN
 IF EXISTS(SELECT 1 FROM person_identity_repair_runs r WHERE r.version=version AND r.completed_at IS NOT NULL) THEN RETURN; END IF;
 PERFORM 1 FROM people WHERE id IN(src,canon,anita) ORDER BY id FOR UPDATE;
 IF (SELECT count(*) FROM people WHERE id IN(src,canon,anita))<>3 THEN RAISE EXCEPTION 'Expected identities missing'; END IF;
 IF (SELECT count(*) FROM episodes WHERE id IN('8b02c2b9-56a4-45e5-b588-d44d7ffb3048','f1802d30-6c40-4ab8-ba4f-cec48e790528',ep))<>3 THEN RAISE EXCEPTION 'Expected episodes missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM episodes WHERE id='8b02c2b9-56a4-45e5-b588-d44d7ffb3048' AND description LIKE '%Veréb Pistire%' AND description LIKE '%Veréb István%') OR NOT EXISTS(SELECT 1 FROM episodes WHERE id='f1802d30-6c40-4ab8-ba4f-cec48e790528' AND description LIKE '%1991%' AND description LIKE '%ZwIP1SYZxtc%') OR NOT EXISTS(SELECT 1 FROM episodes WHERE id=ep AND title LIKE '%Pápai Anitával%' AND description LIKE '%Tejhabos mindenit%' AND description LIKE '%mindfulness%') THEN RAISE EXCEPTION 'Publisher evidence changed'; END IF;
 IF EXISTS(SELECT 1 FROM person_relevance_work WHERE person_id IN(src,canon,anita) AND lease_until>now()) THEN RAISE EXCEPTION 'Live person lease'; END IF;
 IF EXISTS(SELECT 1 FROM person_pair_dispositions WHERE person_id=anita AND episode_id=ep AND (disposition='decided_rejected' OR decided_by LIKE 'human:%')) THEN RAISE EXCEPTION 'Protected existing decision'; END IF;
 INSERT INTO person_identity_repair_runs(version) VALUES(version) RETURNING id INTO run;
 INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) SELECT run,'people',to_jsonb(p) FROM people p WHERE id IN(src,canon,anita);
 INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) SELECT run,'person_episode_mentions',to_jsonb(m) FROM person_episode_mentions m WHERE person_id IN(src,canon) OR (person_id=anita AND episode_id=ep);
 INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) SELECT run,'person_pair_dispositions',to_jsonb(d) FROM person_pair_dispositions d WHERE person_id IN(src,canon) OR (person_id=anita AND episode_id=ep);
 INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) SELECT run,'person_aliases',to_jsonb(a) FROM person_aliases a WHERE person_id IN(src,canon);
 INSERT INTO person_identity_repair_backup(run_id,table_name,row_data) SELECT run,'person_podcast_map',to_jsonb(p) FROM person_podcast_map p WHERE person_id IN(src,canon);
 INSERT INTO person_identity_merge_rules(source_person_id,canonical_person_id,evidence,version,run_id) VALUES(src,canon,'Owner-confirmed single archive subject: publisher 1991 description names Veréb Pisti and Veréb István; 1992 description links 1991 report https://www.youtube.com/watch?v=ZwIP1SYZxtc . Episodes 8b02c2b9-56a4-45e5-b588-d44d7ffb3048 and f1802d30-6c40-4ab8-ba4f-cec48e790528.',version,run);
 UPDATE person_episode_mentions SET person_id=canon WHERE person_id=src;
 UPDATE person_pair_dispositions SET person_id=canon WHERE person_id=src;
 -- Remove only the backed-up duplicate relation BEFORE changing its unique key.
 DELETE FROM person_podcast_map s USING person_podcast_map c WHERE s.person_id=src AND c.person_id=canon AND s.podcast_id=c.podcast_id AND s.role=c.role;
 UPDATE person_podcast_map SET person_id=canon WHERE person_id=src;
 UPDATE person_aliases SET person_id=canon WHERE person_id=src;
 UPDATE person_aliases SET source='human:owner_confirmed',confidence=1,status='accepted',reviewed_at=now(),review_reason='Publisher-confirmed archive identity; owner reviewed.' WHERE person_id=canon AND normalized_alias IN('vereb istvan','vereb pisti');
 UPDATE people SET identity_status='merged_into',ai_duplicate_of_person_id=canon,is_public=false,is_indexable=false,is_browsable_in_people_hub=false WHERE id=src;
 UPDATE people SET manual_approved=true,identity_status='confirmed',disambiguation_label='A Friderikusz Archív 1991-es és 1992-es riportjainak szereplője' WHERE id=canon;
 FOR rec IN SELECT id,episode_url,title,description,podcast_id FROM episodes WHERE id IN('8b02c2b9-56a4-45e5-b588-d44d7ffb3048','f1802d30-6c40-4ab8-ba4f-cec48e790528') LOOP
  evidence:=jsonb_build_object('source_url',rec.episode_url,'source_quote',left(regexp_replace(rec.description,'<[^>]+>',' ','g'),420),'owner_reviewed',true,'provenance','human_reviewed_archive_subject','version',version);
  SELECT to_jsonb(m),m.id INTO before_m,mid FROM person_episode_mentions m WHERE person_id=canon AND episode_id=rec.id AND mention_type='subject';
  SELECT to_jsonb(d) INTO before_d FROM person_pair_dispositions d WHERE person_id=canon AND episode_id=rec.id;
  INSERT INTO person_episode_mentions AS m(person_id,episode_id,podcast_id,mention_type,role_type,relevance_status,validation_source,confidence,final_relevance_score,role_confidence,evidence,source,source_evidence,role_reason) VALUES(canon,rec.id,rec.podcast_id,'subject','subject','accepted','manual_owner_review',1,1,1,left(rec.title,500),'human_owner_review',evidence,'A tulajdonos által ellenőrzött, kiadói forrással igazolt archív alany.') ON CONFLICT(person_id,episode_id,mention_type) DO UPDATE SET role_type='subject',relevance_status='accepted',validation_source='manual_owner_review',final_relevance_score=1,role_confidence=1,source_evidence=EXCLUDED.source_evidence,role_reason=EXCLUDED.role_reason RETURNING id INTO mid;
  UPDATE person_episode_mentions SET role_type='subject' WHERE person_id=canon AND episode_id=rec.id AND relevance_status='accepted' AND validation_source !~ '^(manual|human|chatgpt|external_review)';
  INSERT INTO person_pair_dispositions AS d(person_id,episode_id,disposition,reason_code,decided_by,policy_version,detail,reopen_on_source_change) VALUES(canon,rec.id,'decided_accepted','accepted_link','human:owner_review',version,evidence,false) ON CONFLICT(person_id,episode_id) DO UPDATE SET decided_by=EXCLUDED.decided_by,detail=COALESCE(d.detail,'{}')||EXCLUDED.detail,reopen_on_source_change=false;
  INSERT INTO person_pair_lane_audit(lane,action,person_id,episode_id,mention_id,rule_version,before_state,after_state,evidence) VALUES('manual','accept',canon,rec.id,mid,version,jsonb_build_object('mention',before_m,'disposition',before_d),jsonb_build_object('relevance_status','accepted','role_type','subject'),evidence);
 END LOOP;
 SELECT to_jsonb(m),m.id INTO before_m,mid FROM person_episode_mentions m WHERE person_id=anita AND episode_id=ep LIMIT 1;
 SELECT to_jsonb(d) INTO before_d FROM person_pair_dispositions d WHERE person_id=anita AND episode_id=ep;
 SELECT jsonb_build_object('source_url',episode_url,'source_quote',title||' — '||description,'owner_reviewed',true,'provenance','human_reviewed_guest','version',version) INTO evidence FROM episodes WHERE id=ep;
 UPDATE person_episode_mentions SET mention_type='guest',role_type='participant',relevance_status='accepted',validation_source='manual_owner_review',confidence=1,final_relevance_score=1,role_confidence=1,source_evidence=COALESCE(source_evidence,'{}')||evidence,role_reason='Pápai Anita, a Tejhabos mindenit szerzője, a KÁVÉKALANDOK vendége: tudatos kávézás és mindfulness.',source='human_owner_review' WHERE id=mid AND relevance_status='needs_review' AND validation_source='person_openai_batch_v1';
 IF NOT FOUND THEN RAISE EXCEPTION 'Pápai pair changed'; END IF;
 UPDATE person_pair_dispositions SET disposition='decided_accepted',reason_code='accepted_link',decided_by='human:owner_review',policy_version=version,detail=COALESCE(detail,'{}')||evidence,reopen_on_source_change=false,updated_at=now() WHERE person_id=anita AND episode_id=ep AND disposition='evidence_pending' AND decided_by NOT LIKE 'human:%';
 IF NOT FOUND THEN RAISE EXCEPTION 'Pápai decision changed'; END IF;
 INSERT INTO person_pair_lane_audit(lane,action,person_id,episode_id,mention_id,rule_version,before_state,after_state,evidence) VALUES('manual','accept',anita,ep,mid,version,jsonb_build_object('mention',before_m,'disposition',before_d),jsonb_build_object('relevance_status','accepted','role_type','participant','mention_type','guest'),evidence);
 UPDATE people SET disambiguation_label='A Tejhabos mindenit szerzője, a KÁVÉKALANDOK vendége' WHERE id=anita;
 UPDATE people p SET gated_episode_count=x.n,episode_count=x.n,participant_count=x.participants,guest_count=x.guests,host_count=x.hosts,podcast_count=x.podcasts,latest_episode_at=x.latest FROM (SELECT p0.id,count(v.episode_id)::int n,count(*) FILTER(WHERE v.page_role='participant')::int participants,count(*) FILTER(WHERE v.page_role='participant' AND v.mention_type='guest')::int guests,count(*) FILTER(WHERE v.page_role='participant' AND v.mention_type='host')::int hosts,count(DISTINCT v.podcast_id)::int podcasts,max(v.published_at) latest FROM people p0 LEFT JOIN person_public_episode_links_v1 v ON v.person_id=p0.id WHERE p0.id IN(canon,anita) GROUP BY p0.id) x WHERE p.id=x.id;
 UPDATE person_identity_repair_runs SET completed_at=now(),summary=jsonb_build_object('canonical',canon,'source',src,'archive_episodes',2,'reviewed_guest_pairs',1) WHERE id=run;
 IF (SELECT count(*) FROM person_public_episode_links_v1 WHERE person_id=canon AND episode_id IN('8b02c2b9-56a4-45e5-b588-d44d7ffb3048','f1802d30-6c40-4ab8-ba4f-cec48e790528'))<>2 THEN RAISE EXCEPTION 'Archive links not preserved'; END IF;
 IF NOT public.person_link_trusted_v1(anita,'manual_owner_review') THEN RAISE EXCEPTION 'Guest identity not trusted'; END IF;
END $cleanup$;