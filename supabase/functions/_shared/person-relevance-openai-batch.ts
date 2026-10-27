// OpenAI Batch API adapter policy for person–episode relevance review.
// Pure functions only (no network): request building, cost bounds, output
// parsing, decision policy and submission gates. The edge function
// `person-relevance-openai-batch` performs I/O. Everything fails closed.
import { PERSON_REVIEW_HEAD, PERSON_REVIEW_RULES, validateDecision, type Decision, type Source } from "./person-relevance-batch.ts";

export const OPENAI_PROMPT_VERSION = "person-openai-v1";
export const BATCH_MAX_REQUESTS = 50_000;
export const BATCH_MAX_BYTES = 200 * 1024 * 1024;
export const REQUEST_MAX_CHARS = 60_000;
export type Tier = "primary" | "escalation" | "golden_eval";
const TIER_CODE: Record<Tier, string> = { primary: "p", escalation: "e", golden_eval: "g" };

export type Pricing = { input: number; cached_input: number; output: number };
export type Controls = {
  enabled: boolean;
  key_rotation_confirmed: boolean;
  primary_model: string;
  escalation_model: string | null;
  escalation_enabled: boolean;
  reasoning_effort: "low" | "medium";
  max_output_tokens: number;
  prompt_version: string;
  authorized_pilot: null | { max_requests: number; total_cap_usd: number; daily_cap_usd?: number; authorized_by?: string; authorized_at?: string };
  daily_cap_usd: number;
  total_cap_usd: number;
  max_requests_per_job: number;
  max_open_jobs: number;
  max_attempts: number;
  allow_ai_rejection: boolean;
  batch_discount: number;
  pricing_usd_per_1m: Record<string, Pricing>;
  pricing_source?: string;
  pricing_checked_at?: string;
  paused_reason?: string | null;
  // Separate owner caps per lane (both still bounded by total_cap_usd / daily_cap_usd).
  primary_total_cap_usd?: number | null;
  escalation_total_cap_usd?: number | null;
  escalation_hold_new?: boolean;
};

// Standard (non-batch) OpenAI list prices per 1M tokens, checked 2026-10-20 on
// developers.openai.com/api/docs/pricing. Batch is billed at `batch_discount`.
export const DEFAULT_CONTROLS: Controls = {
  enabled: false,
  key_rotation_confirmed: false,
  primary_model: "gpt-6-luna",
  escalation_model: "gpt-6-sol",
  escalation_enabled: false,
  reasoning_effort: "low",
  max_output_tokens: 1500,
  prompt_version: OPENAI_PROMPT_VERSION,
  authorized_pilot: null,
  daily_cap_usd: 0,
  total_cap_usd: 0,
  max_requests_per_job: 2000,
  max_open_jobs: 1,
  max_attempts: 2,
  allow_ai_rejection: false,
  batch_discount: 0.5,
  pricing_usd_per_1m: {
    "gpt-6-luna": { input: 0.1, cached_input: 0.01, output: 0.5 },
    "gpt-6-sol": { input: 2, cached_input: 0.2, output: 10 },
    "gpt-6-astra": { input: 10, cached_input: 1, output: 50 },
  },
  pricing_source: "https://developers.openai.com/api/docs/pricing",
  pricing_checked_at: "2026-10-20",
  paused_reason: null,
};

export function mergeControls(stored: unknown): Controls {
  const s = stored && typeof stored === "object" ? stored as Partial<Controls> : {};
  return { ...DEFAULT_CONTROLS, ...s, pricing_usd_per_1m: { ...DEFAULT_CONTROLS.pricing_usd_per_1m, ...(s.pricing_usd_per_1m || {}) } };
}

export function buildCustomId(a: { promptVersion: string; tier: Tier; personId: string; episodeId: string; sourceHash: string; attempt: number }): string {
  return `${a.promptVersion}:${TIER_CODE[a.tier]}|${a.personId}|${a.episodeId}|${a.sourceHash}|a${a.attempt}`;
}

