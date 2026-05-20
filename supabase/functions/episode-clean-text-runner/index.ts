// episode-clean-text-runner: deterministic-only pass over episodes.description.
// Writes to episode_clean_text and flips episodes.clean_text_status to 'done'.
// NO Lovable AI call here. AI cleanup will only be added if heuristic quality is insufficient.
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
    const batchLimit = Math.max(10, Math.min(500, Number(body.batch ?? ctrl.batch_limit ?? 200)));
    const timeBudgetMs = Math.max(5_000, Math.min(80_000, (Number(ctrl.time_budget_seconds ?? 40)) * 1000));
    const minChars = Number(ctrl.min_description_chars ?? 40);
    const method = String(ctrl.method_version ?? "deterministic_v1");

    // Pick pending episodes that have a non-trivial description.
    const { data: eps, error: selErr } = await admin
      .from("episodes")
      .select("id, podcast_id, description, summary")
      .eq("clean_text_status", "pending")
      .limit(batchLimit);
    if (selErr) return json({ ok: false, error: selErr.message }, 500);

    let processed = 0, written = 0, skipped = 0, errors = 0;

    for (const ep of (eps || [])) {
      if (Date.now() - startedAt > timeBudgetMs) break;
      processed++;
      const raw = String((ep as any).description || (ep as any).summary || "");
      if (!raw || raw.trim().length < minChars) {
        await admin.from("episodes").update({ clean_text_status: "skipped" }).eq("id", (ep as any).id);
        skipped++;
        continue;
      }
      try {
        const { text, removed } = heuristicClean(raw);
        const source_hash = await sha256Hex(`${method}::${raw}`);
        const cleaned = text.trim();
        // Upsert into episode_clean_text
        const { error: upErr } = await admin.from("episode_clean_text").upsert({
          episode_id: (ep as any).id,
          source_hash,
          cleaned_text: cleaned,
          removed_categories: removed,
          cleaner_method: method,
        }, { onConflict: "episode_id" });
        if (upErr) {
          errors++;
          await admin.from("episodes").update({ clean_text_status: "error" }).eq("id", (ep as any).id);
          continue;
        }
        await admin.from("episodes").update({ clean_text_status: "done" }).eq("id", (ep as any).id);
        written++;
      } catch (e) {
        errors++;
        await admin.from("episodes").update({ clean_text_status: "error" }).eq("id", (ep as any).id);
        console.warn("clean-text error", (ep as any).id, e);
      }
    }

    return json({
      ok: true,
      processed, written, skipped, errors,
      runtime_ms: Date.now() - startedAt,
      method_version: method,
    });
  } catch (e) {
    console.error("episode-clean-text-runner err", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});
