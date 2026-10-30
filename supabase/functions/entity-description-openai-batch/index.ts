// Owner-approved OpenAI Batch writer for short organization/person descriptions.
// Hourly cron tick (x-internal-token) or admin JWT. Inputs are public episode facts only.
// Organizations: verified drafts publish via apply_entity_description_draft_v1 (CAS onto empty
// fields + backup; rollback_entity_description_job_v1 undoes). Persons: a capped trial of drafts
// that is never published here. Spend is reserved atomically against owner caps before upload.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { checkProcessingPriority } from "../_shared/processing-priority.ts";
import { DEFAULT_CONTROLS, actualCostUsd, parseOutputLine as _unused } from "../_shared/person-relevance-openai-batch.ts";
import {
  buildCustomId, buildDescriptionLine, DESCRIPTION_PROMPT_VERSION, lineCostUpperBoundUsd, verifyDescription,
  type EntitySource, type Kind,
} from "../_shared/entity-description.ts";

void _unused;
const OPENAI = "https://api.openai.com/v1";
const CONTROLS_KEY = "entity_description_openai_batch_controls";
const JOB = "entity-description-openai-batch";
const OPEN = ["claimed", "uploading", "submitted", "validating", "in_progress", "finalizing", "cancelling", "ingesting"];
const TERMINAL = new Set(["completed", "failed", "expired", "cancelled"]);
const STALE_MS = 30 * 60_000;
const INGEST_PER_CALL = 700;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: corsHeaders });

type Controls = {
  enabled: boolean; model: string; reasoning_effort: string; max_output_tokens: number; total_cap_usd: number; daily_cap_usd: number;
  org_job_size: number; person_trial_limit: number; max_open_jobs: number; auto_apply_kinds: string[]; authorized?: unknown;
};

async function loadControls(db: any): Promise<Controls> {
  const { data, error } = await db.from("app_settings").select("value").eq("key", CONTROLS_KEY).maybeSingle();
  if (error) throw new Error("controls_unavailable");
  const v = data?.value || {};
  return {
    enabled: v.enabled === true && !!v.authorized, model: String(v.model || "gpt-6-luna"), reasoning_effort: String(v.reasoning_effort || "low"),
    max_output_tokens: Number(v.max_output_tokens) || 900, total_cap_usd: Number(v.total_cap_usd) || 0, daily_cap_usd: Number(v.daily_cap_usd) || 0,
    org_job_size: Math.min(1000, Number(v.org_job_size) || 600), person_trial_limit: Number(v.person_trial_limit) || 0,
    max_open_jobs: Math.max(1, Number(v.max_open_jobs) || 1), auto_apply_kinds: Array.isArray(v.auto_apply_kinds) ? v.auto_apply_kinds : [],
    authorized: v.authorized,
  };
}

// Re-read before writing so a concurrent owner change is never overwritten.
async function pauseControls(db: any, reason: string) {
  const { data } = await db.from("app_settings").select("value").eq("key", CONTROLS_KEY).maybeSingle();
  if (!data?.value || data.value.enabled !== true) return;
  await db.from("app_settings").update({ value: { ...data.value, enabled: false, paused_reason: reason, paused_at: new Date().toISOString() }, updated_at: new Date().toISOString() })
    .eq("key", CONTROLS_KEY);
}

async function authorized(db: any, req: Request, body: any): Promise<boolean> {
  const internal = req.headers.get("x-internal-token");
  if (internal) {
    const { data } = await db.from("internal_job_tokens").select("token").eq("job", JOB).maybeSingle();
    return !!data?.token && data.token === internal && body.action === "tick";
  }
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const { data } = await db.auth.getUser(token);
  if (!data?.user?.id) return false;
  const { data: role } = await db.from("user_roles").select("role").eq("user_id", data.user.id).eq("role", "admin").maybeSingle();
  return !!role;
}

async function backgroundEnabled(db: any) {
  const { data } = await db.from("app_settings").select("value").eq("key", "background_jobs").maybeSingle();
  return !!data?.value && data.value.enabled !== false && data.value.incident_mode !== true;
}

