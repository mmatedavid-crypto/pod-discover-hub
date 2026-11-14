-- Show-host rule checks (run with supabase--run_sql; everything is rolled back by the final RAISE).
-- Expected result: ERROR "ALL_PASS ..." — any other error names the failing check.
DO $t$
DECLARE
  bochkor uuid := '5fa9db55-a19f-4953-bd86-8de09c4ed344'; rasko uuid := 'e17e0641-e00f-427c-9515-bef25a75389a';
  ronai uuid := '1658ac4c-c30b-4f77-9895-7a5c4afe727b'; ruff uuid := '67e078d8-a704-4236-bfac-201923b15ae8';
  atv uuid := '44dfa696-306c-4d62-aa24-0b49e82c7239'; retro uuid := 'c6fc4766-4b6c-4d77-a321-81b7f03e75c9';
  balazsek uuid := (SELECT id FROM podcasts WHERE slug = 'balazsek'); tk uuid := (SELECT id FROM podcasts WHERE slug = 'tobb-kevesebb');
  partizan uuid := '9655ce26-36c2-4490-a224-dec1b3dc36d0'; other uuid := (SELECT id FROM podcasts WHERE slug = 'portfolio');
  e uuid; st text; ds text; n int; res jsonb;
BEGIN
  -- 1) Idempotent: after one catch-up apply, a second apply changes nothing.
  PERFORM public.apply_person_host_rules_v1(5000);
  res := public.apply_person_host_rules_v1(5000);
  ASSERT (res->>'resolved_pairs')::int = 0, 'T1 second apply not idempotent: ' || res::text;

  -- helper pattern: new episode + pending host mention, then read the status the trigger left.
  -- 2) Bochkor rule is the Retro radio show only, never the ATV show.
  SELECT count(*) INTO n FROM person_host_rule_resolutions x JOIN episodes ep ON ep.id = x.episode_id WHERE ep.podcast_id = atv;
  ASSERT n = 0, 'T2 ATV Bochkor resolved: ' || n;
  INSERT INTO episodes (podcast_id, title, slug, published_at) VALUES (atv, 'Teszt ATV adás', 'test-hr-' || gen_random_uuid(), now()) RETURNING id INTO e;
  INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (bochkor, e, atv, 'host', 'pending', 'test') RETURNING relevance_status INTO st;
  ASSERT st = 'pending', 'T2 ATV episode inherited Bochkor host';
  INSERT INTO episodes (podcast_id, title, slug, published_at) VALUES (retro, 'Teszt Retro adás', 'test-hr-' || gen_random_uuid(), now()) RETURNING id INTO e;
  INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (bochkor, e, retro, 'host', 'pending', 'test') RETURNING relevance_status INTO st;
  ASSERT st = 'resolved_show_host', 'T2 Retro episode did not inherit Bochkor host';

  -- 3) Ráskó Eszter only from 2024-02-12.
  INSERT INTO episodes (podcast_id, title, slug, published_at) VALUES (balazsek, 'Teszt 2023', 'test-hr-' || gen_random_uuid(), '2023-06-01') RETURNING id INTO e;
  INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (rasko, e, balazsek, 'host', 'pending', 'test') RETURNING relevance_status INTO st;
  ASSERT st = 'pending', 'T3 Ráskó inherited before 2024-02-12';

  -- 4) Same person on another show: no inheritance.
  INSERT INTO episodes (podcast_id, title, slug, published_at) VALUES (other, 'Teszt más műsor', 'test-hr-' || gen_random_uuid(), now()) RETURNING id INTO e;
  INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (ronai, e, other, 'host', 'pending', 'test') RETURNING relevance_status INTO st;
  ASSERT st = 'pending', 'T4 rule leaked to another show';

  -- 5) Collection channel: only the proven sub-show title.
  INSERT INTO episodes (podcast_id, title, slug, published_at) VALUES (partizan, 'Hetek – beszélgetés Ruff Bálinttal', 'test-hr-' || gen_random_uuid(), now()) RETURNING id INTO e;
  INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (ruff, e, partizan, 'host', 'pending', 'test') RETURNING relevance_status INTO st;
  ASSERT st = 'pending', 'T5 collection channel blanket inheritance';
  INSERT INTO episodes (podcast_id, title, slug, published_at) VALUES (partizan, 'A Vétón túl #9', 'test-hr-' || gen_random_uuid(), now()) RETURNING id INTO e;
  INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (ruff, e, partizan, 'host', 'pending', 'test') RETURNING relevance_status INTO st;
  ASSERT st = 'pending', 'T5 "A Vétón túl" matched the Vétó rule';
  INSERT INTO episodes (podcast_id, title, slug, published_at) VALUES (partizan, 'Teszt ❌ Vétó #999', 'test-hr-' || gen_random_uuid(), now()) RETURNING id INTO e;
  INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (ruff, e, partizan, 'host', 'pending', 'test') RETURNING relevance_status INTO st;
  ASSERT st = 'resolved_show_host', 'T5 Vétó sub-show episode not inherited';

  -- 6) Explicit episode contradiction and explicit manual decision win.
  INSERT INTO episodes (podcast_id, title, description, slug, published_at) VALUES (tk, 'Teszt', 'Ma Rónai Egon távollétében beszélgettünk.', 'test-hr-' || gen_random_uuid(), now()) RETURNING id INTO e;
  INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (ronai, e, tk, 'host', 'pending', 'test') RETURNING relevance_status INTO st;
  ASSERT st = 'pending', 'T6 absent host inherited';
  UPDATE person_episode_mentions SET relevance_status = 'rejected', validation_source = 'manual'
   WHERE id = (SELECT m.id FROM person_episode_mentions m WHERE m.relevance_status = 'resolved_show_host' LIMIT 1) RETURNING relevance_status INTO st;
  ASSERT st = 'rejected', 'T6 manual decision overridden by rule';
  SELECT count(*) INTO n FROM person_host_rule_resolutions x, jsonb_array_elements(x.before_mentions) bm
   WHERE bm->>'relevance_status' IN ('accepted','rejected') OR COALESCE(bm->>'validation_source','') ~* 'manual|chatgpt|external_review';
  ASSERT n = 0, 'T6 rule closed a pair that had an explicit decision: ' || n;

  -- 7) New episode: inherited automatically, closed in the pair state, nothing left for AI claims.
  INSERT INTO episodes (podcast_id, title, slug, published_at) VALUES (tk, 'Teszt új adás', 'test-hr-' || gen_random_uuid(), now()) RETURNING id INTO e;
  INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (ronai, e, tk, 'host', 'pending', 'test') RETURNING relevance_status INTO st;
  SELECT disposition INTO ds FROM person_pair_dispositions WHERE person_id = ronai AND episode_id = e;
  ASSERT st = 'resolved_show_host' AND ds = 'resolved_show_host', 'T7 new episode not auto-resolved: ' || st || '/' || COALESCE(ds, '∅');
  SELECT count(*) INTO n FROM person_episode_mentions WHERE person_id = ronai AND episode_id = e AND relevance_status IN ('pending','needs_review','in_progress');
  ASSERT n = 0, 'T7 claimable rows remain';
  UPDATE person_episode_mentions SET relevance_status = 'needs_review' WHERE person_id = ronai AND episode_id = e RETURNING relevance_status INTO st;
  ASSERT st = 'resolved_show_host', 'T7 later AI ingest reopened the pair';

  -- 8) No public double counting: inherited roles never appear as page appearances; one role row per canonical person and show.
  SELECT count(*) INTO n FROM person_public_episode_links_v1 WHERE relevance_status = 'resolved_show_host';
  ASSERT n = 0, 'T8 inherited host counted as appearance';
  SELECT count(*) INTO n FROM person_show_host_roles_v1 v JOIN podcasts p ON p.id = v.podcast_id
   WHERE p.slug = 'biblia-egy-ev-alatt-podcast-fabry-kornel-puspok-atyaval';
  ASSERT n = 1, 'T8 Fábry counted under more than one canonical person: ' || n;

  RAISE EXCEPTION 'ALL_PASS show-host rule checks (rolled back)';
END $t$;
