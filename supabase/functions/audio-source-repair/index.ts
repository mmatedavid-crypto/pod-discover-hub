// Automatic audio source verifier & repair runner for Podiverzum HU.
// - Triggered hourly by pg_cron (only when due rows exist) or manually by trusted callers.
// - Probes reported episodes with small byte-range GET + audio magic-byte validation.
// - Never disables working audio on timeouts, geo-blocks, 403/429/5xx, or when listeners
//   recently completed playback; always respects manual overrides.
// - Repairs broken enclosures from the same confirmed show's live RSS feed (GUID or unique
//   conservative title+date/duration) or safe same-host URL canonicalization, verified live.
// - When no working official audio file exists, promotes/marks verified episode-level
//   alternatives (Spotify/Apple/YouTube/live publisher page) with full audit & rollback.
// - Zero paid AI, zero audio proxying/downloading, zero full-catalog scanning.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { denyUntrustedCaller } from "../_shared/internal-auth.ts";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { runLog } from "../_shared/runner-run-log.ts";
import { safePublicFetch } from "../_shared/safe-public-fetch.ts";
import { parseFeed, type FeedItem } from "../_shared/rss.ts";
import {
  classifyProbeOutcome,
  collectVerifiedEpisodeAlternatives,
  decideAfterProbe,
  deriveSafeHostCanonicalCandidates,
  matchEpisodeInFeedItems,
  nextBackoffMinutes,
  shouldAllowHostCanonicalFallback,
  type ProbeClassification,
} from "../_shared/audio-source-repair.ts";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const MAX_PROBE_BYTES = 8192;
const PROBE_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 6;
const MAX_FEED_BYTES = 8 * 1024 * 1024;

type ProbeResult = ProbeClassification & {
  status: number | null;
  contentType: string;
  contentLength: number | null;
  bytesRead: number;
  finalUrl: string;
  usedRange: boolean;
  error?: string;
};

