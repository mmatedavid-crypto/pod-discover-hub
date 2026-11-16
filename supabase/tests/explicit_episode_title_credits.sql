-- Run on seeded HU database after migration. All test writes roll back.
BEGIN;
INSERT INTO person_episode_credit_rules(rule_key,podcast_id,credit_pattern,credit_role,match_action,correct_feed_credits,anchor_person_ids,source_url,source_quote,source_hash,provenance,owner_confirmed,verified_at,version,active,notes,source_field)
VALUES('test-title-credit-uzonyi','eb9add2d-e341-4a67-968d-45262ca7cd9f','^(.*?[-–][[:space:]]*Uzonyi Barnabás)(?:[[:space:]]*/|[[:space:]]*-[[:space:]]*Isten szíve|$)','preacher','accept_participant',false,ARRAY['76585e36-cfec-485a-a5cf-b149718dc8b1']::uuid[],'https://www.baptist.hu/2026-11-08-ha-nem-birja-tovabb-a-szived-istentisztelet-uzonyi-barnabas-pecel/','Uzonyi Barnabás lelkipásztor igehirdetése; Péceli Baptista Gyülekezet. A kiadói epizódcím a tanítás után teljes névvel nevezi meg az igehirdetőt.',md5('Uzonyi Barnabás lelkipásztor igehirdetése; Péceli Baptista Gyülekezet. A kiadói epizódcím a tanítás után teljes névvel nevezi meg az igehirdetőt.'),'publisher_episode_title',false,now(),'full-backlog-v46',true,'Independent identity: https://pecelibaptista.hu/ names Uzonyi Barnabás pastor since 2015. Same publisher sermon title convention crosschecked 2023,2024,2025,2026 Baptist church pages. Only positive full-name title credit, not RSS author. No alias or other-speaker rejection.','episode_title');
DO $$ DECLARE z jsonb; BEGIN
 z:=person_episode_credit_decide_v1('76585e36-cfec-485a-a5cf-b149718dc8b1','626e6ed2-db56-44c4-bb29-f173dc4eca74');
 IF z->>'outcome' IS DISTINCT FROM 'credited_role' OR z->>'source_field' IS DISTINCT FROM 'episode_title' THEN RAISE EXCEPTION 'title credit not found'; END IF;
 IF person_episode_credit_decide_v1('76585e36-cfec-485a-a5cf-b149718dc8b1','acc476de-0c3a-49fb-91af-dba2016f25b4') IS NOT NULL THEN RAISE EXCEPTION 'other speaker accepted'; END IF;
 IF person_episode_credit_capture_v1('(Műsorvezető:[^<]*)',null,'unrelated','Műsorvezető: Vidovszky Áron') IS DISTINCT FROM 'Műsorvezető: Vidovszky Áron' THEN RAISE EXCEPTION 'description regression'; END IF;
 UPDATE person_episode_credit_rules SET anchor_person_ids=ARRAY['13a9d2e9-2833-418b-ba4d-82041cdfe47f']::uuid[] WHERE rule_key='test-title-credit-uzonyi';
 IF person_episode_credit_decide_v1('76585e36-cfec-485a-a5cf-b149718dc8b1','626e6ed2-db56-44c4-bb29-f173dc4eca74') IS NOT NULL THEN RAISE EXCEPTION 'unanchored title accepted'; END IF;
END $$;
ROLLBACK;
