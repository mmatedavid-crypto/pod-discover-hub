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
    expect(fn).toContain("if (newsHash !== previousHash && newsItems.length > 0)");
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
    const seoRunner = read("supabase/functions/seo-enrich-runner/index.ts");
    const migration = read("supabase/migrations/20260603131000_stricter_hu_public_ai_text_guard.sql");

    expect(guard).toContain("nonHungarianPublicFields");
    expect(guard).toContain("assertHungarianPublicFields");
    expect(guard).toContain("enRatio > 0.12");
    expect(seoRunner).toContain("assertHungarianPublicFields({ seo_title, seo_description, ai_summary })");

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.is_hungarianish_public_ai_text");
    expect(migration).toContain("en_ratio > 0.12");
    expect(migration).toContain("public_ai_language_guard_policy");
    expect(migration).toContain("'version', 2");
    expect(migration).toContain("non_hu_public_text_repair");
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
