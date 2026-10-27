import { describe, expect, it } from "vitest";
import {
  aggregateMetrics, itemMetrics, judgeAgreement, parseJudgment, SEARCH_FAILURE_REASONS, splitFor,
} from "../../supabase/functions/_shared/search-quality-eval";

describe("search quality evaluation rules", () => {
  it("counts only score-2 results as good and treats missing slots as misses", () => {
    const m = itemMetrics([2, 0, 1]);
    expect(m.p_at_1).toBe(1);
    expect(m.p_at_3).toBeCloseTo(1 / 3);
    expect(m.p_at_10).toBeCloseTo(0.1);
    expect(m.top3_has_off_topic).toBe(true);
    expect(itemMetrics([2]).p_at_3).toBeCloseTo(1 / 3);
  });

  it("an empty result list scores zero and is flagged empty", () => {
    const m = itemMetrics([]);
    expect(m.empty).toBe(true);
    expect(m.ndcg_at_10).toBe(0);
    expect(aggregateMetrics([m, itemMetrics([2, 2, 2])]).empty_rate).toBe(0.5);
  });

  it("a list of only partially related results cannot reach full nDCG", () => {
    expect(itemMetrics([1, 1, 1]).ndcg_at_10).toBeLessThan(0.5);
    expect(itemMetrics([2, 2, 2]).ndcg_at_10).toBe(1);
  });

  it("holds out roughly 30% of queries, deterministically and accent-insensitively", () => {
    const qs = Array.from({ length: 2000 }, (_, i) => `kérdés ${i}`);
    const share = qs.filter((q) => splitFor(q) === "holdout").length / qs.length;
    expect(share).toBeGreaterThan(0.25);
    expect(share).toBeLessThan(0.35);
    expect(splitFor("Aszály")).toBe(splitFor("aszaly"));
  });

  it("rejects a judgment that skips or duplicates a result instead of filling gaps", () => {
    const r = SEARCH_FAILURE_REASONS;
    expect(parseJudgment({ query_type: "topic", grades: [{ idx: 0, score: 2 }] }, 2, r)).toBeNull();
    expect(parseJudgment({ query_type: "topic", grades: [{ idx: 0, score: 2 }, { idx: 0, score: 1 }] }, 2, r)).toBeNull();
    expect(parseJudgment({ query_type: "topic", grades: [{ idx: 0, score: 2 }, { idx: 0, score: 0 }, { idx: 1, score: 1 }, { idx: 7, score: 0 }] }, 2, r)?.grades.map((g) => g.score)).toEqual([2, 1]);
    expect(parseJudgment({ query_type: "topic", grades: [{ idx: 0, score: 3 }] }, 1, r)).toBeNull();
    const ok = parseJudgment(JSON.stringify({ query_type: "topic", grades: [{ idx: 1, score: 0, reason: "made_up" }, { idx: 0, score: 2, reason: "stale" }] }), 2, r);
    expect(ok?.grades).toEqual([{ idx: 0, score: 2, reason: null }, { idx: 1, score: 0, reason: "other" }]);
  });

  it("accepts a consistently 1-based reply and drops 'stale' when the query has no recency words", () => {
    const r = SEARCH_FAILURE_REASONS;
    const out = parseJudgment({ query_type: "topic", grades: [{ idx: 1, score: 1, reason: "stale" }, { idx: 2, score: 2 }] }, 2, r, false);
    expect(out?.grades).toEqual([{ idx: 0, score: 1, reason: "other" }, { idx: 1, score: 2, reason: null }]);
    expect(parseJudgment({ query_type: "temporal", grades: [{ idx: 0, score: 1, reason: "stale" }] }, 1, r, true)?.grades[0].reason).toBe("stale");
  });

  it("measures agreement between the two judges on the relevant/not-relevant line", () => {
    const a = judgeAgreement(
      [{ idx: 0, score: 2, reason: null }, { idx: 1, score: 1, reason: "other" }],
      [{ idx: 0, score: 2, reason: null }, { idx: 1, score: 0, reason: "other" }],
    );
    expect(a).toEqual({ total: 2, exact: 1, within1: 2, binary: 2 });
  });
});
