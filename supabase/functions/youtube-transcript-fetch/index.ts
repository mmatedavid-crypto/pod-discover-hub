// youtube-transcript-fetch: pulls YouTube captions for episodes paired via
// youtube-episode-pairer and stores them in episode_transcripts (model =
// "youtube-captions"). Free (no YT Data API quota, no Gemini STT cost).
//
// Strategy:
//   1. GET https://www.youtube.com/watch?v=VID → extract ytInitialPlayerResponse
//   2. Find captionTracks → prefer hu, then any, prefer non-asr (manual)
//   3. GET track baseUrl (+&fmt=json3) → parse events into transcript + segments
//   4. UPSERT into episode_transcripts (PK on episode_id via content_hash dedup)
//
// Modes:
//   ?episode_id=UUID   → single episode (debug)
//   ?pilot=N           → process N candidates
//   default            → reads ctrl.batch from app_settings.youtube_transcript_controls
//
// Robust to: no captions (no_captions), age-gated/blocked (blocked), parse errors.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type CaptionTrack = {
  baseUrl: string;
  languageCode: string;
  kind?: string; // "asr" = auto-generated
  name?: { simpleText?: string };
};

// Use innertube /player API with ANDROID client — much less bot-filtered than
// scraping the watch page (YT serves consent/empty player responses to edge IPs).
async function fetchPlayerResponse(videoId: string): Promise<any> {
  const body = {
    context: {
      client: {
        clientName: "ANDROID",
        clientVersion: "19.09.37",
        androidSdkVersion: 30,
        hl: "hu",
        gl: "HU",
        userAgent: "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip",
      },
    },
    videoId,
    params: "CgIQBg==",
  };
  const r = await fetch(
    "https://www.youtube.com/youtubei/v1/player?key=AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "com.google.android.youtube/19.09.37 (Linux; U; Android 11) gzip",
        "X-YouTube-Client-Name": "3",
        "X-YouTube-Client-Version": "19.09.37",
        "Accept-Language": "hu-HU,hu;q=0.9",
      },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) throw new Error(`innertube_${r.status}`);
  return await r.json();
}

function extractCaptionTracks(player: any): CaptionTrack[] {
  return player?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
}

function pickTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (!tracks.length) return null;
  // 1. manual HU
  const manualHu = tracks.find(t => t.languageCode?.startsWith("hu") && t.kind !== "asr");
  if (manualHu) return manualHu;
  // 2. asr HU
  const asrHu = tracks.find(t => t.languageCode?.startsWith("hu"));
  if (asrHu) return asrHu;
  // 3. manual EN
  const manualEn = tracks.find(t => t.languageCode?.startsWith("en") && t.kind !== "asr");
  if (manualEn) return manualEn;
  // 4. anything
  return tracks[0];
}

async function fetchTranscript(track: CaptionTrack): Promise<{ text: string; segments: any[]; duration: number }> {
  const url = `${track.baseUrl}&fmt=json3`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`caption_${r.status}`);
  const j = await r.json();
  const events = j?.events || [];
  const segments: any[] = [];
  const parts: string[] = [];
  let maxEnd = 0;
  for (const e of events) {
    if (!e?.segs) continue;
    const startMs = e.tStartMs || 0;
    const durMs = e.dDurationMs || 0;
    const text = e.segs.map((s: any) => s.utf8 || "").join("").replace(/\n/g, " ").trim();
    if (!text) continue;
    parts.push(text);
    segments.push({ start: startMs / 1000, end: (startMs + durMs) / 1000, text });
    maxEnd = Math.max(maxEnd, startMs + durMs);
  }
  return { text: parts.join(" ").replace(/\s+/g, " ").trim(), segments, duration: Math.round(maxEnd / 1000) };
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  try {
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
    const batch = pilot || Number(ctrl.batch || 20);
    const concurrency = Math.min(Number(ctrl.concurrency || 4), 8);
    const TIME_BUDGET_MS = 100_000;

    // Pick episodes with youtube_video_id but no transcript yet
    let candQ = admin.from("episodes")
      .select("id, podcast_id, youtube_video_id, title")
      .not("youtube_video_id", "is", null);
    if (episodeIdParam) candQ = candQ.eq("id", episodeIdParam);
    else candQ = candQ.limit(Math.max(batch * 3, 60)); // overfetch, filter below
    const { data: cands, error: cErr } = await candQ;
    if (cErr) throw cErr;
    if (!cands?.length) return json({ ok: true, no_candidates: true });

    // Exclude already-transcribed
    const ids = cands.map(c => c.id);
    const { data: existing } = await admin.from("episode_transcripts").select("episode_id").in("episode_id", ids);
    const have = new Set((existing || []).map(r => r.episode_id));
    const todo = cands.filter(c => !have.has(c.id)).slice(0, batch);
    if (!todo.length) return json({ ok: true, all_done: true, scanned: cands.length });

    let ok = 0, no_captions = 0, blocked = 0, errors = 0;
    const errorDetails: any[] = [];

    // Concurrent worker pool
    let cursor = 0;
    async function worker() {
      while (cursor < todo.length) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) return;
        const ep = todo[cursor++];
        try {
          const player = await fetchPlayerResponse(ep.youtube_video_id!);
          const tracks = extractCaptionTracks(player);
          if (!tracks.length) { no_captions++; continue; }
          const track = pickTrack(tracks);
          if (!track) { no_captions++; continue; }
          const { text, segments, duration } = await fetchTranscript(track);
          if (!text || text.length < 30) { no_captions++; continue; }
          const content_hash = await sha256(text);
          const { error: upErr } = await admin.from("episode_transcripts").upsert({
            episode_id: ep.id,
            podcast_id: ep.podcast_id,
            model: track.kind === "asr" ? "youtube-captions-asr" : "youtube-captions",
            language: track.languageCode || null,
            transcript: text,
            segments,
            duration_seconds: duration,
            content_hash,
            cost_usd: 0,
            updated_at: new Date().toISOString(),
          }, { onConflict: "episode_id" });
          if (upErr) { errors++; errorDetails.push({ ep: ep.id, err: upErr.message }); continue; }
          ok++;
        } catch (e: any) {
          const msg = e?.message || String(e);
          if (msg.includes("innertube_4") || msg.includes("innertube_5")) blocked++;
          else errors++;
          if (errorDetails.length < 5) errorDetails.push({ ep: ep.id, vid: ep.youtube_video_id, err: msg });
        }
      }
    }
    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    return json({
      ok: true, processed: ok + no_captions + blocked + errors,
      transcribed: ok, no_captions, blocked, errors,
      elapsed_ms: Date.now() - startedAt,
      sample_errors: errorDetails.slice(0, 5),
    });
  } catch (e: any) {
    console.error("youtube-transcript-fetch error", e);
    return json({ error: e?.message || "error" }, 500);
  }
});
