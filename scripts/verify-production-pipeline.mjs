import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL. Use a read-only Postgres connection string.");
  process.exit(1);
}

const sql = `
WITH accepted_hu AS (
  SELECT e.id
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  WHERE p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
    AND COALESCE(e.description, '') <> ''
),
clean_counts AS (
  SELECT
    count(*) FILTER (WHERE ct.cleaner_method = 'deterministic_v4') AS deterministic_v4,
    count(*) FILTER (WHERE ct.cleaner_method LIKE 'deterministic_v4%') AS deterministic_v4_family,
    count(*) FILTER (WHERE ct.cleaner_method = 'deterministic_v3') AS deterministic_v3,
    count(*) FILTER (WHERE ct.cleaner_method IS NOT NULL) AS any_clean
  FROM accepted_hu h
  LEFT JOIN public.episode_clean_text ct ON ct.episode_id = h.id
),
best_source_counts AS (
  SELECT
    count(*) AS total,
    count(*) FILTER (WHERE b.source_type = 'article') AS article,
    count(*) FILTER (WHERE b.source_type = 'youtube') AS youtube,
    count(*) FILTER (WHERE b.source_type = 'rss') AS rss,
    count(*) FILTER (WHERE b.source_type = 'spotify') AS spotify
  FROM accepted_hu h
  JOIN public.episode_best_text_source b ON b.episode_id = h.id
),
candidate_counts AS (
  SELECT
    count(*) AS total,
    count(*) FILTER (WHERE quality_status = 'passed') AS passed,
    count(*) FILTER (WHERE quality_status = 'passed' AND promoted_at IS NULL) AS passed_pending,
    count(*) FILTER (WHERE quality_status = 'passed' AND promoted_at IS NOT NULL) AS passed_already_promoted,
    count(*) FILTER (WHERE quality_status = 'rejected') AS rejected,
    count(*) FILTER (WHERE promoted_at IS NOT NULL) AS promoted
  FROM public.episode_clean_text_candidates
),
settings AS (
  SELECT jsonb_object_agg(key, value) AS setting_values
  FROM public.app_settings
  WHERE key IN (
    'clean_text_autopilot',
    'episode_clean_text_candidate_progress',
    'episode_article_pairer_controls',
    'episode_article_pairer_progress',
    'episode_best_text_source_controls',
    'episode_best_text_source_progress',
    'episode_clean_text_controls',
    'episode_clean_text_progress',
    'news_sitemap_refresh_controls',
    'news_sitemap_state',
    'public_ai_language_guard_policy',
    'related_episode_quality_policy',
    'entity_monitoring_benchmark_policy',
    'people_hub_identity_safety_policy',
    'temporal_person_public_guard_policy',
    'text_processing_policy'
  )
),
controls AS (
  SELECT jsonb_build_object(
    'clean_text_autopilot', jsonb_build_object(
      'enabled', setting_values->'clean_text_autopilot'->'enabled',
      'dry_run', setting_values->'clean_text_autopilot'->'dry_run',
      'stage_limit', setting_values->'clean_text_autopilot'->'stage_limit',
      'candidate_batch', setting_values->'clean_text_autopilot'->'candidate_batch',
      'promote_limit', setting_values->'clean_text_autopilot'->'promote_limit',
      'last_run_at', setting_values->'clean_text_autopilot'->'last_run_at',
      'last_candidates', setting_values->'clean_text_autopilot'->'last_candidates',
      'last_promotion', setting_values->'clean_text_autopilot'->'last_promotion',
      'consecutive_errors', setting_values->'clean_text_autopilot'->'consecutive_errors',
      'spend_today_usd', setting_values->'clean_text_autopilot'->'spend_today_usd'
    ),
    'episode_clean_text_candidate_progress', jsonb_build_object(
      'method', setting_values->'episode_clean_text_candidate_progress'->'method',
      'processed', setting_values->'episode_clean_text_candidate_progress'->'processed',
      'passed', setting_values->'episode_clean_text_candidate_progress'->'passed',
      'rejected', setting_values->'episode_clean_text_candidate_progress'->'rejected',
      'runtime_ms', setting_values->'episode_clean_text_candidate_progress'->'runtime_ms',
      'last_run_at', setting_values->'episode_clean_text_candidate_progress'->'last_run_at'
    ),
    'episode_article_pairer_controls', setting_values->'episode_article_pairer_controls',
    'episode_article_pairer_progress', setting_values->'episode_article_pairer_progress',
    'episode_best_text_source_controls', setting_values->'episode_best_text_source_controls',
    'episode_best_text_source_progress', setting_values->'episode_best_text_source_progress',
    'episode_clean_text_controls', setting_values->'episode_clean_text_controls',
    'episode_clean_text_progress', setting_values->'episode_clean_text_progress',
    'news_sitemap_refresh_controls', setting_values->'news_sitemap_refresh_controls',
    'news_sitemap_state', setting_values->'news_sitemap_state',
    'public_ai_language_guard_policy', setting_values->'public_ai_language_guard_policy',
    'related_episode_quality_policy', setting_values->'related_episode_quality_policy',
    'entity_monitoring_benchmark_policy', setting_values->'entity_monitoring_benchmark_policy',
    'people_hub_identity_safety_policy', setting_values->'people_hub_identity_safety_policy',
    'temporal_person_public_guard_policy', setting_values->'temporal_person_public_guard_policy'
  ) AS summary
  FROM settings
),
rpc_shapes AS (
  SELECT
    pg_get_function_result(p.oid) AS result
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'select_embed_chunks_candidates'
    AND pg_get_function_arguments(p.oid) = '_model text, _limit integer'
  LIMIT 1
)
SELECT jsonb_build_object(
  'generated_at', now(),
  'migration_gates', jsonb_build_object(
    'pipeline_health_rpc', to_regprocedure('public.get_pipeline_health_snapshot_v1()') IS NOT NULL,
    'text_processing_policy', EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'text_processing_policy'),
    'legacy_embed_episode_policy', EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'legacy_embed_episode_policy'),
    'embed_chunks_returns_clean_text', COALESCE((SELECT result ILIKE '%cleaned_text text%' AND result ILIKE '%cleaner_method text%' FROM rpc_shapes), false),
    'canonical_alias_table', to_regclass('public.canonical_entity_aliases') IS NOT NULL,
    'canonical_alias_normalizer', to_regprocedure('public.normalize_entity_alias(text)') IS NOT NULL,
    'canonical_alias_resolver', to_regprocedure('public.resolve_canonical_entity_alias(text,text)') IS NOT NULL,
    'canonical_alias_policy', EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'canonical_alias_policy'),
    'temporal_person_guard_policy_v6', COALESCE((SELECT (value->>'version')::int >= 6 FROM public.app_settings WHERE key = 'temporal_person_public_guard_policy'), false),
    'no_public_unapproved_dead_or_historical_people', NOT EXISTS (
      SELECT 1
      FROM public.people p
      WHERE (p.is_public IS TRUE OR p.is_indexable IS TRUE OR p.is_browsable_in_people_hub IS TRUE)
        AND COALESCE(p.manual_approved, false) = false
        AND COALESCE(p.has_archival_evidence, false) = false
        AND (
          p.is_deceased IS TRUE
          OR p.is_historical IS TRUE
          OR p.persona = 'historical'
          OR p.date_of_death IS NOT NULL
          OR p.is_living IS FALSE
        )
    ),
    'no_public_unapproved_suspicious_temporal_participants', NOT EXISTS (
      SELECT 1
      FROM public.people p
      WHERE (p.is_public IS TRUE OR p.is_indexable IS TRUE OR p.is_browsable_in_people_hub IS TRUE)
        AND COALESCE(p.manual_approved, false) = false
        AND COALESCE(p.has_archival_evidence, false) = false
        AND COALESCE(p.is_deceased, false) = false
        AND COALESCE(p.is_historical, false) = false
        AND COALESCE(p.persona, '') <> 'historical'
        AND (p.date_of_death IS NOT NULL OR p.is_living IS FALSE)
        AND (
          COALESCE(p.participant_count, 0)
          + COALESCE(p.host_count, 0)
          + COALESCE(p.guest_count, 0)
        ) > 0
    )
  ),
  'clean_text_backfill_gates', jsonb_build_object(
    'legacy_v3_requeue_rpc', to_regprocedure('public.requeue_legacy_clean_text_v4_backfill(integer,text[])') IS NOT NULL,
    'runner_uses_best_text_source', (SELECT setting_values->'episode_clean_text_controls'->>'use_best_text_source' = 'true' FROM settings),
    'legacy_v3_backfill_quality_gated', (SELECT
      setting_values->'episode_clean_text_controls'->>'legacy_v3_backfill_mode' = 'manual_canary_only'
      AND setting_values->'episode_clean_text_controls'->>'quality_gate_required_before_global_backfill' = 'true'
      AND setting_values->'text_processing_policy'->>'clean_text_backfill_status' = 'frozen_pending_quality_proof'
    FROM settings),
    'method_version_v4', (SELECT setting_values->'episode_clean_text_controls'->>'method_version' = 'deterministic_v4' FROM settings)
  ),
  'article_pipeline', jsonb_build_object(
    'table_exists', to_regclass('public.episode_article_candidates') IS NOT NULL,
    'controls_configured', (SELECT setting_values->'episode_article_pairer_controls' IS NOT NULL FROM settings),
    'sources_v3_configured', (SELECT setting_values->'episode_article_pairer_controls'->>'source_version' IN ('publisher_sources_v3', 'publisher_sources_v4') FROM settings),
    'sources_v4_configured', (SELECT setting_values->'episode_article_pairer_controls'->>'source_version' = 'publisher_sources_v4' FROM settings),
    'multi_source_run_configured', (SELECT COALESCE((setting_values->'episode_article_pairer_controls'->>'sources_per_run')::int, 1) >= 2 FROM settings),
    'source_count_at_least_6', (SELECT jsonb_array_length(COALESCE(setting_values->'episode_article_pairer_controls'->'sources', '[]'::jsonb)) >= 6 FROM settings),
    'best_source_article_policy', (SELECT setting_values->'episode_best_text_source_controls'->>'policy' = 'best_text_source_v2_confirmed_article_youtube_first'
      AND setting_values->'episode_best_text_source_controls' ? 'article_min_confidence' FROM settings),
    'pairer_has_run', (SELECT COALESCE(length(setting_values->'episode_article_pairer_progress'->>'last_run_at') > 0, false) FROM settings),
    'pairer_scanned_articles', (SELECT COALESCE((setting_values->'episode_article_pairer_progress'->>'scanned_articles')::int > 0, false) FROM settings),
    'pairer_uses_regex_xml_parser', (SELECT COALESCE(setting_values->'episode_article_pairer_progress'->>'parser_policy' = 'regex_xml_no_domparser_v2', false) FROM settings),
    'pairer_records_write_verification', (SELECT COALESCE(setting_values->'episode_article_pairer_progress' ? 'verified_upsert_rows', false) FROM settings),
    'pairer_records_total_candidates', (SELECT COALESCE(setting_values->'episode_article_pairer_progress' ? 'total_article_candidates', false) FROM settings),
    'pairer_no_domparser_error', (SELECT COALESCE((setting_values->'episode_article_pairer_progress'->'source_diagnostics')::text NOT ILIKE '%DOMParser is not defined%', false) FROM settings),
    'best_source_accepts_article', EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
      WHERE n.nspname = 'public'
        AND t.relname = 'episode_best_text_source'
        AND c.conname = 'episode_best_text_source_source_type_check'
      AND pg_get_constraintdef(c.oid) ILIKE '%article%'
    )
  ),
  'seo_news_sitemap', jsonb_build_object(
    'refresh_controls_configured', (SELECT setting_values->'news_sitemap_refresh_controls' IS NOT NULL FROM settings),
    'refresh_cadence_15m', (SELECT (setting_values->'news_sitemap_refresh_controls'->>'cadence_minutes')::int = 15 FROM settings),
    'google_submit_new_url_gated', (SELECT setting_values->'news_sitemap_refresh_controls'->>'google_submit_policy' = 'submit_only_when_news_sitemap_has_new_urls' FROM settings),
    'google_submit_uses_lovable_connector', (SELECT setting_values->'news_sitemap_refresh_controls'->>'submit_transport' = 'lovable_google_search_console_connector_gateway' FROM settings),
    'connector_secrets_recorded', (SELECT
      setting_values->'news_sitemap_refresh_controls'->'requires_connector_secrets' ? 'LOVABLE_API_KEY'
      AND setting_values->'news_sitemap_refresh_controls'->'requires_connector_secrets' ? 'GOOGLE_SEARCH_CONSOLE_API_KEY'
      AND NOT (setting_values->'news_sitemap_refresh_controls' ? 'requires_google_secrets')
    FROM settings),
    'state_exists', (SELECT setting_values->'news_sitemap_state' IS NOT NULL FROM settings),
    'state_has_hash', (SELECT COALESCE(length(setting_values->'news_sitemap_state'->>'hash') > 0, false) FROM settings),
    'state_tracks_urls', (SELECT setting_values->'news_sitemap_state' ? 'urls' FROM settings),
    'state_has_source_counts', (SELECT setting_values->'news_sitemap_state' ? 'source_counts' FROM settings),
    'state_not_legacy_google_ping', (SELECT NOT (setting_values->'news_sitemap_state' ? 'google_ping_status') FROM settings),
    'submit_not_known_404', (SELECT COALESCE((setting_values->'news_sitemap_state'->>'google_submit_status')::int <> 404, true) FROM settings),
    'submit_policy_recorded', (SELECT setting_values->'news_sitemap_state' ? 'submit_needed' FROM settings),
    'new_url_submit_not_blocked_by_credentials', (SELECT NOT (
      COALESCE((setting_values->'news_sitemap_state'->>'submit_needed')::boolean, false)
      AND COALESCE(setting_values->'news_sitemap_state'->>'google_submit_reason', '') ILIKE 'missing%credentials'
    ) FROM settings)
  ),
  'public_ai_language_guard', jsonb_build_object(
    'sql_guard_function_exists', to_regprocedure('public.is_hungarianish_public_ai_text(text)') IS NOT NULL,
    'episode_trigger_function_exists', to_regprocedure('public.enforce_hu_episode_public_ai_text()') IS NOT NULL,
    'podcast_trigger_function_exists', to_regprocedure('public.enforce_hu_podcast_public_ai_text()') IS NOT NULL,
    'episode_trigger_exists', EXISTS (
      SELECT 1
      FROM pg_trigger tr
      JOIN pg_class c ON c.oid = tr.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'episodes'
        AND tr.tgname = 'trg_enforce_hu_episode_public_ai_text'
        AND NOT tr.tgisinternal
    ),
    'podcast_trigger_exists', EXISTS (
      SELECT 1
      FROM pg_trigger tr
      JOIN pg_class c ON c.oid = tr.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'podcasts'
        AND tr.tgname = 'trg_enforce_hu_podcast_public_ai_text'
        AND NOT tr.tgisinternal
    ),
    'policy_configured_v3', (SELECT (setting_values->'public_ai_language_guard_policy'->>'version')::int >= 3 FROM settings),
    'episode_ai_summary_data_clean', NOT EXISTS (
      SELECT 1
      FROM public.episodes e
      JOIN public.podcasts p ON p.id = e.podcast_id
      WHERE (p.is_hungarian = true OR p.language_decision = 'accept_hungarian')
        AND e.ai_summary IS NOT NULL
        AND length(trim(e.ai_summary)) >= 20
        AND NOT public.is_hungarianish_public_ai_text(e.ai_summary)
      LIMIT 1
    ),
    'episode_seo_title_data_clean', NOT EXISTS (
      SELECT 1
      FROM public.episodes e
      JOIN public.podcasts p ON p.id = e.podcast_id
      WHERE (p.is_hungarian = true OR p.language_decision = 'accept_hungarian')
        AND e.seo_title IS NOT NULL
        AND length(trim(e.seo_title)) >= 20
        AND NOT public.is_hungarianish_public_ai_text(e.seo_title)
      LIMIT 1
    ),
    'episode_seo_description_data_clean', NOT EXISTS (
      SELECT 1
      FROM public.episodes e
      JOIN public.podcasts p ON p.id = e.podcast_id
      WHERE (p.is_hungarian = true OR p.language_decision = 'accept_hungarian')
        AND e.seo_description IS NOT NULL
        AND length(trim(e.seo_description)) >= 20
        AND NOT public.is_hungarianish_public_ai_text(e.seo_description)
      LIMIT 1
    ),
    'podcast_seo_title_data_clean', NOT EXISTS (
      SELECT 1
      FROM public.podcasts p
      WHERE (p.is_hungarian = true OR p.language_decision = 'accept_hungarian')
        AND p.seo_title IS NOT NULL
        AND length(trim(p.seo_title)) >= 20
        AND NOT public.is_hungarianish_public_ai_text(p.seo_title)
      LIMIT 1
    ),
    'podcast_seo_description_data_clean', NOT EXISTS (
      SELECT 1
      FROM public.podcasts p
      WHERE (p.is_hungarian = true OR p.language_decision = 'accept_hungarian')
        AND p.seo_description IS NOT NULL
        AND length(trim(p.seo_description)) >= 20
        AND NOT public.is_hungarianish_public_ai_text(p.seo_description)
      LIMIT 1
    )
  ),
  'related_episode_quality', jsonb_build_object(
    'compatibility_function_exists', to_regprocedure('public.recommendation_is_compatible(text,text,double precision,boolean)') IS NOT NULL,
    'text_group_function_exists', to_regprocedure('public.recommendation_text_group(text,text,text,text[])') IS NOT NULL,
    'topic_bridge_function_exists', to_regprocedure('public.recommendation_has_topic_bridge(text[],text[])') IS NOT NULL,
    'content_bridge_function_exists', to_regprocedure('public.recommendation_has_content_bridge(text[],text[],text[],text[],text[],text[])') IS NOT NULL,
    'policy_configured_v4', (SELECT (setting_values->'related_episode_quality_policy'->>'version')::int >= 4 FROM settings),
    'policy_configured_v5', (SELECT (setting_values->'related_episode_quality_policy'->>'version')::int >= 5 FROM settings),
    'religion_cross_group_hard_block_recorded', (SELECT setting_values->'related_episode_quality_policy'->>'religion_cross_group' = 'hard_block' FROM settings),
    'different_specific_groups_require_bridge_recorded', (SELECT setting_values->'related_episode_quality_policy'->>'different_specific_groups' = 'explicit_bridge_required' FROM settings),
    'specific_to_general_bridge_required_recorded', (SELECT setting_values->'related_episode_quality_policy'->>'specific_to_general' = 'explicit_bridge_required' FROM settings),
    'political_context_override_recorded', (SELECT setting_values->'related_episode_quality_policy' ? 'public_affairs_override_terms' FROM settings),
    'public_affairs_title_with_isten_runtime_grouped', false,
    'religion_cross_group_runtime_blocked', false,
    'cross_world_vector_without_bridge_blocked', false,
    'cross_world_with_entity_bridge_allowed', false
  ),
  'people_hub_identity_safety', jsonb_build_object(
    'policy_configured_v2', (SELECT (setting_values->'people_hub_identity_safety_policy'->>'version')::int >= 2 FROM settings),
    'prerender_bio_rule_recorded', (SELECT setting_values->'people_hub_identity_safety_policy' ? 'prerender_bio_rule' FROM settings),
    'list_people_hub_has_identity_fields', EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'list_people_hub'
        AND oidvectortypes(p.proargtypes) = 'integer, integer, text'
        AND pg_get_function_result(p.oid) ILIKE '%identity_ambiguous boolean%'
        AND pg_get_function_result(p.oid) ILIKE '%ai_bio_status text%'
        AND pg_get_function_result(p.oid) ILIKE '%wikipedia_match_confidence numeric%'
    ),
    'list_people_alpha_has_identity_fields', EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'list_people_alpha'
        AND oidvectortypes(p.proargtypes) = 'text, integer, integer'
        AND pg_get_function_result(p.oid) ILIKE '%identity_ambiguous boolean%'
        AND pg_get_function_result(p.oid) ILIKE '%ai_bio_status text%'
        AND pg_get_function_result(p.oid) ILIKE '%wikipedia_match_confidence numeric%'
    )
  ),
  'entity_monitoring_benchmark', jsonb_build_object(
    'policy_configured_v1', (SELECT (setting_values->'entity_monitoring_benchmark_policy'->>'version')::int >= 1 FROM settings),
    'requires_expected_entity_recorded', (SELECT COALESCE((setting_values->'entity_monitoring_benchmark_policy'->>'requires_expected_entity')::boolean, false) FROM settings),
    'deceased_person_handling_recorded', (SELECT COALESCE(setting_values->'entity_monitoring_benchmark_policy' ? 'deceased_person_handling', false) FROM settings),
    'person_scope_rule_recorded', (SELECT COALESCE(setting_values->'entity_monitoring_benchmark_policy' ? 'person_scope_rule', false) FROM settings),
    'active_entity_golden_queries_at_least_40', (
      SELECT count(*) >= 40
      FROM public.search_golden_queries
      WHERE COALESCE(active, true) = true
        AND expected_entity IS NOT NULL
        AND query_type IN ('person', 'company_brand', 'company_brand_alias', 'topic')
    ),
    'active_entity_query_types_at_least_3', (
      SELECT count(DISTINCT query_type) >= 3
      FROM public.search_golden_queries
      WHERE COALESCE(active, true) = true
        AND expected_entity IS NOT NULL
        AND query_type IN ('person', 'company_brand', 'company_brand_alias', 'topic')
    ),
    'person_monitoring_goldens_present', EXISTS (
      SELECT 1 FROM public.search_golden_queries
      WHERE COALESCE(active, true) = true AND expected_entity IS NOT NULL AND query_type = 'person'
    ),
    'no_deceased_or_historical_person_monitoring_goldens', NOT EXISTS (
      SELECT 1
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
        )
    ),
    'organization_monitoring_goldens_present', EXISTS (
      SELECT 1 FROM public.search_golden_queries
      WHERE COALESCE(active, true) = true AND expected_entity IS NOT NULL AND query_type IN ('company_brand', 'company_brand_alias')
    ),
    'topic_monitoring_goldens_present', EXISTS (
      SELECT 1 FROM public.search_golden_queries
      WHERE COALESCE(active, true) = true AND expected_entity IS NOT NULL AND query_type = 'topic'
    )
  ),
  'accepted_hu_episodes_with_description', (SELECT count(*) FROM accepted_hu),
  'clean_text', (SELECT to_jsonb(clean_counts) FROM clean_counts),
  'best_text_source', (SELECT to_jsonb(best_source_counts) FROM best_source_counts),
  'clean_text_candidates', (SELECT to_jsonb(candidate_counts) FROM candidate_counts),
  'controls', COALESCE((SELECT summary FROM controls), '{}'::jsonb)
) AS snapshot;
`;

