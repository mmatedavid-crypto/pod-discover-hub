// Selects the best available processing text for each episode — incrementally.
//
// 0) Fast lane: durable source-change queue (episode_source_change_queue, filled
//    by a DB trigger only on real confirmed YouTube-link changes). Claimed with a
//    lease (SKIP LOCKED), acked with change_seq so a change that lands during
//    processing is not lost; failures back off and become visible dead letters.
// 1) Change feeds (keyset on (updated_at, id), index-backed) over transcripts,
//    confirmed YouTube links, confirmed publisher articles and Spotify meta —
//    the archival lane, durable cursors.
// 2) Optional staged backfill over the verified-YouTube target set
//    (best_source_youtube_gain_targets_v1, keyset on episode_id).
// 3) Optional verified-YouTube re-clean of already-done clean text: bounded per
//    run, daily-capped (with a reserve for fast-lane episodes), backed up and
//    compare-and-swap via apply_clean_text_repair_v1 (rollback through
//    clean-text-repair). Fast-lane episodes whose YouTube source stopped being
//    verified get their YouTube-derived clean text rebuilt from RSS.
// Policy: _shared/best-text-source-policy.ts + _shared/youtube-source-gain.ts.
//
// Run accounting (2026-10-24): every run writes a pipeline_runner_runs row at start,
// a heartbeat with the current stage (and the item ids it is working on) at each
// stage, and ok/error at the end. A run killed by the edge CPU/wall limit never
// reaches catch, so its row stays `running`; the next run marks it `killed`, shrinks
// its own batch (÷4 per consecutive kill) and isolates a single offending item in
// pipeline_item_blocks. Selection compute is metered (cpu budget); episodes past the
// budget are deferred: cursors stop before them and fast-lane items are released
// without counting an attempt. A cron dispatch (pg_net) is never counted as progress:
// only an `ok` run row / last_success_at is.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { BEST_SOURCE_POLICY_VERSION } from "../_shared/best-text-source-policy.ts";
import { feedQuotas } from "../_shared/youtube-source-gain.ts";
import {
  applyYoutubeReclean,
  computeSelections,
  planRssRevert,
  planSpotifyReclean,
  planYoutubeReclean,
  upsertSelections,
} from "../_shared/best-text-source-core.ts";
import {
  consecutiveKills,
  isolationLimit,
  itemToIsolate,
  laneBudgets,
  processedPrefix,
  recleanAllowances,
  spotifyRecleanAllowance,
} from "../_shared/best-text-source-lanes.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type Cursor = { ts: string; id: string } | null;
type FeedName = "transcript" | "youtube" | "article" | "spotify";
const FEEDS: FeedName[] = ["transcript", "youtube", "article", "spotify"];
const STATE_KEY = "episode_best_text_source_state";
const RUNNER = "episode-best-text-source-runner";
const MAX_TARGETS = 60; // AGENTS.md: ≤60 episodes per call (edge CPU)
const DEFAULT_SELECTION_CPU_BUDGET_MS = 900;
const KILLED_AFTER_MS = 4 * 60_000; // edge wall limit is 150 s; a silent row older than this was killed

function feedQuery(admin: any, feed: FeedName) {
  switch (feed) {
    case "transcript":
      return admin.from("episode_transcripts").select("id,episode_id,updated_at").eq("status", "ok");
    case "youtube":
      return admin.from("episode_youtube_links").select("id,episode_id,updated_at").eq("status", "confirmed");
    case "article":
      return admin.from("episode_article_candidates").select("id,episode_id,updated_at").eq("status", "confirmed");
    case "spotify":
      return admin.from("episode_spotify_meta").select("id,episode_id,updated_at");
  }
}

