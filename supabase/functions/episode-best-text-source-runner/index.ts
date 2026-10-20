// Selects the best available processing text for each episode — incrementally.
//
// Change feeds (keyset on (updated_at, id), index-backed) over transcripts,
// confirmed YouTube links, confirmed publisher articles and Spotify meta find
// new/updated sources even for episodes that already have a best-source row.
// No full-table or full "done set" loads. Policy lives in
// _shared/best-text-source-policy.ts (RSS-first; transcript only for thin RSS).
// A changed selection is marked reclean_status='pending'; it re-queues clean
// text only when auto_requeue_clean_text is explicitly enabled and capped.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { heuristicClean } from "../_shared/episode-text-cleaner.ts";
import {
  BEST_SOURCE_POLICY_VERSION,
  needsReclean,
  pickBest,
  sourceFingerprint,
  transcriptRank,
  type EpisodeRow,
} from "../_shared/best-text-source-policy.ts";

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
const CHUNK = 50;

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "episode-best-text-source-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));
    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "episode_best_text_source_controls").maybeSingle();
    const ctrl = ctrlRow?.value || {};
    if (ctrl.enabled === false && !body.force) return json({ ok: true, paused: true });
    const dryRun = body.dry_run === true;

    const limit = Math.max(1, Math.min(200, Number(body.limit || ctrl.incremental_batch_limit || 100)));
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean).slice(0, limit) : [];

    const { data: stateRow } = await admin.from("app_settings").select("value").eq("key", STATE_KEY).maybeSingle();
    const state = (stateRow?.value || {}) as any;
    const cursors: Record<FeedName, Cursor> = { transcript: null, youtube: null, article: null, spotify: null, ...(state.cursors || {}) };
    const nextCursors: Record<string, Cursor> = { ...cursors };
    const feedCounts: Record<string, number> = {};

    let targetIds: string[] = ids;
    if (!targetIds.length) {
      const perFeed = Math.max(10, Math.ceil(limit / FEEDS.length));
      const seen = new Set<string>();
      for (const feed of FEEDS) {
        const { rows, next } = await readFeed(admin, feed, cursors[feed], perFeed);
        feedCounts[feed] = rows.length;
        nextCursors[feed] = next;
        for (const r of rows) if (r.episode_id && !seen.has(r.episode_id)) { seen.add(r.episode_id); targetIds.push(r.episode_id); }
      }
    }

    const episodes: EpisodeRow[] = [];
    for (let i = 0; i < targetIds.length; i += CHUNK) {
      const slice = targetIds.slice(i, i + CHUNK);
      const { data, error } = await admin
        .from("episodes")
        .select("id,podcast_id,title,description,updated_at,podcasts!inner(language_decision)")
        .in("id", slice)
        .eq("podcasts.language_decision", "accept_hungarian");
      if (error) throw error;
      if (data) episodes.push(...(data as EpisodeRow[]));
    }

    const epIds = episodes.map((e) => e.id);
    const spotifyByEp = new Map<string, any>();
    const youtubeByEp = new Map<string, any>();
    const articleByEp = new Map<string, any>();
    const transcriptByEp = new Map<string, any>();
    const prevByEp = new Map<string, any>();

    for (let i = 0; i < epIds.length; i += CHUNK) {
      const slice = epIds.slice(i, i + CHUNK);
      const [sp, yt, art, tr, prev] = await Promise.all([
        admin.from("episode_spotify_meta")
          .select("id,episode_id,spotify_description,spotify_html_description,match_confidence,match_method")
          .in("episode_id", slice),
        admin.from("episode_youtube_links")
          .select("id,episode_id,youtube_description,match_score,confidence,status,validation_reason")
          .in("episode_id", slice)
          .eq("status", "confirmed")
          .contains("validation_reason", { policy: "youtube_episode_match_v3" })
          .order("match_score", { ascending: false }),
        admin.from("episode_article_candidates")
          .select("id,episode_id,outlet,article_url,article_title,article_excerpt,article_text,match_score,status,match_reasons,evidence")
          .in("episode_id", slice)
          .eq("status", "confirmed")
          .order("match_score", { ascending: false }),
        admin.from("episode_transcripts")
          .select("id,episode_id,model,source,language,transcript,segments,content_hash,status,rights_status,public_display,updated_at")
          .in("episode_id", slice)
          .eq("status", "ok")
          .order("updated_at", { ascending: false, nullsFirst: false }),
        admin.from("episode_best_text_source")
          .select("episode_id,source_type,raw_text,source_fingerprint,reclean_status")
          .in("episode_id", slice),
      ]);
      for (const res of [sp, yt, art, tr, prev]) if (res.error) throw res.error;
      for (const row of sp.data || []) {
        const p = spotifyByEp.get(row.episode_id);
        const len = String(row.spotify_description || row.spotify_html_description || "").length;
        const pLen = String(p?.spotify_description || p?.spotify_html_description || "").length;
        if (!p || len > pLen) spotifyByEp.set(row.episode_id, row);
      }
      for (const row of yt.data || []) {
        const p = youtubeByEp.get(row.episode_id);
        const s = Number(row.match_score || 0), ps = Number(p?.match_score || 0);
        if (!p || s > ps || (s === ps && String(row.youtube_description || "").length > String(p?.youtube_description || "").length)) youtubeByEp.set(row.episode_id, row);
      }
      for (const row of art.data || []) {
        const p = articleByEp.get(row.episode_id);
        const s = Number(row.match_score || 0), ps = Number(p?.match_score || 0);
        const len = String(row.article_text || row.article_excerpt || "").length;
        const pLen = String(p?.article_text || p?.article_excerpt || "").length;
        if (!p || s > ps || (s === ps && len > pLen)) articleByEp.set(row.episode_id, row);
      }
      for (const row of tr.data || []) {
        const p = transcriptByEp.get(row.episode_id);
        const r = transcriptRank(String(row.model || "")), pr = transcriptRank(String(p?.model || ""));
        if (!p || r > pr || (r === pr && String(row.transcript || "").length > String(p?.transcript || "").length)) transcriptByEp.set(row.episode_id, row);
      }
      for (const row of prev.data || []) prevByEp.set(row.episode_id, row);
    }

    const now = new Date().toISOString();
    const rows: any[] = [];
    const sourceCounts: Record<string, number> = {};
    let unchanged = 0, recleanMarked = 0, rssNoop = 0;
    const samples: any[] = [];
    for (const ep of episodes) {
      const best = pickBest(ep, spotifyByEp.get(ep.id) || null, youtubeByEp.get(ep.id) || null, articleByEp.get(ep.id) || null, transcriptByEp.get(ep.id) || null, ctrl);
      if (!best) continue;
      const prev = prevByEp.get(ep.id) || null;
      const fingerprint = await sourceFingerprint(best);
      if (prev?.source_fingerprint === fingerprint) { unchanged++; continue; }
      // RSS remains the default without a row; only record RSS when a row exists or a transcript is available.
      if (!prev && best.source_type === "rss" && !best.evidence?.transcript_available) { rssNoop++; continue; }
      const reclean = needsReclean(prev, best);
      if (reclean) recleanMarked++;
      const cleaned = heuristicClean(best.raw_text).text.trim();
      rows.push({
        episode_id: ep.id,
        podcast_id: ep.podcast_id,
        source_type: best.source_type,
        source_ref_id: best.source_ref_id,
        source_confidence: Number(best.source_confidence.toFixed(4)),
        source_reason: best.reasons,
        raw_text: best.raw_text,
        cleaned_preview: cleaned.slice(0, 4000),
        raw_len: best.raw_text.length,
        cleaned_len: cleaned.length,
        evidence: { ...best.evidence, policy_version: BEST_SOURCE_POLICY_VERSION },
        source_fingerprint: fingerprint,
        reclean_status: reclean ? "pending" : (prev?.reclean_status ?? null),
        reclean_marked_at: reclean ? now : undefined,
        selected_at: now,
        updated_at: now,
      });
      sourceCounts[best.source_type] = (sourceCounts[best.source_type] || 0) + 1;
      if (samples.length < 10) samples.push({ episode_id: ep.id, prev: prev?.source_type || null, next: best.source_type, reclean, raw_len: best.raw_text.length, cleaned_len: cleaned.length });
    }
    for (const r of rows) if (r.reclean_marked_at === undefined) delete r.reclean_marked_at;

    if (dryRun) {
      return json({ ok: true, dry_run: true, scanned: episodes.length, target_ids: targetIds.length, feed_counts: feedCounts, would_upsert: rows.length, unchanged, rss_noop: rssNoop, reclean_marked: recleanMarked, source_counts: sourceCounts, samples, elapsed_ms: Date.now() - startedAt });
    }

    let upserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await admin.from("episode_best_text_source").upsert(chunk, { onConflict: "episode_id" });
      if (error) throw error;
      upserted += chunk.length;
    }

    // Optional, capped re-queue of clean text for changed selections (default OFF).
    let requeued = 0;
    const requeueCap = Math.max(0, Math.min(500, Number(ctrl.auto_requeue_daily_cap ?? 0)));
    if (ctrl.auto_requeue_clean_text === true && requeueCap > 0) {
      const today = now.slice(0, 10);
      const usedToday = state.requeue_day === today ? Number(state.requeued_today || 0) : 0;
      const allowance = Math.max(0, requeueCap - usedToday);
      const toQueue = rows.filter((r) => r.reclean_status === "pending").slice(0, allowance).map((r) => r.episode_id);
      for (let i = 0; i < toQueue.length; i += CHUNK) {
        const slice = toQueue.slice(i, i + CHUNK);
        const { error } = await admin.from("episodes").update({ clean_text_status: "pending" }).in("id", slice).in("clean_text_status", ["done", "skipped", "quarantined"]);
        if (error) throw error;
        await admin.from("episode_best_text_source").update({ reclean_status: "queued" }).in("episode_id", slice);
        requeued += slice.length;
      }
      state.requeue_day = today;
      state.requeued_today = usedToday + requeued;
    }

    // Re-read state right before persisting so a concurrent manual change is not undone.
    const { data: freshState } = await admin.from("app_settings").select("value").eq("key", STATE_KEY).maybeSingle();
    const merged = {
      ...((freshState?.value as any) || {}),
      policy_version: BEST_SOURCE_POLICY_VERSION,
      cursors: ids.length ? (((freshState?.value as any) || {}).cursors || cursors) : nextCursors,
      requeue_day: state.requeue_day ?? null,
      requeued_today: state.requeued_today ?? 0,
      last_run: {
        at: now,
        mode: ids.length ? "ids" : "incremental",
        scanned: episodes.length,
        feed_counts: feedCounts,
        upserted,
        unchanged,
        rss_noop: rssNoop,
        reclean_marked: recleanMarked,
        requeued,
        source_counts: sourceCounts,
        runtime_ms: Date.now() - startedAt,
      },
    };
    await admin.from("app_settings").upsert({ key: STATE_KEY, value: merged, updated_at: now }, { onConflict: "key" });

    return json({ ok: true, scanned: episodes.length, upserted, unchanged, rss_noop: rssNoop, reclean_marked: recleanMarked, requeued, feed_counts: feedCounts, source_counts: sourceCounts, elapsed_ms: Date.now() - startedAt });
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}${e.stack ? ` :: ${e.stack.split('\n').slice(0, 3).join(' | ')}` : ''}` : (typeof e === "string" ? e : JSON.stringify(e));
    console.error("episode-best-text-source-runner error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
