-- Reassert the entity-monitoring benchmark after the initial policy migration
-- was deployed before the golden-query seed was added.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'entity_monitoring_benchmark_policy',
  jsonb_build_object(
    'version', 1,
    'source_table', 'search_golden_queries',
    'required_query_types', jsonb_build_array('person', 'company_brand', 'company_brand_alias', 'topic'),
    'min_active_entity_queries', 40,
    'min_active_query_types', 3,
    'requires_expected_entity', true,
    'person_scope_rule', 'Active person monitoring goldens must represent living/current podcast people or public figures with podcast-person evidence; deceased or historical figures are topic goldens unless manually approved as archival profiles.',
    'deceased_person_handling', 'Do not benchmark a deceased/historical figure as a podcast person. If the catalogue only contains episodes about the figure, measure the query as topic/entity context, not guest/host monitoring.',
    'cadence', 'weekly_with_search_benchmark',
    'quality_policy', 'entity_monitoring_benchmark_v1: brand/person/party/topic monitoring must be covered by active golden queries with expected_entity labels; dead/historical people are not person-monitoring targets without manual archival approval.',
    'note', 'B2B mention monitoring quality is measured through entity-specific golden queries before broader monitoring surfaces are trusted.'
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
      'ENTITY_MONITORING_SCOPE: deceased/historical figures are topic/entity-context goldens, not podcast-person monitoring goldens unless manually approved as archival profiles.'
    ),
    updated_at = now()