async function readFeed(admin: any, feed: FeedName, cursor: Cursor, limit: number) {
  let q = feedQuery(admin, feed).not("updated_at", "is", null);
  // gte gives the index a range start at the cursor; without it every call
  // re-reads (and filters out) all rows before the cursor.
  if (cursor) q = q.gte("updated_at", cursor.ts).or(`updated_at.gt.${cursor.ts},and(updated_at.eq.${cursor.ts},id.gt.${cursor.id})`);
  const { data, error } = await q.order("updated_at", { ascending: true }).order("id", { ascending: true }).limit(limit);
  if (error) throw new Error(`${feed} feed: ${error.message}`);
  const rows = (data || []) as Array<{ id: string; episode_id: string; updated_at: string }>;
  return { rows, exhausted: rows.length < limit };
}

async function readState(admin: any) {
  const { data } = await admin.from("app_settings").select("value").eq("key", STATE_KEY).maybeSingle();
  return ((data?.value as any) || {}) as any;
}

/** Re-read state right before writing so a concurrent manual change is not undone; merge only our keys. */
async function persistState(admin: any, patch: (fresh: any) => any) {
  const fresh = await readState(admin);
  const value = patch(fresh);
  await admin.from("app_settings").upsert({ key: STATE_KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

async function queueSizes(admin: any) {
  const [p, d] = await Promise.all([
    admin.from("episode_source_change_queue").select("episode_id", { count: "exact", head: true }).eq("status", "pending"),
    admin.from("episode_source_change_queue").select("episode_id", { count: "exact", head: true }).eq("status", "dead"),
  ]);
  return { pending: p.count ?? null, dead: d.count ?? null };
}

/** Durable run log: start row, stage heartbeats (with the ids being worked on), completion. */
function runLog(admin: any) {
  let id: string | null = null;
  let stageStart = Date.now();
  let current = "init";
  const stageMs: Record<string, number> = {};
  const close = () => { stageMs[current] = (stageMs[current] || 0) + (Date.now() - stageStart); };
  return {
    get id() { return id; },
    stageMs,
    async start(meta: any) {
      try {
        const { data } = await admin.from("pipeline_runner_runs").insert({ runner: RUNNER, stage: "init", meta }).select("id").single();
        id = data?.id ?? null;
      } catch (_) { id = null; }
    },
    async beat(stage: string, patch: Record<string, unknown> = {}) {
      close();
      current = stage;
      stageStart = Date.now();
      if (!id) return;
      try {
        await admin.from("pipeline_runner_runs").update({ stage, heartbeat_at: new Date().toISOString(), stage_ms: stageMs, ...patch }).eq("id", id);
      } catch (_) { /* telemetry only */ }
    },
    async finish(outcome: "ok" | "error", patch: Record<string, unknown> = {}) {
      close();
      if (!id) return;
      try {
        await admin.from("pipeline_runner_runs").update({ outcome, finished_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(), stage: current, stage_ms: stageMs, ...patch }).eq("id", id);
      } catch (_) { /* telemetry only */ }
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  let admin: any = null;
  let mode = "incremental";
  let stage = "init";
  let lease: { token: string; items: Array<{ episode_id: string; change_seq: number }> } | null = null;
  let log: ReturnType<typeof runLog> | null = null;
  const setStage = async (s: string, patch: Record<string, unknown> = {}) => { stage = s; if (log) await log.beat(s, patch); };
  try {
    admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, RUNNER);
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));
    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "episode_best_text_source_controls").maybeSingle();
    const ctrl = ctrlRow?.value || {};
    if (ctrl.enabled === false && !body.force) return json({ ok: true, paused: true });
    const dryRun = body.dry_run === true;

    const limit = Math.max(1, Math.min(MAX_TARGETS, Number(body.limit || ctrl.incremental_batch_limit || 40)));
    // Explicit ids are copied, never aliased: the feed loop below must not turn an
    // incremental run into an "ids" run (that bug froze every cursor at null).
    const explicitIds: string[] = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean).slice(0, limit) : [];
    mode = explicitIds.length ? "ids" : "incremental";
    const tracked = mode === "incremental" && !dryRun;

    // --- Run log + kill detection / isolation ---
    log = runLog(admin);
    const nowIso = new Date().toISOString();
    await admin.from("pipeline_runner_runs")
      .update({ outcome: "killed", finished_at: nowIso, error: "no_completion_heartbeat_stale_worker_killed" })
      .eq("runner", RUNNER).eq("outcome", "running").lt("heartbeat_at", new Date(Date.now() - KILLED_AFTER_MS).toISOString());
    const { data: recentRuns } = await admin.from("pipeline_runner_runs")
      .select("id,outcome,stage,target_ids,meta,started_at")
      .eq("runner", RUNNER).eq("meta->>tracked", "true")
      .order("started_at", { ascending: false }).limit(8);
    const recent = ((recentRuns || []) as any[]).filter((r) => r.outcome !== "running");
    const kills = tracked ? consecutiveKills(recent) : 0;
    const blocked = new Set<string>();
    let newlyIsolated: string | null = null;
    if (tracked) {
      const isolate = itemToIsolate(recent[0]);
      if (isolate) {
        const { error: bErr } = await admin.from("pipeline_item_blocks").insert({
          runner: RUNNER, item_kind: "episode", item_id: isolate, reason: "worker_killed_while_processing_only_this_item",
          stage: recent[0]?.stage ?? null, run_id: recent[0]?.id ?? null,
        });
        if (!bErr) newlyIsolated = isolate;
      }
      const { data: blk } = await admin.from("pipeline_item_blocks").select("item_id")
        .eq("runner", RUNNER).eq("item_kind", "episode").is("cleared_at", null).limit(1000);
      for (const b of (blk || []) as any[]) blocked.add(String(b.item_id));
    }
    const effLimit = isolationLimit(limit, kills);
    const scaleDown = (x: number) => (kills > 0 ? Math.max(x > 0 ? 1 : 0, Math.floor(x / Math.pow(4, kills))) : x);
    const cpuBudgetMs = Math.max(200, Math.min(1500, Number(ctrl.selection_cpu_budget_ms ?? DEFAULT_SELECTION_CPU_BUDGET_MS)));
    await log.start({ tracked, mode, dry_run: dryRun, limit, effective_limit: effLimit, consecutive_kills: kills, newly_isolated: newlyIsolated, blocked_items: blocked.size });

    const state = await readState(admin);
    const cursors: Record<FeedName, Cursor> = { transcript: null, youtube: null, article: null, spotify: null, ...(state.cursors || {}) };
    const nextCursors: Record<string, Cursor> = { ...cursors };
    const feedCounts: Record<string, number> = {};
    const feedExhausted: Record<string, boolean> = {};
    const feedRows: Partial<Record<FeedName, Array<{ id: string; episode_id: string; updated_at: string }>>> = {};
    const targetIds: string[] = [...explicitIds];
    const seen = new Set<string>(targetIds);
    const addTarget = (id: string) => { if (!id || seen.has(id)) return; seen.add(id); if (!blocked.has(id)) targetIds.push(id); };
    const budgets = laneBudgets(limit, ctrl, MAX_TARGETS);

    // 0) Fast lane: new / really changed verified YouTube pairs first (dry runs never claim).
    const fastIds = new Set<string>();
    const fast = { claimed: 0, max_lag_s: 0 as number, reasons: {} as Record<string, number>, released_deferred: 0, isolated: 0 };
    if (mode === "incremental" && !dryRun && budgets.fast > 0) {
      await setStage("fast_lane_claim");
      const { data: claimed, error: cErr } = await admin.rpc("claim_episode_source_changes_v1", { p_limit: Math.min(budgets.fast, effLimit), p_lease_seconds: 600 });
      if (cErr) throw new Error(`fast lane claim: ${cErr.message}`);
      const rows = (claimed || []) as any[];
      if (rows.length) {
        lease = { token: String(rows[0].lease_token), items: rows.map((r) => ({ episode_id: String(r.episode_id), change_seq: Number(r.change_seq) })) };
        for (const r of rows) {
          const id = String(r.episode_id);
          if (blocked.has(id)) { fast.isolated++; continue; } // acked with the lease; recorded in pipeline_item_blocks
          fastIds.add(id);
          addTarget(id);
          fast.reasons[r.reason] = (fast.reasons[r.reason] || 0) + 1;
          fast.max_lag_s = Math.max(fast.max_lag_s, Math.round((Date.now() - Date.parse(r.first_enqueued_at || r.enqueued_at)) / 1000));
        }
        fast.claimed = rows.length;
      }
    }

    // 2) Staged backfill of the verified-YouTube target set (keyset on episode_id).
    const backfill = { ...(state.youtube_backfill || {}) } as any;
    let backfillIds: string[] = [];
    let backfillPer = 0;
    const backfillOn = mode === "incremental" && ctrl.youtube_backfill_enabled === true && !backfill.completed_at;
    if (backfillOn) {
      backfillPer = Math.min(budgets.backfill, MAX_TARGETS - targetIds.length);
      if (backfillPer > 0) {
        await setStage("backfill_targets");
        const { data, error } = await admin.rpc("best_source_youtube_gain_targets_v1", { p_after: backfill.cursor || null, p_limit: backfillPer });
        if (error) throw new Error(`backfill targets: ${error.message}`);
        backfillIds = ((data || []) as any[]).map((r) => String(r.episode_id));
        for (const id of backfillIds) addTarget(id);
      }
    }

    // 2b) Staged verified-Spotify set (keyset on episode_id), only when enabled.
    const spBackfill = { ...(state.spotify_backfill || {}) } as any;
    let spBackfillIds: string[] = [];
    let spPer = 0;
    const spBackfillOn = mode === "incremental" && budgets.spotifyBackfill > 0 && !spBackfill.completed_at;
    if (spBackfillOn) {
      spPer = Math.min(budgets.spotifyBackfill, MAX_TARGETS - targetIds.length);
      if (spPer > 0) {
        await setStage("spotify_backfill_targets");
        const { data, error } = await admin.rpc("best_source_spotify_targets_v1", { p_after: spBackfill.cursor || null, p_limit: spPer });
        if (error) throw new Error(`spotify backfill targets: ${error.message}`);
        spBackfillIds = ((data || []) as any[]).map((r) => String(r.episode_id));
        for (const id of spBackfillIds) addTarget(id);
      }
    }

    // 1) Archival change feeds; room never exceeds MAX_TARGETS so no feed row is
    // read past its cursor and then clipped.
    if (mode === "incremental") {
      const room = Math.min(MAX_TARGETS - targetIds.length, Math.max(budgets.feedMin, limit - targetIds.length));
      if (room > 0) {
        const quotas = feedQuotas(room, ctrl.feed_weights, FEEDS);
        let used = 0;
        for (const feed of FEEDS) {
          const q = Math.min(quotas[feed] || 0, room - used);
          if (q <= 0) continue;
          await setStage(`feed_${feed}`);
          const { rows, exhausted } = await readFeed(admin, feed, cursors[feed], q);
          used += q;
          feedCounts[feed] = rows.length;
          feedExhausted[feed] = exhausted;
          feedRows[feed] = rows;
          for (const r of rows) addTarget(r.episode_id);
        }
      }
    }

    // Selection: at most effLimit targets (isolation after kills), compute metered.
    const allTargets = targetIds.slice(0, MAX_TARGETS);
    const processList = allTargets.slice(0, effLimit);
    await setStage("compute_selections", { target_ids: processList, effective_limit: effLimit });
    const sel = await computeSelections(admin, processList, ctrl, { cpuBudgetMs });
    const deferred = new Set<string>([...allTargets.slice(effLimit), ...sel.deferredIds]);

    // Cursors / lane positions advance only over processed (or isolated) items.
    for (const feed of FEEDS) {
      const rows = feedRows[feed];
      if (!rows) continue;
      const { done, stoppedEarly } = processedPrefix(rows, (r) => String(r.episode_id || ""), deferred);
      const last = done.length ? done[done.length - 1] : null;
      nextCursors[feed] = last ? { ts: last.updated_at, id: last.id } : cursors[feed];
      feedExhausted[feed] = !!feedExhausted[feed] && !stoppedEarly;
      feedCounts[feed] = done.length;
    }
    let backfillCount = 0;
    if (backfillIds.length) {
      const { done, stoppedEarly } = processedPrefix(backfillIds, (x) => x, deferred);
      backfillCount = done.length;
      if (done.length) backfill.cursor = done[done.length - 1];
      if (!stoppedEarly && backfillIds.length < backfillPer) backfill.completed_at = new Date().toISOString();
    } else if (backfillOn && backfillPer > 0) backfill.completed_at = new Date().toISOString();
    let spBackfillCount = 0;
    if (spBackfillIds.length) {
      const { done, stoppedEarly } = processedPrefix(spBackfillIds, (x) => x, deferred);
      spBackfillCount = done.length;
      if (done.length) spBackfill.cursor = done[done.length - 1];
      if (!stoppedEarly && spBackfillIds.length < spPer) spBackfill.completed_at = new Date().toISOString();
    } else if (spBackfillOn && spPer > 0) spBackfill.completed_at = new Date().toISOString();
    for (const id of deferred) fastIds.delete(id);
    const selectionMeta = { compute_ms: sel.computeMs, cpu_budget_ms: cpuBudgetMs, processed: sel.processedIds.length, deferred: deferred.size, slowest: sel.slowest };

    if (dryRun) {
      await log.finish("ok", { meta: { tracked, mode, dry_run: true, selection: selectionMeta, would_upsert: sel.rows.length } });
      return json({ ok: true, dry_run: true, run_id: log.id, mode, budgets, effective_limit: effLimit, target_ids: allTargets.length, feed_counts: feedCounts, backfill_targets: backfillCount, spotify_backfill_targets: spBackfillCount, would_upsert: sel.rows.length, ...sel.stats, selection: selectionMeta, samples: sel.decisions.slice(0, 10).map((d) => ({ episode_id: d.episode_id, prev: d.prev_source, next: d.next_source, gain: d.gain?.decision ?? null })), queue: await queueSizes(admin), elapsed_ms: Date.now() - startedAt });
    }

    await setStage("upsert_selections");
    const upserted = await upsertSelections(admin, sel.rows);

    // 3) Verified-YouTube re-clean: bounded, daily-capped, backed up, CAS.
    // Fast-lane episodes first (with a reserved share of the daily cap), then archive.
    const today = new Date().toISOString().slice(0, 10);
    const rc = { ...(state.youtube_reclean || {}) } as any;
    const usedToday = rc.day === today ? Number(rc.applied_today || 0) : 0;
    let recleanResult: any = null;
    if (ctrl.youtube_reclean_enabled === true) {
      const base = recleanAllowances(ctrl, usedToday);
      const allow = { ...base, perRun: scaleDown(base.perRun), fast: scaleDown(base.fast), archive: scaleDown(base.archive) };
      const outcomes: Record<string, number> = {};
      const batches: Array<{ batch_id: string; applied: number; kind: string }> = [];
      let applied = 0, conflicts = 0, invalid = 0, planned = 0, fastApplied = 0, reverts = 0;
      const runBatch = async (plans: any[], kind: string) => {
        const real = plans.filter((p) => p.outcome !== "skip");
        if (!real.length) return 0;
        const batchId = crypto.randomUUID();
        const res = await applyYoutubeReclean(admin, real, batchId);
        for (const p of real) outcomes[p.outcome] = (outcomes[p.outcome] || 0) + 1;
        planned += real.length;
        const a = Number(res?.applied || 0);
        applied += a; conflicts += Number(res?.conflicts || 0); invalid += Number(res?.invalid || 0);
        if (a) batches.push({ batch_id: batchId, applied: a, kind });
        return a;
      };

      let fastBudget = allow.fast;
      if (fastIds.size && fastBudget > 0) {
        const { data: fp, error: fErr } = await admin.from("episode_best_text_source")
          .select("episode_id,podcast_id,raw_text,source_fingerprint,evidence,source_type")
          .eq("reclean_status", "pending")
          .in("episode_id", Array.from(fastIds));
        if (fErr) throw fErr;
        const rows = ((fp || []) as any[]).filter((r) => !blocked.has(String(r.episode_id)));
        const yt = rows.filter((r) => r.source_type === "youtube").slice(0, fastBudget);
        if (yt.length) {
          await setStage("reclean_fast_lane", { target_ids: yt.map((r) => r.episode_id) });
          fastApplied += await runBatch(await planYoutubeReclean(admin, yt), "fast_youtube");
        }
        fastBudget = Math.max(0, fastBudget - yt.length);
        const nonYt = rows.filter((r) => r.source_type !== "youtube").slice(0, fastBudget);
        if (nonYt.length) {
          await setStage("reclean_fast_rss_revert", { target_ids: nonYt.map((r) => r.episode_id) });
          const a = await runBatch(await planRssRevert(admin, nonYt, { method: ctrl.clean_method_version }), "fast_rss_revert");
          fastApplied += a; reverts += a;
        }
      }
      const archiveAllowance = Math.max(0, Math.min(allow.archive, allow.perRun - planned, allow.cap - usedToday - fastApplied - allow.reserve));
      if (archiveAllowance > 0) {
        const { data: pend, error: pErr } = await admin
          .from("episode_best_text_source")
          .select("episode_id,podcast_id,raw_text,source_fingerprint,evidence")
          .eq("reclean_status", "pending")
          .eq("source_type", "youtube")
          .order("reclean_marked_at", { ascending: true })
          .limit(archiveAllowance + fastIds.size + Math.min(blocked.size, 20));
        if (pErr) throw pErr;
        const rows = ((pend || []) as any[]).filter((r) => !fastIds.has(String(r.episode_id)) && !blocked.has(String(r.episode_id))).slice(0, archiveAllowance);
        if (rows.length) {
          await setStage("reclean_archive", { target_ids: rows.map((r) => r.episode_id) });
          await runBatch(await planYoutubeReclean(admin, rows), "archive_youtube");
        }
      }
      recleanResult = {
        batch_id: batches[0]?.batch_id ?? null, batches, planned, outcomes, applied, fast_applied: fastApplied, rss_reverts: reverts,
        conflicts, invalid, cap: allow.cap, per_run: allow.perRun, reserve_for_fast_lane: allow.reserve, used_today_before: usedToday,
        ...(planned === 0 && allow.fast === 0 ? { skipped: "daily_cap_reached" } : {}),
      };
    }

    // 3b) Verified-Spotify re-clean: own small per-run limit and daily cap (default off).
    const spRc = { ...(state.spotify_reclean || {}) } as any;
    const spUsedToday = spRc.day === today ? Number(spRc.applied_today || 0) : 0;
    const spBase = spotifyRecleanAllowance(ctrl, spUsedToday);
    const spAllow = { ...spBase, allowed: scaleDown(spBase.allowed) };
    let spotifyResult: any = null;
    if (spAllow.allowed > 0) {
      // Only rows selected by the informative-gain policy (legacy length-based rows never qualify).
      const { data: sp, error: sErr } = await admin.from("episode_best_text_source")
        .select("episode_id,podcast_id,raw_text,source_fingerprint,evidence")
        .eq("reclean_status", "pending")
        .eq("source_type", "spotify")
        .eq("evidence->spotify_gain->>decision", "spotify_better")
        .order("reclean_marked_at", { ascending: true })
        .limit(spAllow.allowed + Math.min(blocked.size, 20));
      if (sErr) throw sErr;
      const rows = ((sp || []) as any[]).filter((r) => !blocked.has(String(r.episode_id))).slice(0, spAllow.allowed);
      if (rows.length) {
        await setStage("reclean_spotify", { target_ids: rows.map((r) => r.episode_id) });
        const plans = await planSpotifyReclean(admin, rows);
        const batchId = crypto.randomUUID();
        const res = await applyYoutubeReclean(admin, plans, batchId);
        const outcomes: Record<string, number> = {};
        for (const p of plans) outcomes[p.outcome] = (outcomes[p.outcome] || 0) + 1;
        spotifyResult = { batch_id: Number(res?.applied || 0) ? batchId : null, planned: plans.length, outcomes, applied: Number(res?.applied || 0), conflicts: Number(res?.conflicts || 0), invalid: Number(res?.invalid || 0), cap: spAllow.cap, used_today_before: spUsedToday };
      } else spotifyResult = { planned: 0, applied: 0, cap: spAllow.cap, used_today_before: spUsedToday };
    }

    // Fast lane: deferred items go back without an attempt counted; the rest are acked
    // only after selection + re-clean succeeded (isolated items are acked; their block row stays).
    let ack: any = null;
    await setStage("fast_lane_ack", { target_ids: null });
    if (lease) {
      const deferredItems = lease.items.filter((it) => deferred.has(it.episode_id));
      if (deferredItems.length) {
        const { data: rel, error: rErr } = await admin.rpc("release_episode_source_changes_v1", { p_lease_token: lease.token, p_items: deferredItems });
        if (rErr) throw new Error(`fast lane release: ${rErr.message}`);
        fast.released_deferred = Number(rel || 0);
      }
      const doneItems = lease.items.filter((it) => !deferred.has(it.episode_id));
      const { data: a, error: aErr } = await admin.rpc("ack_episode_source_changes_v1", { p_lease_token: lease.token, p_items: doneItems, p_error: null });
      if (aErr) throw new Error(`fast lane ack: ${aErr.message}`);
      ack = a; lease = null;
    }
    const queue = await queueSizes(admin);

    const now = new Date().toISOString();
    const runtimeMs = Date.now() - startedAt;
    const fastLane = { ...fast, acked: Number(ack?.done || 0), requeued_changed_during_run: Number(ack?.requeued || 0), queue_pending: queue.pending, queue_dead: queue.dead };
    await setStage("persist_state");
    await persistState(admin, (fresh) => {
      const freshRc = fresh.youtube_reclean || {};
      const freshUsed = freshRc.day === today ? Number(freshRc.applied_today || 0) : 0;
      const applied = Number(recleanResult?.applied || 0);
      const batches = [...(Array.isArray(freshRc.batches) ? freshRc.batches : [])];
      for (const b of (recleanResult?.batches || []) as any[]) batches.unshift({ batch_id: b.batch_id, at: now, applied: b.applied, kind: b.kind });
      const progress = { ...(fresh.progress || {}) };
      for (const f of FEEDS) {
        if (feedCounts[f] === undefined) continue;
        const p = { ...(progress[f] || {}) };
        p.rows_total = Number(p.rows_total || 0) + feedCounts[f];
        p.cursor_ts = nextCursors[f]?.ts ?? null;
        p.caught_up = !!feedExhausted[f];
        if (feedExhausted[f] && !p.caught_up_at) p.caught_up_at = now;
        progress[f] = p;
      }
      const fl = { ...(fresh.fast_lane || {}) };
      return {
        ...fresh,
        policy_version: BEST_SOURCE_POLICY_VERSION,
        cursors: mode === "ids" ? (fresh.cursors || cursors) : nextCursors,
        progress,
        fast_lane: {
          processed_total: Number(fl.processed_total || 0) + fastLane.acked,
          last_claimed: fastLane.claimed, last_max_lag_s: fastLane.max_lag_s, last_reasons: fastLane.reasons,
          queue_pending: queue.pending, queue_dead: queue.dead, last_at: now,
        },
        youtube_backfill: backfillOn ? { ...backfill, rows_total: Number((fresh.youtube_backfill || {}).rows_total || 0) + backfillCount } : (fresh.youtube_backfill || backfill),
        spotify_backfill: spBackfillOn ? { ...spBackfill, rows_total: Number((fresh.spotify_backfill || {}).rows_total || 0) + spBackfillCount } : (fresh.spotify_backfill || spBackfill),
        spotify_reclean: (() => {
          const f = fresh.spotify_reclean || {};
          const used = f.day === today ? Number(f.applied_today || 0) : 0;
          const a = Number(spotifyResult?.applied || 0);
          const b = [...(Array.isArray(f.batches) ? f.batches : [])];
          if (spotifyResult?.batch_id) b.unshift({ batch_id: spotifyResult.batch_id, at: now, applied: a });
          return { day: today, applied_today: used + a, total_applied: Number(f.total_applied || 0) + a, batches: b.slice(0, 40) };
        })(),
        youtube_reclean: { day: today, applied_today: freshUsed + applied, total_applied: Number(freshRc.total_applied || 0) + applied, rss_reverts_total: Number(freshRc.rss_reverts_total || 0) + Number(recleanResult?.rss_reverts || 0), batches: batches.slice(0, 40) },
        runs_ok: Number(fresh.runs_ok || 0) + 1,
        consecutive_errors: 0,
        last_success_at: now,
        last_run: { at: now, ok: true, run_id: log?.id ?? null, mode, budgets, effective_limit: effLimit, consecutive_kills_before: kills, newly_isolated: newlyIsolated, scanned: sel.stats.scanned, selection: selectionMeta, fast_lane: fastLane, feed_counts: feedCounts, backfill_targets: backfillCount, upserted, unchanged: sel.stats.unchanged, rss_noop: sel.stats.rss_noop, reclean_marked: sel.stats.reclean_marked, source_counts: sel.stats.source_counts, youtube_gain: sel.stats.youtube_gain, spotify_gain: sel.stats.spotify_gain, spotify_backfill_targets: spBackfillCount, reclean: recleanResult, spotify_reclean: spotifyResult, runtime_ms: runtimeMs },
      };
    });
    await log.finish("ok", { meta: { tracked, mode, effective_limit: effLimit, consecutive_kills_before: kills, newly_isolated: newlyIsolated, selection: selectionMeta, upserted, reclean_applied: Number(recleanResult?.applied || 0), spotify_applied: Number(spotifyResult?.applied || 0), fast_acked: fastLane.acked, fast_released: fast.released_deferred, runtime_ms: runtimeMs } });

    return json({ ok: true, run_id: log.id, mode, budgets, effective_limit: effLimit, consecutive_kills_before: kills, newly_isolated: newlyIsolated, scanned: sel.stats.scanned, selection: selectionMeta, fast_lane: fastLane, upserted, unchanged: sel.stats.unchanged, rss_noop: sel.stats.rss_noop, reclean_marked: sel.stats.reclean_marked, feed_counts: feedCounts, backfill_targets: backfillCount, source_counts: sel.stats.source_counts, youtube_gain: sel.stats.youtube_gain, spotify_gain: sel.stats.spotify_gain, spotify_backfill_targets: spBackfillCount, reclean: recleanResult, spotify_reclean: spotifyResult, elapsed_ms: runtimeMs });
  } catch (e) {
    const base = e instanceof Error ? `${e.message}${e.stack ? ` :: ${e.stack.split('\n').slice(0, 3).join(' | ')}` : ''}` : (typeof e === "string" ? e : JSON.stringify(e));
    const msg = `[${stage}] ${base}`;
    console.error("episode-best-text-source-runner error:", msg);
    // Record the failure: cron's HTTP call "succeeding" must not hide a failed run.
    if (admin) {
      if (lease) {
        try { await admin.rpc("ack_episode_source_changes_v1", { p_lease_token: lease.token, p_items: lease.items, p_error: msg.slice(0, 500) }); } catch (_) { /* lease expires and is retried */ }
      }
      if (log) await log.finish("error", { error: msg.slice(0, 500) });
      try {
        await persistState(admin, (fresh) => ({
          ...fresh,
          runs_failed: Number(fresh.runs_failed || 0) + 1,
          consecutive_errors: Number(fresh.consecutive_errors || 0) + 1,
          last_error: { at: new Date().toISOString(), mode, stage, message: msg.slice(0, 500) },
        }));
      } catch (_) { /* non-fatal */ }
    }
    return json({ ok: false, error: msg }, 500);
  }
});
