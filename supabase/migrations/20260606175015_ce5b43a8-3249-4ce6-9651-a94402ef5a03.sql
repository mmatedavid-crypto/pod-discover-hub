-- ===== entity_monitoring_benchmark policy + 38 goldens (combined 220000+223000) =====
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'entity_monitoring_benchmark_policy',
  jsonb_build_object('version',1,'source_table','search_golden_queries',
    'required_query_types', jsonb_build_array('person','company_brand','company_brand_alias','topic'),
    'min_active_entity_queries',40,'min_active_query_types',3,'requires_expected_entity',true,
    'cadence','weekly_with_search_benchmark',
    'quality_policy','entity_monitoring_benchmark_v1'),
  now()) ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at=now();

UPDATE public.search_golden_queries q
SET query_type='topic',
    expected_intent=COALESCE(NULLIF(q.expected_intent,'person'),'topic'),
    notes=concat_ws(' ', q.notes, 'ENTITY_MONITORING_SCOPE: deceased/historical=topic goldens.'),
    updated_at=now()
WHERE q.active IS TRUE AND q.query_type='person' AND q.expected_entity IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.people p
    WHERE lower(p.name)=lower(q.expected_entity)
      AND COALESCE(p.manual_approved,false)=false AND COALESCE(p.has_archival_evidence,false)=false
      AND (p.is_deceased IS TRUE OR p.is_historical IS TRUE OR p.persona='historical'
           OR p.date_of_death IS NOT NULL OR p.is_living IS FALSE));

