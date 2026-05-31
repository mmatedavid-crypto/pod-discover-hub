// episode-clean-text-runner: deterministic-only pass over episodes.description.
// Writes to episode_clean_text and flips episodes.clean_text_status to 'done'.
// NO Lovable AI / Gemini calls here. AI cleanup will only be added if heuristic quality is insufficient.
// Gates downstream chunk embeddings: chunkers should only run for clean_text_status='done'.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { heuristicClean } from "../_shared/episode-text-cleaner.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

function sha256Hex(s: string): Promise<string> {
  const enc = new TextEncoder().encode(s);
  return crypto.subtle.digest("SHA-256", enc).then((buf) => Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join(""));
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

    let totalProcessed = 0, totalWritten = 0, totalSkipped = 0, totalErrors = 0, passes = 0;

    // Drain loop: keep claiming batches until time budget exhausted or queue empty.
    while (Date.now() - startedAt < timeBudgetMs) {
      const remaining = timeBudgetMs - (Date.now() - startedAt);
      if (remaining < 4_000) break; // need at least ~4s for a batch

      const { data: eps, error: selErr } = await admin
        .from("episodes")
        .select("id, description, summary")
        .eq("clean_text_status", "pending")
        .limit(batchLimit);
      if (selErr) return json({ ok: false, error: selErr.message }, 500);
      if (!eps || eps.length === 0) break;

      // Fetch confirmed YouTube descriptions in bulk — if YT desc is materially
      // richer than RSS desc, prefer it as the clean-text input.
      const epIds = eps.map((e: any) => e.id);
      const ytDescByEp = new Map<string, string>();
      if (epIds.length) {
        const { data: ytRows } = await admin
          .from("episode_youtube_links")
          .select("episode_id, youtube_description")
          .in("episode_id", epIds)
          .eq("status", "confirmed");
        for (const r of ytRows || []) {
          if (r.youtube_description) ytDescByEp.set(r.episode_id, String(r.youtube_description));
        }
      }

      passes++;
      const upsertRows: any[] = [];
      const doneIds: string[] = [];
      const skipIds: string[] = [];

      for (const ep of eps) {
        totalProcessed++;
        const rss = String((ep as any).description || (ep as any).summary || "");
        const yt = ytDescByEp.get((ep as any).id) || "";
        // Prefer YT desc only when it's clearly richer than RSS (avoid 1-line YT desc overriding a long RSS body).
        const useYt = yt.length >= 400 && yt.length > rss.length * 1.5 + 200;
        const raw = useYt ? yt : rss;
        if (!raw || raw.trim().length < minChars) {
          skipIds.push((ep as any).id);
          totalSkipped++;
          continue;
        }
        try {
          const { text, removed } = heuristicClean(raw);
          const source_hash = await sha256Hex(`${method}::${useYt ? "ytdesc::" : ""}${raw}`);
          upsertRows.push({
            episode_id: (ep as any).id,
            source_hash,
            cleaned_text: text.trim(),
            removed_categories: removed,
            cleaner_method: useYt ? `${method}+ytdesc` : method,
          });
          doneIds.push((ep as any).id);
        } catch (e) {
          totalErrors++;
          console.warn("clean-text heuristic error", (ep as any).id, e);
          // Mark as error individually (rare path).
          await admin.from("episodes").update({ clean_text_status: "error" }).eq("id", (ep as any).id);
        }
      }

      // Bulk upsert all cleaned rows, then bulk flip status. Massively cheaper than per-row.
      if (upsertRows.length > 0) {
        const { error: upErr } = await admin.from("episode_clean_text").upsert(upsertRows, { onConflict: "episode_id" });
        if (upErr) {
          totalErrors += upsertRows.length;
          console.warn("clean-text bulk upsert error", upErr.message);
          // Don't flip status on failure — they remain pending and will be retried.
        } else {
          totalWritten += upsertRows.length;
          // Chunk the IN list to avoid PostgREST URL length limits (~150 ids per call).
          for (let i = 0; i < doneIds.length; i += 150) {
            const slice = doneIds.slice(i, i + 150);
            await admin.from("episodes").update({ clean_text_status: "done" }).in("id", slice);
          }
        }
      }
      if (skipIds.length > 0) {
        for (let i = 0; i < skipIds.length; i += 150) {
          const slice = skipIds.slice(i, i + 150);
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
    });
  } catch (e) {
    console.error("episode-clean-text-runner err", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});
