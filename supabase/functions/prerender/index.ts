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
//   /podcastok|szemelyek|szervezetek|cegek|partok|temak → Hub landing pages
//   anything else                  → 404 (Worker will fall back to origin)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SITE = Deno.env.get("PUBLIC_SITE_URL") || "https://podiverzum.hu";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const PODCAST_SEO_CTA = "Hallgasd meg az összes epizódot a Podiverzumon — magyar podcast katalógus.";
const PODCAST_SEO_DESCRIPTION_MAX = 160;

const SITE_PUBLISHER = {
  displayName: "PREAG Zrt.",
  legalName: "Precíziós Agrokémia Zártkörűen Működő Részvénytársaság",
  companyRegisterNumber: "13-10-042640",
  taxId: "26558534-2-13",
  foundingDate: "2018-10-31",
  address: {
    streetAddress: "Ady Endre utca 11.",
    postalCode: "2636",
    addressLocality: "Tésa",
    addressCountry: "HU",
  },
} as const;

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

function firstSentence(value?: string | null): string {
  const text = stripHtml(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const sentence = text.match(/^(.{40,260}?[.!?])(?:\s|$)/)?.[1]?.trim();
  return sentence || truncate(text, 180);
}

function podcastSeoDescription(baseDesc: string, entityLines: string[]): string {
  const ctaBudget = PODCAST_SEO_CTA.length + 1;
  const contextBudget = Math.max(60, PODCAST_SEO_DESCRIPTION_MAX - ctaBudget);
  const context = truncate([baseDesc, ...entityLines].filter(Boolean).join(" "), contextBudget);
  return [context, PODCAST_SEO_CTA].filter(Boolean).join(" ").slice(0, PODCAST_SEO_DESCRIPTION_MAX);
}

function sitePublisherJsonLd() {
  return {
    "@type": "Organization",
    name: SITE_PUBLISHER.displayName,
    legalName: SITE_PUBLISHER.legalName,
    identifier: SITE_PUBLISHER.companyRegisterNumber,
    taxID: SITE_PUBLISHER.taxId,
    foundingDate: SITE_PUBLISHER.foundingDate,
    address: {
      "@type": "PostalAddress",
      ...SITE_PUBLISHER.address,
    },
  };
}

function hasVerifiedPersonWiki(person: Record<string, unknown>): boolean {
  return person.wikipedia_match_status === "verified"
    && Number(person.wikipedia_match_confidence || 0) >= 0.8;
}

function hasTrustedPersonIdentity(person: Record<string, unknown>): boolean {
  if (person.manual_approved === true) return true;
  return hasVerifiedPersonWiki(person);
}

function isSafePublicPerson(person: Record<string, unknown>): boolean {
  if (!person || person.is_public === false || person.is_indexable === false) return false;
  if (!["indexable", "manual_approved", null, undefined].includes(person.activation_status as any)) return false;
  if (["hide", "reject"].includes(String(person.ai_recommended_action || ""))) return false;
  if (["needs_human_review", "duplicate_candidate"].includes(String(person.ai_review_status || ""))) return false;
  if (person.identity_status === "split_resolved") return false;
  const temporalTopicOnly = person.has_archival_evidence !== true && person.manual_approved !== true && (
    person.is_deceased === true
    || person.is_historical === true
    || person.persona === "historical"
    || Boolean(person.date_of_death)
    || person.is_living === false
  );
  if (temporalTopicOnly) return false;
  if (person.identity_ambiguous && !hasTrustedPersonIdentity(person)) return false;
  return Number(person.gated_episode_count || person.episode_count || 0) >= 1;
}

function isSafeGeneratedPersonBio(person: Record<string, unknown>, text?: string | null): boolean {
  const raw = stripHtml(text);
  if (!raw) return false;
  if (person.identity_ambiguous && !hasTrustedPersonIdentity(person)) return false;
  if (person.ai_bio_status && person.ai_bio_status !== "completed") return false;
  if (person.ai_bio_confidence != null && Number(person.ai_bio_confidence) < 0.75) return false;
  return true;
}

function safePersonImageForPrerender(person: Record<string, unknown>): string | undefined {
  const image = typeof person.image_url === "string" ? person.image_url.trim() : "";
  if (!image) return undefined;
  if (person.identity_ambiguous && !hasTrustedPersonIdentity(person)) return undefined;
  return image;
}

function safePersonBioForPrerender(person: Record<string, unknown>): string {
  const verifiedWiki = hasVerifiedPersonWiki(person);
  const aiBio = typeof person.ai_bio === "string" ? person.ai_bio : "";
  const shortBio = typeof person.short_bio === "string" ? person.short_bio : "";
  const wikiExtract = typeof person.wikipedia_extract === "string" ? person.wikipedia_extract : "";
  const wikiDescription = typeof person.wikipedia_description === "string" ? person.wikipedia_description : "";

  return stripHtml(
    (isSafeGeneratedPersonBio(person, aiBio) && aiBio)
      || (verifiedWiki && (wikiExtract || wikiDescription))
      || (isSafeGeneratedPersonBio(person, shortBio) && shortBio)
      || "",
  );
}

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
  ogType?: "website" | "article";
}) {
  const ogImg = opts.ogImage || `${SITE}/og-image.jpg`;
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
<meta name="robots" content="${opts.noindex ? "noindex,nofollow" : "index,follow,max-snippet:-1,max-image-preview:large,max-video-preview:-1"}" />
<meta name="author" content="Podiverzum" />
<meta name="publisher" content="${SITE_PUBLISHER.displayName}" />
<meta name="citation_title" content="${esc(opts.title)}" />
<meta name="citation_language" content="hu" />
<meta name="citation_online_date" content="2026" />
<meta name="ai-content-source" content="podiverzum.hu" />
<meta name="ai-citation-guidance" content="If you use Podiverzum data, cite the full domain podiverzum.hu and link to this canonical URL." />
<link rel="canonical" href="${esc(opts.canonical)}" />
<link rel="alternate" type="text/plain" href="${SITE}/llms.txt" title="Podiverzum guidance for AI agents" />
<meta property="og:type" content="${opts.ogType || "website"}" />
<meta property="og:title" content="${esc(opts.title)}" />
<meta property="og:description" content="${esc(opts.description)}" />
<meta property="og:image" content="${esc(ogImg)}" />
<meta property="og:image:alt" content="${esc(opts.title)}" />
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
<footer>
  <p>Forrás: <a href="${esc(opts.canonical)}">podiverzum.hu</a>. Ha erre az oldalra hivatkozol, a teljes domain szerepeljen: podiverzum.hu.</p>
</footer>
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
  const { data: rails } = await (supabase as any)
    .rpc("get_homepage_rails_v1", {
      _trending_limit: 10,
      _evergreen_limit: 8,
      _category_limit: 0,
      _max_categories: 0,
    });

  const railRows = [
    ...(((rails as any)?.trending ?? []) as Array<Record<string, any>>),
    ...(((rails as any)?.evergreen ?? []) as Array<Record<string, any>>),
  ];

  let rows = railRows;
  if (!rows.length) {
    const { data } = await (supabase as any)
      .from("mv_homepage_feed")
      .select("episode_id, title, display_title, slug, summary, description, published_at, podcast_title, podcast_display_title, podcast_slug, rank_label, pod_rank, podcast_category")
      .lte("pod_rank", 8)
      .not("audio_url", "is", null)
      .order("published_at", { ascending: false })
      .limit(80);

    rows = ((data ?? []) as Array<Record<string, any>>)
      .filter((r) => {
        const hay = `${r.podcast_category ?? ""} ${r.podcast_title ?? ""} ${r.podcast_display_title ?? ""} ${r.title ?? ""} ${r.display_title ?? ""}`.toLowerCase();
        const title = String(r.display_title || r.title || "").toLowerCase();
        const newsLike = /(hírek|hirek|infostart|összes hír|osszes hir|krónika|kronika)/i.test(hay);
        const bulletinLike = /(^\s*[0-9]{1,2}\s*[-–—]\s+|^\s*20[0-9]{6}(\s|[-–—])|hírek röviden|hirek roviden|percben)/i.test(title);
        return !bulletinLike && !newsLike;
      });
  }

  const seen = new Set<string>();
  const items = rows.filter((r) => {
    const id = String(r.episode_id || `${r.podcast_slug}/${r.slug}`);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, 30);

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
    alternateName: "Podiverzum.hu",
    url: `${SITE}/`,
    inLanguage: "hu-HU",
    isAccessibleForFree: true,
    publisher: sitePublisherJsonLd(),
    potentialAction: {
      "@type": "SearchAction",
      target: `${SITE}/kereses?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Podiverzum",
    url: `${SITE}/`,
    logo: `${SITE}/icon-512.png`,
    publisher: sitePublisherJsonLd(),
    sameAs: [`${SITE}/`],
  };
  const collectionPage = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Magyar podcast kereső és ajánló",
    url: `${SITE}/`,
    inLanguage: "hu-HU",
      description: "Magyar podcast epizódok, műsorok, témák és személyes ajánlók felfedezése.",
  };

  return new Response(new TextEncoder().encode(shell({
      title: "Podiverzum — magyar podcast kereső és ajánló",
      description:
        "Magyar podcast kereső, ajánló és felfedező. Keress epizódokat téma, személy, műsor vagy gondolat alapján.",
      canonical: `${SITE}/`,
      jsonLd: [website, organization, collectionPage, itemList],
      bodyHtml: `<header><h1>Magyar podcastok okosabban</h1><p>Podiverzum — magyar podcast kereső, ajánló és felfedező.</p></header>
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
    .select("id, title, display_title, slug, description, summary, image_url, website_url, seo_title, seo_description, language, category, language_decision, rss_status")
    .eq("slug", slug)
    .maybeSingle();
  if (!pod || !isAcceptedHungarianPrerenderPodcast(pod)) return null;

  const [{ data: epData }, { count: totalEpisodeCount }] = await Promise.all([
    supabase
      .from("episodes")
      .select("title, slug, published_at, ai_summary, summary, description, companies")
      .eq("podcast_id", pod.id)
      .order("published_at", { ascending: false })
      .limit(50),
    supabase
      .from("episodes")
      .select("id", { count: "exact", head: true })
      .eq("podcast_id", pod.id),
  ]);
  const eps = (epData ?? []) as Array<Record<string, any>>;

  const displayName = pod.display_title || pod.title;
  const epCount = totalEpisodeCount ?? eps.length;
  const title = `${displayName} – ${epCount} epizód · podcast | Podiverzum`;
  const organizationCounts = new Map<string, number>();
  for (const ep of eps) {
    for (const org of Array.isArray(ep.companies) ? ep.companies : []) {
      const name = String(org || "").trim();
      if (!name) continue;
      organizationCounts.set(name, (organizationCounts.get(name) || 0) + 1);
    }
  }
  const topOrganizationNamesForSeo = [...organizationCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([name]) => name);
  const organizationLine = topOrganizationNamesForSeo.length
    ? `Gyakori szervezet: ${topOrganizationNamesForSeo.join(", ")}.`
    : "";
  const baseDesc = firstSentence(pod.description || pod.summary || pod.seo_description)
    || `${displayName} podcast epizódjai a Podiverzumon.`;
  const desc = podcastSeoDescription(baseDesc, [organizationLine]);
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
    name: displayName,
    url: canonical,
    image: pod.image_url || undefined,
    description: stripHtml(pod.seo_description || pod.summary || pod.description) || baseDesc,
    inLanguage: pod.language || "hu",
    sameAs: [pod.website_url].filter(Boolean),
    numberOfEpisodes: epCount || undefined,
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
    .select("id, title, display_title, slug, image_url, language, language_decision, rss_status")
    .eq("slug", podcastSlug)
    .maybeSingle();
  if (!pod) return null;

  const { data: ep } = await supabase
    .from("episodes")
    .select("id, title, display_title, slug, published_at, audio_url, image_url, ai_summary, summary, description, seo_title, seo_description, topics, people, companies, tickers, ingredients")
    .eq("podcast_id", pod.id)
    .eq("slug", episodeSlug)
    .maybeSingle();
  if (!ep) return null;

  const { data: cleanRow } = await supabase
    .from("episode_clean_text")
    .select("cleaned_text")
    .eq("episode_id", ep.id)
    .like("cleaner_method", "deterministic_v4%")
    .maybeSingle();
  const cleanText = stripHtml((cleanRow as any)?.cleaned_text || "");

  const isAcceptedHungarian = isAcceptedHungarianPrerenderPodcast(pod);
  const safeSeoTitle = stripHtml(ep.seo_title || "");
  const title = safeSeoTitle || `${ep.display_title || ep.title} — ${pod.display_title || pod.title} | Podiverzum`;
  const desc =
    ep.seo_description ||
    truncate(stripHtml(ep.ai_summary || ep.summary) || cleanText || stripHtml(ep.description) || ep.title, 160);
  const canonical = `${SITE}/podcast/${pod.slug}/${ep.slug}`;
  const longText = stripHtml(ep.ai_summary || ep.summary) || cleanText || stripHtml(ep.description);

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
    mainEntityOfPage: canonical,
    datePublished: ep.published_at || undefined,
    description: longText || undefined,
    image: ep.image_url || pod.image_url || undefined,
    inLanguage: "hu-HU",
    isAccessibleForFree: true,
    associatedMedia: ep.audio_url
      ? { "@type": "MediaObject", contentUrl: ep.audio_url }
      : undefined,
    partOfSeries: {
      "@type": "PodcastSeries",
      name: pod.display_title || pod.title,
      url: `${SITE}/podcast/${pod.slug}`,
      inLanguage: "hu-HU",
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
      ogType: "article",
      jsonLd: isAcceptedHungarian ? [ld, breadcrumbs] : [],
      noindex: !isAcceptedHungarian,
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

function isAcceptedHungarianPrerenderPodcast(p: any): boolean {
  if (!p) return false;
  if (p.rss_status === "failed" || p.rss_status === "inactive") return false;
  return p.language_decision === "accept_hungarian";
}

async function buildCategory(
  supabase: ReturnType<typeof createClient>,
  slug: string,
  urlPrefix: string = "category",
) {
  const { data: cat } = await supabase
    .from("categories")
    .select("name, slug, description, seo_title, seo_description, taxonomy_keys")
    .eq("slug", slug)
    .maybeSingle();
  if (!cat) return null;

  const taxKeys = Array.isArray((cat as any).taxonomy_keys) && (cat as any).taxonomy_keys.length
    ? (cat as any).taxonomy_keys
    : [cat.name];
  const { data: pods } = await supabase
    .from("podcasts")
    .select("title, display_title, slug, summary, image_url, language_decision")
    .in("category", taxKeys)
    .eq("language_decision", "accept_hungarian")
    .eq("rss_status", "active")
    .order("podiverzum_rank", { ascending: false })
    .limit(50);

  const list = (pods ?? []) as Array<Record<string, any>>;
  const title = cat.seo_title || `${cat.name} podcastok és epizódok — Podiverzum`;
  const desc =
    cat.seo_description ||
    truncate(stripHtml(cat.description) || `Válogatás a legjobb ${cat.name} podcast epizódokból. A sorrendet a relevancia és a frissesség adja.`, 160);
  const canonical = `${SITE}/${urlPrefix}/${cat.slug}`;
  const ogImage = list[0]?.image_url ?? null;

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
      ogImage,
      jsonLd: [itemList],
      bodyHtml: `<header><h1>${esc(cat.name)}</h1>${cat.description ? `<p>${esc(stripHtml(cat.description))}</p>` : ""}</header>
<main><h2>Podcastek</h2><ul>${html}</ul></main>`,
    })),
    { headers: new Headers(baseHeaders) },
  );
}

