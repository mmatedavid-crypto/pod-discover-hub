// episode-clean-text-runner: deterministic ($0) pass over pending Hungarian episodes.
// Writes episode_clean_text and flips episodes.clean_text_status.
//
// Quality gate (clean_text_quality_v1, see _shared/clean-text-validation.ts):
// - valid deterministic_v4 output is written unchanged (no corpus drift);
// - empty / severely overcut / malformed output is never marked done: an
//   extract-only rescue is tried, otherwise the prior good text is preserved or
//   the episode is quarantined (bounded attempts, no infinite retries);
// - episodes whose source has no substantive content are marked skipped.
// Optional paid AI trim stays off unless explicitly enabled AND spend-approved.
// Gates downstream chunk embeddings: chunkers only run for clean_text_status='done'.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { runLog } from "../_shared/runner-run-log.ts";
import { heuristicClean, validateExtractOnlyTrim } from "../_shared/episode-text-cleaner.ts";
import {
  CLEAN_TEXT_QUALITY_VERSION,
  MAX_QUARANTINE_ATTEMPTS,
  RESCUE_METHOD_SUFFIX,
  decideCleanText,
  validateCleanOutput,
} from "../_shared/clean-text-validation.ts";
import { cleanYoutubeDescription, loadRecurringByPodcast, loadRecurringSpotifyByPodcast, SPOTIFY_RECLEAN_METHOD } from "../_shared/best-text-source-core.ts";
import { stripSpotifyBoilerplate } from "../_shared/spotify-source-gain.ts";
import { recurringFor } from "../_shared/youtube-source-gain.ts";
import { detectAiTrimBucket, runAiTrim, AI_TRIM_TARGET_BUCKETS, type AiTrimBucket } from "../_shared/clean-text-ai-trim.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const ID_CHUNK_SIZE = 150;

function sha256Hex(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  return crypto.subtle.digest("SHA-256", enc).then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""));
}

async function maybeRequeueLegacyV3(admin: any, ctrl: any, body: any, batchLimit: number) {
  if (ctrl.legacy_v3_backfill_enabled !== true && body.requeue_legacy_v3 !== true) return null;
  const tiers = Array.isArray(body.tiers)
    ? body.tiers.map(String)
    : Array.isArray(ctrl.legacy_v3_backfill_tiers)
      ? ctrl.legacy_v3_backfill_tiers.map(String)
      : ["S", "A", "B", "C", "D"];
  const limit = Math.max(1, Math.min(5000, Number(body.requeue_limit ?? ctrl.legacy_v3_backfill_limit ?? batchLimit)));
  const { data, error } = await admin.rpc("requeue_legacy_clean_text_v4_backfill", {
    _limit: limit,
    _tiers: tiers,
  });
  if (error) {
    console.warn("legacy v3 requeue unavailable", error.message);
    return { ok: false, error: error.message };
  }
  return data;
}

