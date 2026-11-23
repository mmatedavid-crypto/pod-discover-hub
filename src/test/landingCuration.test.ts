import { describe, expect, it } from "vitest";
import { hasStandaloneToken, nextPlayableIndex, MAX_CONSECUTIVE_SKIPS } from "@/lib/landingCuration";

describe("BYD standalone token", () => {
  it("matches BYD as its own word, including Hungarian suffixes after a hyphen", () => {
    expect(hasStandaloneToken("Bíróság döntött egy BYD-modell forgalmazásáról", "BYD")).toBe(true);
    expect(hasStandaloneToken("Szijjártó a BYD-nél", "BYD")).toBe(true);
    expect(hasStandaloneToken("mosoly / thai / byd", "BYD")).toBe(true);
  });
  it("does not match BYD inside a longer word", () => {
    expect(hasStandaloneToken("Bydgoszcz városa", "BYD")).toBe(false);
    expect(hasStandaloneToken("ABYD gyártó", "BYD")).toBe(false);
    expect(hasStandaloneToken("BYDx", "BYD")).toBe(false);
    expect(hasStandaloneToken(null, "BYD")).toBe(false);
  });
});

describe("Anantara queue advance", () => {
  it("moves to the next episode and skips failed ones", () => {
    expect(nextPlayableIndex(0, 11, new Set())).toBe(1);
    expect(nextPlayableIndex(0, 11, new Set([1, 2]))).toBe(3);
  });
  it("stops after the last episode", () => {
    expect(nextPlayableIndex(10, 11, new Set())).toBeNull();
    expect(nextPlayableIndex(8, 11, new Set([9, 10]))).toBeNull();
  });
  it("skips at most 3 failing episodes in a row", () => {
    expect(MAX_CONSECUTIVE_SKIPS).toBe(3);
  });
});
