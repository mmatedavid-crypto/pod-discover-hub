import { describe, expect, it } from "vitest";

const { homeAudienceLanes } = await import("../components/home/HomeAudienceLanes");
const { polishMoodTitle } = await import("../components/MoodCollections");

describe("homepage Hungarian copy", () => {
  it("does not expose broken one-word discovery lane labels", () => {
    const bad = new Set(["test", "fej", "élet"]);
    for (const lane of homeAudienceLanes) {
      expect(bad.has(lane.title.toLowerCase())).toBe(false);
      expect(lane.title.length).toBeGreaterThan(6);
    }
  });

  it("polishes broken mood titles from data before rendering", () => {
    expect(polishMoodTitle("Test", "edzeshez")).toBe("Mozgás és egészség");
    expect(polishMoodTitle("Fej", "tanulashoz")).toBe("Gondolatok és tudás");
    expect(polishMoodTitle("Élet", "elmelyuleshez")).toBe("Lélek és élethelyzetek");
  });
});
