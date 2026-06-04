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
  duration_seconds: number | null;
}

/**
 * Parse an itunes:duration value. Accepts:
 *   - "HH:MM:SS" or "H:MM:SS"
 *   - "MM:SS" or "M:SS"
 *   - plain seconds: "3725", "3725.0"
 * Returns null if missing or unparseable.
 */
export function parseItunesDuration(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Math.round(parseFloat(s));
    return n > 0 && n < 86400 * 7 ? n : null;
  }
  const parts = s.split(":").map((p) => parseInt(p, 10));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  let secs = 0;
  if (parts.length === 3) secs = parts[0] * 3600 + parts[1] * 60 + parts[2];
  else if (parts.length === 2) secs = parts[0] * 60 + parts[1];
  else return null;
  return secs > 0 && secs < 86400 * 7 ? secs : null;
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
  const duration_seconds = parseItunesDuration(getTag(item, "itunes:duration"));
  return {
    title,
    guid: guid || link || "",
    link,
    published: toIso(pub),
    description: stripHtml(desc),
    audio_url: audio,
    image,
    duration_seconds,
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
  const duration_seconds = parseItunesDuration(getTag(entry, "itunes:duration"));
  return {
    title,
    guid: guid || link,
    link,
    published: toIso(pub),
    description: stripHtml(desc),
    audio_url: audio,
    image,
    duration_seconds,
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
