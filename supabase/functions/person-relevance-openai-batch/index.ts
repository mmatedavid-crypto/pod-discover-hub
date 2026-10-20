// Admin-only OpenAI Batch orchestration for person–episode relevance review.
// Actions: status | preview (dry run, no OpenAI call) | label_golden |
// submit | poll | cancel | release | rollback. Submission is blocked unless the
// owner enabled controls with an authorized pilot budget and a rotated key.
// Never logs or returns the API key. No cron: polling is admin-triggered.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { checkProcessingPriority } from "../_shared/processing-priority.ts";
import { inputGuard, type Source } from "../_shared/person-relevance-batch.ts";
import {
  actualCostUsd, BATCH_MAX_BYTES, buildCustomId, buildRequestLine, decidePolicy, estimateTokens, goldenMetrics, jsonlSize,
  mapBatchStatus, mergeControls, parseOutputLine, PILOT_DESIGN, REQUEST_MAX_CHARS, requestCostUpperBoundUsd, submitBlockers,
  TERMINAL_BATCH, type Controls, type Tier,
} from "../_shared/person-relevance-openai-batch.ts";

const OPENAI = "https://api.openai.com/v1";
const CONTROLS_KEY = "person_relevance_openai_batch_controls";
const INGEST_PER_CALL = 400;
const OPEN_STATUSES = ["claimed", "uploading", "submitted", "validating", "in_progress", "finalizing", "cancelling", "ingesting"];
const UUID = /^[0-9a-f-]{36}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: corsHeaders });

async function requireAdmin(db: any, req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  const uid = data?.user?.id;
  if (!uid) return null;
  const { data: role } = await db.from("user_roles").select("role").eq("user_id", uid).eq("role", "admin").maybeSingle();
  return role ? uid : null;
}

async function loadControls(db: any): Promise<Controls> {
  const { data, error } = await db.from("app_settings").select("value").eq("key", CONTROLS_KEY).maybeSingle();
  if (error) throw new Error("controls_unavailable");
  return mergeControls(data?.value);
}

