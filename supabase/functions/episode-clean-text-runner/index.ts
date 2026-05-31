// episode-clean-text-runner: deterministic-only pass over episodes.description.
// Writes to episode_clean_text and flips episodes.clean_text_status to 'done'.
// NO Lovable AI / Gemini calls here. AI cleanup will only be added if heuristic quality is insufficient.
// Gates downstream chunk embeddings: chunkers should only run for clean_text_status='done'.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { heuristicClean } from "../_shared/episode-text-cleaner.ts";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "episode-clean-text-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "episode_clean_text_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    if (ctrl.enabled === false) return json({ ok: true, paused: true });

    const body = await req.json().catch(() => ({}));
    const batchLimit = Math.max(50, Math.min(1000, Number(body.batch ?? ctrl.batch_limit ?? 500)));
    // Cap at 75s to stay under 120s edge fn limit with buffer.
    const timeBudgetMs = Math.max(5_000, Math.min(75_000, (Number(ctrl.time_budget_seconds ?? 60)) * 1000));
    const minChars = Number(ctrl.min_description_chars ?? 40);
    const method = String(ctrl.method_version ?? "deterministic_v3");
    const useBestTextSource = ctrl.use_best_text_source !== false;
    const requeueResult = await maybeRequeueLegacyV3(admin, ctrl, body, batchLimit);

    // ---- AI-trim gate (LIVE 2026-05-31) ----
    // Bucket-routes yt_dominant / over_trimmed_v3 / sponsor_heavy to flash-lite few-shot.
    // v3 still runs first; AI-trim only OVERWRITES cleaned_text when guards pass.
    const aiTrimEnabled = ctrl.ai_trim_enabled === true;
    const aiTrimModel = String(ctrl.ai_trim_model ?? "google/gemini-3.1-flash-lite-preview");
    const aiTrimBudget = Number(ctrl.ai_trim_daily_budget_usd ?? 5);
    const aiTrimMaxPerRun = Math.max(0, Math.min(200, Number(ctrl.ai_trim_max_per_run ?? 60)));
    const aiTrimBuckets = new Set<AiTrimBucket>(
      Array.isArray(ctrl.ai_trim_buckets) && ctrl.ai_trim_buckets.length
        ? ctrl.ai_trim_buckets.map(String) as AiTrimBucket[]
        : AI_TRIM_TARGET_BUCKETS,
    );

    let aiTrimSpendToday = 0;
    if (aiTrimEnabled) {
      const today = new Date(); today.setUTCHours(0,0,0,0);
      const { data: spentRows } = await admin
        .from("ai_call_audit")
        .select("estimated_cost_usd")
        .eq("job_type", "clean_text_ai_trim")
        .gte("created_at", today.toISOString());
      aiTrimSpendToday = (spentRows || []).reduce((s: number, r: any) => s + Number(r.estimated_cost_usd || 0), 0);
    }

    let totalProcessed = 0, totalWritten = 0, totalSkipped = 0, totalErrors = 0, passes = 0;
    let aiTrimCalls = 0, aiTrimApplied = 0, aiTrimRejected = 0, aiTrimErrors = 0;
    const aiTrimBucketCounts: Record<string, number> = {};

    // Drain loop: keep claiming batches until time budget exhausted or queue empty.
    while (Date.now() - startedAt < timeBudgetMs) {
      const remaining = timeBudgetMs - (Date.now() - startedAt);
      if (remaining < 4_000) break; // need at least ~4s for a batch

      const { data: eps, error: selErr } = await admin
        .from("episodes")
        .select("id, description, summary, podcasts!inner(is_hungarian,language_decision)")
        .eq("clean_text_status", "pending")
        .eq("podcasts.is_hungarian", true)
        .eq("podcasts.language_decision", "accept_hungarian")
        .limit(batchLimit);
      if (selErr) return json({ ok: false, error: selErr.message }, 500);
      if (!eps || eps.length === 0) break;

      const epIds = eps.map((e: any) => e.id);
      const bestByEp = new Map<string, { source_type: string; raw_text: string }>();
      if (useBestTextSource) {
        for (let i = 0; i < epIds.length; i += ID_CHUNK_SIZE) {
          const slice = epIds.slice(i, i + ID_CHUNK_SIZE);
          const { data: bestRows, error: bestErr } = await admin
            .from("episode_best_text_source")
            .select("episode_id,source_type,raw_text")
            .in("episode_id", slice);
          if (bestErr && !String(bestErr.message || "").includes("episode_best_text_source")) throw bestErr;
          for (const row of bestRows || []) {
            const rawText = String((row as any).raw_text || "").trim();
            if (rawText) bestByEp.set(String((row as any).episode_id), {
              source_type: String((row as any).source_type || "rss"),
              raw_text: rawText,
            });
          }
        }
      }

      passes++;
      const upsertRows: any[] = [];
      const doneIds: string[] = [];
      const skipIds: string[] = [];

      for (const ep of eps) {
        totalProcessed++;
        const rss = String((ep as any).description || (ep as any).summary || "").trim();
        const best = bestByEp.get((ep as any).id);
        const raw = String(best?.raw_text || rss).trim();
        const usedMethod = best?.source_type && best.source_type !== "rss" ? `${method}+${best.source_type}` : method;
        if (!raw || raw.length < minChars) {
          skipIds.push((ep as any).id);
          totalSkipped++;
          continue;
        }
        try {
          const { text, removed } = heuristicClean(raw);
          let cleaned = text.trim();
          let appliedMethod = usedMethod;
          const removedCats = best?.source_type ? Array.from(new Set([...removed, `source_${best.source_type}`])) : [...removed];

          // ----- AI-trim gate -----
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
                  episode_id: (ep as any).id,
                  raw_text: raw,
                  v3_cleaned: cleaned,
                  bucket,
                  model: aiTrimModel,
                  source_hash: await sha256Hex(`ai_trim::${bucket}::${raw}`),
                });
                if (aiRes.ok && aiRes.cleaned_text) {
                  cleaned = aiRes.cleaned_text;
                  appliedMethod = `${usedMethod}+ai_trim_${bucket}`;
                  removedCats.push(`ai_trim_${bucket}`);
                  aiTrimSpendToday += Number(aiRes.cost_usd || 0);
                  aiTrimApplied++;
                } else {
                  aiTrimRejected++;
                  removedCats.push(`ai_trim_skipped_${aiRes.reason || "unknown"}`);
                }
              } catch (e) {
                aiTrimErrors++;
                console.warn("ai_trim error", (ep as any).id, e);
              }
            }
          }

          const source_hash = await sha256Hex(`${appliedMethod}::${raw}`);
          upsertRows.push({
            episode_id: (ep as any).id,
            source_hash,
            cleaned_text: cleaned,
            removed_categories: removedCats,
            cleaner_method: appliedMethod,
          });
          doneIds.push((ep as any).id);
        } catch (e) {
          totalErrors++;
          console.warn("clean-text heuristic error", (ep as any).id, e);
          await admin.from("episodes").update({ clean_text_status: "error" }).eq("id", (ep as any).id);
        }
      }


      // Bulk upsert all cleaned rows, then bulk flip status. Massively cheaper than per-row.
      if (upsertRows.length > 0) {
        const { error: upErr } = await admin.from("episode_clean_text").upsert(upsertRows, { onConflict: "episode_id" });
        if (upErr) {
          totalErrors += upsertRows.length;
          console.warn("clean-text bulk upsert error", upErr.message);
        } else {
          totalWritten += upsertRows.length;
          for (let i = 0; i < doneIds.length; i += ID_CHUNK_SIZE) {
            const slice = doneIds.slice(i, i + ID_CHUNK_SIZE);
            await admin.from("episodes").update({ clean_text_status: "done" }).in("id", slice);
          }
        }
      }
      if (skipIds.length > 0) {
        for (let i = 0; i < skipIds.length; i += ID_CHUNK_SIZE) {
          const slice = skipIds.slice(i, i + ID_CHUNK_SIZE);
          await admin.from("episodes").update({ clean_text_status: "skipped" }).in("id", slice);
        }
      }

      // If the batch came back smaller than the limit, queue is drained.
      if (eps.length < batchLimit) break;
    }

    const runtimeMs = Date.now() - startedAt;

    // Persist a lightweight progress snapshot for observability.
    try {
      await admin.from("app_settings").upsert({
        key: "episode_clean_text_progress",
        value: {
          last_run_at: new Date().toISOString(),
          runtime_ms: runtimeMs,
          passes,
          processed: totalProcessed,
          written: totalWritten,
          skipped: totalSkipped,
          errors: totalErrors,
          batch_limit: batchLimit,
          time_budget_seconds: Math.round(timeBudgetMs / 1000),
          method_version: method,
          use_best_text_source: useBestTextSource,
          legacy_v3_requeue: requeueResult,
          ai_trim: {
            enabled: aiTrimEnabled,
            model: aiTrimModel,
            daily_budget_usd: aiTrimBudget,
            spend_today_usd: aiTrimSpendToday,
            calls: aiTrimCalls,
            applied: aiTrimApplied,
            rejected: aiTrimRejected,
            errors: aiTrimErrors,
            bucket_counts: aiTrimBucketCounts,
          },
        },
      }, { onConflict: "key" });
    } catch (_) { /* non-fatal */ }

    return json({
      ok: true,
      passes,
      processed: totalProcessed,
      written: totalWritten,
      skipped: totalSkipped,
      errors: totalErrors,
      runtime_ms: runtimeMs,
      method_version: method,
      use_best_text_source: useBestTextSource,
      legacy_v3_requeue: requeueResult,
      ai_trim: {
        enabled: aiTrimEnabled,
        calls: aiTrimCalls,
        applied: aiTrimApplied,
        rejected: aiTrimRejected,
        errors: aiTrimErrors,
        spend_today_usd: aiTrimSpendToday,
        daily_budget_usd: aiTrimBudget,
        bucket_counts: aiTrimBucketCounts,
      },
    });
  } catch (e) {
    console.error("episode-clean-text-runner err", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});
