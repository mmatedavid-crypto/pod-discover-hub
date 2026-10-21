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
// Progress (cursors, per-feed counts, queue lag, errors) is persisted on every
// run, including failures, so a 200 from pg_net is not mistaken for progress.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { BEST_SOURCE_POLICY_VERSION } from "../_shared/best-text-source-policy.ts";
import { feedQuotas } from "../_shared/youtube-source-gain.ts";
import {
  applyYoutubeReclean,
  computeSelections,
  planRssRevert,
  planYoutubeReclean,
  upsertSelections,
} from "../_shared/best-text-source-core.ts";
import { laneBudgets, recleanAllowances } from "../_shared/best-text-source-lanes.ts";

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
const MAX_TARGETS = 60; // AGENTS.md: ≤60 episodes per call (edge CPU)

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
  const last = rows.length ? rows[rows.length - 1] : null;
  return { rows, next: last ? { ts: last.updated_at, id: last.id } : cursor, exhausted: rows.length < limit };
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  let admin: any = null;
  let mode = "incremental";
  let stage = "init";
  let lease: { token: string; items: Array<{ episode_id: string; change_seq: number }> } | null = null;
  try {
    admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "episode-best-text-source-runner");
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

    const state = await readState(admin);
    const cursors: Record<FeedName, Cursor> = { transcript: null, youtube: null, article: null, spotify: null, ...(state.cursors || {}) };
    const nextCursors: Record<string, Cursor> = { ...cursors };
    const feedCounts: Record<string, number> = {};
    const feedExhausted: Record<string, boolean> = {};
    const targetIds: string[] = [...explicitIds];
    const seen = new Set<string>(targetIds);
    const budgets = laneBudgets(limit, ctrl, MAX_TARGETS);

    // 0) Fast lane: new / really changed verified YouTube pairs first (dry runs never claim).
    const fastIds = new Set<string>();
    const fast = { claimed: 0, max_lag_s: 0 as number, reasons: {} as Record<string, number> };
    if (mode === "incremental" && !dryRun && budgets.fast > 0) {
      stage = "fast_lane_claim";
      const { data: claimed, error: cErr } = await admin.rpc("claim_episode_source_changes_v1", { p_limit: budgets.fast, p_lease_seconds: 600 });
      if (cErr) throw new Error(`fast lane claim: ${cErr.message}`);
      const rows = (claimed || []) as any[];
      if (rows.length) {
        lease = { token: String(rows[0].lease_token), items: rows.map((r) => ({ episode_id: String(r.episode_id), change_seq: Number(r.change_seq) })) };
        for (const r of rows) {
          const id = String(r.episode_id);
          fastIds.add(id);
          if (!seen.has(id)) { seen.add(id); targetIds.push(id); }
          fast.reasons[r.reason] = (fast.reasons[r.reason] || 0) + 1;
          fast.max_lag_s = Math.max(fast.max_lag_s, Math.round((Date.now() - Date.parse(r.first_enqueued_at || r.enqueued_at)) / 1000));
        }
        fast.claimed = rows.length;
      }
    }

    // 2) Staged backfill of the verified-YouTube target set (keyset on episode_id).
    const backfill = { ...(state.youtube_backfill || {}) } as any;
    let backfillCount = 0;
    const backfillOn = mode === "incremental" && ctrl.youtube_backfill_enabled === true && !backfill.completed_at;
    if (backfillOn) {
      const per = Math.min(budgets.backfill, MAX_TARGETS - targetIds.length);
      if (per > 0) {
        stage = "backfill_targets";
        const { data, error } = await admin.rpc("best_source_youtube_gain_targets_v1", { p_after: backfill.cursor || null, p_limit: per });
        if (error) throw new Error(`backfill targets: ${error.message}`);
        const ids = ((data || []) as any[]).map((r) => String(r.episode_id));
        for (const id of ids) if (!seen.has(id)) { seen.add(id); targetIds.push(id); }
        backfillCount = ids.length;
        if (ids.length) backfill.cursor = ids[ids.length - 1];
        if (ids.length < per) backfill.completed_at = new Date().toISOString();
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
          stage = `feed_${feed}`;
          const { rows, next, exhausted } = await readFeed(admin, feed, cursors[feed], q);
          used += q;
          feedCounts[feed] = rows.length;
          feedExhausted[feed] = exhausted;
          nextCursors[feed] = next;
          for (const r of rows) if (r.episode_id && !seen.has(r.episode_id)) { seen.add(r.episode_id); targetIds.push(r.episode_id); }
        }
      }
    }

    stage = "compute_selections";
    const sel = await computeSelections(admin, targetIds.slice(0, MAX_TARGETS), ctrl);

    if (dryRun) {
      return json({ ok: true, dry_run: true, mode, budgets, target_ids: targetIds.length, feed_counts: feedCounts, backfill_targets: backfillCount, would_upsert: sel.rows.length, ...sel.stats, samples: sel.decisions.slice(0, 10).map((d) => ({ episode_id: d.episode_id, prev: d.prev_source, next: d.next_source, gain: d.gain?.decision ?? null })), queue: await queueSizes(admin), elapsed_ms: Date.now() - startedAt });
    }

    stage = "upsert_selections";
    const upserted = await upsertSelections(admin, sel.rows);

    // 3) Verified-YouTube re-clean: bounded, daily-capped, backed up, CAS.
    // Fast-lane episodes first (with a reserved share of the daily cap), then archive.
    const today = new Date().toISOString().slice(0, 10);
    const rc = { ...(state.youtube_reclean || {}) } as any;
    const usedToday = rc.day === today ? Number(rc.applied_today || 0) : 0;
    let recleanResult: any = null;
    if (ctrl.youtube_reclean_enabled === true) {
      const allow = recleanAllowances(ctrl, usedToday);
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

      stage = "reclean_fast_lane";
      let fastBudget = allow.fast;
      if (fastIds.size && fastBudget > 0) {
        const { data: fp, error: fErr } = await admin.from("episode_best_text_source")
          .select("episode_id,podcast_id,raw_text,source_fingerprint,evidence,source_type")
          .eq("reclean_status", "pending")
          .in("episode_id", Array.from(fastIds));
        if (fErr) throw fErr;
        const rows = (fp || []) as any[];
        const yt = rows.filter((r) => r.source_type === "youtube").slice(0, fastBudget);
        if (yt.length) fastApplied += await runBatch(await planYoutubeReclean(admin, yt), "fast_youtube");
        fastBudget = Math.max(0, fastBudget - yt.length);
        const nonYt = rows.filter((r) => r.source_type !== "youtube").slice(0, fastBudget);
        if (nonYt.length) {
          const a = await runBatch(await planRssRevert(admin, nonYt, { method: ctrl.clean_method_version }), "fast_rss_revert");
          fastApplied += a; reverts += a;
        }
      }
      const archiveAllowance = Math.max(0, Math.min(allow.archive, allow.perRun - planned, allow.cap - usedToday - fastApplied - allow.reserve));
      if (archiveAllowance > 0) {
        stage = "reclean_archive";
        const { data: pend, error: pErr } = await admin
          .from("episode_best_text_source")
          .select("episode_id,podcast_id,raw_text,source_fingerprint,evidence")
          .eq("reclean_status", "pending")
          .eq("source_type", "youtube")
          .order("reclean_marked_at", { ascending: true })
          .limit(archiveAllowance + fastIds.size);
        if (pErr) throw pErr;
        const rows = ((pend || []) as any[]).filter((r) => !fastIds.has(String(r.episode_id))).slice(0, archiveAllowance);
        if (rows.length) await runBatch(await planYoutubeReclean(admin, rows), "archive_youtube");
      }
      recleanResult = {
        batch_id: batches[0]?.batch_id ?? null, batches, planned, outcomes, applied, fast_applied: fastApplied, rss_reverts: reverts,
        conflicts, invalid, cap: allow.cap, reserve_for_fast_lane: allow.reserve, used_today_before: usedToday,
        ...(planned === 0 && allow.fast === 0 ? { skipped: "daily_cap_reached" } : {}),
      };
    }

    // Ack the fast lane only after selection + re-clean succeeded.
    let ack: any = null;
    stage = "fast_lane_ack";
    if (lease) {
      const { data: a, error: aErr } = await admin.rpc("ack_episode_source_changes_v1", { p_lease_token: lease.token, p_items: lease.items, p_error: null });
      if (aErr) throw new Error(`fast lane ack: ${aErr.message}`);
      ack = a; lease = null;
    }
    const queue = await queueSizes(admin);

    const now = new Date().toISOString();
    const runtimeMs = Date.now() - startedAt;
    const fastLane = { ...fast, acked: Number(ack?.done || 0), requeued_changed_during_run: Number(ack?.requeued || 0), queue_pending: queue.pending, queue_dead: queue.dead };
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
        youtube_reclean: { day: today, applied_today: freshUsed + applied, total_applied: Number(freshRc.total_applied || 0) + applied, rss_reverts_total: Number(freshRc.rss_reverts_total || 0) + Number(recleanResult?.rss_reverts || 0), batches: batches.slice(0, 40) },
        runs_ok: Number(fresh.runs_ok || 0) + 1,
        consecutive_errors: 0,
        last_success_at: now,
        last_run: { at: now, ok: true, mode, budgets, scanned: sel.stats.scanned, fast_lane: fastLane, feed_counts: feedCounts, backfill_targets: backfillCount, upserted, unchanged: sel.stats.unchanged, rss_noop: sel.stats.rss_noop, reclean_marked: sel.stats.reclean_marked, source_counts: sel.stats.source_counts, youtube_gain: sel.stats.youtube_gain, reclean: recleanResult, runtime_ms: runtimeMs },
      };
    });

    return json({ ok: true, mode, budgets, scanned: sel.stats.scanned, fast_lane: fastLane, upserted, unchanged: sel.stats.unchanged, rss_noop: sel.stats.rss_noop, reclean_marked: sel.stats.reclean_marked, feed_counts: feedCounts, backfill_targets: backfillCount, source_counts: sel.stats.source_counts, youtube_gain: sel.stats.youtube_gain, reclean: recleanResult, elapsed_ms: runtimeMs });
  } catch (e) {
    const base = e instanceof Error ? `${e.message}${e.stack ? ` :: ${e.stack.split('\n').slice(0, 3).join(' | ')}` : ''}` : (typeof e === "string" ? e : JSON.stringify(e));
    const msg = `[${stage}] ${base}`;
    console.error("episode-best-text-source-runner error:", msg);
    // Record the failure: cron's HTTP call "succeeding" must not hide a failed run.
    if (admin) {
      if (lease) {
        try { await admin.rpc("ack_episode_source_changes_v1", { p_lease_token: lease.token, p_items: lease.items, p_error: msg.slice(0, 500) }); } catch (_) { /* lease expires and is retried */ }
      }
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
