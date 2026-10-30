import { denyUntrustedCaller } from "../_shared/internal-auth.ts";
// Batched, source-grounded pair review. Durable decisions survive write retries.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { chatTokenCostUsd } from "../_shared/ai-pricing.ts";
import { callLovableAI, creditBreakerOpen, gatewayModel } from "../_shared/lovable-ai.ts";
import { boundedWork, checkProcessingPriority } from "../_shared/processing-priority.ts";
import { BATCH_TOOL, buildBatchPrompt, inputGuard, MAX_BATCH_CHARS, MAX_BATCH_ITEMS, packBatches, parseBatch,
  PROMPT_VERSION, review, type Decision, type Item } from "../_shared/person-relevance-batch.ts";

const MODEL = gatewayModel("gemini-2.5-flash-lite");
const RUN_MS = 50_000;
// Conservative headroom for a <=24k-character prompt and <=4096 output tokens.
const CALL_RESERVE_USD = 0.05;
type Work = Item & { person_id: string; episode_id: string; source_hash: string; cached_decision: Decision | null; model_used: string | null };
const json = (body: unknown) => Response.json(body, { headers: corsHeaders });

// Fail closed on unreadable controls or spend; never borrow a higher request budget.
async function state(db: any) {
  const [settings, spent] = await Promise.all([
    db.from("app_settings").select("key,value").in("key", ["person_relevance_judge_controls", "background_jobs", "ai_budget"]),
    db.from("ai_spend_daily").select("spend_usd,by_kind").eq("day", new Date().toISOString().slice(0, 10)).maybeSingle(),
  ]);
  if (settings.error || spent.error) throw new Error("controls_or_budget_unavailable");
  const values = Object.fromEntries((settings.data || []).map((r: any) => [r.key, r.value]));
  const controls = values.person_relevance_judge_controls;
  const global = values.ai_budget;
  const background = values.background_jobs;
  if (!controls || !global || !background) throw new Error("required_controls_missing");
  const caps = [Number(controls.daily_budget_usd), Number(global.per_job_caps_usd?.person_relevance ?? controls.daily_budget_usd),
    Number(global.per_job_caps_usd?.person_relevance_judge ?? controls.daily_budget_usd)];
  const globalCap = Number(global.daily_cap_usd);
  if (![...caps, globalCap].every(n => Number.isFinite(n) && n >= 0)) throw new Error("invalid_budget");
  const by = spent.data?.by_kind || {};
  const jobSpend = Math.max(Number(by.person_relevance || 0), Number(by.person_relevance_judge || 0));
  const globalSpend = Number(spent.data?.spend_usd || 0);
  if (![jobSpend, globalSpend].every(Number.isFinite)) throw new Error("invalid_spend");
  return { controls, enabled: controls.enabled === true && background.enabled === true && background.incident_mode !== true,
    headroom: Math.min(Math.min(...caps) - jobSpend, globalCap - globalSpend), jobSpend };
}

async function checkedRpc(db: any, name: string, args: Record<string, unknown>) {
  const result = await db.rpc(name, args);
  if (result.error) throw new Error(name + ": " + result.error.message);
  return result.data;
}

