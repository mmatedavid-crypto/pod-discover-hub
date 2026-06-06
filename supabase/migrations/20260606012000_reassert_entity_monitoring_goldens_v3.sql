-- Reassert the entity-monitoring benchmark with a self-contained seed set.
-- Production had the policy setting but no active expected_entity goldens in
-- the four monitored query types, so this migration does not rely on earlier
-- seed migrations having been applied.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'entity_monitoring_benchmark_policy',
  jsonb_build_object(
    'version', 3,
    'source_table', 'search_golden_queries',
    'required_query_types', jsonb_build_array('person', 'company_brand', 'company_brand_alias', 'topic'),
    'min_active_entity_queries', 60,
    'min_active_query_types', 4,
    'requires_expected_entity', true,
    'person_scope_rule', 'Active person monitoring goldens must represent living/current podcast people or public figures with podcast-person evidence; deceased or historical figures are topic goldens unless manually approved as archival profiles.',
    'deceased_person_handling', 'Do not benchmark a deceased/historical figure as a podcast person. If the catalogue only contains episodes about the figure, measure the query as topic/entity context, not guest/host monitoring.',
    'cadence', 'weekly_with_search_benchmark',
    'quality_policy', 'entity_monitoring_benchmark_v3: B2B brand/person/topic monitoring must be covered by at least 60 active golden queries with expected_entity labels, all four entity query types, and no dead/historical person monitoring targets.',
    'seed_set', 'managed_entity_monitoring_v3_20260606',
    'note', 'The v3 seed set is self-contained because production can have policy settings without active expected_entity goldens.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

UPDATE public.search_golden_queries q
SET query_type = 'topic',
    expected_intent = COALESCE(NULLIF(q.expected_intent, 'person'), 'topic'),
    notes = concat_ws(
      ' ',
      q.notes,
      'ENTITY_MONITORING_SCOPE_V3: deceased/historical figures are topic/entity-context goldens, not podcast-person monitoring goldens unless manually approved as archival profiles.'
    ),
    updated_at = now()
WHERE COALESCE(q.active, true) = true
  AND q.query_type = 'person'
  AND q.expected_entity IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM public.people p
    WHERE lower(p.name) = lower(q.expected_entity)
      AND COALESCE(p.manual_approved, false) = false
      AND COALESCE(p.has_archival_evidence, false) = false
      AND (
        p.is_deceased IS TRUE
        OR p.is_historical IS TRUE
        OR p.persona = 'historical'
        OR p.date_of_death IS NOT NULL
        OR p.is_living IS FALSE
      )
  );

