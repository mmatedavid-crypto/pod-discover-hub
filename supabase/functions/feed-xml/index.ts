// Public RSS/Atom 2.0 feed of recent Podiverzum-indexed episodes.
// Useful for aggregators, backlinks and AI scrapers that prefer feeds.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SITE = Deno.env.get("PUBLIC_SITE_URL") || "https://podiverzum.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/rss+xml; charset=utf-8",
  "Cache-Control": "public, max-age=900",
};

function esc(s: string | null | undefined): string {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function strip(s: string | null | undefined): string {
  if (!s) return "";
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

Deno.serve(async () => {
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: rows } = await sb
      .from("mv_homepage_feed" as any)
      .select("episode_id,title,display_title,slug,summary,ai_summary,description,published_at,podcast_slug,podcast_title,podcast_display_title,podcast_image_url,freshness_bucket")
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(50);

    const items = (rows || []).map((r: any) => {
      const link = `${SITE}/podcast/${r.podcast_slug}/${r.slug}`;
      const title = r.display_title || r.title || "Untitled";
      const podName = r.podcast_display_title || r.podcast_title || "";
      const desc = strip(r.ai_summary) || strip(r.summary) || strip(r.description) || `${podName} on Podiverzum.`;
      const pub = r.published_at ? new Date(r.published_at).toUTCString() : new Date().toUTCString();
      return `<item>
  <title>${esc(title)}${podName ? " — " + esc(podName) : ""}</title>
  <link>${esc(link)}</link>
  <guid isPermaLink="true">${esc(link)}</guid>
  <pubDate>${pub}</pubDate>
  <description>${esc(desc.slice(0, 500))}</description>
</item>`;
    }).join("\n");

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Podiverzum — Fresh podcast episodes</title>
  <link>${esc(SITE)}</link>
  <atom:link href="${esc(SITE)}/feed.xml" rel="self" type="application/rss+xml" />
  <description>Hand-ranked podcast episodes from across the web. Find it. Hear it.</description>
  <language>en</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
</channel>
</rss>`;
    return new Response(xml, { headers: corsHeaders });
  } catch (e) {
    return new Response(`<!-- feed error: ${e instanceof Error ? e.message : "error"} -->`, {
      status: 500,
      headers: corsHeaders,
    });
  }
});