WITH rows(query, query_type, expected_intent, expected_entity, must_include, must_exclude, notes, sort_order) AS (
  VALUES
  ($$Puzsér Róbert$$,$$person$$,$$person$$,$$Puzsér Róbert$$,'["puzsér"]'::jsonb,'[]'::jsonb,$$Entity monitoring golden$$,211),
  ($$Orosz Gergő$$,$$person$$,$$person$$,$$Orosz Gergő$$,'["orosz","gergő"]'::jsonb,'[]'::jsonb,$$Entity monitoring golden$$,212),
  ($$Sebestyén Balázs$$,$$person$$,$$person$$,$$Sebestyén Balázs$$,'["sebestyén","balázs"]'::jsonb,'[]'::jsonb,$$Entity monitoring golden$$,213),
  ($$Kadarkai Endre$$,$$person$$,$$person$$,$$Kadarkai Endre$$,'["kadarkai"]'::jsonb,'[]'::jsonb,$$Entity monitoring golden$$,214),
  ($$D. Tóth Kriszta$$,$$person$$,$$person$$,$$D. Tóth Kriszta$$,'["tóth","kriszta"]'::jsonb,'[]'::jsonb,$$Entity monitoring golden$$,215),
  ($$Gulyás Márton$$,$$person$$,$$person$$,$$Gulyás Márton$$,'["gulyás","márton"]'::jsonb,'[]'::jsonb,$$Entity monitoring golden$$,216),
  ($$Pogátsa Zoltán$$,$$person$$,$$person$$,$$Pogátsa Zoltán$$,'["pogátsa"]'::jsonb,'[]'::jsonb,$$Entity monitoring golden$$,217),
  ($$Dull Szabolcs$$,$$person$$,$$person$$,$$Dull Szabolcs$$,'["dull","szabolcs"]'::jsonb,'[]'::jsonb,$$Entity monitoring golden$$,218),
  ($$Kötter Tamás$$,$$person$$,$$person$$,$$Kötter Tamás$$,'["kötter"]'::jsonb,'[]'::jsonb,$$Entity monitoring golden$$,219),
  ($$Gundel Takács Gábor$$,$$person$$,$$person$$,$$Gundel Takács Gábor$$,'["gundel","takács"]'::jsonb,'[]'::jsonb,$$Entity monitoring golden$$,220),
  ($$Nyrt OTP$$,$$company_brand_alias$$,$$company$$,$$OTP Bank$$,'["otp"]'::jsonb,'[]'::jsonb,$$Entity monitoring alias golden$$,510),
  ($$OTP részvény árfolyam$$,$$company_brand_alias$$,$$ticker$$,$$OTP Bank$$,'["otp","részvény"]'::jsonb,'[]'::jsonb,$$Entity monitoring alias golden$$,511),
  ($$MOL Nyrt$$,$$company_brand_alias$$,$$company$$,$$MOL$$,'["mol"]'::jsonb,'[]'::jsonb,$$Entity monitoring alias golden$$,512),
  ($$Mol benzinár$$,$$company_brand_alias$$,$$company$$,$$MOL$$,'["mol","benzin"]'::jsonb,'[]'::jsonb,$$Entity monitoring alias golden$$,513),
  ($$Richter részvény$$,$$company_brand_alias$$,$$ticker$$,$$Richter Gedeon$$,'["richter","részvény"]'::jsonb,'[]'::jsonb,$$Entity monitoring alias golden$$,514),
  ($$Telekom osztalék$$,$$company_brand_alias$$,$$company$$,$$Magyar Telekom$$,'["telekom"]'::jsonb,'[]'::jsonb,$$Entity monitoring alias golden$$,515),
  ($$MTelekom$$,$$company_brand_alias$$,$$ticker$$,$$Magyar Telekom$$,'["telekom"]'::jsonb,'[]'::jsonb,$$Entity monitoring alias golden$$,516),
  ($$Opus Global$$,$$company_brand_alias$$,$$company$$,$$Opus Global$$,'["opus"]'::jsonb,'[]'::jsonb,$$Entity monitoring alias golden$$,517),
  ($$Wizz Air részvény$$,$$company_brand_alias$$,$$company$$,$$Wizz Air$$,'["wizz"]'::jsonb,'[]'::jsonb,$$Entity monitoring alias golden$$,518),
  ($$Masterplast részvény$$,$$company_brand_alias$$,$$company$$,$$Masterplast$$,'["masterplast"]'::jsonb,'[]'::jsonb,$$Entity monitoring alias golden$$,519),
  ($$Apple részvény$$,$$company_brand$$,$$ticker$$,$$Apple$$,'["apple","részvény"]'::jsonb,'[]'::jsonb,$$Entity monitoring golden$$,520),
  ($$Microsoft AI$$,$$company_brand$$,$$company$$,$$Microsoft$$,'["microsoft","ai"]'::jsonb,'[]'::jsonb,$$Entity monitoring golden$$,521),
  ($$Google kereső$$,$$company_brand$$,$$company$$,$$Google$$,'["google"]'::jsonb,'[]'::jsonb,$$Entity monitoring golden$$,522),
  ($$Meta mesterséges intelligencia$$,$$company_brand$$,$$company$$,$$Meta$$,'["meta","intelligencia"]'::jsonb,'[]'::jsonb,$$Entity monitoring golden$$,523),
  ($$OpenAI ChatGPT$$,$$company_brand$$,$$company$$,$$OpenAI$$,'["openai","chatgpt"]'::jsonb,'[]'::jsonb,$$Entity monitoring golden$$,524),
  ($$BYD elektromos autó$$,$$company_brand$$,$$company$$,$$BYD$$,'["byd","elektromos"]'::jsonb,'[]'::jsonb,$$Entity monitoring golden$$,525),
  ($$Tisza párt támogatottság$$,$$topic$$,$$topic$$,$$Tisza Párt$$,'["tisza","támogatottság"]'::jsonb,'[]'::jsonb,$$Entity monitoring topic golden$$,710),
  ($$Fidesz kampány$$,$$topic$$,$$topic$$,$$Fidesz$$,'["fidesz","kampány"]'::jsonb,'[]'::jsonb,$$Entity monitoring topic golden$$,711),
  ($$Demokratikus Koalíció választás$$,$$topic$$,$$topic$$,$$Demokratikus Koalíció$$,'["koalíció","választás"]'::jsonb,'[]'::jsonb,$$Entity monitoring topic golden$$,712),
  ($$Mi Hazánk parlament$$,$$topic$$,$$topic$$,$$Mi Hazánk$$,'["hazánk","parlament"]'::jsonb,'[]'::jsonb,$$Entity monitoring topic golden$$,713),
  ($$Momentum európai politika$$,$$topic$$,$$topic$$,$$Momentum$$,'["momentum","politika"]'::jsonb,'[]'::jsonb,$$Entity monitoring topic golden$$,714),
  ($$MNB infláció$$,$$topic$$,$$topic$$,$$MNB$$,'["mnb","infláció"]'::jsonb,'[]'::jsonb,$$Entity monitoring topic golden$$,715),
  ($$Európai Unió támogatások$$,$$topic$$,$$topic$$,$$Európai Unió$$,'["unió","támogatás"]'::jsonb,'[]'::jsonb,$$Entity monitoring topic golden$$,716),
  ($$NATO ukrajnai háború$$,$$topic$$,$$topic$$,$$NATO$$,'["nato","ukrajna"]'::jsonb,'[]'::jsonb,$$Entity monitoring topic golden$$,717),
  ($$KATA adózás$$,$$topic$$,$$topic$$,$$KATA$$,'["kata","adózás"]'::jsonb,'[]'::jsonb,$$Entity monitoring topic golden$$,718),
  ($$CSOK lakáspiac$$,$$topic$$,$$topic$$,$$CSOK$$,'["csok","lakás"]'::jsonb,'[]'::jsonb,$$Entity monitoring topic golden$$,719),
  ($$ChatGPT oktatásban$$,$$topic$$,$$topic$$,$$ChatGPT$$,'["chatgpt","oktatás"]'::jsonb,'[]'::jsonb,$$Entity monitoring topic golden$$,720),
  ($$Bitcoin árfolyam$$,$$topic$$,$$topic$$,$$Bitcoin$$,'["bitcoin","árfolyam"]'::jsonb,'[]'::jsonb,$$Entity monitoring topic golden$$,721)
)
INSERT INTO public.search_golden_queries (query, query_type, expected_intent, expected_podcast_slug, expected_entity, must_include, must_exclude, notes, active, sort_order, updated_at)
SELECT query, query_type, expected_intent, NULL, expected_entity, must_include, must_exclude, notes, true, sort_order, now() FROM rows
ON CONFLICT (query) DO UPDATE SET
  query_type=EXCLUDED.query_type, expected_intent=EXCLUDED.expected_intent,
  expected_podcast_slug=EXCLUDED.expected_podcast_slug, expected_entity=EXCLUDED.expected_entity,
  must_include=EXCLUDED.must_include, must_exclude=EXCLUDED.must_exclude,
  notes=EXCLUDED.notes, active=true, sort_order=EXCLUDED.sort_order, updated_at=now();

