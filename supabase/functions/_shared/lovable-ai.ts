// deno-lint-ignore-file no-explicit-any
declare const Deno: { env: { get(key: string): string | undefined } };
// Shared Lovable AI Gateway helper with model-policy guard + audit logging.
// Policy doc: app_settings.lovable_ai_model_policy (single source of truth).
//
// Hard rules:
//   - No Gemini 2.5 Pro / 3.x Pro / GPT-5 Pro on batch backlog.
//   - No silent fallback to a more expensive model.
//   - If requested model is blocked or unavailable -> THROW (caller handles).
//
// All callers should go through callLovableAI() so audit + blocklist apply.

import { chatTokenCostUsd, embeddingTokenCostUsd, normalizeAiModel, geminiOutputTokens, geminiInputTokens } from "./ai-pricing.ts";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const EMBEDDINGS_URL = "https://ai.gateway.lovable.dev/v1/embeddings";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Hard blocklist (case-insensitive substring match).
// 2026-05-20: block ALL Pro variants and ALL Gemini 3.x on Gateway batch usage.
const HARD_BLOCKLIST = [
  "-pro",            // gemini-*-pro, gpt-5-pro, gpt-5.4-pro, gpt-5.5-pro
  "gpt-5-pro",
  "gemini-3",        // gemini-3-flash-preview, gemini-3.1-*, gemini-3.5-*, etc.
  "gemini-2.5-pro",
];

export function isModelBlocked(model: string): boolean {
  const m = (model || "").toLowerCase();
  return HARD_BLOCKLIST.some((b) => m.includes(b));
}

export function assertModelAllowed(model: string) {
  if (!model || typeof model !== "string") {
    throw new Error(`Lovable AI: empty model not allowed`);
  }
  if (isModelBlocked(model)) {
    throw new Error(`Lovable AI: model "${model}" is blocked by batch policy (no Pro / no Gemini 3 on backlog).`);
  }
}


export interface AuditRow {
  job_type: string;
  provider?: "lovable_ai" | "google_direct";
  model_used: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  estimated_cost_usd?: number | null;
  prompt_version?: string | null;
  source_hash?: string | null;
  confidence?: number | null;
  status?: "ok" | "error" | "low_conf_retry" | "blocked" | "skipped";
  error_message?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  latency_ms?: number | null;
  key_source?: string | null;
  meta?: Record<string, unknown>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function normalizeAuditPayload(row: AuditRow): Record<string, unknown> {
  const payload: Record<string, unknown> = { provider: "lovable_ai", status: "ok", meta: {}, key_source: "gateway", ...row };
  const meta = { ...((payload.meta && typeof payload.meta === "object" && !Array.isArray(payload.meta)) ? payload.meta as Record<string, unknown> : {}) };
  const rawTargetId = typeof payload.target_id === "string" ? payload.target_id.trim() : payload.target_id;
  if (rawTargetId == null || rawTargetId === "") payload.target_id = null;
  else if (typeof rawTargetId === "string" && UUID_RE.test(rawTargetId)) payload.target_id = rawTargetId;
  else {
    payload.target_id = null;
    const raw = String(rawTargetId);
    if (String(payload.target_type || "").includes("slug") || /^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(raw)) meta.target_slug = raw;
    else meta.target_ref = raw;
  }
  payload.target_type = payload.target_type ?? null;
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

// Fail-closed audit insert. Throws on failure so runners stop after a paid call.
export async function recordAiCall(row: AuditRow): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("audit_insert_failed: missing_env");
  const payload = normalizeAuditPayload(row);
  try {
    if (payload.estimated_cost_usd == null && payload.input_tokens != null && payload.output_tokens != null) {
      payload.estimated_cost_usd = chatTokenCostUsd(
        normalizeAiModel(String(payload.model_used || "")),
        Number(payload.input_tokens || 0),
        Number(payload.output_tokens || 0),
      );
    }
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
      console.error("[lovable-ai audit] insert failed", JSON.stringify({ status: res.status, body: text.slice(0, 300), payload_shape: auditPayloadShape(payload) }));
      throw new Error(`audit_insert_failed: HTTP ${res.status}`);
    }
  } catch (e) {
    if (!String(e).includes("audit_insert_failed")) {
      console.error("[lovable-ai audit] insert threw", JSON.stringify({ error: String(e).slice(0, 200), payload_shape: auditPayloadShape(payload) }));
    }
    throw e;
  }
}


