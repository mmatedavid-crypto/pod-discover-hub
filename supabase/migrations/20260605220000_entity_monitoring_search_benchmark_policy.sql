-- B2B/entity monitoring needs its own search benchmark coverage, not only
-- consumer podcast-title queries. The existing search_golden_queries table
-- already stores entity-driven rows; this policy makes that coverage explicit.

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
