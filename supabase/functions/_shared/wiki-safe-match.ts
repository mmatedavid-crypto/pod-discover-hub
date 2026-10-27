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

// Second pass (owner request 2026-10-27): an organization whose exact-name article was a
// disambiguation page or the wrong thing (Telex → telex machine, 444 → the year 444) gets one more
// AI-free try with the qualified titles Hungarian Wikipedia uses ("Telex.hu", "FC Barcelona") and the
// links of the disambiguation page. Each candidate must pass the same orgDecision rules; a match is
// applied only when exactly one distinct Wikidata item passes, otherwise it stays in review.
export const WIKI_RESOLVE_POLICY_VERSION = "wiki-safe-v1-resolve";
export const RESOLVABLE_REASONS = ["type_mismatch", "disambiguation_page"];

const QUALIFIERS: Record<string, string[]> = {
  media: ["{n}.hu", "{n} (hírportál)", "{n} (weboldal)", "{n} (televízióadó)", "{n} (rádióadó)", "{n} (folyóirat)", "{n} (napilap)", "{n} (újság)"],
  radio_station: ["{n} (rádióadó)", "{n} (rádió)"],
  sport_team: ["{n} FC", "FC {n}", "{n} (labdarúgóklub)", "{n} (sportegyesület)"],
  sport_league: ["{n} (sportszövetség)", "{n} (bajnokság)"],
  company: ["{n} (vállalat)", "{n} (cég)", "{n} (márka)"],
  party: ["{n} (párt)", "{n} Mozgalom"],
  institution: ["{n} (intézmény)", "{n} (szervezet)"],
  research: ["{n} (intézmény)", "{n} (szervezet)"],
  ngo: ["{n} (szervezet)", "{n} (egyesület)"],
  university: ["{n} (egyetem)"],
  church: ["{n} (egyház)"],
  other: ["{n} (szervezet)"],
};

const norm = (s: string) => String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/).filter(Boolean);

// A candidate title must carry every word of the name (a title word may extend it: Ferencváros →
// Ferencvárosi TC), so disambiguation links to unrelated people or places are never tried.
export function titleCarriesName(title: string, name: string): boolean {
  const t = norm(title.replace(/\s*\([^)]*\)\s*$/, "")), n = norm(name);
  if (!n.length || !t.length) return false;
  return n.every((w) => t.some((x) => x === w || (w.length >= 4 && x.startsWith(w))));
}

export function resolveTitles(name: string, orgType: string, rejectedTitle: string | null, disambigLinks: string[]): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    const v = t.trim();
    if (v && v !== rejectedTitle && !/egyértelműsítő/i.test(v) && !out.includes(v) && titleCarriesName(v, name)) out.push(v);
  };
  for (const q of QUALIFIERS[orgType] || QUALIFIERS.other) add(q.replace("{n}", name));
  for (const l of disambigLinks) add(l);
  return out.slice(0, 20);
}

// Exactly one distinct Wikidata item among the accepted candidates, or nothing.
export function pickUnique<T extends { qid: string | null; decision: Decision }>(cands: T[]): { pick: T | null; reason: string } {
  const ok = cands.filter((c) => c.decision.decision === "accept" && c.qid);
  const qids = [...new Set(ok.map((c) => c.qid))];
  if (qids.length === 1) return { pick: ok[0], reason: "unique_typed_candidate" };
  return { pick: null, reason: qids.length ? `ambiguous_${qids.length}_typed_candidates` : "no_typed_candidate" };
}
