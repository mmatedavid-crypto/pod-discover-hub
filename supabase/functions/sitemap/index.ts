// Dynamic sitemap built from the database.
//
// Routes:
//   GET /sitemap                       → sitemap-index (lists all sub-sitemaps)
//   GET /sitemap?type=core             → home, categories, category hubs, static pages
//   GET /sitemap?type=podcasts         → all healthy podcast detail pages
//   GET /sitemap?type=entities         → topic/person/company/ticker/ingredient hubs (≥5 eps)
//   GET /sitemap?type=episodes&page=N  → episode pages, 45 000 per page (1-indexed)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SITE = Deno.env.get("PUBLIC_SITE_URL") || "https://podiverzum.com";
const FN_BASE = `${Deno.env.get("SUPABASE_URL") || "https://iqzkayoqqagowvxeaphe.supabase.co"}/functions/v1/sitemap`;
const EPISODES_PER_PAGE = 45000;

const xmlHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=3600",
};

function urlTag(loc: string, lastmod?: string | null, changefreq = "daily", priority = "0.6") {
  return `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}
function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
function entSlug(kind: string, v: string) {
  if (kind === "ticker") return v.replace(/[^a-zA-Z0-9.]+/g, "").toUpperCase();
  return v.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}
const maxDate = (a?: string | null, b?: string | null) => {
  if (!a) return b || null;
  if (!b) return a || null;
  return new Date(a) >= new Date(b) ? a : b;
};

function wrapUrlset(urls: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
}

async function buildSitemapIndex(supabase: ReturnType<typeof createClient>) {
  const { count } = await supabase
    .from("episodes")
    .select("id", { count: "exact", head: true });
  const totalEps = count || 0;
  const epPages = Math.max(1, Math.ceil(totalEps / EPISODES_PER_PAGE));
  const lastmod = new Date().toISOString();
  const entries: string[] = [
    `<sitemap><loc>${FN_BASE}?type=core</loc><lastmod>${lastmod}</lastmod></sitemap>`,
    `<sitemap><loc>${FN_BASE}?type=entities</loc><lastmod>${lastmod}</lastmod></sitemap>`,
    `<sitemap><loc>${FN_BASE}?type=podcasts</loc><lastmod>${lastmod}</lastmod></sitemap>`,
  ];
  for (let i = 1; i <= epPages; i++) {
    entries.push(`<sitemap><loc>${FN_BASE}?type=episodes&amp;page=${i}</loc><lastmod>${lastmod}</lastmod></sitemap>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</sitemapindex>`;
}

async function buildCore(supabase: ReturnType<typeof createClient>) {
  const { data: cats } = await supabase.from("categories").select("slug,created_at");
  const urls: string[] = [
    urlTag(`${SITE}/`, null, "daily", "1.0"),
    urlTag(`${SITE}/categories`, null, "daily", "0.7"),
    urlTag(`${SITE}/about`, null, "monthly", "0.4"),
    urlTag(`${SITE}/methodology`, null, "monthly", "0.4"),
    urlTag(`${SITE}/new-podcasts`, null, "daily", "0.6"),
  ];
  (cats || []).forEach((c: any) => urls.push(urlTag(`${SITE}/category/${esc(c.slug)}`, c.created_at, "daily", "0.8")));
  return wrapUrlset(urls);
}

async function buildPodcasts(supabase: ReturnType<typeof createClient>) {
  const SITEMAP_BAD = new Set(["needs_manual_rss_review", "quarantined_spam", "confirmed_dead"]);
  // Page through podcasts (≤2.5k expected; one chunk is fine)
  const { data: pods } = await supabase
    .from("podcasts")
    .select("id,slug,updated_at,ai_enriched_at,rss_status,rank_label,shadow_rank_components");
  // Episode counts per podcast — needed to skip empty ones
  const { data: epCountsRaw } = await supabase.rpc as any; // not available; do a lightweight scan instead
  // Fallback: query episodes grouped by podcast_id via head:true count per podcast is too many round-trips.
  // Instead, use a single aggregate query.
  const { data: epCounts } = await supabase
    .from("episodes")
    .select("podcast_id", { count: "exact" }) // placeholder; we read below via paged scan
    .limit(1);
  // Build counts via paged scan
  const counts: Record<string, number> = {};
  let from = 0;
  const PAGE = 5000;
  while (true) {
    const { data: chunk } = await supabase
      .from("episodes")
      .select("podcast_id")
      .range(from, from + PAGE - 1);
    if (!chunk || chunk.length === 0) break;
    for (const r of chunk) {
      const id = (r as any).podcast_id;
      if (id) counts[id] = (counts[id] || 0) + 1;
    }
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  void epCounts;

  const urls: string[] = [];
  (pods || []).forEach((p: any) => {
    const broken = p.rss_status === "failed" || p.rss_status === "inactive";
    const empty = !counts[p.id];
    const hs = (p.shadow_rank_components as any)?.health_state;
    if (broken || empty || SITEMAP_BAD.has(hs) || p.rank_label === "E") return;
    const tier = p.rank_label;
    const priority = tier === "S" ? "0.9" : tier === "A" ? "0.8" : tier === "B" ? "0.7" : tier === "C" ? "0.6" : "0.4";
    urls.push(urlTag(`${SITE}/podcast/${esc(p.slug)}`, maxDate(p.updated_at, p.ai_enriched_at), "daily", priority));
  });
  return wrapUrlset(urls);
}

async function buildEntities(supabase: ReturnType<typeof createClient>) {
  // Page through episodes pulling entity arrays only — keep payload tight.
  const entCount: Record<string, { slug: string; n: number; lastmod?: string }> = {};
  const kinds: { col: "topics"|"people"|"companies"|"tickers"|"ingredients"; route: string }[] = [
    { col: "topics", route: "topic" }, { col: "people", route: "person" },
    { col: "companies", route: "company" }, { col: "tickers", route: "ticker" }, { col: "ingredients", route: "ingredient" },
  ];
  let from = 0;
  const PAGE = 5000;
  while (true) {
    const { data: chunk } = await supabase
      .from("episodes")
      .select("updated_at,topics,people,companies,tickers,ingredients,podcasts!inner(rss_status)")
      .range(from, from + PAGE - 1);
    if (!chunk || chunk.length === 0) break;
    for (const e of chunk as any[]) {
      const broken = e.podcasts?.rss_status === "failed" || e.podcasts?.rss_status === "inactive";
      if (broken) continue;
      for (const { col, route } of kinds) {
        (e[col] || []).forEach((v: string) => {
          const s = entSlug(route, v);
          if (!s) return;
          const k = `${route}:${s}`;
          const cur = entCount[k];
          if (cur) cur.n++; else entCount[k] = { slug: s, n: 1, lastmod: e.updated_at };
        });
      }
    }
    if (chunk.length < PAGE) break;
    from += PAGE;
  }
  const urls: string[] = [];
  Object.entries(entCount).forEach(([key, info]) => {
    if (info.n < 5) return;
    const route = key.split(":")[0];
    const priority = info.n >= 20 ? "0.8" : "0.6";
    urls.push(urlTag(`${SITE}/${route}/${esc(info.slug)}`, info.lastmod || null, "weekly", priority));
  });
  return wrapUrlset(urls);
}

async function buildEpisodes(supabase: ReturnType<typeof createClient>, page: number) {
  const offset = (page - 1) * EPISODES_PER_PAGE;
  const { data: eps } = await supabase
    .from("episodes")
    .select("slug,updated_at,ai_enriched_at,podcasts!inner(slug,rss_status)")
    .order("id", { ascending: true })
    .range(offset, offset + EPISODES_PER_PAGE - 1);
  const urls: string[] = [];
  (eps || []).forEach((e: any) => {
    const ps = e.podcasts?.slug;
    const broken = e.podcasts?.rss_status === "failed" || e.podcasts?.rss_status === "inactive";
    if (ps && !broken) urls.push(urlTag(`${SITE}/podcast/${esc(ps)}/${esc(e.slug)}`, maxDate(e.updated_at, e.ai_enriched_at), "weekly", "0.7"));
  });
  return wrapUrlset(urls);
}

Deno.serve(async (req) => {
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const u = new URL(req.url);
    const type = u.searchParams.get("type");
    const page = Math.max(1, parseInt(u.searchParams.get("page") || "1", 10) || 1);

    let body: string;
    if (!type) body = await buildSitemapIndex(supabase);
    else if (type === "core") body = await buildCore(supabase);
    else if (type === "podcasts") body = await buildPodcasts(supabase);
    else if (type === "entities") body = await buildEntities(supabase);
    else if (type === "episodes") body = await buildEpisodes(supabase, page);
    else return new Response(`<!-- unknown type: ${type} -->`, { status: 400, headers: xmlHeaders });

    return new Response(body, { headers: xmlHeaders });
  } catch (e) {
    return new Response(`<!-- sitemap error: ${e instanceof Error ? e.message : "error"} -->`, { status: 500, headers: xmlHeaders });
  }
});
