// Stage 2 — rules-based title cleanup runner.
// Backfills `display_title` on episodes and podcasts. Zero AI cost.
// Runs in batches, respects time budget, can be invoked manually or by cron.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { cleanTitle } from "../_shared/title-cleanup.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(b: any, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const __guard = await checkBackgroundJobsAllowed(admin, "title-cleanup-runner");
    if (__guard.blocked) return new Response(JSON.stringify({ ok: true, skipped: true, reason: __guard.reason }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(50, Math.min(2000, Number(body.limit) || 500));
    const force = !!body.force; // re-process even rows that already have display_title
    const TIME_BUDGET_MS = Math.max(10_000, Math.min(110_000, Number(body.time_budget_ms) || 55_000));
    const startedAt = Date.now();

    // ---------- Podcasts ----------
    const podQ = admin.from("podcasts")
      .select("id, title, display_title")
      .order("podiverzum_rank", { ascending: false })
      .limit(limit);
    if (!force) podQ.is("display_title", null);
    const { data: podcasts, error: pErr } = await podQ;
    if (pErr) throw pErr;

    let podScanned = 0, podUpdated = 0;
    for (const p of podcasts || []) {
      podScanned++;
      // For podcasts we just normalize whitespace + strip bracket cruft (no episode markers).
      const { display, changed } = cleanTitle(p.title || "", null);
      if (changed) {
        await admin.from("podcasts").update({ display_title: display }).eq("id", p.id);
        podUpdated++;
      } else {
        // Mark as "processed but unchanged" by setting display_title = title
        await admin.from("podcasts").update({ display_title: p.title }).eq("id", p.id);
      }
    }

    // ---------- Episodes ----------
    const epQ = admin.from("episodes")
      .select("id, title, display_title, podcast_id, podcasts!inner(title, podiverzum_rank)")
      .order("podcasts(podiverzum_rank)", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (!force) epQ.is("display_title", null);
    const { data: episodes, error: eErr } = await epQ;
    if (eErr) throw eErr;

    let epScanned = 0, epUpdated = 0;
    const updates: { id: string; display_title: string }[] = [];
    for (const e of episodes || []) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      epScanned++;
      const podTitle = (e as any).podcasts?.title as string | undefined;
      const { display, changed } = cleanTitle(e.title || "", podTitle);
      const finalDisplay = changed ? display : e.title;
      updates.push({ id: e.id, display_title: finalDisplay });
      if (changed) epUpdated++;
    }

    // Bulk update via per-row update (Supabase JS lacks bulk update). Chunk to avoid latency.
    const CHUNK = 50;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const slice = updates.slice(i, i + CHUNK);
      await Promise.all(
        slice.map((u) => admin.from("episodes").update({ display_title: u.display_title }).eq("id", u.id)),
      );
    }

    // Adaptive cadence DISABLED during conservative recovery phase.
    // The runner must NOT self-change jobid 10's cron schedule.
    // Approved schedule (`0 6 * * *`) is managed manually until further notice.
    let pending = 0;
    const recommended: string | null = null;
    const applied: string | null = null;
    try {
      const { count } = await admin
        .from("episodes")
        .select("id", { count: "exact", head: true })
        .is("display_title", null);
      pending = count ?? 0;
    } catch (_) { /* ignore */ }

    await admin.from("app_settings").upsert({
      key: "title_cleanup",
      value: {
        last_run: {
          duration_ms: Date.now() - startedAt,
          podcasts: { scanned: podScanned, cleaned: podUpdated },
          episodes: { scanned: epScanned, cleaned: epUpdated },
          pending, recommended_schedule: recommended, applied_schedule: applied,
          finished_at: new Date().toISOString(),
        },
      } as any,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return json({
      ok: true,
      duration_ms: Date.now() - startedAt,
      podcasts: { scanned: podScanned, cleaned: podUpdated },
      episodes: { scanned: epScanned, cleaned: epUpdated },
      hit_time_budget: Date.now() - startedAt > TIME_BUDGET_MS,
      pending, recommended_schedule: recommended, applied_schedule: applied,
    });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
