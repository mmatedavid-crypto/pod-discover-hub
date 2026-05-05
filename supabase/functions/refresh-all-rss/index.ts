// Refreshes podcasts in batches with optional mode filter.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fetchOne } from "../_shared/fetch-one.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    let body: any = {};
    try { body = await req.json(); } catch { /* empty body ok */ }
    const mode: string = body?.mode || "all"; // all | failed | not_checked | active
    const limit: number = Math.max(1, Math.min(Number(body?.limit) || 40, 60));

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let q = supabase.from("podcasts").select("*").not("rss_url", "is", null);
    if (mode === "failed") q = q.eq("rss_status", "failed");
    else if (mode === "not_checked") q = q.in("rss_status", ["not_checked"]);
    else if (mode === "active") q = q.eq("rss_status", "active");
    else q = q.in("rss_status", ["active", "not_checked", "failed"]);
    // Prioritize least-recently-fetched first
    q = q.order("last_fetched_at", { ascending: true, nullsFirst: true });

    const { data: podcasts, error } = await q;
    if (error) throw error;

    const all = podcasts || [];
    const batch = all.slice(0, limit);
    const remaining = Math.max(0, all.length - batch.length);

    let processed = 0, success = 0, failed = 0, totalNew = 0, totalDup = 0;
    const failures: { id: string; title: string; error: string }[] = [];
    const start = Date.now();
    const TIME_BUDGET_MS = 110_000;

    for (const p of batch) {
      if (Date.now() - start > TIME_BUDGET_MS) break;
      try {
        const r = await fetchOne(supabase, p);
        processed++;
        if (r.ok) { success++; totalNew += r.new || 0; totalDup += r.duplicates || 0; }
        else { failed++; failures.push({ id: p.id, title: p.title, error: r.error || "unknown" }); }
      } catch (e) {
        processed++; failed++;
        failures.push({ id: p.id, title: p.title, error: e instanceof Error ? e.message : "error" });
      }
    }

    return new Response(JSON.stringify({
      ok: true, mode, total: batch.length, processed, success, failed,
      new_episodes: totalNew, duplicates_skipped: totalDup,
      remaining, failures,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
