// Lightweight SEO helper: set <title>, meta description, canonical, JSON-LD,
// OG image and hreflang alternates.
type SeoOpts = {
  title: string;
  description?: string;
  canonical?: string;
  jsonLd?: Record<string, any> | Record<string, any>[];
  noindex?: boolean;
  image?: string;
  hreflang?: { lang: string; href: string }[];
  ogType?: "website" | "article";
};

export function setSeo(opts: SeoOpts) {
  if (typeof document === "undefined") return;
  document.title = opts.title.slice(0, 70);

  const upsertMeta = (selector: string, attrs: Record<string, string>) => {
    let el = document.head.querySelector(selector) as HTMLMetaElement | null;
    if (!el) {
      el = document.createElement("meta");
      Object.entries(attrs).forEach(([k, v]) => el!.setAttribute(k, v));
      document.head.appendChild(el);
    }
    Object.entries(attrs).forEach(([k, v]) => el!.setAttribute(k, v));
  };

  if (opts.description) {
    const desc = opts.description.slice(0, 160);
    upsertMeta('meta[name="description"]', { name: "description", content: desc });
    upsertMeta('meta[property="og:description"]', { property: "og:description", content: desc });
    upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: desc });
  }
  upsertMeta('meta[property="og:title"]', { property: "og:title", content: opts.title });
  upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: opts.title });
  upsertMeta('meta[property="og:type"]', { property: "og:type", content: opts.ogType || "website" });
  upsertMeta('meta[property="og:site_name"]', { property: "og:site_name", content: "Podiverzum" });
  upsertMeta('meta[property="og:locale"]', { property: "og:locale", content: "hu_HU" });

  if (opts.image) {
    upsertMeta('meta[property="og:image"]', { property: "og:image", content: opts.image });
    upsertMeta('meta[name="twitter:image"]', { name: "twitter:image", content: opts.image });
    upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
  }

  const href = opts.canonical || (typeof window !== "undefined" ? window.location.href.split("?")[0] : "");
  if (href) {
    let link = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    link.setAttribute("href", href);
    upsertMeta('meta[property="og:url"]', { property: "og:url", content: href });
  }

  upsertMeta('meta[name="robots"]', { name: "robots", content: opts.noindex ? "noindex, nofollow" : "index, follow" });

  // hreflang alternates
  document.head.querySelectorAll('link[rel="alternate"][data-seo="hreflang"]').forEach((n) => n.remove());
  const hreflangs = opts.hreflang || [];
  hreflangs.forEach(({ lang, href }) => {
    const el = document.createElement("link");
    el.setAttribute("rel", "alternate");
    el.setAttribute("hreflang", lang);
    el.setAttribute("href", href);
    el.setAttribute("data-seo", "hreflang");
    document.head.appendChild(el);
  });

  // JSON-LD
  document.head.querySelectorAll('script[data-seo="ld"]').forEach((n) => n.remove());
  if (opts.jsonLd) {
    const arr = Array.isArray(opts.jsonLd) ? opts.jsonLd : [opts.jsonLd];
    arr.forEach((obj) => {
      const s = document.createElement("script");
      s.type = "application/ld+json";
      s.dataset.seo = "ld";
      s.text = JSON.stringify(obj);
      document.head.appendChild(s);
    });
  }
}

/** Build a Podiverzum-hosted OG image URL for the given subject. */
export function ogImageUrl(params: {
  kind: "episode" | "podcast" | "site";
  title: string;
  subtitle?: string;
  image?: string | null;
}): string {
  const projectId = (import.meta as any).env?.VITE_SUPABASE_PROJECT_ID;
  if (!projectId) return "/og-image.png";
  const url = new URL(`https://${projectId}.supabase.co/functions/v1/og-image`);
  url.searchParams.set("kind", params.kind);
  url.searchParams.set("title", (params.title || "Podiverzum").slice(0, 120));
  if (params.subtitle) url.searchParams.set("subtitle", params.subtitle.slice(0, 80));
  if (params.image) url.searchParams.set("image", params.image);
  return url.toString();
}

/** Build a schema.org BreadcrumbList JSON-LD object. */
export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}
