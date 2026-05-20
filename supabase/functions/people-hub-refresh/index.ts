import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Optional ?skipGated=1 to only refresh hub score
  const url = new URL(req.url);
  const skipGated = url.searchParams.get("skipGated") === "1";

  let gated: any = null;
  if (!skipGated) {
    const { data: gd, error: ge } = await supabase.rpc("recompute_person_gated_counts");
    if (ge) {
      return new Response(JSON.stringify({ ok: false, stage: "gated", error: ge.message }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    gated = gd;
  }

  const { data, error } = await supabase.rpc("refresh_people_hub_score");
  if (error) {
    return new Response(JSON.stringify({ ok: false, stage: "hub_score", error: error.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return new Response(JSON.stringify({ ok: true, gated, hub: data }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
