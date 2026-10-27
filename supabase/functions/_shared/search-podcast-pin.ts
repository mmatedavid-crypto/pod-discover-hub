// Decides whether a podcast-name match is strong enough to pin that show's latest episodes on
// top of the results. A pin means "the visitor typed this show's name"; a word that merely starts
// or appears in a show title (AI → Airbag, EU → Eurovíziós, Budapest → Budapest Park,
// Gulyás → Gulyáságyú) must not hijack a topic search.

const FILLER = new Set([
  "podcast", "podcasts", "podcastek", "podcastja", "podkaszt", "show", "musor", "musora", "hivatalos", "official",
  "a", "az", "the", "radio", "tilos", "epizod", "epizodok",
]);

/** Accent-folded word tokens of a show title, without bracketed suffixes, web domains and filler words. */
export function podcastTitleCore(title: string): string[] {
  const withoutDomains = podcastTitleWords(title, true);
  // A title that is only a web address ("Ingatlan.com Podcast") keeps the address words.
  return withoutDomains.length ? withoutDomains : podcastTitleWords(title, false);
}

function podcastTitleWords(title: string, stripDomains: boolean): string[] {
  const base = String(title || "").replace(/\[[^\]]*\]|\([^)]*\)/g, " ");
  const t = (stripDomains ? base.replace(/\b\S+\.(hu|com|net|org|eu)\b/gi, " ") : base)
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
  return t.split(" ").filter((w) => w && !FILLER.has(w));
}

export function queryCore(q: string): string[] {
  return String(q || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w && !FILLER.has(w));
}

/**
 * exact / alias / slug matches always pin, and so does a partial match whose query words appear
 * as whole words in the title core (Telex → Telex After, egészség → "Itt vagyok – élet és
 * egészség"). A match that only shares characters (AI → Airbag, EU → Eurovíziós, Gulyás →
 * Gulyáságyú) never pins; it may still be offered as an unpinned candidate.
 * Measured 2026-10-27: word matches averaged top-3 precision 0.69, character-only matches 0.41.
 */
export function podcastPinAllowed(query: string, title: string, matchType: string | null | undefined): boolean {
  const m = String(matchType || "");
  if (m === "exact" || m === "alias" || m === "slug") return true;
  if (m !== "prefix" && m !== "token" && m !== "slug_prefix") return false;
  const qw = queryCore(query);
  const tw = podcastTitleCore(title);
  if (!qw.length || !tw.length) return false;
  if (qw.join(" ") === tw.join(" ")) return true;
  let at = -1;
  for (let i = 0; i + qw.length <= tw.length; i++) {
    if (qw.every((w, j) => tw[i + j] === w)) { at = i; break; }
  }
  return at >= 0;
}

function words(s: string): string[] {
  return String(s || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
}

/**
 * Catalog anchors (people, organizations, topics) match a query only on whole words: every query
 * word must appear as a contiguous whole-word run in the name. Character prefixes and infixes
 * (alma → Almási, mák → Makó / makrogazdaság, híd → Hidas) are different words.
 */
export function wordAlignedMatch(query: string, name: string): boolean {
  const q = words(query);
  const n = words(name);
  if (!q.length || !n.length || q.length > n.length) return false;
  for (let i = 0; i + q.length <= n.length; i++) {
    if (q.every((w, j) => n[i + j] === w)) return true;
  }
  return false;
}
