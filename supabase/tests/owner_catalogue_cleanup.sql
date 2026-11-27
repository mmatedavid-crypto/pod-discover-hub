-- Privileged, transactional verification. No public reinsertion or lasting test writes.
BEGIN;
DO $test$
DECLARE n integer; eid uuid; mid uuid; old_state jsonb; new_state jsonb;
BEGIN
 IF (SELECT count(*) FROM public.episode_ingest_exclusions WHERE podcast_id='2ebf836e-eaa3-40b2-8feb-0323295dba3b' AND guid='02e72bdf-103f-5c74-8611-ec5c4a4d1228')<>1 THEN RAISE EXCEPTION 'Missing exact exclusion'; END IF;
 INSERT INTO public.episodes(podcast_id,title,slug,guid) VALUES('2ebf836e-eaa3-40b2-8feb-0323295dba3b','Private guard simulation','private-guard-simulation','02e72bdf-103f-5c74-8611-ec5c4a4d1228') RETURNING id INTO eid;
 IF eid IS NOT NULL THEN RAISE EXCEPTION 'GUID bypassed guard'; END IF;
 INSERT INTO public.episodes(podcast_id,title,slug,guid,audio_url) VALUES('2ebf836e-eaa3-40b2-8feb-0323295dba3b','Private guard simulation','private-guard-simulation','private-changed-guid','https://media.example/RJb9HPpnlPY.mp3') RETURNING id INTO eid;
 IF eid IS NOT NULL THEN RAISE EXCEPTION 'Asset bypassed guard'; END IF;
 INSERT INTO public.episodes(podcast_id,title,slug,guid) VALUES('2ebf836e-eaa3-40b2-8feb-0323295dba3b','Private guard simulation','valtozas-es-batorsag-coming-out-szelsokozep-produkcio','private-changed-guid') RETURNING id INTO eid;
 IF eid IS NOT NULL THEN RAISE EXCEPTION 'Slug bypassed guard'; END IF;
 IF public.episode_ingest_excluded_v1(jsonb_build_object('podcast_id','2f564d96-279a-49b5-a4c1-21796fec2b73','guid','02e72bdf-103f-5c74-8611-ec5c4a4d1228')) THEN RAISE EXCEPTION 'Other show affected'; END IF;
 IF public.episode_ingest_excluded_v1(jsonb_build_object('podcast_id','2ebf836e-eaa3-40b2-8feb-0323295dba3b','guid','unrelated')) THEN RAISE EXCEPTION 'Unrelated episode affected'; END IF;
 SELECT count(*) INTO n FROM public.person_public_episode_links_v1 WHERE person_id='3c43c4d3-1349-448d-9109-1b31750e3e34' AND episode_id IN('8b02c2b9-56a4-45e5-b588-d44d7ffb3048','f1802d30-6c40-4ab8-ba4f-cec48e790528') AND page_role='subject';
 IF n<>2 THEN RAISE EXCEPTION 'Two archive episodes not preserved'; END IF;
 IF public.resolve_person_redirect_v1('vereb-pisti') IS DISTINCT FROM 'vereb-istvan' THEN RAISE EXCEPTION 'Canonical redirect missing'; END IF;
 IF (SELECT count(*) FROM public.person_aliases WHERE person_id='3c43c4d3-1349-448d-9109-1b31750e3e34' AND normalized_alias IN('vereb pisti','vereb istvan') AND status='accepted')<>2 THEN RAISE EXCEPTION 'Names not searchable'; END IF;
 SELECT id,to_jsonb(m) INTO mid,old_state FROM public.person_episode_mentions m WHERE person_id='eddfb592-9bfc-4bf5-9c6f-7e089ed7d414' AND episode_id='6a71df24-ba02-4276-9496-fa72be1aae19' AND mention_type='guest';
 IF mid IS NULL OR old_state->>'validation_source'<>'manual_owner_review' THEN RAISE EXCEPTION 'Reviewed guest missing'; END IF;
 UPDATE public.person_episode_mentions SET relevance_status='pending',validation_source=NULL,role_type='mention',source='automated_test' WHERE id=mid;
 SELECT to_jsonb(m) INTO new_state FROM public.person_episode_mentions m WHERE id=mid;
 IF new_state IS DISTINCT FROM old_state THEN RAISE EXCEPTION 'Automated processing changed reviewed guest'; END IF;
 UPDATE public.person_pair_dispositions SET disposition='evidence_pending',decided_by='deterministic:test',reopen_on_source_change=true WHERE person_id='eddfb592-9bfc-4bf5-9c6f-7e089ed7d414' AND episode_id='6a71df24-ba02-4276-9496-fa72be1aae19';
 IF NOT EXISTS(SELECT 1 FROM public.person_pair_dispositions WHERE person_id='eddfb592-9bfc-4bf5-9c6f-7e089ed7d414' AND episode_id='6a71df24-ba02-4276-9496-fa72be1aae19' AND disposition='decided_accepted' AND decided_by='human:owner_review' AND NOT reopen_on_source_change) THEN RAISE EXCEPTION 'Automated classifier reopened guest'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.get_episode_person_links_v1('6a71df24-ba02-4276-9496-fa72be1aae19') WHERE person_id='eddfb592-9bfc-4bf5-9c6f-7e089ed7d414') THEN RAISE EXCEPTION 'Guest reverse link missing'; END IF;
 RAISE NOTICE 'PASS: 13 scoped live postconditions and mutation simulations';
END $test$;
ROLLBACK;