import { describe, it, expect } from "vitest";
import { formatDurationHu, toIsoDuration } from "@/lib/duration";
import { entityDisplayLabel } from "@/lib/entity";
import { getEpisodeUnderstanding } from "@/lib/episodeUnderstanding";
import { relativeTime } from "@/lib/freshness";

describe("episode duration display", () => {
  it("shows plausible durations", () => {
    expect(formatDurationHu(5622)).toBe("1 ó 33 p");
    expect(toIsoDuration(5622)).toBe("PT1H33M42S");
  });

  it("hides feed values that are too short to be trustworthy", () => {
    expect(formatDurationHu(93)).toBeNull();
    expect(formatDurationHu(1)).toBeNull();
    expect(toIsoDuration(93)).toBeNull();
    expect(formatDurationHu(null)).toBeNull();
  });
});

describe("entity labels", () => {
  it("never renders [object Object]", () => {
    expect(entityDisplayLabel({ name: "Friderikusz Sándor" })).toBe("Friderikusz Sándor");
    expect(entityDisplayLabel({ label: "Tisza Párt" })).toBe("Tisza Párt");
    expect(entityDisplayLabel({ foo: 1 })).toBeNull();
    expect(entityDisplayLabel("  Orbán   Viktor ")).toBe("Orbán Viktor");
    expect(entityDisplayLabel("")).toBeNull();
  });
});

describe("episode understanding headline", () => {
  it("normalises object-shaped people instead of stringifying them", () => {
    const u = getEpisodeUnderstanding({
      people: [{ name: "Friderikusz Sándor" } as unknown as string],
      companies: [{ name: "Tisza Párt" } as unknown as string],
      ai_summary: "x".repeat(120),
    });
    expect(u?.headline).toBe("Friderikusz Sándor · Tisza Párt");
    expect(u?.headline).not.toContain("[object Object]");
  });

  it("returns null instead of an empty headline", () => {
    const u = getEpisodeUnderstanding({
      people: [{ foo: 1 } as unknown as string],
      companies: [{ foo: 2 } as unknown as string],
      ai_summary: "x".repeat(400),
      description: "y".repeat(400),
    });
    expect(u).toBeNull();
  });
});

describe("relative dates are Hungarian", () => {
  it("never emits English suffixes", () => {
    const fiveMonthsAgo = new Date(Date.now() - 150 * 24 * 3600 * 1000).toISOString();
    const out = relativeTime(fiveMonthsAgo);
    expect(out).not.toMatch(/ago|mo\b/);
    expect(out).toContain("hónappal");
  });
});