export function parseCustomId(id: string): null | { promptVersion: string; tier: Tier; personId: string; episodeId: string; sourceHash: string; attempt: number } {
  const m = /^([a-z0-9.\-]+):([peg])\|([0-9a-f-]{36})\|([0-9a-f-]{36})\|([0-9a-f]{32})\|a(\d+)$/.exec(String(id || ""));
  if (!m) return null;
  const tier = (Object.entries(TIER_CODE).find(([, c]) => c === m[2])?.[0]) as Tier;
  return { promptVersion: m[1], tier, personId: m[3], episodeId: m[4], sourceHash: m[5], attempt: Number(m[6]) };
}

export const PAIR_INSTRUCTIONS = `${PERSON_REVIEW_HEAD}
Egyetlen személy–epizód párról döntesz; a választ kizárólag a megadott JSON-sémában add meg.
${PERSON_REVIEW_RULES}`;

export const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "score", "mention_type", "identity_match", "reason", "evidence_phrases"],
  properties: {
    status: { type: "string", enum: ["accepted", "rejected", "needs_review"] },
    score: { type: "number" },
    mention_type: { type: "string", enum: ["host", "guest", "subject", "mentioned", "none"] },
    identity_match: { type: "string", enum: ["same_person", "different_person_same_name", "substring_false_positive", "uncertain"] },
    reason: { type: "string" },
    evidence_phrases: { type: "array", items: { type: "string" } },
  },
} as const;

// Data minimisation: public catalogue text only. No mention ids, reviewer
// metadata, user data or internal identifiers beyond the episode id.
export function minimalPayload(src: Source) {
  return {
    person: { name: src.person.name, aliases: (src.person.aliases || []).slice(0, 10),
      disambiguation_label: src.person.disambiguation_label || null, disambiguation_context: src.person.disambiguation_context || null },
    episode: { title: src.episode.title, summary: src.episode.summary, clean_text: src.episode.clean_text },
    podcast: { title: src.podcast.title, description: src.podcast.description },
    extraction: (src.mentions || []).map((m) => ({ mention_type: m.mention_type, confidence: m.confidence, evidence: m.evidence })),
  };
}

export function buildRequestLine(customId: string, src: Source, c: Pick<Controls, "reasoning_effort" | "max_output_tokens">, model: string) {
  return {
    custom_id: customId,
    method: "POST",
    url: "/v1/responses",
    body: {
      model,
      instructions: PAIR_INSTRUCTIONS,
      input: "INPUT:\n" + JSON.stringify(minimalPayload(src)),
      reasoning: { effort: c.reasoning_effort === "medium" ? "medium" : "low" },
      max_output_tokens: Math.max(256, Math.min(4000, Math.floor(c.max_output_tokens))),
      store: false,
      text: { format: { type: "json_schema", name: "person_episode_decision", strict: true, schema: DECISION_SCHEMA } },
    },
  };
}

// Hungarian text tokenises densely; chars/3 is a deliberate overestimate.
export const estimateTokens = (text: string) => Math.ceil(String(text || "").length / 3);

export function requestCostUpperBoundUsd(line: ReturnType<typeof buildRequestLine>, pricing: Pricing | undefined, discount: number): number {
  if (!pricing || !(discount > 0 && discount <= 1)) return Number.POSITIVE_INFINITY;
  const input = estimateTokens(line.body.instructions) + estimateTokens(line.body.input) + 50;
  return ((input * pricing.input) + (line.body.max_output_tokens * pricing.output)) / 1e6 * discount;
}

