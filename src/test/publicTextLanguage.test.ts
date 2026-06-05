import { describe, expect, it } from "vitest";
import { isHungarianishPublicText, sanitizeHungarianPublicText } from "@/lib/publicTextLanguage";
import { pickEpisodeDescription } from "@/lib/episodeText";

describe("public Hungarian text fallback", () => {
  it("hides English-dominant public AI summaries before rendering", () => {
    const english = "This episode discusses The Matrix and explores what listeners should watch next.";

    expect(isHungarianishPublicText(english)).toBe(false);
    expect(sanitizeHungarianPublicText(english)).toBe("");
  });

  it("hides polished English podcast summaries with sparse stopwords", () => {
    const english = "The conversation explores market psychology, portfolio risk and key takeaways for long-term investors.";

    expect(isHungarianishPublicText(english)).toBe(false);
    expect(sanitizeHungarianPublicText(english)).toBe("");
  });

  it("hides English SEO-style snippets even when they mention Hungarian names", () => {
    const english = "In this episode, Balásy Zsolt discusses investor behavior and the latest market developments.";

    expect(isHungarianishPublicText(english)).toBe(false);
    expect(sanitizeHungarianPublicText(english)).toBe("");
  });

  it("keeps natural Hungarian summaries with English proper titles", () => {
    const hungarian = "Az epizód a The Boys harmadik évadát beszéli ki magyar nézőpontból.";

    expect(isHungarianishPublicText(hungarian)).toBe(true);
    expect(sanitizeHungarianPublicText(hungarian)).toBe(hungarian);
  });

  it("falls through to Hungarian RSS text when ai_summary is English", () => {
    const text = pickEpisodeDescription({
      ai_summary: "This episode features the latest market trends and what investors should watch next.",
      summary: "Az epizód a legfontosabb piaci folyamatokat és befektetői szempontokat foglalja össze.",
      description: "Tartalék leírás.",
    });

    expect(text).toBe("Az epizód a legfontosabb piaci folyamatokat és befektetői szempontokat foglalja össze.");
  });
});