export interface CallOpts {
  model: string;
  messages: any[];
  tools?: any[];
  tool_choice?: any;
  max_tokens?: number;
  temperature?: number;
  response_format?: any;
  // audit context
  job_type: string;
  target_type?: string;
  target_id?: string;
  source_hash?: string;
  prompt_version?: string;
  // spend guard. By default we validate user-message content before any paid call.
  input_text?: string;
  min_input_chars?: number;
  skip_input_validation?: boolean;
  // Optional one-shot retry on parse-error / low-confidence.
  retry_model?: string;
}

export interface CallResult {
  ok: boolean;
  status: number;
  data: any;
  model_used: string;
  input_tokens?: number;
  output_tokens?: number;
  error?: string;
}

export interface EmbeddingCallOpts {
  model: string;
  input: string;
  dimensions?: number;
  job_type: string;
  target_type?: string;
  target_id?: string;
  source_hash?: string;
  prompt_version?: string;
  min_input_chars?: number;
}

export interface EmbeddingCallResult {
  ok: boolean;
  status: number;
  embedding: number[] | null;
  model_used: string;
  input_tokens?: number;
  cost_usd?: number;
  error?: string;
}

async function rawCall(model: string, body: Record<string, unknown>) {
  const res = await fetch(GATEWAY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...body, model }),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* */ }
  return { res, json };
}

