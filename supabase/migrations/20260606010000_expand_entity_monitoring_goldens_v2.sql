-- Expand entity monitoring goldens so the production quality gate is
-- satisfied by this managed seed set instead of relying on older rows.

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'entity_monitoring_benchmark_policy',
  jsonb_build_object(
    'version', 2,
    'source_table', 'search_golden_queries',
    'required_query_types', jsonb_build_array('person', 'company_brand', 'company_brand_alias', 'topic'),
    'min_active_entity_queries', 50,
    'min_active_query_types', 4,
    'requires_expected_entity', true,
    'person_scope_rule', 'Active person monitoring goldens must represent living/current podcast people or public figures with podcast-person evidence; deceased or historical figures are topic goldens unless manually approved as archival profiles.',
    'deceased_person_handling', 'Do not benchmark a deceased/historical figure as a podcast person. If the catalogue only contains episodes about the figure, measure the query as topic/entity context, not guest/host monitoring.',
    'cadence', 'weekly_with_search_benchmark',
    'quality_policy', 'entity_monitoring_benchmark_v2: brand/person/party/topic monitoring must be covered by at least 50 active golden queries with expected_entity labels and all four entity query types; dead/historical people are not person-monitoring targets without manual archival approval.',
    'note', 'The v2 seed set removes reliance on pre-existing production rows for the active entity monitoring threshold.'
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
      'ENTITY_MONITORING_SCOPE_V2: deceased/historical figures are topic/entity-context goldens, not podcast-person monitoring goldens unless manually approved as archival profiles.'
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
  ($$Friderikusz Sándor$$, $$person$$, $$person$$, $$Friderikusz Sándor$$, '["friderikusz"]'::jsonb, '[]'::jsonb, $$Entity monitoring v2 golden: active Hungarian media/interview podcast person query.$$ , 221),
  ($$Hajós András$$, $$person$$, $$person$$, $$Hajós András$$, '["hajós"]'::jsonb, '[]'::jsonb, $$Entity monitoring v2 golden: active Hungarian media/personality query.$$ , 222),
  ($$Szalay Dániel média$$, $$person$$, $$person$$, $$Szalay Dániel$$, '["szalay", "média"]'::jsonb, '[]'::jsonb, $$Entity monitoring v2 golden: media/public-affairs person query.$$ , 223),
  ($$Litkai Gergely podcast$$, $$person$$, $$person$$, $$Litkai Gergely$$, '["litkai"]'::jsonb, '[]'::jsonb, $$Entity monitoring v2 golden: comedy/culture podcast person query.$$ , 224),

  ($$MBH Bank$$, $$company_brand_alias$$, $$company$$, $$MBH Bank$$, '["mbh"]'::jsonb, '[]'::jsonb, $$Entity monitoring v2 alias golden: Hungarian bank brand mention.$$ , 526),
  ($$4iG részvény$$, $$company_brand_alias$$, $$ticker$$, $$4iG$$, '["4ig", "részvény"]'::jsonb, '[]'::jsonb, $$Entity monitoring v2 alias golden: BÉT technology/company stock mention.$$ , 527),
  ($$AutoWallis árfolyam$$, $$company_brand_alias$$, $$ticker$$, $$AutoWallis$$, '["autowallis", "árfolyam"]'::jsonb, '[]'::jsonb, $$Entity monitoring v2 alias golden: Hungarian listed company query.$$ , 528),
  ($$Graphisoft építészet$$, $$company_brand$$, $$company$$, $$Graphisoft$$, '["graphisoft"]'::jsonb, '[]'::jsonb, $$Entity monitoring v2 golden: Hungarian technology brand mention.$$ , 529),

  ($$Petőfi Sándor podcast beszélgetés$$, $$topic$$, $$topic$$, $$Petőfi Sándor$$, '["petőfi"]'::jsonb, '[]'::jsonb, $$Entity monitoring v2 topic golden: deceased/historical figure context, not a podcast-person target.$$ , 722),
  ($$Kossuth Lajos történelem$$, $$topic$$, $$topic$$, $$Kossuth Lajos$$, '["kossuth"]'::jsonb, '[]'::jsonb, $$Entity monitoring v2 topic golden: deceased/historical figure context, not a podcast-person target.$$ , 723),
  ($$Liszt Ferenc zene$$, $$topic$$, $$topic$$, $$Liszt Ferenc$$, '["liszt", "zene"]'::jsonb, '[]'::jsonb, $$Entity monitoring v2 topic golden: deceased/historical figure context, not a podcast-person target.$$ , 724),
  ($$Semmelweis Ignác orvostörténet$$, $$topic$$, $$topic$$, $$Semmelweis Ignác$$, '["semmelweis"]'::jsonb, '[]'::jsonb, $$Entity monitoring v2 topic golden: deceased/historical figure context, not a podcast-person target.$$ , 725)
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