async function readBoundedBytes(res: Response, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      const need = maxBytes - total;
      chunks.push(value.length > need ? value.subarray(0, need) : value);
      total += Math.min(value.length, need);
    }
  } finally {
    try { await reader.cancel(); } catch { /* ignore */ }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function singleProbeAttempt(url: string, withRange: boolean): Promise<ProbeResult> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PROBE_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "User-Agent": BROWSER_UA,
      "Accept": "audio/*,*/*;q=0.8",
      "Accept-Language": "hu-HU,hu;q=0.9,en;q=0.7",
    };
    if (withRange) headers["Range"] = "bytes=0-4095";

    const res = await safePublicFetch(url, { method: "GET", headers, signal: ctl.signal }, MAX_REDIRECTS);
    const contentType = res.headers.get("content-type") || "";
    const clRaw = res.headers.get("content-length");
    const contentLength = clRaw && /^\d+$/.test(clRaw.trim()) ? parseInt(clRaw.trim(), 10) : null;
    const finalUrl = res.url || url;

    let bytes = new Uint8Array(0);
    if (res.status >= 200 && res.status < 300) {
      bytes = await readBoundedBytes(res, MAX_PROBE_BYTES);
    } else {
      try { await res.body?.cancel(); } catch { /* ignore */ }
    }

    const cls = classifyProbeOutcome({
      status: res.status,
      contentType,
      contentLength: res.status === 206 ? null : contentLength,
      bytes,
      finalUrl,
    });
    return {
      ...cls,
      status: res.status,
      contentType,
      contentLength,
      bytesRead: bytes.length,
      finalUrl,
      usedRange: withRange,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      verdict: "inconclusive",
      format: null,
      reason: msg.includes("abort") ? "timeout" : `fetch_error:${msg.slice(0, 80)}`,
      status: null,
      contentType: "",
      contentLength: null,
      bytesRead: 0,
      finalUrl: url,
      usedRange: withRange,
      error: msg.slice(0, 120),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeAudioUrl(url: string): Promise<ProbeResult> {
  const first = await singleProbeAttempt(url, true);
  // Some podcast CDNs (Megaphone/Podtrac/Anchor) reject Range headers from server IPs with 400/403/405/416.
  // Retry once without Range while still aborting the body after MAX_PROBE_BYTES.
  if (first.verdict !== "valid_audio" && (first.status === 400 || first.status === 403 || first.status === 405 || first.status === 416)) {
    const second = await singleProbeAttempt(url, false);
    if (second.verdict === "valid_audio" || second.verdict === "definitive_dead") return second;
  }
  return first;
}

async function isLivePublicPage(url: string): Promise<boolean> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 7000);
  try {
    const res = await safePublicFetch(
      url,
      { method: "GET", headers: { "User-Agent": BROWSER_UA, "Accept": "text/html,*/*;q=0.8" }, signal: ctl.signal },
      4,
    );
    try { await res.body?.cancel(); } catch { /* ignore */ }
    // Accept 200-299; reject 404/410/5xx; treat 403/429 conservatively as unverified for generic pages
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPodcastFeedItems(rssUrl: string, cache: Map<string, FeedItem[] | null>): Promise<FeedItem[] | null> {
  if (cache.has(rssUrl)) return cache.get(rssUrl) ?? null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 14_000);
  try {
    const res = await safePublicFetch(
      rssUrl,
      { method: "GET", headers: { "User-Agent": "PodiverzumBot/1.0 (+https://podiverzum.hu)" }, signal: ctl.signal },
      MAX_REDIRECTS,
    );
    if (!res.ok || !res.body) {
      try { await res.body?.cancel(); } catch { /* ignore */ }
      cache.set(rssUrl, null);
      return null;
    }
    const bytes = await readBoundedBytes(res, MAX_FEED_BYTES);
    const xml = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const items = parseFeed(xml);
    cache.set(rssUrl, items);
    return items;
  } catch {
    cache.set(rssUrl, null);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const denied = await denyUntrustedCaller(req, "audio-source-repair");
  if (denied) return denied;

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const action = String(body.action || "tick");

  // 1. Rollback action (always allowed for trusted callers even if background jobs paused)
  if (action === "rollback") {
    const { data, error } = await admin.rpc("revert_audio_source_repair_v1", {
      p_audit_id: body.audit_id ?? null,
      p_batch_id: body.batch_id ?? null,
      p_episode_id: body.episode_id ?? null,
      p_reason: String(body.reason || "manual_rollback"),
    });
    if (error) return json({ ok: false, error: error.message }, 400);
    return json({ ok: true, action, result: data });
  }

  // 2. Seed last 30 days playback_error backlog (bounded, never full-catalog)
  if (action === "seed_30d") {
    const days = Math.max(1, Math.min(90, Number(body.days) || 30));
    const limit = Math.max(1, Math.min(500, Number(body.limit) || 200));
    const { data, error } = await admin.rpc("seed_audio_source_repair_queue_30d_v1", {
      p_days: days,
      p_limit: limit,
    });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, action, days, seeded: data });
  }

  // 2b. Idempotent targeted enqueue for double-encoded Archive.org episodes of a specific HU show
  if (action === "enqueue_double_encoded_archive") {
    const slug = String(body.podcast_slug || "").trim();
    if (!slug) return json({ ok: false, error: "podcast_slug_required" }, 400);
    const limit = Math.max(1, Math.min(1000, Number(body.limit) || 500));
    const { data, error } = await admin.rpc("enqueue_targeted_double_encoded_archive_v1", {
      p_podcast_slug: slug,
      p_limit: limit,
    });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, action, result: data });
  }

  // 3. Regular tick (cron or manual bounded pass)
  const guard = await checkBackgroundJobsAllowed(admin, "audio-source-repair");
  if (guard.blocked && !body.ignore_pause) {
    return json({ ok: true, skipped: true, reason: guard.reason });
  }

  const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "audio_source_repair_controls").maybeSingle();
  const ctrl = (ctrlRow?.value || {}) as Record<string, unknown>;
  if (ctrl.enabled === false && !body.ignore_pause) {
    return json({ ok: true, skipped: true, reason: "audio_source_repair_disabled" });
  }

  const perRun = Math.max(1, Math.min(20, Number(body.limit) || Number(ctrl.per_run) || 8));
  const leaseSec = Math.max(60, Math.min(900, Number(ctrl.lease_seconds) || 300));
  const timeBudgetMs = Math.max(10_000, Math.min(55_000, Number(body.time_budget_ms) || Number(ctrl.time_budget_ms) || 45_000));
  const baseBackoffMin = Math.max(30, Math.min(1440, Number(ctrl.defer_backoff_minutes) || 360));
  const recheckBrokenMin = Math.max(60, (Number(ctrl.recheck_broken_no_alt_hours) || 168) * 60);

  const batchId = `asr_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${crypto.randomUUID().slice(0, 6)}`;
  const logger = runLog(admin, "audio-source-repair");
  await logger.start({ batch_id: batchId, trigger: body.trigger || "manual", per_run: perRun });

  const startedAt = Date.now();
  const summary = {
    batch_id: batchId,
    claimed: 0,
    repaired: 0,
    already_ok: 0,
    recovered_internal: 0,
    external_only: 0,
    broken_no_alternative: 0,
    deferred: 0,
    skipped_manual: 0,
    skipped_stale: 0,
    errors: 0,
    items: [] as Array<Record<string, unknown>>,
  };

  const releaseStatusFor = (prev: unknown, fallback: "pending" | "deferred") =>
    prev === "external_only" || prev === "broken_no_alternative" ? prev : fallback;

  async function applyRepair(params: Record<string, unknown>) {
    const { data, error } = await admin.rpc("apply_audio_source_repair_v1", params);
    if (error) throw error;
    return (data || {}) as Record<string, unknown>;
  }

  try {
    const { data: claimed, error: claimErr } = await admin.rpc("claim_audio_source_repair_queue_v2", {
      p_limit: perRun,
      p_lease_seconds: leaseSec,
      p_owner: batchId,
    });
    if (claimErr) throw claimErr;

    const rows = (claimed || []) as Array<Record<string, any>>;
    summary.claimed = rows.length;
    if (!rows.length) {
      await logger.finish("ok", summary);
      return json({ ok: true, ...summary });
    }

    const feedCache = new Map<string, FeedItem[] | null>();

    for (const row of rows) {
      if (Date.now() - startedAt > timeBudgetMs) {
        // Release remaining time-budget rows cleanly while preserving prior rare-recheck status
        const restoredStatus = releaseStatusFor(row.previous_status, "pending");
        await admin.from("audio_source_repair_queue")
          .update({
            status: restoredStatus,
            previous_status: null,
            lease_owner: null,
            lease_expires_at: null,
            next_attempt_at: new Date().toISOString(),
          })
          .eq("episode_id", row.episode_id)
          .eq("lease_owner", batchId);
        continue;
      }

      try {
        if (row.audio_manual_override) {
          summary.skipped_manual++;
          continue;
        }

        // 1. Probe current audio_url (or treat missing audio_url as definitive_dead)
        const probe: ProbeResult = row.audio_url
          ? await probeAudioUrl(row.audio_url)
          : {
              verdict: "definitive_dead",
              format: null,
              reason: "missing_audio_url",
              status: null,
              contentType: "",
              contentLength: null,
              bytesRead: 0,
              finalUrl: "",
              usedRange: false,
            };

        const probeDetail = {
          reason: probe.reason,
          format: probe.format,
          content_type: probe.contentType,
          content_length: probe.contentLength,
          bytes_read: probe.bytesRead,
          used_range: probe.usedRange,
          final_url_host: (() => { try { return new URL(probe.finalUrl).hostname; } catch { return null; } })(),
          recent_progress_count: row.recent_progress_count,
          recent_progress_after_last_error: row.recent_progress_after_last_error,
        };

        const step1 = decideAfterProbe({
          probeVerdict: probe.verdict,
          recentProgressCount: Number(row.recent_progress_count || 0),
          recentProgressAfterLastError: Number(row.recent_progress_after_last_error || 0),
        });

        if (step1 === "already_ok") {
          const matchMethod = probe.verdict === "valid_audio" ? "direct_probe_ok" : "recent_playback_ok";
          const applied = await applyRepair({
            p_batch_id: batchId,
            p_episode_id: row.episode_id,
            p_expected_audio_url: row.audio_url,
            p_action: "marked_ok",
            p_match_method: matchMethod,
            p_match_evidence: probeDetail,
            p_probe_status: probe.status,
            p_probe_verdict: probe.verdict,
            p_probe_detail: probeDetail,
            p_resolution_note: matchMethod === "direct_probe_ok" ? `audio_valid:${probe.format}` : "recent_listener_progress",
          });
          if (!applied.ok) {
            summary.skipped_stale++;
            summary.items.push({ episode_id: row.episode_id, outcome: "skipped_stale", reason: applied.reason });
            continue;
          }
          summary.already_ok++;
          if (applied.recovered_internal) summary.recovered_internal++;
          summary.items.push({ episode_id: row.episode_id, outcome: "already_ok", recovered_internal: !!applied.recovered_internal, reason: probe.reason, method: matchMethod });
          continue;
        }

        if (step1 === "defer") {
          const backoff = nextBackoffMinutes(Number(row.attempts || 1), baseBackoffMin);
          const applied = await applyRepair({
            p_batch_id: batchId,
            p_episode_id: row.episode_id,
            p_expected_audio_url: row.audio_url,
            p_action: "deferred",
            p_match_method: "inconclusive_probe",
            p_match_evidence: probeDetail,
            p_probe_status: probe.status,
            p_probe_verdict: probe.verdict,
            p_probe_detail: probeDetail,
            p_backoff_minutes: backoff,
            p_resolution_note: `deferred:${probe.reason}`,
          });
          if (!applied.ok) {
            summary.skipped_stale++;
            summary.items.push({ episode_id: row.episode_id, outcome: "skipped_stale", reason: applied.reason });
            continue;
          }
          summary.deferred++;
          summary.items.push({ episode_id: row.episode_id, outcome: "deferred", reason: probe.reason, backoff_min: backoff });
          continue;
        }

        // 2. Audio is definitively dead and no listener succeeded after error -> look for official repair!
        let repairedUrl: string | null = null;
        let repairMethod: string | null = null;
        let repairEvidence: Record<string, unknown> = {};
        let repairEpisodeUrl: string | null = null;
        let rssUnavailableOrCandidateInconclusive: string | null = null;

        // 2a. Same confirmed show's live RSS feed
        if (row.podcast_rss_url) {
          const feedItems = await fetchPodcastFeedItems(row.podcast_rss_url, feedCache);
          if (!feedItems || !feedItems.length) {
            if (row.requires_rss_match) rssUnavailableOrCandidateInconclusive = "rss_feed_unavailable";
          } else {
            const matched = matchEpisodeInFeedItems(
              {
                title: row.episode_title,
                guid: row.episode_guid,
                published_at: row.episode_published_at,
                duration_seconds: row.episode_duration_seconds,
                audio_url: row.audio_url,
              },
              feedItems,
            );
            if (matched && matched.item.audio_url) {
              const candProbe = await probeAudioUrl(matched.item.audio_url);
              if (candProbe.verdict === "valid_audio") {
                repairedUrl = matched.item.audio_url.trim();
                repairMethod = matched.method;
                repairEpisodeUrl = matched.item.link && /^https?:\/\//i.test(matched.item.link) ? matched.item.link.trim() : null;
                repairEvidence = {
                  ...matched.evidence,
                  rss_url: row.podcast_rss_url,
                  candidate_probe: {
                    status: candProbe.status,
                    format: candProbe.format,
                    content_type: candProbe.contentType,
                    bytes_read: candProbe.bytesRead,
                  },
                };
              } else if (candProbe.verdict === "inconclusive") {
                rssUnavailableOrCandidateInconclusive = `rss_candidate_inconclusive:${candProbe.reason}`;
              }
            }
          }
        } else if (row.requires_rss_match) {
          rssUnavailableOrCandidateInconclusive = "missing_podcast_rss_url";
        }

        // 2b. Safe same-host canonical URL fixes (disabled when row.requires_rss_match is true)
        if (!repairedUrl && row.audio_url && shouldAllowHostCanonicalFallback(row)) {
          const hostCandidates = deriveSafeHostCanonicalCandidates(row.audio_url);
          for (const hc of hostCandidates) {
            const candProbe = await probeAudioUrl(hc.url);
            if (candProbe.verdict === "valid_audio") {
              repairedUrl = hc.url;
              repairMethod = hc.method;
              repairEvidence = {
                derived_from: row.audio_url,
                candidate_probe: {
                  status: candProbe.status,
                  format: candProbe.format,
                  content_type: candProbe.contentType,
                  bytes_read: candProbe.bytesRead,
                },
              };
              break;
            }
          }
        }

        if (repairedUrl && repairMethod) {
          const applied = await applyRepair({
            p_batch_id: batchId,
            p_episode_id: row.episode_id,
            p_expected_audio_url: row.audio_url,
            p_action: "repaired_audio",
            p_new_audio_url: repairedUrl,
            p_new_episode_url: repairEpisodeUrl,
            p_match_method: repairMethod,
            p_match_evidence: { original_probe: probeDetail, repair: repairEvidence },
            p_probe_status: probe.status,
            p_probe_verdict: probe.verdict,
            p_probe_detail: probeDetail,
            p_resolution_note: `repaired:${repairMethod}`,
          });
          if (!applied.ok) {
            summary.skipped_stale++;
            summary.items.push({ episode_id: row.episode_id, outcome: "skipped_stale", reason: applied.reason });
            continue;
          }
          summary.repaired++;
          if (applied.recovered_internal) summary.recovered_internal++;
          summary.items.push({ episode_id: row.episode_id, outcome: "repaired", recovered_internal: !!applied.recovered_internal, method: repairMethod, new_audio_url: repairedUrl });
          continue;
        }

        // When fresh RSS was required and unavailable (or its candidate probe was inconclusive), defer instead of marking dead
        if (rssUnavailableOrCandidateInconclusive) {
          const backoff = nextBackoffMinutes(Number(row.attempts || 1), baseBackoffMin);
          const applied = await applyRepair({
            p_batch_id: batchId,
            p_episode_id: row.episode_id,
            p_expected_audio_url: row.audio_url,
            p_action: "deferred",
            p_match_method: "rss_retry_needed",
            p_match_evidence: { original_probe: probeDetail, reason: rssUnavailableOrCandidateInconclusive },
            p_probe_status: probe.status,
            p_probe_verdict: probe.verdict,
            p_probe_detail: probeDetail,
            p_backoff_minutes: backoff,
            p_resolution_note: `deferred:${rssUnavailableOrCandidateInconclusive}`,
          });
          if (!applied.ok) {
            summary.skipped_stale++;
            summary.items.push({ episode_id: row.episode_id, outcome: "skipped_stale", reason: applied.reason });
            continue;
          }
          summary.deferred++;
          summary.items.push({ episode_id: row.episode_id, outcome: "deferred", reason: rssUnavailableOrCandidateInconclusive, backoff_min: backoff });
          continue;
        }

        // 3. No working official audio file exists -> pick a verified episode-level alternative
        const alts = collectVerifiedEpisodeAlternatives({
          audio_url: row.audio_url,
          spotify_url: row.spotify_url,
          apple_url: row.apple_url,
          youtube_url: row.youtube_url,
          episode_url: row.episode_url,
          best_spotify_meta_url: row.best_spotify_meta_url,
          best_spotify_meta_confidence: row.best_spotify_meta_confidence,
          confirmed_youtube_video_id: row.confirmed_youtube_video_id,
        });

        let chosenAlt: (typeof alts)[number] | null = null;
        for (const alt of alts) {
          if (!alt.needsHttpCheck) {
            chosenAlt = alt;
            break;
          }
          if (await isLivePublicPage(alt.url)) {
            chosenAlt = alt;
            break;
          }
        }

        if (chosenAlt) {
          const applied = await applyRepair({
            p_batch_id: batchId,
            p_episode_id: row.episode_id,
            p_expected_audio_url: row.audio_url,
            p_action: "marked_external_only",
            p_new_spotify_url: chosenAlt.field === "spotify_url" ? chosenAlt.url : null,
            p_new_apple_url: chosenAlt.field === "apple_url" ? chosenAlt.url : null,
            p_new_youtube_url: chosenAlt.field === "youtube_url" ? chosenAlt.url : null,
            p_new_episode_url: chosenAlt.field === "episode_url" ? chosenAlt.url : null,
            p_match_method: chosenAlt.source,
            p_match_evidence: {
              original_probe: probeDetail,
              alternative_field: chosenAlt.field,
              alternative_url: chosenAlt.url,
              spotify_confidence: row.best_spotify_meta_confidence ?? null,
            },
            p_probe_status: probe.status,
            p_probe_verdict: probe.verdict,
            p_probe_detail: probeDetail,
            p_resolution_note: `external_only:${chosenAlt.source}`,
          });
          if (!applied.ok) {
            summary.skipped_stale++;
            summary.items.push({ episode_id: row.episode_id, outcome: "skipped_stale", reason: applied.reason });
            continue;
          }
          summary.external_only++;
          summary.items.push({ episode_id: row.episode_id, outcome: "external_only", field: chosenAlt.field, source: chosenAlt.source, url: chosenAlt.url });
        } else {
          const applied = await applyRepair({
            p_batch_id: batchId,
            p_episode_id: row.episode_id,
            p_expected_audio_url: row.audio_url,
            p_action: "marked_broken_no_alt",
            p_match_method: "no_verified_alternative",
            p_match_evidence: { original_probe: probeDetail, checked_alternatives: alts.length },
            p_probe_status: probe.status,
            p_probe_verdict: probe.verdict,
            p_probe_detail: probeDetail,
            p_backoff_minutes: recheckBrokenMin,
            p_resolution_note: `broken_no_alt:${probe.reason}`,
          });
          if (!applied.ok) {
            summary.skipped_stale++;
            summary.items.push({ episode_id: row.episode_id, outcome: "skipped_stale", reason: applied.reason });
            continue;
          }
          summary.broken_no_alternative++;
          summary.items.push({ episode_id: row.episode_id, outcome: "broken_no_alternative", reason: probe.reason });
        }
      } catch (e) {
        summary.errors++;
        const msg = e instanceof Error ? e.message : String(e);
        const restoredStatus = releaseStatusFor(row.previous_status, "deferred");
        await admin.from("audio_source_repair_queue")
          .update({
            status: restoredStatus,
            previous_status: null,
            lease_owner: null,
            lease_expires_at: null,
            next_attempt_at: new Date(Date.now() + 60 * 60_000).toISOString(),
            resolution_note: `worker_error:${msg.slice(0, 120)}`,
            updated_at: new Date().toISOString(),
          })
          .eq("episode_id", row.episode_id)
          .eq("lease_owner", batchId);
        summary.items.push({ episode_id: row.episode_id, outcome: "error", error: msg.slice(0, 120) });
      }
      await logger.beat(`done:${summary.items.length}/${rows.length}`);
    }

    await logger.finish("ok", { ...summary, items: undefined });
    return json({ ok: true, ...summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logger.finish("error", { ...summary, items: undefined }, msg);
    return json({ ok: false, error: msg, ...summary }, 500);
  }
});