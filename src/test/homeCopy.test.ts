import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const { polishMoodTitle } = await import("../components/MoodCollections");
const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("homepage Hungarian copy", () => {
  it("keeps the homepage focused on listening situations instead of duplicate direction pickers", () => {
    const index = read("src/pages/Index.tsx");
    const moods = read("src/components/MoodCollections.tsx");

    expect(index).toContain("<MoodCollections />");
    expect(index).not.toContain("HomeAudienceLanes");
    expect(index).not.toContain("Merre indulnál?");
    expect(moods).toContain("Hallgatási helyzetek");
    expect(moods).not.toContain("Mihez van most kedved?");
    expect(moods).toContain("Összes helyzet");
    expect(moods).not.toContain("Összes hangulat");
  });

  it("polishes broken mood titles from data before rendering", () => {
    expect(polishMoodTitle("Test", "edzeshez")).toBe("Mozgás és egészség");
    expect(polishMoodTitle("Fej", "tanulashoz")).toBe("Gondolatok és tudás");
    expect(polishMoodTitle("Élet", "elmelyuleshez")).toBe("Lélek és élethelyzetek");
  });

  it("keeps public consumer copy using Hungarian MI wording instead of raw AI labels", () => {
    const archetypes = read("src/lib/tasteArchetypes.ts");
    const listenerProfiles = read("src/lib/listenerProfiles.ts");
    const topicsHub = read("src/pages/TopicsHubPage.tsx");
    const topicDetail = read("src/pages/TopicDetailPage.tsx");
    const companiesHub = read("src/pages/CompaniesHubPage.tsx");
    const startSwipe = read("src/pages/StartSwipePage.tsx");

    expect(archetypes).toContain("MI, technológia, jövőkép");
    expect(listenerProfiles).toContain("MI, technológia, jövőkép");
    expect(topicsHub).toContain('tech: "Technológia és MI"');
    expect(topicDetail).toContain("MI-elemzés");
    expect(companiesHub).toContain("Még rendszerezzük az epizódokban említett cégeket");
    expect(startSwipe).toContain('ai: "MI"');

    for (const source of [archetypes, listenerProfiles, topicsHub, topicDetail, companiesHub]) {
      expect(source).not.toContain("Tech és AI");
      expect(source).not.toContain("AI, technológia");
      expect(source).not.toContain("AI-elemzés");
      expect(source).not.toContain("a említett");
    }
  });

  it("keeps homepage category and mood card labels in safe Hungarian", () => {
    const index = read("src/pages/Index.tsx");
    const moods = read("src/components/MoodCollections.tsx");

    expect(index).toContain("categoryLabel(category)");
    expect(index).toContain("Válogatott epizódok");
    expect(index).toContain("Friss, odaillő epizódok ebben a témakörben.");
    expect(index).toContain('"News & Politics"');
    expect(index).toContain('"Business & Finance"');
    expect(index).toContain('"Health, Fitness & Longevity"');
    expect(index).not.toContain('title: fallback');

    expect(moods).toContain("const reasonLabel = sanitizeHungarianPublicText(c.reason_label)");
    expect(moods).not.toContain("{c.reason_label}");
  });
});
