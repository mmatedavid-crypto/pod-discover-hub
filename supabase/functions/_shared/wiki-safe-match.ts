// Safe (AI-free) Wikipedia matching policy for people and organizations. Pure, no I/O.
// Owner decision 2026-10-26: apply only certain matches automatically; every doubtful case goes to
// review. A 300+300 sample showed name-only matches pick homonyms (a person who died in 1614, a
// city instead of a football club, a telex machine instead of the Telex news site).
export const WIKI_POLICY_VERSION = "wiki-safe-v1";

const STOP = new Set([
  "podcast", "adas", "epizod", "resz", "beszelgetes", "interju", "musor", "magyar", "vendeg", "vendegunk", "hogyan",
  "miert", "mikor", "kozott", "egyik", "tobb", "volt", "hogy", "vagy", "pedig", "elso", "masodik", "teljes", "uj",
  "evad", "season", "episode", "with", "about", "the", "and", "from", "this", "that", "mint", "csak", "most", "lesz",
  "januar", "februar", "marcius", "aprilis", "majus", "junius", "julius", "augusztus", "szeptember", "oktober", "november", "december",
  "budapest", "budapesti", "2020", "2021", "2022", "2023", "2024", "2025", "2026",
]);

export function wikiTokens(s: string | null | undefined): Set<string> {
  const n = String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  return new Set(n.split(/[^a-z0-9]+/).filter((t) => t.length > 3 && !STOP.has(t)));
}

// Context words shared by our public context (podcast/episode titles, mention evidence) and the
// article text, excluding the entity's own name words (those always match and prove nothing).
export function contextOverlap(context: string[], articleText: string, nameParts: string[]): string[] {
  const ctx = new Set<string>();
  for (const c of context) for (const t of wikiTokens(c)) ctx.add(t);
  const name = new Set<string>();
  for (const n of nameParts) for (const t of wikiTokens(n)) name.add(t);
  const art = wikiTokens(articleText);
  return [...ctx].filter((t) => art.has(t) && !name.has(t)).sort();
}

export type WikiPage = {
  exists: boolean; disambiguation?: boolean; title?: string; extract?: string; description?: string;
  p31?: string[]; birth?: string | null; death?: string | null; typeOk?: boolean;
};

export type Decision = { decision: "accept" | "review" | "no_article"; reason: string; confidence?: number; overlap?: string[] };

export function personDecision(p: {
  name: string; aliases?: string[]; context: string[]; sameNamePublic?: boolean; participantRoles?: number; firstParticipantAt?: string | null;
}, page: WikiPage): Decision {
  if (!page.exists) return { decision: "no_article", reason: "no_huwiki_article" };
  if (page.disambiguation) return { decision: "review", reason: "disambiguation_page" };
  if (!(page.p31 || []).includes("Q5")) return { decision: "review", reason: "article_not_a_person" };
  if (p.sameNamePublic) return { decision: "review", reason: "same_name_in_catalog" };
  if (page.death && (p.participantRoles || 0) > 0 && p.firstParticipantAt
      && Date.parse(page.death) < Date.parse(p.firstParticipantAt) - 365 * 864e5) {
    return { decision: "review", reason: "died_before_appearing_as_participant" };
  }
  const overlap = contextOverlap(p.context, `${page.description || ""} ${page.extract || ""}`, [p.name, page.title || "", ...(p.aliases || [])]);
  if (overlap.length < 2) return { decision: "review", reason: overlap.length ? "one_context_word" : "name_only", overlap };
  return { decision: "accept", reason: `exact_article+human+context(${overlap.slice(0, 5).join(",")})`, confidence: 0.9, overlap };
}

// Wikidata classes (P31/P279*) an organization type may resolve to.
export const ORG_TYPE_ROOTS: Record<string, string[]> = {
  company: ["Q43229"], institution: ["Q43229"], ngo: ["Q43229"], research: ["Q43229"], university: ["Q43229"], church: ["Q43229"],
  party: ["Q7278"],
  sport_team: ["Q12973014", "Q847017", "Q476028"],
  sport_league: ["Q623109", "Q13406554", "Q15991303", "Q1478437"],
  media: ["Q43229", "Q1002697", "Q11032", "Q35127", "Q14350", "Q1616075", "Q24634210", "Q2085381", "Q17232649"],
  radio_station: ["Q14350", "Q15265344"],
  other: ["Q43229", "Q7278"],
};
// Direct classes that are never the organization itself (person, settlement, year, disambiguation).
export const ORG_DENY_P31 = new Set(["Q5", "Q515", "Q1549591", "Q3957", "Q532", "Q486972", "Q577", "Q4167410", "Q3184121"]);

export function orgDecision(o: { name: string; orgType: string; aliases?: string[]; context: string[] }, page: WikiPage): Decision {
  if (!page.exists) return { decision: "no_article", reason: "no_huwiki_article" };
  if (page.disambiguation) return { decision: "review", reason: "disambiguation_page" };
  const p31 = page.p31 || [];
  if (p31.includes("Q5")) return { decision: "review", reason: "article_is_a_person" };
  if (p31.some((q) => ORG_DENY_P31.has(q)) || page.typeOk !== true) return { decision: "review", reason: "type_mismatch" };
  const overlap = contextOverlap(o.context, `${page.description || ""} ${page.extract || ""}`, [o.name, page.title || "", ...(o.aliases || [])]);
  // A specific organization type plus a matching Wikidata class is strong evidence; the catch-all
  // "other" type additionally needs a context word.
  if (o.orgType === "other" && overlap.length < 1) return { decision: "review", reason: "other_type_without_context", overlap };
  return { decision: "accept", reason: `exact_article+type(${o.orgType})${overlap.length ? `+context(${overlap.slice(0, 5).join(",")})` : ""}`,
    confidence: overlap.length ? 0.9 : 0.85, overlap };
}

const REUSABLE = ["cc0", "public domain", "publicdomain", "pd-", "cc by", "cc-by", "cc by-sa", "cc-by-sa", "attribution"];
const NON_FREE = ["fair use", "non-free", "nonfree", "all rights reserved"];
export function reusableLicense(short: string | null | undefined, url: string | null | undefined): boolean {
  const b = `${short || ""} ${url || ""}`.toLowerCase();
  if (!b.trim() || NON_FREE.some((h) => b.includes(h))) return false;
  return REUSABLE.some((h) => b.includes(h));
}
