import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const migration = read("drizzle/migrations/0149_person_page_single_eligibility_rule.sql");
const page = read("src/pages/PersonDetailPage.tsx");
const prerender = read("supabase/functions/prerender/index.ts");
const sitemap = read("supabase/functions/refresh-sitemap/index.ts");

describe("person page: one episode rule for list, counts, crawler page and sitemap", () => {
  it("never lists rejected or needs_review links", () => {
    expect(migration).toMatch(/NOT IN \('rejected', 'needs_review'\)/);
  });

  it("drops unreviewed same-name rows once the person has a verified link", () => {
    expect(migration).toContain("WHERE a.strong AND (a.verified OR NOT a.person_anchored)");
  });

  it("visitor page and crawler page read the same RPC and show its totals", () => {
    expect(page).toContain('rpc("get_person_page_episodes_v1"');
    expect(prerender).toContain('rpc("get_person_page_episodes_v1"');
    expect(page).toContain('label="Indexelt epizódok" value={totals.episodes}');
    expect(page).toContain('label="Podcastok" value={totals.podcasts}');
    expect(prerender).toContain("const epCount = totalEpisodes;");
  });

  it("sitemap lists a person only when the page's own count is at least 1 (no legacy fallback)", () => {
    expect(sitemap).toContain("return Number(p.gated_episode_count || 0) >= 1;");
    expect(sitemap).not.toContain("gated_episode_count || p.episode_count");
  });

  it("a zero count does not unpublish a page", () => {
    const recompute = migration.slice(migration.indexOf("FUNCTION public.recompute_person_gated_counts"));
    expect(recompute).toContain("is_public = CASE WHEN j.ep_count >= 1 AND j.not_hard_blocked THEN true ELSE pp.is_public END");
    expect(recompute).not.toMatch(/is_public = CASE WHEN j\.ep_count = 0 THEN false/);
  });
});
