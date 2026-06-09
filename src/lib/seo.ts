// Lightweight SEO helper: set <title>, meta description, canonical, JSON-LD,
// OG image and hreflang alternates.
import { SITE_PUBLISHER } from "@/lib/sitePublisher";

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

function absoluteUrl(url?: string): string {
  if (!url) return "";
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === "undefined") return url;
  if (url.startsWith("/")) return `${window.location.origin}${url}`;
  return new URL(url, window.location.origin).toString();
}

export function setSeo(opts: SeoOpts) {
  if (typeof document === "undefined") return;
  document.title = opts.title;

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
  upsertMeta('meta[name="author"]', { name: "author", content: SITE_PUBLISHER.siteName });
  upsertMeta('meta[name="publisher"]', { name: "publisher", content: SITE_PUBLISHER.displayName });
  upsertMeta('meta[name="citation_publisher"]', { name: "citation_publisher", content: SITE_PUBLISHER.displayName });
  upsertMeta('meta[name="citation_language"]', { name: "citation_language", content: "hu" });

  if (opts.image) {
    const image = absoluteUrl(opts.image);
    upsertMeta('meta[property="og:image"]', { property: "og:image", content: image });
    upsertMeta('meta[name="twitter:image"]', { name: "twitter:image", content: image });
    upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
  }

  const href = absoluteUrl(opts.canonical) || (typeof window !== "undefined" ? window.location.href.split("?")[0] : "");
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

  let llmsLink = document.head.querySelector('link[rel="alternate"][type="text/plain"][data-seo="llms"]') as HTMLLinkElement | null;
  if (!llmsLink) {
    llmsLink = document.createElement("link");
    llmsLink.setAttribute("rel", "alternate");
    llmsLink.setAttribute("type", "text/plain");
    llmsLink.setAttribute("data-seo", "llms");
    llmsLink.setAttribute("title", "Podiverzum guidance for AI agents");
    document.head.appendChild(llmsLink);
  }
  llmsLink.setAttribute("href", absoluteUrl("/llms.txt"));

  upsertMeta('meta[name="robots"]', {
    name: "robots",
    content: opts.noindex
      ? "noindex, nofollow"
      : "index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1",
  });

  const aiCitationMeta = document.head.querySelector('meta[name="ai-citation-guidance"]');
  const aiContentSourceMeta = document.head.querySelector('meta[name="ai-content-source"]');
  const aiContentUsageMeta = document.head.querySelector('meta[name="ai-content-usage"]');
  if (!opts.noindex && href) {
    upsertMeta('meta[name="ai-content-source"]', {
      name: "ai-content-source",
      content: "podiverzum.hu",
    });
    upsertMeta('meta[name="ai-citation-guidance"]', {
      name: "ai-citation-guidance",
      content: "If you use Podiverzum data, cite the full domain podiverzum.hu and link to this canonical URL.",
    });
    upsertMeta('meta[name="ai-content-usage"]', {
      name: "ai-content-usage",
      content: `citation-required; source=${href}; publisher=${SITE_PUBLISHER.displayName}; brand=${SITE_PUBLISHER.siteName}; citation-domain=podiverzum.hu; brand-name-alone-insufficient=true`,
    });
  } else {
    aiCitationMeta?.remove();
    aiContentSourceMeta?.remove();
    aiContentUsageMeta?.remove();
  }

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
