// Drains duplicate episodes in small batches within a single invocation.
// Runs by cron until backlog is empty. Calls dedup_episodes_guid_batch then
// dedup_episodes_audio_url_batch repeatedly until time budget exhausted or
// both batches return 0.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIME_BUDGET_MS = 110_000;
const RESERVE_MS = 5_000;
const BATCH = 2000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const t0 = Date.now();
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "episode-dedup-runner");
    if (guard.blocked) {
      return new Response(JSON.stringify({ ok: false, blocked: true, reason: guard.reason }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let totalGuid = 0, totalAudio = 0, loops = 0;
    while (Date.now() - t0 < TIME_BUDGET_MS - RESERVE_MS) {
      loops++;
      const { data: g, error: ge } = await admin.rpc("dedup_episodes_guid_batch", { _batch: BATCH });
      if (ge) throw ge;
      const guidDel = (g as number) ?? 0;
      totalGuid += guidDel;

      let audioDel = 0;
      if (Date.now() - t0 < TIME_BUDGET_MS - RESERVE_MS) {
        const { data: a, error: ae } = await admin.rpc("dedup_episodes_audio_url_batch", { _batch: BATCH });
        if (ae) throw ae;
        audioDel = (a as number) ?? 0;
        totalAudio += audioDel;
      }

      if (guidDel === 0 && audioDel === 0) break; // backlog empty
    }

    const elapsed = Date.now() - t0;
    return new Response(JSON.stringify({
      ok: true, loops, deleted_by_guid: totalGuid, deleted_by_audio_url: totalAudio,
      elapsed_ms: elapsed, drained: totalGuid === 0 && totalAudio === 0 && loops === 1,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : "error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
