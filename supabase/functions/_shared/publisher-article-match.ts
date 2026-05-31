export type ArticleItem = {
  outlet: string;
  url: string;
  title: string;
  excerpt: string;
  text: string;
  published_at: string | null;
};

export type ArticleEpisodeRow = {
  id: string;
  podcast_id: string;
  title: string | null;
  display_title: string | null;
  description?: string | null;
  published_at: string | null;
  podcasts?: { title?: string | null; display_title?: string | null } | { title?: string | null; display_title?: string | null }[];
};

const STOPWORDS = new Set([
  "a", "az", "egy", "és", "hogy", "mit", "mi", "ez", "ezt", "de", "ha", "is", "nem", "van", "volt", "lesz",
  "podcast", "adás", "adas", "epizód", "epizod", "rész", "resz", "telex", "444", "after", "video", "videó",
]);

export function stripHtml(input: string): string {
  return String(input || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeArticleText(input: string): string {
  return String(input || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function articleTokens(input: string): string[] {
  return normalizeArticleText(input)
    .split(" ")
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

export function tokenScore(a: string, b: string) {
  const aa = new Set(articleTokens(a));
  const bb = new Set(articleTokens(b));
  if (!aa.size || !bb.size) return { score: 0, shared: [] as string[] };
  const shared = Array.from(aa).filter((t) => bb.has(t));
  return { score: shared.length / Math.max(aa.size, bb.size), shared };
}

export function articleDateScore(epDate?: string | null, articleDate?: string | null): number {
  if (!epDate || !articleDate) return 0.35;
  const diffDays = Math.abs(new Date(epDate).getTime() - new Date(articleDate).getTime()) / 86_400_000;
  if (diffDays <= 1) return 1;
  if (diffDays <= 3) return 0.82;
  if (diffDays <= 7) return 0.58;
  if (diffDays <= 14) return 0.32;
  return 0;
}

export function articlePodcastTitle(ep: ArticleEpisodeRow): string {
  const p = Array.isArray(ep.podcasts) ? ep.podcasts[0] : ep.podcasts;
  return p?.display_title || p?.title || "";
}

export function scorePublisherArticleMatch(ep: ArticleEpisodeRow, article: ArticleItem) {
  const epTitle = ep.display_title || ep.title || "";
  const articleHay = `${article.title} ${article.excerpt} ${article.text.slice(0, 1200)}`;
  const title = tokenScore(epTitle, article.title);
  const body = tokenScore(epTitle, articleHay);
  const date = articleDateScore(ep.published_at, article.published_at);
  const podcast = articlePodcastTitle(ep);
  const normalizedPodcast = normalizeArticleText(podcast);
  const podcastMention =
    normalizedPodcast.length >= 4 && normalizeArticleText(articleHay).includes(normalizedPodcast.slice(0, 24))
      ? 0.08
      : 0;
  const score = Math.min(1, title.score * 0.55 + body.score * 0.25 + date * 0.18 + podcastMention);
  const reasons = [
    title.score >= 0.45 ? "title_token_match" : null,
    body.score >= 0.35 ? "article_body_token_match" : null,
    date >= 0.82 ? "published_near_episode" : null,
    podcastMention ? "podcast_mentioned" : null,
  ].filter(Boolean) as string[];
  return { score, reasons, shared_title_tokens: title.shared, shared_body_tokens: body.shared.slice(0, 20), date_score: date };
}

function firstText(el: Element, selectors: string[]): string {
  for (const selector of selectors) {
    const value = el.querySelector(selector)?.textContent;
    if (value) return value;
  }
  for (const selector of selectors) {
    const direct = el.getElementsByTagName(selector)[0]?.textContent;
    if (direct) return direct;
  }
  return "";
}

export function parsePublisherFeed(xml: string, outlet: string): ArticleItem[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const entries = Array.from(doc.querySelectorAll("item, entry")).slice(0, 200);
  return entries.map((el) => {
    const title = stripHtml(firstText(el, ["title"]));
    const link =
      firstText(el, ["link"]).trim() ||
      el.querySelector("link[href]")?.getAttribute("href") ||
      "";
    const excerpt = stripHtml(firstText(el, ["description", "summary"]));
    const content = stripHtml(firstText(el, ["content\\:encoded", "encoded", "content"]) || excerpt);
    const dateText = firstText(el, ["pubDate", "published", "updated"]);
    const date = dateText ? new Date(dateText) : null;
    return {
      outlet,
      url: link,
      title,
      excerpt,
      text: content,
      published_at: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
    };
  }).filter((item) => item.url && item.title);
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const slug = parsed.pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(slug)
      .replace(/\.(html?|php)$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

export function parsePublisherListingHtml(html: string, outlet: string, baseUrl: string): ArticleItem[] {
  const candidates = new Set<string>();
  const base = new URL(baseUrl);
  const urlPatterns = [
    /https?:\\?\/\\?\/(?:www\.)?(?:444\.hu|telex\.hu)\\?\/[^"'<>\s\\]+/gi,
    /\bhref=["']([^"']+)["']/gi,
  ];

  for (const pattern of urlPatterns) {
    for (const match of String(html || "").matchAll(pattern)) {
      const raw = (match[1] || match[0] || "").replace(/\\\//g, "/");
      try {
        const url = new URL(raw, base);
        if (url.hostname !== base.hostname) continue;
        url.hash = "";
        url.search = "";
        const path = url.pathname;
        if (!path || path === "/" || path.startsWith("/assets") || path.startsWith("/_nuxt")) continue;
        if (!/\/20\d{2}\//.test(path) && !path.includes("podcast") && !path.includes("after")) continue;
        candidates.add(url.toString());
      } catch {
        // Ignore malformed publisher-side URLs.
      }
    }
  }

  return Array.from(candidates).slice(0, 200).map((url) => ({
    outlet,
    url,
    title: titleFromUrl(url),
    excerpt: "",
    text: "",
    published_at: null,
  })).filter((item) => item.title.length >= 8);
}
