-- ===== 20260606001000 merge_organizations safe_merge_v2 =====
ALTER TABLE public.canonical_alias_backfill_log DROP CONSTRAINT IF EXISTS canonical_alias_backfill_log_action_check;
ALTER TABLE public.canonical_alias_backfill_log
  ADD CONSTRAINT canonical_alias_backfill_log_action_check
  CHECK (action = ANY (ARRAY['renamed','collision_skipped','noop','merged']));

CREATE OR REPLACE FUNCTION public.merge_organizations(p_src uuid, p_dst uuid, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_src_name text; v_src_slug text; v_dst_name text; v_dst_slug text;
  v_moved_eom int := 0; v_dropped_eom int := 0; v_moved_jobs int := 0;
  v_moved_alias int := 0; v_dropped_alias int := 0;
BEGIN
  IF p_src = p_dst THEN RAISE EXCEPTION 'merge_organizations: src equals dst (%)', p_src; END IF;
  SELECT name, slug INTO v_src_name, v_src_slug FROM organizations WHERE id=p_src;
  SELECT name, slug INTO v_dst_name, v_dst_slug FROM organizations WHERE id=p_dst;
  IF v_src_name IS NULL THEN RAISE EXCEPTION 'merge_organizations: src not found (%)', p_src; END IF;
  IF v_dst_name IS NULL THEN RAISE EXCEPTION 'merge_organizations: dst not found (%)', p_dst; END IF;

  UPDATE episode_organization_map dst SET role='primary'
  FROM episode_organization_map src
  WHERE dst.organization_id=p_dst AND src.organization_id=p_src
    AND src.episode_id=dst.episode_id AND src.role='primary' AND dst.role<>'primary';

  WITH del AS (DELETE FROM episode_organization_map
    WHERE organization_id=p_src
      AND episode_id IN (SELECT episode_id FROM episode_organization_map WHERE organization_id=p_dst)
    RETURNING 1)
  SELECT count(*) INTO v_dropped_eom FROM del;

  UPDATE episode_organization_map SET organization_id=p_dst WHERE organization_id=p_src;
  GET DIAGNOSTICS v_moved_eom = ROW_COUNT;

  UPDATE org_ai_review_jobs SET organization_id=p_dst WHERE organization_id=p_src;
  GET DIAGNOSTICS v_moved_jobs = ROW_COUNT;

  WITH del AS (DELETE FROM organization_aliases
    WHERE organization_id=p_src
      AND normalized_alias IN (SELECT normalized_alias FROM organization_aliases WHERE organization_id<>p_src)
    RETURNING 1)
  SELECT count(*) INTO v_dropped_alias FROM del;

  UPDATE organization_aliases SET organization_id=p_dst WHERE organization_id=p_src;
  GET DIAGNOSTICS v_moved_alias = ROW_COUNT;

  INSERT INTO organization_aliases (organization_id, alias, normalized_alias, source, confidence, status)
  SELECT p_dst, v_src_name, lower(btrim(regexp_replace(v_src_name,'\s+',' ','g'))), 'merge', 1.0, 'verified'
  WHERE NOT EXISTS (SELECT 1 FROM organization_aliases
    WHERE normalized_alias=lower(btrim(regexp_replace(v_src_name,'\s+',' ','g'))));

  UPDATE organizations dst SET
    wikidata_id=COALESCE(dst.wikidata_id, src.wikidata_id),
    wikipedia_url=COALESCE(dst.wikipedia_url, src.wikipedia_url),
    wikipedia_title=COALESCE(dst.wikipedia_title, src.wikipedia_title),
    wikipedia_extract=COALESCE(dst.wikipedia_extract, src.wikipedia_extract),
    wikipedia_description=COALESCE(dst.wikipedia_description, src.wikipedia_description),
    logo_url=COALESCE(dst.logo_url, src.logo_url),
    short_description_hu=COALESCE(dst.short_description_hu, src.short_description_hu),
    ai_bio=COALESCE(dst.ai_bio, src.ai_bio)
  FROM organizations src WHERE dst.id=p_dst AND src.id=p_src;

  DELETE FROM organizations WHERE id=p_src;

  INSERT INTO canonical_alias_backfill_log (entity_kind, entity_id, current_name, current_slug, canonical_name, canonical_slug, action, note)
  VALUES ('organization', p_dst, v_src_name, v_src_slug, v_dst_name, v_dst_slug, 'merged',
    COALESCE(p_note,'') || format(' [safe_merge_v2 moved_eom=%s dropped_eom=%s jobs=%s moved_alias=%s dropped_alias=%s]',
      v_moved_eom, v_dropped_eom, v_moved_jobs, v_moved_alias, v_dropped_alias));

  UPDATE organizations dst SET
    episode_count=COALESCE((SELECT count(DISTINCT episode_id) FROM episode_organization_map WHERE organization_id=p_dst),0),
    mention_count=COALESCE((SELECT count(*) FROM episode_organization_map WHERE organization_id=p_dst),0),
    primary_count=COALESCE((SELECT count(*) FROM episode_organization_map WHERE organization_id=p_dst AND role='primary'),0),
    podcast_count=COALESCE((SELECT count(DISTINCT podcast_id) FROM episode_organization_map WHERE organization_id=p_dst),0),
    updated_at=now()
  WHERE id=p_dst;

  RETURN jsonb_build_object('version','safe_merge_v2','src',p_src,'dst',p_dst,'src_name',v_src_name,'dst_name',v_dst_name,
    'moved_eom',v_moved_eom,'dropped_eom',v_dropped_eom,'moved_jobs',v_moved_jobs,
    'moved_alias',v_moved_alias,'dropped_alias',v_dropped_alias);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.merge_organizations(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_organizations(uuid, uuid, text) TO service_role;

INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'canonical_alias_merge_policy',
  jsonb_build_object('version',2,'rpc','public.merge_organizations(uuid,uuid,text)','mode','manual_service_role_only',
    'evidence_preservation','primary role preserved, duplicates dropped','log_action','merged'),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

-- ===== person_bio_generation_policy v2 + v3 =====
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'person_bio_generation_policy',
  jsonb_build_object('version',3,'temporal_topic_only_skip',true,'requires_manual_or_archival_exception',true,
    'input_hash_required',true,'unchanged_input_skip_before_job',true,'unchanged_input_estimated_cost_usd',0,
    'observation_copy_rule','Without explicit role evidence, generated person bios may only describe topic/mention context.',
    'edge_function','person-bio-generator'),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

-- ===== personalized home rails seed + main reason policy v3 =====
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'recommendation_diagnostics_policy',
  jsonb_build_object('version',3,'related_reason_required',true,
    'personalized_home_rails_seed_reason_required',true,
    'personalized_home_rails_seed_source','similar_episodes',
    'personalized_home_rails_main_reason_required',true,
    'personalized_home_rails_main_source','match_episodes_by_user_history',
    'personalized_home_rails_main_min_similarity',0.18,
    'applies_to',jsonb_build_array('get_related_episodes_by_embedding','similar_episodes','match_episodes_by_user_history','personalized-home-rails')),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

-- ===== entity_monitoring v2 + 12 new goldens =====
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'entity_monitoring_benchmark_policy',
  jsonb_build_object('version',2,'source_table','search_golden_queries',
    'required_query_types', jsonb_build_array('person','company_brand','company_brand_alias','topic'),
    'min_active_entity_queries',50,'min_active_query_types',4,'requires_expected_entity',true,
    'cadence','weekly_with_search_benchmark','quality_policy','entity_monitoring_benchmark_v2'),
  now()) ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at=now();

WITH rows(query, query_type, expected_intent, expected_entity, must_include, must_exclude, notes, sort_order) AS (
  VALUES
  ($$Friderikusz Sándor$$,$$person$$,$$person$$,$$Friderikusz Sándor$$,'["friderikusz"]'::jsonb,'[]'::jsonb,$$v2 golden$$,221),
  ($$Hajós András$$,$$person$$,$$person$$,$$Hajós András$$,'["hajós"]'::jsonb,'[]'::jsonb,$$v2 golden$$,222),
  ($$Szalay Dániel média$$,$$person$$,$$person$$,$$Szalay Dániel$$,'["szalay","média"]'::jsonb,'[]'::jsonb,$$v2 golden$$,223),
  ($$Litkai Gergely podcast$$,$$person$$,$$person$$,$$Litkai Gergely$$,'["litkai"]'::jsonb,'[]'::jsonb,$$v2 golden$$,224),
  ($$MBH Bank$$,$$company_brand_alias$$,$$company$$,$$MBH Bank$$,'["mbh"]'::jsonb,'[]'::jsonb,$$v2 alias golden$$,526),
  ($$4iG részvény$$,$$company_brand_alias$$,$$ticker$$,$$4iG$$,'["4ig","részvény"]'::jsonb,'[]'::jsonb,$$v2 alias golden$$,527),
  ($$AutoWallis árfolyam$$,$$company_brand_alias$$,$$ticker$$,$$AutoWallis$$,'["autowallis","árfolyam"]'::jsonb,'[]'::jsonb,$$v2 alias golden$$,528),
  ($$Graphisoft építészet$$,$$company_brand$$,$$company$$,$$Graphisoft$$,'["graphisoft"]'::jsonb,'[]'::jsonb,$$v2 golden$$,529),
  ($$Petőfi Sándor podcast beszélgetés$$,$$topic$$,$$topic$$,$$Petőfi Sándor$$,'["petőfi"]'::jsonb,'[]'::jsonb,$$v2 topic golden$$,722),
  ($$Kossuth Lajos történelem$$,$$topic$$,$$topic$$,$$Kossuth Lajos$$,'["kossuth"]'::jsonb,'[]'::jsonb,$$v2 topic golden$$,723),
  ($$Liszt Ferenc zene$$,$$topic$$,$$topic$$,$$Liszt Ferenc$$,'["liszt","zene"]'::jsonb,'[]'::jsonb,$$v2 topic golden$$,724),
  ($$Semmelweis Ignác orvostörténet$$,$$topic$$,$$topic$$,$$Semmelweis Ignác$$,'["semmelweis"]'::jsonb,'[]'::jsonb,$$v2 topic golden$$,725)
)
INSERT INTO public.search_golden_queries (query, query_type, expected_intent, expected_podcast_slug, expected_entity, must_include, must_exclude, notes, active, sort_order, updated_at)
SELECT query, query_type, expected_intent, NULL, expected_entity, must_include, must_exclude, notes, true, sort_order, now() FROM rows
ON CONFLICT (query) DO UPDATE SET
  query_type=EXCLUDED.query_type, expected_intent=EXCLUDED.expected_intent,
  expected_podcast_slug=EXCLUDED.expected_podcast_slug, expected_entity=EXCLUDED.expected_entity,
  must_include=EXCLUDED.must_include, must_exclude=EXCLUDED.must_exclude,
  notes=EXCLUDED.notes, active=true, sort_order=EXCLUDED.sort_order, updated_at=now();
