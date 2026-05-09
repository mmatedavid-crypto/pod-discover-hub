// Daily auto-post to X/Twitter (Facebook later).
// Picks recent high-quality episodes, writes an info+entertainment post via Lovable AI,
// posts to X with OAuth 1.0a, logs to social_posts table.
//
// Modes:
//   POST { dry_run: true }   -> generate but don't post (preview)
//   POST { dry_run: false }  -> generate + post to X
//   GET                       -> health check
//
// Triggered by cron daily at 14:00 UTC (9 AM ET).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE_URL = "https://podiverzum.com";
const X_API = "https://api.x.com/2";
const LOVABLE_AI = "https://ai.gateway.lovable.dev/v1/chat/completions";

// ---------- OAuth 1.0a HMAC-SHA1 ----------
function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) =>
    "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

async function hmacSha1(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function buildOAuthHeader(
  method: string,
  url: string,
  consumerKey: string,
  consumerSecret: string,
  accessToken: string,
  accessTokenSecret: string
): Promise<string> {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: "1.0",
  };
  // For JSON body POSTs, do NOT include body params in signature base.
  const paramString = Object.keys(oauthParams)
    .sort()
    .map((k) => `${pctEncode(k)}=${pctEncode(oauthParams[k])}`)
    .join("&");
  const signatureBase = `${method.toUpperCase()}&${pctEncode(url)}&${pctEncode(paramString)}`;
  const signingKey = `${pctEncode(consumerSecret)}&${pctEncode(accessTokenSecret)}`;
  const signature = await hmacSha1(signingKey, signatureBase);
  oauthParams.oauth_signature = signature;
  const header =
    "OAuth " +
    Object.keys(oauthParams)
      .sort()
      .map((k) => `${pctEncode(k)}="${pctEncode(oauthParams[k])}"`)
      .join(", ");
  return header;
}

async function postTweet(text: string): Promise<{ id: string; url: string }> {
  const ck = Deno.env.get("TWITTER_CONSUMER_KEY");
  const cs = Deno.env.get("TWITTER_CONSUMER_SECRET");
  const at = Deno.env.get("TWITTER_ACCESS_TOKEN");
  const ats = Deno.env.get("TWITTER_ACCESS_TOKEN_SECRET");
  if (!ck || !cs || !at || !ats) throw new Error("Twitter credentials missing");

  const url = `${X_API}/tweets`;
  const auth = await buildOAuthHeader("POST", url, ck, cs, at, ats);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`X API ${res.status}: ${body}`);
  const data = JSON.parse(body);
  const id = data?.data?.id;
  return { id, url: id ? `https://x.com/i/web/status/${id}` : "" };
}

// ---------- Episode selection ----------
type EpisodeRow = {
  id: string;
  title: string;
  display_title: string | null;
  ai_summary: string | null;
  slug: string;
  published_at: string | null;
  podcast_id: string;
  image_url: string | null;
  podcasts: {
    id: string;
    title: string;
    display_title: string | null;
    slug: string;
    category: string | null;
    shadow_rank_tier: string | null;
    featured: boolean;
    image_url: string | null;
  } | null;
};

async function pickEpisodesWithin(admin: any, hours: number): Promise<EpisodeRow[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from("episodes")
    .select(`
      id, title, display_title, ai_summary, slug, published_at, podcast_id,
      podcasts!inner(id, title, display_title, slug, category, shadow_rank_tier, featured)
    `)
    .gte("published_at", since)
    .not("ai_summary", "is", null)
    .order("published_at", { ascending: false })
    .limit(60);
  if (error) throw new Error(`pickEpisodes: ${error.message}`);
  const rows = (data || []) as EpisodeRow[];
  const seen = new Set<string>();
  const filtered: EpisodeRow[] = [];
  for (const r of rows) {
    const tier = r.podcasts?.shadow_rank_tier;
    const featured = r.podcasts?.featured;
    if (!(tier === "S" || tier === "A" || featured)) continue;
    if (seen.has(r.podcast_id)) continue;
    seen.add(r.podcast_id);
    filtered.push(r);
    if (filtered.length >= 6) break;
  }
  return filtered;
}

async function pickEpisodes(admin: any): Promise<EpisodeRow[]> {
  // Try 24h, then 48h, then 72h windows.
  for (const hours of [24, 48, 72]) {
    const eps = await pickEpisodesWithin(admin, hours);
    if (eps.length >= 2) return eps;
  }
  return [];
}

