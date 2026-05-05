// Refreshes all podcasts that have an rss_url and are active or not_checked.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fetchOne } from "../_shared/fetch-one.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: podcasts, error } = await supabase
      .from("podcasts").select("*")
      .not("rss_url", "is", null)
      .in("rss_status", ["active", "not_checked"]);
    if (error) throw error;

    const list = podcasts || [];
    let processed = 0, success = 0, failed = 0, totalNew = 0, totalDup = 0;
    const failures: { id: string; title: string; error: string }[] = [];

    for (const p of list) {
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
      ok: true, total: list.length, processed, success, failed,
      new_episodes: totalNew, duplicates_skipped: totalDup, failures,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