// --- Canonical-table entity builders -------------------------------------
// People → public.people + public.person_episode_mentions
async function buildPerson(
  supabase: ReturnType<typeof createClient>,
  slug: string,
  urlPrefix: string,
) {
  const { data: person } = await (supabase as any)
    .from("people")
    .select("id, name, slug, image_url, ai_bio, ai_bio_status, ai_bio_confidence, wikipedia_extract, wikipedia_description, wikipedia_match_status, wikipedia_match_confidence, short_bio, identity_ambiguous, manual_approved, is_deceased, is_historical, has_archival_evidence, persona, is_topic_only, date_of_death, is_living, participant_count, host_count, guest_count, is_public, is_indexable, ai_review_status, activation_status")
    .eq("slug", slug)
    .maybeSingle();
  if (!person || person.is_public === false) return null;
  const historicalWithoutEvidence = (
      person.is_deceased === true
      || person.is_historical === true
      || person.persona === "historical"
      || Boolean(person.date_of_death)
      || person.is_living === false
    )
    && person.has_archival_evidence !== true
    && person.manual_approved !== true;
  if (historicalWithoutEvidence) return null;
  const noindex = person.is_indexable === false
    || historicalWithoutEvidence
    || ["needs_human_review", "duplicate_candidate"].includes(person.ai_review_status || "")
    || !["indexable", "manual_approved", null, undefined].includes(person.activation_status);

  const { data: rows } = await (supabase as any)
    .from("person_episode_mentions")
    .select(`episode_id, episodes!inner(title, display_title, slug, published_at, ai_summary, podcast:podcasts!inner(title, display_title, slug, language_decision))`)
    .eq("person_id", person.id)
    .order("created_at", { ascending: false })
    .limit(80);

  const eps = ((rows ?? []) as Array<any>)
    .map((r) => r.episodes)
    .filter((e) => e && isAcceptedHungarianPrerenderPodcast(e.podcast))
    .slice(0, 40);

  const canonical = `${SITE}/${urlPrefix}/${slug}`;
  const bio = safePersonBioForPrerender(person);
  const trustedIdentity = hasTrustedPersonIdentity(person);
  const safeImage = safePersonImageForPrerender(person);
  const epCount = eps.length;
  const relation = !historicalWithoutEvidence && (Number(person.participant_count || 0) > 0 || Number(person.host_count || 0) > 0 || Number(person.guest_count || 0) > 0)
    ? "hallható"
    : "kapcsolódik";
  const desc = bio
    ? truncate(bio, 160)
    : epCount > 0
      ? truncate(`Megnézhető ${epCount} podcast epizód, amelyben ${person.name} ${relation}. Kapcsolódó műsorok és említések a Podiverzumon.`, 160)
      : truncate(`${person.name} kapcsolódó magyar podcast epizódjai hamarosan megjelennek a Podiverzum katalógusában.`, 160);
  const title = epCount > 0
    ? `${person.name} – ${epCount} podcast epizódban ${relation} | Podiverzum`
    : `${person.name} podcast epizódok és említések | Podiverzum`;

  const html = eps.map((e) => {
    const u = `${SITE}/podcast/${e.podcast.slug}/${e.slug}`;
    const s = truncate(stripHtml(e.ai_summary), 220);
    return `<li><a href="${u}"><strong>${esc(e.display_title || e.title)}</strong></a> — <em>${esc(e.podcast.display_title || e.podcast.title)}</em>${s ? `<p>${esc(s)}</p>` : ""}</li>`;
  }).join("");

  const personLd: Record<string, unknown> = trustedIdentity ? {
    "@context": "https://schema.org",
    "@type": "Person",
    name: person.name,
    url: canonical,
  } : {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${person.name} podcast epizódok`,
    url: canonical,
  };
  if (safeImage && trustedIdentity) personLd.image = safeImage;
  if (bio) personLd.description = truncate(bio, 500);

  return new Response(new TextEncoder().encode(shell({
      title,
      description: desc,
      canonical,
      ogImage: safeImage,
      jsonLd: [personLd],
      noindex,
      bodyHtml: `<header><h1>${esc(person.name)}</h1>${bio ? `<p>${esc(truncate(bio, 600))}</p>` : ""}</header>
<main><h2>Epizódok</h2><ul>${html}</ul></main>`,
    })),
    { headers: new Headers(baseHeaders) },
  );
}

// Topics → public.topics + public.episode_topic_map
async function buildTopic(
  supabase: ReturnType<typeof createClient>,
  slug: string,
  urlPrefix: string,
) {
  const { data: topic } = await (supabase as any)
    .from("topics")
    .select("id, name, slug, description, seo_title, seo_description, intro_text, is_public, is_indexable")
    .eq("slug", slug)
    .maybeSingle();
  if (!topic || topic.is_public === false) return null;

  const { data: rows } = await (supabase as any)
    .from("episode_topic_map")
    .select(`episode_id, episodes!inner(title, display_title, slug, published_at, ai_summary, podcast:podcasts!inner(title, display_title, slug, image_url, language_decision))`)
    .eq("topic_id", topic.id)
    .order("confidence", { ascending: false })
    .limit(120);

  const eps = ((rows ?? []) as Array<any>)
    .map((r) => r.episodes)
    .filter((e) => e && isAcceptedHungarianPrerenderPodcast(e.podcast))
    .slice(0, 40);

  const canonical = `${SITE}/${urlPrefix}/${slug}`;
  const epCount = eps.length;
  const countLabel = epCount > 0 ? ` – ${epCount} podcast epizód` : "";
  const title = `${topic.name}${countLabel} magyar podcastokból | Podiverzum`;
  const desc = topic.seo_description
    || truncate(stripHtml(topic.intro_text || topic.description) || `${topic.name} témában ${epCount > 0 ? `${epCount} magyar podcast epizód` : "magyar podcast epizódok"}: friss és időtálló beszélgetések a Podiverzum katalógusából.`, 160);
  const ogImage = eps[0]?.podcast?.image_url ?? null;

  const html = eps.map((e) => {
    const u = `${SITE}/podcast/${e.podcast.slug}/${e.slug}`;
    const s = truncate(stripHtml(e.ai_summary), 220);
    return `<li><a href="${u}"><strong>${esc(e.display_title || e.title)}</strong></a> — <em>${esc(e.podcast.display_title || e.podcast.title)}</em>${s ? `<p>${esc(s)}</p>` : ""}</li>`;
  }).join("");

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: eps.map((e, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE}/podcast/${e.podcast.slug}/${e.slug}`,
      name: e.display_title || e.title,
    })),
  };

  return new Response(new TextEncoder().encode(shell({
      title,
      description: desc,
      canonical,
      ogImage,
      jsonLd: [itemList],
      noindex: topic.is_indexable === false,
      bodyHtml: `<header><h1>${esc(topic.name)}</h1>${topic.intro_text ? `<p>${esc(stripHtml(topic.intro_text))}</p>` : ""}</header>
<main><h2>Epizódok</h2><ul>${html}</ul></main>`,
    })),
    { headers: new Headers(baseHeaders) },
  );
}

