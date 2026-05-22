// Prerender edge function for AI/SEO crawlers.
// Cloudflare Worker detects bot UAs and forwards to:
//   GET /functions/v1/prerender?path=/podcast/some-slug
// Returns full HTML (visible text + JSON-LD + SPA shell so JS can still hydrate).
//
// Routes handled:
//   /                              → home (top S/A podcasts)
//   /podcast/:slug                 → PodcastSeries + episode list
//   /podcast/:slug/:episode        → PodcastEpisode
//   /category/:slug                → CollectionPage + podcast list
//   /topic|person|company|ticker|ingredient/:slug → CollectionPage + episode list
//   anything else                  → 404 (Worker will fall back to origin)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SITE = Deno.env.get("PUBLIC_SITE_URL") || "https://podiverzum.hu";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const baseHeaders: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "public, max-age=600, s-maxage=86400",
  "Access-Control-Allow-Origin": "*",
  "X-Prerendered": "1",
  "Vary": "User-Agent",
};

const esc = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const stripHtml = (s?: string | null) =>
  String(s ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const truncate = (s: string, n: number) =>
  s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…";

function htmlResponse(body: string, status = 200) {
  // Build a fresh Headers per response — sharing a plain object can let the
  // gateway override Content-Type to text/plain.
  const h = new Headers();
  h.set("Content-Type", "text/html; charset=utf-8");
  h.set("Cache-Control", "public, max-age=600, s-maxage=86400");
  h.set("Access-Control-Allow-Origin", "*");
  h.set("X-Prerendered", "1");
  h.set("Vary", "User-Agent");
  return new Response(body, { status, headers: h });
}

function shell(opts: {
  title: string;
  description: string;
  canonical: string;
  ogImage?: string | null;
  jsonLd: unknown[];
  bodyHtml: string;
  noindex?: boolean;
}) {
  const ogImg = opts.ogImage || `${SITE}/og-image.png`;
  const ld = opts.jsonLd
    .map((j) => `<script type="application/ld+json">${JSON.stringify(j)}</script>`)
    .join("\n");
return `<!doctype html>
<html lang="hu">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(opts.title)}</title>
<meta name="description" content="${esc(opts.description)}" />
${opts.noindex ? '<meta name="robots" content="noindex" />' : ""}
<link rel="canonical" href="${esc(opts.canonical)}" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(opts.title)}" />
<meta property="og:description" content="${esc(opts.description)}" />
<meta property="og:image" content="${esc(ogImg)}" />
<meta property="og:url" content="${esc(opts.canonical)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(opts.title)}" />
<meta name="twitter:description" content="${esc(opts.description)}" />
<meta name="twitter:image" content="${esc(ogImg)}" />
<link rel="icon" href="/favicon.ico" sizes="any" />
${ld}
</head>
<body>
<div id="root">${opts.bodyHtml}</div>
<script type="module" src="/src/main.tsx"></script>
</body>
</html>`;
}

function notFound(path: string) {
  return new Response(new TextEncoder().encode(shell({
      title: "Nincs ilyen oldal — Podiverzum",
      description: "A keresett oldal nem található.",
      canonical: `${SITE}${path}`,
      jsonLd: [],
      bodyHtml: "<h1>Nincs ilyen oldal</h1>",
      noindex: true,
    })),
    { status: 404, headers: new Headers(baseHeaders) },
  );
}

// ---------- builders ----------

async function buildHome(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase
    .from("mv_homepage_feed")
    .select("episode_id, title, display_title, slug, summary, description, published_at, podcast_title, podcast_display_title, podcast_slug")
    .order("published_at", { ascending: false })
    .limit(40);

  const rows = (data ?? []) as Array<Record<string, any>>;
  const items = rows.slice(0, 30);

  const itemsHtml = items
    .map((r) => {
      const url = `${SITE}/podcast/${r.podcast_slug}/${r.slug}`;
      const sum = stripHtml(r.summary || r.description);
      const epTitle = r.display_title || r.title;
      const podTitle = r.podcast_display_title || r.podcast_title;
      return `<li><a href="${esc(url)}"><strong>${esc(epTitle)}</strong></a> — <em>${esc(podTitle)}</em>${sum ? `<p>${esc(truncate(sum, 280))}</p>` : ""}</li>`;
    })
    .join("");

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: items.map((r, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE}/podcast/${r.podcast_slug}/${r.slug}`,
      name: r.display_title || r.title,
    })),
  };
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Podiverzum",
    url: SITE,
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE}/search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };

  return new Response(new TextEncoder().encode(shell({
      title: "Podiverzum — Találd meg. Hallgasd meg.",
      description:
        "Magyar podcast felfedező. Keress epizódokat témák, személyek, cégek vagy ötletek alapján. Találd meg. Hallgasd meg.",
      canonical: `${SITE}/`,
      jsonLd: [website, itemList],
      bodyHtml: `<header><h1>Podiverzum</h1><p>Magyar podcast felfedező — találd meg, hallgasd meg.</p></header>
<main><h2>Friss epizódok</h2><ul>${itemsHtml}</ul></main>`,
    })),
    { headers: new Headers(baseHeaders) },
  );
}

async function buildPodcast(
  supabase: ReturnType<typeof createClient>,
  slug: string,
) {
  const { data: pod } = await supabase
    .from("podcasts")
    .select("id, title, display_title, slug, description, summary, image_url, website_url, seo_title, seo_description, language, category")
    .eq("slug", slug)
    .maybeSingle();
  if (!pod) return null;

  const { data: epData } = await supabase
    .from("episodes")
    .select("title, slug, published_at, ai_summary, summary, description")
    .eq("podcast_id", pod.id)
    .order("published_at", { ascending: false })
    .limit(50);
  const eps = (epData ?? []) as Array<Record<string, any>>;

  const title = pod.seo_title || `${pod.display_title || pod.title} — Podiverzum`;
  const desc =
    pod.seo_description ||
    truncate(stripHtml(pod.summary || pod.description) || `${pod.title} podcast a Podiverzumon.`, 160);
  const canonical = `${SITE}/podcast/${pod.slug}`;

  const epHtml = eps
    .map((e) => {
      const url = `${SITE}/podcast/${pod.slug}/${e.slug}`;
      const s = truncate(stripHtml(e.ai_summary || e.summary || e.description), 240);
      return `<li><a href="${esc(url)}"><strong>${esc(e.title)}</strong></a>${e.published_at ? ` <time datetime="${esc(e.published_at)}">${esc(e.published_at.slice(0, 10))}</time>` : ""}${s ? `<p>${esc(s)}</p>` : ""}</li>`;
    })
    .join("");

  const series = {
    "@context": "https://schema.org",
    "@type": "PodcastSeries",
    name: pod.display_title || pod.title,
    url: canonical,
    image: pod.image_url || undefined,
    description: stripHtml(pod.description || pod.summary) || undefined,
    inLanguage: pod.language || "hu",
    sameAs: [pod.website_url].filter(Boolean),
  };
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: eps.slice(0, 30).map((e, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE}/podcast/${pod.slug}/${e.slug}`,
      name: e.title,
    })),
  };

  const longDesc = stripHtml(pod.description || pod.summary);

  return new Response(new TextEncoder().encode(shell({
      title,
      description: desc,
      canonical,
      ogImage: pod.image_url,
      jsonLd: [series, itemList],
      bodyHtml: `<article>
<header><h1>${esc(pod.display_title || pod.title)}</h1>${pod.category ? `<p><em>${esc(pod.category)}</em></p>` : ""}</header>
${longDesc ? `<section><h2>A műsorról</h2><p>${esc(longDesc)}</p></section>` : ""}
<section><h2>Epizódok</h2><ul>${epHtml}</ul></section>
</article>`,
    })),
    { headers: new Headers(baseHeaders) },
  );
}

