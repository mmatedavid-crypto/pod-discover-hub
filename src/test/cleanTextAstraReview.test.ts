import { describe, expect, it } from "vitest";
import { astraReviewCostUsd, normalizeAstraItem, reviewConcerns } from "../../supabase/functions/_shared/clean-text-astra-review";

describe("clean-text Astra review (advisory)", () => {
  it("never recommends a proposal that does not exist", () => {
    const d = normalizeAstraItem({ recommendation: "use_proposed", confidence: 0.95, missing_facts: [], reason: "x" }, false, "e1");
    expect(d?.recommendation).toBe("owner_decides");
  });

  it("rejects unknown recommendations instead of guessing", () => {
    expect(normalizeAstraItem({ recommendation: "apply_now", confidence: 1 }, true, "e1")).toBeNull();
  });

  it("prices Astra at $10 input / $50 output per million tokens", () => {
    expect(astraReviewCostUsd(1_000_000, 0)).toBe(10);
    expect(astraReviewCostUsd(0, 1_000_000)).toBe(50);
  });

  it("drops fingerprints and zero-loss counters from the concerns Astra sees", () => {
    expect(reviewConcerns(["fp:abc", "prior_names_lost_0", "rss_names_missing_4", "auto_gate_lost_timecodes"]).sort())
      .toEqual(["lost_timecodes", "names_missing"]);
  });
});
