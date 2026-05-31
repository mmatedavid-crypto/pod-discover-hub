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
// Credit discipline:
//   - only v3-confirmed YouTube episode matches are eligible
//   - YouTube metadata must report captions before Supadata is called
//   - native mode rejects generated/ASR responses instead of storing them
//   - batch/max_calls_per_run is a hard Supadata-call ceiling
//   - transcript attempts are logged per video, including no-caption failures
//   - optional RSS/YouTube description gain gate is off by default for native drain

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
const MATCH_POLICY = "youtube_episode_match_v3";

type Segment = { text: string; offset: number; duration: number; lang?: string };
type Candidate = {
  episode_id: string;
  podcast_id: string;
  youtube_video_id: string;
  youtube_description: string | null;
  youtube_duration_seconds: number | null;
  youtube_caption_available: boolean | null;
  match_score: number | null;
  validation_reason: any;
};

type ExistingTranscriptRow = {
  episode_id: string;
  model: string;
};

type TranscriptAttemptRow = {
  youtube_video_id: string;
  status: string;
};

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

async function fetchSupadata(videoId: string, apiKey: string, preferredLang?: string, mode = "native"): Promise<{
  text: string;
  segments: any[];
  duration: number;
  lang: string | null;
  generated: boolean;
}> {
  // Request segmented (no text=true) so we get offsets/durations.
  const params = new URLSearchParams({ videoId });
  if (preferredLang) params.set("lang", preferredLang);
  params.set("mode", mode);
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
  try {
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
  } catch (e) {
    console.warn("youtube-transcript-fetch spend log skipped", (e as any)?.message || String(e));
  }
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
    const batch = Math.max(1, Math.min(100, pilot || Number(ctrl.batch || 30)));
    const maxCallsPerRun = Math.max(1, Math.min(batch, Number(ctrl.max_supadata_calls_per_run || batch)));
    const concurrency = Math.min(Number(ctrl.concurrency || 2), 4);
    const dailyCreditLimit = Math.max(0, Number(ctrl.daily_credit_limit ?? ctrl.daily_budget_usd ?? 2));
    const monthlyCreditLimit = Math.max(0, Number(ctrl.monthly_credit_limit ?? 30000));
    const preferredLang = ctrl.preferred_lang || "hu";
    const transcriptMode = "native";
    const nativeOnly = ctrl.native_only !== false;
    const requireYoutubeCaptionAvailable = true;
    const requireDescriptionGain = ctrl.require_description_gain === true;
    const minMatchScore = Number(ctrl.min_match_score ?? 0.84);
    const minDescriptionGainChars = Number(ctrl.min_description_gain_chars ?? 300);
    const minYoutubeDescriptionChars = Number(ctrl.min_youtube_description_chars ?? 250);
    const shortRssChars = Number(ctrl.short_rss_chars ?? 160);
    const TIME_BUDGET_MS = 100_000;

    // Budget check (daily + monthly)
    if (!pilot && !episodeIdParam) {
      const today = new Date().toISOString().slice(0, 10);
      const monthStart = today.slice(0, 8) + "01";
      const { data: spendRow } = await admin.from("ai_spend_daily")
        .select("by_kind").eq("day", today).maybeSingle();
      const spentCredits = Number(((spendRow?.by_kind as any)?.youtube_transcript?.calls) || 0);
      if (spentCredits >= dailyCreditLimit) return json({ ok: true, budget_exhausted: true, scope: "daily", spent_credits: spentCredits, daily_credit_limit: dailyCreditLimit });

      const { data: monthRows } = await admin.from("ai_spend_daily")
        .select("by_kind").gte("day", monthStart).lte("day", today);
      const monthCredits = (monthRows || []).reduce((s, r: any) => s + Number(r?.by_kind?.youtube_transcript?.calls || 0), 0);
      if (monthCredits >= monthlyCreditLimit) return json({ ok: true, budget_exhausted: true, scope: "monthly", month_credits: monthCredits, monthly_credit_limit: monthlyCreditLimit });
    }

    // Pick only strict v3-confirmed YouTube matches. Older "paired" episode
    // rows are deliberately ignored to avoid burning Supadata credits on weak matches.
    let candQ = admin
      .from("episode_youtube_links")
      .select("episode_id,podcast_id,youtube_video_id,youtube_description,youtube_duration_seconds,youtube_caption_available,match_score,validation_reason")
      .eq("status", "confirmed")
      .contains("validation_reason", { policy: MATCH_POLICY })
      .gte("match_score", minMatchScore)
      .order("match_score", { ascending: false });
    if (requireYoutubeCaptionAvailable) candQ = candQ.eq("youtube_caption_available", true);
    if (episodeIdParam) candQ = candQ.eq("episode_id", episodeIdParam);
    else candQ = candQ.limit(Math.max(batch * 4, 80));
    const { data: cands, error: cErr } = await candQ;
    if (cErr) throw cErr;
    if (!cands?.length) return json({ ok: true, no_candidates: true });

    const uniqueByVideo = new Map<string, Candidate>();
    for (const c of (cands || []) as Candidate[]) {
      if (!c.youtube_video_id) continue;
      const prev = uniqueByVideo.get(c.youtube_video_id);
      if (!prev || Number(c.match_score || 0) > Number(prev.match_score || 0)) uniqueByVideo.set(c.youtube_video_id, c);
    }
    const unique = [...uniqueByVideo.values()];
    const ids = unique.map((c) => c.episode_id);
    const videoIds = unique.map((c) => c.youtube_video_id);

    const { data: existing } = await admin
      .from("episode_transcripts")
      .select("episode_id,model")
      .in("episode_id", ids);
    const have = new Set(((existing || []) as ExistingTranscriptRow[])
      .filter((r) => r.model === "supadata-youtube")
      .map((r) => r.episode_id));

    const { data: attempts } = await admin
      .from("youtube_transcript_attempts")
      .select("youtube_video_id,status")
      .in("youtube_video_id", videoIds);
    const attempted = new Set(((attempts || []) as TranscriptAttemptRow[]).map((r) => `${r.youtube_video_id}:${r.status}`));
    const blockedVideos = new Set(((attempts || []) as TranscriptAttemptRow[])
      .filter((r) => ["transcribed", "no_captions", "permanent_error"].includes(String(r.status)))
      .map((r) => r.youtube_video_id));

    const { data: episodes } = await admin
      .from("episodes")
      .select("id,description")
      .in("id", ids);
    const rssLenByEp = new Map((episodes || []).map((e: any) => [e.id, String(e.description || "").trim().length]));

    const todo = unique.filter((c) => {
      if (have.has(c.episode_id)) return false;
      if (blockedVideos.has(c.youtube_video_id)) return false;
      if (c.youtube_caption_available !== true) return false;
      if (!requireDescriptionGain) return true;
      const rssLen = Number(rssLenByEp.get(c.episode_id) || 0);
      const ytDescLen = String(c.youtube_description || "").trim().length;
      return rssLen < shortRssChars || ytDescLen >= Math.max(minYoutubeDescriptionChars, rssLen + minDescriptionGainChars);
    }).slice(0, maxCallsPerRun);
    if (!todo.length) return json({ ok: true, all_done: true, scanned: cands.length });

    let ok = 0, no_captions = 0, errors = 0, callsMade = 0, skipped_existing_attempt = 0;
    const errorDetails: any[] = [];

    const delayMs = Number(ctrl.delay_ms ?? 1500);
    let cursor = 0;
    async function worker(workerIdx: number) {
      // Stagger workers to avoid thundering herd on first tick
      if (workerIdx > 0) await new Promise((r) => setTimeout(r, workerIdx * 500));
      while (cursor < todo.length) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) return;
        const ep = todo[cursor++] as Candidate;
        if (attempted.has(`${ep.youtube_video_id}:started`)) {
          skipped_existing_attempt++;
          continue;
        }
        callsMade++;
        try {
          await admin.from("youtube_transcript_attempts").upsert({
            episode_id: ep.episode_id,
            podcast_id: ep.podcast_id,
            youtube_video_id: ep.youtube_video_id,
            status: "started",
            match_score: ep.match_score,
            match_policy: MATCH_POLICY,
            attempted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: "youtube_video_id,match_policy" });

          const { text, segments, duration, lang, generated } = await fetchSupadata(
            ep.youtube_video_id!,
            SUPADATA_API_KEY!,
            preferredLang,
            transcriptMode,
          );
          if (nativeOnly && generated) {
            errors++;
            await admin.from("youtube_transcript_attempts").upsert({
              episode_id: ep.episode_id,
              podcast_id: ep.podcast_id,
              youtube_video_id: ep.youtube_video_id,
              status: "permanent_error",
              match_score: ep.match_score,
              match_policy: MATCH_POLICY,
              error_message: "supadata_returned_generated_transcript_in_native_mode",
              cost_usd: COST_PER_CALL,
              attempted_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }, { onConflict: "youtube_video_id,match_policy" });
            continue;
          }
          if (!text || text.length < 30) {
            no_captions++;
            await admin.from("youtube_transcript_attempts").upsert({
              episode_id: ep.episode_id,
              podcast_id: ep.podcast_id,
              youtube_video_id: ep.youtube_video_id,
              status: "no_captions",
              match_score: ep.match_score,
              match_policy: MATCH_POLICY,
              cost_usd: COST_PER_CALL,
              attempted_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }, { onConflict: "youtube_video_id,match_policy" });
            continue;
          }
          const content_hash = await sha256(text);
          const { error: upErr } = await admin.from("episode_transcripts").upsert({
            episode_id: ep.episode_id,
            podcast_id: ep.podcast_id,
            model: "supadata-youtube",
            language: lang,
            transcript: text,
            segments,
            duration_seconds: duration,
            content_hash,
            cost_usd: COST_PER_CALL,
            updated_at: new Date().toISOString(),
          }, { onConflict: "episode_id,model" });
          if (upErr) { errors++; errorDetails.push({ ep: ep.episode_id, err: upErr.message }); continue; }
          await admin.from("youtube_transcript_attempts").upsert({
            episode_id: ep.episode_id,
            podcast_id: ep.podcast_id,
            youtube_video_id: ep.youtube_video_id,
            status: "transcribed",
            match_score: ep.match_score,
            match_policy: MATCH_POLICY,
            transcript_chars: text.length,
            cost_usd: COST_PER_CALL,
            attempted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: "youtube_video_id,match_policy" });
          ok++;
        } catch (e: any) {
          const msg = e?.message || String(e);
          // 404 from Supadata = no captions exist for this video
          if (msg.includes("supadata_404") || msg.includes("not_found") || msg.includes("no_captions")) {
            no_captions++;
          } else {
            errors++;
          }
          await admin.from("youtube_transcript_attempts").upsert({
            episode_id: ep.episode_id,
            podcast_id: ep.podcast_id,
            youtube_video_id: ep.youtube_video_id,
            status: msg.includes("supadata_404") || msg.includes("not_found") || msg.includes("no_captions") ? "no_captions" : "error",
            match_score: ep.match_score,
            match_policy: MATCH_POLICY,
            error_message: msg.slice(0, 500),
            cost_usd: COST_PER_CALL,
            attempted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }, { onConflict: "youtube_video_id,match_policy" });
          if (errorDetails.length < 5) errorDetails.push({ ep: ep.episode_id, vid: ep.youtube_video_id, err: msg });
        }
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));

    await logSpend(admin, callsMade, callsMade * COST_PER_CALL);

    return json({
      ok: true, processed: ok + no_captions + errors,
      transcribed: ok, no_captions, errors,
      skipped_existing_attempt,
      calls: callsMade, credits_used: callsMade, max_calls_per_run: maxCallsPerRun, cost_usd: Number((callsMade * COST_PER_CALL).toFixed(4)),
      elapsed_ms: Date.now() - startedAt,
      sample_errors: errorDetails.slice(0, 5),
    });
  } catch (e: any) {
    console.error("youtube-transcript-fetch error", e);
    return json({ error: e?.message || "error" }, 500);
  }
});