async function buildEpisode(
  supabase: ReturnType<typeof createClient>,
  podcastSlug: string,
  episodeSlug: string,
) {
  const { data: pod } = await supabase
    .from("podcasts")
    .select("id, title, display_title, slug, image_url, language")
    .eq("slug", podcastSlug)
    .maybeSingle();
  if (!pod) return null;

  const { data: ep } = await supabase
    .from("episodes")
    .select("title, display_title, slug, published_at, audio_url, image_url, ai_summary, summary, description, seo_title, seo_description, topics, people, companies, tickers, ingredients")
    .eq("podcast_id", pod.id)
    .eq("slug", episodeSlug)
    .maybeSingle();
  if (!ep) return null;

  const title = ep.seo_title || `${ep.display_title || ep.title} — ${pod.display_title || pod.title}`;
  const desc =
    ep.seo_description ||
    truncate(stripHtml(ep.ai_summary || ep.summary || ep.description) || ep.title, 160);
  const canonical = `${SITE}/podcast/${pod.slug}/${ep.slug}`;
  const longText = stripHtml(ep.ai_summary || ep.summary || ep.description);

  const entities: Array<{ k: string; label: string; vals: string[] }> = [
    { k: "topic", label: "Témák", vals: ep.topics ?? [] },
    { k: "person", label: "Személyek", vals: ep.people ?? [] },
    { k: "company", label: "Cégek", vals: ep.companies ?? [] },
    { k: "ticker", label: "Tickerek", vals: ep.tickers ?? [] },
    { k: "ingredient", label: "Hozzávalók", vals: ep.ingredients ?? [] },
  ];
  const entitySection = entities
    .filter((e) => e.vals.length)
    .map(
      (e) =>
        `<h3>${esc(e.label)}</h3><ul>${e.vals
          .slice(0, 20)
          .map((v) => `<li><a href="${SITE}/${e.k}/${esc(slugify(v, e.k))}">${esc(v)}</a></li>`)
          .join("")}</ul>`,
    )
    .join("");

  const ld = {
    "@context": "https://schema.org",
    "@type": "PodcastEpisode",
    name: ep.display_title || ep.title,
    url: canonical,
    datePublished: ep.published_at || undefined,
    description: longText || undefined,
    image: ep.image_url || pod.image_url || undefined,
    inLanguage: pod.language || "hu",
    associatedMedia: ep.audio_url
      ? { "@type": "MediaObject", contentUrl: ep.audio_url }
      : undefined,
    partOfSeries: {
      "@type": "PodcastSeries",
      name: pod.display_title || pod.title,
      url: `${SITE}/podcast/${pod.slug}`,
    },
  };
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Kezdőlap", item: SITE },
      { "@type": "ListItem", position: 2, name: pod.display_title || pod.title, item: `${SITE}/podcast/${pod.slug}` },
      { "@type": "ListItem", position: 3, name: ep.display_title || ep.title, item: canonical },
    ],
  };

  return new Response(new TextEncoder().encode(shell({
      title,
      description: desc,
      canonical,
      ogImage: ep.image_url || pod.image_url,
      jsonLd: [ld, breadcrumbs],
      bodyHtml: `<article>
<header>
  <p><a href="${SITE}/podcast/${pod.slug}">${esc(pod.display_title || pod.title)}</a></p>
  <h1>${esc(ep.display_title || ep.title)}</h1>
  ${ep.published_at ? `<time datetime="${esc(ep.published_at)}">${esc(ep.published_at.slice(0, 10))}</time>` : ""}
</header>
${longText ? `<section>${longText.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join("")}</section>` : ""}
${entitySection ? `<section><h2>Említett entitások</h2>${entitySection}</section>` : ""}
${ep.audio_url ? `<section><h2>Hallgasd meg</h2><audio controls preload="none" src="${esc(ep.audio_url)}"></audio></section>` : ""}
</article>`,
    })),
    { headers: new Headers(baseHeaders) },
  );
}

