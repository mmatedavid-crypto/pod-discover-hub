// Selects the best available processing text for each episode — incrementally.
//
// 1) Change feeds (keyset on (updated_at, id), index-backed) over transcripts,
//    confirmed YouTube links, confirmed publisher articles and Spotify meta.
// 2) Optional staged backfill over the verified-YouTube target set
//    (best_source_youtube_gain_targets_v1, keyset on episode_id).
// 3) Optional verified-YouTube re-clean of already-done clean text: bounded per
//    run, daily-capped, backed up and compare-and-swap via
//    apply_clean_text_repair_v1 (rollback through clean-text-repair).
// Policy: _shared/best-text-source-policy.ts + _shared/youtube-source-gain.ts.
// Progress (cursors, per-feed counts, errors) is persisted on every run,
// including failures, so a 200 from pg_net is not mistaken for real progress.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { BEST_SOURCE_POLICY_VERSION } from "../_shared/best-text-source-policy.ts";
import { feedQuotas } from "../_shared/youtube-source-gain.ts";
import {
  applyYoutubeReclean,
  computeSelections,
  planYoutubeReclean,
  upsertSelections,
} from "../_shared/best-text-source-core.ts";

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
  if (cursor) q = q.or(`updated_at.gt.${cursor.ts},and(updated_at.eq.${cursor.ts},id.gt.${cursor.id})`);
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  let admin: any = null;
  let mode = "incremental";
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

    // Staged backfill of the verified-YouTube target set (keyset on episode_id).
    const backfill = { ...(state.youtube_backfill || {}) } as any;
    let backfillCount = 0;
    const backfillOn = mode === "incremental" && ctrl.youtube_backfill_enabled === true && !backfill.completed_at;
    if (backfillOn) {
      const per = Math.max(0, Math.min(40, Number(ctrl.youtube_backfill_per_run ?? 20)));
      if (per > 0) {
        const { data, error } = await admin.rpc("best_source_youtube_gain_targets_v1", { p_after: backfill.cursor || null, p_limit: per });
        if (error) throw new Error(`backfill targets: ${error.message}`);
        const ids = ((data || []) as any[]).map((r) => String(r.episode_id));
        for (const id of ids) if (!seen.has(id)) { seen.add(id); targetIds.push(id); }
        backfillCount = ids.length;
        if (ids.length) backfill.cursor = ids[ids.length - 1];
        if (ids.length < per) backfill.completed_at = new Date().toISOString();
      }
    }

    if (mode === "incremental") {
      const room = Math.max(FEEDS.length * 2, limit - backfillCount);
      const quotas = feedQuotas(room, ctrl.feed_weights, FEEDS);
      for (const feed of FEEDS) {
        if (!quotas[feed]) continue;
        const { rows, next, exhausted } = await readFeed(admin, feed, cursors[feed], quotas[feed]);
        feedCounts[feed] = rows.length;
        feedExhausted[feed] = exhausted;
        nextCursors[feed] = next;
        for (const r of rows) if (r.episode_id && !seen.has(r.episode_id)) { seen.add(r.episode_id); targetIds.push(r.episode_id); }
      }
    }

    const sel = await computeSelections(admin, targetIds.slice(0, MAX_TARGETS), ctrl);

    if (dryRun) {
      return json({ ok: true, dry_run: true, mode, target_ids: targetIds.length, feed_counts: feedCounts, backfill_targets: backfillCount, would_upsert: sel.rows.length, ...sel.stats, samples: sel.decisions.slice(0, 10).map((d) => ({ episode_id: d.episode_id, prev: d.prev_source, next: d.next_source, gain: d.gain?.decision ?? null })), elapsed_ms: Date.now() - startedAt });
    }

    const upserted = await upsertSelections(admin, sel.rows);

    // Verified-YouTube re-clean (default OFF): bounded, daily-capped, backed up, CAS.
    const today = new Date().toISOString().slice(0, 10);
    const rc = { ...(state.youtube_reclean || {}) } as any;
    const usedToday = rc.day === today ? Number(rc.applied_today || 0) : 0;
    let recleanResult: any = null;
    if (ctrl.youtube_reclean_enabled === true) {
      const cap = Math.max(0, Math.min(500, Number(ctrl.youtube_reclean_daily_cap ?? 0)));
      const perRun = Math.max(0, Math.min(25, Number(ctrl.youtube_reclean_per_run ?? 10)));
      const allowance = Math.max(0, Math.min(perRun, cap - usedToday));
      if (allowance > 0) {
        const { data: pend, error: pErr } = await admin
          .from("episode_best_text_source")
          .select("episode_id,podcast_id,raw_text,source_fingerprint,evidence")
          .eq("reclean_status", "pending")
          .eq("source_type", "youtube")
          .order("reclean_marked_at", { ascending: true })
          .limit(allowance);
        if (pErr) throw pErr;
        const plans = await planYoutubeReclean(admin, (pend || []) as any[]);
        const batchId = crypto.randomUUID();
        const res = await applyYoutubeReclean(admin, plans, batchId);
        const counts: Record<string, number> = {};
        for (const p of plans) counts[p.outcome] = (counts[p.outcome] || 0) + 1;
        recleanResult = { batch_id: res?.applied ? batchId : null, planned: plans.length, outcomes: counts, applied: Number(res?.applied || 0), conflicts: Number(res?.conflicts || 0), invalid: Number(res?.invalid || 0) };
      } else {
        recleanResult = { skipped: "daily_cap_reached", cap, used_today: usedToday };
      }
    }

    const now = new Date().toISOString();
    const runtimeMs = Date.now() - startedAt;
    await persistState(admin, (fresh) => {
      const freshRc = fresh.youtube_reclean || {};
      const freshUsed = freshRc.day === today ? Number(freshRc.applied_today || 0) : 0;
      const applied = Number(recleanResult?.applied || 0);
      const batches = [...(Array.isArray(freshRc.batches) ? freshRc.batches : [])];
      if (recleanResult?.batch_id) batches.unshift({ batch_id: recleanResult.batch_id, at: now, applied });
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
      return {
        ...fresh,
        policy_version: BEST_SOURCE_POLICY_VERSION,
        cursors: mode === "ids" ? (fresh.cursors || cursors) : nextCursors,
        progress,
        youtube_backfill: backfillOn ? { ...backfill, rows_total: Number((fresh.youtube_backfill || {}).rows_total || 0) + backfillCount } : (fresh.youtube_backfill || backfill),
        youtube_reclean: { day: today, applied_today: freshUsed + applied, total_applied: Number(freshRc.total_applied || 0) + applied, batches: batches.slice(0, 30) },
        runs_ok: Number(fresh.runs_ok || 0) + 1,
        consecutive_errors: 0,
        last_success_at: now,
        last_run: { at: now, ok: true, mode, scanned: sel.stats.scanned, feed_counts: feedCounts, backfill_targets: backfillCount, upserted, unchanged: sel.stats.unchanged, rss_noop: sel.stats.rss_noop, reclean_marked: sel.stats.reclean_marked, source_counts: sel.stats.source_counts, youtube_gain: sel.stats.youtube_gain, reclean: recleanResult, runtime_ms: runtimeMs },
      };
    });

    return json({ ok: true, mode, scanned: sel.stats.scanned, upserted, unchanged: sel.stats.unchanged, rss_noop: sel.stats.rss_noop, reclean_marked: sel.stats.reclean_marked, feed_counts: feedCounts, backfill_targets: backfillCount, source_counts: sel.stats.source_counts, youtube_gain: sel.stats.youtube_gain, reclean: recleanResult, elapsed_ms: runtimeMs });
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}${e.stack ? ` :: ${e.stack.split('\n').slice(0, 3).join(' | ')}` : ''}` : (typeof e === "string" ? e : JSON.stringify(e));
    console.error("episode-best-text-source-runner error:", msg);
    // Record the failure: cron's HTTP call "succeeding" must not hide a failed run.
    if (admin) {
      try {
        await persistState(admin, (fresh) => ({
          ...fresh,
          runs_failed: Number(fresh.runs_failed || 0) + 1,
          consecutive_errors: Number(fresh.consecutive_errors || 0) + 1,
          last_error: { at: new Date().toISOString(), mode, message: msg.slice(0, 500) },
        }));
      } catch (_) { /* non-fatal */ }
    }
    return json({ ok: false, error: msg }, 500);
  }
});
