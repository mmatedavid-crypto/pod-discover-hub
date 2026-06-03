import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("production policy static guards", () => {
  it("keeps news sitemap submission hash-gated through Google Search Console", () => {
    const fn = read("supabase/functions/refresh-sitemap/index.ts");
    const migration = read("supabase/migrations/20260603111500_news_sitemap_fast_refresh_cron.sql");

    expect(fn).toContain("submitGoogleSearchConsoleSitemap");
    expect(fn).toContain("https://www.googleapis.com/webmasters/v3/sites/");
    expect(fn).toContain("const changed = newsHash !== previousHash");
    expect(fn).toContain("const realNewsItemCount = newsItems.length");
    expect(fn).toContain("const shouldSubmitToGoogle = changed && realNewsItemCount > 0");
    expect(fn).toContain("if (shouldSubmitToGoogle)");
    expect(fn).toContain("real_news_item_count");
    expect(fn).toContain("source_counts");
    expect(fn).toContain("google_submit_status");
    expect(fn).not.toContain("www.google.com/ping");
    expect(fn).not.toContain("google_ping_status");

    expect(migration).toContain("podiverzum-refresh-sitemap-lite-15min");
    expect(migration).toContain("*/15 * * * *");
    expect(migration).toContain("submit_only_when_news_sitemap_hash_changes");
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
    expect(migration).toContain("public_ai_language_guard_policy");
    expect(migration).toContain("'version', 3");
    expect(migration).toContain("trg_enforce_hu_episode_public_ai_text");
    expect(migration).toContain("trg_enforce_hu_podcast_public_ai_text");

    expect(verifier).toContain("episode_trigger_exists");
    expect(verifier).toContain("podcast_trigger_exists");
    expect(verifier).toContain("policy_configured_v3");
  });

  it("keeps production verifier covering recommendation and people identity policies", () => {
    const verifier = read("scripts/verify-production-pipeline.mjs");

    expect(verifier).toContain("related_episode_quality_policy");
    expect(verifier).toContain("people_hub_identity_safety_policy");
    expect(verifier).toContain("snapshot.related_episode_quality?.compatibility_function_exists === true");
    expect(verifier).toContain("recommendation_is_compatible('public_affairs', 'religion', 0.99::double precision, true) = false");
    expect(verifier).toContain("list_people_hub_has_identity_fields");
    expect(verifier).toContain("list_people_alpha_has_identity_fields");
    expect(verifier).toContain("failures.push(`related_episode_quality.${key}`)");
    expect(verifier).toContain("failures.push(`people_hub_identity_safety.${key}`)");
  });
});