function slugify(v: string, kind: string) {
  if (kind === "ticker") return v.replace(/[^a-zA-Z0-9.]+/g, "").toUpperCase();
  return v
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

async function buildCategory(
  supabase: ReturnType<typeof createClient>,
  slug: string,
) {
  const { data: cat } = await supabase
    .from("categories")
    .select("name, slug, description, seo_title, seo_description")
    .eq("slug", slug)
    .maybeSingle();
  if (!cat) return null;

  const { data: pods } = await supabase
    .from("podcasts")
    .select("title, display_title, slug, summary, image_url")
    .eq("category", cat.name)
    .or("is_hungarian.eq.true")
    .eq("rss_status", "active")
    .gte("podiverzum_rank", 3)
    .order("podiverzum_rank", { ascending: false })
    .limit(50);

  const list = (pods ?? []) as Array<Record<string, any>>;
  const title = cat.seo_title || `${cat.name} podcastek — Podiverzum`;
  const desc =
    cat.seo_description ||
    truncate(stripHtml(cat.description) || `A legjobb ${cat.name} podcastek a Podiverzumon.`, 160);
  const canonical = `${SITE}/category/${cat.slug}`;

  const html = list
    .map((p) => {
      const u = `${SITE}/podcast/${p.slug}`;
      const s = truncate(stripHtml(p.summary), 200);
      return `<li><a href="${u}"><strong>${esc(p.display_title || p.title)}</strong></a>${s ? `<p>${esc(s)}</p>` : ""}</li>`;
    })
    .join("");

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: list.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE}/podcast/${p.slug}`,
      name: p.display_title || p.title,
    })),
  };

  return new Response(new TextEncoder().encode(shell({
      title,
      description: desc,
      canonical,
      jsonLd: [itemList],
      bodyHtml: `<header><h1>${esc(cat.name)}</h1>${cat.description ? `<p>${esc(stripHtml(cat.description))}</p>` : ""}</header>
<main><h2>Podcastek</h2><ul>${html}</ul></main>`,
    })),
    { headers: new Headers(baseHeaders) },
  );
}

async function buildEntity(
  supabase: ReturnType<typeof createClient>,
  kind: "topic" | "person" | "company" | "ticker" | "ingredient",
  slug: string,
) {
  const arrayCol =
    kind === "topic" ? "topics" :
    kind === "person" ? "people" :
    kind === "company" ? "companies" :
    kind === "ticker" ? "tickers" : "ingredients";

  // Match by slugified comparison: fetch a generous batch then filter in JS.
  // For tickers we can match exact uppercase value.
  const matchValue = kind === "ticker" ? slug.toUpperCase() : slug;

  const { data } = await supabase
    .from("episodes")
    .select(`title, slug, published_at, ai_summary, ${arrayCol}, podcast:podcasts!inner(title, display_title, slug, language, rss_status)`)
    .contains(arrayCol, [matchValue])
    .order("published_at", { ascending: false })
    .limit(60);

  let rows = (data ?? []) as Array<Record<string, any>>;
  // Fallback: if no exact match, scan a wider batch and slugify-compare.
  if (!rows.length) {
    const { data: wide } = await supabase
      .from("episodes")
      .select(`title, slug, published_at, ai_summary, ${arrayCol}, podcast:podcasts!inner(title, display_title, slug, language, rss_status)`)
      .not(arrayCol, "is", null)
      .order("published_at", { ascending: false })
      .limit(500);
    rows = ((wide ?? []) as Array<Record<string, any>>).filter((r) =>
      ((r as any)[arrayCol] as string[] | null)?.some((v) => slugify(v, kind) === slug),
    );
  }
  // HU-only filter
  rows = rows.filter((r: any) => {
    const lang = r.podcast?.language;
    return lang && /^hu/i.test(lang);
  });
  if (!rows.length) return null;

  const human = slug.replace(/-/g, " ");
  const title = `${human} — epizódok a Podiverzumon`;
  const desc = `Magyar podcast epizódok, amelyek a következőről szólnak: ${human}. Válogatva és AI-összefoglalóval a Podiverzumon.`;
  const canonical = `${SITE}/${kind}/${slug}`;

  const list = rows.slice(0, 40);
  const html = list
    .map((r) => {
      const u = `${SITE}/podcast/${r.podcast.slug}/${r.slug}`;
      const s = truncate(stripHtml(r.ai_summary), 240);
      return `<li><a href="${u}"><strong>${esc(r.title)}</strong></a> — <em>${esc(r.podcast.display_title || r.podcast.title)}</em>${s ? `<p>${esc(s)}</p>` : ""}</li>`;
    })
    .join("");

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: list.map((r, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE}/podcast/${r.podcast.slug}/${r.slug}`,
      name: r.title,
    })),
  };

  return new Response(new TextEncoder().encode(shell({
      title,
      description: desc,
      canonical,
      jsonLd: [itemList],
      bodyHtml: `<header><h1>${esc(human)}</h1><p>Magyar podcast epizódok, amelyek ezt említik: ${esc(human)}.</p></header>
<main><ul>${html}</ul></main>`,
    })),
    { headers: new Headers(baseHeaders) },
  );
}

