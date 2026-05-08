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
function entSlug(kind: string, v: string) {
  if (kind === "ticker") return v.replace(/[^a-zA-Z0-9.]+/g, "").toUpperCase();
  return v.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

Deno.serve(async () => {
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const [{ data: cats }, { data: pods }, { data: eps }] = await Promise.all([
      supabase.from("categories").select("slug,created_at"),
      supabase.from("podcasts").select("slug,updated_at,ai_enriched_at,rss_status,podiverzum_rank,rank_label,shadow_rank_components,id"),
      supabase.from("episodes").select("slug,updated_at,ai_enriched_at,podcast_id,topics,people,companies,tickers,ingredients,podcasts!inner(slug,rss_status)").order("published_at", { ascending: false }).limit(10000),
    ]);

    // lastmod = max(updated_at, ai_enriched_at) so search engines recrawl when SEO copy improves
    const maxDate = (a?: string | null, b?: string | null) => {
      if (!a) return b || null;
      if (!b) return a || null;
      return new Date(a) >= new Date(b) ? a : b;
    };

    const epCount: Record<string, number> = {};
    (eps || []).forEach((e: any) => { if (e.podcast_id) epCount[e.podcast_id] = (epCount[e.podcast_id] || 0) + 1; });

    // Aggregate entity slug counts (only count episodes whose parent is healthy)
    const entCount: Record<string, { slug: string; n: number; lastmod?: string }> = {};
    const kinds: { col: "topics"|"people"|"companies"|"tickers"|"ingredients"; route: string }[] = [
      { col: "topics", route: "topic" }, { col: "people", route: "person" },
      { col: "companies", route: "company" }, { col: "tickers", route: "ticker" }, { col: "ingredients", route: "ingredient" },
    ];
    (eps || []).forEach((e: any) => {
      const broken = e.podcasts?.rss_status === "failed" || e.podcasts?.rss_status === "inactive";
      if (broken) return;
      kinds.forEach(({ col, route }) => {
        (e[col] || []).forEach((v: string) => {
          const s = entSlug(route, v);
          if (!s) return;
          const k = `${route}:${s}`;
          const cur = entCount[k];
          if (cur) cur.n++; else entCount[k] = { slug: s, n: 1, lastmod: e.updated_at };
        });
      });
    });

    const urls: string[] = [
      url(`${SITE}/`, null, "daily", "1.0"),
      url(`${SITE}/categories`, null, "daily", "0.7"),
    ];
    (cats || []).forEach((c) => urls.push(url(`${SITE}/category/${esc(c.slug)}`, c.created_at, "daily", "0.8")));

    // Entity pages with 5+ episodes
    Object.entries(entCount).forEach(([key, info]) => {
      if (info.n < 5) return;
      const route = key.split(":")[0];
      const priority = info.n >= 20 ? "0.8" : "0.6";
      urls.push(url(`${SITE}/${route}/${esc(info.slug)}`, info.lastmod || null, "weekly", priority));
    });

    const SITEMAP_BAD = new Set(["needs_manual_rss_review", "quarantined_spam", "confirmed_dead"]);
    (pods || []).forEach((p: any) => {
      const broken = p.rss_status === "failed" || p.rss_status === "inactive";
      const empty = !epCount[p.id];
      const hs = (p.shadow_rank_components as any)?.health_state;
      if (broken || empty || SITEMAP_BAD.has(hs) || p.rank_label === "E") return;
      const tier = p.rank_label;
      const priority = tier === "S" ? "0.9" : tier === "A" ? "0.8" : tier === "B" ? "0.7" : tier === "C" ? "0.6" : "0.4";
      urls.push(url(`${SITE}/podcast/${esc(p.slug)}`, maxDate(p.updated_at, p.ai_enriched_at), "daily", priority));
    });
    (eps || []).forEach((e: any) => {
      const ps = e.podcasts?.slug;
      const broken = e.podcasts?.rss_status === "failed" || e.podcasts?.rss_status === "inactive";
      if (ps && !broken) urls.push(url(`${SITE}/podcast/${esc(ps)}/${esc(e.slug)}`, maxDate(e.updated_at, e.ai_enriched_at), "weekly", "0.7"));
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
    return new Response(xml, { headers: corsHeaders });
  } catch (e) {
    return new Response(`<!-- sitemap error: ${e instanceof Error ? e.message : "error"} -->`, { status: 500, headers: corsHeaders });
  }
});
