// Batch AI client — now routed through the Lovable AI Gateway.
//
// 2026-09-22: the direct Google Generative Language keys are retired. The
// historical function names (callGeminiOpenAI / callGeminiNative) are kept as a
// thin compatibility layer over callLovableAI so every runner keeps working.
//
// Policy:
//   - No Pro-class models on batch. Blocked by HARD_BLOCKLIST.
//   - No silent fallback to a more expensive model.
//   - Legacy model names are mapped to gateway ids by gatewayModel().
//   - Audit rows are written by lovable-ai.ts (provider='lovable_ai').

import { chatTokenCostUsd, embeddingTokenCostUsd } from "./ai-pricing.ts";
import { callLovableAI, gatewayModel } from "./lovable-ai.ts";


const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Default cost function used when caller does not pass one.
// Embeddings are detected by model name; everything else is chat-style.
function defaultCostFn(model: string, inTok: number, outTok: number): number {
  const m = model.toLowerCase();
  if (m.includes("embedding")) return embeddingTokenCostUsd(model, inTok);
  return chatTokenCostUsd(model, inTok, outTok);
}

// Hard blocklist (case-insensitive substring match). No Pro-class models on batch.
const HARD_BLOCKLIST = [
  "-pro",
];

export function isModelBlocked(model: string): boolean {
  const m = (model || "").toLowerCase();
  return HARD_BLOCKLIST.some((b) => m.includes(b));
}

export function assertModelAllowed(model: string) {
  if (!model) throw new Error("google-gemini-direct: empty model");
  if (isModelBlocked(model)) {
    throw new Error(`gemini-compat: model "${model}" is blocked by batch policy (no Pro on backlog).`);
  }
}


// Strip optional vendor prefix (kept for callers that log bare model names).
export function normalizeModel(model: string): string {
  const m = String(model || "").trim();
  return m.startsWith("google/") ? m.slice("google/".length) : m;
}

export type KeySource = "tier1" | "paid" | "free" | "gateway";


export interface AuditInput {
  job_type: string;
  target_type?: string | null;
  target_id?: string | null;
  source_hash?: string | null;
  prompt_version?: string | null;
  confidence?: number | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v.trim());
}

function looksLikeSlug(v: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(v);
}

function normalizeAuditRow(row: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...row };
  const meta = { ...((row.meta && typeof row.meta === "object" && !Array.isArray(row.meta)) ? row.meta as Record<string, unknown> : {}) };
  const rawTargetId = typeof row.target_id === "string" ? row.target_id.trim() : row.target_id;
  if (rawTargetId == null || rawTargetId === "") {
    payload.target_id = null;
  } else if (isUuid(rawTargetId)) {
    payload.target_id = rawTargetId;
  } else {
    payload.target_id = null;
    const raw = String(rawTargetId);
    if (String(row.target_type || "").includes("slug") || looksLikeSlug(raw)) {
      meta.target_slug = raw;
    } else {
      meta.target_ref = raw;
    }
  }
  payload.target_type = row.target_type ?? null;
  payload.meta = meta;
  return payload;
}

function auditPayloadShape(payload: Record<string, unknown>) {
  return {
    keys: Object.keys(payload).sort(),
    job_type: payload.job_type,
    provider: payload.provider,
    model_used: payload.model_used,
    status: payload.status,
    target_type: payload.target_type,
    target_id_type: payload.target_id == null ? "null" : typeof payload.target_id,
    meta_keys: Object.keys((payload.meta as Record<string, unknown>) || {}).sort(),
  };
}

// Transient provider failures (rate limit / capacity) are free and extremely
// noisy. Sample them at 1-in-50 so the audit table stays small.
const TRANSIENT_AUDIT_STATUSES = new Set([429, 500, 503]);
export function shouldSkipTransientAudit(status: number | null | undefined): boolean {
  if (!status || !TRANSIENT_AUDIT_STATUSES.has(Number(status))) return false;
  return Math.random() >= 0.02;
}

async function writeAudit(row: Record<string, unknown>) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("audit_insert_failed: missing_env");
  const payload = normalizeAuditRow(row);
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/ai_call_audit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[audit] insert failed", JSON.stringify({ status: res.status, body: text.slice(0, 300), payload_shape: auditPayloadShape(payload) }));
      throw new Error(`audit_insert_failed: HTTP ${res.status}`);
    }
  } catch (e) {
    if (!String(e).includes("audit_insert_failed")) {
      console.error("[audit] insert threw", JSON.stringify({ error: String(e).slice(0, 200), payload_shape: auditPayloadShape(payload) }));
    }
    throw e;
  }
}


