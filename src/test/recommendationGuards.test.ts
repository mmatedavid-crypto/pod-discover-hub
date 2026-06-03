import { describe, expect, it } from "vitest";
import { isSafeRelatedEpisode } from "@/lib/recommendationGuards";

describe("recommendationGuards", () => {
  it("does not recommend worship content for public affairs episodes just because the title mentions Isten", () => {
    const source = {
      title: "Mészáros Lőrinc tündöklése és részvényeinek látványos zuhanása: Isten, Orbán, Andi és a balszerencse",
      podcastTitle: "Puzsér Róbert",
      category: "Society & Culture",
      topics: ["közélet", "politika", "gazdaság"],
      people: ["Mészáros Lőrinc", "Orbán Viktor", "Puzsér Róbert"],
      companies: [],
    };

    const candidate = {
      title: "Tanítsuk gyermekeinket Isten szavaira!",
      podcastTitle: "Baptista Áhítat",
      category: "Religion & Spirituality",
      topics: ["Isten", "istentisztelet", "igehirdetés"],
      people: [],
      companies: [],
      similarity: 0.91,
    };

    expect(isSafeRelatedEpisode(source, candidate)).toBe(false);
  });

  it("treats political context as public affairs even when topics are missing", () => {
    const source = {
      title: "Mészáros Lőrinc tündöklése és részvényeinek látványos zuhanása: Isten, Orbán, Andi és a balszerencse",
      podcastTitle: "Puzsér Róbert",
      category: "Society & Culture",
      topics: [],
      people: [],
      companies: [],
    };

    const candidate = {
      title: "Isten nem mond nemet ránk",
      podcastTitle: "Zarándok.ma",
      category: "Religion & Spirituality",
      topics: ["vallás", "igehirdetés"],
      people: [],
      companies: [],
      similarity: 0.99,
    };

    expect(isSafeRelatedEpisode(source, candidate)).toBe(false);
  });

  it("still allows related public affairs episodes with strong overlap", () => {
    const source = {
      title: "Mészáros Lőrinc részvényeinek látványos zuhanása",
      podcastTitle: "Puzsér Róbert",
      category: "Society & Culture",
      topics: ["közélet", "gazdaság"],
      people: ["Mészáros Lőrinc"],
      companies: [],
    };

    const candidate = {
      title: "Mi történik Mészáros Lőrinc cégeivel?",
      podcastTitle: "Közéleti podcast",
      category: "News & Politics",
      topics: ["közélet", "gazdaság"],
      people: ["Mészáros Lőrinc"],
      companies: [],
      similarity: 0.62,
    };

    expect(isSafeRelatedEpisode(source, candidate)).toBe(true);
  });
});
