// Dynamic sitemap built from the database.
// Routes:
//   GET /sitemap                       → sitemap-index (lists all sub-sitemaps)
//   GET /sitemap?type=core             → home, categories, category hubs, static pages
//   GET /sitemap?type=podcasts         → all healthy podcast detail pages
//   GET /sitemap?type=entities&ym=YYYY-MM → entity hubs (≥3 eps in that month)
//   GET /sitemap?type=episodes&ym=YYYY-MM → episode pages published that month
//
// Month buckets avoid Postgres deep-offset (statement_timeout) and keep
// every chunk under 45k URLs (Google's 50k limit).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SITE = Deno.env.get("PUBLIC_SITE_URL") || "https://podiverzum.hu";
// Sitemap-index child URLs must be served from the canonical apex domain.
// The Cloudflare worker proxies /sitemap.xml (with query string) back to this edge fn.
const FN_BASE = `${SITE}/sitemap.xml`;

const xmlHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=3600",
};

function urlTag(loc: string, lastmod?: string | null, changefreq = "daily", priority = "0.6") {
  return `<url><loc>${loc}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ""}<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}
function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
import { slugify as sharedSlugify } from "../_shared/slug.ts";
function entSlug(kind: string, v: string) {
  if (kind === "ticker") return v.replace(/[^a-zA-Z0-9.]+/g, "").toUpperCase();
  return sharedSlugify(v, "");
}
const maxDate = (a?: string | null, b?: string | null) => {
  if (!a) return b || null;
  if (!b) return a || null;
  return new Date(a) >= new Date(b) ? a : b;
};
function wrapUrlset(urls: string[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
}
function monthBounds(ym: string, part?: string | null): { start: string; end: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10);
  if (mo < 1 || mo > 12) return null;
  const monthStart = `${m[1]}-${m[2]}-01T00:00:00Z`;
  const mid = `${m[1]}-${m[2]}-16T00:00:00Z`;
  const ny = mo === 12 ? y + 1 : y;
  const nm = mo === 12 ? 1 : mo + 1;
  const monthEnd = `${ny}-${String(nm).padStart(2, "0")}-01T00:00:00Z`;
  // part=1 → days 1-15; part=2 → days 16-end; default → whole month (back-compat).
  if (part === "1") return { start: monthStart, end: mid };
  if (part === "2") return { start: mid, end: monthEnd };
  return { start: monthStart, end: monthEnd };
}


async function listMonths(supabase: ReturnType<typeof createClient>): Promise<string[]> {
  // Use a bounded query to find the range, then enumerate months (cheap, no scan).
  const [{ data: minRow }, { data: maxRow }] = await Promise.all([
    supabase.from("episodes").select("published_at").not("published_at", "is", null).order("published_at", { ascending: true }).limit(1),
    supabase.from("episodes").select("published_at").not("published_at", "is", null).order("published_at", { ascending: false }).limit(1),
  ]);
  const minD = minRow?.[0]?.published_at ? new Date(minRow[0].published_at) : new Date("2014-01-01");
  const maxD = maxRow?.[0]?.published_at ? new Date(maxRow[0].published_at) : new Date();
  // Clamp ridiculous lower bound (we have a 1970 outlier — start from 2014)
  const startY = Math.max(2014, minD.getUTCFullYear());
  const endY = maxD.getUTCFullYear();
  const endM = maxD.getUTCMonth() + 1;
  const months: string[] = [];
  for (let y = startY; y <= endY; y++) {
    const mEnd = y === endY ? endM : 12;
    for (let m = 1; m <= mEnd; m++) months.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return months;
}

async function buildSitemapIndex(supabase: ReturnType<typeof createClient>) {
  const months = await listMonths(supabase);
  const lastmod = new Date().toISOString();
  const entries: string[] = [
    `<sitemap><loc>${FN_BASE}?type=core</loc><lastmod>${lastmod}</lastmod></sitemap>`,
    `<sitemap><loc>${FN_BASE}?type=podcasts</loc><lastmod>${lastmod}</lastmod></sitemap>`,
  ];
  // Entity sub-sitemaps disabled until entity extraction is re-enabled
  // (topics/people/companies/tickers/ingredients arrays are currently empty).
  // Split each month into two halves (1-15, 16-end) so no sub-sitemap exceeds
  // Google's 50k URL limit (peak month was ~87k whole, ~44k per half).
  for (const ym of months) {
    entries.push(`<sitemap><loc>${FN_BASE}?type=episodes&amp;ym=${ym}&amp;part=1</loc><lastmod>${lastmod}</lastmod></sitemap>`);
    entries.push(`<sitemap><loc>${FN_BASE}?type=episodes&amp;ym=${ym}&amp;part=2</loc><lastmod>${lastmod}</lastmod></sitemap>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</sitemapindex>`;
}

async function buildCore(supabase: ReturnType<typeof createClient>) {
  const { data: cats } = await supabase.from("categories").select("slug,created_at").eq("active", true);
  const urls: string[] = [
    urlTag(`${SITE}/`, null, "daily", "1.0"),
    urlTag(`${SITE}/kategoriak`, null, "daily", "0.7"),
    urlTag(`${SITE}/temak`, null, "daily", "0.8"),
    urlTag(`${SITE}/szemelyek`, null, "daily", "0.7"),
    urlTag(`${SITE}/szervezetek`, null, "daily", "0.7"),
    urlTag(`${SITE}/partok`, null, "weekly", "0.6"),
    urlTag(`${SITE}/hangulatok`, null, "weekly", "0.7"),
    urlTag(`${SITE}/uj`, null, "daily", "0.6"),
    urlTag(`${SITE}/napi`, null, "daily", "0.6"),
    urlTag(`${SITE}/rolunk`, null, "monthly", "0.4"),
    urlTag(`${SITE}/modszertan`, null, "monthly", "0.4"),
    urlTag(`${SITE}/kapcsolat`, null, "yearly", "0.3"),
    urlTag(`${SITE}/adatvedelem`, null, "yearly", "0.2"),
    urlTag(`${SITE}/feltetelek`, null, "yearly", "0.2"),
  ];
  (cats || []).forEach((c: any) => urls.push(urlTag(`${SITE}/kategoria/${esc(c.slug)}`, c.created_at, "daily", "0.8")));

  // Indexable mood collections
  const { data: moods } = await supabase
    .from("mood_collections")
    .select("slug, updated_at")
    .eq("active", true)
    .eq("is_indexable", true)
    .gte("recommended_episode_count", 10);
  (moods || []).forEach((m: any) => urls.push(urlTag(`${SITE}/hangulatok/${esc(m.slug)}`, m.updated_at, "weekly", "0.7")));

  // Indexable topic pages
  const { data: topics } = await supabase
    .from("topics").select("slug, updated_at")
    .eq("is_public", true).eq("is_indexable", true).limit(2000);
  (topics || []).forEach((t: any) => urls.push(urlTag(`${SITE}/temak/${esc(t.slug)}`, t.updated_at, "weekly", "0.7")));

  // Indexable person pages — strict activation + AI review gate
  let from = 0;
  while (true) {
    const { data: people } = await supabase
      .from("people").select("slug, updated_at, ai_recommended_action, ai_review_status")
      .eq("is_public", true).eq("is_indexable", true)
      .in("activation_status", ["indexable","manual_approved"])
      .order("episode_count", { ascending: false })
      .range(from, from + 999);
    if (!people || people.length === 0) break;
    (people as any[]).forEach((p) => {
      if (["hide","reject"].includes(p.ai_recommended_action || "")) return;
      if (["needs_human_review","duplicate_candidate"].includes(p.ai_review_status || "")) return;
      urls.push(urlTag(`${SITE}/szemelyek/${esc(p.slug)}`, p.updated_at, "weekly", "0.6"));
    });
    if (people.length < 1000) break;
    from += 1000;
  }

  return wrapUrlset(urls);
}

async function buildPodcasts(supabase: ReturnType<typeof createClient>) {
  const SITEMAP_BAD = new Set(["needs_manual_rss_review", "quarantined_spam", "confirmed_dead"]);
  const urls: string[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data: pods, error } = await supabase
      .from("podcasts")
      .select("slug,updated_at,ai_enriched_at,rss_status,rank_label,shadow_rank_components,language,language_decision,is_hungarian")
      // Canonical HU gate — RSS language metadata is unreliable.
      .eq("is_hungarian", true)
      .eq("language_decision", "accept_hungarian")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!pods || pods.length === 0) break;
    for (const p of pods as any[]) {
      const broken = p.rss_status === "failed" || p.rss_status === "inactive";
      const hs = (p.shadow_rank_components as any)?.health_state;
      if (broken || SITEMAP_BAD.has(hs)) continue;
      const tier = p.rank_label;
      const priority = tier === "S" ? "0.9" : tier === "A" ? "0.8" : tier === "B" ? "0.7" : tier === "C" ? "0.6" : "0.4";
      urls.push(urlTag(`${SITE}/podcast/${esc(p.slug)}`, maxDate(p.updated_at, p.ai_enriched_at), "daily", priority));
    }
    if (pods.length < PAGE) break;
    from += PAGE;
  }
  return wrapUrlset(urls);
}

async function buildEpisodesByMonth(supabase: ReturnType<typeof createClient>, ym: string, part?: string | null) {
  const b = monthBounds(ym, part);
  if (!b) throw new Error(`bad ym: ${ym}`);
  const urls: string[] = [];
  let from = 0;
  const CHUNK = 1000;
  while (true) {
    const { data: eps, error } = await supabase
      .from("episodes")
      .select("slug,updated_at,ai_enriched_at,published_at,ai_summary,description,podcasts!inner(slug,rss_status,language,language_decision,is_hungarian)")
      .gte("published_at", b.start)
      .lt("published_at", b.end)
      // Canonical HU gate on parent podcast.
      .eq("podcasts.is_hungarian", true)
      .eq("podcasts.language_decision", "accept_hungarian")
      .order("published_at", { ascending: true })
      .range(from, from + CHUNK - 1);
    if (error) throw error;
    if (!eps || eps.length === 0) break;
    for (const e of eps as any[]) {
      const ps = e.podcasts?.slug;
      const broken = e.podcasts?.rss_status === "failed" || e.podcasts?.rss_status === "inactive";
      // Thin-content gate: skip episodes without enough body text. They remain
      // reachable on the site and via internal search, just not promoted to Google.
      const sumLen = (e.ai_summary || "").length;
      const descLen = (e.description || "").length;
      const thin = sumLen <= 80 && descLen <= 200;
      if (ps && !broken && !thin) urls.push(urlTag(`${SITE}/podcast/${esc(ps)}/${esc(e.slug)}`, maxDate(e.updated_at, e.ai_enriched_at), "weekly", "0.7"));
    }
    if (eps.length < CHUNK) break;
    from += CHUNK;
  }
  return wrapUrlset(urls);
}

async function buildEntitiesByMonth(supabase: ReturnType<typeof createClient>, ym: string) {
  const b = monthBounds(ym);
  if (!b) throw new Error(`bad ym: ${ym}`);
  const entCount: Record<string, { slug: string; n: number; lastmod?: string }> = {};
  const kinds: { col: "topics"|"people"|"companies"|"tickers"|"ingredients"; route: string }[] = [
    { col: "topics", route: "topic" }, { col: "people", route: "person" },
    { col: "companies", route: "company" }, { col: "tickers", route: "ticker" }, { col: "ingredients", route: "ingredient" },
  ];
  let from = 0;
  const CHUNK = 1000;
  while (true) {
    const { data: chunk, error } = await supabase
      .from("episodes")
      .select("updated_at,topics,people,companies,tickers,ingredients,podcasts!inner(rss_status,language,language_decision,is_hungarian)")
      .gte("published_at", b.start)
      .lt("published_at", b.end)
      .eq("podcasts.is_hungarian", true)
      .eq("podcasts.language_decision", "accept_hungarian")
      .order("published_at", { ascending: true })
      .range(from, from + CHUNK - 1);
    if (error) throw error;
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
    if (chunk.length < CHUNK) break;
    from += CHUNK;
  }
  const urls: string[] = [];
  Object.entries(entCount).forEach(([key, info]) => {
    if (info.n < 3) return;
    const route = key.split(":")[0];
    const priority = info.n >= 20 ? "0.8" : "0.6";
    urls.push(urlTag(`${SITE}/${route}/${esc(info.slug)}`, info.lastmod || null, "weekly", priority));
  });
  return wrapUrlset(urls);
}

Deno.serve(async (req) => {
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const u = new URL(req.url);
    const type = u.searchParams.get("type");
    const ym = u.searchParams.get("ym") || "";
    const part = u.searchParams.get("part");

    let body: string;
    if (!type) body = await buildSitemapIndex(supabase);
    else if (type === "core") body = await buildCore(supabase);
    else if (type === "podcasts") body = await buildPodcasts(supabase);
    else if (type === "episodes") body = await buildEpisodesByMonth(supabase, ym, part);
    else if (type === "entities") body = await buildEntitiesByMonth(supabase, ym);
    else return new Response(`<!-- unknown type: ${type} -->`, { status: 400, headers: xmlHeaders });

    return new Response(body, { headers: xmlHeaders });
  } catch (e) {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : JSON.stringify(e);
    console.error("sitemap error:", msg);
    return new Response(`<!-- sitemap error: ${msg} -->`, { status: 500, headers: xmlHeaders });
  }
});