export type Usage = { input_tokens?: number; output_tokens?: number; input_tokens_details?: { cached_tokens?: number } };
export function actualCostUsd(usage: Usage | null | undefined, pricing: Pricing | undefined, discount: number): number {
  if (!usage || !pricing) return 0;
  const input = Math.max(0, Number(usage.input_tokens) || 0);
  const cached = Math.min(input, Math.max(0, Number(usage.input_tokens_details?.cached_tokens) || 0));
  const output = Math.max(0, Number(usage.output_tokens) || 0);
  return (((input - cached) * pricing.input) + (cached * pricing.cached_input) + (output * pricing.output)) / 1e6 * discount;
}

export type ParsedLine =
  | { custom_id: string; outcome: "ok"; raw: unknown; usage: Usage | null }
  | { custom_id: string; outcome: "refusal" | "incomplete" | "schema_mismatch" | "http_error" | "error"; error: string; usage: Usage | null };

export function parseOutputLine(line: string): ParsedLine | null {
  let row: any;
  try { row = JSON.parse(line); } catch { return null; }
  const custom_id = typeof row?.custom_id === "string" ? row.custom_id : "";
  if (!custom_id) return null;
  if (row.error) return { custom_id, outcome: "error", error: String(row.error.code || row.error.message || "error").slice(0, 200), usage: null };
  const res = row.response;
  const body = res?.body;
  const usage: Usage | null = body?.usage || null;
  if (!res || Number(res.status_code) !== 200) {
    return { custom_id, outcome: "http_error", error: `http_${res?.status_code ?? "missing"}:${String(body?.error?.code || "")}`.slice(0, 200), usage };
  }
  if (body?.status && body.status !== "completed") {
    return { custom_id, outcome: "incomplete", error: String(body.incomplete_details?.reason || body.status).slice(0, 200), usage };
  }
  const contents = (Array.isArray(body?.output) ? body.output : [])
    .filter((o: any) => o?.type === "message").flatMap((o: any) => Array.isArray(o.content) ? o.content : []);
  const refusal = contents.find((c: any) => c?.type === "refusal");
  if (refusal) return { custom_id, outcome: "refusal", error: "model_refusal", usage };
  const text = contents.filter((c: any) => c?.type === "output_text").map((c: any) => String(c.text || "")).join("");
  if (!text.trim()) return { custom_id, outcome: "schema_mismatch", error: "empty_output", usage };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { custom_id, outcome: "schema_mismatch", error: "invalid_json", usage }; }
  if (!isDecisionShape(raw)) return { custom_id, outcome: "schema_mismatch", error: "schema_mismatch", usage };
  return { custom_id, outcome: "ok", raw, usage };
}

export function isDecisionShape(raw: unknown): boolean {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object" || Array.isArray(r)) return false;
  const keys = Object.keys(r).sort().join(",");
  if (keys !== "evidence_phrases,identity_match,mention_type,reason,score,status") return false;
  return DECISION_SCHEMA.properties.status.enum.includes(r.status as never)
    && typeof r.score === "number" && Number.isFinite(r.score) && r.score >= 0 && r.score <= 1
    && DECISION_SCHEMA.properties.mention_type.enum.includes(r.mention_type as never)
    && DECISION_SCHEMA.properties.identity_match.enum.includes(r.identity_match as never)
    && typeof r.reason === "string" && Array.isArray(r.evidence_phrases) && r.evidence_phrases.every((x) => typeof x === "string");
}

export type PolicyResult = { decision: Decision & { model: string; ai_suggested_status: string }; final_status: "accepted" | "rejected" | "needs_review"; escalate: boolean };