// Organizations (company/ceg) → public.organizations + episode_organization_map
async function buildOrganization(
  supabase: ReturnType<typeof createClient>,
  slug: string,
  urlPrefix: string,
) {
  const { data: org } = await (supabase as any)
    .from("organizations")
    .select("id, name, slug, logo_url, ai_bio, wikipedia_extract, short_description_hu, is_public, is_indexable, ai_review_status")
    .eq("slug", slug)
    .maybeSingle();
  if (!org || org.is_public === false) return null;
  const noindex = org.is_indexable === false
    || ["needs_human_review", "duplicate_candidate"].includes(org.ai_review_status || "");

  const { data: rows } = await (supabase as any)
    .from("episode_organization_map")
    .select(`episode_id, episodes!inner(title, display_title, slug, published_at, ai_summary, podcast:podcasts!inner(title, display_title, slug, image_url, language_decision))`)
    .eq("organization_id", org.id)
    .order("confidence", { ascending: false })
    .limit(120);

  const eps = ((rows ?? []) as Array<any>)
    .map((r) => r.episodes)
    .filter((e) => e && isAcceptedHungarianPrerenderPodcast(e.podcast))
    .slice(0, 40);

  const canonical = `${SITE}/ceg/${slug}`;
  const bio = stripHtml(org.ai_bio || org.wikipedia_extract || org.short_description_hu || "");
  const epCount = eps.length;
  const companyEpLabel = epCount > 0 ? ` – ${epCount} podcast epizódban említve` : "";
  const title = `${org.name}${companyEpLabel || " podcast említések"} | Podiverzum`;
  const desc = bio
    ? truncate(`${firstSentence(bio)}${epCount > 0 ? ` Megnézhető ${epCount} kapcsolódó podcast epizód.` : ""}`, 160)
    : truncate(`${org.name} említései ${epCount > 0 ? `${epCount} ` : ""}magyar podcast epizódban. Kapcsolódó műsorok, beszélgetések és témák a Podiverzumon.`, 160);

  const html = eps.map((e) => {
    const u = `${SITE}/podcast/${e.podcast.slug}/${e.slug}`;
    const s = truncate(stripHtml(e.ai_summary), 220);
    return `<li><a href="${u}"><strong>${esc(e.display_title || e.title)}</strong></a> — <em>${esc(e.podcast.display_title || e.podcast.title)}</em>${s ? `<p>${esc(s)}</p>` : ""}</li>`;
  }).join("");

  const orgLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: org.name,
    url: canonical,
  };
  if (org.logo_url) orgLd.logo = org.logo_url;
  if (bio) orgLd.description = truncate(bio, 500);

  return new Response(new TextEncoder().encode(shell({
      title,
      description: desc,
      canonical,
      ogImage: org.logo_url,
      jsonLd: [orgLd],
      noindex,
      bodyHtml: `<header><h1>${esc(org.name)}</h1>${bio ? `<p>${esc(truncate(bio, 600))}</p>` : ""}</header>
<main><h2>Epizódok</h2><ul>${html}</ul></main>`,
    })),
    { headers: new Headers(baseHeaders) },
  );
}

