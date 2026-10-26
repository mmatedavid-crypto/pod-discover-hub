import { describe, expect, it } from "vitest";
import { filterSafeRelatedEpisodes, isSafeRelatedEpisode, recommendationGroup } from "@/lib/recommendationGuards";

// Live case 2026-10-25: a physics episode (Mindenségit! #26, Csanád Máté) was recommended
// pseudoscience/esoteric shows and a grab-bag episode that merely tagged "kvantumfizika".
const physics = {
  title: "#26 - Csanád Máté: 50 éven belül sikerül az einsteini és a kvantumfizikát egységesíteni",
  podcastTitle: "Mindenségit!",
  category: "Science & Ideas",
  topics: ["kvantumfizika", "világegyetem tágulása", "nagy bumm"],
  people: [],
  companies: [],
};

describe("science recommendations", () => {
  it("never recommends esoteric content to a science episode, even with a shared topic", () => {
    const afterlife = {
      title: "A NAGY ÁTKELÉS: Mi történik PONTOSAN a halál után?",
      podcastTitle: "Különös Krónikák",
      category: "True Crime & Paranormal",
      topics: ["halál utáni élet", "kvantumfizika", "reinkarnáció"],
      similarity: 0.88,
    };
    expect(recommendationGroup(afterlife)).toBe("esoteric");
    expect(isSafeRelatedEpisode(physics, afterlife)).toBe(false);
  });

  it("never recommends paranormal-category episodes to a science episode by vector score", () => {
    expect(isSafeRelatedEpisode(physics, {
      title: "A NASA véletlenül felfedezett egy Tükörvilágot?",
      podcastTitle: "Különös Krónikák",
      category: "True Crime & Paranormal",
      topics: ["univerzum rejtélyei", "multiverzum"],
      similarity: 0.88,
    })).toBe(false);
  });

  it("does not let one shared tag bring a self-help episode into science recommendations", () => {
    expect(isSafeRelatedEpisode(physics, {
      title: "AIDEM 5. epizód: A véletlen Univerzum",
      podcastTitle: "Érzelemsuli Podcastok",
      category: "Self-Improvement",
      topics: ["véletlen univerzum", "kvantumfizika", "önfejlesztés"],
      similarity: 0.87,
    })).toBe(false);
  });

  it("a single science tag on a grab-bag episode does not make it science or a match", () => {
    const grabBag = {
      title: "#127 - Fészket rakni egy agár köré",
      podcastTitle: "csúnyarosszmajom",
      category: "Society & Culture",
      topics: ["ingatlanok tájolása", "ip-címek", "infrás hőmérők", "euróvásárlás", "lítium", "kvantumfizika"],
      similarity: 0,
    };
    expect(recommendationGroup(grabBag)).toBe("general");
    expect(isSafeRelatedEpisode(physics, grabBag)).toBe(false);
  });

  it("keeps real science episodes from other shows", () => {
    const astronomer = {
      title: "AZ ŰR CSODÁLATOS VILÁGÁRÓL - Sárneczky Krisztián, csillagász",
      podcastTitle: "Friderikusz Podcast",
      category: "News & Politics",
      topics: ["csillagászat", "világegyetem tágulása"],
      similarity: 0.87,
    };
    const astrophysics = {
      title: "A csillagkapu túloldalán",
      podcastTitle: "Az élet meg minden",
      category: "Society & Culture",
      topics: ["asztrofizika", "fekete lyukak", "ősrobbanás"],
      similarity: 0.88,
    };
    expect(recommendationGroup(astronomer)).toBe("science");
    expect(isSafeRelatedEpisode(physics, astronomer)).toBe(true);
    expect(isSafeRelatedEpisode(physics, astrophysics)).toBe(true);
  });

  it("reaches general episodes without a bridge only when they are very close (>= 0.87)", () => {
    const general = { title: "Kozmikus lottóötös az ember?", podcastTitle: "Ma is tanultam valamit", category: "Education & Explainer", topics: [] };
    expect(isSafeRelatedEpisode(physics, { ...general, similarity: 0.873 })).toBe(true);
    expect(isSafeRelatedEpisode(physics, { ...general, similarity: 0.866 })).toBe(false);
  });
});

describe("word-bounded editorial groups", () => {
  it("does not read 'Explainer' as the political term 'NER'", () => {
    expect(recommendationGroup({ title: "A húrelmélet perspektívái", podcastTitle: "Szkeptikus Hangtár", category: "Education & Explainer", topics: [] }))
      .not.toBe("public_affairs");
  });

  it("does not read 'hitel' (loan) as religious 'hit' (faith)", () => {
    expect(recommendationGroup({ title: "Mire figyelj hitel felvételekor?", podcastTitle: "Pénzügyi tanácsok", category: "Finance", topics: [] }))
      .toBe("business");
  });
});

describe("cross-group topic bridges", () => {
  it("needs two shared topics (or a verified entity) to cross editorial worlds", () => {
    const source = { title: "Hogyan kezdjünk tőzsdézni?", podcastTitle: "Pénz Beszél", category: "Business & Finance", topics: ["kockázatok", "részvények"] };
    const oneTopic = { title: "Onkológiai szűrés", podcastTitle: "Egészség rádió", category: "Health, Fitness & Longevity", topics: ["kockázatok"], similarity: 0.8 };
    const twoTopics = { ...oneTopic, topics: ["kockázatok", "részvények"] };
    expect(isSafeRelatedEpisode(source, oneTopic)).toBe(false);
    expect(isSafeRelatedEpisode(source, twoTopics)).toBe(true);
    expect(filterSafeRelatedEpisodes(source, [oneTopic, twoTopics], 5)).toHaveLength(1);
  });
});
