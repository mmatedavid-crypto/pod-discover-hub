import { describe, expect, it } from "vitest";
import { topicCatchupPlan } from "../../supabase/functions/_shared/topic-catchup";

const ctrl = (catchup: Record<string, unknown> | null) => ({
  tier_filter: ["S", "A", "B", "C", "D", "E"],
  catchup,
});
const started = { started_at: "2026-10-26T22:00:00Z", total_cap_usd: 10, base_tiers: ["S", "A", "B", "C"] };

describe("one-time topic catch-up", () => {
  it("processes D/E backlog while under the $10 total cap", () => {
    const p = topicCatchupPlan(ctrl(started), 9.99);
    expect(p.backlogOpen).toBe(true);
    expect(p.backlogTiers).toEqual(["S", "A", "B", "C", "D", "E"]);
  });
  it("stops the wider backlog at $10 and keeps base tiers for older episodes", () => {
    const p = topicCatchupPlan(ctrl(started), 10);
    expect(p.backlogOpen).toBe(false);
    expect(p.markExhausted).toBe(true);
    expect(p.backlogTiers).toEqual(["S", "A", "B", "C"]);
  });
  it("keeps D/E for fresh episodes after the cap is used up", () => {
    const p = topicCatchupPlan(ctrl({ ...started, exhausted_at: "2026-10-27T00:00:00Z" }), 10.2);
    expect(p.freshTiers).toEqual(["S", "A", "B", "C", "D", "E"]);
    expect(p.markExhausted).toBe(false);
  });
  it("is inactive without a started catch-up", () => {
    expect(topicCatchupPlan(ctrl(null), 50).active).toBe(false);
  });
});
