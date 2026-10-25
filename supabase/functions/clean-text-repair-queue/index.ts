// Durable, bounded clean-text repair lane (RSS). Deterministic, $0, no AI.
//
// Each tick: (1) daily set-based reconciliation scan into clean_text_repair_queue
// (only when due), (2) claim ≤per_run rows with a lease (SKIP LOCKED), (3) plan
// with _shared/clean-text-rss-repair.ts + the stricter unattended gate in
// _shared/clean-text-repair-queue.ts, (4) apply through apply_clean_text_repair_v1
// (backup + CAS, one batch id per tick), (5) re-read and verify what was written
// — any failure rolls the batch back and trips the breaker, (6) complete every
// claimed row with a finite status. Progress/failures are persisted every run.
// Protected rows (active backups: reviewed canaries, earlier repairs), other
// source lanes (YouTube/Spotify/article), legacy YouTube-description text and
// runner-owned new episodes are never rewritten here.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { planRssRepair, type RssRepairPlan } from "../_shared/clean-text-rss-repair.ts";
import { autoApplySafetyReasons, backoffSeconds, recurringSentenceKeys, resolveRejectedPlan, stripRecurringSentences } from "../_shared/clean-text-repair-queue.ts";
import { lostNamedTokens } from "../_shared/clean-text-validation.ts";
import { unitKey } from "../_shared/youtube-source-gain.ts";
import { LEGACY_PROTECTED_BATCHES, LEGACY_YTDESC_METHOD, planLegacyYtdesc, type LegacyPlan } from "../_shared/clean-text-legacy-ytdesc.ts";
import { LEGACY_AI_CONFIRM, LEGACY_RESOLVE_CONFIRM, legacyAiReview, legacyResolveApply, legacyResolveDryRun, planResolve } from "./legacy-resolve.ts";
import { astraReview } from "./astra-review.ts";
const ASTRA_REVIEW_CONFIRM = "ASTRA_REVIEW_ADVISORY";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const CONTROLS_KEY = "clean_text_repair_queue_controls";
const APPLY_CHUNK = 40;
/** Other descriptions sampled per show for recurring-boilerplate detection (CPU-bounded). */
const RECURRING_SAMPLE = 16;
const CRON_JOB = "clean-text-repair-queue-hourly";
const STATE_KEY = "clean_text_repair_queue_state";
const DEFAULTS = {
  enabled: false,
  per_run: 50,
  daily_apply_cap: 1500,
  seed_interval_hours: 20,
  lease_seconds: 600,
  max_conflict_ratio: 0.2,
  breaker_failures: 3,
  stale_pending_hours: 2,
  // Legacy deterministic_v4+ytdesc lane (same queue, same cron, after regular rows).
  legacy_enabled: false,
  legacy_per_run: 40,
  legacy_daily_write_cap: 300,
};
const LEGACY_CANARY_CONFIRM = "LEGACY_YTDESC_CANARY";

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function loadLegacyInputs(admin: any, ids: string[]): Promise<any[]> {
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 25) {
    const { data, error } = await admin.rpc("clean_text_repair_queue_legacy_inputs_v1", { p_episode_ids: ids.slice(i, i + 25) });
    if (error) throw new Error(`legacy inputs: ${error.message}`);
    out.push(...((data || []) as any[]));
  }
  return out;
}

async function planLegacy(admin: any, ids: string[], method: string): Promise<{ plans: LegacyPlan[]; missing: string[]; foreign: string[] }> {
  const inputs = await loadLegacyInputs(admin, ids);
  const byId = new Map(inputs.map((x) => [String(x.id), x]));
  const plans: LegacyPlan[] = [];
  const missing: string[] = [];
  const foreign: string[] = [];
  for (const id of ids) {
    const x = byId.get(id);
    if (!x) { missing.push(id); continue; }
    if (x.is_hungarian !== true) { foreign.push(id); continue; }
    plans.push(await planLegacyYtdesc(x, { method, protectedBatches: LEGACY_PROTECTED_BATCHES }));
  }
  return { plans, missing, foreign };
}

/**
 * Apply legacy plans that write (≤40 per backup batch), verify each chunk by
 * re-reading, roll a chunk back on any defect. Returns queue completion rows.
 */
