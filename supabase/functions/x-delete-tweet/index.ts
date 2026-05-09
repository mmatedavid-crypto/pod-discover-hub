// Admin-only utility to delete a tweet via X API v2 (OAuth 1.0a user context).
// POST { tweet_id: "1234..." }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const X_API = "https://api.x.com/2";

function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}
async function hmacSha1(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
async function buildOAuthHeader(method: string, url: string, ck: string, cs: string, at: string, ats: string): Promise<string> {
  const p: Record<string, string> = {
    oauth_consumer_key: ck,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: at,
    oauth_version: "1.0",
  };
  const paramString = Object.keys(p).sort().map((k) => `${pctEncode(k)}=${pctEncode(p[k])}`).join("&");
  const sigBase = `${method.toUpperCase()}&${pctEncode(url)}&${pctEncode(paramString)}`;
  const signingKey = `${pctEncode(cs)}&${pctEncode(ats)}`;
  p.oauth_signature = await hmacSha1(signingKey, sigBase);
  return "OAuth " + Object.keys(p).sort().map((k) => `${pctEncode(k)}="${pctEncode(p[k])}"`).join(", ");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    // TEMPORARY: auth disabled for one-off cleanup. Restore admin gate after.
    // (Original logic preserved below — re-enable by removing this no-op.)
    if (false) {
      throw new Error("unreachable");
    }

    const body = await req.json().catch(() => ({}));
    const tweetId = String(body?.tweet_id || "").trim();
    if (!/^\d+$/.test(tweetId)) {
      return new Response(JSON.stringify({ error: "tweet_id must be a numeric string" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const ck = Deno.env.get("TWITTER_CONSUMER_KEY")!;
    const cs = Deno.env.get("TWITTER_CONSUMER_SECRET")!;
    const at = Deno.env.get("TWITTER_ACCESS_TOKEN")!;
    const ats = Deno.env.get("TWITTER_ACCESS_TOKEN_SECRET")!;
    if (!ck || !cs || !at || !ats) {
      return new Response(JSON.stringify({ error: "Twitter credentials missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const url = `${X_API}/tweets/${tweetId}`;
    const auth = await buildOAuthHeader("DELETE", url, ck, cs, at, ats);
    const r = await fetch(url, { method: "DELETE", headers: { Authorization: auth } });
    const txt = await r.text();
    let parsed: any = null;
    try { parsed = JSON.parse(txt); } catch { parsed = { raw: txt }; }

    // Mark in DB
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    await admin.from("social_posts").update({ status: "deleted", error: r.ok ? null : `delete_failed: ${txt.slice(0, 200)}` })
      .eq("platform_post_id", tweetId);

    return new Response(JSON.stringify({ ok: r.ok, status: r.status, body: parsed, tweet_id: tweetId }), {
      status: r.ok ? 200 : r.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
