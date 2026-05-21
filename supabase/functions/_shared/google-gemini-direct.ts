// Direct Google Generative Language API client (Tier 1 routing).
// Uses Google's OpenAI-compatible endpoint so existing runners stay drop-in.
//
// Policy:
//   - No Pro / Gemini 3.x. Blocked by HARD_BLOCKLIST.
//   - No silent fallback to more expensive model. Callers may explicitly retry
//     once with `retry_model` (typically gemini-2.5-flash) on low-confidence.
//   - Every call writes one ai_call_audit row with provider='google_generative_language'
//     and meta.key_source ∈ {'tier1','paid','free'}.
//   - Key pool order: GEMINI_API_KEY_TIER1 > GEMINI_API_KEY (paid) > GEMINI_API_KEY_FREE.
//     On 429/503 we hop to the next key in the pool (still NOT a model upgrade).

import { chatTokenCostUsd, embeddingTokenCostUsd, geminiOutputTokens, geminiInputTokens } from "./ai-pricing.ts";

const OPENAI_COMPAT_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const NATIVE_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Default cost function used when caller does not pass one.
// Embeddings are detected by model name; everything else is chat-style.
function defaultCostFn(model: string, inTok: number, outTok: number): number {
  const m = model.toLowerCase();
  if (m.includes("embedding")) return embeddingTokenCostUsd(model, inTok);
  return chatTokenCostUsd(model, inTok, outTok);
}

// Hard blocklist (case-insensitive substring match). No Pro, no Gemini 3.x.
const HARD_BLOCKLIST = [
  "-pro",
  "gemini-3",         // gemini-3, gemini-3.1, gemini-3.5 etc.
  "gemini-2.5-pro",
];

export function isModelBlocked(model: string): boolean {
  const m = (model || "").toLowerCase();
  return HARD_BLOCKLIST.some((b) => m.includes(b));
}

export function assertModelAllowed(model: string) {
  if (!model) throw new Error("google-gemini-direct: empty model");
  if (isModelBlocked(model)) {
    throw new Error(`google-gemini-direct: model "${model}" is blocked by batch policy (no Pro / Gemini 3 on backlog).`);
  }
}

// Strip optional vendor prefix so callers can pass either "google/gemini-2.5-flash-lite"
// or "gemini-2.5-flash-lite" — Google's API only accepts the bare name.
export function normalizeModel(model: string): string {
  const m = String(model || "").trim();
  return m.startsWith("google/") ? m.slice("google/".length) : m;
}

export type KeySource = "tier1" | "paid" | "free";

export interface KeyEntry { key: string; source: KeySource }

export function getKeyPool(opts?: { preferTier1?: boolean }): KeyEntry[] {
  const preferTier1 = opts?.preferTier1 !== false; // default true
  const tier1 = Deno.env.get("GEMINI_API_KEY_TIER1");
  const paid = Deno.env.get("GEMINI_API_KEY");
  const free = Deno.env.get("GEMINI_API_KEY_FREE");
  const pool: KeyEntry[] = [];
  if (preferTier1 && tier1) pool.push({ key: tier1, source: "tier1" });
  if (paid) pool.push({ key: paid, source: "paid" });
  if (free) pool.push({ key: free, source: "free" });
  if (!preferTier1 && tier1) pool.push({ key: tier1, source: "tier1" });
  return pool;
}

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
 * Drop-in replacement for OpenAI-compatible chat completions, routed through
 * Google's Tier 1 key. Same response shape as Lovable AI Gateway, so existing
 * runners (seo-enrich, categorize) only need to swap the fetch call.
 */
