// One-time admin actions for the legacy ytdesc needs_review rows (policy
// legacy_ytdesc_resolve_v2). No cron: driven by explicit admin calls with ≤50
// ids. Deterministic resolution first; ambiguous identity rows may get one
// capped, validated AI decision (one-off, OpenAI Responses API, store:false).
import {
  AI_REVIEW_INSTRUCTIONS, AI_REVIEW_PROMPT_VERSION, AI_REVIEW_SCHEMA, LEGACY_RESOLVE_POLICY,
  aiReviewInputs, planLegacyResolve, validateAiDecision, type ResolvePlan,
} from "../_shared/clean-text-legacy-resolve.ts";
import { LEGACY_PROTECTED_BATCHES } from "../_shared/clean-text-legacy-ytdesc.ts";

export const LEGACY_RESOLVE_CONFIRM = "LEGACY_RESOLVE_V2";
export const LEGACY_AI_CONFIRM = "LEGACY_AI_REVIEW_ONCE";
const AI_CONTROLS_KEY = "clean_text_legacy_ai_review_controls";
/** Standard (non-batch) list prices per 1M tokens (same table as the person adapter, checked 2026-10-20). */
const PRICING: Record<string, { input: number; cached_input: number; output: number }> = {
  "gpt-6-luna": { input: 0.1, cached_input: 0.01, output: 0.5 },
  "gpt-6-sol": { input: 2, cached_input: 0.2, output: 10 },
};
const MAX_OUT = 1200;
const AI_CONCURRENCY = 4;

type Deps = {
  loadLegacyInputs: (admin: any, ids: string[]) => Promise<any[]>;
  loadRecurringRssByEpisode: (admin: any, ids: string[]) => Promise<Map<string, Set<string>>>;
  applyLegacy: (admin: any, plans: any[], attempts: Map<string, number>) => Promise<{ results: any[]; batchIds: string[]; stop: string | null }>;
  readSetting: (admin: any, key: string) => Promise<any>;
  patchSetting: (admin: any, key: string, patch: (fresh: any) => any) => Promise<void>;
};

async function loadAiDecisions(admin: any, ids: string[]) {
  const { data, error } = await admin.from("clean_text_legacy_ai_reviews")
    .select("episode_id,fingerprint,decision,validation,status").in("episode_id", ids).eq("prompt_version", AI_REVIEW_PROMPT_VERSION).eq("status", "completed");
  if (error) throw error;
  return new Map(((data || []) as any[]).map((r) => [`${r.episode_id}|${r.fingerprint}`, r]));
}

export async function planResolve(admin: any, deps: Deps, ids: string[], method: string) {
  const inputs = await deps.loadLegacyInputs(admin, ids);
  const recurring = await deps.loadRecurringRssByEpisode(admin, ids).catch(() => new Map<string, Set<string>>());
  const ai = await loadAiDecisions(admin, ids);
  const plans: ResolvePlan[] = [];
  const foreign: string[] = [];
  const byId = new Map(inputs.map((x) => [String(x.id), x]));
  for (const id of ids) {
    const x = byId.get(id);
    if (!x || x.is_hungarian !== true) { foreign.push(id); continue; }
    let p = await planLegacyResolve(x, { method, protectedBatches: LEGACY_PROTECTED_BATCHES, recurring: recurring.get(id) || null });
    const a = ai.get(`${id}|${p.fingerprint}`);
    if (a && p.ai_eligible) {
      p = await planLegacyResolve(x, { method, protectedBatches: LEGACY_PROTECTED_BATCHES, recurring: recurring.get(id) || null,
        ai: { decision: a.decision, validated: a.validation?.ok === true } });
    }
    p.reasons = [...p.reasons, `fp:${p.fingerprint.slice(0, 16)}`];
    plans.push(p);
  }
  return { plans, foreign, inputs: byId };
}

function summary(plans: ResolvePlan[]) {
  const c: Record<string, number> = {};
  for (const p of plans) { const k = `${p.status}:${p.outcome}:${p.write}`; c[k] = (c[k] || 0) + 1; }
  return c;
}

export async function legacyResolveDryRun(admin: any, deps: Deps, ids: string[], method: string, previews: boolean) {
  const { plans, foreign } = await planResolve(admin, deps, ids, method);
  return {
    summary: summary(plans), foreign,
    plans: plans.map((p) => ({
      episode_id: p.episode_id, status: p.status, outcome: p.outcome, write: p.write, verdict: p.verdict, ai_eligible: p.ai_eligible,
      reasons: p.reasons, prior_len: p.prior_len, next_len: p.next_len, dropped: p.dropped_units.length, added_units: p.rss_only_units.length,
      preview: previews ? p.preview : undefined, merged_text: previews && p.write === "apply" ? (p.item as any)?.cleaned_text : undefined,
    })),
  };
}

