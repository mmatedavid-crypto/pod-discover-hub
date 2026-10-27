// Decides whether a podcast-name match is strong enough to pin that show's latest episodes on
// top of the results. A pin means "the visitor typed this show's name"; a word that merely starts
// or appears in a show title (AI → Airbag, EU → Eurovíziós, Budapest → Budapest Park,
// Gulyás → Gulyáságyú) must not hijack a topic search.

const FILLER = new Set([
  "podcast", "podcasts", "podcastek", "podcastja", "podkaszt", "show", "musor", "musora", "hivatalos", "official",
  "a", "az", "the", "radio", "tilos", "epizod", "epizodok",
]);

/** Accent-folded word tokens of a show title, without bracketed suffixes, publisher tails and filler words. */
export function podcastTitleCore(title: string): string[] {
  const t = String(title || "")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .split(/\s[-–|:]\s/)[0]
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
  return t.split(" ").filter((w) => w && !FILLER.has(w));
}

export function queryCore(q: string): string[] {
  return String(q || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w && !FILLER.has(w));
}

/**
 * exact / alias / slug matches always pin. A partial (prefix / token) match pins only when the
 * query's words are a whole-word contiguous run of the title core that covers at least 75% of
 * its characters, or equal the title core.
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
  if (at < 0) return false;
  const qChars = qw.join(" ").length;
  const tChars = tw.join(" ").length;
  return qChars / tChars >= 0.75;
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