async function rawEmbeddingCall(body: Record<string, unknown>) {
  const res = await fetch(EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${LOVABLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* */ }
  return { res, json };
}

export async function callLovableEmbedding(opts: EmbeddingCallOpts): Promise<EmbeddingCallResult> {
  assertModelAllowed(opts.model);
  const skipReason = validateAiInput(opts.input, { minChars: opts.min_input_chars ?? 40 });
  if (skipReason) {
    await recordAiCall({
      job_type: opts.job_type,
      model_used: opts.model,
      status: "skipped",
      estimated_cost_usd: 0,
      error_message: skipReason,
      target_type: opts.target_type,
      target_id: opts.target_id,
      source_hash: opts.source_hash,
      prompt_version: opts.prompt_version,
      key_source: "none",
      meta: { skipped_reason: skipReason, key_source: "none", guard: "embedding_preflight_input" },
    });
    return { ok: false, status: 0, embedding: null, model_used: opts.model, input_tokens: 0, cost_usd: 0, error: skipReason };
  }
  if (!LOVABLE_API_KEY) {
    await recordAiCall({
      job_type: opts.job_type,
      model_used: opts.model,
      status: "error",
      error_message: "LOVABLE_API_KEY missing",
      target_type: opts.target_type,
      target_id: opts.target_id,
      source_hash: opts.source_hash,
      prompt_version: opts.prompt_version,
    });
    return { ok: false, status: 0, embedding: null, model_used: opts.model, error: "LOVABLE_API_KEY missing" };
  }

  const t0 = Date.now();
  const { res, json } = await rawEmbeddingCall({
    model: opts.model,
    input: opts.input,
    dimensions: opts.dimensions,
  });
  const latency_ms = Date.now() - t0;
  const usage = json?.usage || {};
  const inputTokens = Number(usage.prompt_tokens || usage.input_tokens || Math.ceil(opts.input.length / 4));
  const cost = embeddingTokenCostUsd(opts.model, inputTokens);

  if (!res.ok) {
    await recordAiCall({
      job_type: opts.job_type,
      model_used: opts.model,
      status: "error",
      input_tokens: inputTokens,
      output_tokens: 0,
      estimated_cost_usd: 0,
      latency_ms,
      error_message: `HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`,
      target_type: opts.target_type,
      target_id: opts.target_id,
      source_hash: opts.source_hash,
      prompt_version: opts.prompt_version,
    });
    return { ok: false, status: res.status, embedding: null, model_used: opts.model, input_tokens: inputTokens, cost_usd: 0, error: json?.error?.message || `HTTP ${res.status}` };
  }

  const embedding = json?.data?.[0]?.embedding;
  const ok = Array.isArray(embedding) && embedding.length > 0;
  await recordAiCall({
    job_type: opts.job_type,
    model_used: opts.model,
    status: ok ? "ok" : "error",
    input_tokens: inputTokens,
    output_tokens: 0,
    estimated_cost_usd: cost,
    latency_ms,
    error_message: ok ? null : "embedding_missing",
    target_type: opts.target_type,
    target_id: opts.target_id,
    source_hash: opts.source_hash,
    prompt_version: opts.prompt_version,
  });

  return {
    ok,
    status: res.status,
    embedding: ok ? embedding : null,
    model_used: opts.model,
    input_tokens: inputTokens,
    cost_usd: cost,
    error: ok ? undefined : "embedding_missing",
  };
}

export async function callLovableAI(opts: CallOpts): Promise<CallResult> {
  assertModelAllowed(opts.model);
  if (opts.retry_model) assertModelAllowed(opts.retry_model);
  if (!opts.skip_input_validation) {
    const inputText = opts.input_text ?? extractUsefulTextFromMessages(opts.messages);
    const skipReason = validateAiInput(inputText, { minChars: opts.min_input_chars ?? 40 });
    if (skipReason) {
      await recordAiCall({
        job_type: opts.job_type, model_used: opts.model, status: "skipped",
        estimated_cost_usd: 0,
        error_message: skipReason,
        target_type: opts.target_type, target_id: opts.target_id,
        source_hash: opts.source_hash, prompt_version: opts.prompt_version,
        key_source: "none",
        meta: { skipped_reason: skipReason, key_source: "none", guard: "preflight_input" },
      });
      return {
        ok: false,
        status: 0,
        data: null,
        model_used: opts.model,
        input_tokens: 0,
        output_tokens: 0,
        error: skipReason,
      };
    }
  }
  if (!LOVABLE_API_KEY) {
    await recordAiCall({
      job_type: opts.job_type, model_used: opts.model, status: "error",
      error_message: "LOVABLE_API_KEY missing",
      target_type: opts.target_type, target_id: opts.target_id,
      source_hash: opts.source_hash, prompt_version: opts.prompt_version,
    });
    return { ok: false, status: 0, data: null, model_used: opts.model, error: "LOVABLE_API_KEY missing" };
  }

  const body: Record<string, unknown> = {
    messages: opts.messages,
  };
  if (opts.tools) body.tools = opts.tools;
  if (opts.tool_choice) body.tool_choice = opts.tool_choice;
  if (opts.max_tokens) body.max_tokens = opts.max_tokens;
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  if (opts.response_format) body.response_format = opts.response_format;

  const t0 = Date.now();
  const { res, json } = await rawCall(opts.model, body);
  const latency_ms = Date.now() - t0;
  const usage = json?.usage || {};
  const inTok = geminiInputTokens(usage);
  const outTok = geminiOutputTokens(usage);

  if (!res.ok) {
    // 429 or 402 etc — DO NOT silently fall back to a more expensive model.
    await recordAiCall({
      job_type: opts.job_type, model_used: opts.model, status: "error",
      input_tokens: inTok, output_tokens: outTok, latency_ms,
      error_message: `HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`,
      target_type: opts.target_type, target_id: opts.target_id,
      source_hash: opts.source_hash, prompt_version: opts.prompt_version,
    });
    return {
      ok: false, status: res.status, data: json,
      model_used: opts.model, input_tokens: inTok, output_tokens: outTok,
      error: json?.error?.message || `HTTP ${res.status}`,
    };
  }

  await recordAiCall({
    job_type: opts.job_type, model_used: opts.model, status: "ok",
    input_tokens: inTok, output_tokens: outTok, latency_ms,
    target_type: opts.target_type, target_id: opts.target_id,
    source_hash: opts.source_hash, prompt_version: opts.prompt_version,
  });


  return {
    ok: true, status: res.status, data: json,
    model_used: opts.model, input_tokens: inTok, output_tokens: outTok,
  };
}

export function validateAiInput(text: unknown, opts?: { minChars?: number }): string | null {
  const minChars = opts?.minChars ?? 40;
  if (text == null) return "input_null";
  if (typeof text !== "string") return "input_not_string";
  const t = text.trim();
  if (!t) return "input_empty";
  if (t.length < minChars) return "input_too_short";
  if (/\b(undefined|null|\[object Object\])\b/i.test(t)) return "input_contains_placeholder";
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