export async function legacyResolveApply(admin: any, deps: Deps, owner: string, ids: string[], method: string, leaseSeconds: number) {
  // Idempotence: skip rows already resolved under this policy with an unchanged fingerprint.
  const { data: prior } = await admin.from("clean_text_legacy_resolutions").select("episode_id,fingerprint,outcome").in("episode_id", ids).eq("policy_version", LEGACY_RESOLVE_POLICY);
  const { data: cl, error: clErr } = await admin.rpc("claim_clean_text_repair_queue_ids_v1", { p_owner: owner, p_ids: ids, p_lease_seconds: leaseSeconds });
  if (clErr) throw clErr;
  const claimed = ((cl || []) as any[]).map((c) => String(c.episode_id));
  const attempts = new Map(((cl || []) as any[]).map((c) => [String(c.episode_id), Number(c.attempts || 1)]));
  const { plans, foreign } = await planResolve(admin, deps, claimed, method);
  const priorById = new Map(((prior || []) as any[]).map((r) => [String(r.episode_id), r]));
  const unchanged = plans.filter((p) => {
    const r = priorById.get(p.episode_id);
    return r && r.fingerprint === p.fingerprint && r.outcome === p.outcome;
  });
  const unchangedIds = new Set(unchanged.map((p) => p.episode_id));
  const todo = plans.filter((p) => !unchangedIds.has(p.episode_id));
  const { results, batchIds, stop } = await deps.applyLegacy(admin, todo as any, attempts);
  for (const p of unchanged) results.push({ episode_id: p.episode_id, status: p.status, outcome: p.outcome, reasons: [...p.reasons.slice(0, 13), "unchanged_skip"] });
  for (const id of foreign) results.push({ episode_id: id, status: "done", outcome: "not_hungarian", reasons: [] });
  const { error: compErr } = await admin.rpc("complete_clean_text_repair_queue_v1", { p_owner: owner, p_results: results });
  if (compErr) throw new Error(`complete: ${compErr.message}`);
  const byEp = new Map(results.map((r) => [String(r.episode_id), r]));
  const rows = todo.map((p) => {
    const r = byEp.get(p.episode_id) || {};
    return {
      episode_id: p.episode_id, policy_version: LEGACY_RESOLVE_POLICY, fingerprint: p.fingerprint,
      status: String(r.status || p.status), outcome: String(r.outcome || p.outcome), verdict: p.verdict,
      write_kind: r.batch_id ? p.write : "none", batch_id: r.batch_id || null, parts: p.parts, evidence: p.evidence,
      rss_only_units: p.rss_only_units, dropped_units: p.dropped_units.slice(0, 40), reasons: p.reasons.slice(0, 20), updated_at: new Date().toISOString(),
    };
  }).filter((r) => r.status !== "retry");
  if (rows.length) {
    const { error } = await admin.from("clean_text_legacy_resolutions").upsert(rows, { onConflict: "episode_id,policy_version" });
    if (error) throw new Error(`resolutions: ${error.message}`);
  }
  await deps.patchSetting(admin, "clean_text_repair_queue_state", (f) => ({
    ...f, legacy_resolve_batch_ids: [...(f.legacy_resolve_batch_ids || []), ...batchIds].slice(-300),
    legacy_resolve_last_at: new Date().toISOString(),
  }));
  return { claimed: claimed.length, unchanged: unchanged.length, summary: summary(todo), batch_ids: batchIds, stop,
    results: results.map((r) => ({ episode_id: r.episode_id, status: r.status, outcome: r.outcome, batch_id: r.batch_id })) };
}

function costUsd(usage: any, price: { input: number; cached_input: number; output: number }) {
  const input = Math.max(0, Number(usage?.input_tokens) || 0);
  const cached = Math.min(input, Math.max(0, Number(usage?.input_tokens_details?.cached_tokens) || 0));
  const output = Math.max(0, Number(usage?.output_tokens) || 0);
  return { usd: ((input - cached) * price.input + cached * price.cached_input + output * price.output) / 1e6, input, output };
}

/**
 * One-off AI identity review of ambiguous rows. Reserves the upper-bound cost
 * atomically before any call, settles actual cost per call, stops on any
 * key/quota/rate problem. Writes only decisions; text changes happen later in
 * legacyResolveApply through the deterministic planner.
 */