WITH rows(query, query_type, expected_intent, expected_entity, must_include, must_exclude, notes, sort_order) AS (
  VALUES
  ($$Puzsér Róbert$$, $$person$$, $$person$$, $$Puzsér Róbert$$, '["puzsér"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: active Hungarian public commentator / podcast person.$$ , 211),
  ($$Orosz Gergő$$, $$person$$, $$person$$, $$Orosz Gergő$$, '["orosz", "gergő"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: tech/startup person query.$$ , 212),
  ($$Sebestyén Balázs$$, $$person$$, $$person$$, $$Sebestyén Balázs$$, '["sebestyén", "balázs"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: media person query.$$ , 213),
  ($$Kadarkai Endre$$, $$person$$, $$person$$, $$Kadarkai Endre$$, '["kadarkai"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: interview/podcast person query.$$ , 214),
  ($$D. Tóth Kriszta$$, $$person$$, $$person$$, $$D. Tóth Kriszta$$, '["tóth", "kriszta"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: media/interview person query.$$ , 215),
  ($$Gulyás Márton$$, $$person$$, $$person$$, $$Gulyás Márton$$, '["gulyás", "márton"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: public affairs podcast person query.$$ , 216),
  ($$Pogátsa Zoltán$$, $$person$$, $$person$$, $$Pogátsa Zoltán$$, '["pogátsa"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: economy/public affairs person query.$$ , 217),
  ($$Dull Szabolcs$$, $$person$$, $$person$$, $$Dull Szabolcs$$, '["dull", "szabolcs"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: journalist/public affairs person query.$$ , 218),
  ($$Kötter Tamás$$, $$person$$, $$person$$, $$Kötter Tamás$$, '["kötter"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: public conversation person query.$$ , 219),
  ($$Gundel Takács Gábor$$, $$person$$, $$person$$, $$Gundel Takács Gábor$$, '["gundel", "takács"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: media person query.$$ , 220),
  ($$Friderikusz Sándor$$, $$person$$, $$person$$, $$Friderikusz Sándor$$, '["friderikusz"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: active Hungarian media/interview podcast person query.$$ , 221),
  ($$Hajós András$$, $$person$$, $$person$$, $$Hajós András$$, '["hajós"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: active Hungarian media/personality query.$$ , 222),
  ($$Szalay Dániel média$$, $$person$$, $$person$$, $$Szalay Dániel$$, '["szalay", "média"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: media/public-affairs person query.$$ , 223),
  ($$Litkai Gergely podcast$$, $$person$$, $$person$$, $$Litkai Gergely$$, '["litkai"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: comedy/culture podcast person query.$$ , 224),
  ($$Vona Gábor podcast$$, $$person$$, $$person$$, $$Vona Gábor$$, '["vona", "gábor"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: current public-affairs podcast person query.$$ , 225),
  ($$Hajdú Péter interjú$$, $$person$$, $$person$$, $$Hajdú Péter$$, '["hajdú", "péter"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: current media/interview person query.$$ , 226),

  ($$Nyrt OTP$$, $$company_brand_alias$$, $$company$$, $$OTP Bank$$, '["otp"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 alias golden: legal suffix / ticker-style OTP mention.$$ , 510),
  ($$OTP részvény árfolyam$$, $$company_brand_alias$$, $$ticker$$, $$OTP Bank$$, '["otp", "részvény"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 alias golden: OTP stock-market mention.$$ , 511),
  ($$MOL Nyrt$$, $$company_brand_alias$$, $$company$$, $$MOL$$, '["mol"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 alias golden: MOL legal-name variant.$$ , 512),
  ($$Mol benzinár$$, $$company_brand_alias$$, $$company$$, $$MOL$$, '["mol", "benzin"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 alias golden: lowercase brand/topic mention.$$ , 513),
  ($$Richter részvény$$, $$company_brand_alias$$, $$ticker$$, $$Richter Gedeon$$, '["richter", "részvény"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 alias golden: pharma stock mention.$$ , 514),
  ($$Telekom osztalék$$, $$company_brand_alias$$, $$company$$, $$Magyar Telekom$$, '["telekom"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 alias golden: Magyar Telekom short brand mention.$$ , 515),
  ($$MTelekom$$, $$company_brand_alias$$, $$ticker$$, $$Magyar Telekom$$, '["telekom"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 alias golden: ticker-like Magyar Telekom mention.$$ , 516),
  ($$Opus Global$$, $$company_brand_alias$$, $$company$$, $$Opus Global$$, '["opus"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 alias golden: Opus company mention.$$ , 517),
  ($$Wizz Air részvény$$, $$company_brand_alias$$, $$company$$, $$Wizz Air$$, '["wizz"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 alias golden: airline stock/company mention.$$ , 518),
  ($$Masterplast részvény$$, $$company_brand_alias$$, $$company$$, $$Masterplast$$, '["masterplast"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 alias golden: BÉT company mention.$$ , 519),
  ($$Apple részvény$$, $$company_brand$$, $$ticker$$, $$Apple$$, '["apple", "részvény"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: global tech brand with Hungarian stock intent.$$ , 520),
  ($$Microsoft AI$$, $$company_brand$$, $$company$$, $$Microsoft$$, '["microsoft", "ai"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: global tech company plus topic.$$ , 521),
  ($$Google kereső$$, $$company_brand$$, $$company$$, $$Google$$, '["google"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: global platform company mention.$$ , 522),
  ($$Meta mesterséges intelligencia$$, $$company_brand$$, $$company$$, $$Meta$$, '["meta", "intelligencia"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: platform company and AI topic.$$ , 523),
  ($$OpenAI ChatGPT$$, $$company_brand$$, $$company$$, $$OpenAI$$, '["openai", "chatgpt"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: AI company/product mention.$$ , 524),
  ($$BYD elektromos autó$$, $$company_brand$$, $$company$$, $$BYD$$, '["byd", "elektromos"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: EV company mention.$$ , 525),
  ($$MBH Bank$$, $$company_brand_alias$$, $$company$$, $$MBH Bank$$, '["mbh"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 alias golden: Hungarian bank brand mention.$$ , 526),
  ($$4iG részvény$$, $$company_brand_alias$$, $$ticker$$, $$4iG$$, '["4ig", "részvény"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 alias golden: BÉT technology/company stock mention.$$ , 527),
  ($$AutoWallis árfolyam$$, $$company_brand_alias$$, $$ticker$$, $$AutoWallis$$, '["autowallis", "árfolyam"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 alias golden: Hungarian listed company query.$$ , 528),
  ($$Graphisoft építészet$$, $$company_brand$$, $$company$$, $$Graphisoft$$, '["graphisoft"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: Hungarian technology brand mention.$$ , 529),
  ($$Yettel Magyarország$$, $$company_brand$$, $$company$$, $$Yettel$$, '["yettel"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: telecom brand mention.$$ , 530),
  ($$Aldi akció$$, $$company_brand$$, $$company$$, $$Aldi$$, '["aldi"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: retail brand mention.$$ , 531),
  ($$Lidl árstop$$, $$company_brand$$, $$company$$, $$Lidl$$, '["lidl"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: retail brand and policy topic mention.$$ , 532),
  ($$Tesla önvezetés$$, $$company_brand$$, $$company$$, $$Tesla$$, '["tesla"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 golden: EV/technology company mention.$$ , 533),

  ($$Tisza párt támogatottság$$, $$topic$$, $$topic$$, $$Tisza Párt$$, '["tisza", "támogatottság"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: political organization context, not podcast show title.$$ , 710),
  ($$Fidesz kampány$$, $$topic$$, $$topic$$, $$Fidesz$$, '["fidesz", "kampány"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: political organization context.$$ , 711),
  ($$Demokratikus Koalíció választás$$, $$topic$$, $$topic$$, $$Demokratikus Koalíció$$, '["koalíció", "választás"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: party name and election context.$$ , 712),
  ($$Mi Hazánk parlament$$, $$topic$$, $$topic$$, $$Mi Hazánk$$, '["hazánk", "parlament"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: party/institution context.$$ , 713),
  ($$Momentum európai politika$$, $$topic$$, $$topic$$, $$Momentum$$, '["momentum", "politika"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: political organization context.$$ , 714),
  ($$MNB infláció$$, $$topic$$, $$topic$$, $$MNB$$, '["mnb", "infláció"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: institution and macro topic.$$ , 715),
  ($$Európai Unió támogatások$$, $$topic$$, $$topic$$, $$Európai Unió$$, '["unió", "támogatás"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: institution context.$$ , 716),
  ($$NATO ukrajnai háború$$, $$topic$$, $$topic$$, $$NATO$$, '["nato", "ukrajna"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: alliance/geopolitics context.$$ , 717),
  ($$KATA adózás$$, $$topic$$, $$topic$$, $$KATA$$, '["kata", "adózás"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: tax-policy entity context.$$ , 718),
  ($$CSOK lakáspiac$$, $$topic$$, $$topic$$, $$CSOK$$, '["csok", "lakás"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: housing-policy entity context.$$ , 719),
  ($$ChatGPT oktatásban$$, $$topic$$, $$topic$$, $$ChatGPT$$, '["chatgpt", "oktatás"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: product/topic context.$$ , 720),
  ($$Bitcoin árfolyam$$, $$topic$$, $$topic$$, $$Bitcoin$$, '["bitcoin", "árfolyam"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: crypto asset context.$$ , 721),
  ($$Petőfi Sándor podcast beszélgetés$$, $$topic$$, $$topic$$, $$Petőfi Sándor$$, '["petőfi"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: deceased/historical figure context, not a podcast-person target.$$ , 722),
  ($$Kossuth Lajos történelem$$, $$topic$$, $$topic$$, $$Kossuth Lajos$$, '["kossuth"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: deceased/historical figure context, not a podcast-person target.$$ , 723),
  ($$Liszt Ferenc zene$$, $$topic$$, $$topic$$, $$Liszt Ferenc$$, '["liszt", "zene"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: deceased/historical figure context, not a podcast-person target.$$ , 724),
  ($$Semmelweis Ignác orvostörténet$$, $$topic$$, $$topic$$, $$Semmelweis Ignác$$, '["semmelweis"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: deceased/historical figure context, not a podcast-person target.$$ , 725),
  ($$magyar akkumulátorgyár vita$$, $$topic$$, $$topic$$, $$Akkumulátorgyár$$, '["akkumulátor", "vita"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: industrial policy/entity context.$$ , 726),
  ($$rezsicsökkentés energiaár$$, $$topic$$, $$topic$$, $$Rezsi$$, '["rezsi", "energia"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: public-policy entity context.$$ , 727),
  ($$mesterséges intelligencia szabályozás$$, $$topic$$, $$topic$$, $$Mesterséges intelligencia$$, '["intelligencia", "szabályozás"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: AI policy topic context.$$ , 728),
  ($$forint árfolyam euró$$, $$topic$$, $$topic$$, $$Forint$$, '["forint", "euró"]'::jsonb, '[]'::jsonb, $$Entity monitoring v3 topic golden: currency/markets topic context.$$ , 729)
)
INSERT INTO public.search_golden_queries (
  query, query_type, expected_intent, expected_podcast_slug, expected_entity,
  must_include, must_exclude, notes, active, sort_order, updated_at
)
SELECT
  query, query_type, expected_intent, NULL, expected_entity,
  must_include, must_exclude, notes, true, sort_order, now()
FROM rows
ON CONFLICT (query) DO UPDATE
SET query_type = EXCLUDED.query_type,
    expected_intent = EXCLUDED.expected_intent,
    expected_podcast_slug = EXCLUDED.expected_podcast_slug,
    expected_entity = EXCLUDED.expected_entity,
    must_include = EXCLUDED.must_include,
    must_exclude = EXCLUDED.must_exclude,
    notes = EXCLUDED.notes,
    active = true,
    sort_order = EXCLUDED.sort_order,
    updated_at = now();

DO $$
DECLARE
  v_entity_count integer;
  v_type_count integer;
  v_dead_person_count integer;
BEGIN
  SELECT count(*), count(DISTINCT query_type)
  INTO v_entity_count, v_type_count
  FROM public.search_golden_queries
  WHERE COALESCE(active, true) = true
    AND expected_entity IS NOT NULL
    AND query_type IN ('person', 'company_brand', 'company_brand_alias', 'topic');

  IF v_entity_count < 60 THEN
    RAISE EXCEPTION 'entity_monitoring_benchmark_v3 expected at least 60 active entity goldens, got %', v_entity_count;
  END IF;

  IF v_type_count < 4 THEN
    RAISE EXCEPTION 'entity_monitoring_benchmark_v3 expected all four active entity query types, got %', v_type_count;
  END IF;

  SELECT count(*)
  INTO v_dead_person_count
  FROM public.search_golden_queries q
  JOIN public.people p ON lower(p.name) = lower(q.expected_entity)
  WHERE COALESCE(q.active, true) = true
    AND q.query_type = 'person'
    AND q.expected_entity IS NOT NULL
    AND COALESCE(p.manual_approved, false) = false
    AND COALESCE(p.has_archival_evidence, false) = false
    AND (
      p.is_deceased IS TRUE
      OR p.is_historical IS TRUE
      OR p.persona = 'historical'
      OR p.date_of_death IS NOT NULL
      OR p.is_living IS FALSE
    );

  IF v_dead_person_count > 0 THEN
    RAISE EXCEPTION 'entity_monitoring_benchmark_v3 found % dead/historical person monitoring goldens', v_dead_person_count;
  END IF;
END $$;
