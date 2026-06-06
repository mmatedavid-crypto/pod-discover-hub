-- entity_monitoring_benchmark v3 policy (skipping the duplicate 60-golden seed; v2 + 4 of these already inserted)
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'entity_monitoring_benchmark_policy',
  jsonb_build_object('version',3,'source_table','search_golden_queries',
    'required_query_types', jsonb_build_array('person','company_brand','company_brand_alias','topic'),
    'min_active_entity_queries',60,'min_active_query_types',4,'requires_expected_entity',true,
    'cadence','weekly_with_search_benchmark','quality_policy','entity_monitoring_benchmark_v3',
    'seed_set','managed_entity_monitoring_v3_20260606'),
  now()) ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at=now();

-- Add the v3-specific new goldens that weren't in v2
WITH rows(query, query_type, expected_intent, expected_entity, must_include, must_exclude, notes, sort_order) AS (
  VALUES
  ($$Vona Gábor podcast$$,$$person$$,$$person$$,$$Vona Gábor$$,'["vona","gábor"]'::jsonb,'[]'::jsonb,$$v3 golden$$,225),
  ($$Hajdú Péter interjú$$,$$person$$,$$person$$,$$Hajdú Péter$$,'["hajdú","péter"]'::jsonb,'[]'::jsonb,$$v3 golden$$,226),
  ($$Yettel Magyarország$$,$$company_brand$$,$$company$$,$$Yettel$$,'["yettel"]'::jsonb,'[]'::jsonb,$$v3 golden$$,530),
  ($$Aldi akció$$,$$company_brand$$,$$company$$,$$Aldi$$,'["aldi"]'::jsonb,'[]'::jsonb,$$v3 golden$$,531),
  ($$Lidl árstop$$,$$company_brand$$,$$company$$,$$Lidl$$,'["lidl"]'::jsonb,'[]'::jsonb,$$v3 golden$$,532),
  ($$Tesla önvezetés$$,$$company_brand$$,$$company$$,$$Tesla$$,'["tesla"]'::jsonb,'[]'::jsonb,$$v3 golden$$,533),
  ($$magyar akkumulátorgyár vita$$,$$topic$$,$$topic$$,$$Akkumulátorgyár$$,'["akkumulátor","vita"]'::jsonb,'[]'::jsonb,$$v3 topic golden$$,726),
  ($$rezsicsökkentés energiaár$$,$$topic$$,$$topic$$,$$Rezsi$$,'["rezsi","energia"]'::jsonb,'[]'::jsonb,$$v3 topic golden$$,727),
  ($$mesterséges intelligencia szabályozás$$,$$topic$$,$$topic$$,$$Mesterséges intelligencia$$,'["intelligencia","szabályozás"]'::jsonb,'[]'::jsonb,$$v3 topic golden$$,728),
  ($$forint árfolyam euró$$,$$topic$$,$$topic$$,$$Forint$$,'["forint","euró"]'::jsonb,'[]'::jsonb,$$v3 topic golden$$,729)
)
INSERT INTO public.search_golden_queries (query, query_type, expected_intent, expected_podcast_slug, expected_entity, must_include, must_exclude, notes, active, sort_order, updated_at)
SELECT query, query_type, expected_intent, NULL, expected_entity, must_include, must_exclude, notes, true, sort_order, now() FROM rows
ON CONFLICT (query) DO UPDATE SET
  query_type=EXCLUDED.query_type, expected_intent=EXCLUDED.expected_intent,
  expected_entity=EXCLUDED.expected_entity, must_include=EXCLUDED.must_include,
  must_exclude=EXCLUDED.must_exclude, notes=EXCLUDED.notes, active=true,
  sort_order=EXCLUDED.sort_order, updated_at=now();

-- article pairer brand-anchor v2 (overrides chunk 4 with v2 pattern_safety_version)
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'episode_article_pairer_controls',
  jsonb_build_object('enabled',true,'policy','publisher_article_match_v1','source_version','publisher_sources_v4',
    'pattern_safety_version','brand_anchor_no_topic_words_v2',
    'patterns_policy','brand_or_show_name_only_no_topic_words',
    'blocked_generic_title_patterns', jsonb_build_array('téma','közélet','gazdaság','tech','tudomány','biznisz','forint','tőzsde','befektetés','checklist','after')),
  now()) ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at=now();

-- downstream embedding clean text v3 policy refresh
INSERT INTO public.app_settings (key, value, updated_at) VALUES
  ('text_processing_policy', jsonb_build_object('version','best_source_clean_text_first_v3','accepted_cleaner_method_prefix','deterministic_v4','reasserted_by','20260606014000','embedding_requires_clean_text',true), now()),
  ('legacy_embed_episode_policy', jsonb_build_object('enabled',true,'policy','deterministic_v4_family_clean_text_only','accepted_cleaner_method_prefix','deterministic_v4','reasserted_by','20260606014000'), now())
ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at=now();

-- person bio topic-only v4
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'person_bio_generation_policy',
  jsonb_build_object('version',4,'temporal_topic_only_skip',true,'requires_manual_or_archival_exception',true,
    'input_hash_required',true,'unchanged_input_skip_before_job',true,
    'topic_only_no_job_allocation',true,
    'observation_copy_rule','Without explicit role evidence, bios may only describe topic/mention context, never guest/host participation. No AI job is allocated for evidence-free persons.',
    'edge_function','person-bio-generator'),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

-- recommendation diagnostics v4
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'recommendation_diagnostics_policy',
  jsonb_build_object('version',4,'related_reason_required',true,
    'personalized_home_rails_seed_reason_required',true,
    'personalized_home_rails_seed_source','similar_episodes',
    'personalized_home_rails_main_reason_required',true,
    'personalized_home_rails_main_source','match_episodes_by_user_history',
    'personalized_home_rails_main_min_similarity',0.18,
    'reason_sources', jsonb_build_array('shared_people','shared_companies','shared_topics','strong_clean_text_embedding_similarity'),
    'applies_to', jsonb_build_array('get_related_episodes_by_embedding','similar_episodes','match_episodes_by_user_history','personalized-home-rails')),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

-- news sitemap connector 404 guard
UPDATE public.app_settings
SET value = value || jsonb_build_object(
    'google_submit_status', NULL,
    'google_submit_reason','lovable_gsc_connector_route_missing_404',
    'google_submit_method','PUT','submit_needed', true,
    'connector_route_missing_status', 404),
  updated_at=now()
WHERE key='news_sitemap_state' AND value->>'google_submit_status'='404';

INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'news_sitemap_connector_404_guard_policy',
  jsonb_build_object('version',1,'rule','Connector route 404 stays separate from google_submit_status.','submit_needed_remains',true),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();