export interface OpenAICallOpts {
  model: string;
  messages: any[];
  tools?: any[];
  tool_choice?: any;
  max_tokens?: number;
  temperature?: number;
  response_format?: any;
  // audit
  job_type: string;
  target_type?: string;
  target_id?: string;
  source_hash?: string;
  prompt_version?: string;
  // routing
  preferTier1?: boolean;
  // spend guard. By default we validate user-message content before any paid call.
  input_text?: string;
  min_input_chars?: number;
  skip_input_validation?: boolean;
  // cost helper (optional). Pass a fn that returns USD given (model, inTok, outTok).
  costFn?: (model: string, inTok: number, outTok: number) => number;
}

export interface OpenAICallResult {
  ok: boolean;
  status: number;
  data: any;
  model_used: string;
  key_source?: KeySource;
  input_tokens: number;
  output_tokens: number;
  cost_usd?: number;
  error?: string;
}

/**
 * OpenAI-compatible chat completion, routed through the Lovable AI Gateway.
 * Keeps the historical name/shape so existing runners need no changes.
 */
export async function callGeminiOpenAI(opts: OpenAICallOpts): Promise<OpenAICallResult> {
  const model = gatewayModel(opts.model);
  assertModelAllowed(model);

  const result = await callLovableAI({
    model,
    messages: opts.messages,
    tools: opts.tools,
    tool_choice: opts.tool_choice,
    max_tokens: opts.max_tokens,
    temperature: opts.temperature,
    response_format: opts.response_format,
    job_type: opts.job_type,
    target_type: opts.target_type,
    target_id: opts.target_id,
    source_hash: opts.source_hash,
    prompt_version: opts.prompt_version,
    input_text: opts.input_text,
    min_input_chars: opts.min_input_chars,
    skip_input_validation: opts.skip_input_validation,
  });

  const inTok = Number(result.input_tokens || 0);
  const outTok = Number(result.output_tokens || 0);
  const cost = result.ok ? (opts.costFn ?? defaultCostFn)(model, inTok, outTok) : 0;

  return {
    ok: result.ok,
    status: result.status,
    data: result.data,
    model_used: result.model_used,
    key_source: "gateway",
    input_tokens: inTok,
    output_tokens: outTok,
    cost_usd: cost,
    error: result.error,
  };
}



/**
 * Native Gemini generateContent call (used by person-relevance-judge which
 * relies on Google's native functionCall format). Records audit + returns
 * usage. On 429/503 hops to the next key in the pool.
 */
export interface NativeCallOpts {
  model: string;
  prompt: string;
  tool: { name: string; description?: string; parameters: any };
  job_type: string;
  target_type?: string;
  target_id?: string;
  confidence?: number;
  preferTier1?: boolean;
  input_text?: string;
  min_input_chars?: number;
  skip_input_validation?: boolean;
  costFn?: (model: string, inTok: number, outTok: number) => number;
}

export interface NativeCallResult {
  ok: boolean;
  args?: any;
  model_used: string;
  key_source?: KeySource;
  input_tokens: number;
  output_tokens: number;
  cost_usd?: number;
  status: number;
  error?: string;
}

export async function callGeminiNative(opts: NativeCallOpts): Promise<NativeCallResult> {
  const model = gatewayModel(opts.model);
  assertModelAllowed(model);

  // Native Gemini functionCall is expressed as an OpenAI-compatible forced tool
  // call on the gateway; the parsed arguments keep the same shape for callers.
  const result = await callLovableAI({
    model,
    messages: [{ role: "user", content: opts.prompt }],
    tools: [{
      type: "function",
      function: {
        name: opts.tool.name,
        description: opts.tool.description,
        parameters: opts.tool.parameters,
      },
    }],
    tool_choice: { type: "function", function: { name: opts.tool.name } },
    job_type: opts.job_type,
    target_type: opts.target_type,
    target_id: opts.target_id,
    input_text: opts.input_text ?? opts.prompt,
    min_input_chars: opts.min_input_chars,
    skip_input_validation: opts.skip_input_validation,
  });

  const inTok = Number(result.input_tokens || 0);
  const outTok = Number(result.output_tokens || 0);
  const cost = (opts.costFn ?? defaultCostFn)(model, inTok, outTok);

  if (!result.ok) {
    return {
      ok: false, model_used: model, key_source: "gateway",
      input_tokens: inTok, output_tokens: outTok, cost_usd: 0,
      status: result.status, error: result.error,
    };
  }

  const call = result.data?.choices?.[0]?.message?.tool_calls?.[0]?.function;
  let args: unknown = undefined;
  if (call?.arguments) {
    try { args = typeof call.arguments === "string" ? JSON.parse(call.arguments) : call.arguments; } catch { args = undefined; }
  }
  if (args === undefined) {
    return {
      ok: false, model_used: model, key_source: "gateway",
      input_tokens: inTok, output_tokens: outTok, cost_usd: cost,
      status: result.status, error: "tool_call_missing",
    };
  }

  return {
    ok: true, args, model_used: model, key_source: "gateway",
    input_tokens: inTok, output_tokens: outTok, cost_usd: cost, status: result.status,
  };
}


