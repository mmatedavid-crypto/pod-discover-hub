// Recompute mood_collections.recommended_episode_count for all active moods.
// Cheap: just calls the SQL function which loops over active moods and runs
// the existing recommendation RPC (vector lookup + HU language filter).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Background-jobs kill switch
  try {
    const { data: gs } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "background_jobs")
      .maybeSingle();
    const v = (gs?.value || {}) as any;
    if (v.incident_mode === true || v.enabled === false) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "background_jobs disabled" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  } catch (_e) {
    // fail-closed on guard
    return new Response(
      JSON.stringify({ skipped: true, reason: "guard_check_failed" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const started = Date.now();
  const { data, error } = await admin.rpc("recompute_mood_recommended_counts");
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const rows = (data as Array<{ mood_slug: string; count: number; weak: boolean }>) || [];
  const weak = rows.filter((r) => r.weak).map((r) => r.mood_slug);
  return new Response(
    JSON.stringify({
      ok: true,
      duration_ms: Date.now() - started,
      total: rows.length,
      weak_moods: weak,
      counts: rows,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
