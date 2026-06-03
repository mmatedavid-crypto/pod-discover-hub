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
    for (const group of [
      "clean_text_backfill_gates",
      "article_pipeline",
      "seo_news_sitemap",
      "public_ai_language_guard",
      "related_episode_quality",
      "people_hub_identity_safety",
    ]) {
      expect(reporter).toContain(group);
    }
    for (const artifact of [
      "20260603171000_clean_text_backfill_quality_gate_consolidated.sql",
      "20260603164000_article_pipeline_consolidated.sql",
      "20260603111500_news_sitemap_fast_refresh_cron.sql",
      "20260603221000_news_sitemap_gsc_connector_gateway.sql",
      "20260603162000_public_ai_language_guard_consolidated.sql",
      "20260603165000_related_episode_quality_consolidated.sql",
      "20260603170000_people_identity_safety_consolidated.sql",
      "episode-article-pairer",
      "refresh-sitemap",
      "ai-enrich",
      "prerender",
    ]) {
      expect(reporter).toContain(artifact);
    }
  });

  it("keeps publisher article pipeline verification tied to runtime output", () => {
    const verifier = read("scripts/verify-production-pipeline.mjs");

    expect(verifier).toContain("pairer_has_run");
    expect(verifier).toContain("pairer_scanned_articles");
    expect(verifier).toContain("pairer_no_domparser_error");
    expect(verifier).toContain("DOMParser is not defined");
    expect(verifier).toContain("article_candidates_started");
    expect(verifier).toContain("episode_article_pairer_progress");
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

    expect(fn).toContain("submitGoogleSearchConsoleSitemap");
    expect(fn).toContain("https://connector-gateway.lovable.dev/google_search_console/webmasters/v3/sites/");
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
  });

  it("keeps root sitemap XMLs served through the Cloudflare worker with fresh news cache", () => {
    const worker = read("infra/cloudflare-worker/worker.js");
    const robots = read("public/robots.txt");

    expect(worker).toContain("const SITEMAP_CACHE_TTL_SECONDS = 900");
    expect(worker).toContain("const NEWS_SITEMAP_CACHE_TTL_SECONDS = 300");
    expect(worker).toContain('url.pathname === "/news-sitemap.xml"');
    expect(worker).toContain("worker-sitemap-proxy");
    expect(worker).toContain("storage/v1/object/public/sitemaps");
    expect(worker).toContain("X-Served-By");

    expect(robots).toContain("Sitemap: https://podiverzum.hu/sitemap.xml");
    expect(robots).toContain("Sitemap: https://podiverzum.hu/news-sitemap.xml");
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
    const localGenerator = read("scripts/gen-sitemap.mjs");
    const pagesXml = read("public/sitemaps/pages.xml");

    for (const source of [generated, legacy, localGenerator, pagesXml]) {
      expect(source).toContain("/uj-podcastok");
      expect(source).toContain("/napi");
      expect(source).toContain("/heti");
      expect(source).not.toContain("podiverzum.hu/uj<");
      expect(source).not.toContain("podiverzum.hu/heti-valogatas");
    }
  });

  it("keeps search person pins identity-safe", () => {
    const searchPage = read("src/pages/SearchPage.tsx");
    const searchHybrid = read("supabase/functions/search-hybrid/index.ts");

    expect(searchPage).toContain("buildPersonCardContextLine");
    expect(searchPage).not.toContain("personPin.short_bio || personPin.disambiguation_label");
    expect(searchPage).not.toContain("<p className=\"text-sm text-muted-foreground line-clamp-2 mt-1.5\">{heroPerson.short_bio}</p>");
    expect(searchHybrid).toContain("identity_ambiguous,manual_approved,ai_bio_status,ai_bio_confidence,wikipedia_match_status,wikipedia_match_confidence");
    expect(searchHybrid).toContain("identity_ambiguous: person.identity_ambiguous");
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

    expect(verifier).toContain("episode_trigger_exists");
    expect(verifier).toContain("podcast_trigger_exists");
    expect(verifier).toContain("policy_configured_v3");
  });

  it("keeps production verifier covering recommendation and people identity policies", () => {
    const verifier = read("scripts/verify-production-pipeline.mjs");
    const peopleMigration = read("supabase/migrations/20260603170000_people_identity_safety_consolidated.sql");
    const prerender = read("supabase/functions/prerender/index.ts");

    expect(verifier).toContain("related_episode_quality_policy");
    expect(verifier).toContain("people_hub_identity_safety_policy");
    expect(verifier).toContain("snapshot.related_episode_quality?.compatibility_function_exists === true");
    expect(verifier).toContain("text_group_function_exists");
    expect(verifier).toContain("topic_bridge_function_exists");
    expect(verifier).toContain("policy_configured_v3");
    expect(verifier).toContain("recommendation_is_compatible('public_affairs', 'religion', 0.99::double precision, true) = false");
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

    expect(prerender).toContain("safePersonBioForPrerender");
    expect(prerender).toContain("isSafeGeneratedPersonBio");
    expect(prerender).toContain("wikipedia_match_confidence");
    expect(prerender).not.toContain("const bio = stripHtml(person.ai_bio ||");
  });
});
