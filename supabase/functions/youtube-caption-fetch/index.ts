// youtube-caption-fetch: zero-cost replacement for the Supadata transcript
// pipeline.
//
// Flow for a single transcript request:
//   1. youtube_caption_cache lookup by video id  -> 0 external requests
//   2. direct YouTube fetch (watch page + ANDROID innertube + timedtext)
//   3. if YouTube blocks the datacenter IP -> retry through the Webshare
//      rotating residential proxy (only when the proxy secrets are configured)
//
// Every outcome is cached (including "no captions exist"), so a video is never
// fetched from YouTube twice. Successful transcripts are also written to
// episode_transcripts (model = "youtube-timedtext" / "-asr") and mirrored into
// youtube_transcript_attempts so the older pipelines keep their bookkeeping.
//
// Modes:
//   ?video_id=ID[&episode_id=UUID]  -> single video (on-demand / debug)
//   ?episode_id=UUID                -> single episode via its confirmed pair
//   ?pilot=N                        -> batch of N, ignores enabled flag
//   default                         -> batch drain driven by
//                                      app_settings.youtube_caption_direct_controls

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { type CaptionResult, fetchYoutubeCaption, proxyFromEnv } from "../_shared/youtube-captions.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const CONTROLS_KEY = "youtube_caption_direct_controls";
const MATCH_POLICY = "youtube_episode_match_v3";
const TIME_BUDGET_MS = 110_000;

type Candidate = {
  episode_id: string;
  podcast_id: string;
  youtube_video_id: string;
  match_score: number | null;
};

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readCache(admin: any, videoId: string) {
  const { data } = await admin
    .from("youtube_caption_cache")
    .select("youtube_video_id,language,is_generated,status,transcript,transcript_chars,segments,duration_seconds,via")
    .eq("youtube_video_id", videoId)
    .maybeSingle();
  return data || null;
}

async function writeCacheOk(admin: any, videoId: string, res: CaptionResult) {
  await admin.from("youtube_caption_cache").upsert({
    youtube_video_id: videoId,
    language: res.language,
    is_generated: res.isGenerated,
    status: "ok",
    transcript: res.text,
    transcript_chars: res.text.length,
    segments: res.segments,
    duration_seconds: res.durationSeconds,
    source: "youtube-timedtext",
    via: res.via,
    error_message: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "youtube_video_id" });
}

async function writeCacheMiss(admin: any, videoId: string, status: string, via: string, detail?: string) {
  await admin.from("youtube_caption_cache").upsert({
    youtube_video_id: videoId,
    status,
    transcript: null,
    transcript_chars: 0,
    source: "youtube-timedtext",
    via,
    error_message: detail ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "youtube_video_id" });
}

async function storeEpisodeTranscript(
  admin: any,
  ep: { episode_id: string; podcast_id: string | null; youtube_video_id: string; match_score?: number | null },
  res: { text: string; segments: unknown; language: string; isGenerated: boolean; durationSeconds: number },
) {
  const model = res.isGenerated ? "youtube-timedtext-asr" : "youtube-timedtext";
  const { error } = await admin.from("episode_transcripts").upsert({
    episode_id: ep.episode_id,
    podcast_id: ep.podcast_id,
    model,
    language: res.language,
    transcript: res.text,
    segments: res.segments,
    duration_seconds: res.durationSeconds,
    content_hash: await sha256(res.text),
    cost_usd: 0,
    updated_at: new Date().toISOString(),
  }, { onConflict: "episode_id,model" });
  if (error) throw new Error(`transcript_upsert:${error.message}`);
  await admin.from("youtube_transcript_attempts").upsert({
    episode_id: ep.episode_id,
    podcast_id: ep.podcast_id,
    youtube_video_id: ep.youtube_video_id,
    status: "transcribed",
    match_score: ep.match_score ?? null,
    match_policy: MATCH_POLICY,
    transcript_chars: res.text.length,
    cost_usd: 0,
    attempted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "youtube_video_id,match_policy" });
}

