// Stage 2 — rules-based title cleanup runner.
// Backfills `display_title` on episodes and podcasts. Zero AI cost.
// Runs in batches, respects time budget, can be invoked manually or by cron.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
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
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(50, Math.min(2000, Number(body.limit) || 500));
    const force = !!body.force; // re-process even rows that already have display_title
    const TIME_BUDGET_MS = 50_000;
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

    // Auto-revert cron: if backlog is small, switch back to every 6 hours.
    let cron_reverted = false;
    try {
      const { count: pending } = await admin
        .from("episodes")
        .select("id", { count: "exact", head: true })
        .is("display_title", null);
      if ((pending ?? 0) < 5000) {
        await admin.rpc as any; // no-op placeholder; we use raw SQL via PostgREST below
        const url = `${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/cron_revert_title_cleanup`;
        // Best-effort: call a SECURITY DEFINER function if present; ignore failures.
        await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          },
          body: "{}",
        }).catch(() => {});
        cron_reverted = true;
      }
    } catch (_) { /* ignore */ }

    return json({
      ok: true,
      duration_ms: Date.now() - startedAt,
      podcasts: { scanned: podScanned, cleaned: podUpdated },
      episodes: { scanned: epScanned, cleaned: epUpdated },
      hit_time_budget: Date.now() - startedAt > TIME_BUDGET_MS,
      cron_reverted,
    });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
