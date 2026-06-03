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
    expect(moods).toContain("Mihez van most kedved?");
  });

  it("polishes broken mood titles from data before rendering", () => {
    expect(polishMoodTitle("Test", "edzeshez")).toBe("Mozgás és egészség");
    expect(polishMoodTitle("Fej", "tanulashoz")).toBe("Gondolatok és tudás");
    expect(polishMoodTitle("Élet", "elmelyuleshez")).toBe("Lélek és élethelyzetek");
  });
});