async function openai(path: string, init: RequestInit = {}) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return { ok: false, status: 0, data: null as any, res: null as Response | null, error: "openai_api_key_missing" };
  const res = await fetch(OPENAI + path, { ...init, headers: { Authorization: `Bearer ${key}`, ...(init.headers || {}) } });
  if (path.includes("/content")) return { ok: res.ok, status: res.status, data: null as any, res, error: res.ok ? null : `http_${res.status}` };
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* non-json */ }
  return { ok: res.ok, status: res.status, data, res: null, error: res.ok ? null : String(data?.error?.code || data?.error?.type || `http_${res.status}`).slice(0, 120) };
}

async function onOpenAIFailure(db: any, status: number, error: string | null) {
  if (status === 401 || status === 403 || /insufficient_quota|billing|credit/i.test(error || "")) await pauseControls(db, `openai_denied_${status}:${error || ""}`.slice(0, 120));
}

async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function* streamLines(res: Response) {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) yield line; }
  }
  if (buf.trim()) yield buf.trim();
}

// Same Responses-API envelope as the person batch, without its decision-shape check.
function parseLine(line: string): { custom_id: string; ok: boolean; raw?: unknown; error?: string; usage: any } | null {
  let row: any;
  try { row = JSON.parse(line); } catch { return null; }
  const custom_id = typeof row?.custom_id === "string" ? row.custom_id : "";
  if (!custom_id) return null;
  if (row.error) return { custom_id, ok: false, error: String(row.error.code || "error").slice(0, 120), usage: null };
  const body = row.response?.body;
  const usage = body?.usage || null;
  if (Number(row.response?.status_code) !== 200) return { custom_id, ok: false, error: `http_${row.response?.status_code}`, usage };
  if (body?.status && body.status !== "completed") return { custom_id, ok: false, error: String(body.incomplete_details?.reason || body.status), usage };
  const parts = (Array.isArray(body?.output) ? body.output : []).filter((o: any) => o?.type === "message").flatMap((o: any) => o.content || []);
  if (parts.some((c: any) => c?.type === "refusal")) return { custom_id, ok: false, error: "refusal", usage };
  const text = parts.filter((c: any) => c?.type === "output_text").map((c: any) => String(c.text || "")).join("");
  try { return { custom_id, ok: true, raw: JSON.parse(text), usage }; } catch { return { custom_id, ok: false, error: "invalid_json", usage }; }
}

