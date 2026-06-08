// spotify-transcript-runner
// Conservative, operator-controlled drain for Spotify native transcript reads.
// Disabled by default via app_settings.spotify_transcript_controls.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const UA = "Podiverzum/1.0 transcript-indexer";
const SPOTIFY_MODEL = "spotify-native";
const TRANSCRIPT_URL_PREFIX = "https://spclient.wg.spotify.com/transcript-read-along/v2/episode/";
const TOKEN_URL = "https://open.spotify.com/get_access_token?reason=transport&productType=web_player";
const CLIENT_TOKEN_URL = "https://clienttoken.spotify.com/v1/clienttoken";

type Candidate = {
  episode_id: string;
  podcast_id: string;
  spotify_episode_id: string;
  podcast_tier: string | null;
  published_at: string | null;
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

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getAccessToken(): Promise<{ accessToken: string; clientId: string }> {
  const r = await timeoutFetch(15_000)(TOKEN_URL, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
  });
  if (!r.ok) throw new Error(`spotify_token_${r.status}:${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  if (!j?.accessToken) throw new Error("spotify_token_missing_access_token");
  return { accessToken: j.accessToken, clientId: j.clientId || "" };
}

async function getClientToken(clientId: string): Promise<string> {
  if (!clientId) return "";
  const r = await timeoutFetch(15_000)(CLIENT_TOKEN_URL, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({
      client_data: {
        client_version: "1.2.46.25.g7f5e2865",
        client_id: clientId,
        js_sdk_data: {
          device_brand: "unknown",
          device_model: "unknown",
          os: "linux",
          os_version: "unknown",
          device_id: crypto.randomUUID().replace(/-/g, ""),
          device_type: "computer",
        },
      },
    }),
  });
  if (!r.ok) return "";
  const j = await r.json();
  return j?.granted_token?.token || "";
}

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : v != null ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function segmentText(s: any): string {
  return String(s?.text ?? s?.body ?? s?.transcript ?? s?.content ?? s?.line ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function segmentTimes(s: any): { start: number | null; end: number | null } {
  const startRaw = num(s?.start ?? s?.start_seconds ?? s?.startTime ?? s?.startTimeMs ?? s?.offset);
  const endRaw = num(s?.end ?? s?.end_seconds ?? s?.endTime ?? s?.endTimeMs);
  const durRaw = num(s?.duration ?? s?.durationMs ?? s?.dur);
  const scale = (v: number | null) => v == null ? null : v / (v > 10_000 ? 1000 : 1);
  const start = scale(startRaw);
  const end = scale(endRaw) ?? (start != null && durRaw != null ? start + (durRaw / (durRaw > 10_000 ? 1000 : 1)) : null);
  return { start, end };
}

function rawSegments(j: any): any[] {
  if (!j) return [];
  if (Array.isArray(j)) return j;
  if (Array.isArray(j.section)) return j.section;
  if (Array.isArray(j.sections)) return j.sections.flatMap((s: any) => Array.isArray(s?.segments) ? s.segments : [s]);
  if (Array.isArray(j.transcript)) return j.transcript;
  if (Array.isArray(j.lines)) return j.lines;
  if (Array.isArray(j.segments)) return j.segments;
  return [];
}

function normalizeTranscript(j: any): { text: string; segments: any[]; language: string | null; duration: number | null } {
  const segments = rawSegments(j).map((s: any, idx: number) => {
    const text = segmentText(s);
    if (!text) return null;
    const { start, end } = segmentTimes(s);
    return { idx, start, end, text };
  }).filter(Boolean) as Array<{ idx: number; start: number | null; end: number | null; text: string }>;
  const text = segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
  const lastTimed = [...segments].reverse().find((s) => s.end != null || s.start != null);
  const duration = lastTimed ? Math.round(Number(lastTimed.end ?? lastTimed.start ?? 0)) : null;
  return {
    text,
    segments,
    language: j?.language || j?.lang || j?.locale || null,
    duration,
  };
}

async function fetchSpotifyTranscript(spotifyEpisodeId: string, accessToken: string, clientToken: string) {
  const url = `${TRANSCRIPT_URL_PREFIX}${encodeURIComponent(spotifyEpisodeId)}?format=json&platform=web`;
  const r = await timeoutFetch(20_000)(url, {
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Accept": "application/json",
      "App-Platform": "WebPlayer",
      "Spotify-App-Version": "1.2.46.25.g7f5e2865",
      ...(clientToken ? { "Client-Token": clientToken } : {}),
      "User-Agent": UA,
    },
  });
  const raw = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(raw); } catch { /* handled by caller */ }
  return { status: r.status, parsed, raw_preview: raw.slice(0, 240) };
}

async function invokeBestTextSourceRunner(episodeIds: string[]) {
  if (!episodeIds.length) return null;
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return { ok: false, skipped: true, reason: "missing_supabase_env" };
  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/episode-best-text-source-runner`;
  const r = await timeoutFetch(20_000)(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
      "User-Agent": UA,
    },
    body: JSON.stringify({
      ids: episodeIds,
      force: true,
      source: "spotify_transcript_runner",
    }),
  });
  const text = await r.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = { preview: text.slice(0, 240) }; }
  return {
    ok: r.ok,
    status: r.status,
    body,
  };
}

