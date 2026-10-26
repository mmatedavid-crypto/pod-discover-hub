import { describe, expect, it } from "vitest";
import type { Source } from "../../supabase/functions/_shared/person-relevance-batch";
import {
  actualCostUsd, buildCustomId, buildRequestLine, DEFAULT_CONTROLS, decidePolicy, goldenMetrics, mergeControls,
  parseCustomId, parseOutputLine, requestCostUpperBoundUsd, submitBlockers, countsAsAttempt, isStaleClaim,
} from "../../supabase/functions/_shared/person-relevance-openai-batch";

const P = "11111111-1111-1111-1111-111111111111";
const E = "22222222-2222-2222-2222-222222222222";
const H = "0123456789abcdef0123456789abcdef";
const source = (): Source => ({
  person: { name: "Minta Anna", aliases: [] },
  episode: { id: E, title: "Beszélgetés Minta Annával", summary: "", clean_text:
    "Vendégünk Minta Anna, akivel a városi kertekről és a helyi közösségek kialakulásáról beszélgetünk. A műsorvezető Példa Béla." },
  podcast: { title: "Kitalált podcast", description: "" },
  mentions: [{ id: "secret-mention-id", mention_type: "guest", confidence: 0.9, evidence: "Vendégünk Minta Anna", validation_source: "internal_marker" }],
});
const accepted = { status: "accepted", score: 0.95, mention_type: "guest", identity_match: "same_person",
  reason: "Vendégként szerepel.", evidence_phrases: ["Vendégünk Minta Anna"] };
const line = (body: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ custom_id: "cid", response: { status_code: 200, body }, error: null, ...extra });
const okBody = (content: unknown[]) => ({ status: "completed", output: [{ type: "reasoning" }, { type: "message", content }],
  usage: { input_tokens: 2000, input_tokens_details: { cached_tokens: 1000 }, output_tokens: 200 } });
const authorized = () => mergeControls({ enabled: true, key_rotation_confirmed: true, daily_cap_usd: 2, total_cap_usd: 5,
  authorized_pilot: { max_requests: 1500, total_cap_usd: 5, daily_cap_usd: 2, authorized_by: "owner", authorized_at: "2026-10-21" } });
const ctx = { keyPresent: true, backgroundEnabled: true, priorityBlocker: null, openJobs: 0, requestedCount: 500, model: "gpt-6-luna", tier: "primary" as const };

