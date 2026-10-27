import { describe, expect, it } from "vitest";
import { queryContentTerms, rankByTermCoverage } from "../../supabase/functions/_shared/search-term-coverage";

const ep = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, title, podcasts: { title: "Show" }, ...extra });
const ids = (l: Array<{ id: string }>) => l.map((e) => e.id);

describe("search term coverage", () => {
  it("drops stopwords, question words and recency words from the query terms", () => {
    expect(queryContentTerms("hogyan beszéljek a gyerekkel a válásról mostanában")).toEqual(["beszeljek", "gyerekkel", "valasrol"]);
  });
  it("multi-word query: a result covering every word moves above one covering only one", () => {
    const r = rankByTermCoverage([ep("mol", "Mol részvény"), ep("both", "Mol benzinárak emelkednek")], "Mol benzinár");
    expect(ids(r.list)).toEqual(["both", "mol"]);
    expect(r.applied).toBe("multi");
  });
  it("multi-word query: nothing changes when no result covers every word", () => {
    const list = [ep("a", "Mol hírek"), ep("b", "Benzinár")];
    expect(ids(rankByTermCoverage(list, "Mol benzinár").list)).toEqual(["a", "b"]);
  });
  it("single-word query: title/tag hits go above description-only mentions, only with 3+ strong hits", () => {
    const list = [ep("body", "Valami", { description: "szó esik a bitcoinról" }), ep("t1", "Bitcoin ma"), ep("t2", "x", { topics: ["bitcoin"] }), ep("t3", "Bitcoinissimo")];
    expect(ids(rankByTermCoverage(list, "Bitcoin").list)).toEqual(["t1", "t2", "t3", "body"]);
    expect(ids(rankByTermCoverage(list.slice(0, 3), "Bitcoin").list)).toEqual(["body", "t1", "t2"]);
  });
  it("never drops results and leaves results beyond the window untouched", () => {
    const list = [ep("a", "Mol"), ep("b", "Mol benzinár"), ep("c", "x")];
    const r = rankByTermCoverage(list, "Mol benzinár", { window: 2 });
    expect(ids(r.list)).toEqual(["b", "a", "c"]);
  });
});