function tierWeight(tier: string | null): number {
  if (tier === "S") return 100;
  if (tier === "A") return 80;
  if (tier === "B") return 60;
  if (tier === "C") return 30;
  return 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "spotify-transcript-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));
    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "spotify_transcript_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    const pilot = Number(body.pilot || 0);
    if (ctrl.enabled !== true && !pilot && body.force !== true) return json({ ok: true, paused: true });
    if (ctrl.paused_at && !pilot && body.force !== true) return json({ ok: true, paused: true, reason: ctrl.paused_reason || "operator_paused" });

    const batch = Math.max(1, Math.min(25, pilot || Number(body.batch || ctrl.batch_size || 10)));
    const delayMs = Math.max(500, Math.min(10_000, Number(body.delay_ms || ctrl.delay_ms || 1000)));
    const dailyCap = Math.max(0, Math.min(5000, Number(ctrl.daily_cap || 100)));
    const timeBudgetMs = Math.max(10_000, Math.min(100_000, Number(ctrl.time_budget_ms || 70_000)));

    const { data: stateRow } = await admin.from("app_settings").select("value").eq("key", "spotify_transcript_state").maybeSingle();
    const state = (stateRow?.value || {}) as any;
    const skipIds = new Set<string>(Object.keys(state.skip || {}));

    const today = new Date().toISOString().slice(0, 10);
    const todayCalls = Number(state.daily?.[today]?.calls || 0);
    if (!pilot && dailyCap > 0 && todayCalls >= dailyCap) {
      return json({ ok: true, daily_cap_reached: true, calls_today: todayCalls, daily_cap: dailyCap });
    }

    const { data: metaRows, error: metaErr } = await admin
      .from("episode_spotify_meta")
      .select("episode_id,podcast_id,spotify_episode_id,release_date")
      .not("spotify_episode_id", "is", null)
      .limit(Math.max(batch * 100, 1000));
    if (metaErr) throw metaErr;

    const alreadyIds = new Set<string>();
    const epIds = (metaRows || []).map((r: any) => r.episode_id);
    for (let i = 0; i < epIds.length; i += 500) {
      const slice = epIds.slice(i, i + 500);
      const { data } = await admin
        .from("episode_transcripts")
        .select("episode_id")
        .in("episode_id", slice)
        .eq("model", SPOTIFY_MODEL)
        .eq("status", "ok");
      for (const r of data || []) alreadyIds.add(String((r as any).episode_id));
    }

    const { data: episodeRows, error: epErr } = await admin
      .from("episodes")
      .select("id,published_at,podcasts!inner(id,language_decision,rank_label)")
      .in("id", epIds)
      .eq("podcasts.language_decision", "accept_hungarian");
    if (epErr) throw epErr;
    const epById = new Map<string, any>();
    for (const e of episodeRows || []) epById.set(String((e as any).id), e);

    const candidates: Candidate[] = [];
    for (const m of metaRows || []) {
      const sid = String((m as any).spotify_episode_id || "");
      const eid = String((m as any).episode_id || "");
      const ep = epById.get(eid);
      if (!sid || !eid || !ep || alreadyIds.has(eid) || skipIds.has(sid)) continue;
      candidates.push({
        episode_id: eid,
        podcast_id: String((m as any).podcast_id || ep.podcasts?.id || ""),
        spotify_episode_id: sid,
        podcast_tier: ep.podcasts?.rank_label || null,
        published_at: ep.published_at || (m as any).release_date || null,
      });
    }
    candidates.sort((a, b) => {
      const tierDelta = tierWeight(b.podcast_tier) - tierWeight(a.podcast_tier);
      if (tierDelta !== 0) return tierDelta;
      return new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime();
    });
    const picks = candidates.slice(0, batch);
    if (!picks.length) return json({ ok: true, processed: 0, reason: "no_candidates" });

    const { accessToken, clientId } = await getAccessToken();
    const clientToken = await getClientToken(clientId).catch(() => "");

    let calls = 0, written = 0, skipped = 0, errors = 0;
    const statusCounts: Record<string, number> = {};
    const errorSamples: any[] = [];
    const nextSkip = { ...(state.skip || {}) };
    const writtenEpisodeIds: string[] = [];

    for (const c of picks) {
      if (Date.now() - startedAt > timeBudgetMs - 5_000) break;
      if (!pilot && dailyCap > 0 && todayCalls + calls >= dailyCap) break;
      calls++;
      try {
        const res = await fetchSpotifyTranscript(c.spotify_episode_id, accessToken, clientToken);
        statusCounts[String(res.status)] = (statusCounts[String(res.status)] || 0) + 1;
        if (res.status === 404) {
          skipped++;
          nextSkip[c.spotify_episode_id] = { reason: "not_found", at: new Date().toISOString(), episode_id: c.episode_id };
        } else if (res.status === 403 || res.status === 429) {
          const nextCtrl = {
            ...ctrl,
            enabled: false,
            paused_at: new Date().toISOString(),
            paused_reason: `spotify_${res.status}`,
          };
          await admin.from("app_settings").upsert({ key: "spotify_transcript_controls", value: nextCtrl, updated_at: new Date().toISOString() });
          errors++;
          errorSamples.push({ spotify_episode_id: c.spotify_episode_id, status: res.status, preview: res.raw_preview });
          break;
        } else if (res.status !== 200) {
          errors++;
          if (errorSamples.length < 5) errorSamples.push({ spotify_episode_id: c.spotify_episode_id, status: res.status, preview: res.raw_preview });
        } else {
          const normalized = normalizeTranscript(res.parsed);
          if (normalized.text.length < 120 || normalized.segments.length < 3) {
            skipped++;
            nextSkip[c.spotify_episode_id] = { reason: "empty_or_too_short", at: new Date().toISOString(), episode_id: c.episode_id };
          } else {
            await admin.from("episode_transcripts").upsert({
              episode_id: c.episode_id,
              podcast_id: c.podcast_id,
              model: SPOTIFY_MODEL,
              source: "spotify_native",
              rights_status: "spotify_private_api_index_only",
              public_display: false,
              status: "ok",
              language: normalized.language,
              transcript: normalized.text,
              segments: normalized.segments,
              duration_seconds: normalized.duration,
              cost_usd: 0,
              content_hash: await sha256(normalized.text),
              updated_at: new Date().toISOString(),
            }, { onConflict: "episode_id,model" });
            written++;
            writtenEpisodeIds.push(c.episode_id);
          }
        }
      } catch (e: any) {
        errors++;
        if (errorSamples.length < 5) errorSamples.push({ spotify_episode_id: c.spotify_episode_id, error: e?.message || String(e) });
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    let downstreamBestTextSource: any = ctrl.auto_best_text_source === false
      ? { ok: true, skipped: true, reason: "disabled_by_spotify_transcript_controls" }
      : null;
    if (ctrl.auto_best_text_source !== false) {
      try {
        downstreamBestTextSource = await invokeBestTextSourceRunner(writtenEpisodeIds);
      } catch (e: any) {
        downstreamBestTextSource = { ok: false, error: e?.message || String(e) };
      }
    }

    const nextState = {
      ...state,
      skip: Object.fromEntries(Object.entries(nextSkip).slice(-5000)),
      daily: {
        ...(state.daily || {}),
        [today]: {
          calls: todayCalls + calls,
          written: Number(state.daily?.[today]?.written || 0) + written,
          skipped: Number(state.daily?.[today]?.skipped || 0) + skipped,
          errors: Number(state.daily?.[today]?.errors || 0) + errors,
          updated_at: new Date().toISOString(),
        },
      },
    };
    const progress = {
      last_run_at: new Date().toISOString(),
      runtime_ms: Date.now() - startedAt,
      candidates: picks.length,
      calls_last_run: calls,
      written,
      skipped,
      errors_last_run: errors,
      status_counts: statusCounts,
      error_samples: errorSamples,
      written_episode_ids: writtenEpisodeIds.slice(-50),
      downstream_best_text_source: downstreamBestTextSource,
      batch_size: batch,
      delay_ms: delayMs,
      daily_cap: dailyCap,
      model: SPOTIFY_MODEL,
      policy: "default_disabled_operator_controlled_native_transcript_indexing_v1",
    };
    await admin.from("app_settings").upsert([
      { key: "spotify_transcript_state", value: nextState, updated_at: new Date().toISOString() },
      { key: "spotify_transcript_progress", value: progress, updated_at: new Date().toISOString() },
    ], { onConflict: "key" });

    return json({ ok: true, ...progress });
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "spotify_transcript_runner_error" }, 500);
  }
});
