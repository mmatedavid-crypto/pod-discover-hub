// Lightweight SEO helper: set <title>, meta description, canonical, and JSON-LD.
export function setSeo(opts: {
  title: string;
  description?: string;
  canonical?: string;
  jsonLd?: Record<string, any> | Record<string, any>[];
  noindex?: boolean;
}) {
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
  upsertMeta('meta[property="og:type"]', { property: "og:type", content: "website" });

  const href = opts.canonical || (typeof window !== "undefined" ? window.location.href.split("?")[0] : "");
  if (href) {
    let link = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.setAttribute("rel", "canonical");
      document.head.appendChild(link);
    }
    link.setAttribute("href", href);
  }

  // robots: index by default, noindex on demand
  upsertMeta('meta[name="robots"]', { name: "robots", content: (opts as any).noindex ? "noindex, nofollow" : "index, follow" });

  // Remove previous JSON-LD inserted by us, then add new one.
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
