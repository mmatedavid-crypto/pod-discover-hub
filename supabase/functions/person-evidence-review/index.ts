import { denyUntrustedCaller } from "../_shared/internal-auth.ts";
// Shadow pilot for evidence-pack person review. Builds targeted evidence packs, submits them to
// OpenAI Batch under the central budget guard, ingests and validates the answers and records the
// quality gate. It NEVER writes person_episode_mentions: results stay shadow-only.
// Actions: tick (cron) | prepare | submit | status | sample (admin) | label (admin) | evaluate.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { actualCostUsd } from "../_shared/person-relevance-openai-batch.ts";
import {
  buildEvidenceRequest, buildPack, evaluateGate, EVIDENCE_POLICY_VERSION, goldenToReference, packFingerprint, parseResponseLine,
  PRICING, BATCH_DISCOUNT, requestUpperBoundUsd, validateEvidenceDecision, type EvidenceSource, type Pack, type Reference,
} from "../_shared/person-evidence.ts";

const OPENAI = "https://api.openai.com/v1";
const CONTROLS_KEY = "person_evidence_review_controls";
const OPEN = ["claimed", "uploading", "submitted", "validating", "in_progress", "finalizing", "cancelling", "ingesting"];
const UUID = /^[0-9a-f-]{36}$/i;
const LABELS = ["host", "co_host", "guest", "subject", "mentioned", "credit_only", "not_present", "different_person", "cannot_tell"];
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: corsHeaders });

type Controls = { enabled: boolean; policy_version: string; seed: string; pilot_models: { model: string; subset_rank_max: number | null }[];
  max_output_tokens: number; prepare_per_tick: number; shadow_only: boolean; bulk_enabled: boolean; [k: string]: unknown };

async function loadControls(db: any): Promise<Controls> {
  const { data, error } = await db.from("app_settings").select("value").eq("key", CONTROLS_KEY).maybeSingle();
  if (error || !data?.value) throw new Error("controls_unavailable");
  return { policy_version: EVIDENCE_POLICY_VERSION, max_output_tokens: 900, prepare_per_tick: 40, pilot_models: [], ...data.value };
}
// Re-read before writing so a concurrent owner change is never overwritten.
async function patchControls(db: any, patch: Record<string, unknown>) {
  const { data } = await db.from("app_settings").select("value").eq("key", CONTROLS_KEY).maybeSingle();
  await db.from("app_settings").upsert({ key: CONTROLS_KEY, value: { ...(data?.value || {}), ...patch }, updated_at: new Date().toISOString() }, { onConflict: "key" });
}
async function backgroundEnabled(db: any) {
  const { data } = await db.from("app_settings").select("value").eq("key", "background_jobs").maybeSingle();
  return !!data?.value && data.value.enabled !== false && data.value.incident_mode !== true;
}
async function requireAdmin(db: any, req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  const uid = data?.user?.id;
  if (!uid) return null;
  const { data: role } = await db.from("user_roles").select("role").eq("user_id", uid).eq("role", "admin").maybeSingle();
  return role ? uid : null;
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
// Billing/auth denials stop the pilot (owner must act); transient errors wait for the next tick.
async function stopOnDenial(db: any, status: number, error: string | null) {
  if (status === 401 || status === 402 || status === 403 || /insufficient_quota|billing|credit/i.test(error || "")) {
    await patchControls(db, { enabled: false, paused_reason: `openai_denied_${status}:${error || ""}`.slice(0, 120), paused_at: new Date().toISOString() });
  }
}
async function* streamLines(res: Response) {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) yield l; }
  }
  if (buf.trim()) yield buf.trim();
}