// ---------- Content generation ----------
async function generatePost(episodes: EpisodeRow[]): Promise<{ text: string; model: string }> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");

  const items = episodes.slice(0, 3).map((e) => {
    const epTitle = e.display_title || e.title;
    const podTitle = e.podcasts?.display_title || e.podcasts?.title || "";
    const url = `${SITE_URL}/podcast/${e.podcasts?.slug}/episode/${e.slug}`;
    const summary = (e.ai_summary || "").slice(0, 400);
    return { epTitle, podTitle, url, summary, category: e.podcasts?.category };
  });

  const sys =
    "You write engaging info+entertainment posts for X/Twitter about new podcast episodes published today on Podiverzum (a podcast discovery site). Style: punchy, curious, conversational, US English. Hook the reader. NEVER use hashtags. NEVER use emojis. Keep it under 270 characters TOTAL including links (each shortened URL counts as 23 chars). Mention 2-3 episodes briefly with their podiverzum.com link. Do NOT add any commentary outside the post itself.";

  const user =
    "Write today's post. Mention these new episodes (pick the 2-3 most interesting; weave them naturally; one short sentence each + the URL):\n\n" +
    items
      .map(
        (i, idx) =>
          `${idx + 1}. Podcast: "${i.podTitle}" — Episode: "${i.epTitle}"\n   Category: ${i.category || "general"}\n   Summary: ${i.summary}\n   URL: ${i.url}`
      )
      .join("\n\n") +
    "\n\nReturn ONLY the post text, no quotes, no preamble.";

  const model = "google/gemini-2.5-flash";
  const res = await fetch(LOVABLE_AI, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Lovable AI ${res.status}: ${t}`);
  }
  const j = await res.json();
  const text = (j?.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new Error("Empty AI response");
  // Light cleanup: strip surrounding quotes if any
  const cleaned = text.replace(/^["']|["']$/g, "").trim();
  return { text: cleaned, model };
}

// ---------- Main handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  if (req.method === "GET") {
    return new Response(JSON.stringify({ ok: true, function: "daily-social-post" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }
  const dryRun = body?.dry_run === true;
  const trigger = body?.trigger || (dryRun ? "manual_preview" : "cron");

  // Kill switch (skip for dry-run previews so admin can always preview)
  if (!dryRun) {
    const guard = await checkBackgroundJobsAllowed(admin, "daily-social-post");
    if (guard.blocked) {
      return new Response(JSON.stringify({ ok: false, blocked: true, reason: guard.reason }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  try {
    const episodes = await pickEpisodes(admin);
    if (episodes.length < 2) {
      const msg = `Not enough fresh episodes (found ${episodes.length}, need >= 2). Skipping.`;
      if (!dryRun) {
        await admin.from("social_posts").insert({
          platform: "x",
          status: "skipped",
          content: msg,
          trigger,
          metadata: { episode_count: episodes.length },
        });
      }
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: msg }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { text, model } = await generatePost(episodes);

    if (dryRun) {
      return new Response(
        JSON.stringify({
          ok: true,
          dry_run: true,
          generated_text: text,
          char_count: text.length,
          model,
          episodes: episodes.slice(0, 3).map((e) => ({
            id: e.id,
            title: e.display_title || e.title,
            podcast: e.podcasts?.display_title || e.podcasts?.title,
            url: `${SITE_URL}/podcast/${e.podcasts?.slug}/episode/${e.slug}`,
          })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Post to X
    let postId = "";
    let postUrl = "";
    let status: "success" | "failed" = "success";
    let errMsg: string | null = null;
    try {
      const r = await postTweet(text);
      postId = r.id;
      postUrl = r.url;
    } catch (e: any) {
      status = "failed";
      errMsg = e?.message || String(e);
    }

    const usedEpisodes = episodes.slice(0, 3);
    await admin.from("social_posts").insert({
      platform: "x",
      status,
      content: text,
      episode_ids: usedEpisodes.map((e) => e.id),
      podcast_ids: usedEpisodes.map((e) => e.podcast_id),
      ai_model: model,
      platform_post_id: postId || null,
      platform_post_url: postUrl || null,
      error: errMsg,
      trigger,
      metadata: { char_count: text.length },
    });

    return new Response(
      JSON.stringify({
        ok: status === "success",
        status,
        post_id: postId,
        post_url: postUrl,
        text,
        error: errMsg,
      }),
      {
        status: status === "success" ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error("daily-social-post error:", msg);
    if (!dryRun) {
      await admin.from("social_posts").insert({
        platform: "x",
        status: "failed",
        content: "",
        error: msg,
        trigger,
      });
    }
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