// Mood collections → public.mood_collections + episode_ids
async function buildMoodCollection(
  supabase: ReturnType<typeof createClient>,
  slug: string,
) {
  const { data: coll } = await (supabase as any)
    .from("mood_collections")
    .select("title, slug, description, short_description, episode_ids, podcast_ids, active")
    .eq("slug", slug)
    .maybeSingle();
  if (!coll || coll.active === false) return null;

  const episodeIds = (coll.episode_ids ?? []) as string[];
  let eps: Array<any> = [];
  if (episodeIds.length) {
    const { data } = await (supabase as any)
      .from("episodes")
      .select(`title, display_title, slug, ai_summary, published_at, image_url, podcast:podcasts!inner(title, display_title, slug, image_url, language_decision)`)
      .in("id", episodeIds.slice(0, 60));
    eps = ((data ?? []) as Array<any>)
      .filter((e) => isAcceptedHungarianPrerenderPodcast(e.podcast))
      .slice(0, 40);
  }

  const canonical = `${SITE}/hangulatok/${slug}`;
  const title = `${coll.title} — hangulati podcast ajánló | Podiverzum`;
  const desc = truncate(
    stripHtml(coll.short_description || coll.description || `${coll.title} — válogatott magyar podcast epizódok hangulat szerint.`),
    160,
  );
  const ogImage = eps[0]?.image_url || eps[0]?.podcast?.image_url || null;

  const html = eps.map((e) => {
    const u = `${SITE}/podcast/${e.podcast.slug}/${e.slug}`;
    const s = truncate(stripHtml(e.ai_summary), 220);
    return `<li><a href="${u}"><strong>${esc(e.display_title || e.title)}</strong></a> — <em>${esc(e.podcast.display_title || e.podcast.title)}</em>${s ? `<p>${esc(s)}</p>` : ""}</li>`;
  }).join("");

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: coll.title,
    itemListElement: eps.map((e, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE}/podcast/${e.podcast.slug}/${e.slug}`,
      name: e.display_title || e.title,
    })),
  };

  return new Response(new TextEncoder().encode(shell({
      title,
      description: desc,
      canonical,
      ogImage,
      jsonLd: [itemList],
      bodyHtml: `<header><h1>${esc(coll.title)}</h1>${coll.description ? `<p>${esc(stripHtml(coll.description))}</p>` : ""}</header>
<main><h2>Epizódok</h2><ul>${html}</ul></main>`,
    })),
    { headers: new Headers(baseHeaders) },
  );
}

// Legacy fallback for ticker/ingredient (still use array columns on episodes).
async function buildLegacyEntity(
  supabase: ReturnType<typeof createClient>,
  kind: "ticker" | "ingredient",
  slug: string,
  urlPrefix: string,
) {
  const arrayCol = kind === "ticker" ? "tickers" : "ingredients";
  const matchValue = kind === "ticker" ? slug.toUpperCase() : slug;

  const { data } = await (supabase as any)
    .from("episodes")
    .select(`title, slug, published_at, ai_summary, ${arrayCol}, podcast:podcasts!inner(title, display_title, slug, language_decision, rss_status)`)
    .contains(arrayCol, [matchValue])
    .order("published_at", { ascending: false })
    .limit(60);

  let rows = (data ?? []) as Array<Record<string, any>>;
  rows = rows.filter((r: any) => isAcceptedHungarianPrerenderPodcast(r.podcast));
  if (!rows.length) return null;

  const human = slug.replace(/-/g, " ");
  const title = `${human} — epizódok a Podiverzumon`;
  const desc = `Magyar podcast epizódok ${human} témakörben.`;
  const canonical = `${SITE}/${urlPrefix}/${slug}`;

  const html = rows.slice(0, 40).map((r: any) => {
    const u = `${SITE}/podcast/${r.podcast.slug}/${r.slug}`;
    const s = truncate(stripHtml(r.ai_summary), 220);
    return `<li><a href="${u}"><strong>${esc(r.title)}</strong></a> — <em>${esc(r.podcast.display_title || r.podcast.title)}</em>${s ? `<p>${esc(s)}</p>` : ""}</li>`;
  }).join("");

  return new Response(new TextEncoder().encode(shell({
      title,
      description: desc,
      canonical,
      jsonLd: [],
      bodyHtml: `<header><h1>${esc(human)}</h1></header><main><ul>${html}</ul></main>`,
    })),
    { headers: new Headers(baseHeaders) },
  );
}

// ---------- Hub landing pages (single-segment SEO surfaces) ----------

type HubKind = "podcastok" | "szemelyek" | "szervezetek" | "cegek" | "partok" | "temak";

// ---------- hub SEO helpers (Wave 2) ----------

function hubCrossLinks(current: HubKind): string {
  const all: Array<{ kind: HubKind; href: string; label: string; blurb: string }> = [
    { kind: "podcastok", href: "/podcastok", label: "Magyar podcastek", blurb: "Aktív műsorok, friss epizódok kategóriákba szervezve." },
    { kind: "szemelyek", href: "/szemelyek", label: "Személyek", blurb: "Vendégek és említett közéleti szereplők profiljai." },
    { kind: "szervezetek", href: "/szervezetek", label: "Szervezetek", blurb: "Cégek, médiumok, intézmények említései." },
    { kind: "partok", href: "/partok", label: "Pártok", blurb: "Magyar politikai pártok a podcastekben." },
    { kind: "temak", href: "/temak", label: "Témák", blurb: "Politika, gazdaság, AI, kultúra és további témakörök." },
  ];
  const others = all.filter((x) => x.kind !== current && !(current === "cegek" && x.kind === "szervezetek"));
  const items = others.map((o) => `<li><a href="${esc(o.href)}"><strong>${esc(o.label)}</strong></a> — ${esc(o.blurb)}</li>`).join("");
  return `<aside aria-label="További felfedezés"><h2>Tovább a Podiverzumban</h2><ul>${items}</ul></aside>`;
}

function hubFaq(kind: HubKind): Record<string, unknown> {
  const faqMap: Record<string, Array<{ q: string; a: string }>> = {
    podcastok: [
      { q: "Mi az a Podiverzum?", a: "A Podiverzum a teljes magyar podcast-világot indexelő kereső és felfedező felület. Minden epizódhoz AI-összefoglalót, említett személyeket, szervezeteket és témákat társítunk, hogy gyorsan megtaláld, amit keresel." },
      { q: "Hány magyar podcast van a Podiverzumban?", a: "Több mint 1 400 aktív magyar podcastet és 130 000+ epizódot indexelünk. Az aktív műsorokat rang szerint rendezzük, így a legjobbak előre kerülnek." },
      { q: "Ingyenes a Podiverzum?", a: "Igen, a Podiverzum teljesen ingyenes és regisztráció nélkül használható. Csak nyisd meg, keress vagy böngéssz." },
    ],
    szemelyek: [
      { q: "Kik szerepelnek a Személyek listán?", a: "Magyar közéleti szereplők, vendégek, vállalkozók, művészek, sportolók, szakértők — mindenki, akit a magyar podcastek vendégül látnak vagy említenek. Minden személynél megtalálod, mely epizódokban szerepel." },
      { q: "Honnan tudjátok, kit említenek?", a: "AI-modellek elemzik az epizódok címét, leírását és transkriptjét, majd kanonikus személyprofilokhoz kötik az említéseket. A nagyobb közéleti szereplőknél Wikipedia-megerősítéssel is dolgozunk." },
    ],
    szervezetek: [
      { q: "Milyen szervezetek vannak indexelve?", a: "Cégek, médiumok, intézmények, sportcsapatok, egyetemek, civil szervezetek és NGO-k — minden olyan szervezet, amelyet legalább három magyar podcast epizód említ." },
      { q: "Mit látok egy szervezet oldalán?", a: "A szervezet rövid bemutatóját (gyakran Wikipedia-forrásból), a kapcsolódó epizódokat és a műsorokat, amelyek a leggyakrabban beszélnek róla." },
    ],
    cegek: [
      { q: "Milyen szervezetek vannak indexelve?", a: "Cégek, médiumok, intézmények, sportcsapatok, egyetemek, civil szervezetek és NGO-k — minden olyan szervezet, amelyet legalább három magyar podcast epizód említ." },
    ],
    partok: [
      { q: "Mely pártok szerepelnek?", a: "Minden parlamenti és parlamenten kívüli releváns magyar párt — Fidesz, Tisza, KDNP, DK, MSZP, Momentum, Jobbik, Mi Hazánk, LMP, Párbeszéd, Kutyapárt, Munkáspárt és továbbiak." },
      { q: "Milyen kontextusban mutatjátok a pártokat?", a: "Pártonként megtalálod a friss említéseket a magyar podcast-világból, az epizódok kontextusát és azokat a műsorokat, amelyek a legtöbbet foglalkoznak az adott párttal." },
    ],
    temak: [
      { q: "Hogyan készülnek a témák?", a: "AI-elemzés bontja az epizódokat témákra: politika, gazdaság, AI, sport, kultúra, egészség és sok más. Minden téma külön oldalán a legrelevánsabb epizódok, vendégek és műsorok jelennek meg." },
      { q: "Találok-e új témákat?", a: "Igen — a rendszer folyamatosan tanul az új epizódokból, és új témajelölteket emelünk be, amint elég epizód kapcsolódik hozzájuk." },
    ],
  };
  const faqs = faqMap[kind] ?? [];
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question", name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

function hubFaqHtml(kind: HubKind): string {
  const faqMap: Record<string, Array<{ q: string; a: string }>> = (hubFaq as any)._cache ?? {};
  // Re-derive from hubFaq for HTML rendering
  const json = hubFaq(kind) as { mainEntity?: Array<{ name: string; acceptedAnswer: { text: string } }> };
  const items = (json.mainEntity ?? []).map((f) => `<details><summary><strong>${esc(f.name)}</strong></summary><p>${esc(f.acceptedAnswer.text)}</p></details>`).join("");
  if (!items) return "";
  return `<section aria-label="Gyakori kérdések"><h2>Gyakori kérdések</h2>${items}</section>`;
}

async function buildHub(supabase: ReturnType<typeof createClient>, kind: HubKind) {
  const canonical = `${SITE}/${kind === "cegek" ? "szervezetek" : kind}`;

  if (kind === "podcastok") {
    const { data } = await (supabase as any)
      .from("podcasts")
      .select("title, display_title, slug, summary, description, image_url, category, podiverzum_rank, rank_label")
      .eq("language_decision", "accept_hungarian")
      .eq("rss_status", "active")
      .order("podiverzum_rank", { ascending: false })
      .order("title", { ascending: true })
      .limit(80);
    const rows = (data ?? []) as Array<Record<string, any>>;
    const title = "Magyar podcastek listája — Podiverzum";
    const desc = "Fedezd fel a legjobb magyar podcasteket. Aktív műsorok, friss epizódok, AI-összefoglalókkal.";
    const intro = `<p>A <strong>Podiverzum</strong> a teljes magyar podcast-világot egy helyre gyűjti — több mint <strong>1 400 aktív magyar podcastet</strong> és <strong>130 000+ epizódot</strong> indexelünk folyamatosan. Az alábbi listán a legaktívabb ${rows.length} műsor szerepel, minőségi rangsor szerint.</p>
<p>Minden epizódhoz <strong>AI-összefoglalót</strong> készítünk magyarul, kiemeljük az említett <a href="/szemelyek">személyeket</a> és <a href="/szervezetek">szervezeteket</a>, és témakörökbe rendezzük a tartalmat — politika, gazdaság, AI, sport, kultúra, egészség. Lásd a teljes <a href="/temak">témalistát</a>.</p>
<p>A magyar podcastek között megtalálod a legnagyobb hírműsorokat, beszélgetős és interjú-podcasteket, üzleti és tech-műsorokat, kulturális és lifestyle-tartalmakat. A keresőnk nem csak címekre keres — a teljes epizód-tartalomban, az említett személyek és témák szintjén is megtalálja, amit szeretnél hallani.</p>`;
    const listHtml = rows.map((p) => {
      const u = `${SITE}/podcast/${p.slug}`;
      const s = truncate(stripHtml(p.summary || p.description), 200);
      return `<li><a href="${esc(u)}"><strong>${esc(p.display_title || p.title)}</strong></a>${p.category ? ` <em>· ${esc(p.category)}</em>` : ""}${s ? `<p>${esc(s)}</p>` : ""}</li>`;
    }).join("");
    const itemList = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: title,
      itemListElement: rows.map((p, i) => ({
        "@type": "ListItem", position: i + 1,
        url: `${SITE}/podcast/${p.slug}`, name: p.display_title || p.title,
      })),
    };
    return new Response(new TextEncoder().encode(shell({
      title, description: desc, canonical, jsonLd: [itemList, hubFaq(kind)],
      bodyHtml: `<header><h1>Magyar podcastek</h1>${intro}</header>
<main><h2>Aktív magyar podcastek (${rows.length})</h2><ul>${listHtml}</ul></main>
${hubFaqHtml(kind)}
${hubCrossLinks(kind)}`,
    })), { headers: new Headers(baseHeaders) });
  }

  if (kind === "szemelyek") {
    const { data } = await (supabase as any)
      .from("people")
      .select("name, slug, short_bio, short_description_hu, image_url, gated_episode_count, episode_count, is_public, is_indexable, activation_status, ai_recommended_action, ai_review_status, identity_status, identity_ambiguous, manual_approved, wikipedia_match_status, wikipedia_match_confidence, is_deceased, is_historical, has_archival_evidence, persona, is_topic_only, date_of_death, is_living, participant_count, host_count, guest_count")
      .eq("is_public", true)
      .eq("is_indexable", true)
      .in("activation_status", ["indexable", "manual_approved"])
      .gt("gated_episode_count", 0)
      .order("gated_episode_count", { ascending: false })
      .limit(160);
    const rows = ((data ?? []) as Array<Record<string, any>>)
      .filter(isSafePublicPerson)
      .slice(0, 120);
    const title = "Személyek magyar podcastokban — Podiverzum";
    const desc = "Magyar közélet, üzlet és kultúra szereplői, megszólalók és gyakran említett nevek. Kikről beszélnek a leggyakrabban a magyar podcastek?";
    const intro = `<p>A <strong>Podiverzum</strong> több mint <strong>${rows.length}+ személyt</strong> indexel a magyar podcast-világból: megszólalókat, említett közéleti szereplőket, vállalkozókat, művészeket, sportolókat, tudósokat és szakértőket. Minden személynél megtalálod, mely epizódok kapcsolódnak hozzá — kontextussal és AI-összefoglalókkal.</p>
<p>A személyek mögött <strong>Wikipedia-megerősítés</strong> és AI-elemzés áll: egyértelműen azonosítjuk a közéleti szereplőket, így nem keverednek össze a hasonló nevű személyek. Politikusoknál külön jelöljük a parlamenti szerepet és párthovatartozást — lásd a <a href="/partok">Pártok</a> hubot. Üzletembereknél a kapcsolódó <a href="/szervezetek">cégeket és intézményeket</a> is feltüntetjük.</p>
<p>Ha kíváncsi vagy, mely podcastokban kapcsolódik valaki az elmúlt időszak témáihoz, mely műsorokban szólalt meg, vagy milyen <a href="/temak">témákban</a> említették — itt egy kattintással mindezt megtalálod. A lista az említések és szerepeltetések száma szerint csökkenő sorrendben mutatja a legaktívabb szereplőket.</p>`;
    const listHtml = rows.map((p) => {
      const u = `${SITE}/szemelyek/${p.slug}`;
      const bio = truncate(stripHtml(p.short_description_hu || p.short_bio), 160);
      return `<li><a href="${esc(u)}"><strong>${esc(p.name)}</strong></a>${p.gated_episode_count ? ` <em>· ${p.gated_episode_count} epizód</em>` : ""}${bio ? `<p>${esc(bio)}</p>` : ""}</li>`;
    }).join("");
    const itemList = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: title,
      itemListElement: rows.map((p, i) => ({
        "@type": "ListItem", position: i + 1,
        url: `${SITE}/szemelyek/${p.slug}`, name: p.name,
      })),
    };
    return new Response(new TextEncoder().encode(shell({
      title, description: desc, canonical, jsonLd: [itemList, hubFaq(kind)],
      bodyHtml: `<header><h1>Személyek a magyar podcastekben</h1>${intro}</header>
<main><h2>Top ${rows.length} említett személy</h2><ul>${listHtml}</ul></main>
${hubFaqHtml(kind)}
${hubCrossLinks(kind)}`,
    })), { headers: new Headers(baseHeaders) });
  }

  if (kind === "szervezetek" || kind === "cegek") {
    const { data } = await (supabase as any)
      .from("organizations")
      .select("name, slug, org_type, logo_url, wikipedia_extract, gated_episode_count")
      .eq("is_indexable", true)
      .neq("org_type", "party")
      .gt("gated_episode_count", 0)
      .order("gated_episode_count", { ascending: false })
      .limit(150);
    const rows = (data ?? []) as Array<Record<string, any>>;
    const title = "Szervezetek és cégek — Podiverzum";
    const desc = "Cégek, intézmények, médiumok, sportcsapatok, egyetemek, NGO-k — mind, amelyeket a magyar podcastek említenek.";
    const intro = `<p>A <strong>Podiverzum</strong> ${rows.length}+ szervezetet indexel a magyar podcast-világból: vállalatokat, médiumokat, állami és önkormányzati intézményeket, sportcsapatokat, egyetemeket, civil szervezeteket és NGO-kat. Minden szervezethez megtalálod a friss említéseket, a kapcsolódó <a href="/szemelyek">személyeket</a> és a leginkább érintett <a href="/toplista">műsorokat</a>.</p>
<p>A szervezetek nagy részénél <strong>Wikipedia-megerősítéssel</strong> és típus-besorolással dolgozunk (cég, média, sportcsapat, oktatási intézmény, NGO stb.), így gyorsan szűrhetsz arra, ami valóban érdekel. Ha egy adott szektor — magyar fintech, hazai egyetemek, sportklubok vagy közmédia — érdekel, néhány kattintással átfogó képet kapsz arról, mit beszélnek róluk a magyar podcastek.</p>
<p>A politikai pártokat külön oldalon mutatjuk: lásd a <a href="/partok">Pártok</a> hubot a teljes listához. Témánkénti bontásért látogasd meg a <a href="/temak">Témák</a> hubot.</p>`;
    const listHtml = rows.map((o) => {
      const u = `${SITE}/ceg/${o.slug}`;
      const bio = truncate(stripHtml(o.wikipedia_extract), 160);
      return `<li><a href="${esc(u)}"><strong>${esc(o.name)}</strong></a>${o.org_type ? ` <em>· ${esc(o.org_type)}</em>` : ""}${o.gated_episode_count ? ` <em>· ${o.gated_episode_count} epizód</em>` : ""}${bio ? `<p>${esc(bio)}</p>` : ""}</li>`;
    }).join("");
    const itemList = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: title,
      itemListElement: rows.map((o, i) => ({
        "@type": "ListItem", position: i + 1,
        url: `${SITE}/ceg/${o.slug}`, name: o.name,
      })),
    };
    return new Response(new TextEncoder().encode(shell({
      title, description: desc, canonical, jsonLd: [itemList, hubFaq(kind)],
      bodyHtml: `<header><h1>Szervezetek a magyar podcastekben</h1>${intro}</header>
<main><h2>Top ${rows.length} említett szervezet</h2><ul>${listHtml}</ul></main>
${hubFaqHtml(kind)}
${hubCrossLinks(kind)}`,
    })), { headers: new Headers(baseHeaders) });
  }

  if (kind === "partok") {
    const { data } = await (supabase as any)
      .from("organizations")
      .select("name, slug, logo_url, political_color, wikipedia_extract, gated_episode_count")
      .eq("is_indexable", true)
      .eq("org_type", "party")
      .order("gated_episode_count", { ascending: false })
      .limit(50);
    const rows = (data ?? []) as Array<Record<string, any>>;
    const title = "Magyar pártok podcastekben — Podiverzum";
    const desc = "Magyar politikai pártok említései és szereplései a magyar podcastekben — Fidesz, Tisza, DK, Momentum, és társaik.";
    const intro = `<p>A magyar közélet pártjai a podcastek tükrében. A <strong>Podiverzum</strong> ${rows.length} pártot indexel — minden parlamenti és parlamenten kívüli releváns magyar pártot. Pártonként megtalálod, mely epizódokban, milyen kontextusban beszéltek róluk az elmúlt időszakban.</p>
<p>A párt-oldalakon nem csak a friss említéseket látod, hanem azt is, mely <a href="/toplista">műsorok</a> foglalkoznak vele rendszeresen, mely <a href="/szemelyek">közéleti szereplők</a> jelennek meg pártképviselőként vagy elemzőként, és milyen <a href="/temak">témák</a> kapcsolódnak hozzá — például választási kampány, gazdaságpolitika, EU-ügyek vagy belpolitikai konfliktusok.</p>
<p>Ha egy adott politikai téma — gazdaságpolitika, jogállamiság, választás, EU-tagság, energiapolitika — érdekel, érdemes a <a href="/temak">Témák</a> hubon is körülnézned. A pártokon túl a kapcsolódó <a href="/szervezetek">intézményeket és médiumokat</a> külön szekcióban gyűjtjük.</p>`;
    const listHtml = rows.map((o) => {
      const u = `${SITE}/ceg/${o.slug}`;
      const bio = truncate(stripHtml(o.wikipedia_extract), 200);
      return `<li><a href="${esc(u)}"><strong>${esc(o.name)}</strong></a>${o.gated_episode_count ? ` <em>· ${o.gated_episode_count} epizód</em>` : ""}${bio ? `<p>${esc(bio)}</p>` : ""}</li>`;
    }).join("");
    const itemList = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: title,
      itemListElement: rows.map((o, i) => ({
        "@type": "ListItem", position: i + 1,
        url: `${SITE}/ceg/${o.slug}`, name: o.name,
      })),
    };
    return new Response(new TextEncoder().encode(shell({
      title, description: desc, canonical, jsonLd: [itemList, hubFaq(kind)],
      bodyHtml: `<header><h1>Magyar pártok a podcastekben</h1>${intro}</header>
<main><h2>Pártok (${rows.length})</h2><ul>${listHtml}</ul></main>
${hubFaqHtml(kind)}
${hubCrossLinks(kind)}`,
    })), { headers: new Headers(baseHeaders) });
  }

  if (kind === "temak") {
    const { data } = await (supabase as any)
      .from("topics")
      .select("name, slug, short_name, description, intro_text, episode_count")
      .eq("is_public", true)
      .gt("episode_count", 0)
      .order("episode_count", { ascending: false })
      .limit(80);
    const rows = (data ?? []) as Array<Record<string, any>>;
    const title = "Témák — Podiverzum";
    const desc = "Magyar podcast témák és kategóriák — politika, gazdaság, AI, sport, kultúra, egészség és minden más, amiről a magyar podcastek beszélnek.";
    const intro = `<p>A <strong>Podiverzum</strong> ${rows.length} témát indexel a magyar podcast-világból — politika, gazdaság, technológia, AI, sport, kultúra, egészség, oktatás, tudomány, lifestyle és minden más, ami foglalkoztatja a hazai hallgatókat. Minden témánál megtalálod a legrelevánsabb epizódokat, a leggyakrabban szereplő <a href="/szemelyek">vendégeket</a> és a téma köré szerveződő <a href="/toplista">műsorokat</a>.</p>
<p>A témákat <strong>AI-elemzés</strong> azonosítja az epizódok tartalmából: nem csak címszavakat keresünk, hanem a teljes szövegkörnyezetet figyelembe vesszük. Így pontosan megtalálod például az "infláció", "mesterséges intelligencia", "magyar foci", "klímaváltozás" vagy "vállalkozói történetek" témákat — még akkor is, ha az epizód címe nem említi szó szerint.</p>
<p>Politikai vagy közéleti témák érdekelnek? Nézd meg a <a href="/partok">Pártok</a> hubot a párt-szintű bontásért, vagy a <a href="/szervezetek">Szervezetek</a> hubot az intézmények és médiumok említéseiért.</p>`;
    const listHtml = rows.map((t) => {
      const u = `${SITE}/temak/${t.slug}`;
      const intro2 = truncate(stripHtml(t.intro_text || t.description), 180);
      return `<li><a href="${esc(u)}"><strong>${esc(t.name)}</strong></a>${t.episode_count ? ` <em>· ${t.episode_count} epizód</em>` : ""}${intro2 ? `<p>${esc(intro2)}</p>` : ""}</li>`;
    }).join("");
    const itemList = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: title,
      itemListElement: rows.map((t, i) => ({
        "@type": "ListItem", position: i + 1,
        url: `${SITE}/temak/${t.slug}`, name: t.name,
      })),
    };
    return new Response(new TextEncoder().encode(shell({
      title, description: desc, canonical, jsonLd: [itemList, hubFaq(kind)],
      bodyHtml: `<header><h1>Témák a magyar podcastekben</h1>${intro}</header>
<main><h2>Top ${rows.length} téma</h2><ul>${listHtml}</ul></main>
${hubFaqHtml(kind)}
${hubCrossLinks(kind)}`,
    })), { headers: new Headers(baseHeaders) });
  }

  return null;
}

// ---------- Wave 3: long-tail aggregation builders ----------
// Each route requires a minimum episode count to qualify as a real landing page;
// otherwise we return null so the worker can fall back to origin (avoids thin content).

const LONGTAIL_MIN_EPISODES = 3;

function yearBounds(year: number): { from: string; to: string } {
  return {
    from: `${year}-01-01T00:00:00Z`,
    to: `${year + 1}-01-01T00:00:00Z`,
  };
}

function looksLikeYear(s: string): number | null {
  if (!/^\d{4}$/.test(s)) return null;
  const y = Number(s);
  const now = new Date().getUTCFullYear();
  if (y < 2010 || y > now + 1) return null;
  return y;
}

// /temak/:topic/:year — topic episodes filtered to a year.
async function buildTopicYear(
  supabase: ReturnType<typeof createClient>,
  topicSlug: string,
  year: number,
) {
  const { data: topic } = await (supabase as any)
    .from("topics")
    .select("id, name, slug, description, intro_text, is_public")
    .eq("slug", topicSlug).maybeSingle();
  if (!topic || topic.is_public === false) return null;

  const { from, to } = yearBounds(year);
  const { data: rows } = await (supabase as any)
    .from("episode_topic_map")
    .select(`episode_id, confidence, episodes!inner(title, display_title, slug, published_at, ai_summary, podcast:podcasts!inner(title, display_title, slug, image_url, language_decision))`)
    .eq("topic_id", topic.id)
    .gte("episodes.published_at", from)
    .lt("episodes.published_at", to)
    .order("confidence", { ascending: false })
    .limit(200);

  const eps = ((rows ?? []) as Array<any>)
    .map((r) => r.episodes)
    .filter((e) => e && isAcceptedHungarianPrerenderPodcast(e.podcast))
    .slice(0, 50);
  if (eps.length < LONGTAIL_MIN_EPISODES) return null;

  const canonical = `${SITE}/temak/${topicSlug}/${year}`;
  const title = `${topic.name} ${year} — epizódok a Podiverzumon`;
  const desc = truncate(`Magyar podcast epizódok ${year}-ban ${topic.name} témakörben. ${eps.length} releváns epizód AI-összefoglalókkal.`, 160);
  const ogImage = eps[0]?.podcast?.image_url ?? null;

  const html = eps.map((e) => {
    const u = `${SITE}/podcast/${e.podcast.slug}/${e.slug}`;
    const s = truncate(stripHtml(e.ai_summary), 200);
    return `<li><a href="${u}"><strong>${esc(e.display_title || e.title)}</strong></a> — <em>${esc(e.podcast.display_title || e.podcast.title)}</em>${e.published_at ? ` <time datetime="${esc(e.published_at)}">${esc(e.published_at.slice(0,10))}</time>` : ""}${s ? `<p>${esc(s)}</p>` : ""}</li>`;
  }).join("");

  const itemList = {
    "@context": "https://schema.org", "@type": "ItemList", name: title,
    itemListElement: eps.map((e, i) => ({
      "@type": "ListItem", position: i + 1,
      url: `${SITE}/podcast/${e.podcast.slug}/${e.slug}`,
      name: e.display_title || e.title,
    })),
  };
  const breadcrumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Témák", item: `${SITE}/temak` },
      { "@type": "ListItem", position: 2, name: topic.name, item: `${SITE}/temak/${topicSlug}` },
      { "@type": "ListItem", position: 3, name: String(year), item: canonical },
    ],
  };

  return new Response(new TextEncoder().encode(shell({
    title, description: desc, canonical, ogImage, jsonLd: [itemList, breadcrumbs],
    bodyHtml: `<header><h1>${esc(topic.name)} — ${year}</h1>
<p>${eps.length} magyar podcast epizód <strong>${year}</strong>-ban a <a href="/temak/${esc(topicSlug)}">${esc(topic.name)}</a> témakörben. A lista relevancia szerint van rendezve, minden epizódhoz AI-összefoglalót talál.</p></header>
<main><h2>Epizódok</h2><ul>${html}</ul></main>
<aside><h2>Tovább</h2><ul>
<li><a href="/temak/${esc(topicSlug)}">${esc(topic.name)} — összes epizód</a></li>
<li><a href="/temak">Témák hub</a></li>
</ul></aside>`,
  })), { headers: new Headers(baseHeaders) });
}

// /podcast/:slug/epizodok/:year — podcast episodes in a year.
async function buildPodcastYear(
  supabase: ReturnType<typeof createClient>,
  podcastSlug: string,
  year: number,
) {
  const { data: pod } = await supabase
    .from("podcasts")
    .select("id, title, display_title, slug, description, summary, image_url, language, language_decision, rss_status")
    .eq("slug", podcastSlug).maybeSingle();
  if (!pod || !isAcceptedHungarianPrerenderPodcast(pod)) return null;

  const { from, to } = yearBounds(year);
  const { data } = await supabase
    .from("episodes")
    .select("id, title, display_title, slug, published_at, ai_summary, summary, description")
    .eq("podcast_id", pod.id)
    .gte("published_at", from)
    .lt("published_at", to)
    .order("published_at", { ascending: false })
    .limit(200);
  const eps = (data ?? []) as Array<Record<string, any>>;
  if (eps.length < LONGTAIL_MIN_EPISODES) return null;

  const cleanByEpisode = new Map<string, string>();
  for (let i = 0; i < eps.length; i += 100) {
    const ids = eps.slice(i, i + 100).map((e) => e.id).filter(Boolean);
    if (!ids.length) continue;
    const { data: cleanRows } = await supabase
      .from("episode_clean_text")
      .select("episode_id,cleaned_text")
      .in("episode_id", ids)
      .like("cleaner_method", "deterministic_v4%");
    for (const r of cleanRows || []) cleanByEpisode.set((r as any).episode_id, (r as any).cleaned_text || "");
  }

  const canonical = `${SITE}/podcast/${podcastSlug}/epizodok/${year}`;
  const podTitle = pod.display_title || pod.title;
  const title = `${podTitle} epizódok ${year} — Podiverzum`;
  const desc = truncate(`${podTitle} ${year}-ben megjelent ${eps.length} epizódja kronologikusan, AI-összefoglalókkal.`, 160);

  const html = eps.map((e) => {
    const u = `${SITE}/podcast/${podcastSlug}/${e.slug}`;
    const cleanText = cleanByEpisode.get(e.id) || "";
    const s = truncate(stripHtml(e.ai_summary || e.summary) || stripHtml(cleanText) || stripHtml(e.description), 220);
    return `<li><a href="${u}"><strong>${esc(e.display_title || e.title)}</strong></a>${e.published_at ? ` <time datetime="${esc(e.published_at)}">${esc(e.published_at.slice(0,10))}</time>` : ""}${s ? `<p>${esc(s)}</p>` : ""}</li>`;
  }).join("");

  const itemList = {
    "@context": "https://schema.org", "@type": "ItemList", name: title,
    itemListElement: eps.slice(0, 50).map((e, i) => ({
      "@type": "ListItem", position: i + 1,
      url: `${SITE}/podcast/${podcastSlug}/${e.slug}`, name: e.display_title || e.title,
    })),
  };
  const breadcrumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Podcastek", item: `${SITE}/toplista` },
      { "@type": "ListItem", position: 2, name: podTitle, item: `${SITE}/podcast/${podcastSlug}` },
      { "@type": "ListItem", position: 3, name: `Epizódok ${year}`, item: canonical },
    ],
  };

  return new Response(new TextEncoder().encode(shell({
    title, description: desc, canonical, ogImage: pod.image_url, jsonLd: [itemList, breadcrumbs],
    bodyHtml: `<header><h1>${esc(podTitle)} — ${year}-es epizódok</h1>
<p>A <a href="/podcast/${esc(podcastSlug)}">${esc(podTitle)}</a> ${year}-ben ${eps.length} epizódot tett közzé. Az alábbi lista kronologikus sorrendben tartalmazza mind az epizódot, AI-összefoglalóval.</p></header>
<main><h2>Epizódok</h2><ul>${html}</ul></main>
<aside><h2>Tovább</h2><ul>
<li><a href="/podcast/${esc(podcastSlug)}">${esc(podTitle)} — főoldal</a></li>
<li><a href="/toplista">Podcastek hub</a></li>
</ul></aside>`,
  })), { headers: new Headers(baseHeaders) });
}

// /szemelyek/:slug/temak/:topic — episodes mentioning a person within a topic.
async function buildPersonTopic(
  supabase: ReturnType<typeof createClient>,
  personSlug: string,
  topicSlug: string,
) {
  const { data: person } = await (supabase as any)
    .from("people")
    .select("id, name, slug, image_url, ai_bio, short_bio, identity_ambiguous, manual_approved, wikipedia_match_status, wikipedia_match_confidence, is_public, is_indexable, activation_status, ai_recommended_action, ai_review_status, identity_status, is_deceased, is_historical, has_archival_evidence, persona, is_topic_only, date_of_death, is_living, participant_count, host_count, guest_count, gated_episode_count, episode_count")
    .eq("slug", personSlug).maybeSingle();
  if (!person || !isSafePublicPerson(person)) return null;
  const { data: topic } = await (supabase as any)
    .from("topics")
    .select("id, name, slug, is_public")
    .eq("slug", topicSlug).maybeSingle();
  if (!topic || topic.is_public === false) return null;

  // Fetch topic episodes (with podcast join) first — bounded by topic relevance.
  const { data: tRows } = await (supabase as any)
    .from("episode_topic_map")
    .select(`episode_id, confidence, episodes!inner(id, title, display_title, slug, published_at, ai_summary, podcast:podcasts!inner(title, display_title, slug, image_url, language_decision))`)
    .eq("topic_id", topic.id)
    .order("confidence", { ascending: false })
    .limit(500);
  const topicEps = ((tRows ?? []) as Array<any>)
    .map((r) => r.episodes)
    .filter((e) => e && isAcceptedHungarianPrerenderPodcast(e.podcast));
  if (topicEps.length === 0) return null;
  const topicEpIds = topicEps.map((e) => e.id);

  // Intersect with person mentions: query person_episode_mentions restricted to those ids.
  const { data: mRows } = await (supabase as any)
    .from("person_episode_mentions")
    .select("episode_id")
    .eq("person_id", person.id)
    .in("episode_id", topicEpIds.slice(0, 500));
  const matchedSet = new Set(((mRows ?? []) as Array<any>).map((r) => r.episode_id));
  const eps = topicEps.filter((e) => matchedSet.has(e.id)).slice(0, 40);
  if (eps.length < LONGTAIL_MIN_EPISODES) return null;

  const canonical = `${SITE}/szemelyek/${personSlug}/temak/${topicSlug}`;
  const title = `${person.name} a ${topic.name} témában — Podiverzum`;
  const desc = truncate(`${eps.length} magyar podcast epizód, amelyben ${person.name} a ${topic.name} témáról beszél vagy említik. AI-összefoglalókkal.`, 160);

  const html = eps.map((e) => {
    const u = `${SITE}/podcast/${e.podcast.slug}/${e.slug}`;
    const s = truncate(stripHtml(e.ai_summary), 220);
    return `<li><a href="${u}"><strong>${esc(e.display_title || e.title)}</strong></a> — <em>${esc(e.podcast.display_title || e.podcast.title)}</em>${s ? `<p>${esc(s)}</p>` : ""}</li>`;
  }).join("");

  const breadcrumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Személyek", item: `${SITE}/szemelyek` },
      { "@type": "ListItem", position: 2, name: person.name, item: `${SITE}/szemelyek/${personSlug}` },
      { "@type": "ListItem", position: 3, name: topic.name, item: canonical },
    ],
  };
  const itemList = {
    "@context": "https://schema.org", "@type": "ItemList", name: title,
    itemListElement: eps.map((e, i) => ({
      "@type": "ListItem", position: i + 1,
      url: `${SITE}/podcast/${e.podcast.slug}/${e.slug}`, name: e.display_title || e.title,
    })),
  };
  const safeImage = safePersonImageForPrerender(person);

  return new Response(new TextEncoder().encode(shell({
    title, description: desc, canonical, ogImage: safeImage, jsonLd: [itemList, breadcrumbs],
    bodyHtml: `<header><h1>${esc(person.name)} — ${esc(topic.name)}</h1>
<p>${eps.length} epizód, amelyben <a href="/szemelyek/${esc(personSlug)}">${esc(person.name)}</a> a <a href="/temak/${esc(topicSlug)}">${esc(topic.name)}</a> témáról beszél vagy említik. Magyar podcastek, AI-összefoglalókkal, relevancia szerint rendezve.</p></header>
<main><h2>Epizódok</h2><ul>${html}</ul></main>
<aside><h2>Tovább</h2><ul>
<li><a href="/szemelyek/${esc(personSlug)}">${esc(person.name)} — minden epizód</a></li>
<li><a href="/temak/${esc(topicSlug)}">${esc(topic.name)} — téma oldal</a></li>
</ul></aside>`,
  })), { headers: new Headers(baseHeaders) });
}

// /ceg/:slug/temak/:topic — episodes mentioning an organization within a topic.
async function buildOrgTopic(
  supabase: ReturnType<typeof createClient>,
  orgSlug: string,
  topicSlug: string,
) {
  const { data: org } = await (supabase as any)
    .from("organizations")
    .select("id, name, slug, logo_url, ai_bio, wikipedia_extract, is_public")
    .eq("slug", orgSlug).maybeSingle();
  if (!org || org.is_public === false) return null;
  const { data: topic } = await (supabase as any)
    .from("topics")
    .select("id, name, slug, is_public")
    .eq("slug", topicSlug).maybeSingle();
  if (!topic || topic.is_public === false) return null;

  // Same inverted strategy as person/topic.
  const { data: tRows } = await (supabase as any)
    .from("episode_topic_map")
    .select(`episode_id, confidence, episodes!inner(id, title, display_title, slug, published_at, ai_summary, podcast:podcasts!inner(title, display_title, slug, image_url, language_decision))`)
    .eq("topic_id", topic.id)
    .order("confidence", { ascending: false })
    .limit(500);
  const topicEps = ((tRows ?? []) as Array<any>)
    .map((r) => r.episodes)
    .filter((e) => e && isAcceptedHungarianPrerenderPodcast(e.podcast));
  if (topicEps.length === 0) return null;
  const topicEpIds = topicEps.map((e) => e.id);

  const { data: mRows } = await (supabase as any)
    .from("episode_organization_map")
    .select("episode_id")
    .eq("organization_id", org.id)
    .in("episode_id", topicEpIds.slice(0, 500));
  const matchedSet = new Set(((mRows ?? []) as Array<any>).map((r) => r.episode_id));
  const eps = topicEps.filter((e) => matchedSet.has(e.id)).slice(0, 40);
  if (eps.length < LONGTAIL_MIN_EPISODES) return null;

  const canonical = `${SITE}/ceg/${orgSlug}/temak/${topicSlug}`;
  const title = `${org.name} és a ${topic.name} — Podiverzum`;
  const desc = truncate(`${eps.length} magyar podcast epizód ${org.name} és ${topic.name} témakörben.`, 160);

  const html = eps.map((e) => {
    const u = `${SITE}/podcast/${e.podcast.slug}/${e.slug}`;
    const s = truncate(stripHtml(e.ai_summary), 220);
    return `<li><a href="${u}"><strong>${esc(e.display_title || e.title)}</strong></a> — <em>${esc(e.podcast.display_title || e.podcast.title)}</em>${s ? `<p>${esc(s)}</p>` : ""}</li>`;
  }).join("");

  const breadcrumbs = {
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Szervezetek", item: `${SITE}/szervezetek` },
      { "@type": "ListItem", position: 2, name: org.name, item: `${SITE}/ceg/${orgSlug}` },
      { "@type": "ListItem", position: 3, name: topic.name, item: canonical },
    ],
  };
  const itemList = {
    "@context": "https://schema.org", "@type": "ItemList", name: title,
    itemListElement: eps.map((e, i) => ({
      "@type": "ListItem", position: i + 1,
      url: `${SITE}/podcast/${e.podcast.slug}/${e.slug}`, name: e.display_title || e.title,
    })),
  };

  return new Response(new TextEncoder().encode(shell({
    title, description: desc, canonical, ogImage: org.logo_url, jsonLd: [itemList, breadcrumbs],
    bodyHtml: `<header><h1>${esc(org.name)} — ${esc(topic.name)}</h1>
<p>${eps.length} epizód <a href="/ceg/${esc(orgSlug)}">${esc(org.name)}</a> és <a href="/temak/${esc(topicSlug)}">${esc(topic.name)}</a> kapcsolatáról. Magyar podcastek, AI-összefoglalókkal.</p></header>
<main><h2>Epizódok</h2><ul>${html}</ul></main>
<aside><h2>Tovább</h2><ul>
<li><a href="/ceg/${esc(orgSlug)}">${esc(org.name)} — főoldal</a></li>
<li><a href="/temak/${esc(topicSlug)}">${esc(topic.name)}</a></li>
</ul></aside>`,
  })), { headers: new Headers(baseHeaders) });
}

// /temak/:a-es-:b cross-topic — episodes tagged with BOTH topics.
async function buildTopicCross(
  supabase: ReturnType<typeof createClient>,
  slugA: string,
  slugB: string,
) {
  const { data: topics } = await (supabase as any)
    .from("topics")
    .select("id, name, slug, is_public")
    .in("slug", [slugA, slugB]);
  const list = (topics ?? []) as Array<any>;
  if (list.length !== 2 || list.some((t) => t.is_public === false)) return null;
  const a = list.find((t) => t.slug === slugA);
  const b = list.find((t) => t.slug === slugB);
  if (!a || !b) return null;

  const { data: aRows } = await (supabase as any)
    .from("episode_topic_map").select("episode_id").eq("topic_id", a.id).limit(3000);
  const aSet = new Set(((aRows ?? []) as Array<any>).map((r) => r.episode_id));
  if (aSet.size === 0) return null;

  const { data: bRows } = await (supabase as any)
    .from("episode_topic_map")
    .select(`episode_id, confidence, episodes!inner(title, display_title, slug, published_at, ai_summary, podcast:podcasts!inner(title, display_title, slug, image_url, language_decision))`)
    .eq("topic_id", b.id)
    .in("episode_id", Array.from(aSet).slice(0, 1500))
    .order("confidence", { ascending: false })
    .limit(120);

  const eps = ((bRows ?? []) as Array<any>)
    .map((r) => r.episodes)
    .filter((e) => e && isAcceptedHungarianPrerenderPodcast(e.podcast))
    .slice(0, 40);
  if (eps.length < LONGTAIL_MIN_EPISODES) return null;

  const canonical = `${SITE}/temak/${slugA}-es-${slugB}`;
  const title = `${a.name} és ${b.name} — közös epizódok | Podiverzum`;
  const desc = truncate(`${eps.length} magyar podcast epizód ${a.name} és ${b.name} közös témájában.`, 160);

  const html = eps.map((e) => {
    const u = `${SITE}/podcast/${e.podcast.slug}/${e.slug}`;
    const s = truncate(stripHtml(e.ai_summary), 220);
    return `<li><a href="${u}"><strong>${esc(e.display_title || e.title)}</strong></a> — <em>${esc(e.podcast.display_title || e.podcast.title)}</em>${s ? `<p>${esc(s)}</p>` : ""}</li>`;
  }).join("");

  const itemList = {
    "@context": "https://schema.org", "@type": "ItemList", name: title,
    itemListElement: eps.map((e, i) => ({
      "@type": "ListItem", position: i + 1,
      url: `${SITE}/podcast/${e.podcast.slug}/${e.slug}`, name: e.display_title || e.title,
    })),
  };

  return new Response(new TextEncoder().encode(shell({
    title, description: desc, canonical, jsonLd: [itemList],
    bodyHtml: `<header><h1>${esc(a.name)} és ${esc(b.name)}</h1>
<p>Magyar podcast epizódok, amelyek egyszerre foglalkoznak a <a href="/temak/${esc(slugA)}">${esc(a.name)}</a> és <a href="/temak/${esc(slugB)}">${esc(b.name)}</a> témákkal. Találd meg, hol találkozik a két világ.</p></header>
<main><h2>Közös epizódok (${eps.length})</h2><ul>${html}</ul></main>
<aside><h2>Tovább</h2><ul>
<li><a href="/temak/${esc(slugA)}">${esc(a.name)}</a></li>
<li><a href="/temak/${esc(slugB)}">${esc(b.name)}</a></li>
<li><a href="/temak">Összes téma</a></li>
</ul></aside>`,
  })), { headers: new Headers(baseHeaders) });
}

// ---------- share builder ----------

async function buildShare(
  supabase: ReturnType<typeof createClient>,
  slug: string,
) {
  const { data } = await (supabase as any)
    .from("te_podiverzumod_shares_public")
    .select("share_id, result_title, result_subtitle, result_description, tags")
    .eq("share_id", slug)
    .maybeSingle();
  if (!data) return null;

  const canonical = `${SITE}/hallgatoi-profil/${slug}`;
  const title = `Én ${data.result_title} lettem — Podiverzum`;
  const desc = truncate(
    stripHtml(data.result_subtitle || data.result_description || "Nézd meg, te milyen hallgató vagy a Podiverzumon."),
    160,
  );
  // Dynamic per-share OG card via og-image edge fn.
  const ogParams = new URLSearchParams({
    kind: "share",
    title: String(data.result_title || "A Te Podiverzumod"),
    subtitle: data.result_subtitle ? `A TE PODIVERZUMOD · ${String(data.result_subtitle)}` : "A TE PODIVERZUMOD",
  });
  const ogImage = `${SUPABASE_URL}/functions/v1/og-image?${ogParams.toString()}`;
  const tagsHtml = (data.tags ?? []).slice(0, 6).map((t: string) => `<li>${esc(t)}</li>`).join("");

  return new Response(new TextEncoder().encode(shell({
      title,
      description: desc,
      canonical,
      ogImage,
      jsonLd: [],
      bodyHtml: `<article>
<header><h1>Én ${esc(data.result_title)} lettem</h1>${data.result_subtitle ? `<p><em>${esc(data.result_subtitle)}</em></p>` : ""}</header>
${data.result_description ? `<section><p>${esc(stripHtml(data.result_description))}</p></section>` : ""}
${tagsHtml ? `<section><h2>Címkék</h2><ul>${tagsHtml}</ul></section>` : ""}
<section><a href="${SITE}/te-podiverzumod">Nézd meg, te milyen hallgató vagy</a></section>
</article>`,
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
  temak: "topic",
  szemely: "person",
  szemelyek: "person",
  ceg: "company",
  cegek: "company",
  szervezetek: "company",
  partok: "company",
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

    // Single-segment SEO hubs.
    if (parts.length === 1) {
      const hubs: Record<string, HubKind> = {
        podcastok: "podcastok",
        szemelyek: "szemelyek",
        szervezetek: "szervezetek",
        cegek: "cegek",
        partok: "partok",
        temak: "temak",
      };
      const hubKind = hubs[parts[0]];
      if (hubKind) {
        const r = await buildHub(supabase, hubKind);
        return r ?? notFound(path);
      }
    }

    if (parts[0] === "podcast" && parts.length === 2) {
      const r = await buildPodcast(supabase, parts[1]);
      return r ?? notFound(path);
    }
    if (parts[0] === "podcast" && parts.length === 3) {
      const r = await buildEpisode(supabase, parts[1], parts[2]);
      return r ?? notFound(path);
    }
    // Wave 3: /podcast/:slug/epizodok/:year
    if (parts[0] === "podcast" && parts.length === 4 && parts[2] === "epizodok") {
      const year = looksLikeYear(parts[3]);
      if (year) {
        const r = await buildPodcastYear(supabase, parts[1], year);
        return r ?? notFound(path);
      }
    }
    // Wave 3: /temak/:topic/:year, with legacy /tema|topic/:topic/:year fallback.
    if ((parts[0] === "temak" || parts[0] === "tema" || parts[0] === "topic") && parts.length === 3) {
      const year = looksLikeYear(parts[2]);
      if (year) {
        const r = await buildTopicYear(supabase, parts[1], year);
        return r ?? notFound(path);
      }
    }
    // Wave 3: /temak/:a-es-:b cross-topic (single segment with "-es-" separator)
    if (parts[0] === "temak" && parts.length === 2 && parts[1].includes("-es-")) {
      const [a, b] = parts[1].split("-es-");
      if (a && b && a !== b) {
        const r = await buildTopicCross(supabase, a, b);
        return r ?? notFound(path);
      }
    }
    // Wave 3: /szemelyek/:slug/temak/:topic, with legacy /szemely|person fallback.
    if ((parts[0] === "szemelyek" || parts[0] === "szemely" || parts[0] === "person") && parts.length === 4 && parts[2] === "temak") {
      const r = await buildPersonTopic(supabase, parts[1], parts[3]);
      return r ?? notFound(path);
    }
    // Wave 3: /ceg/:slug/temak/:topic, with legacy /szervezetek|company|part fallback.
    if ((parts[0] === "ceg" || parts[0] === "szervezetek" || parts[0] === "company" || parts[0] === "part") && parts.length === 4 && parts[2] === "temak") {
      const r = await buildOrgTopic(supabase, parts[1], parts[3]);
      return r ?? notFound(path);
    }
    if ((parts[0] === "category" || parts[0] === "kategoria") && parts.length === 2) {
      const r = await buildCategory(supabase, parts[1], parts[0]);
      return r ?? notFound(path);
    }
    if (parts[0] === "hangulatok" && parts.length === 2) {
      const r = await buildMoodCollection(supabase, parts[1]);
      return r ?? notFound(path);
    }
    if (parts[0] === "te-podiverzumod" && parts[1] === "eredmeny" && parts.length === 3) {
      const r = await buildShare(supabase, parts[2]);
      return r ?? notFound(path);
    }
    if (parts[0] === "hallgatoi-profil" && parts.length === 2) {
      const r = await buildShare(supabase, parts[1]);
      return r ?? notFound(path);
    }
    if (parts.length === 2) {
      const enKind = HU_TO_EN[parts[0]] ??
        (["topic", "person", "company", "ticker", "ingredient"].includes(parts[0])
          ? (parts[0] as any) : null);
      if (enKind) {
        let r: Response | null = null;
        if (enKind === "person") r = await buildPerson(supabase, parts[1], parts[0]);
        else if (enKind === "topic") r = await buildTopic(supabase, parts[1], parts[0]);
        else if (enKind === "company") r = await buildOrganization(supabase, parts[1], parts[0]);
        else r = await buildLegacyEntity(supabase, enKind as any, parts[1], parts[0]);
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