// Builds packs for sampled pairs that have none yet (bounded per call; idempotent by fingerprint).
async function prepareAction(db: any, c: Controls, limit: number) {
  const sel = await db.rpc("person_evidence_pilot_select_v1", { _policy: c.policy_version, _seed: c.seed });
  if (sel.error) throw new Error("sample_select:" + sel.error.message);
  const { data: sample } = await db.from("person_evidence_sample").select("person_id,episode_id,stratum,rank")
    .eq("policy_version", c.policy_version).order("stratum").order("rank").limit(2000);
  const { data: packs } = await db.from("person_evidence_packs").select("person_id,episode_id").eq("policy_version", c.policy_version).limit(5000);
  const have = new Set((packs || []).map((p: any) => `${p.person_id}|${p.episode_id}`));
  const todo = (sample || []).filter((s: any) => !have.has(`${s.person_id}|${s.episode_id}`)).slice(0, Math.max(1, Math.min(80, limit)));
  let built = 0, sendable = 0;
  for (const s of todo) {
    const r = await db.rpc("person_evidence_source_v1", { _person: s.person_id, _episode: s.episode_id });
    if (r.error || !r.data) continue;
    const src = r.data as EvidenceSource;
    const { pack, precheck } = buildPack(src);
    const fingerprint = await packFingerprint(pack);
    const ins = await db.from("person_evidence_packs").upsert({ person_id: s.person_id, episode_id: s.episode_id, policy_version: c.policy_version,
      fingerprint, stratum: s.stratum, identity_risk: !!src.person.identity_risk, precheck, pack }, { onConflict: "person_id,episode_id,policy_version,fingerprint", ignoreDuplicates: true });
    if (!ins.error) { built++; if (!precheck) sendable++; }
  }
  return { sample: sel.data, prepared_now: built, sendable_now: sendable, remaining: Math.max(0, (sample || []).length - have.size - built) };
}