// AI never merges namesakes, never mass-rejects and never accepts without a
// verbatim source quote. Identity-risk persons always go to human review.
export function decidePolicy(raw: unknown, src: Source, ctx: { model: string; identityRisk: boolean; allowAiRejection: boolean; tier: Tier }): PolicyResult {
  const suggested = String((raw as any)?.status || "invalid");
  const validated = validateDecision(raw, src);
  let final: PolicyResult["final_status"] = validated.status === "accepted" ? "accepted"
    : validated.status === "rejected" ? "rejected" : "needs_review";
  let reason = validated.reason;
  if (final === "accepted" && ctx.identityRisk) { final = "needs_review"; reason = "Azonos nevű vagy kétértelmű személy; emberi ellenőrzés szükséges. " + reason; }
  if (final === "rejected" && !ctx.allowAiRejection) { final = "needs_review"; reason = "AI elutasítási javaslat; csak emberi döntéssel utasítható el. " + reason; }
  const score = Number(validated.score) || 0;
  const escalate = ctx.tier === "primary" && final === "needs_review" && !ctx.identityRisk
    && (suggested === "needs_review" || (suggested === "accepted" && score >= 0.6) || validated.identity_match === "uncertain");
  return {
    decision: { ...validated, reason: reason.slice(0, 240), model: ctx.model, ai_suggested_status: suggested },
    final_status: final, escalate,
  };
}

// Owner decision 2026-10-27: a namesake / substring false match is closed as
// rejected only when two independent AI reviews agree (primary model said so
// AND the stronger escalation model says so with a verbatim source quote).
// Everything else that is not a safe acceptance stays needs_review.
export const NAMESAKE_IDENTITIES = ["different_person_same_name", "substring_false_positive"] as const;
const isNamesake = (v: unknown) => (NAMESAKE_IDENTITIES as readonly string[]).includes(String(v));
export function escalationFinal(
  primary: { identity_match?: unknown; ai_suggested_status?: unknown } | null | undefined,
  policy: PolicyResult,
): PolicyResult["final_status"] {
  if (policy.final_status === "accepted") return "accepted";
  const d = policy.decision as Decision & { ai_suggested_status: string };
  const escalationSaysNamesake = d.status === "rejected" && isNamesake(d.identity_match)
    && Array.isArray(d.evidence_phrases) && d.evidence_phrases.length > 0;
  const primarySaysNamesake = !!primary && primary.ai_suggested_status === "rejected" && isNamesake(primary.identity_match);
  return escalationSaysNamesake && primarySaysNamesake ? "rejected" : "needs_review";
}

// Escalation requests use the stronger model; a tighter output cap keeps the
// upper-bound reservation small (primary p99 output was ~400 tokens).
export const ESCALATION_MAX_OUTPUT_TOKENS = 1000;

export type JobStatus = "submitted" | "validating" | "in_progress" | "finalizing" | "completed" | "failed" | "expired" | "cancelling" | "cancelled";
export function mapBatchStatus(s: string): JobStatus | null {
  const known: JobStatus[] = ["validating", "in_progress", "finalizing", "completed", "failed", "expired", "cancelling", "cancelled"];
  return known.includes(s as JobStatus) ? s as JobStatus : null;
}
export const TERMINAL_BATCH = new Set(["completed", "failed", "expired", "cancelled"]);

// A "released" item never got an answer (upload refused, job aborted before or
// without a result) and was never billed, so it must not use up a retry: only
// requests that reached the model and came back count toward max_attempts.
export const countsAsAttempt = (status: string | null | undefined) => status !== "released";

// A job stuck in "claimed" this long was killed mid-submit (nothing uploaded,
// nothing billed); it only blocks an open-job slot and its pairs' leases.
export const STALE_CLAIM_MS = 30 * 60_000;
export function isStaleClaim(job: { status: string; created_at: string }, now = Date.now()): boolean {
  return job.status === "claimed" && now - new Date(job.created_at).getTime() > STALE_CLAIM_MS;
}

