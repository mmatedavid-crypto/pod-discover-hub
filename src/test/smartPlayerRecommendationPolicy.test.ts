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
    const episodePlayer = read("src/components/smart-player/EpisodeAudioPlayer.tsx");
    const chapters = read("src/components/smart-player/SmartPlayerChapters.tsx");
    const locale = read("src/lib/playerLocale.ts");

    expect(provider).toContain("if (!SMART_PLAYER_RECOMMENDATIONS_ENABLED) return \"series\"");
    expect(provider).toContain("if (!SMART_PLAYER_RECOMMENDATIONS_ENABLED) return;");
    expect(bar).toContain("!error && SMART_PLAYER_RECOMMENDATIONS_ENABLED");
    expect(bar).toContain("SMART_PLAYER_RECOMMENDATIONS_ENABLED ? \"Kapcsolódó epizódok\" : \"Lejátszó részletei\"");
    expect(bar).toContain("SMART_PLAYER_RECOMMENDATIONS_ENABLED ? \"Kapcsolódó\" : \"Részletek\"");
    expect(bar).toContain("{SMART_PLAYER_RECOMMENDATIONS_ENABLED && (");
    expect(bar).toContain("SMART_PLAYER_RECOMMENDATIONS_ENABLED && (\n                  <div className=\"w-full max-w-3xl mt-2 border-t border-border pt-5\">");
    expect(episodePlayer).toContain("{SMART_PLAYER_RECOMMENDATIONS_ENABLED && (");
    expect(episodePlayer).toContain("Kapcsolódó epizódok");
    expect(episodePlayer).toContain("<SmartDiscoveryPanel episodeIdOverride={episode.id} variant=\"compact\" />");
    expect(bar).toContain("Podiverzum lejátszó");
    expect(chapters).toContain("Bevezető átugrása");
    expect(chapters).toContain("Ehhez az epizódhoz még nincsenek fejezetek.");
    expect(locale).toContain('playbackError: "Lejátszási gond"');
    expect(bar).not.toContain("Smart ajánlások");
    expect(episodePlayer).not.toContain("Smart Player ajánlások");
    expect(chapters).not.toContain("Skip intro");
    expect(chapters).not.toContain("AI fejezetek");
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