// ---------- router ----------

// HU ↔ EN route aliases. The Cloudflare worker forwards the original (likely
// HU) path; we normalize the entity kind here so all builders share one enum,
// but pass the original prefix through so canonical/og:url stays HU.
const HU_TO_EN: Record<string, "topic" | "person" | "company" | "ingredient"> = {
  tema: "topic",
  szemely: "person",
  ceg: "company",
  hozzavalo: "ingredient",
};

Deno.serve(async (req) => {
  try {
    const url = new URL(req.url);
    let path = url.searchParams.get("path") || "/";
    if (!path.startsWith("/")) path = "/" + path;
    // Normalize: strip query, trailing slash
    path = path.split("?")[0].replace(/\/+$/, "") || "/";

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON);

    if (path === "/") return await buildHome(supabase);

    const parts = path.split("/").filter(Boolean);

    if (parts[0] === "podcast" && parts.length === 2) {
      const r = await buildPodcast(supabase, parts[1]);
      return r ?? notFound(path);
    }
    if (parts[0] === "podcast" && parts.length === 3) {
      const r = await buildEpisode(supabase, parts[1], parts[2]);
      return r ?? notFound(path);
    }
    if ((parts[0] === "category" || parts[0] === "kategoria") && parts.length === 2) {
      const r = await buildCategory(supabase, parts[1]);
      return r ?? notFound(path);
    }
    if (parts.length === 2) {
      const enKind = HU_TO_EN[parts[0]] ??
        (["topic", "person", "company", "ticker", "ingredient"].includes(parts[0])
          ? (parts[0] as any) : null);
      if (enKind) {
        const r = await buildEntity(supabase, enKind as any, parts[1], parts[0]);
        return r ?? notFound(path);
      }
    }

    return notFound(path);
  } catch (err) {
    console.error("prerender error", err);
    return new Response(new TextEncoder().encode(`<!doctype html><title>Error</title>`), {
      status: 500,
      headers: new Headers(baseHeaders),
    });
  }
});
