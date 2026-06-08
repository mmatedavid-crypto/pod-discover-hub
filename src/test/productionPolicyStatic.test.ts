import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("production policy static guards", () => {
  it("fails Supabase backend deploy early when required secrets are missing", () => {
    const validator = read("scripts/validate-deploy-env.mjs");
    const backendVerifier = read("scripts/verify-production-backend.mjs");
    const pkg = read("package.json");

    expect(pkg).toContain('"validate:deploy-env": "node scripts/validate-deploy-env.mjs"');
    for (const secret of [
      "SUPABASE_ACCESS_TOKEN",
      "SUPABASE_DB_PASSWORD",
      "SUPABASE_READONLY_DATABASE_URL",
      "SUPABASE_PUBLISHABLE_KEY",
    ]) {
      expect(validator).toContain(secret);
    }
    expect(validator).toContain("VITE_SUPABASE_URL does not contain SUPABASE_PROJECT_REF");
    expect(validator).toContain("SUPABASE_READONLY_DATABASE_URL does not contain SUPABASE_PROJECT_REF");

    for (const fn of [
      "ai-enrich",
      "episode-clean-text-runner",
      "episode-article-pairer",
      "episode-best-text-source-runner",
      "seo-enrich-runner",
      "refresh-sitemap",
      "prerender",
    ]) {
      expect(backendVerifier).toContain(`"${fn}"`);
    }
  });

  it("keeps production deploy gap reporting actionable by pipeline area", () => {
    const reporter = read("scripts/report-production-deploy-gap.mjs");
    const vitestRunner = read("scripts/run-vitest.mjs");
    const viteRunner = read("scripts/run-vite.mjs");
    const deployDoc = read("docs/production-backend-deploy.md");
    const preflight = read("scripts/preflight-migrations.mjs");
    const pkg = read("package.json");

    expect(pkg).toContain('"build": "node scripts/run-vite.mjs build"');
    expect(pkg).toContain('"build:dev": "node scripts/run-vite.mjs build --mode development"');
    expect(viteRunner).toContain("canLoadRollupNative");
    expect(viteRunner).toContain("@rollup/rollup-darwin-arm64");
    expect(viteRunner).toContain(".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node");
    expect(viteRunner).toContain('const viteArgs = args.length ? args : ["build"]');

    expect(pkg).toContain('"test:codex": "node scripts/run-vitest.mjs"');
    expect(pkg).toContain('"test": "node scripts/run-vitest.mjs"');
    expect(pkg).toContain('"test:watch": "node scripts/run-vitest.mjs --watch"');
    expect(vitestRunner).toContain("canLoadRollupNative");
    expect(vitestRunner).toContain("@rollup/rollup-darwin-arm64");
    expect(vitestRunner).toContain(".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node");
    expect(vitestRunner).toContain('const vitestArgs = args.length ? args : ["run"]');

    expect(pkg).toContain('"report:production-deploy-gap": "node scripts/report-production-deploy-gap.mjs"');
    expect(pkg).toContain('"report:production-deploy-prompt": "node scripts/report-production-deploy-gap.mjs --lovable-prompt"');
    expect(reporter).toContain("verify-production-pipeline.mjs");
    expect(reporter).toContain("verify-production-edge-seo.mjs");
    expect(reporter).toContain("process.argv.includes(\"--lovable-prompt\")");
    expect(reporter).toContain("process.argv.includes(\"--prompt\")");
    expect(reporter).toContain("getSourceRevision");
    expect(reporter).toContain("runGit");
    expect(reporter).toContain("rev-parse");
    expect(reporter).toContain("source_revision");
    expect(reporter).toContain("After pulling, confirm the repo is at commit");
    expect(reporter).toContain("Local source tree is dirty; commit and push the local changes before asking Lovable to deploy:");
    expect(reporter).toContain("groupKeyForFailure");
    expect(reporter).toContain("migration_gates");
    expect(reporter).toContain("canonical_org_merge");
    expect(reporter).toContain("canonical_alias_backfill");
    expect(reporter).toContain("20260606001000_reassert_safe_organization_merge_rpc.sql");
    expect(reporter).toContain("suspicious_temporal_participants");
    expect(reporter).toContain("const unmappedFailures = []");
    expect(reporter).toContain("unmappedFailures.push(failure)");
    expect(reporter).toContain("makeDeployPlan");
    expect(reporter).toContain("checkDeployArtifacts");
    expect(reporter).toContain("artifactExists");
    expect(reporter).toContain("countPreflightChecksForMigration");
    expect(reporter).toContain("makePreflightEvidence");
    expect(reporter).toContain("makeLovablePrompt");
    expect(reporter).toContain("deploy_plan");
    expect(reporter).toContain("lovable_prompt");
    expect(reporter).toContain('const localChecks = ["node scripts/run-vitest.mjs", "node scripts/run-vite.mjs build"]');
    expect(reporter).toContain("local_checks");
    expect(reporter).toContain("Before deploy, run local verification:");
    expect(reporter).toContain("unmapped_failures");
    expect(reporter).toContain("Unmapped verifier failures; stop and add/repair deploy-gap grouping before deploy:");
    expect(reporter).toContain("none mapped to a known deploy area");
    expect(reporter).toContain("supabase/functions/${name}/index.ts");
    expect(reporter).toContain("Missing deploy artifacts; stop and fix these repo references before deploy:");
    expect(reporter).toContain("node scripts/preflight-migrations.mjs ${migrations.join(\" \")}");
    expect(reporter).toContain("Preflight must report ok=true, checked_count>=");
    expect(reporter).toContain("Stop if it reports fewer checks or any finding.");
    expect(reporter).toContain("Please pull latest main and close the current Podiverzum production deploy gap.");
    expect(reporter).toContain("Before applying migrations, run preflight:");
    expect(reporter).toContain("Apply these Supabase migrations in order:");
    expect(reporter).toContain("Redeploy these Supabase Edge Functions:");
    expect(reporter).toContain('functions: ["weekly-editorial-post"]');
    expect(reporter).toContain("IndexNow Heti ping");
    expect(reporter).toContain("Cloudflare edge SEO acceptance criteria after worker deploy:");
    expect(reporter).toContain("www.podiverzum.hu/* returns 301 to apex with Cache-Control including max-age=31536000");
    expect(reporter).toContain("/robots.txt is served by worker-robots-policy and contains Host: podiverzum.hu");
    expect(reporter).toContain("returns only the IndexNow key with worker-indexnow-key");
    expect(reporter).toContain("After deploy, run verification:");
    expect(deployDoc).toContain("Codex should generate the deploy-gap prompt, but Lovable performs the");
    expect(deployDoc).toContain("npm run report:production-deploy-gap");
    expect(deployDoc).toContain("npm run report:production-deploy-prompt");
    expect(deployDoc).toContain("unmapped verifier failures");
    expect(deployDoc).toContain("missing migration/function/worker artifacts");
    expect(deployDoc).toContain("local verification commands (`node scripts/run-vitest.mjs`");
    expect(deployDoc).toContain("`node scripts/run-vite.mjs build`)");
    expect(deployDoc).toContain("explicit migration preflight");
    expect(deployDoc).toContain("public-table insert column checks");
    expect(deployDoc).toContain("expected `checked_count` evidence threshold");
    expect(preflight).toContain("function parseInsertColumns");
    expect(preflight).toContain("information_schema.columns");
    expect(preflight).toContain("insert_references_missing_columns");
    expect(deployDoc).toContain("Legacy clean-text backfill is quality-gated");
    for (const group of [
      "clean_text_backfill_gates",
      "article_pipeline",
      "seo_news_sitemap",
      "public_ai_language_guard",
      "related_episode_quality",
      "taste_card_embedding_privacy",
      "downstream_embedding_quality",
      "smart_player_recommendation_surface",
      "search_quality_benchmark",
      "entity_monitoring_benchmark",
      "canonical_alias_backfill",
      "people_hub_identity_safety",
      "edge_worker_seo",
    ]) {
      expect(reporter).toContain(group);
    }
    for (const artifact of [
      "20260603171000_clean_text_backfill_quality_gate_consolidated.sql",
      "20260603164000_article_pipeline_consolidated.sql",
      "20260605210000_reassert_article_pairer_sources_v4.sql",
      "20260605211000_episode_article_candidates_readonly_policy.sql",
      "20260605225000_reassert_article_pairer_brand_anchor_patterns.sql",
      "20260603111500_news_sitemap_fast_refresh_cron.sql",
      "20260603221000_news_sitemap_gsc_connector_gateway.sql",
      "20260604094229_reassert_news_sitemap_gsc_connector.sql",
      "20260605212000_reassert_news_sitemap_gsc_put_submit.sql",
      "20260605214500_clear_news_sitemap_connector_404_state.sql",
      "20260606021000_guard_news_sitemap_connector_404_state.sql",
      "20260603162000_public_ai_language_guard_consolidated.sql",
      "20260603165000_related_episode_quality_consolidated.sql",
      "20260604001000_recommendation_compatibility_v4.sql",
      "20260604091642_reassert_recommendation_compatibility_v4.sql",
      "20260605003000_recommendation_compatibility_v5_entity_bridge.sql",
      "20260605203000_reassert_recommendation_compatibility_v5_content_bridge.sql",
      "20260605214000_reassert_related_quality_policy_v5_settings.sql",
      "20260605215000_reassert_related_public_affairs_override_terms.sql",
      "20260605232000_reassert_similar_episode_diagnostics.sql",
      "20260607090056_54bd094a-baa5-4ea8-9f43-912e549b12ac.sql",
      "20260606005000_personalized_home_rails_reason_policy.sql",
      "20260606011000_personalized_home_main_rail_reason_policy.sql",
      "20260606020000_reassert_recommendation_diagnostics_policy_v4.sql",
      "20260531220000_v4_clean_text_family_downstream_gates.sql",
      "20260605231000_reassert_downstream_embedding_clean_text_family.sql",
      "20260606182358_4bcdca78-0c45-4572-85bc-cf911726cf14.sql",
      "20260606184000_reassert_smart_player_recommendation_surface_enabled_v2.sql",
      "20260605001000_search_quality_weekly_automation.sql",
      "20260608001000_search_timestamp_match_telemetry.sql",
      "20260605220000_entity_monitoring_search_benchmark_policy.sql",
      "20260605223000_reassert_entity_monitoring_benchmark_goldens.sql",
      "20260606010000_expand_entity_monitoring_goldens_v2.sql",
      "20260603170000_people_identity_safety_consolidated.sql",
      "20260605200000_reassert_temporal_person_public_guard.sql",
      "20260605213000_reassert_strict_temporal_person_guard_v6.sql",
      "20260606003000_person_bio_temporal_policy_v2.sql",
      "20260606004000_person_bio_input_hash_policy_v3.sql",
      "20260606015000_person_bio_topic_only_no_job_policy_v4.sql",
      "episode-article-pairer",
      "personalized-home-rails",
      "embed-episode-runner",
      "embed-episode-chunks-runner",
      "refresh-sitemap",
      "search-golden-refresh",
      "search-benchmark-runner",
      "search-hybrid",
      "ai-enrich",
      "prerender",
      "person-entity-extractor",
      "person-bio-generator",
      "weekly-editorial-post",
      "infra/cloudflare-worker/worker.js",
      ".lovable/cloudflare-worker.js",
    ]) {
      expect(reporter).toContain(artifact);
    }
  });

  it("keeps taste card embedding prompts server-only in production verification", () => {
    const migration = read("supabase/migrations/20260607090056_54bd094a-baa5-4ea8-9f43-912e549b12ac.sql");
    const verifier = read("scripts/verify-production-pipeline.mjs");
    const reporter = read("scripts/report-production-deploy-gap.mjs");

    expect(migration).toContain("REVOKE SELECT (hidden_embedding_prompt) ON public.taste_cards FROM anon");
    expect(migration).toContain("REVOKE SELECT (hidden_embedding_prompt) ON public.taste_cards FROM authenticated");
    expect(migration).toContain("REVOKE SELECT (hidden_embedding_prompt) ON public.taste_cards FROM PUBLIC");
    expect(migration).toContain("has_column_privilege('anon', 'public.taste_cards', 'hidden_embedding_prompt', 'SELECT')");
    expect(migration).toContain("has_column_privilege('authenticated', 'public.taste_cards', 'hidden_embedding_prompt', 'SELECT')");

    expect(verifier).toContain("taste_card_embedding_privacy");
    expect(verifier).toContain("hidden_prompt_column_exists");
    expect(verifier).toContain("anon_cannot_select_hidden_prompt");
    expect(verifier).toContain("authenticated_cannot_select_hidden_prompt");
    expect(verifier).toContain("has_column_privilege('anon', 'public.taste_cards', 'hidden_embedding_prompt', 'SELECT')");

    expect(reporter).toContain("taste_card_embedding_privacy");
    expect(reporter).toContain("Taste card embedding prompt privacy");
    expect(reporter).toContain("20260607090056_54bd094a-baa5-4ea8-9f43-912e549b12ac.sql");
  });

  it("keeps search golden refresh and benchmark on a weekly automated quality loop", () => {
    const migration = read("supabase/migrations/20260605001000_search_quality_weekly_automation.sql");
    const timestampTelemetry = read("supabase/migrations/20260608001000_search_timestamp_match_telemetry.sql");
    const goldenRunner = read("supabase/functions/search-golden-refresh/index.ts");
    const benchmarkRunner = read("supabase/functions/search-benchmark-runner/index.ts");
    const searchPage = read("src/pages/SearchPage.tsx");
    const adminInsights = read("src/pages/AdminSearchInsightsPage.tsx");
    const verifier = read("scripts/verify-production-pipeline.mjs");
    const reporter = read("scripts/report-production-deploy-gap.mjs");

    expect(migration).toContain("search_golden_refresh_controls");
    expect(migration).toContain("search_benchmark_controls");
    expect(migration).toContain("podiverzum-search-golden-refresh-weekly");
    expect(migration).toContain("podiverzum-search-benchmark-runner-30min");
    expect(migration).toContain("weekly_drain");
    expect(migration).toContain("fetch failures excluded from quality metrics");
    expect(timestampTelemetry).toContain("timestamp_match_count integer NOT NULL DEFAULT 0");
    expect(timestampTelemetry).toContain("chunk_augmented_count integer NOT NULL DEFAULT 0");
    expect(timestampTelemetry).toContain("search_events_timestamp_matches_idx");
    expect(searchPage).toContain("timestamp_match_count:");
    expect(searchPage).toContain("chunk_augmented_count:");
    expect(adminInsights).toContain("Timestamped searches");
    expect(adminInsights).toContain("Timestamp / chunk retrieval queries");
    expect(verifier).toContain("search_quality_benchmark");
    expect(verifier).toContain("timestamp_match_telemetry_column_exists");
    expect(verifier).toContain("chunk_augmented_telemetry_column_exists");
    expect(reporter).toContain("20260608001000_search_timestamp_match_telemetry.sql");
    expect(reporter).toContain('endsWith("20260608001000_search_timestamp_match_telemetry.sql") ? 1 : 0');

    expect(goldenRunner).toContain("refresh_search_golden_queries_from_catalog");
    expect(goldenRunner).toContain("refresh_search_golden_queries_from_external_demand");
    expect(goldenRunner).toContain("search_golden_refresh_progress");
    expect(goldenRunner).toContain('const ENTITY_QUERY_TYPES = ["person", "company_brand", "company_brand_alias", "topic"]');
    expect(goldenRunner).toContain("const MIN_ENTITY_GOLDENS = 60");
    expect(goldenRunner).toContain("function loadEntityMonitoringCoverage");
    expect(goldenRunner).toContain("managed_entity_monitoring_v3_coverage_after_refresh");
    expect(goldenRunner).toContain("entity_monitoring_coverage: entityMonitoringCoverage");

    expect(benchmarkRunner).toContain("Weekly search benchmark");
    expect(benchmarkRunner).toContain("batch_size");
    expect(benchmarkRunner).toContain("search-hybrid");
    expect(benchmarkRunner).toContain("AUTO_WEEKLY_SCORED");
    expect(benchmarkRunner).toContain('raw_meta?.status !== "fetch_error"');
    expect(benchmarkRunner).toContain("search_benchmark_progress");
    expect(benchmarkRunner).toContain("precision_at_3");
    expect(benchmarkRunner).toContain("ndcg_at_10");
    expect(benchmarkRunner).toContain("false_positive_rate");
    expect(benchmarkRunner).toContain("function entityEvidenceText");
    expect(benchmarkRunner).toContain("entityEvidenceText(r)");
    expect(benchmarkRunner).toContain('const ENTITY_QUERY_TYPES = ["person", "company_brand", "company_brand_alias", "topic"]');
    expect(benchmarkRunner).toContain("const MIN_ENTITY_QUERY_TYPES = 4");
    expect(benchmarkRunner).toContain("function loadEntityMonitoringCoverage");
    expect(benchmarkRunner).toContain("entity_monitoring_coverage: entityMonitoringCoverage");
    for (const field of ["people", "companies", "topics", "tickers", "ingredients"]) {
      expect(benchmarkRunner).toContain(`${field}: Array.isArray(e.${field}) ? e.${field} : []`);
    }
  });

  it("keeps entity monitoring benchmark scoped away from dead-person podcast targets", () => {
    const migration = [
      read("supabase/migrations/20260605220000_entity_monitoring_search_benchmark_policy.sql"),
      read("supabase/migrations/20260605223000_reassert_entity_monitoring_benchmark_goldens.sql"),
      read("supabase/migrations/20260606010000_expand_entity_monitoring_goldens_v2.sql"),
      read("supabase/migrations/20260606012000_reassert_entity_monitoring_goldens_v3.sql"),
    ].join("\n");
    const verifier = read("scripts/verify-production-pipeline.mjs");
    const reporter = read("scripts/report-production-deploy-gap.mjs");

    expect(migration).toContain("entity_monitoring_benchmark_policy");
    expect(migration).toContain("required_query_types");
    expect(migration).toContain("company_brand_alias");
    expect(migration).toContain("requires_expected_entity");
    expect(migration).toContain("person_scope_rule");
    expect(migration).toContain("deceased_person_handling");
    expect(migration).toContain("'version', 3");
    expect(migration).toContain("'min_active_entity_queries', 60");
    expect(migration).toContain("'min_active_entity_queries', 50");
    expect(migration).toContain("entity_monitoring_benchmark_v3 expected at least 60 active entity goldens");
    expect(migration).toContain("entity_monitoring_benchmark_v3 expected all four active entity query types");
    expect(migration).toContain("deceased/historical figures are topic/entity-context goldens");
    expect(migration).toContain("q.query_type = 'person'");
    expect(migration).toContain("SET query_type = 'topic'");
    expect(migration).toContain("INSERT INTO public.search_golden_queries");
    expect(migration).toContain("company_brand_alias");
    expect(migration).toContain("Puzsér Róbert");
    expect(migration).toContain("Orosz Gergő");
    expect(migration).toContain("OTP részvény árfolyam");
    expect(migration).toContain("MOL Nyrt");
    expect(migration).toContain("Tisza párt támogatottság");
    expect(migration).toContain("Európai Unió támogatások");
    expect(migration).toContain("MBH Bank");
    expect(migration).toContain("4iG részvény");
    expect(migration).toContain("Yettel Magyarország");
    expect(migration).toContain("Aldi akció");
    expect(migration).toContain("mesterséges intelligencia szabályozás");
    expect(migration).toContain("Petőfi Sándor podcast beszélgetés");
    expect(migration).toContain("Kossuth Lajos történelem");
    expect(migration).toContain("p.is_deceased IS TRUE");
    expect(migration).toContain("p.is_historical IS TRUE");
    expect(migration).toContain("p.date_of_death IS NOT NULL");
    expect(migration).toContain("p.is_living IS FALSE");

    expect(verifier).toContain("entity_monitoring_benchmark");
    expect(verifier).toContain("policy_configured_v2");
    expect(verifier).toContain("policy_configured_v3");
    expect(verifier).toContain("active_entity_golden_queries_at_least_40");
    expect(verifier).toContain("active_entity_golden_queries_at_least_50");
    expect(verifier).toContain("active_entity_golden_queries_at_least_60");
    expect(verifier).toContain("active_entity_query_types_at_least_3");
    expect(verifier).toContain("active_entity_query_types_at_least_4");
    expect(verifier).toContain("deceased_person_handling_recorded");
    expect(verifier).toContain("person_scope_rule_recorded");
    expect(verifier).toContain("company_brand_alias_required_recorded");
    expect(verifier).toContain("company_brand_alias_goldens_present");
    expect(verifier).toContain("no_deceased_or_historical_person_monitoring_goldens");
    expect(verifier).toContain("JOIN public.people p ON lower(p.name) = lower(q.expected_entity)");
    expect(verifier).toContain("entity_monitoring_benchmark.${key}");

    expect(reporter).toContain("Entity monitoring benchmark");
    expect(reporter).toContain("elhunyt/történelmi személy ne maradjon podcast-person monitoring target");
  });

  it("keeps publisher article pipeline verification tied to runtime output", () => {
    const verifier = read("scripts/verify-production-pipeline.mjs");

    expect(verifier).toContain("pairer_has_run");
    expect(verifier).toContain("pairer_scanned_articles");
    expect(verifier).toContain("pairer_records_write_verification");
    expect(verifier).toContain("pairer_records_total_candidates");
    expect(verifier).toContain("pairer_uses_regex_xml_parser");
    expect(verifier).toContain("pairer_no_domparser_error");
    expect(verifier).toContain("DOMParser is not defined");
    expect(verifier).toContain("article_candidates_started");
    expect(verifier).toContain("article_candidates_readable_by_verifier");
    expect(verifier).toContain("episode_article_pairer_progress?.total_article_candidates");
    expect(verifier).toContain("sources_v4_configured");
    expect(verifier).toContain("brand_anchor_pattern_policy_recorded");
    expect(verifier).toContain("pattern_safety_version_recorded");
    expect(verifier).toContain("no_generic_article_pairer_title_patterns");
    expect(verifier).toContain("multi_source_run_configured");
    expect(verifier).toContain("episode_article_pairer_progress");

    const pairer = read("supabase/functions/episode-article-pairer/index.ts");
    expect(pairer).toContain('parser_policy: "regex_xml_no_domparser_v2"');
    expect(pairer).toContain("verified_upsert_rows");
    expect(pairer).toContain("total_article_candidates");
    expect(pairer).toContain("sources_per_run");
    expect(pairer).toContain("processed_outlets");
    expect(pairer).toContain("best_rejected_scores");
    expect(pairer).toContain('.select("id")');
  });

  it("keeps downstream embeddings clean-text-first in production verification", () => {
    const verifier = read("scripts/verify-production-pipeline.mjs");
    const reporter = read("scripts/report-production-deploy-gap.mjs");
    const downstreamGate = read("supabase/migrations/20260531220000_v4_clean_text_family_downstream_gates.sql");
    const reassertGate = read("supabase/migrations/20260605231000_reassert_downstream_embedding_clean_text_family.sql");
    const downstreamV3 = read("supabase/migrations/20260606014000_reassert_downstream_embedding_clean_text_family_v3.sql");
    const timestampChunks = read("supabase/migrations/20260606174000_timestamp_aware_episode_chunks.sql");
    const timestampChunkSearch = read("supabase/migrations/20260606183000_reassert_timestamp_aware_chunk_search_v2.sql");
    const episodeRunner = read("supabase/functions/embed-episode-runner/index.ts");
    const chunkRunner = read("supabase/functions/embed-episode-chunks-runner/index.ts");
    const searchHybrid = read("supabase/functions/search-hybrid/index.ts");
    const episodeCard = read("src/components/EpisodeCard.tsx");
    const smartPlayer = read("src/components/smart-player/SmartPlayerProvider.tsx");

    expect(verifier).toContain("downstream_embedding_quality");
    expect(verifier).toContain("text_policy_embedding_requires_clean_text");
    expect(verifier).toContain("text_policy_accepts_v4_family");
    expect(verifier).toContain("text_policy_v3_clean_text_first");
    expect(verifier).toContain("text_policy_language_gate_accepts_decision");
    expect(verifier).toContain("legacy_embed_policy_v4_family_clean_text_only");
    expect(verifier).toContain("legacy_embed_policy_language_gate_accepts_decision");
    expect(verifier).toContain("select_embed_episode_candidates_clean_text_source");
    expect(verifier).toContain("select_embed_episode_candidates_v4_family_filter");
    expect(verifier).toContain("select_embed_chunks_candidates_clean_text_contract");
    expect(verifier).toContain("select_embed_chunks_candidates_returns_transcript_segments");
    expect(verifier).toContain("select_embed_chunks_candidates_matches_transcript_hash");
    expect(verifier).toContain("select_embed_chunks_candidates_v4_family_filter");
    expect(verifier).toContain("episode_chunking_policy_timestamp_aware_v2");
    expect(verifier).toContain("episode_chunking_policy_keeps_char_fallback");
    expect(verifier).toContain("episode_chunking_policy_search_contract_v2");
    expect(verifier).toContain("search_episode_chunks_returns_timestamps");
    expect(verifier).toContain("embed_chunks_timestamp_columns");
    expect(verifier).toContain("embedding_candidate_rpcs_no_legacy_hu_flag");
    expect(verifier).toContain("failures.push(`downstream_embedding_quality.${key}`)");

    expect(reporter).toContain("Clean-text-first downstream embeddings");
    expect(reporter).toContain("20260531220000_v4_clean_text_family_downstream_gates.sql");
    expect(reporter).toContain("20260605231000_reassert_downstream_embedding_clean_text_family.sql");
    expect(reporter).toContain("20260606014000_reassert_downstream_embedding_clean_text_family_v3.sql");
    expect(reporter).toContain("20260606174000_timestamp_aware_episode_chunks.sql");
    expect(reporter).toContain("20260606183000_reassert_timestamp_aware_chunk_search_v2.sql");
    expect(reporter).toContain('String(failure).includes("embed_chunks")');
    expect(reporter).toContain("embed-episode-runner");
    expect(reporter).toContain("embed-episode-chunks-runner");

    for (const migration of [downstreamGate, reassertGate]) {
      expect(migration).toContain("ct.cleaned_text AS description");
      expect(migration).toContain("ct.cleaner_method LIKE 'deterministic_v4%'");
      expect(migration).toContain("'embedding_requires_clean_text', true");
      expect(migration).toContain("'deterministic_v4_family_clean_text_only'");
    }
    expect(reassertGate).toContain("20260605231000_reassert_downstream_embedding_clean_text_family");
    expect(downstreamV3).toContain("'version', 'best_source_clean_text_first_v3'");
    expect(downstreamV3).toContain("'language_gate', 'podcasts.language_decision=accept_hungarian'");
    expect(downstreamV3).toContain("select_embed_episode_candidates does not require deterministic_v4-family clean text");
    expect(downstreamV3).toContain("embedding candidate RPCs must use language_decision without legacy is_hungarian positive gates");
    expect(downstreamV3).not.toContain("p.is_hungarian = true");
    expect(timestampChunks).toContain("timestamp_start_seconds integer");
    expect(timestampChunks).toContain("timestamp_end_seconds integer");
    expect(timestampChunks).toContain("segment_start_idx integer");
    expect(timestampChunks).toContain("segment_end_idx integer");
    expect(timestampChunks).toContain("source_transcript_model text");
    expect(timestampChunks).toContain("chunking_method text NOT NULL DEFAULT 'char_window_v1'");
    expect(timestampChunks).toContain("transcript_model text");
    expect(timestampChunks).toContain("transcript_segments jsonb");
    expect(timestampChunks).toContain("transcript_hash text");
    expect(timestampChunks).toContain("bt.content_hash = ct.source_hash");
    expect(timestampChunks).toContain("'version', 'timestamp_aware_v2'");
    expect(timestampChunks).toContain("'fallback', 'char_window_v1'");
    expect(timestampChunks).toContain("ct.cleaner_method LIKE 'deterministic_v4%'");
    expect(timestampChunkSearch).toContain("DROP FUNCTION IF EXISTS public.select_embed_chunks_candidates(text, integer)");
    expect(timestampChunkSearch).toContain("DROP FUNCTION IF EXISTS public.search_episode_chunks(vector, integer, integer)");
    expect(timestampChunkSearch).toContain("timestamp_start_seconds integer");
    expect(timestampChunkSearch).toContain("source_transcript_model text");
    expect(timestampChunkSearch).toContain("chunking_method text");
    expect(timestampChunkSearch).toContain("bt.content_hash = ct.source_hash");
    expect(timestampChunkSearch).toContain("'search_contract_version', 'timestamp_chunk_search_v2'");
    expect(timestampChunkSearch).toContain("'language_gate', 'podcasts.language_decision=accept_hungarian'");
    expect(timestampChunkSearch).not.toContain("p.is_hungarian=true");
    expect(timestampChunkSearch).not.toContain("p.is_hungarian = true");

    expect(episodeRunner).toContain("select_embed_episode_candidates");
    expect(episodeRunner).toContain("validateEmbeddingInput");
    expect(episodeRunner).toContain("loadPromotedCleanText");
    expect(episodeRunner).toContain('.from("episode_clean_text")');
    expect(episodeRunner).toContain('.like("cleaner_method", "deterministic_v4%")');
    expect(episodeRunner).toContain("requires_promoted_deterministic_v4_clean_text");
    expect(episodeRunner).toContain('source_policy: "verified_deterministic_v4_clean_text_then_embedding"');
    expect(episodeRunner).toContain("skipped_last_run");
    expect(chunkRunner).toContain("requires_promoted_deterministic_v4_clean_text");
    expect(chunkRunner).toContain("source_policy: \"best_source_then_deterministic_v4_clean_text_then_embedding\"");
    expect(chunkRunner).toContain("function chunkTimedSegments");
    expect(chunkRunner).toContain("segment_timestamp_v2");
    expect(chunkRunner).toContain("char_window_v1");
    expect(chunkRunner).toContain("hasNewContentSinceClose");
    expect(chunkRunner).toContain("current.length === 0 || !hasNewContentSinceClose");
    expect(chunkRunner).toContain("current.length > 0 && hasNewContentSinceClose");
    expect(chunkRunner).toContain("timestamp_start_seconds: s.timestamp_start_seconds");
    expect(chunkRunner).toContain("source_transcript_model: s.source_transcript_model");
    expect(chunkRunner).toContain("chunking_policy: \"timestamp_aware_v2_segments_when_available_else_char_window_v1\"");
    expect(searchHybrid).toContain("chunk_match");
    expect(searchHybrid).toContain("timestamp_start_seconds: c.timestamp_start_seconds");
    expect(searchHybrid).toContain("chunkMatchMap");
    expect(episodeCard).toContain("chunk_match?:");
    expect(episodeCard).toContain("formatSeekTime");
    expect(episodeCard).toContain("Lejátszás innen");
    expect(episodeCard).toContain("aria-label={`Lejátszás innen: ${formatSeekTime(chunkStart)}`}");
    expect(episodeCard).toContain("sm:hidden inline-flex items-center justify-center h-8 w-8 rounded-md border border-primary/40");
    expect(smartPlayer).toContain("opts.startAt >= 0");
    expect(smartPlayer).toContain('eventType: "play_seek"');
  });

  it("keeps unused automatic social posting hard-disabled at the edge handler", () => {
    const fn = read("supabase/functions/daily-social-post/index.ts");
    const adminPage = read("src/pages/AdminSocialPostsPage.tsx");
    const migration = read("supabase/migrations/20260531152000_disable_social_automation.sql");

    expect(fn).toContain("const SOCIAL_AUTOMATION_HARD_DISABLED = true");
    expect(fn).toContain("Automatic X/TikTok/social content generation is intentionally disabled");
    expect(fn).toContain("function: \"daily-social-post (disabled)\"");
    expect(fn).toContain("if (SOCIAL_AUTOMATION_HARD_DISABLED)");
    expect(fn).toContain("return jsonRes({");
    expect(fn).toContain("}, 423)");
    expect(fn.indexOf("if (SOCIAL_AUTOMATION_HARD_DISABLED)")).toBeLessThan(fn.indexOf("return await main(req)"));
    expect(fn).toContain('.eq("podcasts.language_decision", "accept_hungarian")');
    expect(fn).not.toContain("is_hungarian");
    expect(fn).not.toContain("is_hungarian.eq.true,language_decision.eq.accept_hungarian");
    expect(fn).not.toContain('language_decision !== "reject_foreign"');

    expect(adminPage).toContain("const SOCIAL_AUTOMATION_DISABLED = true");
    expect(adminPage).toContain("Preview disabled");
    expect(adminPage).toContain("Posting disabled");
    expect(migration).toContain("'enabled', false");
    expect(migration).toContain("'allow_manual_posting', false");
    expect(migration).toContain("'allow_dry_run_preview', false");
  });

  it("keeps legacy clean-text backfill quality-gated instead of globally enabled", () => {
    const migration = read("supabase/migrations/20260603171000_clean_text_backfill_quality_gate_consolidated.sql");
    const runner = read("supabase/functions/episode-clean-text-runner/index.ts");
    const candidateRunner = read("supabase/functions/episode-clean-text-candidate-runner/index.ts");
    const verifier = read("scripts/verify-production-pipeline.mjs");

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.requeue_legacy_clean_text_v4_backfill");
    expect(migration).toContain("'use_best_text_source', true");
    expect(migration).toContain("'legacy_v3_backfill_enabled', false");
    expect(migration).toContain("'legacy_v3_backfill_mode', 'manual_canary_only'");
    expect(migration).toContain("'quality_gate_required_before_global_backfill', true");
    expect(migration).toContain("'clean_text_backfill_status', 'frozen_pending_quality_proof'");
    expect(migration).toContain("manual_canary_only_until_quality_proof");

    expect(runner).toContain("ctrl.legacy_v3_backfill_enabled !== true && body.requeue_legacy_v3 !== true");
    expect(runner).toContain("use_best_text_source");
    for (const source of [runner, candidateRunner]) {
      expect(source).toContain('.eq("podcasts.language_decision", "accept_hungarian")');
      expect(source).not.toContain("is_hungarian");
      expect(source).not.toContain('eq("podcasts.is_hungarian", true)');
    }

    expect(verifier).toContain("legacy_v3_backfill_quality_gated");
    expect(verifier).not.toContain("legacy_v3_backfill_enabled', (SELECT");
  });

  it("uses accepted language decisions for PI and deep archive backfills without the legacy RSS HU flag", () => {
    const files = [
      "supabase/functions/pi-episode-backfill/index.ts",
      "supabase/functions/pi-backfill-peek/index.ts",
      "supabase/functions/pi-language-recheck/index.ts",
      "supabase/functions/hungarian-deep-archive-backfill/index.ts",
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).toContain('language_decision", "accept_hungarian"');
      expect(source).not.toContain('eq("is_hungarian", true)');
      expect(source).not.toContain("is_hungarian.eq.true");
      expect(source).not.toContain("is_hungarian=true AND language_decision");
    }
  });

  it("uses accepted language decisions for STT and YouTube ingest without the legacy RSS HU flag", () => {
    const files = [
      "supabase/functions/stt-enqueue/index.ts",
      "supabase/functions/stt-runner/index.ts",
      "supabase/functions/youtube-episode-pairer/index.ts",
      "supabase/functions/youtube-channel-scout/index.ts",
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).toContain('language_decision", "accept_hungarian"');
      expect(source).not.toContain('eq("is_hungarian", true)');
      expect(source).not.toContain("is_hungarian.eq.true");
    }
  });

  it("uses accepted language decisions for editorial and deep hydrate pipelines without the legacy RSS HU flag", () => {
    const files = [
      "supabase/functions/deep-hydrate-runner/index.ts",
      "supabase/functions/weekly-editorial-post/index.ts",
      "supabase/functions/editorial-people-seed-matcher/index.ts",
      "supabase/functions/entity-extraction-diff-test/index.ts",
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).toContain('language_decision", "accept_hungarian"');
      expect(source).not.toContain('eq("is_hungarian", true)');
      expect(source).not.toContain('eq("podcasts.is_hungarian", true)');
      expect(source).not.toContain("is_hungarian.eq.true");
    }
  });

  it("keeps news sitemap submission new-url-gated through Google Search Console", () => {
    const fn = read("supabase/functions/refresh-sitemap/index.ts");
    const migration = read("supabase/migrations/20260603111500_news_sitemap_fast_refresh_cron.sql");
    const connectorMigration = read("supabase/migrations/20260603221000_news_sitemap_gsc_connector_gateway.sql");
    const connectorReassertMigration = read("supabase/migrations/20260604094229_reassert_news_sitemap_gsc_connector.sql");
    const putSubmitMigration = read("supabase/migrations/20260605212000_reassert_news_sitemap_gsc_put_submit.sql");
    const connector404Migration = read("supabase/migrations/20260605214500_clear_news_sitemap_connector_404_state.sql");
    const connector404GuardMigration = read("supabase/migrations/20260606021000_guard_news_sitemap_connector_404_state.sql");
    const staticFallback = read("public/news-sitemap.xml");

    expect(fn).toContain("submitGoogleSearchConsoleSitemap");
    expect(fn).toContain("https://connector-gateway.lovable.dev/google_search_console/webmasters/v3/sites/");
    expect(fn).toContain("method: 'PUT'");
    expect(fn).toContain("LOVABLE_API_KEY");
    expect(fn).toContain("GOOGLE_SEARCH_CONSOLE_API_KEY");
    expect(fn).toContain("X-Connection-Api-Key");
    expect(fn).toContain("missing_lovable_gsc_connector_credentials");
    expect(fn).toContain("lovable_gsc_connector_route_missing_404");
    expect(fn).not.toContain("GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL");
    expect(fn).not.toContain("GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY");
    expect(fn).not.toContain("https://oauth2.googleapis.com/token");
    expect(fn).toContain("const changed = newsHash !== previousHash");
    expect(fn).toContain("const realNewsItemCount = newsItems.length");
    expect(fn).toContain("const extractXmlLocs =");
    expect(fn).toContain("readExistingSitemapLocs('news-sitemap.xml')");
    expect(fn).toContain("const previousStateHasUrls = Array.isArray(previousState?.urls)");
    expect(fn).toContain("previous_url_source");
    expect(fn).toContain("const previousUrls = new Set<string>");
    expect(fn).toContain("const newUrls = currentUrls.filter");
    expect(fn).toContain("const googleSubmitPolicy = 'submit_only_when_news_sitemap_has_new_urls'");
    expect(fn).toContain("const hasReliablePreviousUrlBaseline = previousStateHasUrls || previousKnownUrls.length > 0");
    expect(fn).toContain("const shouldSubmitToGoogle = hasReliablePreviousUrlBaseline && newUrls.length > 0 && realNewsItemCount > 0");
    const freshEpisodesBlock = fn.slice(fn.indexOf("const { data: freshEpisodes"), fn.indexOf("const perPodcast = new Map"));
    expect(freshEpisodesBlock).toContain(".eq('podcasts.language_decision', 'accept_hungarian')");
    expect(freshEpisodesBlock).toContain("RSS HU flag is noisy");
    expect(freshEpisodesBlock).not.toContain("is_hungarian");
    expect(freshEpisodesBlock).not.toContain(".eq('podcasts.is_hungarian', true)");
    expect(fn).toContain("baseline_saved_without_submit");
    expect(fn).toContain("previous_url_baseline_reliable");
    expect(fn).toContain("if (shouldSubmitToGoogle)");
    expect(fn).toContain("new_url_count");
    expect(fn).toContain("new_urls_sample");
    expect(fn).toContain("real_news_item_count");
    expect(fn).toContain("source_counts");
    expect(fn).toContain("google_submit_policy");
    expect(fn).toContain("google_submit_method");
    expect(fn).toContain("google_submit_status");
    expect(fn).not.toContain("www.google.com/ping");
    expect(fn).not.toContain("google_ping_status");

    const verifier = read("scripts/verify-production-pipeline.mjs");
    expect(verifier).toContain("new_url_submit_not_blocked_by_credentials");
    expect(verifier).toContain("ILIKE 'missing%credentials'");
    expect(verifier).toContain("submit_needed");

    expect(migration).toContain("podiverzum-refresh-sitemap-lite-15min");
    expect(migration).toContain("*/15 * * * *");
    expect(migration).toContain("submit_only_when_news_sitemap_has_new_urls");

    expect(connectorMigration).toContain("lovable_google_search_console_connector_gateway");
    expect(connectorMigration).toContain("requires_connector_secrets");
    expect(connectorMigration).toContain("LOVABLE_API_KEY");
    expect(connectorMigration).toContain("GOOGLE_SEARCH_CONSOLE_API_KEY");
    expect(connectorMigration).toContain("requires_google_secrets");
    expect(connectorMigration).not.toContain("GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY");
    expect(connectorReassertMigration).toContain("lovable_google_search_console_connector_gateway");
    expect(connectorReassertMigration).toContain("requires_connector_secrets");
    expect(connectorReassertMigration).toContain("- 'requires_google_secrets'");
    expect(connectorReassertMigration).not.toContain("GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY");
    expect(putSubmitMigration).toContain("'submit_method', 'PUT'");
    expect(putSubmitMigration).toContain("stale_lovable_gsc_submit_404_cleared_after_put_method_fix");
    expect(putSubmitMigration).toContain("'google_submit_status', NULL");
    expect(connector404Migration).toContain("record_route_missing_without_google_submit_status_404");
    expect(connector404Migration).toContain("'connector_route_missing_status', 404");
    expect(connector404Migration).toContain("'google_submit_status', NULL");
    expect(connector404GuardMigration).toContain("guard_news_sitemap_state_connector_404");
    expect(connector404GuardMigration).toContain("trg_guard_news_sitemap_state_connector_404");
    expect(connector404GuardMigration).toContain("BEFORE INSERT OR UPDATE OF value ON public.app_settings");
    expect(connector404GuardMigration).toContain("connector_route_missing_status");
    expect(connector404GuardMigration).toContain("db_guard_records_route_missing_without_google_submit_status_404");
    expect(connector404GuardMigration).toContain("'google_submit_status', NULL");

    expect(staticFallback).toContain('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"');
    expect(staticFallback).not.toContain("<url>");
    expect(staticFallback).not.toContain("podiverzum.hu/heti</loc>");
    expect(staticFallback).not.toContain("<news:publication_date>");
  });

  it("keeps root sitemap XMLs served through the Cloudflare worker with fresh news cache", () => {
    const worker = read("infra/cloudflare-worker/worker.js");
    const lovableWorker = read(".lovable/cloudflare-worker.js");
    const robots = read("public/robots.txt");

    expect(worker).toContain("const SITEMAP_CACHE_TTL_SECONDS = 900");
    expect(worker).toContain("const NEWS_SITEMAP_CACHE_TTL_SECONDS = 300");
    expect(worker).toContain('url.pathname === "/news-sitemap.xml"');
    expect(worker).toContain("worker-sitemap-proxy");
    expect(worker).toContain("storage/v1/object/public/sitemaps");
    expect(worker).toContain("X-Served-By");
    expect(worker).toContain('url.pathname === "/robots.txt"');
    expect(worker).toContain("worker-robots-policy");
    expect(worker).toContain("Content-Signal: search=yes,ai-input=yes,ai-train=no");
    expect(worker).toContain("Host: podiverzum.hu");
    expect(worker).toContain('url.hostname === "www.podiverzum.hu"');
    expect(worker).toContain('"Cache-Control": "public, max-age=31536000"');
    expect(worker).not.toContain("BEGIN Cloudflare Managed");

    expect(lovableWorker).toContain('url.pathname === "/robots.txt"');
    expect(lovableWorker).toContain("worker-robots-policy");
    expect(lovableWorker).toContain("Host: podiverzum.hu");
    expect(lovableWorker).toContain('"Cache-Control": "public, max-age=31536000"');

    expect(robots).toContain("Sitemap: https://podiverzum.hu/sitemap.xml");
    expect(robots).toContain("Sitemap: https://podiverzum.hu/news-sitemap.xml");
    expect(robots).toContain("Host: podiverzum.hu");
    expect(robots).toContain("Content-Signal: search=yes,ai-input=yes,ai-train=no");
    expect(robots).not.toContain("BEGIN Cloudflare Managed");
    expect(robots).not.toContain("User-agent: GPTBot\nDisallow: /");
    expect(robots).not.toContain("User-agent: ClaudeBot\nDisallow: /");
  });

  it("keeps IndexNow minimal, stable, and scoped to published Heti articles", () => {
    const worker = read("infra/cloudflare-worker/worker.js");
    const lovableWorker = read(".lovable/cloudflare-worker.js");
    const weeklyEditorialPost = read("supabase/functions/weekly-editorial-post/index.ts");
    const refreshSitemap = read("supabase/functions/refresh-sitemap/index.ts");
    const key = "cd4aa0ff3daa6bff678ed60d1431affc45fcf9ef72ff14c90613492dc7c32f6a";

    for (const source of [worker, lovableWorker]) {
      expect(source).toContain(`const INDEXNOW_KEY = "${key}"`);
      expect(source).toContain("const INDEXNOW_KEY_PATH = `/${INDEXNOW_KEY}.txt`");
      expect(source).toContain("url.pathname === INDEXNOW_KEY_PATH");
      expect(source).toContain("worker-indexnow-key");
      expect(source).toContain("request.method === \"HEAD\" ? null : INDEXNOW_KEY");
      expect(source.indexOf("www.podiverzum.hu")).toBeLessThan(source.indexOf("worker-indexnow-key"));
    }

    expect(weeklyEditorialPost).toContain(`const INDEXNOW_KEY = "${key}"`);
    expect(weeklyEditorialPost).toContain('const INDEXNOW_HOST = "podiverzum.hu"');
    expect(weeklyEditorialPost).toContain("const INDEXNOW_WINDOW_SECONDS = 60 * 60");
    expect(weeklyEditorialPost).toContain("https://api.indexnow.org/indexnow");
    expect(weeklyEditorialPost).toContain("method: \"POST\"");
    expect(weeklyEditorialPost).toContain("host: INDEXNOW_HOST");
    expect(weeklyEditorialPost).toContain("key: INDEXNOW_KEY");
    expect(weeklyEditorialPost).toContain("urlList: [url]");
    expect(weeklyEditorialPost).toContain("`${SITE_URL}/heti/${hetiSlug(post)}`");
    expect(weeklyEditorialPost).toContain("post.status !== \"published\"");
    expect(weeklyEditorialPost).toContain("not_published_heti_article");
    expect(weeklyEditorialPost).toContain("indexnow_controls");
    expect(weeklyEditorialPost).toContain("duplicate_window");
    expect(weeklyEditorialPost).toContain("published_heti_articles_only");
    expect(weeklyEditorialPost).toContain("last_request_body");
    expect(weeklyEditorialPost).toContain("last_response_status");
    expect(weeklyEditorialPost).toContain("last_successful_pings");
    expect(weeklyEditorialPost).toContain("last_attempts");
    expect(weeklyEditorialPost).toContain('duplicate_window_source: "last_successful_pings"');
    expect(weeklyEditorialPost).toContain("const ok = responseStatus != null && responseStatus >= 200 && responseStatus < 300");

    expect(refreshSitemap.toLowerCase()).not.toContain("indexnow");
  });

  it("keeps SEO alias routes redirected at the Cloudflare edge", () => {
    const worker = read("infra/cloudflare-worker/worker.js");
    const verifier = read("scripts/verify-production-edge-seo.mjs");
    const pkg = read("package.json");

    expect(pkg).toContain('"verify:production-edge-seo": "node scripts/verify-production-edge-seo.mjs"');

    for (const pair of [
      ['/^\\/search\\/?$/', '"/kereses"'],
      ['/^\\/categories\\/?$/', '"/kategoriak"'],
      ['/^\\/podcastok\\/?$/', '"/toplista"'],
      ['/^\\/toplist\\/?$/', '"/toplista"'],
      ['/^\\/b2b\\/?$/', '"/intelligence"'],
      ['/^\\/mediafigyeles\\/?$/', '"/intelligence"'],
      ['/^\\/heti-valogatas(\\/[^/]+)?\\/?$/', '"/heti"'],
      ['/^\\/szervezetek\\/([^/]+)\\/?$/', '"/ceg/$1"'],
      ['/^\\/part\\/([^/]+)\\/?$/', '"/ceg/$1"'],
    ]) {
      expect(worker).toContain(pair[0]);
      expect(worker).toContain(pair[1]);
    }
    expect(worker).toContain('"X-Redirect": "alias-to-canonical-301"');

    for (const path of [
      "/search",
      "/categories",
      "/podcastok",
      "/toplist",
      "/b2b",
      "/mediafigyeles",
      "/heti-valogatas",
      "/szervezetek/fradi",
      "/part/fidesz",
      "/sitemap.xml",
      "/news-sitemap.xml",
      "/robots.txt",
      "/llms.txt",
    ]) {
      expect(verifier).toContain(path);
    }
    expect(verifier).toContain('const INDEXNOW_KEY = "cd4aa0ff3daa6bff678ed60d1431affc45fcf9ef72ff14c90613492dc7c32f6a"');
    expect(verifier).toContain("path: `/${INDEXNOW_KEY}.txt`");
    expect(verifier).toContain("bodyEquals: INDEXNOW_KEY");
    expect(verifier).toContain("bodyEqualsOk");
    expect(verifier).toContain("worker-indexnow-key");
    expect(verifier).toContain("redirect: \"manual\"");
    expect(verifier).toContain("worker-sitemap-proxy");
    expect(verifier).toContain("worker-robots-policy");
    expect(verifier).toContain("https://www.podiverzum.hu/podcast/emazon?utm=test");
    expect(verifier).toContain("https://podiverzum.hu/podcast/emazon?utm=test");
    expect(verifier).toContain("max-age=31536000");
    expect(verifier).toContain("Host: podiverzum.hu");
    expect(verifier).toContain("bodyExcludes");
    expect(verifier).toContain("BEGIN Cloudflare Managed");
    expect(verifier).toContain("max-age=300");
  });

  it("keeps llms.txt canonical, Hungarian-first, and free of unsupported sitemap query URLs", () => {
    const llms = read("public/llms.txt");

    expect(llms).toContain("Magyar podcastkereső");
    expect(llms).toContain("Állapot: 2026-06-03");
    expect(llms).toContain("1 479 elfogadott magyar podcast");
    expect(llms).toContain("138 422 magyar podcast epizód");
    expect(llms).toContain("Forrás: podiverzum.hu");
    expect(llms).toContain("https://podiverzum.hu/uj-podcastok");
    expect(llms).toContain("https://podiverzum.hu/napi");
    expect(llms).toContain("https://podiverzum.hu/news-sitemap.xml");
    expect(llms).toContain("https://podiverzum.hu/sitemaps/podcasts-1.xml");
    expect(llms).toContain("English guidance for AI agents");
    expect(llms).not.toContain("Friss epizódok: https://podiverzum.hu/uj");
    expect(llms).not.toContain("sitemap.xml?type=");
    expect(llms).not.toContain("What Podiverzum Is");
  });

  it("keeps public page sitemaps on canonical non-redirecting routes", () => {
    const generated = read("supabase/functions/refresh-sitemap/index.ts");
    const legacy = read("supabase/functions/sitemap/index.ts");
    const hetiRss = read("supabase/functions/heti-rss/index.ts");
    const localGenerator = read("scripts/gen-sitemap.mjs");
    const pagesXml = read("public/sitemaps/pages.xml");

    for (const source of [generated, legacy, localGenerator, pagesXml]) {
      expect(source).toContain("/uj-podcastok");
      expect(source).toContain("/napi");
      expect(source).toContain("/heti");
      expect(source).not.toContain("podiverzum.hu/uj<");
      expect(source).not.toContain("podiverzum.hu/heti-valogatas");
    }

    const podcastSitemapBlock = legacy.slice(legacy.indexOf("async function buildPodcasts"), legacy.indexOf("async function buildEpisodesByMonth"));
    const episodeSitemapBlock = legacy.slice(legacy.indexOf("async function buildEpisodesByMonth"), legacy.indexOf("async function buildEntitiesByMonth"));
    const entitySitemapBlock = legacy.slice(legacy.indexOf("async function buildEntitiesByMonth"), legacy.indexOf("async function handler"));
    const generatedPodcastsBlock = generated.slice(generated.indexOf("// podcasts"), generated.indexOf("// people"));
    const generatedEpisodesPodcastBlock = generated.slice(generated.indexOf("const podMap = new Map"), generated.indexOf("// Stream episodes"));
    const localPodcastsBlock = localGenerator.slice(localGenerator.indexOf("// ---- podcasts"), localGenerator.indexOf("// ---- people"));
    const localEpisodesBlock = localGenerator.slice(localGenerator.indexOf("// ---- episodes"), localGenerator.indexOf("// ---- sitemap.xml"));
    for (const block of [podcastSitemapBlock, episodeSitemapBlock, entitySitemapBlock]) {
      expect(block).toContain('language_decision", "accept_hungarian"');
      expect(block).not.toContain("is_hungarian");
      expect(block).not.toContain('is_hungarian", true');
      expect(block).not.toContain('podcasts.is_hungarian", true');
    }
    for (const block of [generatedPodcastsBlock, generatedEpisodesPodcastBlock, localPodcastsBlock, localEpisodesBlock]) {
      expect(block).toContain("accept_hungarian");
      expect(block).not.toContain("is_hungarian.eq.true,language_decision.eq.accept_hungarian");
      expect(block).not.toContain("language_decision === 'reject_foreign'");
    }
    expect(generatedPodcastsBlock).toContain(".eq('language_decision', 'accept_hungarian')");
    expect(generatedEpisodesPodcastBlock).toContain(".eq('language_decision', 'accept_hungarian')");
    expect(localPodcastsBlock).toContain(".eq('language_decision', 'accept_hungarian')");
    expect(localEpisodesBlock).toContain(".eq('podcasts.language_decision', 'accept_hungarian')");

    expect(hetiRss).toContain("const HU_MAP");
    expect(hetiRss).toContain("function slugifyHu");
    expect(hetiRss).toContain(".slice(0, 60) || \"podiverzum-heti\"");
    expect(hetiRss).not.toContain(".slice(0, 80)");
  });

  it("keeps search person pins identity-safe", () => {
    const searchPage = read("src/pages/SearchPage.tsx");
    const searchHybrid = read("supabase/functions/search-hybrid/index.ts");
    const autocomplete = read("supabase/functions/search-autocomplete/index.ts");
    const sitemap = read("supabase/functions/sitemap/index.ts");
    const refreshSitemap = read("supabase/functions/refresh-sitemap/index.ts");
    const prerender = read("supabase/functions/prerender/index.ts");

    expect(searchPage).toContain("buildPersonCardContextLine");
    expect(searchPage).toContain("function isSafeSearchPerson");
    expect(searchPage).toContain("personPin?.slug && isSafeSearchPerson(personPin)");
    expect(searchPage).toContain('.in("activation_status", ["indexable", "manual_approved"])');
    expect(searchPage).not.toContain("personPin.short_bio || personPin.disambiguation_label");
    expect(searchPage).not.toContain("<p className=\"text-sm text-muted-foreground line-clamp-2 mt-1.5\">{heroPerson.short_bio}</p>");
    expect(searchHybrid).toContain("function isSafePublicPerson");
    expect(searchHybrid).toContain("!person?.slug || !person?.name || !isSafePublicPerson(person)");
    expect(searchHybrid).toContain("filter(isSafePublicPerson)");
    expect(searchHybrid).toContain("identity_ambiguous,manual_approved,ai_bio_status,ai_bio_confidence,wikipedia_match_status,wikipedia_match_confidence");
    expect(searchHybrid).toContain("identity_ambiguous: person.identity_ambiguous");
    expect(searchHybrid).toContain("is_deceased: person.is_deceased");
    expect(searchHybrid).toContain('p.persona === "historical"');
    expect(searchHybrid).toContain("|| p.date_of_death");
    expect(searchHybrid).toContain("|| p.is_living === false");
    expect(searchHybrid).toContain('return p.language_decision === "accept_hungarian";');
    expect(searchHybrid).not.toContain("is_hungarian");
    expect(searchHybrid).not.toContain('return p.is_hungarian === true || decision === "accept_hungarian";');
    expect(searchHybrid).not.toContain("trustedWiki || !hasPodcastPersonEvidence");
    expect(autocomplete).toContain("function isSafePublicPerson");
    expect(autocomplete).toContain("filter(isSafePublicPerson)");
    expect(autocomplete).toContain("if (!isSafePublicPerson(person)) continue");
    expect(sitemap).toContain("function isSafePersonSitemapRow");
    expect(refreshSitemap).toContain("function isSafePersonSitemapRow");
    expect(prerender).toContain("function isSafePublicPerson");
    expect(prerender).toContain("if (historicalWithoutEvidence) return null");
    expect(prerender).toContain(".filter(isSafePublicPerson)");
    for (const source of [searchPage, searchHybrid, autocomplete, sitemap, refreshSitemap, prerender]) {
      expect(source).toContain("is_deceased");
      expect(source).toContain("is_historical");
      expect(source).toContain("has_archival_evidence");
      expect(source).toContain("persona");
      expect(source).toContain("is_topic_only");
      expect(source).toContain("date_of_death");
      expect(source).toContain("is_living");
      expect(source).toContain("participant_count");
      expect(source).toContain("host_count");
      expect(source).toContain("guest_count");
      expect(source).toContain("manual_approved");
      expect(source).toContain("identity_ambiguous");
    }
  });

  it("keeps prerender SEO surfaces on accepted Hungarian podcast decisions", () => {
    const prerender = read("supabase/functions/prerender/index.ts");

    expect(prerender).toContain("function isAcceptedHungarianPrerenderPodcast");
    expect(prerender).toContain('return p.language_decision === "accept_hungarian";');
    expect(prerender).toContain('.eq("language_decision", "accept_hungarian")');
    expect(prerender).not.toContain("is_hungarian");
    expect(prerender).not.toContain("is_hungarian.eq.true,language_decision.eq.accept_hungarian");
    expect(prerender).not.toContain('language_decision !== "reject_foreign"');
    expect(prerender).not.toContain("language_decision !== 'reject_foreign'");
  });

  it("demotes temporal topic-only people at the database policy layer", () => {
    const migration = read("supabase/migrations/20260604232000_temporal_person_public_guard.sql");
    const strictMigration = read("supabase/migrations/20260605004500_strict_dead_person_no_podcast_profile_guard.sql");
    const collisionMigration = read("supabase/migrations/20260605013000_dead_person_name_collision_fail_closed.sql");
    const reassertMigration = read("supabase/migrations/20260605200000_reassert_temporal_person_public_guard.sql");
    const strictReassertMigration = read("supabase/migrations/20260605213000_reassert_strict_temporal_person_guard_v6.sql");
    const verifier = read("scripts/verify-production-pipeline.mjs");

    expect(migration).toContain("temporal_topic_only_guard_v1");
    expect(migration).toContain("p.is_deceased IS TRUE");
    expect(migration).toContain("p.is_historical IS TRUE");
    expect(migration).toContain("p.persona = 'historical'");
    expect(migration).toContain("p.date_of_death IS NOT NULL OR p.is_living IS FALSE");
    expect(migration).toContain("COALESCE(p.participant_count, 0) + COALESCE(p.host_count, 0) + COALESCE(p.guest_count, 0) = 0");
    expect(migration).toContain("is_public = false");
    expect(migration).toContain("is_indexable = false");
    expect(migration).toContain("is_browsable_in_people_hub = false");
    expect(strictMigration).toContain("strict_dead_person_no_podcast_profile_guard_v3");
    expect(strictMigration).toContain("p.date_of_death IS NOT NULL");
    expect(strictMigration).toContain("p.is_living IS FALSE");
    expect(strictMigration).not.toContain("bad placeholder death dates");
    expect(collisionMigration).toContain("dead_person_name_collision_fail_closed_v1");
    expect(collisionMigration).toContain("ai_review_status = 'needs_human_review'");
    expect(collisionMigration).toContain("deceased external identity cannot be assumed to be the podcast participant");
    expect(collisionMigration).toContain("COALESCE(p.participant_count, 0)");
    expect(collisionMigration).toContain("COALESCE(p.guest_count, 0)");
    expect(strictMigration).toContain("DROP FUNCTION IF EXISTS public.list_people_hub");
    expect(strictMigration).toContain("DROP FUNCTION IF EXISTS public.list_people_alpha");
    expect(reassertMigration).toContain("temporal_person_public_guard_v5");
    expect(reassertMigration).toContain("cleared_suspicious_temporal_participant_count");
    expect(reassertMigration).toContain("demoted_temporal_people_count");
    expect(reassertMigration).toContain("participant_collision_rule");
    expect(reassertMigration).toContain("status = 'rejected'");
    expect(strictReassertMigration).toContain("strict_temporal_person_guard_v6");
    expect(strictReassertMigration).toContain("participant counters can be title/subject collisions");
    expect(strictReassertMigration).toContain("p.date_of_death IS NOT NULL");
    expect(strictReassertMigration).toContain("p.is_living IS FALSE");
    expect(strictReassertMigration).not.toContain("date_of_death IS NOT NULL\n        AND");
    expect(strictReassertMigration).toContain("'version', 6");
    expect(verifier).toContain("temporal_person_guard_policy_v6");
    expect(verifier).toContain("person_bio_temporal_policy_v2");
    expect(verifier).toContain("person_bio_unchanged_input_policy_v3");
    expect(verifier).toContain("no_public_unapproved_dead_or_historical_people");
    expect(verifier).toContain("no_public_unapproved_suspicious_temporal_participants");
  });

  it("keeps person entity page copy safe for deceased or historical subjects", () => {
    const entityPage = read("src/pages/EntityPage.tsx");

    expect(entityPage).toContain("róla vagy hozzá kapcsolódóan szerepel az epizód adatai között");
    expect(entityPage).toContain("Legújabb kapcsolódó epizódok");
    expect(entityPage).toContain("Epizódok, ahol szó esik róla");
    expect(entityPage).toContain("nincs jelen ezekben az epizódokban");
    expect(entityPage).not.toContain("vele készült");
    expect(entityPage).not.toContain("vendégként szerepel");
  });

  it("extracts Wikidata temporal metadata before publishing person identities", () => {
    const enricher = read("supabase/functions/person-wikimedia-enricher/index.ts");
    const policy = read("supabase/migrations/20260604233500_person_wikidata_temporal_metadata_policy.sql");
    const staleCleanup = read("supabase/migrations/20260605121000_clear_stale_unverified_person_external_identity.sql");

    expect(enricher).toContain('firstClaimValue(entity, "P570")');
    expect(enricher).toContain('firstClaimValue(entity, "P569")');
    expect(enricher).toContain('entityHasClaimId(entity, "P31", "Q5")');
    expect(enricher).toContain("function temporalMetadataFromWikidata");
    expect(enricher).toContain("deadNameCollisionRisk");
    expect(enricher).toContain("Halott Wikidata-találat ütközik podcast-szereplő bizonyítékkal");
    expect(enricher).toContain("dead_name_collision_fail_closed_v1");
    expect(enricher).toContain("update.date_of_death = deathDate");
    expect(enricher).toContain("update.is_living = false");
    expect(enricher).toContain("update.is_deceased = true");
    expect(enricher).toContain("update.is_historical = true");
    expect(enricher).toContain('update.persona = "historical"');
    expect(enricher).toContain('update.entity_type = "historical_person"');
    expect(enricher).toContain('eq("wikipedia_match_status", "verified")');
    expect(enricher).toContain('.is("is_living", null)');
    expect(enricher).toContain("temporal=");
    expect(enricher).toContain('if (matchStatus !== "verified")');
    expect(enricher).toContain("update.wikidata_id = null");
    expect(enricher).toContain("update.wikipedia_title = null");
    expect(enricher).toContain("unverified_public_wiki_fields_cleared_v1");
    expect(enricher).toContain('bestEntity && !deadNameCollisionRisk && matchStatus === "verified"');
    expect(policy).toContain("person_wikidata_temporal_metadata_policy");
    expect(policy).toContain("P570");
    expect(policy).toContain("No AI call");
    expect(staleCleanup).toContain("clear_stale_unverified_person_external_identity_v1");
    expect(staleCleanup).toContain("p.wikipedia_match_status IS DISTINCT FROM 'verified'");
    expect(staleCleanup).toContain("wikidata_id = NULL");
    expect(staleCleanup).toContain("wikipedia_title = NULL");
    expect(staleCleanup).toContain("known_collision_szabo_laszlo_v2");
    expect(staleCleanup).toContain("unrelated film-director wiki identity must not be used");
  });

  it("keeps person bio generation closed for unapproved deceased or historical names", () => {
    const generator = read("supabase/functions/person-bio-generator/index.ts");
    const migration = read("supabase/migrations/20260606003000_person_bio_temporal_policy_v2.sql");
    const inputHashMigration = read("supabase/migrations/20260606004000_person_bio_input_hash_policy_v3.sql");
    const noJobMigration = read("supabase/migrations/20260606015000_person_bio_topic_only_no_job_policy_v4.sql");
    const reporter = read("scripts/report-production-deploy-gap.mjs");
    const verifier = read("scripts/verify-production-pipeline.mjs");

    expect(generator).toContain("const PERSON_BIO_INPUT_VERSION");
    expect(generator).toContain("function stableStringify");
    expect(generator).toContain("async function sha256");
    expect(generator).toContain('skipped: "unchanged_input"');
    expect(generator).toContain('skipped: "recorded_existing_input_hash"');
    expect(generator).toContain("previousInputHash === inputHash");
    expect(generator).toContain("cost_usd: 0");
    expect(generator).toContain("input_hash: inputHash");
    expect(generator).not.toContain('skipped: "already_done"');
    expect(generator).toContain("function isUnapprovedTemporalTopicOnlyPerson");
    expect(generator).toContain('skipped: "temporal_topic_only_person"');
    expect(generator).toContain("!isUnapprovedTemporalTopicOnlyPerson(r)");
    expect(generator).toContain("manual_approved, has_archival_evidence, is_deceased, is_historical, persona, date_of_death, is_living");
    expect(generator).toContain('p.persona === "historical"');
    expect(generator).toContain("Boolean(p.date_of_death)");
    expect(generator).toContain("p.is_living === false");
    expect(generator).toContain("Puszta tally alapján nem állítható, hogy vendég vagy műsorvezető volt");
    expect(generator).toContain("TILOS vendégként, interjúalanyként vagy műsorvezetőként bemutatni");
    expect(migration).toContain("person_bio_generation_policy");
    expect(migration).toContain("'version', 2");
    expect(migration).toContain("person-bio-generator");
    expect(inputHashMigration).toContain("'version', 3");
    expect(inputHashMigration).toContain("'input_hash_required', true");
    expect(inputHashMigration).toContain("'unchanged_input_skip_before_job', true");
    expect(inputHashMigration).toContain("'unchanged_input_estimated_cost_usd', 0");
    expect(noJobMigration).toContain("'version', 4");
    expect(noJobMigration).toContain("'skip_before_enrichment_job', true");
    expect(noJobMigration).toContain("'skip_before_ai_call', true");
    expect(noJobMigration).toContain("'dead_without_podcast_role_policy', 'topic_only_no_generated_podcast_persona'");
    expect(verifier).toContain("person_bio_topic_only_no_job_policy_v4");
    expect(reporter).toContain("person_bio_temporal_policy");
    expect(reporter).toContain("person_bio_input_hash_policy_v3");
    expect(reporter).toContain("person_bio_topic_only_no_job_policy_v4");
  });

  it("uses accepted language decisions for person evidence pipelines without the legacy RSS HU flag", () => {
    const files = [
      "supabase/functions/person-entity-extractor/index.ts",
      "supabase/functions/person-bio-generator/index.ts",
      "supabase/functions/person-ai-reviewer/index.ts",
      "supabase/functions/person-relevance-judge/index.ts",
      "supabase/functions/person-wiki-review-runner/index.ts",
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).toContain('language_decision", "accept_hungarian"');
      expect(source).not.toContain("is_hungarian");
      expect(source).not.toContain('eq("podcasts.is_hungarian", true)');
      expect(source).not.toContain('eq("episodes.podcasts.is_hungarian", true)');
    }
  });

  it("uses accepted language decisions for entity intelligence pipelines without the legacy RSS HU flag", () => {
    const files = [
      "supabase/functions/entity-profile-runner/index.ts",
      "supabase/functions/entity-backfill-runner/index.ts",
      "supabase/functions/organization-ai-reviewer/index.ts",
      "supabase/functions/data-repair-apply-runner/index.ts",
      "supabase/functions/intelligence-reprocess-admin/index.ts",
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).toContain('language_decision", "accept_hungarian"');
      expect(source).not.toContain("is_hungarian");
      expect(source).not.toContain('eq("podcasts.is_hungarian", true)');
      expect(source).not.toContain('eq("episodes.podcasts.is_hungarian", true)');
    }
  });

  it("keeps high-trust Hungarian publishers in the news sitemap source policy", () => {
    const fn = read("supabase/functions/refresh-sitemap/index.ts");

    for (const source of [
      "444",
      "telex",
      "partizan",
      "hvg",
      "portfolio",
      "hold",
      "g7",
      "qubit",
      "direkt36",
      "lakmusz",
    ]) {
      expect(fn.toLowerCase()).toContain(source);
    }
  });

  it("keeps podcast category guard from misclassifying obvious religious channels", () => {
    const runner = read("supabase/functions/categorize-podcast-runner/index.ts");
    const migration = read("supabase/migrations/20260604224500_religion_category_guard_v2.sql");

    expect(runner).toContain("function deterministicCategoryOverride");
    expect(runner).toContain("RELIGION_STRONG_TITLE_RX");
    expect(runner).toContain("deterministic-category-guard-v2");
    expect(runner).toContain("deterministic_count");
    expect(runner).toContain("website_url, rss_url, category, shadow_rank_tier");
    expect(runner).toContain('.eq("language_decision", "accept_hungarian")');
    expect(runner).not.toContain('.eq("is_hungarian", true)');
    expect(runner).not.toContain("is_hungarian.eq.true,language_decision.eq.accept_hungarian");
    for (const term of ["zarandok", "maria ut", "gyulekezet", "baptista", "istentisztelet", "predikacio", "igehirdetes", "biblia"]) {
      expect(runner).toContain(term);
      expect(migration).toContain(term);
    }
    expect(migration).toContain("podcast_category_guard_policy");
    expect(migration).toContain("deterministic_category_guard_v2");
    expect(migration).toContain("Zarándok.ma");
    expect(migration).toContain("titleish !~");
    expect(migration).toContain("orban");
  });

  it("uses accepted language decisions for topic taxonomy pipelines without the legacy RSS HU flag", () => {
    const files = [
      "supabase/functions/categorize-podcast-runner/index.ts",
      "supabase/functions/episode-topic-extractor/index.ts",
      "supabase/functions/topic-candidates-runner/index.ts",
      "supabase/functions/topic-judge-runner/index.ts",
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).toContain('language_decision", "accept_hungarian"');
      expect(source).not.toContain("is_hungarian");
      expect(source).not.toContain("is_hungarian.eq.true");
      expect(source).not.toContain('eq("podcasts.is_hungarian", true)');
      expect(source).not.toContain('eq("episodes.podcasts.is_hungarian", true)');
    }
  });

  it("uses accepted language decisions for language rechecks and clean-text samples", () => {
    const acceptedOnlyFiles = [
      "supabase/functions/rss-hunter/index.ts",
      "supabase/functions/ai-language-verifier/index.ts",
      "scripts/export-clean-text-gold-sample.mjs",
      "scripts/export-clean-text-routing-canary.mjs",
      "scripts/audit-cleaner-quality-sample.mjs",
      "scripts/verify-production-pipeline.mjs",
    ];
    const shadow = read("supabase/functions/hu-formula-v2-shadow/index.ts");

    for (const file of acceptedOnlyFiles) {
      const source = read(file);
      expect(source).toContain("accept_hungarian");
      expect(source).not.toContain('.eq("is_hungarian", true)');
      expect(source).not.toContain("is_hungarian.eq.true");
      expect(source).not.toContain("p.is_hungarian = true");
      expect(source).not.toContain("p.is_hungarian=true");
      expect(source).not.toContain("(p.is_hungarian = true OR p.language_decision = 'accept_hungarian')");
    }

    expect(shadow).toContain('.in("language_decision", ["accept_hungarian", "review_uncertain"])');
    expect(shadow).not.toContain("is_hungarian.eq.true");
    expect(shadow).not.toContain("is_hungarian.eq.true,language_decision.eq.accept_hungarian");
  });

  it("keeps publisher article matching wired into best text source", () => {
    const migration = read("supabase/migrations/20260603164000_article_pipeline_consolidated.sql");
    const reassertMigration = read("supabase/migrations/20260605210000_reassert_article_pairer_sources_v4.sql");
    const strictPatternsMigration = read("supabase/migrations/20260605225000_reassert_article_pairer_brand_anchor_patterns.sql");
    const strictPatternsV2Migration = read("supabase/migrations/20260606013000_reassert_article_pairer_brand_anchor_patterns_v2.sql");
    const readonlyPolicyMigration = read("supabase/migrations/20260605211000_episode_article_candidates_readonly_policy.sql");
    const transcriptFirstMigration = read("supabase/migrations/20260607093000_best_text_source_transcript_first.sql");
    const pairer = read("supabase/functions/episode-article-pairer/index.ts");
    const fastLane = read("supabase/functions/database-quality-fast-lane/index.ts");
    const bestSource = read("supabase/functions/episode-best-text-source-runner/index.ts");
    const cleanTextRunner = read("supabase/functions/episode-clean-text-runner/index.ts");
    const verifier = read("scripts/verify-production-pipeline.mjs");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.episode_article_candidates");
    expect(migration).toContain("CHECK (source_type IN ('rss', 'spotify', 'youtube', 'article'))");
    expect(migration).toContain("'source_version', 'publisher_sources_v3'");
    expect(migration).toContain("'policy', 'best_text_source_v2_confirmed_article_youtube_first'");
    expect(migration).toContain("'article_min_confidence', 0.82");
    expect(migration).toContain("'run_article_pairer', true");
    for (const outlet of ["444", "telex", "hvg", "portfolio", "hold", "partizan"]) {
      expect(migration.toLowerCase()).toContain(outlet);
    }
    expect(reassertMigration).toContain("'source_version', 'publisher_sources_v4'");
    expect(reassertMigration).toContain("'sources_per_run', 3");
    expect(reassertMigration).toContain("'outlet', 'qubit'");
    expect(reassertMigration).toContain("'article_pairer_sources_per_run', 3");
    expect(strictPatternsMigration).toContain("'pattern_safety_version', 'brand_anchor_no_topic_words_v1'");
    expect(strictPatternsMigration).toContain("'patterns_policy', 'brand_or_show_name_only_no_topic_words'");
    expect(strictPatternsMigration).toContain("'blocked_generic_title_patterns'");
    expect(strictPatternsV2Migration).toContain("'pattern_safety_version', 'brand_anchor_no_topic_words_v2'");
    expect(strictPatternsV2Migration).toContain("article_pairer pattern_safety_version was not reasserted to v2");
    expect(strictPatternsV2Migration).toContain("article_pairer found % blocked generic podcast_title_patterns");
    expect(strictPatternsMigration).toContain("'podcast_title_patterns', jsonb_build_array('hvg', 'fülke')");
    expect(strictPatternsMigration).toContain("'podcast_title_patterns', jsonb_build_array('portfolio', 'portfolio checklist')");
    expect(strictPatternsMigration).toContain("'podcast_title_patterns', jsonb_build_array('hold', 'hold after hours', 'holdblog')");
    expect(strictPatternsMigration).toContain("'podcast_title_patterns', jsonb_build_array('telex', 'telex after', 'nyomozó podcast', 'ízfokozó', 'telex filmklub')");
    expect(strictPatternsMigration).not.toContain("jsonb_build_array('hvg', 'fülke', 'közélet'");
    expect(strictPatternsMigration).not.toContain("jsonb_build_array('portfolio', 'checklist'");
    expect(strictPatternsMigration).not.toContain("jsonb_build_array('hold', 'hold after hours', 'holdblog', 'after hours'");
    expect(readonlyPolicyMigration).toContain("current_user = 'readonly_codex'");
    expect(readonlyPolicyMigration).toContain("episode_article_candidate_readonly_policy");
    expect(transcriptFirstMigration).toContain("CHECK (source_type IN ('rss', 'spotify', 'youtube', 'article', 'transcript'))");
    expect(transcriptFirstMigration).toContain("'policy', 'best_text_source_v3_transcript_first_confirmed_article_youtube'");
    expect(transcriptFirstMigration).toContain("'transcript_source_hash_passthrough', true");
    expect(transcriptFirstMigration).toContain("'timestamp_chunking_requires_transcript_hash_match', true");

    expect(pairer).toContain("scorePublisherArticleMatch");
    expect(pairer).toContain("episode_article_candidates");
    expect(pairer).toContain("source_diagnostics");
    expect(pairer).toContain("best_rejected_scores");
    expect(pairer).toContain("DEFAULT_BLOCKED_GENERIC_TITLE_PATTERNS");
    expect(pairer).toContain("safePodcastTitlePatterns");
    expect(pairer).toContain('runtime_pattern_policy: "brand_anchor_no_topic_words_v2"');
    expect(pairer).toContain("blocked_generic_patterns_filtered");
    expect(pairer).toContain('.eq("podcasts.language_decision", "accept_hungarian")');
    expect(pairer).not.toContain("is_hungarian");
    expect(pairer).not.toContain('eq("podcasts.is_hungarian", true)');
    expect(fastLane).toContain("sources_per_run");
    expect(fastLane).toContain("article_pairer_sources_per_run");
    expect(bestSource).toContain('source_type: "article"');
    expect(bestSource).toContain("article_min_confidence");
    expect(bestSource).toContain("confirmed_publisher_article_longer_or_rss_short");
    expect(bestSource).toContain('source_type: "transcript"');
    expect(bestSource).toContain("function transcriptRank");
    expect(bestSource).toContain("full_transcript_longer_or_rss_thin");
    expect(bestSource).toContain("content_hash: transcript.content_hash || null");
    expect(bestSource).toContain("has_segments: Array.isArray(transcript.segments)");
    expect(cleanTextRunner).toContain('best?.source_type === "transcript"');
    expect(cleanTextRunner).toContain("best.evidence.content_hash");
    expect(cleanTextRunner).toContain("const source_hash = transcriptHash || await sha256Hex");

    expect(verifier).toContain("source_count_at_least_6");
    expect(verifier).toContain("no_generic_article_pairer_title_patterns");
    expect(verifier).toContain("best_source_accepts_article");
    expect(verifier).toContain("best_source_accepts_transcript");
    expect(verifier).toContain("best_source_transcript_policy");
    expect(verifier).toContain("best_source_article_policy");
    expect(verifier).toContain("text_policy_transcript_hash_passthrough");
    expect(verifier).toContain("text_policy_timestamp_hash_match_recorded");
    expect(verifier).toContain("pattern_safety_version_v2_recorded");
  });

  it("keeps Spotify native transcript drain operator-controlled and private-display only", () => {
    const runner = read("supabase/functions/spotify-transcript-runner/index.ts");
    const migration = read("supabase/migrations/20260607094500_spotify_transcript_runner_controls.sql");
    const verifier = read("scripts/verify-production-pipeline.mjs");
    const reporter = read("scripts/report-production-deploy-gap.mjs");
    const adminPage = read("src/pages/AdminSpotifyTranscriptPage.tsx");
    const app = read("src/App.tsx");
    const adminHub = read("src/pages/AdminHubPage.tsx");

    expect(runner).toContain('const SPOTIFY_MODEL = "spotify-native"');
    expect(runner).toContain("spotify_transcript_controls");
    expect(runner).toContain("ctrl.enabled !== true");
    expect(runner).toContain("dailyCap");
    expect(runner).toContain("spotify_transcript_state");
    expect(runner).toContain("nextSkip");
    expect(runner).toContain("res.status === 403 || res.status === 429");
    expect(runner).toContain("enabled: false");
    expect(runner).toContain('rights_status: "spotify_private_api_index_only"');
    expect(runner).toContain("public_display: false");
    expect(runner).toContain("segments: normalized.segments");
    expect(runner).toContain("content_hash: await sha256(normalized.text)");
    expect(runner).toContain("async function invokeBestTextSourceRunner");
    expect(runner).toContain("/functions/v1/episode-best-text-source-runner");
    expect(runner).toContain('source: "spotify_transcript_runner"');
    expect(runner).toContain("writtenEpisodeIds.push(c.episode_id)");
    expect(runner).toContain("ctrl.auto_best_text_source === false");
    expect(runner).toContain("try {\n        downstreamBestTextSource = await invokeBestTextSourceRunner(writtenEpisodeIds);");
    expect(runner).toContain("downstreamBestTextSource = { ok: false, error: e?.message || String(e) }");
    expect(runner).toContain("downstream_best_text_source: downstreamBestTextSource");
    expect(runner).toContain("written_episode_ids: writtenEpisodeIds.slice(-50)");

    expect(migration).toContain("'spotify_transcript_controls'");
    expect(migration).toContain("'enabled', false");
    expect(migration).toContain("'policy', 'default_disabled_operator_controlled_native_transcript_indexing_v1'");
    expect(migration).toContain("'public_display', false");
    expect(migration).toContain("'spotify_transcript_state'");
    expect(migration).toContain("'podiverzum-spotify-transcript-runner'");
    expect(migration).toContain("'*/5 * * * *'");
    expect(migration).toContain("'cron_job', 'podiverzum-spotify-transcript-runner'");
    expect(migration).toContain("'cron_schedule', '*/5 * * * *'");
    expect(migration).toContain("'name', 'spotify_transcript_runner'");

    expect(verifier).toContain("spotify_transcript_pipeline");
    expect(verifier).toContain("controls_default_disabled");
    expect(verifier).toContain("watchdog_registered");
    expect(verifier).toContain("cron_policy_recorded");
    expect(verifier).toContain("episode_transcripts_has_private_display_guard");

    expect(reporter).toContain("spotify_transcript_pipeline");
    expect(reporter).toContain("spotify-transcript-runner");
    expect(reporter).toContain("20260607094500_spotify_transcript_runner_controls.sql");

    expect(app).toContain("AdminSpotifyTranscriptPage");
    expect(app).toContain('path="/admin/spotify-transcripts"');
    expect(adminHub).toContain("/admin/spotify-transcripts");
    expect(adminPage).toContain("spotify_transcript_controls");
    expect(adminPage).toContain("spotify_transcript_state");
    expect(adminPage).toContain("spotify_transcript_progress");
    expect(adminPage).toContain('supabase.functions.invoke("spotify-transcript-runner"');
    expect(adminPage).toContain("public_display: false");
    expect(adminPage).toContain("rights_status");
    expect(adminPage).toContain("batch_size");
    expect(adminPage).toContain("daily_cap");
    expect(adminPage).toContain("delay_ms");
    expect(adminPage).toContain("Pilot 1");
  });

  it("keeps public AI text Hungarian-only at the edge and database layer", () => {
    const guard = read("supabase/functions/_shared/hu-language-guard.ts");
    const aiEnrich = read("supabase/functions/ai-enrich/index.ts");
    const seoEnqueue = read("supabase/functions/seo-enrich-enqueue/index.ts");
    const seoRunner = read("supabase/functions/seo-enrich-runner/index.ts");
    const migration = read("supabase/migrations/20260603162000_public_ai_language_guard_consolidated.sql");
    const phraseMigration = read("supabase/migrations/20260605010000_public_ai_language_guard_v4_english_phrase_detection.sql");
    const verifier = read("scripts/verify-production-pipeline.mjs");

    expect(guard).toContain("nonHungarianPublicFields");
    expect(guard).toContain("assertHungarianPublicFields");
    expect(guard).toContain("enRatio > 0.12");
    expect(aiEnrich).toContain("assertHungarianPublicFields({ summary })");
    expect(aiEnrich).toContain("assertHungarianPublicFields({ summary: parsed.summary })");
    expect(seoRunner).toContain("assertHungarianPublicFields({ seo_title, seo_description, ai_summary })");
    expect(seoEnqueue).toContain('language_decision", "accept_hungarian"');
    expect(seoRunner).toContain('return meta?.language_decision === "accept_hungarian";');
    for (const source of [seoEnqueue, seoRunner]) {
      expect(source).not.toContain("is_hungarian");
      expect(source).not.toContain("reject_foreign");
      expect(source).not.toContain("confirmed_foreign");
      expect(source).not.toContain("reject_non_hungarian");
    }

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.is_hungarianish_public_ai_text");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.enforce_hu_episode_public_ai_text");
    expect(migration).toContain("CREATE TRIGGER trg_enforce_hu_episode_public_ai_text");
    expect(migration).toContain("CREATE TRIGGER trg_enforce_hu_podcast_public_ai_text");
    expect(migration).toContain("en_ratio > 0.12");
    expect(migration).toContain("tmp_non_hu_episode_public_text_v3");
    expect(migration).toContain("non_hu_public_text_repair_episode_v3");
    expect(migration).toContain("non_hu_public_text_repair_podcast_v3");
    expect(migration).toContain("public_ai_language_guard_policy");
    expect(migration).toContain("'version', 3");
    expect(migration).toContain("'repair_job_source', 'migration_20260603162000'");
    expect(migration).toContain("trg_enforce_hu_episode_public_ai_text");
    expect(migration).toContain("trg_enforce_hu_podcast_public_ai_text");
    expect(guard).toContain("EN_PUBLIC_TEXT_PHRASES");
    expect(phraseMigration).toContain("'version', 4");
    expect(phraseMigration).toContain("tmp_non_hu_episode_public_text_v4");
    expect(phraseMigration).toContain("non_hu_public_text_repair_episode_v4");
    expect(phraseMigration).toContain("english_phrase_guard");
    expect(phraseMigration).toContain("this[[:space:]]+episode");
    expect(phraseMigration).toContain("key[[:space:]]+(takeaways|themes|insights)");

    expect(verifier).toContain("episode_trigger_exists");
    expect(verifier).toContain("podcast_trigger_exists");
    expect(verifier).toContain("policy_configured_v3");
    expect(verifier).toContain("episode_ai_summary_data_clean");
    expect(verifier).toContain("episode_seo_title_data_clean");
    expect(verifier).toContain("episode_seo_description_data_clean");
    expect(verifier).toContain("podcast_seo_title_data_clean");
    expect(verifier).toContain("podcast_seo_description_data_clean");
    expect(verifier).toContain("NOT public.is_hungarianish_public_ai_text");
  });

  it("keeps production verifier covering recommendation and people identity policies", () => {
    const verifier = read("scripts/verify-production-pipeline.mjs");
    const reassertV5 = read("supabase/migrations/20260605203000_reassert_recommendation_compatibility_v5_content_bridge.sql");
    const surfaceEnable = read("supabase/migrations/20260606184000_reassert_smart_player_recommendation_surface_enabled_v2.sql");
    const policySettingsV5 = read("supabase/migrations/20260605214000_reassert_related_quality_policy_v5_settings.sql");
    const publicAffairsOverrideTerms = read("supabase/migrations/20260605215000_reassert_related_public_affairs_override_terms.sql");
    const recommendationDiagnostics = read("supabase/migrations/20260605232000_reassert_similar_episode_diagnostics.sql");
    const homeRailPolicy = read("supabase/migrations/20260606005000_personalized_home_rails_reason_policy.sql");
    const homeRailMainPolicy = read("supabase/migrations/20260606011000_personalized_home_main_rail_reason_policy.sql");
    const recommendationDiagnosticsV4 = read("supabase/migrations/20260606020000_reassert_recommendation_diagnostics_policy_v4.sql");
    const homeRails = read("supabase/functions/personalized-home-rails/index.ts");
    const personalizedHome = read("src/components/home/PersonalizedHomeRails.tsx");
    const peopleMigration = read("supabase/migrations/20260603170000_people_identity_safety_consolidated.sql");
    const peopleHubFilterMigration = read("supabase/migrations/20260604213000_people_hub_identity_safe_filters.sql");
    const prerender = read("supabase/functions/prerender/index.ts");

    expect(verifier).toContain("related_episode_quality_policy");
    expect(verifier).toContain("people_hub_identity_safety_policy");
    expect(verifier).toContain("snapshot.related_episode_quality?.compatibility_function_exists === true");
    expect(verifier).toContain("snapshot.related_episode_quality?.content_bridge_function_exists === true");
    expect(verifier).toContain("text_group_function_exists");
    expect(verifier).toContain("topic_bridge_function_exists");
    expect(verifier).toContain("content_bridge_function_exists");
    expect(verifier).toContain("recommendation_diagnostics_policy");
    expect(verifier).toContain("diagnostics_policy_configured_v1");
    expect(verifier).toContain("diagnostics_policy_configured_v4");
    expect(verifier).toContain("diagnostics_related_reason_required");
    expect(verifier).toContain("diagnostics_reason_sources_recorded");
    expect(verifier).toContain("diagnostics_public_surface_lock_recorded");
    expect(verifier).toContain("diagnostics_reason_min_chars_recorded");
    expect(verifier).toContain("personalized_home_rails_seed_reason_policy_v2");
    expect(verifier).toContain("personalized_home_rails_main_reason_policy_v3");
    expect(verifier).toContain("related_rpc_returns_related_reason");
    expect(verifier).toContain("similar_rpc_returns_related_reason");
    expect(verifier).toContain("similar_rpc_builds_diagnostic_reason");
    expect(verifier).toContain("smart_player_recommendation_surface_policy");
    expect(verifier).toContain("smart_player_recommendation_surface");
    expect(verifier).toContain("policy_configured_v2");
    expect(verifier).toContain("enabled_for_public_recommendations");
    expect(verifier).toContain("public_rpc_execute_recorded");
    expect(verifier).toContain("accepted_hungarian_catalog_required_recorded");
    expect(verifier).toContain("consumer_safe_copy_required_recorded");
    expect(verifier).toContain("related_reason_required_recorded");
    expect(verifier).toContain("related_public_rpc_anon_granted");
    expect(verifier).toContain("similar_public_rpc_anon_granted");
    expect(verifier).toContain("discover_public_rpc_anon_granted");
    expect(verifier).toContain("service_role_execute_retained");
    expect(verifier).toContain("policy_configured_v4");
    expect(verifier).toContain("policy_configured_v5");
    expect(verifier).toContain("different_specific_groups_require_bridge_recorded");
    expect(verifier).toContain("specific_to_general_bridge_required_recorded");
    expect(verifier).toContain("recommendation_is_compatible('public_affairs', 'religion', 0.99::double precision, true) = false");
    expect(verifier).toContain("recommendation_is_compatible('public_affairs', 'business', 0.96::double precision, false) = false");
    expect(verifier).toContain("recommendation_is_compatible('public_affairs', 'business', 0.41::double precision, true) = true");
    expect(verifier).toContain("recommendation_is_compatible('public_affairs', 'general', 0.97::double precision, false) = false");
    expect(verifier).toContain("recommendation_has_content_bridge");
    expect(verifier).toContain("content_bridge_runtime_check_error");
    expect(verifier).toContain("public_affairs_title_with_isten_runtime_grouped");
    expect(verifier).toContain("Mészáros Lőrinc tündöklése");
    expect(reassertV5).toContain("recommendation_has_content_bridge");
    expect(reassertV5).toContain("20260605203000_reassert_recommendation_compatibility_v5_content_bridge");
    expect(reassertV5).toContain("'version', 5");
    expect(reassertV5).toContain("'public_affairs_override_terms'");
    expect(reassertV5).toContain("public.recommendation_has_content_bridge(");
    expect(reassertV5).toContain("GRANT EXECUTE ON FUNCTION public.recommendation_has_content_bridge");
    expect(surfaceEnable).toContain("smart_player_recommendation_surface_policy");
    expect(surfaceEnable).toContain("'version', 2");
    expect(surfaceEnable).toContain("'enabled', true");
    expect(surfaceEnable).toContain("'public_rpc_execute', true");
    expect(surfaceEnable).toContain("'accepted_hungarian_catalog_required', true");
    expect(surfaceEnable).toContain("'consumer_safe_copy_required', true");
    expect(surfaceEnable).toContain("'related_reason_required', true");
    expect(surfaceEnable).toContain("GRANT EXECUTE ON FUNCTION public.get_related_episodes_by_embedding(uuid, integer, boolean) TO anon, authenticated, service_role");
    expect(surfaceEnable).toContain("GRANT EXECUTE ON FUNCTION public.similar_episodes(uuid, integer) TO anon, authenticated, service_role");
    expect(surfaceEnable).toContain("GRANT EXECUTE ON FUNCTION public.smart_player_discover(uuid, integer) TO anon, authenticated, service_role");
    expect(policySettingsV5).toContain("'version', 5");
    expect(policySettingsV5).toContain("'specific_to_general', 'explicit_bridge_required'");
    expect(policySettingsV5).toContain("'general_to_specific', 'explicit_bridge_required'");
    expect(policySettingsV5).toContain("20260605214000_reassert_related_quality_policy_v5_settings");
    expect(publicAffairsOverrideTerms).toContain("'public_affairs_override_terms'");
    expect(publicAffairsOverrideTerms).toContain("public_affairs_override_terms_reasserted_by");
    expect(publicAffairsOverrideTerms).toContain("20260605215000_reassert_related_public_affairs_override_terms");
    expect(recommendationDiagnostics).toContain("recommendation_diagnostics_policy");
    expect(recommendationDiagnostics).toContain("related_reason text");
    expect(recommendationDiagnostics).toContain("'related_reason_required', true");
    expect(recommendationDiagnostics).toContain("'personalized-home-rails'");
    expect(homeRailPolicy).toContain("'version', 2");
    expect(homeRailPolicy).toContain("'personalized_home_rails_seed_reason_required', true");
    expect(homeRailPolicy).toContain("'personalized_home_rails_seed_source', 'similar_episodes'");
    expect(homeRailMainPolicy).toContain("'version', 3");
    expect(homeRailMainPolicy).toContain("'personalized_home_rails_main_reason_required', true");
    expect(homeRailMainPolicy).toContain("'personalized_home_rails_main_source', 'match_episodes_by_user_history'");
    expect(homeRailMainPolicy).toContain("'personalized_home_rails_main_min_similarity', 0.18");
    expect(recommendationDiagnosticsV4).toContain("'version', 4");
    expect(recommendationDiagnosticsV4).toContain("'related_reason_min_chars', 12");
    expect(recommendationDiagnosticsV4).toContain("'user_history_centroid'");
    expect(recommendationDiagnosticsV4).toContain("'public_surface_locked_until_quality_trusted', true");
    expect(recommendationDiagnosticsV4).toContain("public.app_settings.value || EXCLUDED.value");
    expect(homeRails).toContain("function hasDiagnosticRelatedReason");
    expect(homeRails).toContain(".filter(hasDiagnosticRelatedReason)");
    expect(homeRails).toContain("function hasMinimumMainRailSimilarity");
    expect(homeRails).toContain(".filter(hasMinimumMainRailSimilarity)");
    expect(homeRails).not.toContain("withMainRailDiagnosticReason");
    expect(homeRails).not.toContain("MAIN_RAIL_REASON");
    expect(homeRails).toContain("related_reason_required_for_main_rail: true");
    expect(homeRails).toContain('main_rail_source: "match_episodes_by_user_history"');
    expect(homeRails).toContain("related_reason_required_for_seed_rails: true");
    expect(homeRails).toContain('seed_rails_source: "similar_episodes"');
    expect(homeRails).not.toContain("items: sim");
    expect(personalizedHome).toContain("sanitizeHungarianPublicText(r.related_reason)");
    expect(personalizedHome).toContain("why_matched:");
    expect(verifier).toContain("list_people_hub_has_identity_fields");
    expect(verifier).toContain("list_people_alpha_has_identity_fields");
    expect(verifier).toContain("policy_configured_v2");
    expect(verifier).toContain("prerender_bio_rule_recorded");
    expect(verifier).toContain("failures.push(`related_episode_quality.${key}`)");
    expect(verifier).toContain("failures.push(`people_hub_identity_safety.${key}`)");

    expect(peopleMigration).toContain("'version', 2");
    expect(peopleMigration).toContain("prerender_bio_rule");
    expect(peopleMigration).toContain("identity_ambiguous boolean");
    expect(peopleMigration).toContain("wikipedia_match_confidence numeric");
    expect(peopleHubFilterMigration).toContain("CREATE OR REPLACE FUNCTION public.list_people_hub");
    expect(peopleHubFilterMigration).toContain("CREATE OR REPLACE FUNCTION public.list_people_alpha");
    expect(peopleHubFilterMigration).toContain("CREATE OR REPLACE FUNCTION public.people_alpha_letter_counts");
    expect(peopleHubFilterMigration).toContain("p.is_indexable = true");
    expect(peopleHubFilterMigration).toContain("COALESCE(p.activation_status, 'indexable') IN ('indexable', 'manual_approved')");
    expect(peopleHubFilterMigration).toContain("COALESCE(p.ai_recommended_action, '') NOT IN ('hide', 'reject')");
    expect(peopleHubFilterMigration).toContain("COALESCE(p.ai_review_status, '') NOT IN ('needs_human_review', 'duplicate_candidate')");
    expect(peopleHubFilterMigration).toContain("COALESCE(p.identity_status, '') <> 'split_resolved'");
    expect(peopleHubFilterMigration).toContain("COALESCE(p.identity_ambiguous, false) = true");

    expect(prerender).toContain("safePersonBioForPrerender");
    expect(prerender).toContain("isSafeGeneratedPersonBio");
    expect(prerender).toContain("wikipedia_match_confidence");
    expect(prerender).not.toContain("const bio = stripHtml(person.ai_bio ||");
  });
});