async function applyLegacy(admin: any, plans: LegacyPlan[], attemptsById: Map<string, number>) {
  const results: any[] = [];
  const batchIds: string[] = [];
  let stop: string | null = null;
  const writes = plans.filter((p) => p.write !== "none" && p.item);
  const done = new Set<string>();
  for (let i = 0; i < writes.length && !stop; i += APPLY_CHUNK) {
    const chunk = writes.slice(i, i + APPLY_CHUNK);
    const batch = crypto.randomUUID();
    const { data: res, error } = await admin.rpc("apply_clean_text_repair_v1", { p_batch_id: batch, p_items: chunk.map((p) => p.item) });
    if (error) {
      for (const p of chunk) { results.push({ episode_id: p.episode_id, status: "retry", outcome: "legacy_apply_error", reasons: [String(error.message).slice(0, 120)], retry_after_seconds: backoffSeconds(attemptsById.get(p.episode_id) || 1) }); done.add(p.episode_id); }
      stop = `apply_error:${String(error.message).slice(0, 200)}`;
      break;
    }
    const conflicts = new Set<string>(((res as any)?.conflict_episode_ids || []).map(String));
    const applied = chunk.filter((p) => !conflicts.has(p.episode_id));
    const { data: live, error: lErr } = await admin.from("episode_clean_text")
      .select("episode_id,source_hash,cleaned_text,source_type").in("episode_id", applied.map((p) => p.episode_id));
    if (lErr) throw lErr;
    const liveById = new Map(((live || []) as any[]).map((r) => [String(r.episode_id), r]));
    const defects: string[] = [];
    for (const p of applied) {
      const r = liveById.get(p.episode_id);
      const it: any = p.item;
      const txt = String(r?.cleaned_text || "");
      if (!r || r.source_hash !== it.source_hash || r.source_type !== it.source_type || txt.length < 40 || /https?:\/\/|www\.[a-z0-9-]+\./i.test(txt)
        || (await sha256Hex(txt.trim())) !== (await sha256Hex(String(it.cleaned_text).trim()))) defects.push(p.episode_id);
    }
    if (defects.length || Number((res as any)?.invalid || 0) > 0) {
      await admin.rpc("rollback_clean_text_repair_v1", { p_batch_id: batch });
      await tripBreaker(admin, `legacy_post_apply_verification_failed:${defects.length}_defects_${Number((res as any)?.invalid || 0)}_invalid`);
      for (const p of chunk) { results.push({ episode_id: p.episode_id, status: "needs_review", outcome: "legacy_rolled_back_verification", reasons: ["post_apply_verification_failed"], batch_id: batch }); done.add(p.episode_id); }
      stop = "rolled_back";
      break;
    }
    if (applied.length) batchIds.push(batch);
    for (const p of chunk) {
      done.add(p.episode_id);
      if (conflicts.has(p.episode_id)) {
        results.push({ episode_id: p.episode_id, status: "retry", outcome: "legacy_cas_conflict", reasons: ["cas_conflict"], retry_after_seconds: backoffSeconds(attemptsById.get(p.episode_id) || 1) });
      } else {
        results.push({ episode_id: p.episode_id, status: p.status, outcome: p.outcome, reasons: p.reasons.slice(0, 14), batch_id: batch });
      }
    }
  }
  for (const p of plans) {
    if (done.has(p.episode_id)) continue;
    if (p.write !== "none") { results.push({ episode_id: p.episode_id, status: "retry", outcome: "legacy_not_reached", reasons: ["stopped_before_apply"], retry_after_seconds: 900 }); continue; }
    results.push({ episode_id: p.episode_id, status: p.status, outcome: p.outcome, reasons: p.reasons.slice(0, 14), ...(p.status === "retry" ? { retry_after_seconds: 3600 } : {}) });
  }
  return { results, batchIds, stop };
}

function legacySummary(plans: LegacyPlan[]) {
  const c: Record<string, number> = {};
  for (const p of plans) { const k = `${p.bucket}:${p.outcome}`; c[k] = (c[k] || 0) + 1; }
  return c;
}

async function readSetting(admin: any, key: string) {
  const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  return ((data?.value as any) || {}) as any;
}
/** Re-read right before writing so a concurrent manual change is not undone. */
async function patchSetting(admin: any, key: string, patch: (fresh: any) => any) {
  const fresh = await readSetting(admin, key);
  const value = patch(fresh);
  const { error } = await admin.from("app_settings").upsert({ key, value }, { onConflict: "key" });
  if (error) console.error(`[clean-text-repair-queue] persist ${key}:`, error.message);
}

