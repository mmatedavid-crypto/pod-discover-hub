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
    const pkg = read("package.json");

    expect(pkg).toContain('"report:production-deploy-gap": "node scripts/report-production-deploy-gap.mjs"');
    expect(reporter).toContain("verify-production-pipeline.mjs");
    expect(reporter).toContain("verify-production-edge-seo.mjs");
    for (const group of [
      "clean_text_backfill_gates",
      "article_pipeline",
      "seo_news_sitemap",
      "public_ai_language_guard",
      "related_episode_quality",
      "search_quality_benchmark",
      "people_hub_identity_safety",
      "edge_worker_seo",
    ]) {
      expect(reporter).toContain(group);
    }
    for (const artifact of [
      "20260603171000_clean_text_backfill_quality_gate_consolidated.sql",
      "20260603164000_article_pipeline_consolidated.sql",
      "20260603111500_news_sitemap_fast_refresh_cron.sql",
      "20260603221000_news_sitemap_gsc_connector_gateway.sql",
      "20260604094229_reassert_news_sitemap_gsc_connector.sql",
      "20260603162000_public_ai_language_guard_consolidated.sql",
      "20260603165000_related_episode_quality_consolidated.sql",
      "20260604001000_recommendation_compatibility_v4.sql",
      "20260604091642_reassert_recommendation_compatibility_v4.sql",
      "20260605003000_recommendation_compatibility_v5_entity_bridge.sql",
      "20260605001000_search_quality_weekly_automation.sql",
      "20260603170000_people_identity_safety_consolidated.sql",
      "episode-article-pairer",
      "refresh-sitemap",
      "search-golden-refresh",
      "search-benchmark-runner",
      "ai-enrich",
      "prerender",
      "infra/cloudflare-worker/worker.js",
      ".lovable/cloudflare-worker.js",
    ]) {
      expect(reporter).toContain(artifact);
    }
  });

  it("keeps search golden refresh and benchmark on a weekly automated quality loop", () => {
    const migration = read("supabase/migrations/20260605001000_search_quality_weekly_automation.sql");
    const goldenRunner = read("supabase/functions/search-golden-refresh/index.ts");
    const benchmarkRunner = read("supabase/functions/search-benchmark-runner/index.ts");

    expect(migration).toContain("search_golden_refresh_controls");
    expect(migration).toContain("search_benchmark_controls");
    expect(migration).toContain("podiverzum-search-golden-refresh-weekly");
    expect(migration).toContain("podiverzum-search-benchmark-runner-30min");
    expect(migration).toContain("weekly_drain");
    expect(migration).toContain("fetch failures excluded from quality metrics");

    expect(goldenRunner).toContain("refresh_search_golden_queries_from_catalog");
    expect(goldenRunner).toContain("refresh_search_golden_queries_from_external_demand");
    expect(goldenRunner).toContain("search_golden_refresh_progress");

    expect(benchmarkRunner).toContain("Weekly search benchmark");
    expect(benchmarkRunner).toContain("batch_size");
    expect(benchmarkRunner).toContain("search-hybrid");
    expect(benchmarkRunner).toContain("AUTO_WEEKLY_SCORED");
    expect(benchmarkRunner).toContain('raw_meta?.status !== "fetch_error"');
    expect(benchmarkRunner).toContain("search_benchmark_progress");
    expect(benchmarkRunner).toContain("precision_at_3");
    expect(benchmarkRunner).toContain("ndcg_at_10");
    expect(benchmarkRunner).toContain("false_positive_rate");
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
    expect(verifier).toContain("episode_article_pairer_progress");

    const pairer = read("supabase/functions/episode-article-pairer/index.ts");
    expect(pairer).toContain('parser_policy: "regex_xml_no_domparser_v2"');
    expect(pairer).toContain("verified_upsert_rows");
    expect(pairer).toContain("total_article_candidates");
    expect(pairer).toContain('.select("id")');
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

    expect(verifier).toContain("legacy_v3_backfill_quality_gated");
    expect(verifier).not.toContain("legacy_v3_backfill_enabled', (SELECT");
  });

  it("keeps news sitemap submission new-url-gated through Google Search Console", () => {
    const fn = read("supabase/functions/refresh-sitemap/index.ts");
    const migration = read("supabase/migrations/20260603111500_news_sitemap_fast_refresh_cron.sql");
    const connectorMigration = read("supabase/migrations/20260603221000_news_sitemap_gsc_connector_gateway.sql");
    const connectorReassertMigration = read("supabase/migrations/20260604094229_reassert_news_sitemap_gsc_connector.sql");
    const staticFallback = read("public/news-sitemap.xml");

    expect(fn).toContain("submitGoogleSearchConsoleSitemap");
    expect(fn).toContain("https://connector-gateway.lovable.dev/google_search_console/webmasters/v3/sites/");
    expect(fn).toContain("method: 'POST'");
    expect(fn).toContain("LOVABLE_API_KEY");
    expect(fn).toContain("GOOGLE_SEARCH_CONSOLE_API_KEY");
    expect(fn).toContain("X-Connection-Api-Key");
    expect(fn).toContain("missing_lovable_gsc_connector_credentials");
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
    expect(freshEpisodesBlock).toContain("RSS is_hungarian is noisy");
    expect(freshEpisodesBlock).not.toContain(".eq('podcasts.is_hungarian', true)");
    expect(fn).toContain("baseline_saved_without_submit");
    expect(fn).toContain("previous_url_baseline_reliable");
    expect(fn).toContain("if (shouldSubmitToGoogle)");
    expect(fn).toContain("new_url_count");
    expect(fn).toContain("new_urls_sample");
    expect(fn).toContain("real_news_item_count");
    expect(fn).toContain("source_counts");
    expect(fn).toContain("google_submit_policy");
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
    expect(worker).not.toContain("BEGIN Cloudflare Managed");

    expect(lovableWorker).toContain('url.pathname === "/robots.txt"');
    expect(lovableWorker).toContain("worker-robots-policy");

    expect(robots).toContain("Sitemap: https://podiverzum.hu/sitemap.xml");
    expect(robots).toContain("Sitemap: https://podiverzum.hu/news-sitemap.xml");
    expect(robots).toContain("Content-Signal: search=yes,ai-input=yes,ai-train=no");
    expect(robots).not.toContain("BEGIN Cloudflare Managed");
    expect(robots).not.toContain("User-agent: GPTBot\nDisallow: /");
    expect(robots).not.toContain("User-agent: ClaudeBot\nDisallow: /");
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
    expect(verifier).toContain("redirect: \"manual\"");
    expect(verifier).toContain("worker-sitemap-proxy");
    expect(verifier).toContain("worker-robots-policy");
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
    for (const block of [podcastSitemapBlock, episodeSitemapBlock, entitySitemapBlock]) {
      expect(block).toContain('language_decision", "accept_hungarian"');
      expect(block).not.toContain('is_hungarian", true');
      expect(block).not.toContain('podcasts.is_hungarian", true');
    }

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

  it("demotes temporal topic-only people at the database policy layer", () => {
    const migration = read("supabase/migrations/20260604232000_temporal_person_public_guard.sql");
    const strictMigration = read("supabase/migrations/20260605004500_strict_dead_person_no_podcast_profile_guard.sql");
    const collisionMigration = read("supabase/migrations/20260605013000_dead_person_name_collision_fail_closed.sql");

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

  it("keeps publisher article matching wired into best text source", () => {
    const migration = read("supabase/migrations/20260603164000_article_pipeline_consolidated.sql");
    const pairer = read("supabase/functions/episode-article-pairer/index.ts");
    const bestSource = read("supabase/functions/episode-best-text-source-runner/index.ts");
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

    expect(pairer).toContain("scorePublisherArticleMatch");
    expect(pairer).toContain("episode_article_candidates");
    expect(pairer).toContain("source_diagnostics");
    expect(bestSource).toContain('source_type: "article"');
    expect(bestSource).toContain("article_min_confidence");
    expect(bestSource).toContain("confirmed_publisher_article_longer_or_rss_short");

    expect(verifier).toContain("source_count_at_least_6");
    expect(verifier).toContain("best_source_accepts_article");
    expect(verifier).toContain("best_source_article_policy");
  });

  it("keeps public AI text Hungarian-only at the edge and database layer", () => {
    const guard = read("supabase/functions/_shared/hu-language-guard.ts");
    const aiEnrich = read("supabase/functions/ai-enrich/index.ts");
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
    const peopleMigration = read("supabase/migrations/20260603170000_people_identity_safety_consolidated.sql");
    const peopleHubFilterMigration = read("supabase/migrations/20260604213000_people_hub_identity_safe_filters.sql");
    const prerender = read("supabase/functions/prerender/index.ts");

    expect(verifier).toContain("related_episode_quality_policy");
    expect(verifier).toContain("people_hub_identity_safety_policy");
    expect(verifier).toContain("snapshot.related_episode_quality?.compatibility_function_exists === true");
    expect(verifier).toContain("text_group_function_exists");
    expect(verifier).toContain("topic_bridge_function_exists");
    expect(verifier).toContain("content_bridge_function_exists");
    expect(verifier).toContain("policy_configured_v4");
    expect(verifier).toContain("policy_configured_v5");
    expect(verifier).toContain("different_specific_groups_require_bridge_recorded");
    expect(verifier).toContain("specific_to_general_bridge_required_recorded");
    expect(verifier).toContain("recommendation_is_compatible('public_affairs', 'religion', 0.99::double precision, true) = false");
    expect(verifier).toContain("recommendation_is_compatible('public_affairs', 'business', 0.96::double precision, false) = false");
    expect(verifier).toContain("recommendation_is_compatible('public_affairs', 'business', 0.41::double precision, true) = true");
    expect(verifier).toContain("recommendation_is_compatible('public_affairs', 'general', 0.97::double precision, false) = false");
    expect(verifier).toContain("recommendation_has_content_bridge");
    expect(verifier).toContain("public_affairs_title_with_isten_runtime_grouped");
    expect(verifier).toContain("Mészáros Lőrinc tündöklése");
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
