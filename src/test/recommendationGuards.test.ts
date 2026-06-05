import { describe, expect, it } from "vitest";
import { filterSafeRelatedEpisodes, isSafeRelatedEpisode } from "@/lib/recommendationGuards";

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

  it("blocks religion category candidates even when their title is bland", () => {
    const source = {
      title: "Pénz, politika és befolyás a magyar gazdaságban",
      podcastTitle: "Közéleti elemzés",
      category: "News & Politics",
      topics: ["közélet", "gazdaság"],
      people: ["Orbán Viktor"],
      companies: [],
    };

    const candidate = {
      title: "Heti beszélgetés",
      podcastTitle: "Vasárnapi műsor",
      category: "Religion & Spirituality",
      topics: [],
      people: [],
      companies: [],
      similarity: 0.99,
    };

    expect(isSafeRelatedEpisode(source, candidate)).toBe(false);
  });

  it("blocks kids category candidates for adult public affairs episodes", () => {
    const source = {
      title: "Mészáros Lőrinc és a magyar tőzsde",
      podcastTitle: "Puzsér Róbert",
      category: "Society & Culture",
      topics: ["közélet", "gazdaság"],
      people: ["Mészáros Lőrinc"],
      companies: [],
    };

    const candidate = {
      title: "Mai adás",
      podcastTitle: "Családi rádió",
      category: "Kids & Family",
      topics: [],
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

  it("ranks explainable entity/topic bridges above pure vector neighbours", () => {
    const source = {
      title: "Mészáros Lőrinc részvényeinek látványos zuhanása",
      podcastTitle: "Puzsér Róbert",
      category: "Society & Culture",
      topics: ["közélet", "gazdaság"],
      people: ["Mészáros Lőrinc", "Orbán Viktor"],
      companies: ["Opus"],
    };

    const rows = filterSafeRelatedEpisodes(source, [
      {
        title: "Általános gazdasági beszélgetés",
        podcastTitle: "Üzleti podcast",
        category: "Business",
        topics: ["gazdaság"],
        people: [],
        companies: [],
        similarity: 0.92,
      },
      {
        title: "Mi történik Mészáros Lőrinc cégeivel?",
        podcastTitle: "Közéleti podcast",
        category: "News & Politics",
        topics: ["közélet", "gazdaság"],
        people: ["Mészáros Lőrinc"],
        companies: ["Opus"],
        similarity: 0.61,
      },
    ], 2);

    expect(rows[0].title).toBe("Mi történik Mészáros Lőrinc cégeivel?");
  });

  it("does not bridge public affairs to business by vector score alone", () => {
    const source = {
      title: "Mészáros Lőrinc tündöklése és részvényeinek látványos zuhanása",
      podcastTitle: "Puzsér Róbert",
      category: "Society & Culture",
      topics: ["közélet", "politika"],
      people: ["Mészáros Lőrinc"],
      companies: [],
    };

    const candidate = {
      title: "Árfolyamok, részvények és befektetési ötletek",
      podcastTitle: "Üzleti podcast",
      category: "Business",
      topics: ["befektetés", "tőzsde"],
      people: [],
      companies: [],
      similarity: 0.96,
    };

    expect(isSafeRelatedEpisode(source, candidate)).toBe(false);
  });

  it("allows public affairs and business only with an explicit shared entity bridge", () => {
    const source = {
      title: "Mészáros Lőrinc részvényeinek látványos zuhanása",
      podcastTitle: "Puzsér Róbert",
      category: "Society & Culture",
      topics: ["közélet", "politika"],
      people: ["Mészáros Lőrinc"],
      companies: ["Opus"],
    };

    const candidate = {
      title: "Opus és a magyar tőzsde mozgása",
      podcastTitle: "Üzleti podcast",
      category: "Business",
      topics: ["tőzsde"],
      people: [],
      companies: ["Opus"],
      similarity: 0.41,
    };

    expect(isSafeRelatedEpisode(source, candidate)).toBe(true);
  });

  it("blocks sport and kids jumps without an explicit bridge even at very high similarity", () => {
    const source = {
      title: "Magyar Péter és a kormány gazdaságpolitikája",
      podcastTitle: "Közéleti műsor",
      category: "News & Politics",
      topics: ["közélet", "politika"],
      people: ["Magyar Péter"],
      companies: [],
    };

    expect(isSafeRelatedEpisode(source, {
      title: "Válogatott meccs előzetes",
      podcastTitle: "Foci podcast",
      category: "Sports",
      topics: ["futball"],
      people: [],
      companies: [],
      similarity: 0.98,
    })).toBe(false);

    expect(isSafeRelatedEpisode(source, {
      title: "Esti mese gyerekeknek",
      podcastTitle: "Meserádió",
      category: "Kids & Family",
      topics: ["mese"],
      people: [],
      companies: [],
      similarity: 0.98,
    })).toBe(false);
  });

  it("does not use a general candidate as filler for a specific episode without an explicit bridge", () => {
    const source = {
      title: "Mészáros Lőrinc és a magyar tőzsde",
      podcastTitle: "Közéleti műsor",
      category: "News & Politics",
      topics: ["közélet", "politika"],
      people: ["Mészáros Lőrinc"],
      companies: [],
    };

    const candidate = {
      title: "Heti beszélgetés érdekes történetekről",
      podcastTitle: "Beszélgetések",
      category: "Society & Culture",
      topics: [],
      people: [],
      companies: [],
      similarity: 0.97,
    };

    expect(isSafeRelatedEpisode(source, candidate)).toBe(false);
  });

  it("blocks vague general-to-general vector neighbours unless the similarity is exceptionally strong", () => {
    const source = {
      title: "Egy hosszú beszélgetés a hét fontos kérdéseiről",
      podcastTitle: "Beszélgetések",
      category: "Society & Culture",
      topics: [],
      people: [],
      companies: [],
    };

    const candidate = {
      title: "Mai adás: történetek és gondolatok",
      podcastTitle: "Másik beszélgetés",
      category: "Society & Culture",
      topics: [],
      people: [],
      companies: [],
      similarity: 0.79,
    };

    expect(isSafeRelatedEpisode(source, candidate)).toBe(false);
  });

  it("allows general episodes when there is an explicit shared person bridge", () => {
    const source = {
      title: "Életútinterjú",
      podcastTitle: "Beszélgetések",
      category: "Society & Culture",
      topics: [],
      people: ["Schmied Andi"],
      companies: [],
    };

    const candidate = {
      title: "Egy másik beszélgetés",
      podcastTitle: "Portré",
      category: "Society & Culture",
      topics: [],
      people: ["Schmied Andi"],
      companies: [],
      similarity: 0.35,
    };

    expect(isSafeRelatedEpisode(source, candidate)).toBe(true);
  });
});
