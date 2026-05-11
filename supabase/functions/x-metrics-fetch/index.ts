// Fetches engagement metrics for recently published X posts and updates social_posts.
// Runs every 6 hours via cron, scans last 14 days of status='success' posts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const X_API = "https://api.x.com/2";

// ---------- OAuth 1.0a HMAC-SHA1 (supports query params in signature base) ----------
function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}
async function hmacSha1(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey(
    "raw", enc.encode(key), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}
async function buildOAuthHeader(
  method: string,
  baseUrl: string,
  queryParams: Record<string, string>,
  ck: string, cs: string, at: string, ats: string,
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: ck,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: at,
    oauth_version: "1.0",
  };
  const allParams = { ...oauthParams, ...queryParams };
  const paramString = Object.keys(allParams).sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(allParams[k])}`).join("&");
  const sigBase = `${method.toUpperCase()}&${pctEncode(baseUrl)}&${pctEncode(paramString)}`;
  const signingKey = `${pctEncode(cs)}&${pctEncode(ats)}`;
  oauthParams.oauth_signature = await hmacSha1(signingKey, sigBase);
  return "OAuth " + Object.keys(oauthParams).sort()
    .map((k) => `${pctEncode(k)}="${pctEncode(oauthParams[k])}"`).join(", ");
}

function getCreds() {
  const ck = Deno.env.get("TWITTER_CONSUMER_KEY");
  const cs = Deno.env.get("TWITTER_CONSUMER_SECRET");
  const at = Deno.env.get("TWITTER_ACCESS_TOKEN");
  const ats = Deno.env.get("TWITTER_ACCESS_TOKEN_SECRET");
  if (!ck || !cs || !at || !ats) throw new Error("Twitter credentials missing");
  return { ck, cs, at, ats };
}

async function fetchMetricsBatch(
  tweetIds: string[],
  creds: { ck: string; cs: string; at: string; ats: string },
): Promise<{ data?: any[]; errors?: any[]; raw: any } | null> {
  const baseUrl = `${X_API}/tweets`;
  const query: Record<string, string> = {
    ids: tweetIds.join(","),
    "tweet.fields": "public_metrics,non_public_metrics,organic_metrics,created_at",
  };
  const auth = await buildOAuthHeader("GET", baseUrl, query, creds.ck, creds.cs, creds.at, creds.ats);
  const qs = Object.keys(query).map((k) => `${pctEncode(k)}=${pctEncode(query[k])}`).join("&");
  const r = await fetch(`${baseUrl}?${qs}`, { headers: { Authorization: auth } });
  const txt = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(txt); } catch { parsed = { raw: txt }; }
  if (!r.ok) {
    console.error(`x-metrics fetch failed [${r.status}]`, txt.slice(0, 300));
    return { raw: parsed, errors: [{ status: r.status, body: parsed }] };
  }
  return { ...parsed, raw: parsed };
}

function computeDerived(pm: any, npm: any, om: any) {
  const impressions = npm?.impression_count ?? om?.impression_count ?? null;
  const likes = pm?.like_count ?? null;
  const replies = pm?.reply_count ?? null;
  const reposts = (pm?.retweet_count ?? 0) + (pm?.quote_count ?? 0);
  const bookmarks = pm?.bookmark_count ?? null;
  const link_clicks = npm?.url_link_clicks ?? om?.url_link_clicks ?? null;
  const follows = npm?.user_profile_clicks != null ? null : null; // follows not exposed; leave null
  const engagements =
    (likes ?? 0) + (replies ?? 0) + (reposts ?? 0) + (bookmarks ?? 0) + (link_clicks ?? 0);
  const engagement_rate = impressions && impressions > 0 ? +(engagements / impressions).toFixed(6) : null;
  const ctr = link_clicks != null && impressions && impressions > 0
    ? +(link_clicks / impressions).toFixed(6) : null;
  return { impressions, likes, replies_count: replies, reposts, bookmarks, link_clicks, follows, engagement_rate, ctr };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const startedAt = Date.now();
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const guard = await checkBackgroundJobsAllowed(admin, "x-metrics-fetch");
    if (guard.blocked) {
      return new Response(JSON.stringify({ ok: false, blocked: true, reason: guard.reason }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    const days = Math.max(1, Math.min(30, Number(body?.days ?? 14)));
    const sinceIso = new Date(Date.now() - days * 86400_000).toISOString();

    const { data: posts, error: selErr } = await admin
      .from("social_posts")
      .select("id, platform_post_id, metadata, created_at")
      .eq("platform", "x")
      .eq("status", "success")
      .not("platform_post_id", "is", null)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(500);
    if (selErr) throw selErr;

    const candidates = (posts || []).filter((p) => /^\d+$/.test(String(p.platform_post_id)));
    if (candidates.length === 0) {
      return new Response(JSON.stringify({ ok: true, fetched: 0, updated: 0, message: "no candidates" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true, dry_run: true, candidate_count: candidates.length,
        sample_ids: candidates.slice(0, 5).map((p) => p.platform_post_id),
        since: sinceIso,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const creds = getCreds();
    let updated = 0;
    let failedBatches = 0;
    const errors: any[] = [];

    // Batch by 100 (X v2 limit)
    for (let i = 0; i < candidates.length; i += 100) {
      const batch = candidates.slice(i, i + 100);
      const idMap = new Map<string, typeof batch[0]>();
      batch.forEach((p) => idMap.set(String(p.platform_post_id), p));
      let resp;
      try {
        resp = await fetchMetricsBatch([...idMap.keys()], creds);
      } catch (e) {
        failedBatches++;
        errors.push({ batch_start: i, error: String((e as any)?.message || e) });
        continue;
      }
      if (!resp || resp.errors) {
        failedBatches++;
        errors.push({ batch_start: i, errors: resp?.errors });
        continue;
      }
      const fetchedAt = new Date().toISOString();
      for (const tw of (resp.data || [])) {
        try {
          const post = idMap.get(String(tw.id));
          if (!post) continue;
          const derived = computeDerived(tw.public_metrics, tw.non_public_metrics, tw.organic_metrics);
          const newMeta = {
            ...(post.metadata || {}),
            x_metrics_raw: {
              public_metrics: tw.public_metrics ?? null,
              non_public_metrics: tw.non_public_metrics ?? null,
              organic_metrics: tw.organic_metrics ?? null,
            },
            last_metrics_fetch_at: fetchedAt,
          };
          const { error: upErr } = await admin
            .from("social_posts")
            .update({
              ...derived,
              metadata: newMeta,
              metrics_refreshed_at: fetchedAt,
            })
            .eq("id", post.id);
          if (upErr) {
            errors.push({ id: post.id, error: upErr.message });
          } else {
            updated++;
          }
        } catch (e) {
          errors.push({ tweet_id: tw?.id, error: String((e as any)?.message || e) });
        }
      }
      // small pause between batches
      if (i + 100 < candidates.length) await new Promise((r) => setTimeout(r, 250));
    }

    return new Response(JSON.stringify({
      ok: true,
      fetched: candidates.length,
      updated,
      failed_batches: failedBatches,
      errors: errors.slice(0, 10),
      duration_ms: Date.now() - startedAt,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("x-metrics-fetch fatal", e);
    return new Response(JSON.stringify({ ok: false, error: String((e as any)?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
