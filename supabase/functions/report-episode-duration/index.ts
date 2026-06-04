// Crowdsourced duration backfill: the browser audio element reveals real
// duration on play. Client posts it here; we only fill NULL values.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const id = String(body?.episode_id || "").trim();
    const raw = Number(body?.duration_seconds);
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return new Response(JSON.stringify({ error: "bad episode_id" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }
    const secs = Math.round(raw);
    // Sanity: 10s – 12h
    if (!Number.isFinite(secs) || secs < 10 || secs > 43200) {
      return new Response(JSON.stringify({ error: "bad duration" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await admin
      .from("episodes")
      .update({ duration_seconds: secs })
      .eq("id", id)
      .is("duration_seconds", null)
      .select("id")
      .maybeSingle();
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ ok: true, updated: !!data }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