// ============================================================================
// Budget guard + input validation + skip auditing
// ============================================================================

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: string;
  spend_today_usd: number;
  daily_cap_usd: number;
  job_spend_today_usd: number;
  job_cap_usd: number | null;
}

/**
 * Check global + per-job daily spend caps from app_settings.ai_budget and
 * ai_spend_daily. Returns allowed=false with reason when budget exceeded.
 * Safe to call before each AI request (cache result for short runs).
 */
export async function checkBudget(jobType: string): Promise<BudgetCheckResult> {
  const fail: BudgetCheckResult = {
    allowed: true, spend_today_usd: 0, daily_cap_usd: 15,
    job_spend_today_usd: 0, job_cap_usd: null,
  };
  if (!SUPABASE_URL || !SERVICE_KEY) return fail;
  try {
    const settingsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/app_settings?key=eq.ai_budget&select=value`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    const settings = await settingsRes.json();
    const budget = settings?.[0]?.value || {};
    const dailyCap = Number(budget?.daily_cap_usd ?? 15);
    const perJobCaps = budget?.per_job_caps_usd || {};
    const jobCap = perJobCaps[jobType] != null ? Number(perJobCaps[jobType]) : null;

    const today = new Date().toISOString().slice(0, 10);
    const spendRes = await fetch(
      `${SUPABASE_URL}/rest/v1/ai_spend_daily?day=eq.${today}&select=spend_usd,by_kind`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    const spendRows = await spendRes.json();
    const row = spendRows?.[0] || { spend_usd: 0, by_kind: {} };
    const spendToday = Number(row.spend_usd || 0);
    const byKind = row.by_kind || {};
    const jobSpend = Number(byKind[jobType] || 0);

    if (spendToday >= dailyCap) {
      return { allowed: false, reason: `global_daily_cap_exceeded ($${spendToday.toFixed(2)}/$${dailyCap})`,
        spend_today_usd: spendToday, daily_cap_usd: dailyCap,
        job_spend_today_usd: jobSpend, job_cap_usd: jobCap };
    }
    if (jobCap != null && jobSpend >= jobCap) {
      return { allowed: false, reason: `job_daily_cap_exceeded (${jobType}: $${jobSpend.toFixed(2)}/$${jobCap})`,
        spend_today_usd: spendToday, daily_cap_usd: dailyCap,
        job_spend_today_usd: jobSpend, job_cap_usd: jobCap };
    }
    return { allowed: true, spend_today_usd: spendToday, daily_cap_usd: dailyCap,
      job_spend_today_usd: jobSpend, job_cap_usd: jobCap };
  } catch (e) {
    return { ...fail, reason: `budget_check_error: ${String(e).slice(0, 200)}` };
  }
}

/**
 * Validate input text. Returns null if valid, or a skip reason string.
 */
export function validateAiInput(text: unknown, opts?: { minChars?: number }): string | null {
  const minChars = opts?.minChars ?? 40;
  if (text == null) return "input_null";
  if (typeof text !== "string") return "input_not_string";
  const t = text.trim();
  if (!t) return "input_empty";
  if (t.length < minChars) return "input_too_short";
  // Csak valódi sablonhibák: a JSON-ban szereplő `"mező": null` érvényes bemenet
  // (korábban emiatt több száz epizód/személy örökre kimaradt).
  if (/\bundefined\b|\[object Object\]/.test(t)) return "input_contains_placeholder";
  const stripped = t.replace(/https?:\/\/\S+/g, "").replace(/@[\w.-]+/g, "").replace(/\s+/g, " ").trim();
  if (stripped.length < minChars) return "input_boilerplate_only";
  return null;
}

function messageContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return String((part as { text?: unknown }).text ?? "");
      }
      return "";
    }).filter(Boolean).join("\n");
  }
  return "";
}

export function extractUsefulTextFromMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  return messages.map((message) => {
    if (!message || typeof message !== "object") return "";
    const role = String((message as { role?: unknown }).role || "").toLowerCase();
    if (role === "system" || role === "developer") return "";
    return messageContentToText((message as { content?: unknown }).content);
  }).filter(Boolean).join("\n");
}

/**
 * Write a 'skipped' audit row (no AI call made).
 */
export async function auditSkip(args: {
  job_type: string;
  reason: string;
  model?: string;
  target_type?: string;
  target_id?: string;
  source_hash?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const latencyMs = typeof args.meta?.latency_ms === "number" ? Math.max(0, Math.round(args.meta.latency_ms)) : 0;
  await writeAudit({
    job_type: args.job_type,
    provider: "google_generative_language",
    model_used: args.model || "gemini-2.5-flash-lite",
    status: "skipped",
    error_message: args.reason,
    estimated_cost_usd: 0,
    latency_ms: latencyMs,
    key_source: "none",
    target_type: args.target_type ?? null,
    target_id: args.target_id ?? null,
    source_hash: args.source_hash ?? null,
    meta: { skipped_reason: args.reason, key_source: "none", ...(args.meta || {}) },
  });
}
