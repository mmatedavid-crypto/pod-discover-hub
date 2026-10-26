import { describe, expect, it } from "vitest";
import { buildEpisodeEmbeddingContent, embeddingSkipReason, nextAttemptDelayMs } from "../../supabase/functions/_shared/episode-embedding-content";

const ep = {
  title: "Fizika a hétköznapokban", podcast_title: "Mindenségit!", podcast_category: "tudomany",
  seo_description: "Beszélgetés a részecskefizikáról és a CERN kísérleteiről.",
  clean_text: "Ebben az epizódban a részecskegyorsítókról, a Higgs-bozonról és a magyar kutatók szerepéről beszélgetünk.",
  topics: ["részecskefizika", "CERN"],
};

describe("episode search vectors", () => {
  it("keeps the format of the vectors written before May 2026", () => {
    const c = buildEpisodeEmbeddingContent(ep);
    expect(c.split("\n").slice(0, 4)).toEqual(["MODEL: google/gemini-embedding-001", "PODCAST: Mindenségit!", "CATEGORY: tudomany", "EPISODE: Fizika a hétköznapokban"]);
    expect(c).toContain("DESCRIPTION: Ebben az epizódban");
    expect(c).toContain("TOPICS: részecskefizika, CERN");
  });
  it("uses at most 1600 characters of clean text", () => {
    const c = buildEpisodeEmbeddingContent({ ...ep, clean_text: "a".repeat(5000) });
    expect(c.match(/DESCRIPTION: (a+)/)?.[1].length).toBe(1600);
  });
  it("skips episodes with only links or very little text", () => {
    expect(embeddingSkipReason({ title: "x", clean_text: "https://example.org/a https://example.org/b" })).toBe("embedding_input_empty");
    expect(embeddingSkipReason({ title: "x", clean_text: "Rövid szöveg." })).toBe("embedding_input_too_short");
    expect(embeddingSkipReason(ep)).toBeNull();
  });
  it("backs off so a failing episode never blocks the queue", () => {
    expect(nextAttemptDelayMs("embedding_input_too_short", 1)).toBe(30 * 864e5);
    expect(nextAttemptDelayMs("embed_failed", 1)).toBe(3600e3);
    expect(nextAttemptDelayMs("embed_failed", 5)).toBe(7 * 864e5);
  });
});