-- ===== smart_player_recommendation_surface LOCK =====
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'smart_player_recommendation_surface_policy',
  jsonb_build_object('version',1,'enabled',false,'public_rpc_execute',false,
    'quality_gate_required_before_public_enable',true,
    'gated_functions', jsonb_build_array(
      'public.get_related_episodes_by_embedding(uuid, integer, boolean)',
      'public.similar_episodes(uuid, integer)',
      'public.smart_player_discover(uuid, integer)')),
  now()) ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at=now();

REVOKE EXECUTE ON FUNCTION public.get_related_episodes_by_embedding(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.similar_episodes(uuid, integer) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='smart_player_discover') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.smart_player_discover(uuid, integer) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.smart_player_discover(uuid, integer) TO service_role';
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.get_related_episodes_by_embedding(uuid, integer, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.similar_episodes(uuid, integer) TO service_role;

-- ===== article pairer brand-anchor patterns v1 (narrower podcast_title_patterns) =====
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'episode_article_pairer_controls',
  jsonb_build_object('enabled',true,'policy','publisher_article_match_v1','source_version','publisher_sources_v4',
    'pattern_safety_version','brand_anchor_no_topic_words_v1',
    'patterns_policy','brand_or_show_name_only_no_topic_words',
    'blocked_generic_title_patterns', jsonb_build_array('téma','közélet','gazdaság','tech','tudomány','biznisz','forint','tőzsde','befektetés','checklist','after'),
    'batch_limit',220,'sources_per_run',3,'article_feed_item_limit',120,'max_article_fetches_per_run',40,
    'fetch_article_html',true,'recent_episode_days',90,'recent_article_days',90,
    'auto_confirm_threshold',0.82,'needs_review_threshold',0.68,
    'sources', jsonb_build_array(
      jsonb_build_object('outlet','444','feed_urls',jsonb_build_array('https://444.hu/feed'),'listing_urls',jsonb_build_array('https://444.hu/category/podcast','https://444.hu/cimke/podcast'),'podcast_title_patterns',jsonb_build_array('444','borízű','tyúkól','saját tőke','háromharmad')),
      jsonb_build_object('outlet','telex','feed_urls',jsonb_build_array('https://telex.hu/rss?tag=podcast','https://telex.hu/rss'),'listing_urls',jsonb_build_array('https://telex.hu/rovat/podcast','https://telex.hu/cimke/podcast'),'podcast_title_patterns',jsonb_build_array('telex','telex after','nyomozó podcast','ízfokozó','telex filmklub')),
      jsonb_build_object('outlet','hvg','feed_urls',jsonb_build_array('https://hvg.hu/rss','https://hvg.hu/rss/podcast'),'listing_urls',jsonb_build_array('https://hvg.hu/podcastok','https://hvg.hu/itthon/podcast','https://hvg.hu/gazdasag/podcast','https://hvg.hu/tudomany/podcast'),'podcast_title_patterns',jsonb_build_array('hvg','fülke')),
      jsonb_build_object('outlet','portfolio','feed_urls',jsonb_build_array('https://www.portfolio.hu/rss/all.xml'),'listing_urls',jsonb_build_array('https://www.portfolio.hu/podcast','https://www.portfolio.hu/uzlet/podcast'),'podcast_title_patterns',jsonb_build_array('portfolio','portfolio checklist')),
      jsonb_build_object('outlet','hold','feed_urls',jsonb_build_array('https://hold.hu/holdblog/feed/'),'listing_urls',jsonb_build_array('https://hold.hu/holdblog/','https://hold.hu/holdblog/tag/podcast/','https://hold.hu/holdblog/tag/hold-after-hours/'),'podcast_title_patterns',jsonb_build_array('hold','hold after hours','holdblog')),
      jsonb_build_object('outlet','partizan','feed_urls',jsonb_build_array('https://www.partizan.hu/rss.xml'),'listing_urls',jsonb_build_array('https://www.partizan.hu/podcastok','https://www.partizan.hu/blog'),'podcast_title_patterns',jsonb_build_array('partizán','partizan','vétó','partizán podcast','háromharmad')),
      jsonb_build_object('outlet','qubit','feed_urls',jsonb_build_array('https://qubit.hu/feed'),'listing_urls',jsonb_build_array('https://qubit.hu/tag/podcast'),'podcast_title_patterns',jsonb_build_array('qubit','qubit podcast'))
    )), now())
ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at=now();