function runReadonlyQuery(query) {
  const out = execFileSync(
    process.execPath,
    [path.join(repoRoot, "scripts/pg-readonly-query.mjs"), query],
    {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(out);
}

const result = runReadonlyQuery(sql);
const snapshot = JSON.parse(result.rows?.[0]?.snapshot ?? "{}");
if (snapshot.article_pipeline?.table_exists === true) {
  try {
    const articleResult = runReadonlyQuery(`
      WITH totals AS (
        SELECT
          count(*) AS total,
          count(*) FILTER (WHERE status = 'confirmed') AS confirmed,
          count(*) FILTER (WHERE status = 'needs_review') AS needs_review,
          count(*) FILTER (WHERE status = 'rejected') AS rejected
        FROM public.episode_article_candidates
      ),
      by_outlet AS (
        SELECT jsonb_object_agg(outlet, counts ORDER BY outlet) AS counts
        FROM (
          SELECT outlet, jsonb_build_object(
            'total', count(*),
            'confirmed', count(*) FILTER (WHERE status = 'confirmed'),
            'needs_review', count(*) FILTER (WHERE status = 'needs_review'),
            'rejected', count(*) FILTER (WHERE status = 'rejected'),
            'latest', max(updated_at)
          ) AS counts
          FROM public.episode_article_candidates
          GROUP BY outlet
        ) s
      )
      SELECT jsonb_build_object(
        'total', totals.total,
        'confirmed', totals.confirmed,
        'needs_review', totals.needs_review,
        'rejected', totals.rejected,
        'by_outlet', COALESCE(by_outlet.counts, '{}'::jsonb)
      ) AS counts
      FROM totals, by_outlet;
    `);
    snapshot.article_candidates = JSON.parse(articleResult.rows?.[0]?.counts ?? "{}");
    const totalArticleCandidates = Number(snapshot.article_candidates?.total || 0);
    const progressArticleCandidates = Number(snapshot.controls?.episode_article_pairer_progress?.total_article_candidates || 0);
    snapshot.article_pipeline = {
      ...snapshot.article_pipeline,
      article_candidates_started: Math.max(totalArticleCandidates, progressArticleCandidates) > 0,
      article_candidates_readable_by_verifier: totalArticleCandidates > 0 || progressArticleCandidates === 0,
    };
  } catch (e) {
    snapshot.article_candidates = { error: e instanceof Error ? e.message : String(e) };
    snapshot.article_pipeline = {
      ...snapshot.article_pipeline,
      article_candidates_started: false,
    };
  }
}

if (snapshot.related_episode_quality?.compatibility_function_exists === true) {
  try {
    const relatedResult = runReadonlyQuery(`
      SELECT jsonb_build_object(
        'religion_cross_group_runtime_blocked',
        public.recommendation_is_compatible('public_affairs', 'religion', 0.99::double precision, true) = false,
        'cross_world_vector_without_bridge_blocked',
        public.recommendation_is_compatible('public_affairs', 'business', 0.96::double precision, false) = false,
        'cross_world_with_entity_bridge_allowed',
        public.recommendation_is_compatible('public_affairs', 'business', 0.41::double precision, true) = true,
        'specific_to_general_without_bridge_blocked',
        public.recommendation_is_compatible('public_affairs', 'general', 0.97::double precision, false) = false,
        'general_to_specific_without_bridge_blocked',
        public.recommendation_is_compatible('general', 'business', 0.97::double precision, false) = false,
        'public_affairs_title_with_isten_runtime_grouped',
        public.recommendation_text_group(
          'Mészáros Lőrinc tündöklése és részvényeinek látványos zuhanása: Isten, Orbán, Andi és a balszerencse',
          'Puzsér Róbert',
          'Society & Culture',
          ARRAY['közélet','politika','gazdaság']::text[]
        ) = 'public_affairs'
      ) AS checks;
    `);
    const checks = JSON.parse(relatedResult.rows?.[0]?.checks ?? "{}");
    snapshot.related_episode_quality = {
      ...snapshot.related_episode_quality,
      ...checks,
    };
  } catch (e) {
    snapshot.related_episode_quality = {
      ...snapshot.related_episode_quality,
      religion_cross_group_runtime_blocked: false,
      cross_world_vector_without_bridge_blocked: false,
      cross_world_with_entity_bridge_allowed: false,
      public_affairs_title_with_isten_runtime_grouped: false,
      runtime_check_error: e instanceof Error ? e.message : String(e),
    };
  }
}

if (snapshot.related_episode_quality?.content_bridge_function_exists === true) {
  try {
    const bridgeResult = runReadonlyQuery(`
      SELECT jsonb_build_object(
        'content_bridge_runtime_allows_shared_company',
        public.recommendation_has_content_bridge(
          ARRAY['közélet']::text[],
          ARRAY['tőzsde']::text[],
          ARRAY['Mészáros Lőrinc']::text[],
          ARRAY[]::text[],
          ARRAY['Opus']::text[],
          ARRAY['Opus']::text[]
        ) = true
      ) AS checks;
    `);
    const checks = JSON.parse(bridgeResult.rows?.[0]?.checks ?? "{}");
    snapshot.related_episode_quality = {
      ...snapshot.related_episode_quality,
      ...checks,
    };
  } catch (e) {
    snapshot.related_episode_quality = {
      ...snapshot.related_episode_quality,
      content_bridge_runtime_allows_shared_company: false,
      content_bridge_runtime_check_error: e instanceof Error ? e.message : String(e),
    };
  }
}

const gates = snapshot.migration_gates ?? {};
const failures = [];

for (const [key, ok] of Object.entries(gates)) {
  if (ok !== true) failures.push(`migration_gates.${key}`);
}

const cleanBackfillGates = snapshot.clean_text_backfill_gates ?? {};
for (const [key, ok] of Object.entries(cleanBackfillGates)) {
  if (ok !== true) failures.push(`clean_text_backfill_gates.${key}`);
}

const articlePipeline = snapshot.article_pipeline ?? {};
for (const [key, ok] of Object.entries(articlePipeline)) {
  if (ok !== true) failures.push(`article_pipeline.${key}`);
}

const seoNewsSitemap = snapshot.seo_news_sitemap ?? {};
for (const [key, ok] of Object.entries(seoNewsSitemap)) {
  if (ok !== true) failures.push(`seo_news_sitemap.${key}`);
}

const publicAiLanguageGuard = snapshot.public_ai_language_guard ?? {};
for (const [key, ok] of Object.entries(publicAiLanguageGuard)) {
  if (ok !== true) failures.push(`public_ai_language_guard.${key}`);
}

const relatedEpisodeQuality = snapshot.related_episode_quality ?? {};
for (const [key, ok] of Object.entries(relatedEpisodeQuality)) {
  if (ok !== true) failures.push(`related_episode_quality.${key}`);
}

const peopleHubIdentitySafety = snapshot.people_hub_identity_safety ?? {};
for (const [key, ok] of Object.entries(peopleHubIdentitySafety)) {
  if (ok !== true) failures.push(`people_hub_identity_safety.${key}`);
}

const entityMonitoringBenchmark = snapshot.entity_monitoring_benchmark ?? {};
for (const [key, ok] of Object.entries(entityMonitoringBenchmark)) {
  if (ok !== true) failures.push(`entity_monitoring_benchmark.${key}`);
}

const clean = snapshot.clean_text ?? {};
const total = Number(snapshot.accepted_hu_episodes_with_description ?? 0);
const v4 = Number(clean.deterministic_v4_family ?? clean.deterministic_v4 ?? 0);
if (total > 0 && v4 / total < 0.5) {
  failures.push(`clean_text.deterministic_v4_coverage_low:${v4}/${total}`);
}

console.log(JSON.stringify({
  ok: failures.length === 0,
  failures,
  snapshot,
}, null, 2));

if (failures.length) process.exit(1);