// One Batch job per model over prepared, sendable packs that have no item for that model yet.
async function submitAction(db: any, c: Controls, lane: "evidence_pilot") {
  const out: any[] = [];
  const { data: sample } = await db.from("person_evidence_sample").select("person_id,episode_id,rank").eq("policy_version", c.policy_version).limit(2000);
  const rank = new Map((sample || []).map((s: any) => [`${s.person_id}|${s.episode_id}`, s.rank]));
  const { data: packs } = await db.from("person_evidence_packs").select("id,person_id,episode_id,stratum,pack").eq("policy_version", c.policy_version).is("precheck", null).limit(2000);
  for (const m of c.pilot_models || []) {
    if (!PRICING[m.model]) { out.push({ model: m.model, error: "pricing_missing" }); continue; }
    const { data: open } = await db.from("person_evidence_jobs").select("id").eq("model", m.model).eq("policy_version", c.policy_version).in("status", OPEN);
    if ((open || []).length) { out.push({ model: m.model, skipped: "job_open" }); continue; }
    const { data: existing } = await db.from("person_evidence_items").select("pack_id").eq("model", m.model).limit(5000);
    const done = new Set((existing || []).map((e: any) => e.pack_id));
    const chosen = (packs || []).filter((p: any) => !done.has(p.id) && (m.subset_rank_max == null || p.stratum === "golden_reference"
      || (rank.get(`${p.person_id}|${p.episode_id}`) || 1e9) <= m.subset_rank_max));
    if (!chosen.length) { out.push({ model: m.model, skipped: "nothing_to_send" }); continue; }
    const { data: job, error: jobErr } = await db.from("person_evidence_jobs").insert({ lane, status: "claimed", model: m.model, policy_version: c.policy_version,
      meta: { shadow_only: true, max_output_tokens: c.max_output_tokens } }).select("id").single();
    if (jobErr || !job) { out.push({ model: m.model, error: "job_create_failed" }); continue; }
    const abort = async (reason: string) => {
      await db.from("person_evidence_items").update({ status: "released", error: reason.slice(0, 200), updated_at: new Date().toISOString() }).eq("job_id", job.id).in("status", ["queued", "submitted"]);
      await db.from("person_evidence_jobs").update({ status: "aborted", reserved_cost_usd: 0, last_error: reason.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", job.id);
      out.push({ model: m.model, job_id: job.id, submitted: false, error: reason });
    };
    const lines: any[] = []; const rows: any[] = []; let reserve = 0;
    for (const p of chosen) {
      const id = crypto.randomUUID();
      const customId = `pev1:${id}`;
      const line = buildEvidenceRequest(customId, p.pack as Pack, m.model, c.max_output_tokens);
      reserve += requestUpperBoundUsd(line);
      lines.push(line);
      rows.push({ id, pack_id: p.id, job_id: job.id, model: m.model, attempt: 1, custom_id: customId, status: "queued" });
    }
    if (!Number.isFinite(reserve)) { await abort("pricing_missing"); continue; }
    const ins = await db.from("person_evidence_items").insert(rows);
    if (ins.error) { await abort("item_insert_failed:" + ins.error.message); continue; }
    // The budget trigger charges the central guard in this same update; over-cap fails closed.
    const res = await db.from("person_evidence_jobs").update({ reserved_cost_usd: Math.ceil(reserve * 1e6) / 1e6, request_count: lines.length, status: "uploading", updated_at: new Date().toISOString() })
      .eq("id", job.id).eq("status", "claimed").select("id");
    if (res.error || !res.data?.length) { await abort("budget_refused:" + (res.error?.message || "not_claimed")); continue; }
    const form = new FormData();
    form.append("purpose", "batch");
    form.append("file", new Blob([lines.map((l) => JSON.stringify(l)).join("\n") + "\n"], { type: "application/jsonl" }), `${job.id}.jsonl`);
    const file = await openai("/files", { method: "POST", body: form });
    if (!file.ok || !file.data?.id) { await stopOnDenial(db, file.status, file.error); await abort("file_upload_failed:" + file.error); continue; }
    await db.from("person_evidence_jobs").update({ openai_input_file_id: file.data.id }).eq("id", job.id);
    const batch = await openai("/batches", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input_file_id: file.data.id, endpoint: "/v1/responses", completion_window: "24h", metadata: { job_id: job.id, policy: c.policy_version, lane } }) });
    if (!batch.ok || !batch.data?.id) { await stopOnDenial(db, batch.status, batch.error); await abort("batch_create_failed:" + batch.error); continue; }
    await db.from("person_evidence_jobs").update({ status: "submitted", openai_batch_id: batch.data.id, submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
    await db.from("person_evidence_items").update({ status: "submitted", updated_at: new Date().toISOString() }).eq("job_id", job.id).eq("status", "queued");
    out.push({ model: m.model, job_id: job.id, submitted: true, requests: lines.length, reserved_usd: reserve, openai_batch_id: batch.data.id });
  }
  return out;
}

async function ingest(db: any, job: any) {
  const { data: items } = await db.from("person_evidence_items").select("id,custom_id,status,pack_id").eq("job_id", job.id);
  const byId = new Map<string, any>((items || []).map((i: any) => [i.custom_id, i]));
  const packIds = [...new Set((items || []).map((i: any) => i.pack_id))] as string[];
  const packs = new Map<string, any>();
  for (let i = 0; i < packIds.length; i += 200) {
    const { data } = await db.from("person_evidence_packs").select("id,pack,identity_risk").in("id", packIds.slice(i, i + 200));
    for (const p of data || []) packs.set(p.id, p);
  }
  const pricing = PRICING[job.model];
  let processed = 0, anomalies = 0;
  for (const fileId of [job.openai_output_file_id, job.openai_error_file_id].filter(Boolean)) {
    const content = await openai(`/files/${fileId}/content`);
    if (!content.ok || !content.res) { await stopOnDenial(db, content.status, content.error); return { ok: false, error: "download_failed:" + content.error }; }
    for await (const raw of streamLines(content.res)) {
      const parsed = parseResponseLine(raw);
      const item = parsed && byId.get(parsed.custom_id);
      if (!parsed || !item) { anomalies++; continue; }
      if (item.status !== "submitted") continue;
      processed++;
      const cost = actualCostUsd(parsed.usage, pricing, BATCH_DISCOUNT);
      const usage = { input_tokens: parsed.usage?.input_tokens ?? null, cached_tokens: parsed.usage?.input_tokens_details?.cached_tokens ?? null,
        output_tokens: parsed.usage?.output_tokens ?? null, cost_usd: cost, updated_at: new Date().toISOString() };
      if (!parsed.ok) {
        await db.from("person_evidence_items").update({ ...usage, status: parsed.error === "model_refusal" ? "refused" : parsed.error === "invalid_json" ? "invalid" : "failed", error: parsed.error }).eq("id", item.id);
        continue;
      }
      const p = packs.get(item.pack_id);
      const v = validateEvidenceDecision(parsed.raw, p.pack as Pack, { identityRisk: !!p.identity_risk });
      await db.from("person_evidence_items").update({ ...usage, status: v.verdict === "invalid_output" ? "invalid" : "succeeded",
        decision: { raw: parsed.raw, problems: v.problems, role: v.role, identity: v.identity }, verdict: v.verdict }).eq("id", item.id);
    }
  }
  await db.from("person_evidence_items").update({ status: "expired", error: "no_result_line", updated_at: new Date().toISOString() }).eq("job_id", job.id).eq("status", "submitted");
  const { data: costs } = await db.from("person_evidence_items").select("cost_usd").eq("job_id", job.id);
  const actual = (costs || []).reduce((n: number, r: any) => n + (Number(r.cost_usd) || 0), 0);
  // Settles the central ledger through the budget trigger (status ingested → actual cost).
  await db.from("person_evidence_jobs").update({ status: "ingested", actual_cost_usd: actual, reserved_cost_usd: actual, ingested_at: new Date().toISOString(),
    updated_at: new Date().toISOString(), meta: { ...(job.meta || {}), anomalies } }).eq("id", job.id);
  if (actual > 0) await db.rpc("add_ai_spend", { p_day: new Date().toISOString().slice(0, 10), p_kind: "person_evidence_openai", p_amount: actual, p_calls: (costs || []).length });
  return { ok: true, processed, anomalies, actual_cost_usd: actual };
}

async function pollAction(db: any) {
  const { data: jobs } = await db.from("person_evidence_jobs").select("*").in("status", ["submitted", "validating", "in_progress", "finalizing", "cancelling", "completed", "expired", "cancelled", "failed", "ingesting"])
    .not("openai_batch_id", "is", null).is("ingested_at", null).order("created_at").limit(4);
  const out: any[] = [];
  for (const job of jobs || []) {
    const token = crypto.randomUUID();
    const lease = await db.from("person_evidence_jobs").update({ lease_token: token, lease_until: new Date(Date.now() + 10 * 60e3).toISOString() })
      .eq("id", job.id).or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`).select("id");
    if (!lease.data?.length) { out.push({ job_id: job.id, skipped: "locked" }); continue; }
    try {
      const b = await openai(`/batches/${job.openai_batch_id}`);
      if (!b.ok) { await stopOnDenial(db, b.status, b.error); out.push({ job_id: job.id, error: b.error }); continue; }
      const terminal = ["completed", "failed", "expired", "cancelled"].includes(b.data.status);
      const patch: any = { status: b.data.status, request_counts: b.data.request_counts || null, openai_output_file_id: b.data.output_file_id || null,
        openai_error_file_id: b.data.error_file_id || null, updated_at: new Date().toISOString() };
      if (terminal) patch.completed_at = new Date().toISOString();
      await db.from("person_evidence_jobs").update(patch).eq("id", job.id);
      if (terminal) {
        if (!patch.openai_output_file_id && !patch.openai_error_file_id) {
          await db.from("person_evidence_items").update({ status: "expired", error: "batch_" + b.data.status }).eq("job_id", job.id).eq("status", "submitted");
          await db.from("person_evidence_jobs").update({ status: "ingested", actual_cost_usd: 0, reserved_cost_usd: 0, ingested_at: new Date().toISOString() }).eq("id", job.id);
          out.push({ job_id: job.id, batch_status: b.data.status, ingested: { processed: 0 } });
        } else out.push({ job_id: job.id, batch_status: b.data.status, ingested: await ingest(db, { ...job, ...patch }) });
      } else out.push({ job_id: job.id, batch_status: b.data.status, request_counts: b.data.request_counts });
    } finally {
      await db.from("person_evidence_jobs").update({ lease_until: null, lease_token: null }).eq("id", job.id).eq("lease_token", token);
    }
  }
  return out;
}

async function loadReferences(db: any): Promise<Reference[]> {
  const [{ data: refs }, { data: goldens }] = await Promise.all([
    db.from("person_evidence_references").select("person_id,episode_id,label_role,labeled_by").limit(5000),
    db.from("person_relevance_goldens").select("person_id,episode_id,label_status,label_mention_type,label_identity,labeled_by").limit(5000),
  ]);
  const out = new Map<string, Reference>();
  for (const g of goldens || []) { if (!g.labeled_by) continue; const r = goldenToReference(g); if (r) out.set(`${r.person_id}|${r.episode_id}`, r); }
  for (const r of refs || []) if (r.labeled_by) out.set(`${r.person_id}|${r.episode_id}`, { person_id: r.person_id, episode_id: r.episode_id, label_role: r.label_role, source: "human_reference" });
  return [...out.values()];
}

async function evaluateAction(db: any, c: Controls) {
  const { data: rows } = await db.from("person_evidence_items")
    .select("model,status,verdict,decision,cost_usd,person_evidence_packs!inner(person_id,episode_id,stratum,policy_version)")
    .eq("person_evidence_packs.policy_version", c.policy_version).limit(10000);
  const items = (rows || []).map((r: any) => ({ person_id: r.person_evidence_packs.person_id, episode_id: r.person_evidence_packs.episode_id,
    stratum: r.person_evidence_packs.stratum, model: r.model, status: r.status, verdict: r.verdict, role: r.decision?.role ?? null, cost_usd: Number(r.cost_usd) || 0 }));
  const refs = await loadReferences(db);
  const gate = evaluateGate(items, refs);
  const { data: last } = await db.from("person_evidence_gate_runs").select("status").order("id", { ascending: false }).limit(1).maybeSingle();
  // A failed gate is final for this policy version: later labels cannot silently reopen spending.
  if (last?.status === "failed") return { ...gate, recorded: false, kept: "failed" };
  await db.from("person_evidence_gate_runs").insert({ policy_version: c.policy_version, status: gate.status, passed_models: gate.passed_models,
    metrics: { per_model: gate.per_model, references: refs.length, thresholds: gate.thresholds, note: gate.note } });
  if (gate.status === "failed") await patchControls(db, { enabled: false, paused_reason: "quality_gate_failed", paused_at: new Date().toISOString() });
  return { ...gate, recorded: true, references: refs.length };
}

async function tickAction(db: any) {
  const polled = await pollAction(db);
  const c = await loadControls(db);
  const result: any = { ok: true, polled };
  if (!c.enabled) return { ...result, reason: c.paused_reason || "controls_disabled" };
  if (!(await backgroundEnabled(db))) return { ...result, reason: "background_jobs_paused" };
  const prep = await prepareAction(db, c, c.prepare_per_tick);
  result.prepare = prep;
  if (prep.remaining === 0) result.submit = await submitAction(db, c, "evidence_pilot");
  const { data: open } = await db.from("person_evidence_jobs").select("id").in("status", OPEN).eq("policy_version", c.policy_version);
  const { data: ingestedJobs } = await db.from("person_evidence_jobs").select("id").eq("policy_version", c.policy_version).eq("status", "ingested").limit(1);
  if (prep.remaining === 0 && !(open || []).length && (ingestedJobs || []).length) {
    result.gate = await evaluateAction(db, c);
    // Pilot finished: stop the scheduled work; only labels (admin) re-evaluate the gate from now on.
    if (result.gate.status !== "passed") await patchControls(db, { enabled: false, paused_reason: "pilot_complete_waiting_for_references", paused_at: new Date().toISOString() });
  }
  return result;
}

async function sampleAction(db: any, c: Controls, body: any) {
  const limit = Math.min(30, Math.max(1, Number(body.limit) || 10));
  const { data: refs } = await db.from("person_evidence_references").select("person_id,episode_id").limit(5000);
  const done = new Set((refs || []).map((r: any) => `${r.person_id}|${r.episode_id}`));
  const { data: packs } = await db.from("person_evidence_packs").select("id,person_id,episode_id,stratum,identity_risk,precheck,pack")
    .eq("policy_version", c.policy_version).is("precheck", null).order("created_at").limit(2000);
  // Prefer pairs some model wants to auto-accept: those are the ones the gate measures.
  const { data: auto } = await db.from("person_evidence_items").select("pack_id").eq("verdict", "auto_accept_candidate").limit(5000);
  const autoSet = new Set((auto || []).map((a: any) => a.pack_id));
  const open = (packs || []).filter((p: any) => !done.has(`${p.person_id}|${p.episode_id}`))
    .sort((a: any, b: any) => Number(autoSet.has(b.id)) - Number(autoSet.has(a.id)));
  // AI answers are deliberately not returned, so the human label is not anchored on them.
  return { ok: true, remaining: open.length, items: open.slice(0, limit).map((p: any) => ({ person_id: p.person_id, episode_id: p.episode_id,
    stratum: p.stratum, identity_risk: p.identity_risk, person: p.pack.person, episode: p.pack.episode, podcast: p.pack.podcast, windows: p.pack.windows })) };
}

async function labelAction(db: any, c: Controls, userId: string, body: any) {
  if (!UUID.test(body.person_id || "") || !UUID.test(body.episode_id || "") || !LABELS.includes(body.label_role)) return json({ ok: false, error: "invalid_label" }, 400);
  const { error } = await db.from("person_evidence_references").upsert({ person_id: body.person_id, episode_id: body.episode_id, label_role: body.label_role,
    labeled_by: userId, notes: typeof body.notes === "string" ? body.notes.slice(0, 500) : null, updated_at: new Date().toISOString() }, { onConflict: "person_id,episode_id" });
  if (error) return json({ ok: false, error: "label_write_failed" }, 500);
  return json({ ok: true, gate: await evaluateAction(db, c) });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  { const denied = await denyUntrustedCaller(req, "person-evidence-review"); if (denied) return denied; }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    let body: any = {};
    try { body = await req.clone().json(); } catch { /* empty */ }
    if (body.action === "tick") return json(await tickAction(db));
    const c = await loadControls(db);
    if (body.action === "prepare") return json({ ok: true, ...(await prepareAction(db, c, Number(body.limit) || 40)) });
    const userId = await requireAdmin(db, req);
    if (body.action === "status") {
      const r = await db.rpc("get_person_review_status_v1");
      return json(r.error ? { ok: false, error: "status_failed" } : { ok: true, status: r.data, key_present: !!Deno.env.get("OPENAI_API_KEY") });
    }
    if (!userId) return json({ ok: false, error: "admin_required" }, 403);
    switch (body.action) {
      case "sample": return json(await sampleAction(db, c, body));
      case "label": return await labelAction(db, c, userId, body);
      case "evaluate": return json(await evaluateAction(db, c));
      default: return json({ ok: false, error: "unknown_action" }, 400);
    }
  } catch (e) {
    console.error("person-evidence-review", String((e as Error)?.message || e).slice(0, 300));
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