export async function legacyAiReview(admin: any, deps: Deps, ids: string[], method: string) {
  const ctrl = await deps.readSetting(admin, AI_CONTROLS_KEY);
  if (ctrl.enabled !== true) return { ok: false, error: "ai_review_disabled" };
  const model = String(ctrl.model || "gpt-6-sol");
  const price = PRICING[model];
  if (!price) return { ok: false, error: "pricing_missing_for_model" };
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return { ok: false, error: "openai_key_missing" };

  const { plans, inputs } = await planResolve(admin, deps, ids, method);
  const existing = await loadAiDecisions(admin, ids);
  const eligible = plans.filter((p) => p.ai_eligible && !existing.has(`${p.episode_id}|${p.fingerprint}`));
  if (!eligible.length) return { ok: true, eligible: 0, note: "nothing_ambiguous_or_already_reviewed" };

  const reqs = eligible.map((p) => {
    const x = inputs.get(p.episode_id);
    const linkId = (p.evidence as any)?.provenance?.link_id || null;
    const link = (x.links || []).find((l: any) => l.id === linkId) || null;
    const inp = aiReviewInputs(x, link);
    const body = {
      model, instructions: AI_REVIEW_INSTRUCTIONS, input: "INPUT:\n" + JSON.stringify(inp),
      reasoning: { effort: "low" }, max_output_tokens: MAX_OUT, store: false,
      text: { format: { type: "json_schema", name: "legacy_ytdesc_identity", strict: true, schema: AI_REVIEW_SCHEMA } },
    };
    const estIn = Math.ceil((AI_REVIEW_INSTRUCTIONS.length + body.input.length) / 3) + 50;
    const reserve = Number(((estIn * price.input + MAX_OUT * price.output) / 1e6).toFixed(6));
    return { p, inp, body, reserve };
  });

  const { data: rv, error: rvErr } = await admin.rpc("reserve_clean_text_legacy_ai_review_v1", {
    p_model: model, p_prompt_version: AI_REVIEW_PROMPT_VERSION,
    p_items: reqs.map((r) => ({ episode_id: r.p.episode_id, fingerprint: r.p.fingerprint, reserve_usd: r.reserve })),
  });
  if (rvErr) return { ok: false, error: `reserve: ${rvErr.message}` };
  if (!(rv as any)?.ok) return { ok: false, error: "reservation_refused", detail: rv };
  const resvByEp = new Map(((rv as any).reserved || []).map((r: any) => [String(r.episode_id), String(r.id)]));

  let stop: string | null = null;
  let spent = 0;
  const outcomes: Record<string, number> = {};
  const queue = reqs.filter((r) => resvByEp.has(r.p.episode_id));
  const worker = async () => {
    while (queue.length) {
      const r = queue.shift()!;
      const rid = resvByEp.get(r.p.episode_id)!;
      if (stop) { await admin.rpc("settle_clean_text_legacy_ai_review_v1", { p_id: rid, p_status: "failed", p_actual_usd: 0, p_input_tokens: 0, p_output_tokens: 0, p_decision: null, p_validation: null, p_error: `not_sent:${stop}` }); outcomes.not_sent = (outcomes.not_sent || 0) + 1; continue; }
      let res: Response | null = null;
      let j: any = null;
      try {
        res = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(r.body) });
        j = await res.json().catch(() => null);
      } catch (e) {
        stop = `network:${String((e as Error).message).slice(0, 80)}`;
      }
      const usage = j?.usage || null;
      const c = costUsd(usage, price);
      spent += c.usd;
      if (!res || !res.ok) {
        const code = res ? `http_${res.status}:${String(j?.error?.code || j?.error?.type || "").slice(0, 60)}` : stop || "network";
        // Key, quota, permission or rate problems stop the whole one-off run (no retries).
        if (!res || [401, 402, 403, 404, 429].includes(res.status) || res.status >= 500) stop = stop || code;
        await admin.rpc("settle_clean_text_legacy_ai_review_v1", { p_id: rid, p_status: "failed", p_actual_usd: c.usd, p_input_tokens: c.input, p_output_tokens: c.output, p_decision: null, p_validation: null, p_error: code });
        outcomes.http_error = (outcomes.http_error || 0) + 1;
        continue;
      }
      const contents = (Array.isArray(j?.output) ? j.output : []).filter((o: any) => o?.type === "message").flatMap((o: any) => Array.isArray(o.content) ? o.content : []);
      const refusal = contents.find((x: any) => x?.type === "refusal");
      const text = contents.filter((x: any) => x?.type === "output_text").map((x: any) => String(x.text || "")).join("");
      let raw: any = null;
      let err: string | null = null;
      if (refusal) err = "model_refusal";
      else if (j?.status && j.status !== "completed") err = `incomplete:${j?.incomplete_details?.reason || j.status}`;
      else { try { raw = JSON.parse(text); } catch { err = "invalid_json"; } }
      const validation = raw ? validateAiDecision(raw, r.inp as any) : { ok: false, reasons: [err || "no_output"], decision: null };
      await admin.rpc("settle_clean_text_legacy_ai_review_v1", {
        p_id: rid, p_status: err ? "failed" : "completed", p_actual_usd: c.usd, p_input_tokens: c.input, p_output_tokens: c.output,
        p_decision: raw, p_validation: { ok: validation.ok, reasons: validation.reasons }, p_error: err,
      });
      const k = err ? `error:${err}` : `${raw.same_episode}:${validation.ok ? "validated" : "not_validated"}`;
      outcomes[k] = (outcomes[k] || 0) + 1;
    }
  };
  await Promise.all(Array.from({ length: AI_CONCURRENCY }, worker));
  return { ok: true, model, eligible: eligible.length, reserved: resvByEp.size, skipped_existing: (rv as any).skipped_existing, outcomes, actual_usd: Number(spent.toFixed(6)), stop };
}
