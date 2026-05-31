import { describe, expect, it } from "vitest";

const { episodeUserPrompt, podcastUserPrompt } = await import("../../supabase/functions/_shared/seo-prompt");

describe("SEO prompt language policy", () => {
  it("always asks for Hungarian podcast SEO output even when RSS language is wrong", () => {
    const prompt = podcastUserPrompt({
      title: "Teszt Podcast",
      description: "Magyar nyelvű beszélgetések közéletről.",
      language: "en",
      is_hungarian: true,
      language_decision: "accept_hungarian",
    });

    expect(prompt).toContain("Hungarian");
    expect(prompt).toContain("Hungarian only");
    expect(prompt).not.toContain("English (en)");
  });

  it("always asks for Hungarian episode ai_summary output", () => {
    const prompt = episodeUserPrompt({
      title: "Egy fontos epizód",
      description: "Ebben az adásban a gazdaságról beszélgetünk.",
      language: "en",
    }, "Teszt Podcast", "en");

    expect(prompt).toContain("ai_summary");
    expect(prompt).toContain("Hungarian only");
    expect(prompt).not.toContain("English (en)");
  });
});