/** Per episode: sentence keys recurring in ≥2 other sampled RSS descriptions of its show (≤25 shows, 24 samples each). */
async function loadRecurringRssByEpisode(admin: any, episodeIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const { data: eps, error } = await admin.from("episodes").select("id,podcast_id,description").in("id", episodeIds);
  if (error) throw error;
  const byPodcast = new Map<string, any[]>();
  for (const e of (eps || []) as any[]) byPodcast.set(String(e.podcast_id), [...(byPodcast.get(String(e.podcast_id)) || []), e]);
  await Promise.all(Array.from(byPodcast.keys()).slice(0, 25).map(async (pid) => {
    const { data: ids, error: iErr } = await admin.from("episodes").select("id")
      .eq("podcast_id", pid).order("published_at", { ascending: false, nullsFirst: false }).limit(1500);
    if (iErr) throw iErr;
    const all = (ids || []) as any[];
    if (all.length < 4) return;
    const step = Math.max(1, all.length / RECURRING_SAMPLE);
    const pick = Array.from(new Set(Array.from({ length: Math.min(RECURRING_SAMPLE, all.length) }, (_, i) => String(all[Math.floor(i * step)].id))));
    const { data: descs, error: dErr } = await admin.from("episodes").select("id,description").in("id", pick);
    if (dErr) throw dErr;
    const sample = ((descs || []) as any[]).map((d) => ({ id: String(d.id), description: String(d.description || "") }));
    for (const e of byPodcast.get(pid) || []) {
      out.set(String(e.id), recurringSentenceKeys(sample.filter((x) => x.id !== String(e.id)).map((x) => x.description), unitKey, 2));
    }
  }));
  return out;
}

async function isAdmin(admin: any, authHeader: string | null) {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token && token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const { data: u } = await admin.auth.getUser(token).catch(() => ({ data: null }));
  if (!u?.user) return false;
  const { data: r } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  return !!r;
}

async function tripBreaker(admin: any, reason: string) {
  await patchSetting(admin, CONTROLS_KEY, (fresh) => ({
    ...DEFAULTS, ...fresh, enabled: false, auto_paused_at: new Date().toISOString(),
    auto_paused_by: "clean-text-repair-queue", auto_paused_reason: reason,
  }));
}

