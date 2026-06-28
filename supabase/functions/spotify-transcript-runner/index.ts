// Spotify native transcript runner.
// Default-disabled and operator-controlled: stores Spotify private API text for
// indexing only, never for public transcript display.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SPOTIFY_MODEL = "spotify-native";
const RIGHTS_STATUS = "spotify_private_api_index_only";
const DEFAULT_CONTROLS = {
  enabled: false,
  batch_size: 10,
  delay_ms: 1000,
  daily_cap: 100,
  time_budget_ms: 70000,
  candidate_scan_limit: 2500,
  auto_best_text_source: true,
  rights_status: RIGHTS_STATUS,
  public_display: false,
  policy: "default_disabled_operator_controlled_native_transcript_indexing_v1",
};

type RequestBody = {
  batch?: number;
  delay_ms?: number;
  pilot?: number;
  candidate_scan_limit?: number;
};

type Candidate = {
  episode_id: string;
  podcast_id: string;
  spotify_episode_id: string;
  release_date?: string | null;
  updated_at?: string | null;
};

const clampInt = (value: unknown, fallback: number, min: number, max: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function spotifyAccessToken(): Promise<string> {
  const res = await fetch("https://open.spotify.com/get_access_token?reason=transport&productType=web_player", {
    headers: {
      "accept": "application/json",
      "user-agent": "Mozilla/5.0 PodiverzumBot/1.0",
    },
  });
  if (!res.ok) throw new Error(`spotify_token_${res.status}`);
  const data = await res.json();
  const token = data?.accessToken || data?.access_token;
  if (!token) throw new Error("spotify_token_missing");
  return token;
}

function normalizeTranscript(raw: any): { text: string; language: string | null; segments: any[] } {
  const items = raw?.segments || raw?.lines || raw?.transcript || raw?.data?.segments || [];
  const segments = Array.isArray(items)
    ? items.map((item: any) => {
        const text = String(item?.text || item?.words || item?.body || "").replace(/\s+/g, " ").trim();
        const startMs = Number(item?.startMs ?? item?.start_ms ?? item?.startTimeMs ?? item?.start ?? 0);
        const endMs = Number(item?.endMs ?? item?.end_ms ?? item?.endTimeMs ?? item?.end ?? 0);
        return { text, start_ms: Number.isFinite(startMs) ? startMs : null, end_ms: Number.isFinite(endMs) ? endMs : null };
      }).filter((item: any) => item.text)
    : [];
  const text = segments.map((segment) => segment.text).join(" ").replace(/\s+/g, " ").trim();
  const language = raw?.language || raw?.lang || raw?.data?.language || null;
  return { text, language, segments };
}

async function fetchSpotifyTranscript(spotifyEpisodeId: string, token: string) {
  const url = `https://spclient.wg.spotify.com/transcript-read-along/v2/episode/${spotifyEpisodeId}`;
  const res = await fetch(url, {
    headers: {
      "accept": "application/json",
      "authorization": `Bearer ${token}`,
      "app-platform": "WebPlayer",
      "spotify-app-version": "1.2.0.0",
      "user-agent": "Mozilla/5.0 PodiverzumBot/1.0",
    },
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { res, body, preview: text.slice(0, 240) };
}

async function invokeBestTextSourceRunner(episodeIds: string[]) {
  if (!episodeIds.length) return { skipped: true, reason: "no_written_episodes" };
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(`${supabaseUrl}/functions/v1/episode-best-text-source-runner`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${serviceRoleKey}`,
      "apikey": serviceRoleKey,
    },
    body: JSON.stringify({ episode_ids: episodeIds, source: "spotify_transcript_runner" }),
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  return { ok: res.ok, status: res.status, body };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const startedAt = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const body = (await req.json().catch(() => ({}))) as RequestBody;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const { data: settingRows } = await admin
    .from("app_settings")
    .select("key,value")
    .in("key", ["spotify_transcript_controls", "spotify_transcript_state"]);
  const settings = new Map((settingRows || []).map((row: any) => [row.key, row.value || {}]));
  const ctrl = { ...DEFAULT_CONTROLS, ...(settings.get("spotify_transcript_controls") || {}) };
  const state = { skip: {}, daily: {}, ...(settings.get("spotify_transcript_state") || {}) } as any;

  if (ctrl.enabled !== true) {
    const progress = {
      status: "disabled",
      enabled: false,
      model: SPOTIFY_MODEL,
      policy: ctrl.policy,
      last_run_at: new Date().toISOString(),
    };
    await admin.from("app_settings").upsert({ key: "spotify_transcript_progress", value: progress, updated_at: new Date().toISOString() }, { onConflict: "key" });
    return json({ ok: true, skipped: true, reason: "spotify_transcript_controls.disabled", progress });
  }

  const batchSize = clampInt(body.batch ?? body.pilot ?? ctrl.batch_size, 10, 1, 50);
  const delayMs = clampInt(body.delay_ms ?? ctrl.delay_ms, 1000, 0, 10000);
  const dailyCap = clampInt(ctrl.daily_cap, 100, 1, 5000);
  const timeBudgetMs = clampInt(ctrl.time_budget_ms, 70000, 5000, 120000);
  const candidateScanLimit = clampInt(body.candidate_scan_limit ?? ctrl.candidate_scan_limit, 2500, 50, 10000);
  const dailyWritten = Number(state.daily?.[today]?.written || 0);
  if (dailyWritten >= dailyCap) {
    return json({ ok: true, skipped: true, reason: "daily_cap_reached", dailyCap, dailyWritten });
  }

  const { data: existingRows } = await admin
    .from("episode_transcripts")
    .select("episode_id,updated_at")
    .eq("model", SPOTIFY_MODEL)
    .eq("status", "ok")
    .order("updated_at", { ascending: false });
  const existing = new Set((existingRows || []).map((row: any) => row.episode_id));
  const skip = state.skip || {};
  const nowMs = Date.now();
  const nextSkip = (episodeId: string) => {
    const until = skip?.[episodeId]?.until;
    return until && new Date(until).getTime() > nowMs;
  };

  const { data: metaRows } = await admin
    .from("episode_spotify_meta")
    .select("episode_id,podcast_id,spotify_episode_id,release_date,updated_at")
    .not("spotify_episode_id", "is", null)
    .order("release_date", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(candidateScanLimit);

  const candidates = ((metaRows || []) as Candidate[])
    .filter((row) => row.spotify_episode_id && !existing.has(row.episode_id) && !nextSkip(row.episode_id))
    .slice(0, Math.min(batchSize, Math.max(0, dailyCap - dailyWritten)));

  let calls = 0;
  let written = 0;
  let skipped = 0;
  let errors = 0;
  const statusCounts: Record<string, number> = {};
  const errorSamples: any[] = [];
  const writtenEpisodeIds: string[] = [];
  let token = "";

  if (candidates.length) token = await spotifyAccessToken();

  for (const c of candidates) {
    if (Date.now() - startedAt > timeBudgetMs) break;
    if (calls > 0 && delayMs > 0) await sleep(delayMs);
    calls++;
    try {
      const { res, body: spotifyBody, preview } = await fetchSpotifyTranscript(c.spotify_episode_id, token);
      statusCounts[String(res.status)] = (statusCounts[String(res.status)] || 0) + 1;
      if (res.status === 403 || res.status === 429) {
        errors++;
        const paused = { ...ctrl, enabled: false, paused_at: new Date().toISOString(), paused_reason: `spotify_${res.status}` };
        await admin.from("app_settings").upsert({ key: "spotify_transcript_controls", value: paused, updated_at: new Date().toISOString() }, { onConflict: "key" });
        errorSamples.push({ episode_id: c.episode_id, spotify_episode_id: c.spotify_episode_id, status: res.status, preview });
        break;
      }
      if (res.status === 404 || res.status === 204) {
        skipped++;
        skip[c.episode_id] = { reason: `spotify_${res.status}`, until: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString() };
        continue;
      }
      if (!res.ok) {
        errors++;
        errorSamples.push({ episode_id: c.episode_id, spotify_episode_id: c.spotify_episode_id, status: res.status, preview });
        continue;
      }
      const normalized = normalizeTranscript(spotifyBody);
      if (!normalized.text || normalized.text.length < 80) {
        skipped++;
        skip[c.episode_id] = { reason: "empty_or_short", until: new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString() };
        continue;
      }
      const { error: upsertError } = await admin.from("episode_transcripts").upsert({
        episode_id: c.episode_id,
        podcast_id: c.podcast_id,
        model: SPOTIFY_MODEL,
        source: "spotify_private_api",
        language: normalized.language || "hu",
        transcript: normalized.text,
        segments: normalized.segments,
        content_hash: await sha256(normalized.text),
        status: "ok",
        rights_status: "spotify_private_api_index_only",
        public_display: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: "episode_id,model" });
      if (upsertError) {
        errors++;
        errorSamples.push({ episode_id: c.episode_id, error: upsertError.message });
        continue;
      }
      written++;
      writtenEpisodeIds.push(c.episode_id);
    } catch (e: any) {
      errors++;
      errorSamples.push({ episode_id: c.episode_id, spotify_episode_id: c.spotify_episode_id, message: e?.message || String(e) });
    }
  }

  state.skip = skip;
  state.daily = {
    ...(state.daily || {}),
    [today]: {
      calls: Number(state.daily?.[today]?.calls || 0) + calls,
      written: Number(state.daily?.[today]?.written || 0) + written,
      skipped: Number(state.daily?.[today]?.skipped || 0) + skipped,
      errors: Number(state.daily?.[today]?.errors || 0) + errors,
      updated_at: new Date().toISOString(),
    },
  };

  let downstreamBestTextSource: any = null;
  if (ctrl.auto_best_text_source === false) {
    downstreamBestTextSource = { skipped: true, reason: "auto_best_text_source_disabled" };
  } else {
    try {
        downstreamBestTextSource = await invokeBestTextSourceRunner(writtenEpisodeIds);
    } catch (e: any) {
      downstreamBestTextSource = { ok: false, error: e?.message || String(e) };
    }
  }

  const progress = {
    status: errors ? "completed_with_errors" : "completed",
    last_run_at: new Date().toISOString(),
    model: SPOTIFY_MODEL,
    policy: ctrl.policy,
    batch_size: batchSize,
    delay_ms: delayMs,
    daily_cap: dailyCap,
    candidate_scan_limit: candidateScanLimit,
    candidate_scan_rows: metaRows?.length || 0,
    eligible_candidates: candidates.length,
    calls_last_run: calls,
    written,
    skipped,
    errors_last_run: errors,
    status_counts: statusCounts,
    downstream_best_text_source: downstreamBestTextSource,
    written_episode_ids: writtenEpisodeIds.slice(-50),
    error_samples: errorSamples.slice(0, 20),
  };

  await admin.from("app_settings").upsert({ key: "spotify_transcript_state", value: state, updated_at: new Date().toISOString() }, { onConflict: "key" });
  await admin.from("app_settings").upsert({ key: "spotify_transcript_progress", value: progress, updated_at: new Date().toISOString() }, { onConflict: "key" });

  return json({ ok: true, ...progress });
});