async function markAttemptMiss(
  admin: any,
  ep: { episode_id: string; podcast_id: string | null; youtube_video_id: string; match_score?: number | null },
  status: string,
  message: string,
) {
  await admin.from("youtube_transcript_attempts").upsert({
    episode_id: ep.episode_id,
    podcast_id: ep.podcast_id,
    youtube_video_id: ep.youtube_video_id,
    status,
    match_score: ep.match_score ?? null,
    match_policy: MATCH_POLICY,
    error_message: message.slice(0, 300),
    cost_usd: 0,
    attempted_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "youtube_video_id,match_policy" });
}

/** Cache-first single-video resolution with direct -> proxy escalation. */
async function resolveCaption(
  admin: any,
  videoId: string,
  opts: { preferredLangs: string[]; proxyAvailable: boolean; useProxy: "auto" | "always" | "never" },
) {
  const cached = await readCache(admin, videoId);
  if (cached) {
    if (cached.status === "ok" && cached.transcript) {
      return {
        outcome: "cache_hit" as const,
        result: {
          ok: true as const,
          text: cached.transcript as string,
          segments: (cached.segments as any) ?? [],
          language: (cached.language as string) || "hu",
          isGenerated: !!cached.is_generated,
          durationSeconds: Number(cached.duration_seconds || 0),
          via: "direct" as const,
        },
      };
    }
    if (["no_captions", "unplayable"].includes(String(cached.status))) {
      return { outcome: "cache_miss_terminal" as const, status: String(cached.status) };
    }
  }

  const canProxy = opts.proxyAvailable && opts.useProxy !== "never";
  const attempts: ("direct" | "proxy")[] = opts.useProxy === "always" && opts.proxyAvailable
    ? ["proxy"]
    : canProxy
    ? ["direct", "proxy"]
    : ["direct"];

  let last: any = null;
  for (const mode of attempts) {
    const res = await fetchYoutubeCaption(videoId, {
      preferredLangs: opts.preferredLangs,
      // Re-read the pool per attempt so a different exit IP is picked each time.
      proxy: mode === "proxy" ? proxyFromEnv() : null,
    });
    if (res.ok) {
      await writeCacheOk(admin, videoId, res);
      return { outcome: "fetched" as const, result: res };
    }
    last = res;
    if (res.terminal) {
      await writeCacheMiss(admin, videoId, res.reason === "unplayable" ? "unplayable" : "no_captions", res.via, res.detail);
      return { outcome: "no_captions" as const, status: res.reason };
    }
    // Non-terminal (ip_blocked, po_token_required, transient http) -> escalate.
  }
  return { outcome: "failed" as const, failure: last };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "youtube-caption-fetch");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const url = new URL(req.url);
    const videoIdParam = url.searchParams.get("video_id");
    const episodeIdParam = url.searchParams.get("episode_id");
    const pilot = Number(url.searchParams.get("pilot") || 0);
    const manual = !!videoIdParam || !!episodeIdParam || !!pilot;

    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", CONTROLS_KEY).maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    if (!manual && ctrl.enabled === false) return json({ ok: true, paused: true, reason: ctrl.paused_reason ?? "disabled" });

    const preferredLangs: string[] = Array.isArray(ctrl.preferred_langs) && ctrl.preferred_langs.length
      ? ctrl.preferred_langs
      : ["hu", "en"];
    const useProxy = (["auto", "always", "never"].includes(String(ctrl.use_proxy)) ? ctrl.use_proxy : "auto") as
      | "auto"
      | "always"
      | "never";
    const proxyAvailable = !!proxyFromEnv();
    const batch = Math.max(1, Math.min(100, pilot || Number(ctrl.batch || 25)));
    const delayMs = Math.max(0, Number(ctrl.delay_ms ?? 1200));
    const minMatchScore = Number(ctrl.min_match_score ?? 0.84);
    const maxIpBlocks = Math.max(1, Number(ctrl.max_ip_blocks_before_pause ?? 3));

    // ---------------------------------------------------------- single video
    if (videoIdParam && !episodeIdParam) {
      const r = await resolveCaption(admin, videoIdParam, { preferredLangs, proxyAvailable, useProxy });
      return json({
        ok: r.outcome === "cache_hit" || r.outcome === "fetched",
        outcome: r.outcome,
        proxy_configured: proxyAvailable,
        chars: (r as any).result?.text?.length ?? 0,
        language: (r as any).result?.language ?? null,
        is_generated: (r as any).result?.isGenerated ?? null,
        failure: (r as any).failure ?? null,
        status: (r as any).status ?? null,
      });
    }

    // ------------------------------------------------------ candidate lookup
    let todo: Candidate[] = [];
    if (episodeIdParam) {
      const { data } = await admin
        .from("episode_youtube_links")
        .select("episode_id,podcast_id,youtube_video_id,match_score")
        .eq("episode_id", episodeIdParam)
        .eq("status", "confirmed")
        .order("match_score", { ascending: false })
        .limit(1);
      todo = ((data || []) as Candidate[]).filter((c) => c.youtube_video_id);
    } else {
      const { data, error } = await admin.rpc("pending_youtube_transcript_candidates", {
        p_limit: batch * 4,
        p_min_match_score: minMatchScore,
        p_require_caption: false,
      });
      if (error) throw error;
      const seen = new Set<string>();
      for (const c of ((data || []) as Candidate[])) {
        if (!c.youtube_video_id || seen.has(c.youtube_video_id)) continue;
        seen.add(c.youtube_video_id);
        todo.push(c);
        if (todo.length >= batch) break;
      }
    }
    if (!todo.length) return json({ ok: true, no_candidates: true });

    let transcribed = 0, cacheHits = 0, noCaptions = 0, blocked = 0, errors = 0;
    const details: any[] = [];

    for (const ep of todo) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      if (blocked >= maxIpBlocks) break;
      try {
        const r = await resolveCaption(admin, ep.youtube_video_id, { preferredLangs, proxyAvailable, useProxy });
        if (r.outcome === "cache_hit" || r.outcome === "fetched") {
          if (r.outcome === "cache_hit") cacheHits++;
          await storeEpisodeTranscript(admin, ep, r.result);
          transcribed++;
        } else if (r.outcome === "no_captions" || r.outcome === "cache_miss_terminal") {
          noCaptions++;
          await markAttemptMiss(admin, ep, "no_captions", (r as any).status || "no_captions");
        } else {
          const failure = (r as any).failure;
          if (failure?.reason === "ip_blocked") {
            blocked++;
            details.push({ video: ep.youtube_video_id, reason: "ip_blocked", via: failure.via });
          } else {
            errors++;
            await markAttemptMiss(admin, ep, "error", `${failure?.reason ?? "error"}:${failure?.detail ?? ""}`);
          }
        }
      } catch (e) {
        errors++;
        details.push({ video: ep.youtube_video_id, error: (e as any)?.message || String(e) });
      }
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }

    // Circuit breaker: repeated IP blocks mean YouTube shut this route down.
    // Pause the job so cron stops burning invocations, and surface the reason.
    if (blocked >= maxIpBlocks && !manual) {
      await admin.from("app_settings").upsert({
        key: CONTROLS_KEY,
        value: {
          ...ctrl,
          enabled: false,
          paused_reason: proxyAvailable ? "ip_blocked_with_proxy" : "ip_blocked_no_proxy",
          paused_at: new Date().toISOString(),
        },
      }, { onConflict: "key" });
    }

    return json({
      ok: true,
      processed: todo.length,
      transcribed,
      cache_hits: cacheHits,
      no_captions: noCaptions,
      ip_blocked: blocked,
      errors,
      proxy_configured: proxyAvailable,
      paused: blocked >= maxIpBlocks && !manual,
      details: details.slice(0, 10),
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (e) {
    console.error("youtube-caption-fetch failed", e);
    return json({ error: (e as any)?.message || String(e) }, 500);
  }
});