/** Backstop: new episodes must never wait on a queue-health pause. */
async function ensureRunnerAwake(admin: any, staleHours: number) {
  const cutoff = new Date(Date.now() - staleHours * 3600_000).toISOString();
  // Hungarian only: the runner never processes foreign/uncertain shows, so their pending rows are not a stall.
  const { data } = await admin.from("episodes").select("id,podcasts!inner(language_decision)")
    .eq("clean_text_status", "pending").eq("podcasts.language_decision", "accept_hungarian").lt("created_at", cutoff).limit(1);
  if (!data?.length) return { stale_pending: false, resumed: false };
  const ctrl = await readSetting(admin, "episode_clean_text_controls");
  if (ctrl.enabled !== false || ctrl.manually_paused_reason) return { stale_pending: true, resumed: false };
  await patchSetting(admin, "episode_clean_text_controls", (fresh) =>
    fresh.enabled === false && !fresh.manually_paused_reason
      ? { ...fresh, enabled: true, auto_resumed_at: new Date().toISOString(), auto_resumed_reason: "repair_queue_stale_pending_backstop" }
      : fresh);
  return { stale_pending: true, resumed: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "tick");
  const owner = `ctq-${crypto.randomUUID()}`;
  let claimedIds: string[] = [];
  try {
    const adminCall = await isAdmin(admin, req.headers.get("Authorization"));
    const ctrl = { ...DEFAULTS, ...(await readSetting(admin, CONTROLS_KEY)) };

    if (action === "status") {
      const { data, error } = await admin.rpc("clean_text_repair_queue_status_v1");
      if (error) throw error;
      return json({ ok: true, action, controls: ctrl, state: await readSetting(admin, STATE_KEY), queue: data });
    }
    if (action === "legacy_dry_run" || action === "legacy_canary") {
      if (!adminCall) return json({ ok: false, error: "admin only" }, 403);
      const ids = Array.isArray(body.episode_ids) ? body.episode_ids.map(String).slice(0, 50) : [];
      if (!ids.length) return json({ ok: false, error: "episode_ids required (≤50)" }, 400);
      const ct = await readSetting(admin, "episode_clean_text_controls");
      const method = String(ct.method_version || "deterministic_v4");
      if (action === "legacy_dry_run") {
        const { plans, missing, foreign } = await planLegacy(admin, ids, method);
        return json({ ok: true, action, summary: legacySummary(plans), missing, foreign,
          plans: plans.map((p) => ({ episode_id: p.episode_id, bucket: p.bucket, status: p.status, outcome: p.outcome, write: p.write, reasons: p.reasons, provenance: p.provenance, identity: p.identity, prior_len: p.prior_len, next_len: p.next_len, preview: body.previews ? p.preview : undefined })) });
      }
      if (body.confirm !== LEGACY_CANARY_CONFIRM) return json({ ok: false, error: `confirm must be ${LEGACY_CANARY_CONFIRM}` }, 400);
      const g = await checkBackgroundJobsAllowed(admin, "clean-text-repair-queue");
      if (g.blocked) return json({ ok: true, skipped: true, reason: g.reason });
      const { data: cl, error: clErr } = await admin.rpc("claim_clean_text_repair_queue_ids_v1", { p_owner: owner, p_ids: ids, p_lease_seconds: Number(ctrl.lease_seconds) });
      if (clErr) throw clErr;
      claimedIds = ((cl || []) as any[]).map((c) => String(c.episode_id));
      const attempts = new Map(((cl || []) as any[]).map((c) => [String(c.episode_id), Number(c.attempts || 1)]));
      const { plans, missing, foreign } = await planLegacy(admin, claimedIds, method);
      const { results, batchIds, stop } = await applyLegacy(admin, plans, attempts);
      for (const id of missing) results.push({ episode_id: id, status: "done", outcome: "episode_missing", reasons: [] });
      for (const id of foreign) results.push({ episode_id: id, status: "done", outcome: "not_hungarian", reasons: [] });
      const { error: compErr } = await admin.rpc("complete_clean_text_repair_queue_v1", { p_owner: owner, p_results: results });
      if (compErr) throw new Error(`complete: ${compErr.message}`);
      claimedIds = [];
      await patchSetting(admin, STATE_KEY, (f) => ({ ...f, legacy_batch_ids: [...(f.legacy_batch_ids || []), ...batchIds].slice(-300), legacy_canary_batch_ids: [...(f.legacy_canary_batch_ids || []), ...batchIds] }));
      return json({ ok: true, action, claimed: attempts.size, summary: legacySummary(plans), batch_ids: batchIds, stop,
        results: results.map((r) => ({ episode_id: r.episode_id, status: r.status, outcome: r.outcome, batch_id: r.batch_id })) });
    }
    if (action === "legacy_resolve_dry_run" || action === "legacy_resolve_apply" || action === "legacy_ai_review") {
      if (!adminCall) return json({ ok: false, error: "admin only" }, 403);
      const ids = Array.isArray(body.episode_ids) ? body.episode_ids.map(String).slice(0, 50) : [];
      if (!ids.length) return json({ ok: false, error: "episode_ids required (≤50)" }, 400);
      const ct = await readSetting(admin, "episode_clean_text_controls");
      const method = String(ct.method_version || "deterministic_v4");
      const deps = { loadLegacyInputs, loadRecurringRssByEpisode, applyLegacy, readSetting, patchSetting };
      if (action === "legacy_resolve_dry_run") return json({ ok: true, action, ...(await legacyResolveDryRun(admin, deps, ids, method, body.previews === true)) });
      const g = await checkBackgroundJobsAllowed(admin, "clean-text-repair-queue");
      if (g.blocked) return json({ ok: true, skipped: true, reason: g.reason });
      if (action === "legacy_ai_review") {
        if (body.confirm !== LEGACY_AI_CONFIRM) return json({ ok: false, error: `confirm must be ${LEGACY_AI_CONFIRM}` }, 400);
        return json({ action, ...(await legacyAiReview(admin, deps, ids, method)) });
      }
      if (body.confirm !== LEGACY_RESOLVE_CONFIRM) return json({ ok: false, error: `confirm must be ${LEGACY_RESOLVE_CONFIRM}` }, 400);
      // ≤20 per apply call: larger backup batches hit the database statement timeout (2026-10-21).
      const out = await legacyResolveApply(admin, deps, owner, ids.slice(0, 20), method, Number(ctrl.lease_seconds));
      return json({ ok: true, action, ...out });
    }
    if (action === "astra_review") {
      // Advisory only (owner 2026-10-25): records Astra's recommendation, never writes text or queue status.
      if (!adminCall) return json({ ok: false, error: "admin only" }, 403);
      if (body.confirm !== ASTRA_REVIEW_CONFIRM) return json({ ok: false, error: `confirm must be ${ASTRA_REVIEW_CONFIRM}` }, 400);
      const ids = Array.isArray(body.episode_ids) ? body.episode_ids.map(String).slice(0, 12) : [];
      if (!ids.length) return json({ ok: false, error: "episode_ids required (≤12)" }, 400);
      const g = await checkBackgroundJobsAllowed(admin, "clean-text-repair-queue");
      if (g.blocked) return json({ ok: true, skipped: true, reason: g.reason });
      const ct = await readSetting(admin, "episode_clean_text_controls");
      const method = String(ct.method_version || "deterministic_v4");
      const deps = { loadLegacyInputs, loadRecurringRssByEpisode, applyLegacy, readSetting, patchSetting, planResolve };
      return json({ action, ...(await astraReview(admin, deps, ids, method)) });
    }
    if (action !== "tick") return json({ ok: false, error: "unknown action" }, 400);

    const guard = await checkBackgroundJobsAllowed(admin, "clean-text-repair-queue");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });
    const force = adminCall && body.force === true; // admin canary while the lane is disabled
    if (ctrl.enabled !== true && !force) return json({ ok: true, paused: true, reason: ctrl.auto_paused_reason || "disabled" });

    const state = await readSetting(admin, STATE_KEY);
    const out: Record<string, unknown> = { ok: true, action };

    // 1) Reconciliation scan (set-based, daily).
    const seedDue = !state.last_seed_at || Date.now() - Date.parse(state.last_seed_at) > Number(ctrl.seed_interval_hours) * 3600_000;
    if (seedDue || (adminCall && body.seed === true)) {
      const { data, error } = await admin.rpc("clean_text_repair_queue_seed_v1");
      if (error) throw new Error(`seed: ${error.message}`);
      out.seed = data;
      await patchSetting(admin, STATE_KEY, (f) => ({ ...f, last_seed_at: new Date().toISOString(), last_seed: data }));
    }

    // 2) New-episode backstop.
    out.runner_backstop = await ensureRunnerAwake(admin, Number(ctrl.stale_pending_hours));

    // 3) Claim within the per-run and daily caps.
    const { data: qs, error: qsErr } = await admin.rpc("clean_text_repair_queue_status_v1");
    if (qsErr) throw qsErr;
    const appliedToday = Number((qs as any)?.applied_today || 0);
    // ≤50 per run: planning is regex-heavy and edge CPU time is limited.
    const perRun = Math.max(1, Math.min(50, Number(adminCall && body.limit ? body.limit : ctrl.per_run)));
    const room = Math.max(0, Number(ctrl.daily_apply_cap) - appliedToday);
    const take = Math.min(perRun, room);
    if (take === 0) {
      out.capped = true;
    }
    const { data: claimed, error: cErr } = take > 0
      ? await admin.rpc("claim_clean_text_repair_queue_v2", { p_owner: owner, p_limit: take, p_lease_seconds: Number(ctrl.lease_seconds), p_lane: "regular" })
      : { data: [], error: null };
    if (cErr) throw cErr;
    const claims = (claimed || []) as Array<{ episode_id: string; attempts: number; repair_kind: string }>;
    claimedIds = claims.map((c) => String(c.episode_id));

    const results: any[] = [];
    const legacyFromRegular: string[] = [];
    const outcomes: Record<string, number> = {};
    const tally = (k: string) => { outcomes[k] = (outcomes[k] || 0) + 1; };
    let batchId: string | null = null;
    const runBatchIds: string[] = [];
    let applyResult: any = null;
    const samples: any[] = [];

    if (claimedIds.length) {
      const { data: targets, error: tErr } = await admin.rpc("clean_text_repair_queue_targets_v1", { p_episode_ids: claimedIds });
      if (tErr) throw tErr;
      const byId = new Map(((targets || []) as any[]).map((t) => [String(t.episode_id), t]));
      const ct = await readSetting(admin, "episode_clean_text_controls");
      const method = String(ct.method_version || "deterministic_v4");
      const toApply: { plan: RssRepairPlan; item: any }[] = [];
      const cands: { plan: RssRepairPlan; t: any }[] = [];
      for (const c of claims) {
        const t = byId.get(String(c.episode_id));
        // An RSS change on a legacy YouTube-derived text is decided by the legacy planner.
        if (t && t.is_hungarian && String(t.current_cleaner_method || "").startsWith(LEGACY_YTDESC_METHOD)) { legacyFromRegular.push(String(c.episode_id)); continue; }
        if (!t) { results.push({ episode_id: c.episode_id, status: "done", outcome: "episode_missing", reasons: [] }); tally("episode_missing"); continue; }
        if (!t.is_hungarian) { results.push({ episode_id: c.episode_id, status: "done", outcome: "not_hungarian", reasons: [] }); tally("not_hungarian"); continue; }
        const plan = await planRssRepair(t, { method });
        if (plan.outcome === "apply" && plan.item) { cands.push({ plan, t }); continue; }
        const r = resolveRejectedPlan(plan);
        results.push({ episode_id: c.episode_id, status: r.status, outcome: r.outcome, reasons: plan.reasons.slice(0, 12), retry_after_seconds: r.retry_after_seconds });
        tally(`${r.status}:${r.outcome}`);
      }

      // Show-level boilerplate (taglines, paywall/subscription notes, music credits)
      // recurring in the show's other RSS descriptions is removed before the gate.
      const recurringByEp = cands.length ? await loadRecurringRssByEpisode(admin, cands.map((x) => String(x.t.episode_id))) : new Map();
      for (const { plan, t } of cands) {
        const item: any = { ...plan.item };
        const rec = recurringByEp.get(String(t.episode_id));
        if (rec && rec.size) {
          const stripped = stripRecurringSentences(String(item.cleaned_text), rec, unitKey);
          const prior = String(t.current_cleaned_text || "").trim();
          if (stripped !== item.cleaned_text && !(prior && lostNamedTokens(prior, stripped).length)) {
            item.cleaned_text = stripped;
            item.removed_categories = Array.from(new Set([...(item.removed_categories || []), "show_recurring_boilerplate"]));
          }
        }
        const gate = autoApplySafetyReasons(String(item.cleaned_text || ""), plan.lost_from_source, { priorLen: plan.prior_len });
        if (gate.length) {
          results.push({ episode_id: t.episode_id, status: "needs_review", outcome: "auto_gate", reasons: gate });
          tally("needs_review:auto_gate");
          continue;
        }
        toApply.push({ plan, item: { ...item, quality_reasons: [...(item.quality_reasons || []), "rss_repair_queue_v1"] } });
      }

      // 4–5) Apply in chunks of ≤40 (one backup batch id each; larger single
      // statements hit the statement timeout), verify each chunk, roll back on defects.
      const batchIds: string[] = [];
      const applyResults: any[] = [];
      for (let i = 0; i < toApply.length; i += APPLY_CHUNK) {
        const chunk = toApply.slice(i, i + APPLY_CHUNK);
        const chunkBatch = crypto.randomUUID();
        const { data: res, error: aErr } = await admin.rpc("apply_clean_text_repair_v1", { p_batch_id: chunkBatch, p_items: chunk.map((x) => x.item) });
        if (aErr) {
          // The RPC is one transaction: nothing from this chunk was written. Retry later.
          for (const x of chunk) {
            const id = String(x.item.episode_id);
            const attempts = claims.find((c) => String(c.episode_id) === id)?.attempts || 1;
            results.push({ episode_id: id, status: "retry", outcome: "apply_error", reasons: [String(aErr.message).slice(0, 120)], retry_after_seconds: backoffSeconds(attempts) });
          }
          tally("retry:apply_error");
          out.apply_error = String(aErr.message).slice(0, 300);
          break;
        }
        applyResults.push(res);
        const conflicts = new Set<string>(((res as any)?.conflict_episode_ids || []).map(String));
        const appliedItems = chunk.filter((x) => !conflicts.has(String(x.item.episode_id)));
        const { data: live, error: lErr } = await admin.from("episode_clean_text")
          .select("episode_id,source_hash,cleaned_text").in("episode_id", appliedItems.map((x) => x.item.episode_id));
        if (lErr) throw lErr;
        const liveById = new Map(((live || []) as any[]).map((r) => [String(r.episode_id), r]));
        const defects = appliedItems.filter((x) => {
          const r = liveById.get(String(x.item.episode_id));
          const txt = String(r?.cleaned_text || "");
          return !r || r.source_hash !== x.item.source_hash || txt.length < 40 || /https?:\/\/|www\.[a-z0-9-]+\./i.test(txt);
        });
        if (defects.length || Number((res as any)?.invalid || 0) > 0) {
          const { data: rb } = await admin.rpc("rollback_clean_text_repair_v1", { p_batch_id: chunkBatch });
          await tripBreaker(admin, `post_apply_verification_failed:${defects.length}_defects_${Number((res as any)?.invalid || 0)}_invalid`);
          for (const x of chunk) results.push({ episode_id: x.item.episode_id, status: "needs_review", outcome: "rolled_back_verification", reasons: ["post_apply_verification_failed"], batch_id: chunkBatch });
          out.rollback = rb;
          tally("rolled_back");
          break;
        }
        if (appliedItems.length) batchIds.push(chunkBatch);
        for (const x of chunk) {
          const id = String(x.item.episode_id);
          const attempts = claims.find((c) => String(c.episode_id) === id)?.attempts || 1;
          if (conflicts.has(id)) {
            results.push({ episode_id: id, status: "retry", outcome: "cas_conflict", reasons: ["cas_conflict"], retry_after_seconds: backoffSeconds(attempts) });
            tally("retry:cas_conflict");
          } else {
            results.push({ episode_id: id, status: "done", outcome: "applied", reasons: x.plan.reasons, batch_id: chunkBatch });
            tally("done:applied");
            if (adminCall && samples.length < Math.min(50, Number(body.samples || 0))) {
              samples.push({ episode_id: id, prior_len: x.plan.prior_len, prior_method: x.plan.prior_method, next_len: x.plan.next_len, preview: x.plan.preview });
            }
          }
        }
        if (chunk.length >= 5 && conflicts.size / chunk.length > Number(ctrl.max_conflict_ratio)) {
          await tripBreaker(admin, `conflict_ratio_${conflicts.size}_of_${chunk.length}`);
          out.breaker = "conflict_ratio";
          break;
        }
      }
      // Rows not reached after a stop (error/rollback/breaker) go back to the queue.
      const handled = new Set(results.map((r) => String(r.episode_id)));
      for (const x of toApply) {
        const id = String(x.item.episode_id);
        if (!handled.has(id)) results.push({ episode_id: id, status: "retry", outcome: "not_reached", reasons: ["stopped_before_apply"], retry_after_seconds: 900 });
      }
      batchId = batchIds[batchIds.length - 1] ?? null;
      runBatchIds.push(...batchIds);
      applyResult = applyResults;

      const { data: comp, error: compErr } = await admin.rpc("complete_clean_text_repair_queue_v1", { p_owner: owner, p_results: results });
      if (compErr) throw new Error(`complete: ${compErr.message}`);
      out.completed = (comp as any)?.completed ?? 0;
    }

    // Legacy lane: same run, only with capacity left after regular rows, own daily write cap.
    const legacyOutcomes: Record<string, number> = {};
    const legacyBatchIds: string[] = [];
    let legacyClaimed = 0;
    const legacyOn = ctrl.legacy_enabled === true || (force && body.legacy === true);
    const legacyRoom = Math.max(0, Number(ctrl.legacy_daily_write_cap) - Number((qs as any)?.legacy_writes_today || 0));
    const legacyTake = legacyOn ? Math.min(Number(ctrl.legacy_per_run), Math.max(0, perRun - claimedIds.length), legacyRoom) : 0;
    if (legacyOn && legacyRoom === 0) out.legacy_capped = true;
    if (legacyTake > 0 || legacyFromRegular.length) {
      const lowner = `${owner}-legacy`;
      const { data: lc, error: lcErr } = legacyTake > 0
        ? await admin.rpc("claim_clean_text_repair_queue_v2", { p_owner: lowner, p_limit: legacyTake, p_lease_seconds: Number(ctrl.lease_seconds), p_lane: "legacy" })
        : { data: [], error: null };
      if (lcErr) throw lcErr;
      const legacyIds = ((lc || []) as any[]).map((c) => String(c.episode_id));
      claimedIds = [...claimedIds, ...legacyIds];
      legacyClaimed = legacyIds.length;
      const attempts = new Map(((lc || []) as any[]).map((c) => [String(c.episode_id), Number(c.attempts || 1)]));
      const ct = await readSetting(admin, "episode_clean_text_controls");
      const method = String(ct.method_version || "deterministic_v4");
      for (const [ids, own] of [[legacyIds, lowner], [legacyFromRegular, owner]] as Array<[string[], string]>) {
        if (!ids.length) continue;
        const { plans, missing, foreign } = await planLegacy(admin, ids, method);
        const { results: lr, batchIds, stop } = await applyLegacy(admin, plans, own === owner ? new Map(claims.map((c) => [String(c.episode_id), c.attempts])) : attempts);
        for (const id of missing) lr.push({ episode_id: id, status: "done", outcome: "episode_missing", reasons: [] });
        for (const id of foreign) lr.push({ episode_id: id, status: "done", outcome: "not_hungarian", reasons: [] });
        const { error: lcompErr } = await admin.rpc("complete_clean_text_repair_queue_v1", { p_owner: own, p_results: lr });
        if (lcompErr) throw new Error(`legacy complete: ${lcompErr.message}`);
        for (const r of lr) legacyOutcomes[`${r.status}:${r.outcome}`] = (legacyOutcomes[`${r.status}:${r.outcome}`] || 0) + 1;
        legacyBatchIds.push(...batchIds);
        if (stop) { out.legacy_stop = stop; break; }
      }
      out.legacy = { claimed: legacyClaimed, from_regular: legacyFromRegular.length, outcomes: legacyOutcomes, batch_ids: legacyBatchIds };
    }

    const { data: qAfter } = await admin.rpc("clean_text_repair_queue_status_v1");
    const open = Number((qAfter as any)?.open || 0);
    const legacyOpen = legacyOn ? Number((qAfter as any)?.legacy_open || 0) : 0;
    // Adaptive cadence: twice an hour while historical work is open, hourly once drained
    // (hourly still picks up RSS description changes and requeued retries).
    const { data: cronMsg } = await admin.rpc("set_runner_cron", { p_job_name: CRON_JOB, p_schedule: open + legacyOpen > 0 ? "11,41 * * * *" : "41 * * * *" });
    out.cron = cronMsg;
    const applied = outcomes["done:applied"] || 0;
    await patchSetting(admin, STATE_KEY, (f) => {
      const drained = open === 0 && legacyOpen === 0 && !!f.last_seed_at;
      return {
        ...f,
        last_run_at: new Date().toISOString(),
        last_run_ms: Date.now() - startedAt,
        last_run_ok: true,
        last_error: null,
        consecutive_failures: 0,
        last_claimed: claimedIds.length,
        last_outcomes: outcomes,
        last_batch_id: applied ? batchId : f.last_batch_id ?? null,
        batch_ids: [...(f.batch_ids || []), ...runBatchIds].slice(-300),
        // Attempts (rolled-back and redone rows counted again); unique episodes: unique_applied.
        total_applied: Number(f.total_applied || 0) + applied,
        unique_applied: Number((qAfter as any)?.unique_applied || 0),
        leased_expired_after_run: Number((qAfter as any)?.leased_expired || 0),
        legacy_enabled: legacyOn,
        legacy_open_after_run: Number((qAfter as any)?.legacy_open || 0),
        legacy_writes_today: Number((qAfter as any)?.legacy_writes_today || 0),
        legacy_last_claimed: legacyClaimed,
        legacy_last_outcomes: legacyOutcomes,
        legacy_batch_ids: [...(f.legacy_batch_ids || []), ...legacyBatchIds].slice(-300),
        legacy_total_evaluated: Number(f.legacy_total_evaluated || 0) + legacyClaimed + legacyFromRegular.length,
        total_processed: Number(f.total_processed || 0) + claimedIds.length,
        open_after_run: open,
        archive_drained: drained,
        archive_drained_at: drained ? (f.archive_drained_at || new Date().toISOString()) : null,
      };
    });
    return json({ ...out, claimed: claimedIds.length, outcomes, batch_ids: runBatchIds, apply: applyResult, queue: qAfter, samples: adminCall ? samples : undefined, elapsed_ms: Date.now() - startedAt });
  } catch (e) {
    const msg = e instanceof Error ? e.message : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
    console.error("[clean-text-repair-queue] fatal:", msg);
    // Hand claimed rows back as retry (finite: retry beyond max_attempts becomes dead).
    // Only rows still leased by this run's owners change (completed rows are untouched).
    if (claimedIds.length) {
      for (const own of [owner, `${owner}-legacy`]) {
        await admin.rpc("complete_clean_text_repair_queue_v1", {
          p_owner: own,
          p_results: claimedIds.map((id) => ({ episode_id: id, status: "retry", outcome: "run_error", reasons: [msg.slice(0, 120)], retry_after_seconds: 900 })),
        }).then(() => null, () => null);
      }
    }
    let failures = 0;
    await patchSetting(admin, STATE_KEY, (f) => {
      failures = Number(f.consecutive_failures || 0) + 1;
      return { ...f, last_run_at: new Date().toISOString(), last_run_ok: false, last_error: msg.slice(0, 500), consecutive_failures: failures, last_claimed: claimedIds.length };
    });
    const ctrl = { ...DEFAULTS, ...(await readSetting(admin, CONTROLS_KEY)) };
    if (failures >= Number(ctrl.breaker_failures)) await tripBreaker(admin, `consecutive_failures_${failures}`);
    return json({ ok: false, error: msg }, 500);
  }
});
