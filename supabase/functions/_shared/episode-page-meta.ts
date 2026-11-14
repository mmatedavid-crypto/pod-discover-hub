// Reads the publisher's own episode page meta (title, description, JSON-LD episode description) for
// person evidence. Data only: page text is never followed as instructions, never shown publicly.
import { cleanRoleField } from "./person-role-label.ts";

const decode = (s: string) => s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
const fold = (s: string) => cleanRoleField(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function metaContent(html: string, key: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:name|property)\\s*=\\s*["']${key}["'][^>]*>`, "i");
  const tag = html.match(re)?.[0];
  if (!tag) return null;
  const c = tag.match(/content\s*=\s*"([^"]*)"/i) || tag.match(/content\s*=\s*'([^']*)'/i);
  return c ? decode(c[1]).trim() : null;
}

function jsonLdDescriptions(html: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  const visit = (n: any) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    const t = ([] as string[]).concat(n["@type"] || []).join(" ");
    if (/PodcastEpisode|Episode|RadioEpisode|NewsArticle|Article|BlogPosting/.test(t)) {
      for (const k of ["description", "articleBody"]) if (typeof n[k] === "string") out.push(n[k].slice(0, 4000));
    }
    if (n["@graph"]) visit(n["@graph"]);
  };
  while ((m = re.exec(html))) { try { visit(JSON.parse(m[1])); } catch { /* invalid JSON-LD */ } }
  return out;
}

// Host-platform boilerplate that is not episode text.
const BOILERPLATE = [
  /Stream .{0,200}? by .{1,80}? on desktop and mobile\.\s*/gi,
  /Play over [\d,.]+ million tracks for free on SoundCloud\.?/gi,
  /Listen to .{0,200}? (?:on|by) .{1,80}? (?:SoundCloud|Spotify|Apple Podcasts)\.?/gi,
];
export function stripBoilerplate(s: string): string {
  let out = s;
  for (const re of BOILERPLATE) out = out.replace(re, " ");
  return out.replace(/\s+/g, " ").trim();
}

export type PageMetaStatus = "ok" | "same_as_rss" | "show_level" | "no_meta";
export function parseEpisodePageMeta(html: string, rssDescription: string | null, podcastDescription: string | null) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 400) || null;
  const parts = [metaContent(html, "og:description"), metaContent(html, "description"), metaContent(html, "twitter:description"), ...jsonLdDescriptions(html)]
    .map((x) => (x ? stripBoilerplate(x) : x))
    .filter((x): x is string => !!x && x.trim().length >= 40);
  const uniq: string[] = [];
  for (const p of parts.sort((a, b) => b.length - a.length)) if (!uniq.some((u) => fold(u).includes(fold(p)))) uniq.push(p);
  const description = uniq.join("\n").slice(0, 6000);
  if (!description) return { status: "no_meta" as PageMetaStatus, title, description: null };
  const fd = fold(description);
  if (rssDescription && fold(rssDescription).includes(fd)) return { status: "same_as_rss" as PageMetaStatus, title, description: null };
  if (podcastDescription && fold(podcastDescription).includes(fd)) return { status: "show_level" as PageMetaStatus, title, description: null };
  return { status: "ok" as PageMetaStatus, title, description };
}
