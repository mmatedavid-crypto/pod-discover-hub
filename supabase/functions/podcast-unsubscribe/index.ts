// Public unsubscribe endpoint for per-podcast email notifications.
// GET  ?token=xxx  → validates token, returns { valid, podcast_title }
// POST { token }   → marks unsubscribed_at = now()

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let token = "";
  if (req.method === "GET") {
    token = new URL(req.url).searchParams.get("token") || "";
  } else if (req.method === "POST") {
    try {
      const body = await req.json();
      token = String(body?.token || "");
    } catch {
      return json({ valid: false, reason: "invalid_json" }, 400);
    }
  } else {
    return json({ error: "method_not_allowed" }, 405);
  }

  if (!token || token.length < 8 || token.length > 128) {
    return json({ valid: false, reason: "invalid_token" });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: row, error } = await sb
    .from("podcast_email_subscriptions")
    .select("id, unsubscribed_at, podcast_id, podcasts(title, display_title)")
    .eq("unsubscribe_token", token)
    .maybeSingle();

  if (error || !row) return json({ valid: false, reason: "not_found" });

  const podcastTitle =
    (row.podcasts as { display_title?: string; title?: string } | null)?.display_title ||
    (row.podcasts as { title?: string } | null)?.title ||
    "";

  if (req.method === "GET") {
    if (row.unsubscribed_at) return json({ valid: true, already: true, podcast_title: podcastTitle });
    return json({ valid: true, podcast_title: podcastTitle });
  }

  // POST — perform unsubscribe
  if (row.unsubscribed_at) return json({ success: true, already: true, podcast_title: podcastTitle });

  const { error: upErr } = await sb
    .from("podcast_email_subscriptions")
    .update({ unsubscribed_at: new Date().toISOString() })
    .eq("id", row.id);
  if (upErr) return json({ success: false, reason: upErr.message }, 500);
  return json({ success: true, podcast_title: podcastTitle });
});
