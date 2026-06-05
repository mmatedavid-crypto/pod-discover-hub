// External transcript ingest — RSS audio ASR PoC.
//
// GET  ?claim=N   → up to N HU S/A jobs with audio_url. NO YouTube fields.
// POST            → upload transcript (source must be 'rss_audio_asr')
//                   or report failure (status='failed' + error_reason).
//
// Auth: Authorization: Bearer <EXTERNAL_TRANSCRIPT_TOKEN>
// Every call writes a row to public.external_transcript_audit.
//
// HARD STOPS (enforced here):
//   - source whitelist = { rss_audio_asr }
//   - public_display always false (PoC)
//   - rights_status forced to 'rss_public_index_only'
//   - YouTube fields never returned
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const ALLOWED_SOURCES = new Set(["rss_audio_asr"]);
const MAX_CLAIM = 20;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const expected = Deno.env.get("EXTERNAL_TRANSCRIPT_TOKEN");
  if (!expected) return jerr("EXTERNAL_TRANSCRIPT_TOKEN not configured", 500);

  const authz = req.headers.get("authorization") || "";
  const m = authz.match(/^Bearer\s+(.+)$/i);
  if (!m || m[1] !== expected) return jerr("unauthorized", 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // --- CLAIM (GET) ---------------------------------------------------------
  if (req.method === "GET") {
    const url = new URL(req.url);
    const claim = Math.min(
      Math.max(parseInt(url.searchParams.get("claim") || "20", 10), 1),
      MAX_CLAIM,
    );
    const tiers = (url.searchParams.get("tiers") || "S,A")
      .split(",").map((s) => s.trim().toUpperCase());

    const { data: rows, error } = await supabase
      .from("episodes")
      .select(`
        id, podcast_id, title, audio_url, duration_seconds,
        podcasts!inner(id, language, rank_label)
      `)
      .ilike("podcasts.language", "hu%")
      .in("podcasts.rank_label", tiers)
      .not("audio_url", "is", null)
      .order("published_at", { ascending: false })
      .limit(claim * 4);

    if (error) return jerr(error.message, 500);

    const ids = (rows ?? []).map((r) => r.id);
    const have = new Set<string>();
    if (ids.length) {
      const { data: existing } = await supabase
        .from("episode_transcripts")
        .select("episode_id")
        .in("episode_id", ids)
        .eq("status", "ok");
      for (const r of existing ?? []) have.add(r.episode_id as string);
    }

    const jobs = (rows ?? [])
      .filter((r) => !have.has(r.id) && typeof r.audio_url === "string" && r.audio_url.startsWith("http"))
      .slice(0, claim)
      .map((r) => ({
        episode_id: r.id,
        podcast_id: r.podcast_id,
        title: r.title,
        audio_url: r.audio_url,
        duration_seconds: r.duration_seconds,
      }));

    return jok({ jobs, count: jobs.length });
  }

  // --- INGEST (POST) -------------------------------------------------------
  if (req.method === "POST") {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return jerr("bad json", 400); }

    const episode_id = String(body.episode_id || "").trim();
    const source = String(body.source || "").trim();
    const status = String(body.status || "ok").trim();
    const model = String(body.model || "faster-whisper-large-v3-turbo").trim();
    const language = String(body.language || "hu").trim();
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    const error_reason = body.error_reason ? String(body.error_reason).slice(0, 500) : null;
    const segments = body.segments ?? null;
    const duration_seconds = numOrNull(body.duration_seconds);
    const audio_bytes = numOrNull(body.audio_bytes);
    const latency_ms = numOrNull(body.latency_ms);
    const cost_usd = body.cost_usd != null ? Number(body.cost_usd) : null;
    const worker_id = body.worker_id ? String(body.worker_id).slice(0, 80) : null;

    if (!/^[0-9a-f-]{36}$/i.test(episode_id)) return jerr("bad episode_id", 400);
    if (!ALLOWED_SOURCES.has(source)) return jerr(`source not allowed: ${source}`, 422);
    if (!["ok", "failed", "skipped"].includes(status)) return jerr("bad status", 400);

    // Audit row first (always written)
    const audit = {
      episode_id, model, source, status, error_reason,
      latency_ms, cost_usd, audio_bytes, duration_seconds, worker_id,
    };
    await supabase.from("external_transcript_audit").insert(audit);

    if (status !== "ok") {
      return jok({ ok: true, recorded: status, episode_id });
    }

    if (transcript.length < 50) return jerr("transcript too short", 400);
    if (transcript.length > 2_000_000) return jerr("transcript too long", 413);

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
      audio_bytes,
      latency_ms,
      content_hash: await sha256(transcript),
      source,
      rights_status: "rss_public_index_only",
      public_display: false,
      status: "ok",
      updated_at: new Date().toISOString(),
    };

    const { error: upErr } = await supabase
      .from("episode_transcripts")
      .upsert(row, { onConflict: "episode_id,model" });
    if (upErr) return jerr(upErr.message, 500);

    return jok({ ok: true, episode_id, chars: transcript.length });
  }

  return jerr("method not allowed", 405);

  function jerr(message: string, status: number) {
    return new Response(JSON.stringify({ error: message }), {
      status, headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  function jok(b: unknown) {
    return new Response(JSON.stringify(b), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});

function numOrNull(v: unknown): number | null {
  const n = typeof v === "number" ? v : v != null ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.round(n) : null;
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
