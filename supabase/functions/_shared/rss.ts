// Robust RSS 2.0 + Atom 1.0 parser (regex-based, no external deps).
// Handles CDATA, common podcast namespaces (itunes:*, content:encoded,
// media:thumbnail, media:content), and atom <entry>/<link href=…>.
//
// Returns a normalized FeedItem[] independent of the source format.

export interface FeedItem {
  title: string;
  guid: string;
  link: string;
  published: string | null; // ISO string
  description: string;
  audio_url: string;
  image: string;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

function unwrapCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function escName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Get inner text of first matching tag (any namespace prefix). */
function getTag(xml: string, name: string): string {
  const n = escName(name);
  const re = new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${n}>`, "i");
  const m = xml.match(re);
  if (!m) return "";
  return decodeEntities(unwrapCdata(m[1])).trim();
}

/** Get a specific attribute of first matching self-closing or open tag. */
function getAttr(xml: string, name: string, attr: string): string {
  const n = escName(name);
  const a = escName(attr);
  const re = new RegExp(`<${n}\\b[^>]*\\s${a}\\s*=\\s*["']([^"']+)["']`, "i");
  const m = xml.match(re);
  return m ? m[1] : "";
}

/** atom <link rel="..." href="..."/> picker. */
function getAtomLink(xml: string, rel?: string, type?: string): string {
  const re = /<link\b([^>]*?)\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1];
    const hrefM = attrs.match(/\bhref\s*=\s*["']([^"']+)["']/i);
    if (!hrefM) continue;
    const relM = attrs.match(/\brel\s*=\s*["']([^"']+)["']/i);
    const typeM = attrs.match(/\btype\s*=\s*["']([^"']+)["']/i);
    if (rel && (relM?.[1] || "").toLowerCase() !== rel) continue;
    if (type && !(typeM?.[1] || "").toLowerCase().startsWith(type)) continue;
    return hrefM[1];
  }
  return "";
}

function toIso(d: string | null | undefined): string | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function parseChannelImage(xml: string, fallback?: string): string {
  return (
    getAttr(xml, "itunes:image", "href") ||
    getTag(xml, "url") ||
    fallback ||
    ""
  );
}

function parseRssItem(item: string, channelImage: string): FeedItem {
  const title = getTag(item, "title");
  const guid = getTag(item, "guid") || getTag(item, "id");
  const link = getTag(item, "link");
  const pub = getTag(item, "pubDate") || getTag(item, "dc:date") || getTag(item, "published");
  const desc =
    getTag(item, "content:encoded") ||
    getTag(item, "itunes:summary") ||
    getTag(item, "description") ||
    getTag(item, "summary") ||
    "";
  const audio = getAttr(item, "enclosure", "url");
  const image =
    getAttr(item, "itunes:image", "href") ||
    getAttr(item, "media:thumbnail", "url") ||
    getAttr(item, "media:content", "url") ||
    channelImage;
  return {
    title,
    guid: guid || link || "",
    link,
    published: toIso(pub),
    description: stripHtml(desc),
    audio_url: audio,
    image,
  };
}

function parseAtomEntry(entry: string, channelImage: string): FeedItem {
  const title = getTag(entry, "title");
  const guid = getTag(entry, "id");
  const link = getAtomLink(entry, "alternate") || getAtomLink(entry) || getTag(entry, "link");
  const audio = getAtomLink(entry, "enclosure", "audio") || getAttr(entry, "enclosure", "url");
  const pub = getTag(entry, "published") || getTag(entry, "updated");
  const desc = getTag(entry, "content") || getTag(entry, "summary");
  const image =
    getAttr(entry, "itunes:image", "href") ||
    getAttr(entry, "media:thumbnail", "url") ||
    channelImage;
  return {
    title,
    guid: guid || link,
    link,
    published: toIso(pub),
    description: stripHtml(desc),
    audio_url: audio,
    image,
  };
}

export function parseFeed(xml: string, fallbackImage?: string): FeedItem[] {
  const isAtom = /<feed\b[^>]*xmlns\s*=\s*["']http:\/\/www\.w3\.org\/2005\/Atom/i.test(xml) ||
                 /<feed\b[\s\S]*?<entry\b/i.test(xml);
  const channelXml = xml.split(/<item\b|<entry\b/i)[0] || "";
  const channelImage = parseChannelImage(channelXml, fallbackImage);

  if (isAtom) {
    const entries = xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || [];
    return entries.map((e) => parseAtomEntry(e, channelImage)).filter((i) => i.title);
  }
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return items.map((i) => parseRssItem(i, channelImage)).filter((i) => i.title);
}
