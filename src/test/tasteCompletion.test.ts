import { describe, expect, it } from "vitest";
import {
  isCompletedTasteProgress,
  shouldCompleteTasteProfile,
  tasteProgressCopy,
} from "@/lib/tasteCompletion";

describe("Te Podiverzumod completion", () => {
  it("does not finish early from too little evidence", () => {
    expect(shouldCompleteTasteProfile(8, 5, 0.9)).toBe(false);
    expect(shouldCompleteTasteProfile(10, 5, 0.9)).toBe(false);
    expect(shouldCompleteTasteProfile(10, 6, 0.71)).toBe(false);
  });

  it("finishes when the profile has enough positive evidence and confidence", () => {
    expect(shouldCompleteTasteProfile(10, 6, 0.72)).toBe(true);
    expect(shouldCompleteTasteProfile(22, 5, 0.6)).toBe(true);
    expect(shouldCompleteTasteProfile(30, 3, 0.2)).toBe(true);
  });

  it("recognizes old completed sessions without weakening the live stop rule", () => {
    expect(isCompletedTasteProgress({
      completedAt: null,
      seenCardIds: Array.from({ length: 10 }, (_, i) => `seen-${i}`),
      likedCardIds: [],
    })).toBe(true);
    expect(isCompletedTasteProgress({
      completedAt: null,
      seenCardIds: Array.from({ length: 8 }, (_, i) => `seen-${i}`),
      likedCardIds: Array.from({ length: 6 }, (_, i) => `liked-${i}`),
    })).toBe(true);
  });

  it("tells the user we need more signal before showing recommendations", () => {
    expect(tasteProgressCopy(8, 5, 0.9)).toContain("finomító");
    expect(tasteProgressCopy(10, 6, 0.72)).toContain("jönnek az ajánlások");
  });
});
