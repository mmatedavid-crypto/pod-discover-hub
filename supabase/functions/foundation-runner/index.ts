// One-time Foundation Import runner.
// Loops pi-dump-process in foundation mode until either:
//   - no unprocessed staged candidates remain, or
//   - time budget is exhausted (caller invokes again to continue).
// Body: { batch?: number (default 250), max_batches?: number (default 8) }
// Tracks progress in app_settings.value.foundation_import.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const batch = Math.max(50, Math.min(250, Number(body.batch) || 250));
    const maxBatches = Math.max(1, Math.min(20, Number(body.max_batches) || 8));

    const startedAt = new Date().toISOString();
    const totals = {
      batches: 0, scanned: 0, auto_added: 0, queued: 0,
      hidden_low_rank: 0, rejected: 0, skipped_duplicates: 0, failed_rss_tests: 0,
    };
    const start = Date.now();
    const TIME_BUDGET = 110_000;
    let stoppedReason = "complete";

    for (let i = 0; i < maxBatches; i++) {
      if (Date.now() - start > TIME_BUDGET) { stoppedReason = "time_budget"; break; }
      // Any unprocessed left?
      const { count: remaining } = await supabase.from("pi_feed_staging")
        .select("id", { count: "exact", head: true }).eq("processed", false);
      if (!remaining) { stoppedReason = "no_candidates"; break; }

      const res = await fetch(`${url}/functions/v1/pi-dump-process`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}` },
        body: JSON.stringify({ foundation: true, batch }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { stoppedReason = `processor_error:${j?.error || res.status}`; break; }
      const c = j.counters || {};
      totals.batches++;
      totals.scanned += c.scanned || 0;
      totals.auto_added += c.auto_added || 0;
      totals.queued += c.queued || 0;
      totals.hidden_low_rank += c.hidden_low_rank || 0;
      totals.rejected += c.rejected || 0;
      totals.skipped_duplicates += c.skipped_duplicates || 0;
      totals.failed_rss_tests += c.failed_rss_tests || 0;
      if (!c.scanned) { stoppedReason = "no_progress"; break; }
    }

    // Persist progress under app_settings.foundation_import (cumulative + last run)
    const { data: cur } = await supabase.from("app_settings").select("value").eq("key", "foundation_import").maybeSingle();
    const prev: any = cur?.value || { totals: { batches: 0, scanned: 0, auto_added: 0, queued: 0, hidden_low_rank: 0, rejected: 0, skipped_duplicates: 0, failed_rss_tests: 0 } };
    const merged = {
      first_started_at: prev.first_started_at || startedAt,
      last_started_at: startedAt,
      last_finished_at: new Date().toISOString(),
      last_stopped_reason: stoppedReason,
      last_run: totals,
      totals: {
        batches: (prev.totals?.batches || 0) + totals.batches,
        scanned: (prev.totals?.scanned || 0) + totals.scanned,
        auto_added: (prev.totals?.auto_added || 0) + totals.auto_added,
        queued: (prev.totals?.queued || 0) + totals.queued,
        hidden_low_rank: (prev.totals?.hidden_low_rank || 0) + totals.hidden_low_rank,
        rejected: (prev.totals?.rejected || 0) + totals.rejected,
        skipped_duplicates: (prev.totals?.skipped_duplicates || 0) + totals.skipped_duplicates,
        failed_rss_tests: (prev.totals?.failed_rss_tests || 0) + totals.failed_rss_tests,
      },
    };
    await supabase.from("app_settings").upsert({ key: "foundation_import", value: merged, updated_at: new Date().toISOString() });

    const { count: remaining } = await supabase.from("pi_feed_staging")
      .select("id", { count: "exact", head: true }).eq("processed", false);

    return new Response(JSON.stringify({
      ok: true, stopped_reason: stoppedReason, run: totals, cumulative: merged.totals, unprocessed_remaining: remaining || 0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
