import { describe, expect, it } from "vitest";
import { detectTemporalIntent, isTemporalToken, preferWithinWindow } from "../../supabase/functions/_shared/search-temporal";

const NOW = Date.parse("2026-10-27T14:00:00Z");

describe("search recency intent", () => {
  it("'mostanában' asks for the last 90 days", () => {
    const t = detectTemporalIntent("miről beszéltek a magyar gazdaságról mostanában", NOW);
    expect(t?.windowDays).toBe(90);
    expect(t?.sinceIso).toBe("2026-07-29T14:00:00.000Z");
    expect(t?.coreTokens).not.toContain("mostanaban");
    expect(t?.coreTokens).toContain("gazdasagrol");
  });
  it("'a héten' asks for the last 14 days", () => {
    expect(detectTemporalIntent("mi volt a héten a parlamentben", NOW)?.windowDays).toBe(14);
  });
  it("'idén' asks for everything since January 1", () => {
    expect(detectTemporalIntent("idén milyen könyvekről beszéltek", NOW)?.windowDays).toBe(300);
  });
  it("the shortest window wins when several words match", () => {
    expect(detectTemporalIntent("legfrissebb hírek a héten", NOW)?.windowDays).toBe(14);
  });
  it("plain topic searches have no recency window", () => {
    expect(detectTemporalIntent("magyar gazdaság", NOW)).toBeNull();
    expect(detectTemporalIntent("Heti Hetes", NOW)).toBeNull();
  });
  it("quoted exact-phrase searches are never reinterpreted", () => {
    expect(detectTemporalIntent('"friss hírek"', NOW)).toBeNull();
  });
  it("recency words are not treated as topic words", () => {
    expect(isTemporalToken("mostanában")).toBe(true);
    expect(isTemporalToken("gazdaság")).toBe(false);
  });
  it("puts episodes inside the window first and keeps the rest in order", () => {
    const items = [
      { id: "old1", published_at: "2022-01-10T00:00:00Z" },
      { id: "new1", published_at: "2026-10-20T00:00:00Z" },
      { id: "none", published_at: null },
      { id: "new2", published_at: "2026-09-01T00:00:00Z" },
      { id: "old2", published_at: "2025-03-01T00:00:00Z" },
    ];
    expect(preferWithinWindow(items, "2026-07-29T14:00:00.000Z").map((x) => x.id)).toEqual(["new1", "new2", "old1", "none", "old2"]);
  });
});
