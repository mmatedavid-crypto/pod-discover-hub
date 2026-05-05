// Fetch one podcast feed (RSS or Atom) and upsert episodes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fetchOne } from "../_shared/fetch-one.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { podcast_id } = await req.json();
    if (!podcast_id) throw new Error("podcast_id required");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: podcast, error } = await supabase.from("podcasts").select("*").eq("id", podcast_id).single();
    if (error || !podcast) throw new Error("podcast not found");
    const r = await fetchOne(supabase, podcast);
    return new Response(JSON.stringify({ ok: r.ok, count: r.new + r.duplicates, ...r }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
