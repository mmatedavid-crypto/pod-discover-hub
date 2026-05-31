// Public RSS/Atom 2.0 feed of recent Podiverzum-indexed episodes.
// Useful for aggregators, backlinks and AI scrapers that prefer feeds.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SITE = Deno.env.get("PUBLIC_SITE_URL") || "https://podiverzum.hu";

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
    const { data: rails } = await (sb as any)
      .rpc("get_homepage_rails_v1", {
        _trending_limit: 30,
        _evergreen_limit: 20,
        _category_limit: 0,
        _max_categories: 0,
      });

    let rows = [
      ...(((rails as any)?.trending ?? []) as any[]),
      ...(((rails as any)?.evergreen ?? []) as any[]),
    ];

    if (!rows.length) {
      const { data } = await sb
        .from("mv_homepage_feed" as any)
        .select("episode_id,title,display_title,slug,summary,ai_summary,description,published_at,podcast_slug,podcast_title,podcast_display_title,podcast_image_url,freshness_bucket,podcast_category,pod_rank")
        .lte("pod_rank", 8)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(80);
      rows = (data || []).filter((r: any) => {
        const hay = `${r.podcast_category ?? ""} ${r.podcast_title ?? ""} ${r.podcast_display_title ?? ""} ${r.title ?? ""} ${r.display_title ?? ""}`.toLowerCase();
        const title = String(r.display_title || r.title || "").toLowerCase();
        const newsLike = /(hírek|hirek|infostart|összes hír|osszes hir|krónika|kronika)/i.test(hay);
        const bulletinLike = /(^\s*[0-9]{1,2}\s*[-–—]\s+|^\s*20[0-9]{6}(\s|[-–—])|hírek röviden|hirek roviden|percben)/i.test(title);
        return !newsLike && !bulletinLike;
      });
    }

    const seen = new Set<string>();
    rows = rows.filter((r: any) => {
      const id = String(r.episode_id || `${r.podcast_slug}/${r.slug}`);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    }).slice(0, 50);

    const items = rows.map((r: any) => {
      const link = `${SITE}/podcast/${r.podcast_slug}/${r.slug}`;
      const title = r.display_title || r.title || "Untitled";
      const podName = r.podcast_display_title || r.podcast_title || "";
      const desc = strip(r.ai_summary) || strip(r.summary) || strip(r.description) || `${podName} a Podiverzumon.`;
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
  <title>Podiverzum — friss magyar podcast epizódok</title>
  <link>${esc(SITE)}</link>
  <atom:link href="${esc(SITE)}/feed.xml" rel="self" type="application/rss+xml" />
  <description>Válogatott magyar podcast epizódok a Podiverzumon.</description>
  <language>hu-HU</language>
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
