// Fetches an RSS feed and inserts/updates episodes for a podcast.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
function tag(xml: string, name: string) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? decode(m[1]).trim() : "";
}
function attr(xml: string, name: string, attrName: string) {
  const m = xml.match(new RegExp(`<${name}[^>]*\\s${attrName}=["']([^"']+)["']`, "i"));
  return m ? m[1] : "";
}
function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80) || "episode";
}
function stripHtml(s: string) {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { podcast_id, limit = 20 } = await req.json();
    if (!podcast_id) throw new Error("podcast_id required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: podcast, error } = await supabase.from("podcasts").select("*").eq("id", podcast_id).single();
    if (error || !podcast) throw new Error("podcast not found");
    if (!podcast.rss_url) {
      await supabase.from("podcasts").update({
        rss_status: "failed",
        last_fetched_at: new Date().toISOString(),
        last_fetch_error: "no rss_url configured",
      }).eq("id", podcast_id);
      throw new Error("podcast has no rss_url");
    }

    let xml = "";
    try {
      const res = await fetch(podcast.rss_url, { headers: { "User-Agent": "PodiverzumBot/1.0" } });
      if (!res.ok) throw new Error(`RSS fetch failed: HTTP ${res.status}`);
      xml = await res.text();
    } catch (fetchErr) {
      const msg = fetchErr instanceof Error ? fetchErr.message : "fetch error";
      await supabase.from("podcasts").update({
        rss_status: "failed",
        last_fetched_at: new Date().toISOString(),
        last_fetch_error: msg,
      }).eq("id", podcast_id);
      throw fetchErr;
    }

    // Extract channel image as fallback
    const channelImage =
      attr(xml, "itunes:image", "href") ||
      tag(xml.split("<item")[0] || "", "url") ||
      podcast.image_url ||
      "";

    const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
    let inserted = 0;
    for (const item of items.slice(0, limit)) {
      const title = tag(item, "title");
      if (!title) continue;
      const guid = tag(item, "guid") || tag(item, "link");
      const link = tag(item, "link");
      const pubDate = tag(item, "pubDate");
      const desc = tag(item, "description") || tag(item, "itunes:summary") || tag(item, "content:encoded");
      const audioUrl = attr(item, "enclosure", "url");
      const image = attr(item, "itunes:image", "href") || channelImage;
      const slug = slugify(title) + "-" + (guid ? guid.slice(-8) : Math.random().toString(36).slice(2, 8));
      const published = pubDate ? new Date(pubDate).toISOString() : null;

      const { error: upErr } = await supabase.from("episodes").upsert(
        {
          podcast_id,
          title,
          slug,
          description: stripHtml(desc).slice(0, 4000),
          published_at: published,
          audio_url: audioUrl || null,
          episode_url: link || null,
          image_url: image || null,
          guid: guid || null,
        },
        { onConflict: "podcast_id,slug" },
      );
      if (!upErr) inserted++;
    }

    await supabase.from("podcasts").update({
      rss_status: "active",
      last_fetched_at: new Date().toISOString(),
      last_fetch_error: null,
    }).eq("id", podcast_id);

    return new Response(JSON.stringify({ ok: true, count: inserted, items: items.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
