import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SMART_PLAYER_RECOMMENDATIONS_ENABLED } from "@/components/smart-player/recommendationsConfig";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("smart player recommendation policy", () => {
  it("keeps cross-podcast smart recommendations disabled until quality is trusted", () => {
    expect(SMART_PLAYER_RECOMMENDATIONS_ENABLED).toBe(false);

    const provider = read("src/components/smart-player/SmartPlayerProvider.tsx");
    const bar = read("src/components/smart-player/SmartPlayerBar.tsx");

    expect(provider).toContain("if (!SMART_PLAYER_RECOMMENDATIONS_ENABLED) return \"series\"");
    expect(provider).toContain("if (!SMART_PLAYER_RECOMMENDATIONS_ENABLED) return;");
    expect(bar).toContain("!error && SMART_PLAYER_RECOMMENDATIONS_ENABLED");
  });

  it("keeps the DB compatibility policy hard-blocking religion/non-religion false positives", () => {
    const migration = read("supabase/migrations/20260603165000_related_episode_quality_consolidated.sql");

    expect(migration).toContain("recommendation_is_compatible");
    expect(migration).toContain("recommendation_text_group");
    expect(migration).toContain("p_source_group = 'religion'");
    expect(migration).toContain("p_candidate_group = 'religion'");
    expect(migration).toContain("THEN false");
    expect(migration).toContain("'related_episode_quality_policy'");
    expect(migration).toContain("'religion_cross_group', 'hard_block'");
    expect(migration).toContain("'version', 3");
    expect(migration).toContain("public_affairs_override_terms");
    expect(migration).toContain("orbán");
    expect(migration).toContain("puzsér");
  });
});