-- ===== downstream embedding clean_text family =====
DROP FUNCTION IF EXISTS public.select_embed_chunks_candidates(text, integer);

CREATE OR REPLACE FUNCTION public.select_embed_chunks_candidates(_model text, _limit integer)
RETURNS TABLE(id uuid, podcast_id uuid, title text, display_title text, ai_summary text, description text,
  cleaned_text text, clean_source_hash text, cleaner_method text,
  topics text[], people text[], companies text[], tickers text[], ingredients text[],
  podcast_title text, podcast_display_title text, podcast_language text, podcast_tier text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH done AS (SELECT episode_id FROM public.episode_chunks WHERE model=_model GROUP BY episode_id)
  SELECT e.id, e.podcast_id, e.title, e.display_title, e.ai_summary, e.description,
    ct.cleaned_text, ct.source_hash, ct.cleaner_method,
    e.topics, e.people, e.companies, e.tickers, e.ingredients,
    p.title, p.display_title, p.language, p.shadow_rank_tier
  FROM public.episodes e
  JOIN public.podcasts p ON p.id=e.podcast_id
  JOIN public.episode_clean_text ct ON ct.episode_id=e.id
  WHERE p.is_hungarian=true AND p.language_decision='accept_hungarian'
    AND p.shadow_rank_tier IN ('S','A','B','C','D')
    AND ct.cleaner_method LIKE 'deterministic_v4%'
    AND length(trim(ct.cleaned_text)) >= 80
    AND NOT EXISTS (SELECT 1 FROM done d WHERE d.episode_id=e.id)
  ORDER BY CASE p.shadow_rank_tier WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 ELSE 4 END,
    e.published_at DESC NULLS LAST
  LIMIT _limit;
$function$;

CREATE OR REPLACE FUNCTION public.embed_chunks_candidate_stats(_model text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH clean_eligible AS (
    SELECT e.id FROM public.episodes e
    JOIN public.podcasts p ON p.id=e.podcast_id
    JOIN public.episode_clean_text ct ON ct.episode_id=e.id
    WHERE p.is_hungarian=true AND p.language_decision='accept_hungarian'
      AND p.shadow_rank_tier IN ('S','A','B','C','D')
      AND ct.cleaner_method LIKE 'deterministic_v4%'
      AND length(trim(ct.cleaned_text))>=80),
  waiting AS (
    SELECT e.id FROM public.episodes e
    JOIN public.podcasts p ON p.id=e.podcast_id
    WHERE p.is_hungarian=true AND p.language_decision='accept_hungarian'
      AND p.shadow_rank_tier IN ('S','A','B','C','D')
      AND COALESCE(e.description,'')<>''
      AND NOT EXISTS (SELECT 1 FROM public.episode_clean_text ct
        WHERE ct.episode_id=e.id AND ct.cleaner_method LIKE 'deterministic_v4%' AND length(trim(ct.cleaned_text))>=80)),
  done AS (SELECT episode_id FROM public.episode_chunks WHERE model=_model GROUP BY episode_id)
  SELECT jsonb_build_object(
    'eligible_total',(SELECT count(*) FROM clean_eligible),
    'waiting_for_clean_text',(SELECT count(*) FROM waiting),
    'already_chunked',(SELECT count(*) FROM clean_eligible e WHERE EXISTS (SELECT 1 FROM done d WHERE d.episode_id=e.id)),
    'missing',(SELECT count(*) FROM clean_eligible e WHERE NOT EXISTS (SELECT 1 FROM done d WHERE d.episode_id=e.id)),
    'total_chunks',(SELECT count(*) FROM public.episode_chunks WHERE model=_model),
    'source_policy','best_source_then_deterministic_v4_family_clean_text_then_embedding');
$function$;

CREATE OR REPLACE FUNCTION public.select_embed_episode_candidates(_model text, _limit integer)
RETURNS TABLE(id uuid, podcast_id uuid, title text, display_title text, description text, seo_description text,
  ai_summary text, topics text[], people text[], companies text[], tickers text[], ingredients text[],
  podcast_title text, podcast_display_title text, podcast_category text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_remaining int := GREATEST(1, LEAST(_limit, 200)); v_tier text; v_rec record;
BEGIN
  FOREACH v_tier IN ARRAY ARRAY['S','A','B','C']::text[] LOOP
    EXIT WHEN v_remaining <= 0;
    FOR v_rec IN
      SELECT p.id AS pid, p.title AS p_title, p.display_title AS p_display_title, p.category AS p_category
      FROM public.podcasts p
      WHERE p.rank_label=v_tier AND p.is_hungarian=true AND p.language_decision='accept_hungarian'
        AND COALESCE(p.shadow_rank_components->>'health_state','') NOT IN ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam')
      ORDER BY p.podiverzum_rank DESC NULLS LAST
    LOOP
      EXIT WHEN v_remaining <= 0;
      FOR id, podcast_id, title, display_title, description, seo_description,
          ai_summary, topics, people, companies, tickers, ingredients,
          podcast_title, podcast_display_title, podcast_category IN
        SELECT e.id, e.podcast_id, e.title, e.display_title, ct.cleaned_text, e.seo_description,
          e.ai_summary, e.topics, e.people, e.companies, e.tickers, e.ingredients,
          v_rec.p_title, v_rec.p_display_title, v_rec.p_category
        FROM public.episodes e
        JOIN public.episode_clean_text ct ON ct.episode_id=e.id
        WHERE e.podcast_id=v_rec.pid AND e.clean_text_status='done'
          AND ct.cleaner_method LIKE 'deterministic_v4%'
          AND length(trim(COALESCE(ct.cleaned_text,''))) >= 80
          AND NOT EXISTS (SELECT 1 FROM public.episode_embeddings ee WHERE ee.episode_id=e.id AND ee.model=_model)
        ORDER BY e.published_at DESC NULLS LAST LIMIT v_remaining
      LOOP RETURN NEXT; v_remaining := v_remaining - 1; EXIT WHEN v_remaining<=0; END LOOP;
    END LOOP;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.embed_episode_candidate_stats(_model text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_eligible bigint := 0; v_embedded bigint := 0;
BEGIN
  SELECT count(*) INTO v_eligible FROM public.episodes e
    JOIN public.podcasts p ON p.id=e.podcast_id
    JOIN public.episode_clean_text ct ON ct.episode_id=e.id
   WHERE p.rank_label IN ('S','A','B','C') AND p.is_hungarian=true AND p.language_decision='accept_hungarian'
     AND e.clean_text_status='done' AND ct.cleaner_method LIKE 'deterministic_v4%'
     AND length(trim(COALESCE(ct.cleaned_text,'')))>=80
     AND COALESCE(p.shadow_rank_components->>'health_state','') NOT IN ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam');
  SELECT count(*) INTO v_embedded FROM public.episode_embeddings WHERE model=_model;
  RETURN jsonb_build_object('eligible_total',v_eligible,'already_embedded',v_embedded,
    'missing_embedding',GREATEST(v_eligible-v_embedded,0),
    'source_policy','deterministic_v4_family_clean_text_only');
END;
$function$;

INSERT INTO public.app_settings (key, value, updated_at) VALUES
  ('text_processing_policy', jsonb_build_object('version','best_source_clean_text_first_v2','order',jsonb_build_array('episode_best_text_source','episode_clean_text.deterministic_v4_family','seo_ai_summary_entities','episode_chunks_embeddings'),'embedding_requires_clean_text',true,'seo_episode_requires_clean_text_or_transcript',true,'accepted_cleaner_method_prefix','deterministic_v4'), now()),
  ('legacy_embed_episode_policy', jsonb_build_object('enabled',true,'policy','deterministic_v4_family_clean_text_only','accepted_cleaner_method_prefix','deterministic_v4'), now())
ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

-- ===== similar_episodes with related_reason (DROP+REDEFINE) =====
DROP FUNCTION IF EXISTS public.similar_episodes(uuid, integer);
CREATE OR REPLACE FUNCTION public.similar_episodes(p_episode_id uuid, p_limit integer DEFAULT 6)
RETURNS TABLE(episode_id uuid, podcast_id uuid, similarity double precision,
  title text, display_title text, slug text, ai_summary text, summary text, description text,
  published_at timestamp with time zone, audio_url text, topics text[],
  podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text,
  podcast_category text, podiverzum_rank numeric, rank_label text, related_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE src_embedding vector(768); src_podcast_id uuid; src_topics text[]; src_people text[]; src_companies text[]; src_group text;
BEGIN
  SELECT ee.embedding, ee.podcast_id INTO src_embedding, src_podcast_id FROM episode_embeddings ee WHERE ee.episode_id=p_episode_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;
  SELECT COALESCE(e.topics,'{}'), COALESCE(e.people,'{}')||COALESCE(e.mentioned,'{}'), COALESCE(e.companies,'{}'),
         public.recommendation_text_group(e.title, pod.title, pod.category, e.topics)
  INTO src_topics, src_people, src_companies, src_group
  FROM episodes e JOIN podcasts pod ON pod.id=e.podcast_id WHERE e.id=p_episode_id;

  RETURN QUERY
  WITH ep_cand AS (SELECT ee.episode_id AS eid, ee.podcast_id AS pid, (1-(ee.embedding<=>src_embedding))::float AS sim
    FROM episode_embeddings ee WHERE ee.episode_id<>p_episode_id
      AND ee.podcast_id<>COALESCE(src_podcast_id,'00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY ee.embedding<=>src_embedding LIMIT 260),
  chunk_cand AS (SELECT DISTINCT ON (ec.episode_id) ec.episode_id AS eid, ec.podcast_id AS pid, (1-(ec.embedding<=>src_embedding))::float AS sim
    FROM episode_chunks ec WHERE ec.episode_id<>p_episode_id
      AND ec.podcast_id<>COALESCE(src_podcast_id,'00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY ec.episode_id, ec.embedding<=>src_embedding LIMIT 260),
  pool AS (SELECT eid, pid, max(sim) AS sim FROM (SELECT * FROM ep_cand UNION ALL SELECT * FROM chunk_cand) u GROUP BY eid, pid),
  scored AS (
    SELECT e.id AS eid, e.podcast_id AS pid, p.sim,
      e.title, e.display_title, e.slug, e.ai_summary, e.summary, e.description,
      e.published_at, e.audio_url, COALESCE(e.topics, ARRAY[]::text[]) AS topics,
      COALESCE(e.people, ARRAY[]::text[])||COALESCE(e.mentioned, ARRAY[]::text[]) AS people_all,
      COALESCE(e.companies, ARRAY[]::text[]) AS companies,
      pod.slug AS p_slug, pod.title AS p_title, pod.display_title AS p_display_title,
      pod.image_url AS p_image, pod.category AS p_category, pod.podiverzum_rank AS p_rank, pod.rank_label AS p_rank_label,
      COALESCE(array_length(ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(COALESCE(e.topics, ARRAY[]::text[]))),1),0) AS topic_overlap,
      COALESCE(array_length(ARRAY(SELECT unnest(src_people) INTERSECT SELECT unnest(COALESCE(e.people, ARRAY[]::text[])||COALESCE(e.mentioned, ARRAY[]::text[]))),1),0) AS people_overlap,
      COALESCE(array_length(ARRAY(SELECT unnest(src_companies) INTERSECT SELECT unnest(COALESCE(e.companies, ARRAY[]::text[]))),1),0) AS company_overlap,
      (p.sim
       + CASE pod.rank_label WHEN 'S' THEN 0.05 WHEN 'A' THEN 0.03 WHEN 'B' THEN 0.015 ELSE 0 END
       + LEAST(COALESCE(array_length(ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(COALESCE(e.topics, ARRAY[]::text[]))),1),0)*0.05, 0.15)
       + LEAST(COALESCE(array_length(ARRAY(SELECT unnest(src_people) INTERSECT SELECT unnest(COALESCE(e.people, ARRAY[]::text[])||COALESCE(e.mentioned, ARRAY[]::text[]))),1),0)*0.08, 0.20)
       + LEAST(COALESCE(array_length(ARRAY(SELECT unnest(src_companies) INTERSECT SELECT unnest(COALESCE(e.companies, ARRAY[]::text[]))),1),0)*0.07, 0.18)
      )::float AS fscore
    FROM pool p JOIN episodes e ON e.id=p.eid JOIN podcasts pod ON pod.id=e.podcast_id
    WHERE pod.is_hungarian=true AND pod.language_decision='accept_hungarian'
      AND COALESCE(pod.rss_status,'healthy') NOT IN ('failed','inactive') AND e.audio_url IS NOT NULL
      AND public.recommendation_is_compatible(src_group,
        public.recommendation_text_group(e.title, pod.title, pod.category, e.topics), p.sim,
        public.recommendation_has_content_bridge(src_topics, e.topics, src_people,
          COALESCE(e.people, ARRAY[]::text[])||COALESCE(e.mentioned, ARRAY[]::text[]), src_companies, e.companies))),
  diversified AS (SELECT s.*, row_number() OVER (PARTITION BY s.pid ORDER BY s.fscore DESC) AS rn_per_pod FROM scored s)
  SELECT d.eid, d.pid, d.sim,
    d.title, d.display_title, d.slug, d.ai_summary, d.summary, d.description,
    d.published_at, d.audio_url, d.topics,
    d.p_slug, d.p_title, d.p_display_title, d.p_image, d.p_category,
    d.p_rank, d.p_rank_label,
    CASE WHEN d.people_overlap>0 THEN 'Kapcsolódó személyek alapján.'
         WHEN d.company_overlap>0 THEN 'Kapcsolódó szervezet vagy márka alapján.'
         WHEN d.topic_overlap>0 THEN 'Hasonló témák: ' || array_to_string((ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(d.topics)))[1:3], ', ')
         WHEN d.sim>=0.82 THEN 'Erős tartalmi közelség az epizód-index alapján.'
         ELSE 'Tartalmilag rokon epizód.' END AS related_reason
  FROM diversified d WHERE d.rn_per_pod=1 AND d.sim>=0.50
  ORDER BY d.fscore DESC LIMIT GREATEST(p_limit,1);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.similar_episodes(uuid, integer) TO service_role;

INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'recommendation_diagnostics_policy',
  jsonb_build_object('version',1,'related_reason_required',true,
    'applies_to', jsonb_build_array('get_related_episodes_by_embedding','similar_episodes','personalized-home-rails'),
    'reason_sources', jsonb_build_array('shared_people','shared_companies','shared_topics','strong_clean_text_embedding_similarity'),
    'public_surface_locked_until_quality_trusted', true),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();