export async function callGeminiOpenAI(opts: OpenAICallOpts): Promise<OpenAICallResult> {
  const rawModel = normalizeModel(opts.model);
  assertModelAllowed(rawModel);

  const pool = getKeyPool({ preferTier1: opts.preferTier1 });
  if (pool.length === 0) {
    await writeAudit({
      job_type: opts.job_type, provider: "google_generative_language",
      model_used: rawModel, status: "error",
      error_message: "no_gemini_key",
      target_type: opts.target_type ?? null, target_id: opts.target_id ?? null,
      source_hash: opts.source_hash ?? null, prompt_version: opts.prompt_version ?? null,
      meta: { key_source: null },
    });
    return { ok: false, status: 0, data: null, model_used: rawModel, input_tokens: 0, output_tokens: 0, error: "no_gemini_key" };
  }

  const body: Record<string, unknown> = {
    model: rawModel,
    messages: opts.messages,
  };
  if (opts.tools) body.tools = opts.tools;
  if (opts.tool_choice) body.tool_choice = opts.tool_choice;
  if (opts.max_tokens) body.max_tokens = opts.max_tokens;
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  if (opts.response_format) body.response_format = opts.response_format;

  let lastStatus = 0;
  let lastJson: any = null;
  let lastErr = "";
  let lastKeySource: KeySource | null = null;
  const t0 = Date.now();

  for (const entry of pool) {
    let res: Response;
    let json: any = null;
    try {
      res = await fetch(OPENAI_COMPAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${entry.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      try { json = await res.json(); } catch { /* */ }
    } catch (e) {
      lastErr = `network: ${String(e).slice(0, 200)}`;
      lastKeySource = entry.source;
      continue;
    }

    const usage = json?.usage || {};
    const inTok = Number(usage.prompt_tokens ?? 0);
    const outTok = Number(usage.completion_tokens ?? 0);
    lastKeySource = entry.source;

    if (res.ok) {
      const cost = (opts.costFn ?? defaultCostFn)(rawModel, inTok, outTok);
      const latency_ms = Date.now() - t0;
      await writeAudit({
        job_type: opts.job_type, provider: "google_generative_language",
        model_used: rawModel, status: "ok",
        input_tokens: inTok, output_tokens: outTok,
        estimated_cost_usd: cost,
        latency_ms,
        key_source: entry.source,
        target_type: opts.target_type ?? null, target_id: opts.target_id ?? null,
        source_hash: opts.source_hash ?? null, prompt_version: opts.prompt_version ?? null,
        meta: { key_source: entry.source },
      });
      return {
        ok: true, status: res.status, data: json, model_used: rawModel,
        key_source: entry.source, input_tokens: inTok, output_tokens: outTok, cost_usd: cost,
      };
    }

    lastStatus = res.status;
    lastJson = json;
    lastErr = json?.error?.message || `HTTP ${res.status}`;

    if (res.status === 429 || res.status === 503 || res.status === 500) {
      continue;
    }
    break;
  }

  const latency_ms = Date.now() - t0;
  await writeAudit({
    job_type: opts.job_type, provider: "google_generative_language",
    model_used: rawModel, status: "error",
    error_message: `HTTP ${lastStatus}: ${String(lastErr).slice(0, 280)}`,
    latency_ms,
    key_source: lastKeySource ?? pool[0]?.source ?? null,
    target_type: opts.target_type ?? null, target_id: opts.target_id ?? null,
    source_hash: opts.source_hash ?? null, prompt_version: opts.prompt_version ?? null,
    meta: { key_source: lastKeySource ?? pool[0]?.source ?? null },
  });
  return {
    ok: false, status: lastStatus, data: lastJson, model_used: rawModel,
    input_tokens: 0, output_tokens: 0, error: lastErr,
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
  const model = normalizeModel(opts.model);
  assertModelAllowed(model);
  const pool = getKeyPool({ preferTier1: opts.preferTier1 });
  if (pool.length === 0) {
    await writeAudit({
      job_type: opts.job_type, provider: "google_generative_language",
      model_used: model, status: "error", error_message: "no_gemini_key",
      target_type: opts.target_type ?? null, target_id: opts.target_id ?? null,
      meta: { key_source: null },
    });
    return { ok: false, model_used: model, input_tokens: 0, output_tokens: 0, status: 0, error: "no_gemini_key" };
  }

  const reqBody = {
    contents: [{ role: "user", parts: [{ text: opts.prompt }] }],
    tools: [{ functionDeclarations: [opts.tool] }],
    toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [opts.tool.name] } },
  };

  let lastStatus = 0;
  let lastErr = "";
  let lastKeySource: KeySource | null = null;
  const t0 = Date.now();

  for (const entry of pool) {
    let res: Response;
    let json: any = null;
    try {
      res = await fetch(`${NATIVE_URL(model)}?key=${entry.key}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });
      try { json = await res.json(); } catch { /* */ }
    } catch (e) {
      lastErr = `network: ${String(e).slice(0, 200)}`;
      lastKeySource = entry.source;
      continue;
    }

    lastKeySource = entry.source;
    if (res.ok) {
      const fc = json?.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall)?.functionCall;
      const usage = json?.usageMetadata || {};
      const inTok = Number(usage.promptTokenCount || 0);
      const outTok = Number(usage.candidatesTokenCount || 0);
      const cost = (opts.costFn ?? defaultCostFn)(model, inTok, outTok);
      const latency_ms = Date.now() - t0;
      await writeAudit({
        job_type: opts.job_type, provider: "google_generative_language",
        model_used: model, status: "ok",
        input_tokens: inTok, output_tokens: outTok,
        estimated_cost_usd: cost,
        latency_ms,
        key_source: entry.source,
        confidence: opts.confidence ?? null,
        target_type: opts.target_type ?? null, target_id: opts.target_id ?? null,
        meta: { key_source: entry.source },
      });
      return {
        ok: true, args: fc?.args, model_used: model, key_source: entry.source,
        input_tokens: inTok, output_tokens: outTok, cost_usd: cost, status: res.status,
      };
    }

    lastStatus = res.status;
    lastErr = json?.error?.message || `HTTP ${res.status}`;
    if (res.status === 429 || res.status === 503 || res.status === 500) continue;
    break;
  }

  const latency_ms = Date.now() - t0;
  await writeAudit({
    job_type: opts.job_type, provider: "google_generative_language",
    model_used: model, status: "error",
    error_message: `HTTP ${lastStatus}: ${String(lastErr).slice(0, 280)}`,
    latency_ms,
    key_source: lastKeySource ?? pool[0]?.source ?? null,
    target_type: opts.target_type ?? null, target_id: opts.target_id ?? null,
    meta: { key_source: lastKeySource ?? pool[0]?.source ?? null },
  });
  return { ok: false, model_used: model, input_tokens: 0, output_tokens: 0, status: lastStatus, error: lastErr };
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
  if (/\b(undefined|null|\[object Object\])\b/i.test(t)) return "input_contains_placeholder";
  const stripped = t.replace(/https?:\/\/\S+/g, "").replace(/@[\w.-]+/g, "").replace(/\s+/g, " ").trim();
  if (stripped.length < minChars * 0.4) return "input_boilerplate_only";
  return null;
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