export type GateContext = {
  keyPresent: boolean; backgroundEnabled: boolean; priorityBlocker: string | null;
  openJobs: number; requestedCount: number; model: string; tier: Tier;
};
export function submitBlockers(c: Controls, ctx: GateContext): string[] {
  const out: string[] = [];
  if (!c.enabled) out.push("controls_disabled");
  if (c.paused_reason) out.push("paused:" + c.paused_reason);
  if (!c.key_rotation_confirmed) out.push("key_rotation_not_confirmed");
  if (!ctx.keyPresent) out.push("openai_api_key_missing");
  const auth = c.authorized_pilot;
  if (!auth || !(Number(auth.max_requests) > 0) || !(Number(auth.total_cap_usd) > 0)) out.push("no_authorized_pilot_budget");
  if (!(c.total_cap_usd > 0) || !(c.daily_cap_usd > 0)) out.push("cost_caps_zero");
  if (!c.pricing_usd_per_1m[ctx.model]) out.push("pricing_missing_for_model");
  if (ctx.tier === "escalation" && !c.escalation_enabled) out.push("escalation_disabled");
  if (!ctx.backgroundEnabled) out.push("background_jobs_paused");
  if (ctx.priorityBlocker && ctx.tier !== "golden_eval") out.push(ctx.priorityBlocker);
  if (ctx.openJobs >= Math.max(1, c.max_open_jobs)) out.push("open_job_limit");
  if (!(ctx.requestedCount >= 1) || ctx.requestedCount > Math.min(c.max_requests_per_job, BATCH_MAX_REQUESTS)) out.push("request_count_out_of_bounds");
  return out;
}

export function jsonlSize(lines: unknown[]): number {
  return lines.reduce<number>((n, l) => n + new TextEncoder().encode(JSON.stringify(l)).length + 1, 0);
}

export type GoldenLabel = { person_id: string; episode_id: string; label_status: string; label_mention_type?: string | null };
export type EvalItem = { person_id: string; episode_id: string; model: string; final_status?: string | null; decision?: { status?: string; mention_type?: string } | null; cost_usd?: number | null };
// Model comparison on human goldens: precision of auto-accept is the gate.
export function goldenMetrics(goldens: GoldenLabel[], items: EvalItem[]) {
  const labels = new Map(goldens.map((g) => [`${g.person_id}|${g.episode_id}`, g]));
  const byModel = new Map<string, { n: number; auto_accept: number; correct_accept: number; false_accept: number; needs_review: number; status_agree: number; role_agree: number; cost_usd: number }>();
  for (const it of items) {
    const g = labels.get(`${it.person_id}|${it.episode_id}`);
    if (!g) continue;
    const m = byModel.get(it.model) || { n: 0, auto_accept: 0, correct_accept: 0, false_accept: 0, needs_review: 0, status_agree: 0, role_agree: 0, cost_usd: 0 };
    m.n++; m.cost_usd += Number(it.cost_usd) || 0;
    const final = it.final_status || "needs_review";
    if (final === "accepted") {
      m.auto_accept++;
      if (g.label_status === "accepted") m.correct_accept++; else m.false_accept++;
      if (g.label_mention_type && it.decision?.mention_type === g.label_mention_type) m.role_agree++;
    }
    if (final === "needs_review") m.needs_review++;
    if (it.decision?.status === g.label_status) m.status_agree++;
    byModel.set(it.model, m);
  }
  return [...byModel.entries()].map(([model, m]) => ({
    model, ...m,
    accept_precision: m.auto_accept ? m.correct_accept / m.auto_accept : null,
    needs_review_rate: m.n ? m.needs_review / m.n : null,
    cost_per_1000_usd: m.n ? (m.cost_usd / m.n) * 1000 : null,
  }));
}

export const PILOT_DESIGN = {
  goldens: { target: 150, min: 100, max: 200, strata: { participant: 60, mention: 40, subject: 20, identity_risk: 20, short_or_missing_text: 10 } },
  candidate_pilot: { target: 1500, min: 1000, max: 2000, strata: { participant: 900, mention: 450, subject: 150 } },
  model_comparison: ["gpt-6-luna", "gpt-6-sol"],
  acceptance_gates: { accept_precision_min: 0.97, false_accept_max: 2, needs_review_rate_max: 0.35 },
} as const;