async function updateStatus(admin: any, ids: string[], status: string) {
  for (let i = 0; i < ids.length; i += ID_CHUNK_SIZE) {
    const slice = ids.slice(i, i + ID_CHUNK_SIZE);
    const { error } = await admin.from("episodes").update({ clean_text_status: status }).in("id", slice);
    if (error) throw error;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  let log: ReturnType<typeof runLog> | null = null;

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "episode-clean-text-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "episode_clean_text_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    if (ctrl.enabled === false) return json({ ok: true, paused: true });
    log = runLog(admin, "episode-clean-text-runner");
    await log.start({ method: String(ctrl.method_version ?? "deterministic_v4") });


    const body = await req.json().catch(() => ({}));
    const batchLimit = Math.max(50, Math.min(1000, Number(body.batch ?? ctrl.batch_limit ?? 500)));
    // Cap at 75s to stay under 120s edge fn limit with buffer.
    const timeBudgetMs = Math.max(5_000, Math.min(75_000, (Number(ctrl.time_budget_seconds ?? 60)) * 1000));
    const minChars = Number(ctrl.min_description_chars ?? 40);
    const method = String(ctrl.method_version ?? "deterministic_v4");
    const useBestTextSource = ctrl.use_best_text_source !== false;
    const requeueResult = await maybeRequeueLegacyV3(admin, ctrl, body, batchLimit);

    // ---- Optional paid AI trim: OFF unless enabled AND explicitly spend-approved. ----
    const aiTrimEnabled = ctrl.ai_trim_enabled === true && typeof ctrl.ai_trim_spend_approved_at === "string";
    const aiTrimModel = String(ctrl.ai_trim_model ?? "google/gemini-3.1-flash-lite-preview");
    const aiTrimBudget = Math.max(0, Math.min(5, Number(ctrl.ai_trim_daily_budget_usd ?? 0)));
    const aiTrimMaxPerRun = Math.max(0, Math.min(60, Number(ctrl.ai_trim_max_per_run ?? 0)));
    const aiTrimBuckets = new Set<AiTrimBucket>(
      Array.isArray(ctrl.ai_trim_buckets) && ctrl.ai_trim_buckets.length
        ? ctrl.ai_trim_buckets.map(String) as AiTrimBucket[]
        : AI_TRIM_TARGET_BUCKETS,
    );

    let aiTrimSpendToday = 0;
    if (aiTrimEnabled) {
      const today = new Date(); today.setUTCHours(0, 0, 0, 0);
      const { data: spentRows } = await admin
        .from("ai_call_audit")
        .select("estimated_cost_usd")
        .eq("job_type", "clean_text_ai_trim")
        .gte("created_at", today.toISOString());
      aiTrimSpendToday = (spentRows || []).reduce((s: number, r: any) => s + Number(r.estimated_cost_usd || 0), 0);
    }

    let totalProcessed = 0, totalWritten = 0, totalSkipped = 0, totalErrors = 0, passes = 0;
    let totalRescued = 0, totalKeptPrior = 0, totalQuarantined = 0, totalNoContent = 0, totalValidShort = 0;
    let aiTrimCalls = 0, aiTrimApplied = 0, aiTrimRejected = 0, aiTrimErrors = 0;
    const aiTrimBucketCounts: Record<string, number> = {};
    const reasonCounts: Record<string, number> = {};
    const bump = (rs: string[]) => { for (const r of rs) reasonCounts[r] = (reasonCounts[r] || 0) + 1; };

    // Drain loop: keep claiming batches until time budget exhausted or queue empty.
    while (Date.now() - startedAt < timeBudgetMs) {
      const remaining = timeBudgetMs - (Date.now() - startedAt);
      if (remaining < 4_000) break; // need at least ~4s for a batch

      const { data: eps, error: selErr } = await admin
        .from("episodes")
        .select("id, podcast_id, description, summary, podcasts!inner(language_decision)")
        .eq("clean_text_status", "pending")
        .eq("podcasts.language_decision", "accept_hungarian")
        .limit(batchLimit);
      if (selErr) return json({ ok: false, error: selErr.message }, 500);
      if (!eps || eps.length === 0) break;

      const epIds = eps.map((e: any) => e.id);
      const bestByEp = new Map<string, { source_type: string; raw_text: string; evidence?: any }>();
      const priorByEp = new Map<string, { cleaned_text: string; source_hash: string }>();
      const quarantineByEp = new Map<string, { attempts: number; source_hash: string | null; first_seen_at: string }>();
      for (let i = 0; i < epIds.length; i += ID_CHUNK_SIZE) {
        const slice = epIds.slice(i, i + ID_CHUNK_SIZE);
        if (useBestTextSource) {
          const { data: bestRows, error: bestErr } = await admin
            .from("episode_best_text_source")
            .select("episode_id,source_type,raw_text,evidence")
            .in("episode_id", slice);
          if (bestErr && !String(bestErr.message || "").includes("episode_best_text_source")) throw bestErr;
          for (const row of bestRows || []) {
            const rawText = String((row as any).raw_text || "").trim();
            if (rawText) bestByEp.set(String((row as any).episode_id), {
              source_type: String((row as any).source_type || "rss"),
              raw_text: rawText,
              evidence: (row as any).evidence || null,
            });
          }
        }
        const { data: priorRows, error: priorErr } = await admin
          .from("episode_clean_text")
          .select("episode_id,cleaned_text,source_hash")
          .in("episode_id", slice);
        if (priorErr) throw priorErr;
        for (const row of priorRows || []) priorByEp.set(String((row as any).episode_id), { cleaned_text: String((row as any).cleaned_text || ""), source_hash: String((row as any).source_hash || "") });
        const { data: qRows, error: qErr } = await admin
          .from("episode_clean_text_quarantine")
          .select("episode_id,attempts,source_hash,first_seen_at")
          .in("episode_id", slice);
        if (qErr) throw qErr;
        for (const row of qRows || []) quarantineByEp.set(String((row as any).episode_id), { attempts: Number((row as any).attempts || 0), source_hash: (row as any).source_hash ?? null, first_seen_at: String((row as any).first_seen_at) });
      }

      // Podcast-recurring sponsor/intro blocks for verified-YouTube sources (same as the re-clean planner).
      const ytPodcasts = eps.filter((e: any) => bestByEp.get(String(e.id))?.source_type === "youtube").map((e: any) => String(e.podcast_id || ""));
      const recurringByPodcast = ytPodcasts.length ? await loadRecurringByPodcast(admin, ytPodcasts) : new Map();
      const spPodcasts = eps.filter((e: any) => bestByEp.get(String(e.id))?.source_type === "spotify").map((e: any) => String(e.podcast_id || ""));
      const spotifyRecurringByPodcast = spPodcasts.length ? await loadRecurringSpotifyByPodcast(admin, spPodcasts) : new Map();

      passes++;
      const upsertRows: any[] = [];
      const doneIds: string[] = [];
      const skipIds: string[] = [];
      const quarantineIds: string[] = [];
      const quarantineRows: any[] = [];
      const resolvedIds: string[] = [];

      for (const ep of eps) {
        totalProcessed++;
        const epId = String((ep as any).id);
        const rss = String((ep as any).description || (ep as any).summary || "").trim();
        const best = bestByEp.get(epId);
        // An RSS best-source copy can be stale; the live description is authoritative.
        const raw = String(best && best.source_type !== "rss" ? best.raw_text : rss).trim();
        const usedMethod = best?.source_type && best.source_type !== "rss" ? `${method}+${best.source_type}` : method;
        if (!raw || raw.length < minChars) {
          skipIds.push(epId);
          totalSkipped++;
          continue;
        }
        try {
          const prior = priorByEp.get(epId);
          const v4 = heuristicClean(raw);
          const decision = decideCleanText({ raw, v4, priorCleanedText: prior?.cleaned_text });
          const transcriptHash = best?.source_type === "transcript" && typeof best?.evidence?.content_hash === "string"
            ? best.evidence.content_hash
            : "";

          if (decision.action === "skip_no_content") {
            bump(decision.reasons);
            totalNoContent++;
            totalSkipped++;
            skipIds.push(epId);
            continue;
          }
          if (decision.action === "keep_prior" || decision.action === "quarantine") {
            bump(decision.reasons);
            const q = quarantineByEp.get(epId);
            const source_hash = transcriptHash || await sha256Hex(`${usedMethod}::${raw}`);
            const sameSource = q?.source_hash === source_hash;
            const attempts = sameSource ? (q?.attempts || 0) + 1 : 1;
            quarantineRows.push({
              episode_id: epId,
              source_hash,
              source_type: best?.source_type || "rss",
              reasons: decision.reasons,
              attempts: Math.min(attempts, MAX_QUARANTINE_ATTEMPTS),
              raw_len: raw.length,
              rescue_len: decision.action === "quarantine" ? decision.rescue_len : null,
              cleaner_method: usedMethod,
              kept_prior: decision.action === "keep_prior",
              first_seen_at: sameSource && q?.first_seen_at ? q.first_seen_at : new Date().toISOString(),
              last_seen_at: new Date().toISOString(),
              resolved_at: null,
            });
            if (decision.action === "keep_prior") {
              totalKeptPrior++;
              doneIds.push(epId); // prior good text stays live and unchanged
            } else {
              totalQuarantined++;
              quarantineIds.push(epId);
            }
            continue;
          }

          // decision.action === "write"
          let cleaned = decision.text;
          let appliedMethod = decision.rescued ? `${usedMethod}+${RESCUE_METHOD_SUFFIX}` : usedMethod;
          let verdict = decision.verdict;
          // Verified YouTube source: same deterministic clean (chapters kept, empty labels dropped)
          // and method/hash formula as the re-clean planner, so later runs are idempotent.
          if (best?.source_type === "youtube") {
            const yc = cleanYoutubeDescription(raw, v4, recurringFor(recurringByPodcast.get(String((ep as any).podcast_id || "")), raw));
            if (yc.ok && (yc.verdict.status === "valid" || yc.verdict.status === "valid_short")) {
              cleaned = yc.text; verdict = yc.verdict; appliedMethod = yc.method;
            }
          }
          // Verified Spotify show notes: same boilerplate removal + method/hash as the Spotify re-clean planner.
          if (best?.source_type === "spotify") {
            const sc = cleanYoutubeDescription(stripSpotifyBoilerplate(raw), undefined, recurringFor(spotifyRecurringByPodcast.get(String((ep as any).podcast_id || "")), raw), SPOTIFY_RECLEAN_METHOD);
            if (sc.ok && (sc.verdict.status === "valid" || sc.verdict.status === "valid_short")) {
              cleaned = sc.text; verdict = sc.verdict; appliedMethod = sc.method;
            }
          }
          const removedCats = Array.from(new Set([...decision.removed, ...(best?.source_type ? [`source_${best.source_type}`] : [])]));
          if (best?.source_type === "transcript") removedCats.push("rights_index_only_not_public_display");
          if (decision.rescued) totalRescued++;
          if (verdict.status === "valid_short") totalValidShort++;

          // ----- Optional AI-trim (approved spend only; output must pass the same gates) -----
          if (aiTrimEnabled && aiTrimCalls < aiTrimMaxPerRun && aiTrimSpendToday < aiTrimBudget) {
            const bucket = detectAiTrimBucket({
              raw_text: raw,
              v3_cleaned: cleaned,
              source_type: String(best?.source_type || "rss"),
              rss_description: rss,
            });
            aiTrimBucketCounts[bucket] = (aiTrimBucketCounts[bucket] || 0) + 1;
            if (bucket !== "none" && aiTrimBuckets.has(bucket)) {
              aiTrimCalls++;
              try {
                const aiRes = await runAiTrim({
                  episode_id: epId,
                  raw_text: raw,
                  v3_cleaned: cleaned,
                  bucket,
                  model: aiTrimModel,
                  source_hash: await sha256Hex(`ai_trim::${bucket}::${raw}`),
                });
                aiTrimSpendToday += Number(aiRes.cost_usd || 0);
                const aiText = String(aiRes.cleaned_text || "").trim();
                const aiVerdict = aiText ? validateCleanOutput(raw, aiText) : null;
                if (aiRes.ok && aiText && aiVerdict && aiVerdict.status !== "invalid" && aiVerdict.status !== "no_content" && validateExtractOnlyTrim(raw, aiText).ok) {
                  cleaned = aiText;
                  verdict = aiVerdict;
                  appliedMethod = `${appliedMethod}+ai_trim_${bucket}`;
                  removedCats.push(`ai_trim_${bucket}`);
                  aiTrimApplied++;
                } else {
                  aiTrimRejected++;
                  removedCats.push(`ai_trim_skipped_${aiRes.reason || "quality_gate"}`);
                }
              } catch (e) {
                aiTrimErrors++;
                console.warn("ai_trim error", epId, e);
              }
            }
          }

          const source_hash = transcriptHash || await sha256Hex(`${appliedMethod}::${raw}`);
          upsertRows.push({
            episode_id: epId,
            source_hash,
            cleaned_text: cleaned,
            removed_categories: removedCats,
            cleaner_method: appliedMethod,
            quality_status: verdict.status,
            quality_reasons: decision.rescued ? decision.v4_verdict.reasons.map((r) => `v4_${r}`) : verdict.reasons,
            quality_version: CLEAN_TEXT_QUALITY_VERSION,
            source_type: best?.source_type || "rss",
            updated_at: new Date().toISOString(),
          });
          doneIds.push(epId);
          if (quarantineByEp.has(epId)) resolvedIds.push(epId);
        } catch (e) {
          totalErrors++;
          console.warn("clean-text heuristic error", epId, e);
          await admin.from("episodes").update({ clean_text_status: "error" }).eq("id", epId);
        }
      }

      // Bulk upsert all validated rows, then bulk flip status. Massively cheaper than per-row.
      let writeOk = true;
      if (upsertRows.length > 0) {
        const { error: upErr } = await admin.from("episode_clean_text").upsert(upsertRows, { onConflict: "episode_id" });
        if (upErr) {
          writeOk = false;
          totalErrors += upsertRows.length;
          console.warn("clean-text bulk upsert error", upErr.message);
        } else {
          totalWritten += upsertRows.length;
        }
      }
      // Only flip to done when the write succeeded; kept-prior rows are always safe.
      const writtenIds = new Set(upsertRows.map((r) => r.episode_id));
      const safeDone = writeOk ? doneIds : doneIds.filter((id) => !writtenIds.has(id));
      if (safeDone.length) await updateStatus(admin, safeDone, "done");
      if (skipIds.length) await updateStatus(admin, skipIds, "skipped");
      if (quarantineIds.length) await updateStatus(admin, quarantineIds, "quarantined");
      if (quarantineRows.length) {
        const { error: qErr } = await admin.from("episode_clean_text_quarantine").upsert(quarantineRows, { onConflict: "episode_id" });
        if (qErr) console.warn("quarantine upsert error", qErr.message);
      }
      if (writeOk && resolvedIds.length) {
        for (let i = 0; i < resolvedIds.length; i += ID_CHUNK_SIZE) {
          await admin.from("episode_clean_text_quarantine").update({ resolved_at: new Date().toISOString() })
            .in("episode_id", resolvedIds.slice(i, i + ID_CHUNK_SIZE)).is("resolved_at", null);
        }
      }
      if (!writeOk) break; // do not spin on a failing write

      // If the batch came back smaller than the limit, queue is drained.
      if (eps.length < batchLimit) break;
    }

    const runtimeMs = Date.now() - startedAt;
    const summary = {
      passes,
      processed: totalProcessed,
      written: totalWritten,
      skipped: totalSkipped,
      errors: totalErrors,
      quality: {
        version: CLEAN_TEXT_QUALITY_VERSION,
        rescued: totalRescued,
        kept_prior: totalKeptPrior,
        quarantined: totalQuarantined,
        no_content: totalNoContent,
        valid_short: totalValidShort,
        reasons: reasonCounts,
      },
      runtime_ms: runtimeMs,
      method_version: method,
      use_best_text_source: useBestTextSource,
      legacy_v3_requeue: requeueResult,
      ai_trim: {
        enabled: aiTrimEnabled,
        model: aiTrimModel,
        calls: aiTrimCalls,
        applied: aiTrimApplied,
        rejected: aiTrimRejected,
        errors: aiTrimErrors,
        spend_today_usd: aiTrimSpendToday,
        daily_budget_usd: aiTrimBudget,
        bucket_counts: aiTrimBucketCounts,
      },
    };

    // Persist a lightweight progress snapshot for observability (separate key from controls).
    try {
      await admin.from("app_settings").upsert({
        key: "episode_clean_text_progress",
        value: { last_run_at: new Date().toISOString(), batch_limit: batchLimit, time_budget_seconds: Math.round(timeBudgetMs / 1000), ...summary },
      }, { onConflict: "key" });
    } catch (_) { /* non-fatal */ }

    return json({ ok: true, ...summary });
  } catch (e) {
    console.error("episode-clean-text-runner err", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});
