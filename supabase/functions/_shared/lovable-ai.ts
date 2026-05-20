// Shared Lovable AI Gateway helper with model-policy guard + audit logging.
// Policy doc: app_settings.lovable_ai_model_policy (single source of truth).
//
// Hard rules:
//   - No Gemini 2.5 Pro / 3.x Pro / GPT-5 Pro on batch backlog.
//   - No silent fallback to a more expensive model.
//   - If requested model is blocked or unavailable -> THROW (caller handles).
//
// All callers should go through callLovableAI() so audit + blocklist apply.

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Hard blocklist (case-insensitive substring match).
const HARD_BLOCKLIST = [
  "-pro",         // gemini-*-pro, gpt-5-pro, gpt-5.4-pro, gpt-5.5-pro
  "gpt-5-pro",
  "gemini-3-pro",
  "gemini-3.1-pro",
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
    throw new Error(`Lovable AI: model "${model}" is blocked by batch policy (no Pro on backlog).`);
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
  status?: "ok" | "error" | "low_conf_retry" | "blocked";
  error_message?: string | null;
  target_type?: string | null;
  target_id?: string | null;
  meta?: Record<string, unknown>;
}

// Fire-and-forget audit insert. Never throws.
export async function recordAiCall(row: AuditRow): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/ai_call_audit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        provider: "lovable_ai",
        status: "ok",
        meta: {},
        ...row,
      }),
    });
  } catch {
    // swallow
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

export async function callLovableAI(opts: CallOpts): Promise<CallResult> {
  assertModelAllowed(opts.model);
  if (opts.retry_model) assertModelAllowed(opts.retry_model);
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

  const { res, json } = await rawCall(opts.model, body);
  const usage = json?.usage || {};
  const inTok = usage.prompt_tokens ?? usage.input_tokens ?? 0;
  const outTok = usage.completion_tokens ?? usage.output_tokens ?? 0;

  if (!res.ok) {
    // 429 or 402 etc — DO NOT silently fall back to a more expensive model.
    await recordAiCall({
      job_type: opts.job_type, model_used: opts.model, status: "error",
      input_tokens: inTok, output_tokens: outTok,
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
    input_tokens: inTok, output_tokens: outTok,
    target_type: opts.target_type, target_id: opts.target_id,
    source_hash: opts.source_hash, prompt_version: opts.prompt_version,
  });

  return {
    ok: true, status: res.status, data: json,
    model_used: opts.model, input_tokens: inTok, output_tokens: outTok,
  };
}