async function submit(db: any, c: Controls, kind: Kind, limit: number) {
  const { data: job, error } = await db.from("entity_description_jobs").insert({ kind, model: c.model, prompt_version: DESCRIPTION_PROMPT_VERSION }).select("id").single();
  if (error || !job) return { kind, submitted: false, error: "job_create_failed" };
  const abort = async (reason: string) => {
    await db.from("entity_description_drafts").update({ status: "released", reject_reason: reason.slice(0, 120), updated_at: new Date().toISOString() })
      .eq("job_id", job.id).eq("status", "submitted");
    await db.from("entity_description_jobs").update({ status: "aborted", reserved_cost_usd: 0, last_error: reason.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", job.id);
    return { kind, submitted: false, job_id: job.id, error: reason };
  };
  try {
    const { data: sources, error: srcErr } = await db.rpc("entity_description_sources_v1", { _kind: kind, _limit: limit });
    if (srcErr) return await abort("sources_failed:" + srcErr.message);
    const pricing = DEFAULT_CONTROLS.pricing_usd_per_1m[c.model];
    const lines: any[] = [], rows: any[] = [];
    let reserve = 0;
    for (const s of (sources || []) as EntitySource[]) {
      const customId = buildCustomId(kind, s.entity_id, Number(s.attempt) || 1);
      const base = { job_id: job.id, entity_kind: kind, entity_id: s.entity_id, custom_id: customId, attempt: Number(s.attempt) || 1,
        source_hash: await sha256(JSON.stringify(s.episodes)), source: s };
      // Nothing public to ground a description on: record it so the entity is not offered again.
      if (!s.episodes?.length) { rows.push({ ...base, status: "rejected", reject_reason: "no_public_sources" }); continue; }
      const line = buildDescriptionLine(customId, kind, s, c.model, c.max_output_tokens, c.reasoning_effort);
      reserve += lineCostUpperBoundUsd(line, pricing, DEFAULT_CONTROLS.batch_discount);
      lines.push(line); rows.push({ ...base, status: "submitted" });
    }
    for (let i = 0; i < rows.length; i += 200) {
      const ins = await db.from("entity_description_drafts").insert(rows.slice(i, i + 200));
      if (ins.error) return await abort("draft_insert_failed:" + ins.error.message);
    }
    if (!lines.length) {
      await db.from("entity_description_jobs").update({ status: "ingested", ingested_at: new Date().toISOString(), actual_cost_usd: 0, updated_at: new Date().toISOString() }).eq("id", job.id);
      return { kind, submitted: false, job_id: job.id, reason: "no_candidates", skipped: rows.length };
    }
    if (!Number.isFinite(reserve)) return await abort("pricing_missing");
    const res = await db.rpc("reserve_entity_description_cost_v1", { _job: job.id, _amount: Math.ceil(reserve * 1e6) / 1e6, _requests: lines.length });
    if (res.error) return await abort("reservation_refused:" + res.error.message);
    const form = new FormData();
    form.append("purpose", "batch");
    form.append("file", new Blob([lines.map((l) => JSON.stringify(l)).join("\n") + "\n"], { type: "application/jsonl" }), `${job.id}.jsonl`);
    const file = await openai("/files", { method: "POST", body: form });
    if (!file.ok || !file.data?.id) { await onOpenAIFailure(db, file.status, file.error); return await abort("file_upload_failed:" + file.error); }
    await db.from("entity_description_jobs").update({ openai_input_file_id: file.data.id }).eq("id", job.id);
    const batch = await openai("/batches", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input_file_id: file.data.id, endpoint: "/v1/responses", completion_window: "24h", metadata: { job_id: job.id, kind } }) });
    if (!batch.ok || !batch.data?.id) { await onOpenAIFailure(db, batch.status, batch.error); return await abort("batch_create_failed:" + batch.error); }
    await db.from("entity_description_jobs").update({ status: "submitted", openai_batch_id: batch.data.id, submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
    return { kind, submitted: true, job_id: job.id, requests: lines.length, reserved_usd: reserve };
  } catch (e) {
    return await abort("submit_error:" + String(e).slice(0, 200));
  }
}

async function ingest(db: any, c: Controls, job: any) {
  const { data: drafts } = await db.from("entity_description_drafts").select("id,custom_id,status,source").eq("job_id", job.id).limit(2000);
  const byId = new Map<string, any>((drafts || []).map((d: any) => [d.custom_id, d]));
  const pricing = DEFAULT_CONTROLS.pricing_usd_per_1m[job.model];
  const autoApply = c.auto_apply_kinds.includes(job.kind);
  let processed = 0, verified = 0, applied = 0, rejected = 0, failed = 0, more = false;
  for (const fileId of [job.openai_output_file_id, job.openai_error_file_id].filter(Boolean)) {
    const content = await openai(`/files/${fileId}/content`);
    if (!content.ok || !content.res) { await onOpenAIFailure(db, content.status, content.error); return { ok: false, error: "download_failed" }; }
    for await (const raw of streamLines(content.res)) {
      const p = parseLine(raw);
      const d = p && byId.get(p.custom_id);
      if (!p || !d || d.status !== "submitted") continue;
      if (processed >= INGEST_PER_CALL) { more = true; continue; }
      processed++;
      const usage = { input_tokens: p.usage?.input_tokens ?? null, output_tokens: p.usage?.output_tokens ?? null,
        cost_usd: actualCostUsd(p.usage, pricing, DEFAULT_CONTROLS.batch_discount), updated_at: new Date().toISOString() };
      if (!p.ok) { failed++; await db.from("entity_description_drafts").update({ ...usage, status: "failed", reject_reason: p.error }).eq("id", d.id); continue; }
      const v = verifyDescription(p.raw, job.kind, d.source);
      if (!v.ok) { rejected++; await db.from("entity_description_drafts").update({ ...usage, status: "rejected", reject_reason: v.reason, evidence: (p.raw as any)?.evidence ?? null, description_hu: String((p.raw as any)?.description_hu || "").slice(0, 600) || null }).eq("id", d.id); continue; }
      verified++;
      await db.from("entity_description_drafts").update({ ...usage, status: "verified", description_hu: v.description, evidence: v.evidence, confidence: v.confidence }).eq("id", d.id);
      if (autoApply) {
        const r = await db.rpc("apply_entity_description_draft_v1", { _draft: d.id });
        if (!r.error && r.data === "applied") applied++;
      }
    }
  }
  if (more) {
    await db.from("entity_description_jobs").update({ status: "ingesting", updated_at: new Date().toISOString() }).eq("id", job.id);
    return { ok: true, partial: true, processed, verified, applied, rejected, failed };
  }
  // Requests without any result line (expiry/cancel) are released for one retry, never guessed.
  await db.from("entity_description_drafts").update({ status: "released", reject_reason: "no_result_line", updated_at: new Date().toISOString() }).eq("job_id", job.id).eq("status", "submitted");
  const { data: costs } = await db.from("entity_description_drafts").select("cost_usd,status").eq("job_id", job.id);
  const actual = (costs || []).reduce((n: number, r: any) => n + (Number(r.cost_usd) || 0), 0);
  const sent = (costs || []).filter((r: any) => r.status !== "rejected" || r.cost_usd != null).length || 1;
  const bad = (costs || []).filter((r: any) => r.status === "failed").length;
  await db.from("entity_description_jobs").update({ status: "ingested", actual_cost_usd: actual, reserved_cost_usd: actual, ingested_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    meta: { ...(job.meta || {}), failure_rate: bad / sent } }).eq("id", job.id);
  if (actual > 0) await db.rpc("add_ai_spend", { p_day: new Date().toISOString().slice(0, 10), p_kind: "entity_description_openai", p_amount: actual, p_calls: sent });
  if (bad / sent > 0.2) await pauseControls(db, `high_failure_rate_${Math.round((bad / sent) * 100)}pct`);
  return { ok: true, partial: false, processed, verified, applied, rejected, failed, actual_cost_usd: actual };
}

async function poll(db: any, c: Controls) {
  const { data: jobs } = await db.from("entity_description_jobs").select("*").not("openai_batch_id", "is", null).is("ingested_at", null)
    .not("status", "in", "(aborted,ingested)").order("created_at").limit(3);
  const out: any[] = [];
  for (const job of jobs || []) {
    const token = crypto.randomUUID();
    const lease = await db.from("entity_description_jobs").update({ lease_token: token, lease_until: new Date(Date.now() + 10 * 60e3).toISOString() })
      .eq("id", job.id).or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`).select("id");
    if (!lease.data?.length) continue;
    try {
      const b = await openai(`/batches/${job.openai_batch_id}`);
      if (!b.ok) { await onOpenAIFailure(db, b.status, b.error); out.push({ job_id: job.id, error: b.error }); continue; }
      const patch: any = { openai_output_file_id: b.data.output_file_id || null, openai_error_file_id: b.data.error_file_id || null, updated_at: new Date().toISOString() };
      if (job.status !== "ingesting" && typeof b.data.status === "string") patch.status = b.data.status;
      if (TERMINAL.has(b.data.status)) patch.completed_at = new Date().toISOString();
      if (b.data.errors?.data?.length) patch.last_error = JSON.stringify(b.data.errors.data.slice(0, 3)).slice(0, 500);
      await db.from("entity_description_jobs").update(patch).eq("id", job.id);
      if (!TERMINAL.has(b.data.status)) { out.push({ job_id: job.id, status: b.data.status, counts: b.data.request_counts }); continue; }
      if (!patch.openai_output_file_id && !patch.openai_error_file_id) {
        await db.from("entity_description_drafts").update({ status: "released", reject_reason: "batch_" + b.data.status }).eq("job_id", job.id).eq("status", "submitted");
        await db.from("entity_description_jobs").update({ status: "ingested", reserved_cost_usd: 0, actual_cost_usd: 0, ingested_at: new Date().toISOString() }).eq("id", job.id);
        out.push({ job_id: job.id, status: b.data.status, ingested: 0 });
      } else out.push({ job_id: job.id, status: b.data.status, ingested: await ingest(db, c, { ...job, ...patch }) });
    } finally {
      await db.from("entity_description_jobs").update({ lease_until: null, lease_token: null }).eq("id", job.id).eq("lease_token", token);
    }
  }
  return out;
}

async function tick(db: any) {
  let c = await loadControls(db);
  const polled = await poll(db, c);
  // Killed mid-submit before anything reached OpenAI: free the slot (nothing billed).
  const { data: stale } = await db.from("entity_description_jobs").select("id,status,created_at").in("status", ["claimed", "uploading"]).is("openai_input_file_id", null);
  for (const j of stale || []) {
    if (Date.now() - Date.parse(j.created_at) < STALE_MS) continue;
    await db.from("entity_description_drafts").update({ status: "released", reject_reason: "stale_submit" }).eq("job_id", j.id).eq("status", "submitted");
    await db.from("entity_description_jobs").update({ status: "aborted", reserved_cost_usd: 0, last_error: "stale_submit" }).eq("id", j.id).eq("status", j.status).is("openai_input_file_id", null);
  }
  c = await loadControls(db);
  if (!c.enabled) return { ok: true, polled, submitted: [], reason: "controls_disabled" };
  if (!Deno.env.get("OPENAI_API_KEY")) return { ok: true, polled, reason: "openai_api_key_missing" };
  if (!(await backgroundEnabled(db))) return { ok: true, polled, reason: "background_jobs_disabled" };
  const priority = await checkProcessingPriority(db, "entity_description_openai_batch");
  if (priority) return { ok: true, polled, reason: priority };
  const { data: open } = await db.from("entity_description_jobs").select("kind").in("status", OPEN);
  const openKinds = new Set((open || []).map((j: any) => j.kind));
  let openCount = (open || []).length;
  const submitted: any[] = [];
  const { count: personDrafts } = await db.from("entity_description_drafts").select("id", { count: "exact", head: true }).eq("entity_kind", "person").neq("status", "released");
  const personLeft = Math.max(0, c.person_trial_limit - (personDrafts || 0));
  const plan: [Kind, number][] = [["person", Math.min(personLeft, 200)], ["organization", c.org_job_size]];
  let nothingLeft = true;
  for (const [kind, limit] of plan) {
    if (limit < 1) continue;
    if (openKinds.has(kind)) { nothingLeft = false; continue; }
    if (openCount >= c.max_open_jobs) { nothingLeft = false; break; }
    const r = await submit(db, c, kind, limit);
    submitted.push(r);
    if (r.submitted) { openCount++; nothingLeft = false; }
    else if (r.reason !== "no_candidates") nothingLeft = false;
  }
  // Done: every candidate drafted and nothing open → switch off so the hourly cron unschedules itself.
  if (nothingLeft && openCount === 0) await pauseControls(db, "completed");
  return { ok: true, polled, submitted };
}

async function status(db: any) {
  const { data: jobs } = await db.from("entity_description_jobs").select("id,kind,status,request_count,reserved_cost_usd,actual_cost_usd,last_error,created_at,ingested_at")
    .order("created_at", { ascending: false }).limit(20);
  const counts: Record<string, number> = {};
  const { data: drafts } = await db.from("entity_description_drafts").select("entity_kind,status").limit(10000);
  for (const d of drafts || []) counts[`${d.entity_kind}:${d.status}`] = (counts[`${d.entity_kind}:${d.status}`] || 0) + 1;
  return { ok: true, controls: await loadControls(db), jobs, counts };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    let body: any = {};
    try { body = await req.clone().json(); } catch { /* empty */ }
    if (!(await authorized(db, req, body))) return json({ ok: false, error: "forbidden" }, 403);
    switch (body.action || "status") {
      case "tick": return json(await tick(db));
      case "status": return json(await status(db));
      case "rollback": {
        if (!/^[0-9a-f-]{36}$/i.test(body.job_id || "") || body.confirm !== "ROLLBACK") return json({ ok: false, error: "job_id_and_confirm_required" }, 400);
        const r = await db.rpc("rollback_entity_description_job_v1", { _job: body.job_id });
        return json({ ok: !r.error, restored: r.data, error: r.error?.message });
      }
      default: return json({ ok: false, error: "unknown_action" }, 400);
    }
  } catch (e) {
    console.error(JOB, String(e).slice(0, 300));
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