WHERE q.active IS TRUE
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
  ($$Puzsér Róbert$$, $$person$$, $$person$$, $$Puzsér Róbert$$, '["puzsér"]'::jsonb, '[]'::jsonb, $$Entity monitoring golden: active Hungarian public commentator / podcast person.$$ , 211),
  ($$Orosz Gergő$$, $$person$$, $$person$$, $$Orosz Gergő$$, '["orosz", "gergő"]'::jsonb, '[]'::jsonb, $$Entity monitoring golden: tech/startup person query.$$ , 212),
  ($$Sebestyén Balázs$$, $$person$$, $$person$$, $$Sebestyén Balázs$$, '["sebestyén", "balázs"]'::jsonb, '[]'::jsonb, $$Entity monitoring golden: media person query.$$ , 213),
  ($$Kadarkai Endre$$, $$person$$, $$person$$, $$Kadarkai Endre$$, '["kadarkai"]'::jsonb, '[]'::jsonb, $$Entity monitoring golden: interview/podcast person query.$$ , 214),
  ($$D. Tóth Kriszta$$, $$person$$, $$person$$, $$D. Tóth Kriszta$$, '["tóth", "kriszta"]'::jsonb, '[]'::jsonb, $$Entity monitoring golden: media/interview person query.$$ , 215),
  ($$Gulyás Márton$$, $$person$$, $$person$$, $$Gulyás Márton$$, '["gulyás", "márton"]'::jsonb, '[]'::jsonb, $$Entity monitoring golden: public affairs podcast person query.$$ , 216),
  ($$Pogátsa Zoltán$$, $$person$$, $$person$$, $$Pogátsa Zoltán$$, '["pogátsa"]'::jsonb, '[]'::jsonb, $$Entity monitoring golden: economy/public affairs person query.$$ , 217),
  ($$Dull Szabolcs$$, $$person$$, $$person$$, $$Dull Szabolcs$$, '["dull", "szabolcs"]'::jsonb, '[]'::jsonb, $$Entity monitoring golden: journalist/public affairs person query.$$ , 218),
  ($$Kötter Tamás$$, $$person$$, $$person$$, $$Kötter Tamás$$, '["kötter"]'::jsonb, '[]'::jsonb, $$Entity monitoring golden: public conversation person query.$$ , 219),
  ($$Gundel Takács Gábor$$, $$person$$, $$person$$, $$Gundel Takács Gábor$$, '["gundel", "takács"]'::jsonb, '[]'::jsonb, $$Entity monitoring golden: media person query.$$ , 220),

  ($$Nyrt OTP$$, $$company_brand_alias$$, $$company$$, $$OTP Bank$$, '["otp"]'::jsonb, '[]'::jsonb, $$Entity monitoring alias golden: legal suffix / ticker-style OTP mention.$$ , 510),
  ($$OTP részvény árfolyam$$, $$company_brand_alias$$, $$ticker$$, $$OTP Bank$$, '["otp", "részvény"]'::jsonb, '[]'::jsonb, $$Entity monitoring alias golden: OTP stock-market mention.$$ , 511),
  ($$MOL Nyrt$$, $$company_brand_alias$$, $$company$$, $$MOL$$, '["mol"]'::jsonb, '[]'::jsonb, $$Entity monitoring alias golden: MOL legal-name variant.$$ , 512),
  ($$Mol benzinár$$, $$company_brand_alias$$, $$company$$, $$MOL$$, '["mol", "benzin"]'::jsonb, '[]'::jsonb, $$Entity monitoring alias golden: lowercase brand/topic mention.$$ , 513),
  ($$Richter részvény$$, $$company_brand_alias$$, $$ticker$$, $$Richter Gedeon$$, '["richter", "részvény"]'::jsonb, '[]'::jsonb, $$Entity monitoring alias golden: pharma stock mention.$$ , 514),
  ($$Telekom osztalék$$, $$company_brand_alias$$, $$company$$, $$Magyar Telekom$$, '["telekom"]'::jsonb, '[]'::jsonb, $$Entity monitoring alias golden: Magyar Telekom short brand mention.$$ , 515),
  ($$MTelekom$$, $$company_brand_alias$$, $$ticker$$, $$Magyar Telekom$$, '["telekom"]'::jsonb, '[]'::jsonb, $$Entity monitoring alias golden: ticker-like Magyar Telekom mention.$$ , 516),
  ($$Opus Global$$, $$company_brand_alias$$, $$company$$, $$Opus Global$$, '["opus"]'::jsonb, '[]'::jsonb, $$Entity monitoring alias golden: Opus company mention.$$ , 517),
  ($$Wizz Air részvény$$, $$company_brand_alias$$, $$company$$, $$Wizz Air$$, '["wizz"]'::jsonb, '[]'::jsonb, $$Entity monitoring alias golden: airline stock/company mention.$$ , 518),
  ($$Masterplast részvény$$, $$company_brand_alias$$, $$company$$, $$Masterplast$$, '["masterplast"]'::jsonb, '[]'::jsonb, $$Entity monitoring alias golden: BÉT company mention.$$ , 519),
  ($$Apple részvény$$, $$company_brand$$, $$ticker$$, $$Apple$$, '["apple", "részvény"]'::jsonb, '[]'::jsonb, $$Entity monitoring golden: global tech brand with Hungarian stock intent.$$ , 520),
  ($$Microsoft AI$$, $$company_brand$$, $$company$$, $$Microsoft$$, '["microsoft", "ai"]'::jsonb, '[]'::jsonb, $$Entity monitoring golden: global tech company plus topic.$$ , 521),
  ($$Google kereső$$, $$company_brand$$, $$company$$, $$Google$$, '["google"]'::jsonb, '[]'::jsonb, $$Entity monitoring golden: global platform company mention.$$ , 522),
  ($$Meta mesterséges intelligencia$$, $$company_brand$$, $$company$$, $$Meta$$, '["meta", "intelligencia"]'::jsonb, '[]'::jsonb, $$Entity monitoring golden: platform company and AI topic.$$ , 523),
  ($$OpenAI ChatGPT$$, $$company_brand$$, $$company$$, $$OpenAI$$, '["openai", "chatgpt"]'::jsonb, '[]'::jsonb, $$Entity monitoring golden: AI company/product mention.$$ , 524),
  ($$BYD elektromos autó$$, $$company_brand$$, $$company$$, $$BYD$$, '["byd", "elektromos"]'::jsonb, '[]'::jsonb, $$Entity monitoring golden: EV company mention.$$ , 525),

  ($$Tisza párt támogatottság$$, $$topic$$, $$topic$$, $$Tisza Párt$$, '["tisza", "támogatottság"]'::jsonb, '[]'::jsonb, $$Entity monitoring topic golden: political organization context, not podcast show title.$$ , 710),
  ($$Fidesz kampány$$, $$topic$$, $$topic$$, $$Fidesz$$, '["fidesz", "kampány"]'::jsonb, '[]'::jsonb, $$Entity monitoring topic golden: political organization context.$$ , 711),
  ($$Demokratikus Koalíció választás$$, $$topic$$, $$topic$$, $$Demokratikus Koalíció$$, '["koalíció", "választás"]'::jsonb, '[]'::jsonb, $$Entity monitoring topic golden: party name and election context.$$ , 712),
  ($$Mi Hazánk parlament$$, $$topic$$, $$topic$$, $$Mi Hazánk$$, '["hazánk", "parlament"]'::jsonb, '[]'::jsonb, $$Entity monitoring topic golden: party/institution context.$$ , 713),
  ($$Momentum európai politika$$, $$topic$$, $$topic$$, $$Momentum$$, '["momentum", "politika"]'::jsonb, '[]'::jsonb, $$Entity monitoring topic golden: political organization context.$$ , 714),
  ($$MNB infláció$$, $$topic$$, $$topic$$, $$MNB$$, '["mnb", "infláció"]'::jsonb, '[]'::jsonb, $$Entity monitoring topic golden: institution and macro topic.$$ , 715),
  ($$Európai Unió támogatások$$, $$topic$$, $$topic$$, $$Európai Unió$$, '["unió", "támogatás"]'::jsonb, '[]'::jsonb, $$Entity monitoring topic golden: institution context.$$ , 716),
  ($$NATO ukrajnai háború$$, $$topic$$, $$topic$$, $$NATO$$, '["nato", "ukrajna"]'::jsonb, '[]'::jsonb, $$Entity monitoring topic golden: alliance/geopolitics context.$$ , 717),
  ($$KATA adózás$$, $$topic$$, $$topic$$, $$KATA$$, '["kata", "adózás"]'::jsonb, '[]'::jsonb, $$Entity monitoring topic golden: tax-policy entity context.$$ , 718),
  ($$CSOK lakáspiac$$, $$topic$$, $$topic$$, $$CSOK$$, '["csok", "lakás"]'::jsonb, '[]'::jsonb, $$Entity monitoring topic golden: housing-policy entity context.$$ , 719),
  ($$ChatGPT oktatásban$$, $$topic$$, $$topic$$, $$ChatGPT$$, '["chatgpt", "oktatás"]'::jsonb, '[]'::jsonb, $$Entity monitoring topic golden: product/topic context.$$ , 720),
  ($$Bitcoin árfolyam$$, $$topic$$, $$topic$$, $$Bitcoin$$, '["bitcoin", "árfolyam"]'::jsonb, '[]'::jsonb, $$Entity monitoring topic golden: crypto asset context.$$ , 721)
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
