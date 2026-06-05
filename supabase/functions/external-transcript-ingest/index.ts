// External transcript ingest endpoint.
// Two modes:
//   GET  ?claim=50  -> returns up to N candidate episodes (tier S/A, HU, YT-paired, no transcript)
//                     [{ episode_id, podcast_id, title, audio_url, youtube_video_id, duration_seconds }]
//   POST            -> ingest a transcript
//                     body: { episode_id, transcript, model, language, duration_seconds, source?, segments? }
//
// Auth: header `x-ingest-token: <EXTERNAL_TRANSCRIPT_TOKEN>`. Returns 401 if missing/wrong.
// Designed to be called from a self-run Python worker (yt-dlp + faster-whisper) on any
// machine — local laptop, Hetzner VPS, GitHub Actions, etc. No browser CORS needed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const expected = Deno.env.get("EXTERNAL_TRANSCRIPT_TOKEN");
  if (!expected) {
    return new Response(JSON.stringify({ error: "EXTERNAL_TRANSCRIPT_TOKEN not configured" }), {
      status: 500, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  const tok = req.headers.get("x-ingest-token");
  if (!tok || tok !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // --- CLAIM (GET) -----------------------------------------------------------
  if (req.method === "GET") {
    const url = new URL(req.url);
    const claim = Math.min(Math.max(parseInt(url.searchParams.get("claim") || "25", 10), 1), 200);
    const tiers = (url.searchParams.get("tiers") || "S,A").split(",").map((s) => s.trim().toUpperCase());
    const requireYt = url.searchParams.get("yt_only") !== "0"; // default: only YT-paired

    // Candidate query: HU, tier in {S,A}, no episode_transcripts row, has audio/yt source.
    // We use a raw SQL via rpc-less path by chaining Supabase JS query builder.
    let q = supabase
      .from("episodes")
      .select(`
        id, podcast_id, title, audio_url, youtube_video_id, duration_seconds,
        podcasts!inner(id, language, rank_label)
      `)
      .ilike("podcasts.language", "hu%")
      .in("podcasts.rank_label", tiers)
      .order("published_at", { ascending: false })
      .limit(claim * 4); // overshoot, then filter

    if (requireYt) q = q.not("youtube_video_id", "is", null);

    const { data: rows, error } = await q;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Filter out episodes that already have ANY transcript.
    const ids = (rows ?? []).map((r) => r.id);
    const haveSet = new Set<string>();
    if (ids.length) {
      const { data: existing } = await supabase
        .from("episode_transcripts")
        .select("episode_id")
        .in("episode_id", ids);
      for (const r of existing ?? []) haveSet.add(r.episode_id as string);
    }

    const out = (rows ?? [])
      .filter((r) => !haveSet.has(r.id))
      .slice(0, claim)
      .map((r) => ({
        episode_id: r.id,
        podcast_id: r.podcast_id,
        title: r.title,
        audio_url: r.audio_url,
        youtube_video_id: r.youtube_video_id,
        duration_seconds: r.duration_seconds,
      }));

    return new Response(JSON.stringify({ jobs: out, count: out.length }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  // --- INGEST (POST) ---------------------------------------------------------
  if (req.method === "POST") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return jerr("bad json", 400); }

    const episode_id = String(body.episode_id || "").trim();
    const transcript = String(body.transcript || "").trim();
    const model = String(body.model || "faster-whisper-large-v3-turbo").trim();
    const language = (body.language ? String(body.language) : "hu").trim();
    const source = body.source ? String(body.source) : "external_yt_asr";
    const duration_seconds = Number.isFinite(body.duration_seconds as number)
      ? Math.round(body.duration_seconds as number) : null;
    const segments = body.segments ?? null;

    if (!/^[0-9a-f-]{36}$/i.test(episode_id)) return jerr("bad episode_id", 400);
    if (transcript.length < 50) return jerr("transcript too short", 400);
    if (transcript.length > 2_000_000) return jerr("transcript too long", 413);

    // Lookup podcast_id
    const { data: ep, error: epErr } = await supabase
      .from("episodes").select("id, podcast_id").eq("id", episode_id).maybeSingle();
    if (epErr || !ep) return jerr("episode not found", 404);

    const row = {
      episode_id,
      podcast_id: ep.podcast_id,
      model,
      language,
      transcript,
      segments,
      duration_seconds,
      content_hash: await sha256(transcript),
      updated_at: new Date().toISOString(),
    };

    const { error: upErr } = await supabase
      .from("episode_transcripts")
      .upsert(row, { onConflict: "episode_id,model" });
    if (upErr) return jerr(upErr.message, 500);

    // (Audit table has a strict status CHECK; skip writing to it from external ingest.)
    void source;

    return new Response(JSON.stringify({ ok: true, episode_id, chars: transcript.length }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  return jerr("method not allowed", 405);

  function jerr(message: string, status: number) {
    return new Response(JSON.stringify({ error: message }), {
      status, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