// Re-read before writing so a concurrent owner change is never overwritten.
async function pauseControls(db: any, reason: string) {
  const { data } = await db.from("app_settings").select("value").eq("key", CONTROLS_KEY).maybeSingle();
  const value = { ...(data?.value || {}), enabled: false, paused_reason: reason, paused_at: new Date().toISOString() };
  await db.from("app_settings").upsert({ key: CONTROLS_KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

async function backgroundEnabled(db: any): Promise<boolean> {
  const { data, error } = await db.from("app_settings").select("value").eq("key", "background_jobs").maybeSingle();
  if (error || !data?.value) return false;
  return data.value.enabled !== false && data.value.incident_mode !== true;
}

async function rpc(db: any, name: string, args: Record<string, unknown>) {
  const r = await db.rpc(name, args);
  if (r.error) throw new Error(`${name}: ${r.error.message}`);
  return r.data;
}

async function openai(path: string, init: RequestInit = {}) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) return { ok: false, status: 0, data: null as any, error: "openai_api_key_missing" };
  const res = await fetch(OPENAI + path, { ...init, headers: { Authorization: `Bearer ${key}`, ...(init.headers || {}) } });
  if (path.includes("/content")) return { ok: res.ok, status: res.status, data: null as any, res, error: res.ok ? null : `http_${res.status}` };
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { /* non-json */ }
  return { ok: res.ok, status: res.status, data, error: res.ok ? null : String(data?.error?.code || data?.error?.type || `http_${res.status}`).slice(0, 120) };
}

// Auth/permission denials pause the whole pipeline; 429/5xx stay transient.
async function handleOpenAIFailure(db: any, status: number, error: string | null) {
  if (status === 401 || status === 403 || /insufficient_quota|billing/i.test(error || "")) {
    await pauseControls(db, `openai_denied_${status}:${error || ""}`.slice(0, 120));
    return "terminal";
  }
  return status === 429 || status >= 500 ? "transient" : "terminal";
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

async function sourceWithHash(db: any, person: string, episode: string): Promise<{ source_hash: string; input: Source } | null> {
  const r = await rpc(db, "person_judge_source_with_hash", { _person: person, _episode: episode });
  return r && typeof r.source_hash === "string" && r.input ? r : null;
}

async function statusAction(db: any, controls: Controls) {
  const [jobs, goldens, items, evalItems, bg, pending, open] = await Promise.all([
    db.from("person_relevance_batch_jobs").select("id,tier,status,model,request_count,reserved_cost_usd,actual_cost_usd,request_counts,last_error,created_at,submitted_at,completed_at,expires_at,ingested_at,rolled_back_at,meta")
      .order("created_at", { ascending: false }).limit(20),
    db.from("person_relevance_goldens").select("person_id,episode_id,label_status,label_mention_type,stratum").limit(1000),
    db.from("person_relevance_batch_items").select("status").limit(20000),
    db.from("person_relevance_batch_items").select("person_id,episode_id,decision,final_status,cost_usd,person_relevance_batch_jobs!inner(model,tier)")
      .eq("person_relevance_batch_jobs.tier", "golden_eval").limit(5000),
    backgroundEnabled(db),
    db.from("person_episode_mentions").select("id", { count: "exact", head: true }).eq("relevance_status", "pending"),
    db.from("person_relevance_batch_jobs").select("id", { count: "exact", head: true }).in("status", OPEN_STATUSES),
  ]);
  const itemCounts: Record<string, number> = {};
  for (const r of items.data || []) itemCounts[r.status] = (itemCounts[r.status] || 0) + 1;
  const goldenRows = goldens.data || [];
  const goldenCounts: Record<string, number> = {};
  for (const g of goldenRows) goldenCounts[g.stratum || "unspecified"] = (goldenCounts[g.stratum || "unspecified"] || 0) + 1;
  const openJobs = open.count || 0;
  const keyPresent = !!Deno.env.get("OPENAI_API_KEY");
  const { pricing_usd_per_1m, ...rest } = controls;
  return {
    ok: true,
    controls: { ...rest, pricing_usd_per_1m },
    key_present: keyPresent,
    blockers_primary: submitBlockers(controls, { keyPresent, backgroundEnabled: bg, priorityBlocker: null, openJobs, requestedCount: 1, model: controls.primary_model, tier: "primary" }),
    jobs: jobs.data || [],
    item_counts: itemCounts,
    goldens: { total: goldenRows.length, by_stratum: goldenCounts },
    golden_metrics: goldenMetrics(goldenRows, (evalItems.data || []).map((r: any) => ({ ...r, model: r.person_relevance_batch_jobs?.model }))),
    pending_mention_rows: pending.count ?? null,
    pilot_design: PILOT_DESIGN,
  };
}

async function previewAction(db: any, controls: Controls, body: any) {
  const limit = Math.min(25, Math.max(1, Number(body.limit) || 10));
  const offset = Math.min(5000, Math.max(0, Number(body.offset) || 0));
  const role = ["participant", "mention", "subject"].includes(body.role) ? body.role : null;
  const started = Date.now();
  const cands = await rpc(db, "person_openai_batch_candidates", { _limit: limit, _offset: offset, _role: role, _person_ids: null });
  const samples: any[] = [];
  const models = Object.keys(controls.pricing_usd_per_1m);
  const totals: Record<string, number> = Object.fromEntries(models.map((m) => [m, 0]));
  let paid = 0, bytes = 0, tokens = 0;
  for (const c of cands || []) {
    const sourced = await sourceWithHash(db, c.person_id, c.episode_id);
    if (!sourced) continue;
    const src = sourced.input;
    const guard = inputGuard(src);
    const line = buildRequestLine(buildCustomId({ promptVersion: controls.prompt_version, tier: "primary", personId: c.person_id,
      episodeId: c.episode_id, sourceHash: sourced.source_hash, attempt: 1 }), src, controls, controls.primary_model);
    const lineBytes = jsonlSize([line]);
    const inTok = estimateTokens(line.body.instructions) + estimateTokens(line.body.input);
    if (!guard) {
      paid++; bytes += lineBytes; tokens += inTok;
      for (const m of models) totals[m] += requestCostUpperBoundUsd({ ...line, body: { ...line.body, model: m } }, controls.pricing_usd_per_1m[m], controls.batch_discount);
    }
    samples.push({
      person_id: c.person_id, episode_id: c.episode_id, person_name: src.person?.name, disambiguation_label: src.person?.disambiguation_label || null,
      episode_title: src.episode?.title, podcast_title: src.podcast?.title,
      excerpt: String(src.episode?.clean_text || src.episode?.summary || "").slice(0, 500),
      extraction: (src.mentions || []).map((m: any) => ({ mention_type: m.mention_type, role_type: m.role_type, evidence: String(m.evidence || "").slice(0, 160) })),
      is_public_person: c.is_public_person, identity_risk: c.identity_risk,
      guard: guard ? { status: guard.status, reason: guard.reason } : null,
      est_input_tokens: inTok, request_bytes: lineBytes,
    });
  }
  const perPair = Object.fromEntries(models.map((m) => [m, paid ? totals[m] / paid : null]));
  return {
    ok: true, dry_run: true, openai_called: false, writes: 0, elapsed_ms: Date.now() - started,
    sample_count: samples.length, paid_eligible: paid, avg_request_bytes: paid ? Math.round(bytes / paid) : null,
    avg_input_tokens_est: paid ? Math.round(tokens / paid) : null,
    upper_bound_cost_usd: { sample: totals, per_pair: perPair,
      pilot_1500: Object.fromEntries(models.map((m) => [m, perPair[m] == null ? null : perPair[m]! * 1500])),
      backlog_227552: Object.fromEntries(models.map((m) => [m, perPair[m] == null ? null : perPair[m]! * 227552])) },
    pricing_note: `Felső becslés: karakter/3 token, teljes max_output_tokens, batch-kedvezmény ${controls.batch_discount}. Forrás: ${controls.pricing_source} (${controls.pricing_checked_at}).`,
    samples,
  };
}

async function labelGolden(db: any, userId: string, body: any) {
  const ok = UUID.test(body.person_id || "") && UUID.test(body.episode_id || "")
    && ["accepted", "rejected", "needs_review"].includes(body.label_status)
    && (body.label_mention_type == null || ["host", "guest", "subject", "mentioned", "none"].includes(body.label_mention_type))
    && (body.label_identity == null || ["same_person", "different_person_same_name", "substring_false_positive", "uncertain"].includes(body.label_identity));
  if (!ok) return json({ ok: false, error: "invalid_label" }, 400);
  const sourced = await sourceWithHash(db, body.person_id, body.episode_id);
  if (!sourced) return json({ ok: false, error: "pair_not_found" }, 404);
  const hash = sourced.source_hash;
  const { error } = await db.from("person_relevance_goldens").upsert({
    person_id: body.person_id, episode_id: body.episode_id, source_hash: hash, label_status: body.label_status,
    label_mention_type: body.label_mention_type ?? null, label_identity: body.label_identity ?? null,
    stratum: typeof body.stratum === "string" ? body.stratum.slice(0, 40) : null,
    notes: typeof body.notes === "string" ? body.notes.slice(0, 500) : null, labeled_by: userId, updated_at: new Date().toISOString(),
  }, { onConflict: "person_id,episode_id" });
  if (error) return json({ ok: false, error: "label_write_failed" }, 500);
  return json({ ok: true });
}


type Prepared = { person_id: string; episode_id: string; source_hash: string; identity_risk: boolean; input: Source; prior_item_id?: string };

async function submitAction(db: any, controls: Controls, userId: string, body: any) {
  const tier: Tier = ["primary", "escalation", "golden_eval"].includes(body.tier) ? body.tier : "primary";
  const model = tier === "escalation" ? (controls.escalation_model || "")
    : tier === "golden_eval" && typeof body.model === "string" && controls.pricing_usd_per_1m[body.model] ? body.model : controls.primary_model;
  const requested = Math.floor(Number(body.limit) || 0);
  const role = ["participant", "mention", "subject"].includes(body.role) ? body.role : null;
  const { data: open } = await db.from("person_relevance_batch_jobs").select("id").in("status", OPEN_STATUSES);
  const blockers = submitBlockers(controls, {
    keyPresent: !!Deno.env.get("OPENAI_API_KEY"), backgroundEnabled: await backgroundEnabled(db),
    priorityBlocker: tier === "golden_eval" ? null : await checkProcessingPriority(db, "person_relevance"),
    openJobs: (open || []).length, requestedCount: requested, model, tier,
  });
  if (blockers.length) return json({ ok: false, submitted: false, blockers });

  const { data: job, error: jobErr } = await db.from("person_relevance_batch_jobs").insert({
    tier, status: "claimed", model, prompt_version: controls.prompt_version, created_by: userId,
    meta: { role, requested, reasoning_effort: controls.reasoning_effort, max_output_tokens: controls.max_output_tokens },
  }).select("id").single();
  if (jobErr || !job) return json({ ok: false, error: "job_create_failed" }, 500);
  const jobId = job.id as string;
  const abort = async (reason: string) => {
    await db.rpc("release_person_openai_batch_job", { _job: jobId });
    await db.from("person_relevance_batch_jobs").update({ status: "aborted", reserved_cost_usd: 0, last_error: reason.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", jobId);
    return json({ ok: false, submitted: false, job_id: jobId, error: reason });
  };

  try {
    let prepared: Prepared[] = [];
    if (tier === "primary") {
      prepared = (await rpc(db, "claim_person_openai_batch_pairs", { _job: jobId, _limit: requested, _role: role, _person_ids: null }) || []) as Prepared[];
    } else if (tier === "golden_eval") {
      const { data: g } = await db.from("person_relevance_goldens").select("person_id,episode_id").order("created_at").limit(requested);
      for (const row of g || []) {
        const sourced = await sourceWithHash(db, row.person_id, row.episode_id);
        if (sourced) prepared.push({ person_id: row.person_id, episode_id: row.episode_id, source_hash: sourced.source_hash, identity_risk: false, input: sourced.input });
      }
    } else {
      const { data: waiting } = await db.from("person_relevance_batch_items").select("id,job_id,person_id,episode_id,source_hash,identity_risk")
        .eq("status", "awaiting_escalation").order("created_at").limit(requested);
      for (const w of waiting || []) {
        const moved = await db.from("person_relevance_work").update({ claim_token: jobId, lease_until: new Date(Date.now() + 26 * 3600e3).toISOString(), updated_at: new Date().toISOString() })
          .eq("person_id", w.person_id).eq("episode_id", w.episode_id).eq("claim_token", w.job_id).eq("source_hash", w.source_hash).select("person_id");
        if (!moved.data?.length) continue;
        const sourced = await sourceWithHash(db, w.person_id, w.episode_id);
        if (sourced?.source_hash === w.source_hash) prepared.push({ person_id: w.person_id, episode_id: w.episode_id, source_hash: w.source_hash, identity_risk: w.identity_risk, input: sourced!.input, prior_item_id: w.id });
      }
    }

    const lines: any[] = [];
    const rows: any[] = [];
    let reserve = 0;
    const pricing = controls.pricing_usd_per_1m[model];
    // Prior attempts per pair/source, read in bounded chunks instead of one query per pair.
    const priorAttempts = new Map<string, number>();
    const episodeIds = [...new Set(prepared.map((p) => p.episode_id))];
    for (let i = 0; i < episodeIds.length; i += 150) {
      const { data: prior } = await db.from("person_relevance_batch_items").select("person_id,episode_id,source_hash")
        .in("episode_id", episodeIds.slice(i, i + 150)).eq("prompt_version", controls.prompt_version).eq("tier", tier).limit(5000);
      for (const r of prior || []) {
        const k = `${r.person_id}|${r.episode_id}|${r.source_hash}`;
        priorAttempts.set(k, (priorAttempts.get(k) || 0) + 1);
      }
    }
    for (const p of prepared) {
      const releasePair = () => tier !== "golden_eval" && db.from("person_relevance_work").update({ lease_until: new Date().toISOString() })
        .eq("person_id", p.person_id).eq("episode_id", p.episode_id).eq("claim_token", jobId);
      if (inputGuard(p.input)) { await releasePair(); continue; }
      const attempt = (priorAttempts.get(`${p.person_id}|${p.episode_id}|${p.source_hash}`) || 0) + 1;
      if (attempt > Math.max(1, controls.max_attempts) && tier !== "golden_eval") { await releasePair(); continue; }
      const customId = buildCustomId({ promptVersion: controls.prompt_version, tier, personId: p.person_id, episodeId: p.episode_id, sourceHash: p.source_hash, attempt });
      const line = buildRequestLine(customId, p.input, controls, model);
      if (line.body.input.length > REQUEST_MAX_CHARS) { await releasePair(); continue; }
      reserve += requestCostUpperBoundUsd(line, pricing, controls.batch_discount);
      lines.push(line);
      rows.push({ job_id: jobId, custom_id: customId, person_id: p.person_id, episode_id: p.episode_id, source_hash: p.source_hash,
        prompt_version: controls.prompt_version, tier, attempt, identity_risk: !!p.identity_risk, status: "queued" });
      if (p.prior_item_id) await db.from("person_relevance_batch_items").update({ status: "escalated", updated_at: new Date().toISOString() }).eq("id", p.prior_item_id);
    }
    if (!lines.length) return abort("no_eligible_pairs");
    const bytes = jsonlSize(lines);
    if (bytes > BATCH_MAX_BYTES || !Number.isFinite(reserve)) return abort("batch_file_limits_or_pricing");
    const ins = await db.from("person_relevance_batch_items").insert(rows);
    if (ins.error) return abort("item_insert_failed:" + ins.error.message);
    const reservation = await db.rpc("reserve_person_openai_batch_cost", { _job: jobId, _amount: Math.ceil(reserve * 1e6) / 1e6, _requests: lines.length });
    if (reservation.error) return abort("reservation_refused:" + reservation.error.message);
    await db.from("person_relevance_batch_jobs").update({ input_bytes: bytes }).eq("id", jobId);

    const form = new FormData();
    form.append("purpose", "batch");
    form.append("file", new Blob([lines.map((l) => JSON.stringify(l)).join("\n") + "\n"], { type: "application/jsonl" }), `${jobId}.jsonl`);
    const file = await openai("/files", { method: "POST", body: form });
    if (!file.ok || !file.data?.id) { await handleOpenAIFailure(db, file.status, file.error); return abort("file_upload_failed:" + file.error); }
    await db.from("person_relevance_batch_jobs").update({ openai_input_file_id: file.data.id }).eq("id", jobId);
    const batch = await openai("/batches", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input_file_id: file.data.id, endpoint: "/v1/responses", completion_window: "24h",
        metadata: { job_id: jobId, prompt_version: controls.prompt_version, tier } }) });
    if (!batch.ok || !batch.data?.id) { await handleOpenAIFailure(db, batch.status, batch.error); return abort("batch_create_failed:" + batch.error); }
    await db.from("person_relevance_batch_jobs").update({
      status: "submitted", openai_batch_id: batch.data.id, submitted_at: new Date().toISOString(),
      expires_at: batch.data.expires_at ? new Date(batch.data.expires_at * 1000).toISOString() : null, updated_at: new Date().toISOString(),
    }).eq("id", jobId);
    await db.from("person_relevance_batch_items").update({ status: "submitted", updated_at: new Date().toISOString() }).eq("job_id", jobId).eq("status", "queued");
    return json({ ok: true, submitted: true, job_id: jobId, requests: lines.length, reserved_usd: reserve, reservation: reservation.data });
  } catch (e) {
    return abort("submit_error:" + String(e).slice(0, 200));
  }
}

async function ingestJob(db: any, controls: Controls, job: any) {
  const { data: items } = await db.from("person_relevance_batch_items").select("id,custom_id,person_id,episode_id,source_hash,identity_risk,status,tier").eq("job_id", job.id);
  const byId = new Map<string, any>((items || []).map((i: any) => [i.custom_id, i]));
  const seen = new Set<string>();
  const pricing = controls.pricing_usd_per_1m[job.model];
  let processed = 0, anomalies = 0, applied = 0, failed = 0;
  let more = false;
  for (const fileId of [job.openai_output_file_id, job.openai_error_file_id].filter(Boolean)) {
    const content = await openai(`/files/${fileId}/content`);
    if (!content.ok || !content.res) { await handleOpenAIFailure(db, content.status, content.error); return { ok: false, error: "download_failed:" + content.error }; }
    for await (const raw of streamLines(content.res)) {
      const parsed = parseOutputLine(raw);
      if (!parsed) { anomalies++; continue; }
      const item = byId.get(parsed.custom_id);
      if (!item || seen.has(parsed.custom_id)) { anomalies++; continue; }
      seen.add(parsed.custom_id);
      if (item.status !== "submitted") continue;
      if (processed >= INGEST_PER_CALL) { more = true; continue; }
      processed++;
      const cost = actualCostUsd(parsed.usage, pricing, controls.batch_discount);
      const usage = { input_tokens: parsed.usage?.input_tokens ?? null, cached_tokens: parsed.usage?.input_tokens_details?.cached_tokens ?? null,
        output_tokens: parsed.usage?.output_tokens ?? null, cost_usd: cost, updated_at: new Date().toISOString() };
      if (parsed.outcome !== "ok") {
        failed++;
        await db.from("person_relevance_batch_items").update({ ...usage,
          status: parsed.outcome === "refusal" ? "refused" : parsed.outcome === "schema_mismatch" ? "invalid" : "failed", error: parsed.error }).eq("id", item.id);
        continue;
      }
      const sourced = await sourceWithHash(db, item.person_id, item.episode_id);
      if (!sourced || sourced.source_hash !== item.source_hash) {
        await db.from("person_relevance_batch_items").update({ ...usage, status: "skipped_stale", error: sourced ? "source_changed" : "source_missing" }).eq("id", item.id);
        continue;
      }
      const src = sourced.input;
      const policy = decidePolicy(parsed.raw, src, { model: job.model, identityRisk: item.identity_risk, allowAiRejection: controls.allow_ai_rejection, tier: item.tier });
      const hold = policy.escalate && controls.escalation_enabled && item.tier === "primary";
      const status = item.tier === "golden_eval" ? "evaluated" : hold ? "awaiting_escalation" : "succeeded";
      await db.from("person_relevance_batch_items").update({ ...usage, status, decision: policy.decision, final_status: policy.final_status, escalate: policy.escalate }).eq("id", item.id);
      if (status === "succeeded") {
        const r = await db.rpc("apply_person_openai_batch_item", { _item: item.id });
        if (r.error) await db.from("person_relevance_batch_items").update({ status: "failed", error: ("apply:" + r.error.message).slice(0, 200) }).eq("id", item.id);
        else applied++;
      }
    }
  }
  if (more) {
    await db.from("person_relevance_batch_jobs").update({ status: "ingesting", updated_at: new Date().toISOString() }).eq("id", job.id);
    return { ok: true, partial: true, processed, applied, failed, anomalies };
  }
  // Requests absent from both files (expiry/cancel) are released, never guessed.
  await db.from("person_relevance_batch_items").update({ status: "expired", error: "no_result_line", updated_at: new Date().toISOString() })
    .eq("job_id", job.id).eq("status", "submitted");
  if (job.tier !== "golden_eval") await db.rpc("release_person_openai_batch_job", { _job: job.id });
  const { data: costs } = await db.from("person_relevance_batch_items").select("cost_usd,status").eq("job_id", job.id);
  const actual = (costs || []).reduce((n: number, r: any) => n + (Number(r.cost_usd) || 0), 0);
  const total = (costs || []).length || 1;
  const bad = (costs || []).filter((r: any) => ["failed", "invalid", "refused"].includes(r.status)).length;
  await db.from("person_relevance_batch_jobs").update({ status: "ingested", actual_cost_usd: actual, reserved_cost_usd: actual,
    ingested_at: new Date().toISOString(), updated_at: new Date().toISOString(), meta: { ...(job.meta || {}), anomalies, failure_rate: bad / total } }).eq("id", job.id);
  if (actual > 0) await db.rpc("add_ai_spend", { p_day: new Date().toISOString().slice(0, 10), p_kind: "person_relevance_openai", p_amount: actual, p_calls: total });
  if (bad / total > 0.2) await pauseControls(db, `high_failure_rate_${Math.round((bad / total) * 100)}pct`);
  return { ok: true, partial: false, processed, applied, failed, anomalies, actual_cost_usd: actual };
}

async function pollAction(db: any, controls: Controls, body: any) {
  let q = db.from("person_relevance_batch_jobs").select("*").in("status", ["submitted", "validating", "in_progress", "finalizing", "cancelling", "completed", "expired", "cancelled", "failed", "ingesting"])
    .not("openai_batch_id", "is", null).is("ingested_at", null).order("created_at").limit(3);
  if (UUID.test(body.job_id || "")) q = q.eq("id", body.job_id);
  const { data: jobs } = await q;
  const out: any[] = [];
  for (const job of jobs || []) {
    const token = crypto.randomUUID();
    const lease = await db.from("person_relevance_batch_jobs").update({ lease_token: token, lease_until: new Date(Date.now() + 10 * 60e3).toISOString() })
      .eq("id", job.id).or(`lease_until.is.null,lease_until.lt.${new Date().toISOString()}`).select("id");
    if (!lease.data?.length) { out.push({ job_id: job.id, skipped: "locked" }); continue; }
    try {
      const b = await openai(`/batches/${job.openai_batch_id}`);
      if (!b.ok) { out.push({ job_id: job.id, error: b.error, kind: await handleOpenAIFailure(db, b.status, b.error) }); continue; }
      const mapped = mapBatchStatus(b.data.status);
      const patch: any = { request_counts: b.data.request_counts || null, openai_output_file_id: b.data.output_file_id || null,
        openai_error_file_id: b.data.error_file_id || null, updated_at: new Date().toISOString() };
      if (mapped && job.status !== "ingesting") patch.status = mapped;
      if (TERMINAL_BATCH.has(b.data.status)) patch.completed_at = new Date().toISOString();
      if (b.data.errors?.data?.length) patch.last_error = JSON.stringify(b.data.errors.data.slice(0, 3)).slice(0, 500);
      await db.from("person_relevance_batch_jobs").update(patch).eq("id", job.id);
      if (TERMINAL_BATCH.has(b.data.status)) {
        if (!patch.openai_output_file_id && !patch.openai_error_file_id) {
          await db.from("person_relevance_batch_items").update({ status: b.data.status === "expired" ? "expired" : "failed", error: "batch_" + b.data.status }).eq("job_id", job.id).eq("status", "submitted");
          if (job.tier !== "golden_eval") await db.rpc("release_person_openai_batch_job", { _job: job.id });
          await db.from("person_relevance_batch_jobs").update({ status: "ingested", reserved_cost_usd: 0, ingested_at: new Date().toISOString() }).eq("id", job.id);
          out.push({ job_id: job.id, batch_status: b.data.status, ingested: { processed: 0 } });
        } else {
          out.push({ job_id: job.id, batch_status: b.data.status, ingested: await ingestJob(db, controls, { ...job, ...patch }) });
        }
      } else out.push({ job_id: job.id, batch_status: b.data.status, request_counts: b.data.request_counts });
    } finally {
      await db.from("person_relevance_batch_jobs").update({ lease_until: null, lease_token: null }).eq("id", job.id).eq("lease_token", token);
    }
  }
  return json({ ok: true, jobs: out });
}

// Scheduled step: poll/ingest open jobs, then submit the next primary batch
// only within the owner-authorized caps and all submission gates. Sized from
// the remaining budget so the reservation never needs to be refused.
const TICK_UPPER_USD_PER_PAIR = 0.0006;
async function tickAction(db: any) {
  const polled = await (await pollAction(db, await loadControls(db), {})).json();
  const controls = await loadControls(db);
  if (!controls.enabled) return { ok: true, polled, submitted: false, reason: "controls_disabled" };
  const { data: jobs } = await db.from("person_relevance_batch_jobs").select("status,reserved_cost_usd,actual_cost_usd,request_count,created_at")
    .not("status", "in", "(draft,aborted)").limit(5000);
  const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
  let committed = 0, today = 0, used = 0, open = 0;
  for (const j of jobs || []) {
    const c = Math.max(Number(j.reserved_cost_usd) || 0, Number(j.actual_cost_usd) || 0);
    committed += c; used += Number(j.request_count) || 0;
    if (new Date(j.created_at) >= dayStart) today += c;
    if (OPEN_STATUSES.includes(j.status)) open++;
  }
  if (open >= Math.max(1, controls.max_open_jobs)) return { ok: true, polled, submitted: false, reason: "open_job" };
  const auth = controls.authorized_pilot;
  const totalCap = Math.min(controls.total_cap_usd, Number(auth?.total_cap_usd) || 0);
  const dailyCap = Math.min(controls.daily_cap_usd, Number(auth?.daily_cap_usd ?? totalCap) || 0);
  const remaining = Math.min(totalCap - committed, dailyCap - today);
  const size = Math.min(controls.max_requests_per_job, (Number(auth?.max_requests) || 0) - used, Math.floor(remaining / TICK_UPPER_USD_PER_PAIR));
  if (size < 20) {
    if (totalCap - committed < 20 * TICK_UPPER_USD_PER_PAIR) await pauseControls(db, "authorized_budget_exhausted");
    return { ok: true, polled, submitted: false, reason: "budget_or_request_cap_reached", committed_usd: committed };
  }
  const res = await submitAction(db, controls, null as unknown as string, { tier: "primary", limit: size });
  return { ok: true, polled, submit: await res.json(), committed_before_usd: committed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    let body: any = {};
    try { body = await req.clone().json(); } catch { /* empty */ }
    // Cron may only run the bounded tick; every other action needs an admin.
    if (body.action === "tick" && body.trigger === "cron") return json(await tickAction(db));
    const userId = await requireAdmin(db, req);
    if (!userId) return json({ ok: false, error: "admin_required" }, 403);
    const controls = await loadControls(db);
    switch (body.action || "status") {
      case "tick": return json(await tickAction(db));
      case "status": return json(await statusAction(db, controls));
      case "preview": return json(await previewAction(db, controls, body));
      case "label_golden": return await labelGolden(db, userId, body);
      case "submit": return await submitAction(db, controls, userId, body);
      case "poll": return await pollAction(db, controls, body);
      case "cancel": {
        if (!UUID.test(body.job_id || "")) return json({ ok: false, error: "job_id_required" }, 400);
        const { data: job } = await db.from("person_relevance_batch_jobs").select("id,openai_batch_id,status").eq("id", body.job_id).maybeSingle();
        if (!job?.openai_batch_id) return json({ ok: false, error: "not_submitted" }, 400);
        const r = await openai(`/batches/${job.openai_batch_id}/cancel`, { method: "POST" });
        if (!r.ok) { await handleOpenAIFailure(db, r.status, r.error); return json({ ok: false, error: r.error }); }
        await db.from("person_relevance_batch_jobs").update({ status: "cancelling", updated_at: new Date().toISOString() }).eq("id", job.id);
        return json({ ok: true, status: "cancelling" });
      }
      case "release": {
        if (!UUID.test(body.job_id || "")) return json({ ok: false, error: "job_id_required" }, 400);
        const { data: job } = await db.from("person_relevance_batch_jobs").select("status").eq("id", body.job_id).maybeSingle();
        if (!job || !["aborted", "failed", "expired", "cancelled", "claimed"].includes(job.status)) return json({ ok: false, error: "job_not_releasable" }, 400);
        return json({ ok: true, released: await rpc(db, "release_person_openai_batch_job", { _job: body.job_id }) });
      }
      case "rollback": {
        if (!UUID.test(body.job_id || "") || body.confirm !== "ROLLBACK") return json({ ok: false, error: "job_id_and_confirm_required" }, 400);
        return json({ ok: true, result: await rpc(db, "rollback_person_openai_batch_job", { _job: body.job_id }) });
      }
      default: return json({ ok: false, error: "unknown_action" }, 400);
    }
  } catch (e) {
    console.error("person-relevance-openai-batch", String(e).slice(0, 300));
    return json({ ok: false, error: "internal_error" }, 500);
  }
});
