// Podcast Index search proxy. Returns normalized podcast candidates.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha1Hex(input: string) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function qualityScore(p: any): { score: number; tier: "High" | "Medium" | "Low" } {
  let s = 0;
  if (p.url) s += 30;
  if (p.image || p.artwork) s += 20;
  const last = p.newestItemPublishTime ? p.newestItemPublishTime * 1000 : 0;
  if (last && Date.now() - last < 30 * 24 * 3600 * 1000) s += 20;
  if ((p.episodeCount || 0) >= 20) s += 10;
  if (p.description) s += 10;
  if ((p.language || "").toLowerCase().startsWith("en")) s += 10;
  if (p.dead === 1) s -= 30;
  if (p.lastHttpStatus === 404) s -= 50;
  const tier = s >= 70 ? "High" : s >= 40 ? "Medium" : "Low";
  return { score: s, tier };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("PODCAST_INDEX_API_KEY");
    const apiSecret = Deno.env.get("PODCAST_INDEX_API_SECRET");
    if (!apiKey || !apiSecret) {
      return new Response(JSON.stringify({
        error: "Podcast Index API credentials are required. Add PODCAST_INDEX_API_KEY and PODCAST_INDEX_API_SECRET in Cloud → Secrets.",
        missing_credentials: true,
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const url = new URL(req.url);
    const q = (body.query || url.searchParams.get("query") || "").trim();
    const lang = (body.language || url.searchParams.get("language") || "").trim();
    if (!q) throw new Error("query required");

    const date = Math.floor(Date.now() / 1000).toString();
    const auth = await sha1Hex(apiKey + apiSecret + date);
    const params = new URLSearchParams({ q, max: "20" });
    if (lang) params.set("val", lang);
    const piUrl = `https://api.podcastindex.org/api/1.0/search/byterm?${params.toString()}`;
    const res = await fetch(piUrl, {
      headers: {
        "User-Agent": "Podiverzum/1.0",
        "X-Auth-Date": date,
        "X-Auth-Key": apiKey,
        "Authorization": auth,
      },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Podcast Index ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    const feeds = Array.isArray(data.feeds) ? data.feeds.slice(0, 20) : [];
    const results = feeds.map((p: any) => {
      const { score, tier } = qualityScore(p);
      return {
        pi_id: p.id,
        title: p.title,
        description: p.description,
        image_url: p.image || p.artwork,
        rss_url: p.url,
        website_url: p.link,
        language: p.language,
        author: p.author || p.ownerName,
        episode_count: p.episodeCount,
        last_episode_at: p.newestItemPublishTime ? new Date(p.newestItemPublishTime * 1000).toISOString() : null,
        dead: p.dead === 1,
        last_http_status: p.lastHttpStatus,
        quality_score: score,
        quality_tier: tier,
      };
    }).sort((a: any, b: any) => b.quality_score - a.quality_score);

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
