// Dynamic sitemap.xml built from the database.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SITE = Deno.env.get("PUBLIC_SITE_URL") || "https://podiverzum.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=3600",
};

function url(loc: string, lastmod?: string | null, changefreq = "daily", priority = "0.6") {
  return `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}
function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;"); }

Deno.serve(async () => {
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const [{ data: cats }, { data: pods }, { data: eps }] = await Promise.all([
      supabase.from("categories").select("slug,created_at"),
      supabase.from("podcasts").select("slug,updated_at,rss_status,podiverzum_rank,id"),
      supabase.from("episodes").select("slug,updated_at,podcast_id,podcasts!inner(slug,rss_status)").order("published_at", { ascending: false }).limit(10000),
    ]);

    // Episode counts to detect empty podcasts
    const epCount: Record<string, number> = {};
    (eps || []).forEach((e: any) => { if (e.podcast_id) epCount[e.podcast_id] = (epCount[e.podcast_id] || 0) + 1; });

    const urls: string[] = [
      url(`${SITE}/`, null, "daily", "1.0"),
      url(`${SITE}/categories`, null, "daily", "0.7"),
    ];
    (cats || []).forEach((c) => urls.push(url(`${SITE}/category/${esc(c.slug)}`, c.created_at, "daily", "0.8")));
    (pods || []).forEach((p: any) => {
      // Only index podcasts that are healthy and have episodes
      const broken = p.rss_status === "failed" || p.rss_status === "inactive";
      const empty = !epCount[p.id];
      if (broken || empty) return;
      urls.push(url(`${SITE}/podcast/${esc(p.slug)}`, p.updated_at, "daily", "0.6"));
    });
    (eps || []).forEach((e: any) => {
      const ps = e.podcasts?.slug;
      const broken = e.podcasts?.rss_status === "failed" || e.podcasts?.rss_status === "inactive";
      if (ps && !broken) urls.push(url(`${SITE}/podcast/${esc(ps)}/${esc(e.slug)}`, e.updated_at, "weekly", "0.7"));
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
    return new Response(xml, { headers: corsHeaders });
  } catch (e) {
    return new Response(`<!-- sitemap error: ${e instanceof Error ? e.message : "error"} -->`, { status: 500, headers: corsHeaders });
  }
});
