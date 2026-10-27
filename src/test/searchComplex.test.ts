import { describe, expect, it } from "vitest";
import {
  applyVerification, cleanConcepts, isNameOnlyQuery, looksComplex, meaningfulTokens, parseVerifyGrades, useComplexPath,
  type VerifyCandidate,
} from "../../supabase/functions/_shared/search-complex";
import { foldSearchName } from "../../supabase/functions/_shared/search-name-match";
import { isTemporalToken } from "../../supabase/functions/_shared/search-temporal";

const STOP = new Set(["a", "az", "es", "hogy", "ha", "nem", "mit", "mi", "egy", "rol", "beszeltek"]);
const shape = (qNorm: string, isQuestion = false) => ({ qNorm, isQuestion, isStopword: (t: string) => STOP.has(t), isTemporal: isTemporalToken });
const decide = (over: Partial<Parameters<typeof useComplexPath>[0]>) => useComplexPath({
  shapeComplex: true, isBot: false, isTicker: false, isPersonNameQuery: false, hardPodcastPin: false, nameOnly: false, enabled: true, ...over,
});

describe("complex search path: simple searches stay simple", () => {
  it("a single name like 'Friderikusz' is not complex", () => {
    expect(looksComplex(shape("friderikusz"))).toBe(false);
  });

  it("a two-word name is not complex", () => {
    expect(looksComplex(shape("hadhazy akos"))).toBe(false);
  });

  it("a query made only of known names stays on the name path, even with four words", () => {
    const tokens = meaningfulTokens(shape("farago attila krizso szilvia"));
    const anchors = [{ kind: "person", name: "Faragó Attila" }, { kind: "person", name: "Krizsó Szilvia" }];
    expect(isNameOnlyQuery(tokens, anchors, foldSearchName)).toBe(true);
  });

  it("a recognised person-name search never takes the complex path", () => {
    expect(decide({ isPersonNameQuery: true })).toBe(false);
  });

  it("a recognised show title never takes the complex path", () => {
    expect(decide({ hardPodcastPin: true })).toBe(false);
  });

  it("the owner switch turns the complex path off", () => {
    expect(decide({ enabled: false })).toBe(false);
  });
});

describe("complex search path: sentence-like searches", () => {
  it("a question is complex", () => {
    expect(looksComplex(shape("miert csuklik a gyerekem", true))).toBe(true);
  });

  it("a four-subject-word request is complex", () => {
    expect(looksComplex(shape("ferfi klimax kezelese gyogynovenyekkel"))).toBe(true);
  });

  it("recency words do not count as subject words", () => {
    expect(meaningfulTokens(shape("magyar gazdasag mostanaban legutobb"))).toEqual(["magyar", "gazdasag"]);
  });

  it("AI concepts drop recency-only and overlong phrases", () => {
    const out = cleanConcepts(["mostanában", "gyerek alvás", "nagyon hosszú kifejezés öt szóból áll", "gyerek alvás"], foldSearchName, isTemporalToken);
    expect(out).toEqual(["gyerek alvás"]);
  });
});

describe("final AI check", () => {
  const cands: VerifyCandidate[] = ["a", "b", "c", "d", "e"].map((id) => ({ id, title: id, podcast: "p", published: null, text: "" }));

  it("relevant episodes come first, partial ones after, off-topic ones are dropped", () => {
    const grades = parseVerifyGrades({ grades: [{ i: 0, g: 1 }, { i: 1, g: 0 }, { i: 2, g: 2, w: "erről szól" }, { i: 3, g: 2 }, { i: 4, g: 0 }] }, cands)!;
    const out = applyVerification(cands, grades, cands.map((c) => c.id));
    expect(out.list.map((e) => e.id)).toEqual(["c", "d", "a"]);
    expect(out.dropped).toBe(2);
  });

  it("when nothing passes the check the list is empty (honest no-result)", () => {
    const grades = parseVerifyGrades({ grades: cands.map((_, i) => ({ i, g: 0 })) }, cands)!;
    expect(applyVerification(cands, grades, cands.map((c) => c.id)).list).toEqual([]);
  });

  it("episodes beyond the checked set are not used as padding", () => {
    const grades = parseVerifyGrades({ grades: [{ i: 0, g: 2 }, { i: 1, g: 2 }, { i: 2, g: 2 }, { i: 3, g: 2 }] }, cands)!;
    const out = applyVerification(cands, grades, ["a", "b", "c", "d"]);
    expect(out.list.map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("an answer grading fewer than 80% of the episodes is rejected (old ranking is used)", () => {
    expect(parseVerifyGrades({ grades: [{ i: 0, g: 2 }, { i: 1, g: 2 }, { i: 2, g: 2 }] }, cands)).toBeNull();
  });

  it("grades outside 0..2 are ignored", () => {
    expect(parseVerifyGrades({ grades: cands.map((_, i) => ({ i, g: 5 })) }, cands)).toBeNull();
  });
});

describe("complex search path: request openers", () => {
  it("'miről beszéltek a magyar gazdaságról mostanában' is complex", () => {
    expect(looksComplex(shape("mirol beszeltek a magyar gazdasagrol mostanaban"))).toBe(true);
  });
});
