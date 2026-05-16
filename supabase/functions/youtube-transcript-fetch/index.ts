// youtube-transcript-fetch: pulls YouTube captions for episodes paired via
// youtube-episode-pairer using Supadata API (https://supadata.ai).
// Stores results in episode_transcripts (model = "supadata-youtube" /
// "supadata-youtube-asr" if generated). Costs ~$0.0005/transcript.
//
// Why Supadata: YouTube blocks Supabase edge IPs from /youtubei/v1/player
// (anti-bot since 2024). Supadata uses residential infra and handles captions
// + ASR fallback transparently.
//
// Modes:
//   ?episode_id=UUID   → single episode (debug)
//   ?pilot=N           → process N candidates, ignore budget+enabled
//   default            → reads ctrl from app_settings.youtube_transcript_controls
//
// Budget tracking: ai_spend_daily.by_kind.youtube_transcript

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SUPADATA_URL = "https://api.supadata.ai/v1/youtube/transcript";
const COST_PER_CALL = 0.0005; // approx, conservative
const DB_TIMEOUT_MS = 12_000;
const SUPADATA_TIMEOUT_MS = 20_000;

type Segment = { text: string; offset: number; duration: number; lang?: string };

function timeoutFetch(timeoutMs: number) {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(input, { ...init, signal: init.signal ?? controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
}

async function fetchSupadata(videoId: string, apiKey: string, preferredLang?: string): Promise<{
  text: string;
  segments: any[];
  duration: number;
  lang: string | null;
  generated: boolean;
}> {
  // Request segmented (no text=true) so we get offsets/durations.
  const params = new URLSearchParams({ videoId });
  if (preferredLang) params.set("lang", preferredLang);
  const r = await timeoutFetch(SUPADATA_TIMEOUT_MS)(`${SUPADATA_URL}?${params}`, {
    headers: { "x-api-key": apiKey },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`supadata_${r.status}:${body.slice(0, 200)}`);
  }
  const j = await r.json();
  // Possible shapes:
  //   { lang, availableLangs, content: [ {text,offset,duration,lang}, ... ] }
  //   { lang, availableLangs, content: "full text..." }  (when text=true)
  const lang = j?.lang || null;
  const generated = !!j?.generated; // some responses include this
  const segs: Segment[] = Array.isArray(j?.content) ? j.content : [];
  if (!segs.length && typeof j?.content === "string") {
    return { text: j.content, segments: [], duration: 0, lang, generated };
  }
  const segments = segs.map((s) => ({
    start: (s.offset || 0) / 1000,
    end: ((s.offset || 0) + (s.duration || 0)) / 1000,
    text: (s.text || "").replace(/\n/g, " ").trim(),
  })).filter((s) => s.text);
  const text = segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
  const lastEnd = segments.length ? segments[segments.length - 1].end : 0;
  return { text, segments, duration: Math.round(lastEnd), lang, generated };
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function logSpend(admin: any, calls: number, costUsd: number) {
  if (!calls) return;
  const today = new Date().toISOString().slice(0, 10);
  const { data: row } = await admin.from("ai_spend_daily").select("*").eq("day", today).maybeSingle();
  const prev = row || { day: today, spend_usd: 0, calls: 0, by_kind: {} };
  const byKind = (prev.by_kind || {}) as Record<string, any>;
  const cur = byKind.youtube_transcript || { calls: 0, spend_usd: 0 };
  byKind.youtube_transcript = {
    calls: (cur.calls || 0) + calls,
    spend_usd: Number(((cur.spend_usd || 0) + costUsd).toFixed(6)),
  };
  await admin.from("ai_spend_daily").upsert({
    day: today,
    spend_usd: Number((Number(prev.spend_usd || 0) + costUsd).toFixed(6)),
    calls: (prev.calls || 0) + calls,
    by_kind: byKind,
    updated_at: new Date().toISOString(),
  }, { onConflict: "day" });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  try {
    const SUPADATA_API_KEY = Deno.env.get("SUPADATA_API_KEY");
    if (!SUPADATA_API_KEY) return json({ error: "SUPADATA_API_KEY not configured" }, 500);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "youtube-transcript-fetch");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const url = new URL(req.url);
    const episodeIdParam = url.searchParams.get("episode_id");
    const pilot = Number(url.searchParams.get("pilot") || 0);

    const { data: ctrlRow } = await admin.from("app_settings")
      .select("value").eq("key", "youtube_transcript_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    if (ctrl.enabled === false && !pilot && !episodeIdParam) return json({ ok: true, paused: true });
    const batch = pilot || Number(ctrl.batch || 30);
    const concurrency = Math.min(Number(ctrl.concurrency || 4), 8);
    const dailyBudget = Number(ctrl.daily_budget_usd ?? 2);
    const preferredLang = ctrl.preferred_lang || "hu";
    const TIME_BUDGET_MS = 100_000;

    // Budget check
    if (!pilot && !episodeIdParam) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: spendRow } = await admin.from("ai_spend_daily")
        .select("by_kind").eq("day", today).maybeSingle();
      const spent = Number(((spendRow?.by_kind as any)?.youtube_transcript?.spend_usd) || 0);
      if (spent >= dailyBudget) return json({ ok: true, budget_exhausted: true, spent_usd: spent });
    }

    // Pick episodes with youtube_video_id but no transcript yet
    let candQ = admin.from("episodes")
      .select("id, podcast_id, youtube_video_id")
      .not("youtube_video_id", "is", null)
      .eq("youtube_pairing_status", "paired");
    if (episodeIdParam) candQ = candQ.eq("id", episodeIdParam);
    else candQ = candQ.limit(Math.max(batch * 3, 60));
    const { data: cands, error: cErr } = await candQ;
    if (cErr) throw cErr;
    if (!cands?.length) return json({ ok: true, no_candidates: true });

    const ids = cands.map((c) => c.id);
    const { data: existing } = await admin.from("episode_transcripts").select("episode_id").in("episode_id", ids);
    const have = new Set((existing || []).map((r) => r.episode_id));
    const todo = cands.filter((c) => !have.has(c.id)).slice(0, batch);
    if (!todo.length) return json({ ok: true, all_done: true, scanned: cands.length });

    let ok = 0, no_captions = 0, errors = 0, callsMade = 0;
    const errorDetails: any[] = [];

    const delayMs = Number(ctrl.delay_ms ?? 1500);
    let cursor = 0;
    async function worker(workerIdx: number) {
      // Stagger workers to avoid thundering herd on first tick
      if (workerIdx > 0) await new Promise((r) => setTimeout(r, workerIdx * 500));
      while (cursor < todo.length) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) return;
        const ep = todo[cursor++];
        callsMade++;
        try {
          const { text, segments, duration, lang, generated } = await fetchSupadata(
            ep.youtube_video_id!,
            SUPADATA_API_KEY!,
            preferredLang,
          );
          if (!text || text.length < 30) { no_captions++; continue; }
          const content_hash = await sha256(text);
          const { error: upErr } = await admin.from("episode_transcripts").upsert({
            episode_id: ep.id,
            podcast_id: ep.podcast_id,
            model: generated ? "supadata-youtube-asr" : "supadata-youtube",
            language: lang,
            transcript: text,
            segments,
            duration_seconds: duration,
            content_hash,
            cost_usd: COST_PER_CALL,
            updated_at: new Date().toISOString(),
          }, { onConflict: "episode_id" });
          if (upErr) { errors++; errorDetails.push({ ep: ep.id, err: upErr.message }); continue; }
          ok++;
        } catch (e: any) {
          const msg = e?.message || String(e);
          // 404 from Supadata = no captions exist for this video
          if (msg.includes("supadata_404") || msg.includes("not_found") || msg.includes("no_captions")) {
            no_captions++;
          } else {
            errors++;
          }
          if (errorDetails.length < 5) errorDetails.push({ ep: ep.id, vid: ep.youtube_video_id, err: msg });
        }
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));

    await logSpend(admin, callsMade, callsMade * COST_PER_CALL);

    return json({
      ok: true, processed: ok + no_captions + errors,
      transcribed: ok, no_captions, errors,
      calls: callsMade, cost_usd: Number((callsMade * COST_PER_CALL).toFixed(4)),
      elapsed_ms: Date.now() - startedAt,
      sample_errors: errorDetails.slice(0, 5),
    });
  } catch (e: any) {
    console.error("youtube-transcript-fetch error", e);
    return json({ error: e?.message || "error" }, 500);
  }
});
