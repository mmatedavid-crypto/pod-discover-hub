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

-- Episode-credit lane checks (owner batch 2). Expected result: ERROR "ALL_PASS episode-credit ..." (rolled back).
DO $t$
DECLARE
  csukas uuid := 'd83a4945-e0a0-49a9-9e80-92a48e7a8cfd'; ref uuid := 'e6b8755f-2a2e-433a-9d19-eb6f2b49d51c'; tt uuid := '943c24c9-993a-4bf1-b6d2-bd2ac7233a81';
  banner uuid := '579c2893-18b4-4eb1-92d0-30275ed754b0'; morvai uuid := '9cf35360-0c62-4bca-92a7-2710dfabd834';
  gevai uuid := (SELECT id FROM people WHERE name = 'Gévai Csilla' ORDER BY id LIMIT 1);
  bakos uuid := '04559bd4-4770-4faf-b030-95ce24de63b4'; edes uuid := '0a81c75a-76a7-4c27-b60b-ff9b2c0379af';
  haraszti uuid := '277b8fed-8886-4dbf-8c26-1c92fda9f5e4'; baumstark uuid := 'b103fec6-c560-4378-943d-dbc90f1e0dd9';
  e uuid; st text; st2 text; ds text; n int; res jsonb; rid uuid;
BEGIN
  -- 1) Idempotent.
  PERFORM public.apply_person_episode_credit_rules_v1(10000);
  res := public.apply_person_episode_credit_rules_v1(10000);
  ASSERT (res->>'resolved_pairs')::int = 0, 'C1 not idempotent: ' || res::text;

  -- 2) Esti mese: the Mesélő is credited, another host-field RSS credit is corrected.
  INSERT INTO episodes (podcast_id, title, description, slug, published_at) VALUES (csukas, 'Esti mese: Teszt (Csukás István)',
    'Mesélő: Banner Géza. A történetmesélés semmihez sem hasonlítható élményét hozza el', 'test-ec-' || gen_random_uuid(), now()) RETURNING id INTO e;
  INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (banner, e, csukas, 'host', 'pending', 'rss_author') RETURNING relevance_status INTO st;
  INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (morvai, e, csukas, 'host', 'pending', 'rss_author') RETURNING relevance_status INTO st2;
  ASSERT st = 'accepted' AND st2 = 'resolved_feed_credit_not_episode', 'C2 Esti mese: ' || st || '/' || st2;
  SELECT disposition INTO ds FROM person_pair_dispositions WHERE person_id = morvai AND episode_id = e;
  ASSERT ds = 'resolved_feed_credit_not_episode', 'C2 disposition ' || COALESCE(ds, '∅');
  -- 6) AI ingest cannot reopen; 7) a manual decision can.
  UPDATE person_episode_mentions SET relevance_status = 'needs_review', validation_source = 'person_openai_batch_v1' WHERE person_id = morvai AND episode_id = e RETURNING relevance_status INTO st;
  ASSERT st = 'resolved_feed_credit_not_episode', 'C6 AI ingest reopened a corrected feed credit';
  UPDATE person_episode_mentions SET relevance_status = 'accepted', validation_source = 'manual' WHERE person_id = morvai AND episode_id = e RETURNING relevance_status INTO st;
  ASSERT st = 'accepted', 'C7 manual decision blocked';
  -- 5) A link that did not come only from the RSS author field is never corrected.
  INSERT INTO episodes (podcast_id, title, description, slug, published_at) VALUES (csukas, 'Esti mese: Teszt 2',
    'Mesélő: Banner Géza. A történetmesélés semmihez sem', 'test-ec-' || gen_random_uuid(), now()) RETURNING id INTO e;
  INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (morvai, e, csukas, 'mentioned', 'pending', 'episode_people_array') RETURNING relevance_status INTO st;
  ASSERT st = 'pending', 'C5 non-RSS link corrected';

  -- 3) The tale author (Szerző) is never credited as performer.
  IF gevai IS NOT NULL THEN
    INSERT INTO episodes (podcast_id, title, description, slug, published_at) VALUES (csukas, 'Petra mese: Teszt',
      'Előadó: Gubik Petra. Szerző: Gévai Csilla.', 'test-ec-' || gen_random_uuid(), now()) RETURNING id INTO e;
    INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (gevai, e, csukas, 'mentioned', 'pending', 'ai_summary') RETURNING relevance_status INTO st;
    ASSERT st = 'pending', 'C3 author credited as performer';
  END IF;

  -- 4) Igeidő: the named preacher is credited (accusative form); other host-field names are corrected unless the text names them.
  INSERT INTO episodes (podcast_id, title, description, slug, published_at) VALUES (ref, 'Igeidő 2099.01.01.',
    'Ez az Igeidő. A mai bibliai igeszakaszról Bakos Istvánt a Teszt Református Egyházközség lelkipásztorát hallják.', 'test-ec-' || gen_random_uuid(), now()) RETURNING id INTO e;
  INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (bakos, e, ref, 'host', 'pending', 'rss_author') RETURNING relevance_status INTO st;
  INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (edes, e, ref, 'host', 'pending', 'rss_author') RETURNING relevance_status INTO st2;
  ASSERT st = 'accepted' AND st2 = 'resolved_feed_credit_not_episode', 'C4 Igeidő: ' || st || '/' || st2;
  INSERT INTO episodes (podcast_id, title, description, slug, published_at) VALUES (ref, 'Igeidő 2099.01.02.',
    'A mai bibliai igeszakaszról Bakos Istvánt a Teszt Egyházközség lelkipásztorát hallják. Köszönet Édes Árpádnak.', 'test-ec-' || gen_random_uuid(), now()) RETURNING id INTO e;
  INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (edes, e, ref, 'host', 'pending', 'rss_author') RETURNING relevance_status INTO st;
  ASSERT st = 'pending', 'C4 named person corrected away';

  -- 9) TT Extra: 🗣️ list gives the episode appearance; an unlisted roster host stays roster-only.
  INSERT INTO episodes (podcast_id, title, description, slug, published_at) VALUES (tt, 'Teszt különkiadás',
    'Téma. 🗣️ Haraszti Ádám 🗣️ Brodarics Tamás: https://scorets.hu/stab/ 📘 https://www.facebook.com/x', 'test-ec-' || gen_random_uuid(), now()) RETURNING id INTO e;
  INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (haraszti, e, tt, 'host', 'pending', 'rss_author') RETURNING relevance_status INTO st;
  INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, relevance_status, source) VALUES (baumstark, e, tt, 'host', 'pending', 'rss_author') RETURNING relevance_status INTO st2;
  ASSERT st = 'accepted' AND st2 = 'resolved_show_host', 'C9 TT Extra: ' || st || '/' || st2;

  -- 8) Corrected feed credits never reach public person pages.
  SELECT count(*) INTO n FROM person_public_episode_links_v1 WHERE relevance_status = 'resolved_feed_credit_not_episode';
  ASSERT n = 0, 'C8 corrected feed credit is public';

  -- 10) Undo restores the before-state.
  SELECT rule_id INTO rid FROM person_episode_credit_resolutions WHERE person_id = bakos AND episode_id = (SELECT id FROM episodes WHERE title = 'Igeidő 2099.01.01.' AND podcast_id = ref);
  res := public.undo_person_episode_credit_pairs_v1(rid, ARRAY(SELECT id FROM episodes WHERE title = 'Igeidő 2099.01.01.' AND podcast_id = ref), 'test');
  SELECT relevance_status INTO st FROM person_episode_mentions WHERE person_id = edes AND episode_id = (SELECT id FROM episodes WHERE title = 'Igeidő 2099.01.01.' AND podcast_id = ref);
  ASSERT (res->>'undone')::int = 2 AND st = 'pending', 'C10 undo: ' || res::text || ' ' || st;

  RAISE EXCEPTION 'ALL_PASS episode-credit checks (rolled back)';
END $t$;