describe("OpenAI batch adapter", () => {
  it("builds idempotent custom ids from person, episode, source hash, prompt version, tier and attempt", () => {
    const id = buildCustomId({ promptVersion: "person-openai-v1", tier: "primary", personId: P, episodeId: E, sourceHash: H, attempt: 1 });
    expect(parseCustomId(id)).toEqual({ promptVersion: "person-openai-v1", tier: "primary", personId: P, episodeId: E, sourceHash: H, attempt: 1 });
    expect(buildCustomId({ promptVersion: "person-openai-v1", tier: "primary", personId: P, episodeId: E, sourceHash: H, attempt: 2 })).not.toBe(id);
    expect(buildCustomId({ promptVersion: "person-openai-v1", tier: "escalation", personId: P, episodeId: E, sourceHash: H, attempt: 1 })).not.toBe(id);
    expect(parseCustomId("garbage")).toBeNull();
  });

  it("sends a strict, stateless Responses request with minimised public data", () => {
    const l = buildRequestLine("cid", source(), DEFAULT_CONTROLS, "gpt-6-luna");
    expect(l.url).toBe("/v1/responses");
    expect(l.body.model).toBe("gpt-6-luna");
    expect(l.body.store).toBe(false);
    expect(l.body.text.format.strict).toBe(true);
    expect(l.body.reasoning.effort).toBe("low");
    expect(l.body.input).not.toContain("secret-mention-id");
    expect(l.body.input).not.toContain("internal_marker");
    expect(l.body.input).toContain("Minta Anna");
  });

  it("bounds cost from list prices with the 50% batch discount and fails closed without pricing", () => {
    const l = buildRequestLine("cid", source(), DEFAULT_CONTROLS, "gpt-6-luna");
    const bound = requestCostUpperBoundUsd(l, DEFAULT_CONTROLS.pricing_usd_per_1m["gpt-6-luna"], 0.5);
    expect(bound).toBeGreaterThan(0);
    expect(bound).toBeLessThan(0.002);
    expect(requestCostUpperBoundUsd(l, undefined, 0.5)).toBe(Number.POSITIVE_INFINITY);
    // 1000 uncached × $0.10 + 1000 cached × $0.01 + 200 × $0.50 per 1M, halved.
    expect(actualCostUsd({ input_tokens: 2000, input_tokens_details: { cached_tokens: 1000 }, output_tokens: 200 },
      DEFAULT_CONTROLS.pricing_usd_per_1m["gpt-6-luna"], 0.5)).toBeCloseTo(0.000105, 9);
  });

  it("parses completed, refused, incomplete, failed and mismatched result lines", () => {
    expect(parseOutputLine(line(okBody([{ type: "output_text", text: JSON.stringify(accepted) }])))?.outcome).toBe("ok");
    expect(parseOutputLine(line(okBody([{ type: "refusal", refusal: "no" }])))?.outcome).toBe("refusal");
    expect(parseOutputLine(line({ status: "incomplete", incomplete_details: { reason: "max_output_tokens" } }))?.outcome).toBe("incomplete");
    expect(parseOutputLine(JSON.stringify({ custom_id: "cid", response: { status_code: 400, body: { error: { code: "invalid" } } } }))?.outcome).toBe("http_error");
    expect(parseOutputLine(JSON.stringify({ custom_id: "cid", response: null, error: { code: "batch_expired" } }))?.outcome).toBe("error");
    expect(parseOutputLine(line(okBody([{ type: "output_text", text: "{not json" }])))?.outcome).toBe("schema_mismatch");
    expect(parseOutputLine(line(okBody([{ type: "output_text", text: JSON.stringify({ ...accepted, extra: 1 }) }])))?.outcome).toBe("schema_mismatch");
    expect(parseOutputLine(line(okBody([{ type: "output_text", text: JSON.stringify({ ...accepted, score: 1.5 }) }])))?.outcome).toBe("schema_mismatch");
    expect(parseOutputLine("{}")).toBeNull();
  });

  it("accepts only same-person, >=0.85, source-quoted decisions", () => {
    const ok = decidePolicy(accepted, source(), { model: "gpt-6-luna", identityRisk: false, allowAiRejection: false, tier: "primary" });
    expect(ok.final_status).toBe("accepted");
    expect(decidePolicy({ ...accepted, score: 0.84 }, source(), { model: "m", identityRisk: false, allowAiRejection: false, tier: "primary" }).final_status).toBe("needs_review");
    expect(decidePolicy({ ...accepted, evidence_phrases: ["Nem szerepel ilyen idézet a forrásban"] }, source(), { model: "m", identityRisk: false, allowAiRejection: false, tier: "primary" }).final_status).toBe("needs_review");
  });

  it("never auto-accepts namesakes and never mass-rejects on AI alone", () => {
    const risky = decidePolicy(accepted, source(), { model: "m", identityRisk: true, allowAiRejection: false, tier: "primary" });
    expect(risky.final_status).toBe("needs_review");
    expect(risky.escalate).toBe(false);
    const reject = { ...accepted, status: "rejected", identity_match: "different_person_same_name" };
    const r = decidePolicy(reject, source(), { model: "m", identityRisk: false, allowAiRejection: false, tier: "primary" });
    expect(r.final_status).toBe("needs_review");
    expect(r.decision.ai_suggested_status).toBe("rejected");
  });

  it("flags uncertain primary decisions for selective escalation", () => {
    const uncertain = { ...accepted, status: "needs_review", identity_match: "uncertain", score: 0.6 };
    expect(decidePolicy(uncertain, source(), { model: "m", identityRisk: false, allowAiRejection: false, tier: "primary" }).escalate).toBe(true);
    expect(decidePolicy(uncertain, source(), { model: "m", identityRisk: false, allowAiRejection: false, tier: "escalation" }).escalate).toBe(false);
  });

  it("blocks submission by default and until a pilot budget is authorized", () => {
    const blockers = submitBlockers(DEFAULT_CONTROLS, ctx);
    expect(blockers).toEqual(expect.arrayContaining(["controls_disabled", "key_rotation_not_confirmed", "no_authorized_pilot_budget", "cost_caps_zero"]));
    expect(submitBlockers(authorized(), ctx)).toEqual([]);
    expect(submitBlockers(authorized(), { ...ctx, keyPresent: false })).toContain("openai_api_key_missing");
    expect(submitBlockers(authorized(), { ...ctx, requestedCount: 2001 })).toContain("request_count_out_of_bounds");
    expect(submitBlockers(authorized(), { ...ctx, openJobs: 1 })).toContain("open_job_limit");
    expect(submitBlockers(authorized(), { ...ctx, priorityBlocker: "higher_priority_work:seo_jobs_pending" })).toContain("higher_priority_work:seo_jobs_pending");
    expect(submitBlockers(authorized(), { ...ctx, model: "unknown-model" })).toContain("pricing_missing_for_model");
    expect(submitBlockers(authorized(), { ...ctx, tier: "escalation" })).toContain("escalation_disabled");
  });

  it("measures auto-accept precision against human goldens per model", () => {
    const goldens = [
      { person_id: "a", episode_id: "1", label_status: "accepted", label_mention_type: "guest" },
      { person_id: "b", episode_id: "1", label_status: "rejected" },
    ];
    const [m] = goldenMetrics(goldens, [
      { person_id: "a", episode_id: "1", model: "gpt-6-luna", final_status: "accepted", decision: { status: "accepted", mention_type: "guest" }, cost_usd: 0.0002 },
      { person_id: "b", episode_id: "1", model: "gpt-6-luna", final_status: "accepted", decision: { status: "accepted" }, cost_usd: 0.0002 },
    ]);
    expect(m.accept_precision).toBe(0.5);
    expect(m.false_accept).toBe(1);
    expect(m.role_agree).toBe(1);
  });
  it("does not spend a retry on requests that never reached the model", () => {
    expect(countsAsAttempt("released")).toBe(false);
    for (const s of ["applied", "failed", "invalid", "refused", "expired", "skipped_stale"]) expect(countsAsAttempt(s)).toBe(true);
  });
  it("aborts only claims older than 30 minutes", () => {
    const now = Date.parse("2026-10-26T21:00:00Z");
    expect(isStaleClaim({ status: "claimed", created_at: "2026-10-26T20:29:00Z" }, now)).toBe(true);
    expect(isStaleClaim({ status: "claimed", created_at: "2026-10-26T20:45:00Z" }, now)).toBe(false);
    expect(isStaleClaim({ status: "submitted", created_at: "2026-10-25T00:00:00Z" }, now)).toBe(false);
  });
});