Deno.serve(async req => {
  { const denied = await denyUntrustedCaller(req, "person-relevance-judge"); if (denied) return denied; }
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: any = {};
  try { if (req.method === "POST") body = await req.json(); } catch { /* empty scheduled request */ }
  const token = crypto.randomUUID();
  const started = Date.now();
  let leased = false;
  let claims: Work[] = [];
  let processed = 0, accepted = 0, rejected = 0, needsReview = 0, waiting = 0, cached = 0, calls = 0, errors = 0;
  let spend = 0, reserved = 0, stop: string | null = null;
  const failures: string[] = [];
  let result: Record<string, unknown> = {};

  const cacheDecision = async (item: Work, decision: Decision, model: string) => {
    const saved = await db.from("person_relevance_work").update({ cached_hash: item.source_hash,
      cached_decision: decision, model_used: model, updated_at: new Date().toISOString() })
      .eq("person_id", item.person_id).eq("episode_id", item.episode_id).eq("claim_token", token)
      .eq("source_hash", item.source_hash).select("person_id").single();
    if (saved.error || !saved.data) throw new Error("cache_write_failed: " + (saved.error?.message || "claim_lost"));
  };
  const apply = async (item: Work) => {
    const applied = await checkedRpc(db, "apply_person_judge_pair", { _person: item.person_id, _episode: item.episode_id, _token: token });
    processed++;
    if (applied.status === "accepted") accepted++;
    else if (applied.status === "rejected") rejected++;
    else if (applied.status === "waiting_clean_text") waiting++;
    else needsReview++;
  };

  try {
    const initial = await state(db);
    if (!initial.enabled) return json({ ok: true, skipped: "paused" });
    const priority = await checkProcessingPriority(db, "person_relevance");
    if (priority) return json({ ok: true, skipped: priority });
    leased = await checkedRpc(db, "person_judge_run_lease", { _token: token });
    if (!leased) return json({ ok: true, skipped: "another_run_active" });
    const limit = Math.min(200, boundedWork(body.batch_limit, initial.controls.batch_limit, 40));
    const concurrency = Math.min(2, boundedWork(body.concurrency, initial.controls.concurrency, 1));
    const maxCalls = Math.min(40, boundedWork(body.max_ai_calls_per_run, initial.controls.max_ai_calls_per_run, 8));
    const batchSize = Math.min(MAX_BATCH_ITEMS, boundedWork(body.ai_batch_size, initial.controls.ai_batch_size, 6));
    const personIds = Array.isArray(body.person_ids) && body.person_ids.length ? body.person_ids : null;
    claims = (await checkedRpc(db, "claim_person_judge_pairs", { _limit: limit, _token: token, _person_ids: personIds }) || [])
      .map((item: Omit<Work, "key">, index: number) => ({ ...item, key: String(index) }));
    const paid: Work[] = [];
    for (const item of claims) {
      const guard = inputGuard(item.input);
      if (guard || item.cached_decision) {
        if (guard) await cacheDecision(item, guard, "input_guard");
        await apply(item);
        if (!guard) cached++;
      } else if (buildBatchPrompt([item]).length > MAX_BATCH_CHARS) {
        await cacheDecision(item, review("A forrás túl nagy az ellenőrzött AI-csomaghoz; külön ellenőrzés szükséges."), "input_guard");
        await apply(item);
      } else paid.push(item);
    }
    const batches = packBatches(paid, batchSize);
    let cursor = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (!stop && Date.now() - started < RUN_MS) {
        const batch = batches[cursor++];
        if (!batch) return;
        let holdsReserve = false;
        try {
          const spentBeforeCheck = spend;
          const live = await state(db);
          if (!live.enabled) { stop = "paused"; return; }
          const blocker = await checkProcessingPriority(db, "person_relevance");
          if (blocker) { stop = blocker; return; }
          if (await creditBreakerOpen()) { stop = "credit_breaker_open"; return; }
          if (stop) return;
          if (calls >= maxCalls) { stop = "run_call_limit"; return; }
          if (live.headroom - reserved - Math.max(0, spend - spentBeforeCheck) < CALL_RESERVE_USD) { stop = "daily_budget_reached"; return; }
          reserved += CALL_RESERVE_USD; holdsReserve = true; calls++;
          const batchId = crypto.randomUUID();
          const batchHash = batchId + ":" + batch.map(i => i.source_hash).join(":");
          const out = await callLovableAI({
            model: MODEL,
            messages: [{ role: "user", content: buildBatchPrompt(batch) }],
            tools: [BATCH_TOOL], tool_choice: { type: "function", function: { name: BATCH_TOOL.function.name } },
            temperature: 0, max_tokens: Math.min(4096, 512 + batch.length * 450),
            job_type: "person_relevance_judge", target_type: "person_episode_mention", target_id: batch[0].input.mentions[0]?.id,
            source_hash: batchHash, prompt_version: PROMPT_VERSION,
            input_text: batch.map(i => i.input.episode.clean_text || i.input.episode.summary || i.input.episode.title).join("\n"),
          });
          const cost = chatTokenCostUsd(out.model_used, out.input_tokens || 0, out.output_tokens || 0);
          if (!out.ok) {
            if (cost > 0) {
              await checkedRpc(db, "add_ai_spend", { p_day: new Date().toISOString().slice(0, 10), p_kind: "person_relevance", p_amount: cost, p_calls: 1 });
              spend += cost;
            }
            errors++; stop = out.status === 402 ? "credit_required" : "provider_error:" + out.status;
            failures.push(out.error || stop); return;
          }
          const raw = out.data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
          let parsed: unknown;
          try { parsed = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { parsed = null; }
          const decisions = parseBatch(parsed, batch);
          const rows = (parsed as { decisions?: { key?: string }[] })?.decisions;
          if (!Array.isArray(rows) || batch.some(item => rows.filter(r => r?.key === item.key).length !== 1)) {
            errors++; stop = "malformed_batch_response"; failures.push("Missing or duplicate batch response IDs");
          }
          // Atomic receipt, cache and actual spend: retries cannot double-charge the ledger.
          // Malformed paid answers are cached as needs_review, not sent to AI again.
          await checkedRpc(db, "cache_person_judge_batch", { _batch_id: batchId, _token: token, _source_hash: batchHash,
            _model: out.model_used, _cost: cost, _decisions: batch.map(item => ({ person_id: item.person_id,
              episode_id: item.episode_id, source_hash: item.source_hash, decision: decisions.get(item.key) })) });
          spend += cost;
          reserved -= CALL_RESERVE_USD; holdsReserve = false;
          for (const item of batch) await apply(item);
        } catch (error) {
          errors++; stop = "processing_error"; failures.push(String(error).slice(0, 240));
        } finally {
          if (holdsReserve) reserved -= CALL_RESERVE_USD;
        }
      }
    }));
    result = { ok: errors === 0, status: stop || (claims.length ? "completed" : "no_work"),
      claimed_pairs: claims.length, processed, accepted, rejected, needs_review: needsReview, waiting_clean_text: waiting,
      cached, errors, ai_calls_this_run: calls, spend_this_run_usd: spend, elapsed_ms: Date.now() - started,
      ...(failures.length ? { failures } : {}) };
    const pending = await db.from("person_episode_mentions")
      .select("id,podcasts!person_episode_mentions_podcast_id_fkey!inner(language_decision,is_hungarian)", { count: "exact", head: true })
      .in("relevance_status", ["pending", "in_progress"])
      .eq("podcasts.language_decision", "accept_hungarian").eq("podcasts.is_hungarian", true);
    if (!pending.error) result.remaining_pending = pending.count;
    // Refresh only touched people; a full-directory refresh timed out in production.
    if (processed > 0) {
      const hub = await db.rpc("refresh_people_hub_score_for", { _person_ids: [...new Set(claims.map(item => item.person_id))] });
      if (hub.error) result.hub_refresh_error = hub.error.message;
      else await db.rpc("person_judge_telemetry", { _patch: { last_hub_refresh_at: new Date().toISOString() } });
    }
  } catch (error) {
    errors++; result = { ok: false, status: "failed", processed, errors, error: String(error).slice(0, 300) };
  } finally {
    if (leased) {
      // Includes never-started items, HTTP errors and partial batches. Cache remains intact.
      const delay = errors > 0 ? 300_000 : 0;
      const released = await db.from("person_relevance_work").update({ lease_until: new Date(Date.now() + delay).toISOString() })
        .eq("claim_token", token);
      if (released.error) result.release_error = released.error.message;
      await db.rpc("person_judge_run_lease", { _token: token, _release: true });
      await db.rpc("person_judge_telemetry", { _patch: {
        last_run_at: new Date().toISOString(), last_run_status: result.status,
        last_processed: processed, last_accepted: accepted, last_rejected: rejected, last_needs_review: needsReview,
        last_waiting_clean_text: waiting, last_ai_calls: calls, last_cached: cached, last_errors: errors,
        last_spend_usd: spend, last_elapsed_ms: Date.now() - started, last_error: failures[0] || result.error || null,
        ...(result.remaining_pending != null ? { last_remaining_pending: result.remaining_pending } : {}),
      } });
    }
  }
  return json(result);
});
