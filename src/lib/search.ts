// Shared episode search: relevance scoring, semantic expansion, category scope.
// Goal: query-time Search Relevance Score, separate from Podiverzum Rank.
import { supabase } from "@/integrations/supabase/client";

export const EPISODE_SELECT =
  "id,title,slug,published_at,ai_summary,summary,description,topics,people,companies,tickers,ingredients,audio_url,podcast_id,podcasts!inner(slug,title,image_url,category,podiverzum_rank,rank_label,rss_status,language,is_hungarian,language_decision)";

// Detect a query's likely language. Returns ISO-639-1 code or null when ambiguous.
// Hungarian-specific accents OR common HU stopwords -> "hu". Basic ASCII Latin -> "en".
const HU_STOPWORDS = new Set([
  "a","az","és","is","de","hogy","nem","van","vagy","egy","ez","ezt","ezek","azok",
  "mi","mit","ki","kik","hol","mikor","miért","milyen","melyik","csak","már","még",
  "majd","így","úgy","ott","itt","most","akkor","kell","lesz","volt","lenne","minden",
  "valami","semmi","sok","kevés","nagy","kis","jó","rossz","új","régi","magyar","podcast",
]);
export function detectQueryLanguage(raw: string): "hu" | "en" | null {
  const q = (raw || "").trim().toLowerCase();
  if (!q) return null;
  if (/[áéíóöőúüű]/.test(q)) return "hu";
  const tokens = q.split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  if (!tokens.length) return null;
  for (const t of tokens) if (HU_STOPWORDS.has(t)) return "hu";
  return /^[a-z0-9 ,.\-+&]+$/.test(q) ? "en" : null;
}

// High-confidence simple synonyms — small, safe expansion.
const BUILTIN_SYNONYMS: Record<string, string[]> = {
  // Hungarian market aliases. These are intentionally high-confidence only:
  // brand/ticker/common-name variants that users actually type.
  telekom: ["Magyar Telekom", "MTELEKOM", "MTEL"],
  "magyar telekom": ["Telekom", "MTELEKOM", "MTEL"],
  mtelekom: ["Magyar Telekom", "Telekom", "MTEL"],
  mtel: ["Magyar Telekom", "Telekom", "MTELEKOM"],
  otp: ["OTP Bank", "OTP Nyrt", "bankszektor"],
  mol: ["MOL Nyrt", "olajipar", "energia"],
  richter: ["Richter Gedeon", "Gedeon Richter", "gyógyszeripar"],
  "4ig": ["4iG", "4iG Nyrt", "informatika"],
  fradi: ["FTC", "Ferencváros", "Ferencvárosi Torna Club"],
  ftc: ["Fradi", "Ferencváros", "Ferencvárosi Torna Club"],
  ferencváros: ["Fradi", "FTC", "Ferencvárosi Torna Club"],
  foci: ["labdarúgás", "futball", "magyar foci"],
  futball: ["labdarúgás", "foci", "magyar futball"],
  labdarúgás: ["foci", "futball", "magyar foci"],
  labdarugas: ["labdarúgás", "foci", "futball"],
  food: ["cooking", "cuisine"],
  italy: ["italian", "rome"],
  ai: ["artificial intelligence", "machine learning"],
  healthcare: ["health", "medical"],
  "real estate": ["property", "housing"],
  investing: ["investment", "stocks"],
  "weight loss": ["obesity", "glp-1"],
  sleep: ["insomnia", "recovery"],
  testosterone: ["hormones"],
  nvidia: ["nvda"],
  dubai: ["uae"],
  tourism: ["travel", "destination"],
  travel: ["tourism", "destination"],
  europe: ["european", "italy"],
  european: ["europe"],
  colonisation: ["colonization", "colony"],
  colonization: ["colonisation", "colony"],
  narcissistic: ["narcissist", "narcissism"],
  narcissist: ["narcissistic", "narcissism"],
  narcissism: ["narcissistic", "narcissist"],
  ballet: ["dance"],
  f1: ["formula 1", "grand prix"],
  spacex: ["space", "rocket"],
};

const TYPO_FIX: Record<string, string> = {
  balet: "ballet", narcissitic: "narcissistic", narcisistic: "narcissistic",
  narcicistic: "narcissistic", colonisation: "colonization",
  tourisim: "tourism", toursim: "tourism", europ: "europe",
  itlay: "italy", spcaex: "spacex",
  mtelekom: "mtelekom", mtel: "mtel", labdarugas: "labdarugas",
};

const PHRASE_ALIASES: Array<[RegExp, string]> = [
  [/\bformula\s*one\b/gi, "formula 1"],
  [/\bformula\s*1\b/gi, "formula 1 f1"],
  [/\bgrand\s*prix\b/gi, "formula 1 grand prix"],
  [/\bspace\s*x\b/gi, "spacex"],
];

// Curated semantic concept map — broader meaning, used only when needed.
// Cap usage to ~8 expansion terms per query.
const SEMANTIC_MAP: Record<string, string[]> = {
  productivity: ["time management", "focus", "deep work", "habits", "workflow", "procrastination", "getting things done", "goal setting"],
  longevity: ["healthspan", "aging", "lifespan", "biohacking", "preventive health", "metabolic health"],
  investing: ["stocks", "portfolio", "valuation", "capital allocation", "wealth building", "markets"],
  entrepreneurship: ["startup", "founder", "business building", "scaling", "sales", "growth"],
  relationships: ["dating", "attachment", "marriage", "communication", "breakup", "conflict", "intimacy"],
  fitness: ["training", "strength", "muscle", "hypertrophy", "recovery", "conditioning"],
  nutrition: ["diet", "protein", "weight loss", "metabolism", "glucose", "supplements"],
  ai: ["artificial intelligence", "machine learning", "large language models", "automation", "agents"],
  healthcare: ["medicine", "medical", "digital health", "health tech", "patients", "clinical"],
  // also reachable via tail terms
  focus: ["deep work", "attention", "productivity"],
  habits: ["routine", "behavior change", "productivity"],
  attachment: ["relationships", "dating"],
  healthspan: ["longevity", "aging"],
  "weight loss": ["glp-1", "obesity", "metabolism"],
  "time management": ["productivity", "focus"],
};

const INTENT_RULES: Array<{ match: (lc: string) => boolean; aliases: string[]; negatives: string[]; label: string }> = [
  {
    label: "space-mars",
    match: (lc) => /\bmars\b/.test(lc) && /\b(coloni[sz]ation|colony|space|spacex|settle|planet)/.test(lc),
    aliases: ["space", "spacex", "planetary", "colony", "settlement"],
    negatives: ["chocolate", "candy", "mars inc", "m&m", "snickers", "confection"],
  },
  { label: "travel", match: (lc) => /\b(tourism|travel|trip|vacation|destination)\b/.test(lc), aliases: ["travel", "destination"], negatives: [] },
  { label: "psychology-narcissism", match: (lc) => /\bnarciss/.test(lc), aliases: ["narcissist", "narcissism", "toxic relationship"], negatives: [] },
  { label: "arts-ballet", match: (lc) => /\bballet\b/.test(lc), aliases: ["dance", "performance"], negatives: [] },
];

const GENERIC_TERMS = new Set([
  "cooking", "food", "cuisine", "real", "estate", "property", "housing",
  "health", "healthcare", "medical", "business", "investing", "investment",
  "sleep", "recovery", "data", "centers", "center",
]);

// Curated singular<->plural aliases (high confidence).
const PLURAL_ALIASES: Record<string, string> = {
  "data centers": "data center",
  centers: "center",
  strategies: "strategy",
  companies: "company",
  markets: "market",
  stocks: "stock",
  habits: "habit",
  relationships: "relationship",
  episodes: "episode",
  podcasts: "podcast",
  founders: "founder",
  agents: "agent",
  models: "model",
};
// Words that look plural but should NOT be auto-singularized.
const PLURAL_EXCEPTIONS = new Set([
  "news", "series", "species", "analysis", "thesis", "crisis", "physics",
  "mathematics", "economics", "politics", "ethics", "headphones", "sales",
  "fitness", "wellness", "business", "happiness", "loss", "less", "miss",
  "boss", "class", "glass", "gas", "bus", "plus", "jesus", "atlas",
  "across", "address", "process", "access", "success", "press", "stress",
  "us", "his", "yes", "as", "is", "was", "has",
]);

function singularize(word: string): string | null {
  const w = word.toLowerCase();
  if (PLURAL_ALIASES[w]) return PLURAL_ALIASES[w];
  if (w.length <= 4) return null;
  if (PLURAL_EXCEPTIONS.has(w)) return null;
  if (w.endsWith("ies") && w.length > 4) return w.slice(0, -3) + "y";
  if (w.endsWith("ses") || w.endsWith("xes") || w.endsWith("zes") || w.endsWith("ches") || w.endsWith("shes")) {
    return w.slice(0, -2);
  }
  if (w.endsWith("s") && !w.endsWith("ss") && !w.endsWith("us") && !w.endsWith("is")) {
    return w.slice(0, -1);
  }
  return null;
}

function pluralize(word: string): string | null {
  const w = word.toLowerCase();
  // reverse alias
  for (const [pl, sg] of Object.entries(PLURAL_ALIASES)) if (sg === w) return pl;
  if (w.length <= 3) return null;
  if (PLURAL_EXCEPTIONS.has(w)) return null;
  if (/[sxz]$/.test(w) || w.endsWith("ch") || w.endsWith("sh")) return w + "es";
  if (w.endsWith("y") && w.length > 2 && !/[aeiou]y$/.test(w)) return w.slice(0, -1) + "ies";
  return w + "s";
}

export function pluralVariants(term: string): string[] {
  const t = term.toLowerCase().trim();
  if (!t) return [term];
  const out = new Set<string>([term]);
  const sg = singularize(t);
  if (sg && sg !== t) out.add(sg);
  const pl = pluralize(t);
  if (pl && pl !== t) out.add(pl);
  return Array.from(out);
}

function uniq<T>(a: T[]) { return Array.from(new Set(a)); }
function escapeIlike(s: string) { return s.replace(/[%,_]/g, " ").replace(/[(),]/g, " "); }
function escapeRegex(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function wordRe(v: string) { return new RegExp(`\\b${escapeRegex(v.toLowerCase())}\\b`, "i"); }
function hasWord(h: string, n: string) { return wordRe(n).test(h); }

export function normalizeQuery(raw: string): { normalized: string; changed: boolean } {
  let s = " " + raw.toLowerCase() + " ";
  PHRASE_ALIASES.forEach(([re, rep]) => { s = s.replace(re, rep); });
  s = s.replace(/[a-z][a-z'-]*/g, (tok) => TYPO_FIX[tok] ?? tok);
  s = s.trim().replace(/\s+/g, " ");
  return { normalized: s, changed: s !== raw.trim().toLowerCase().replace(/\s+/g, " ") };
}

export function parseQuery(q: string): { terms: string[]; strict: boolean } {
  const strict = /\+/.test(q);
  const terms = q.split(/[+,&]|\s+and\s+|\s+/i).map((s) => s.trim()).filter((s) => s.length >= 2);
  return { terms: uniq(terms), strict };
}

export function expandSimple(term: string): string[] {
  const t = term.toLowerCase();
  const out: string[] = [term];
  if (BUILTIN_SYNONYMS[t]) BUILTIN_SYNONYMS[t].slice(0, 4).forEach((s) => out.push(s));
  else for (const [k, vs] of Object.entries(BUILTIN_SYNONYMS)) if (vs.includes(t)) { out.push(k); break; }
  // Add singular/plural variants (conservative).
  pluralVariants(term).forEach((v) => { if (!out.includes(v)) out.push(v); });
  return uniq(out).slice(0, 6);
}

function semanticExpansion(terms: string[], cap = 8): string[] {
  const out: string[] = [];
  for (const t of terms) {
    const lc = t.toLowerCase();
    const list = SEMANTIC_MAP[lc];
    if (list) list.forEach((x) => { if (!out.includes(x)) out.push(x); });
  }
  // also try compound: e.g. ["time","management"] -> "time management"
  if (terms.length >= 2) {
    const joined = terms.join(" ").toLowerCase();
    const list = SEMANTIC_MAP[joined];
    if (list) list.forEach((x) => { if (!out.includes(x)) out.push(x); });
  }
  return out.slice(0, cap);
}

// Split into two filters because PostgREST mixes text-trgm and array-GIN predicates
// in a single OR, which makes the planner abandon BitmapOr and seq-scan ~300k rows
// (statement timeout). Running them as two parallel queries keeps each on its index.
function textOrFilter(variants: string[]): string {
  const ors: string[] = [];
  variants.forEach((t) => {
    const v = `%${escapeIlike(t)}%`;
    // NOTE: episodes.description is intentionally excluded — no GIN trgm index yet
    // (87k HTML rows, indexing pending). Including it triggers statement timeouts.
    ors.push(`title.ilike.${v}`, `summary.ilike.${v}`, `ai_summary.ilike.${v}`);
  });
  return ors.join(",");
}

function arrayOrFilter(variants: string[]): string {
  const ors: string[] = [];
  variants.forEach((t) => {
    ors.push(`topics.cs.{${t}}`, `people.cs.{${t}}`, `companies.cs.{${t}}`, `tickers.cs.{${t}}`, `ingredients.cs.{${t}}`);
  });
  return ors.join(",");
}

function episodeFields(e: any) {
  const title = (e.title || "").toLowerCase();
  const summary = `${e.ai_summary || ""} ${e.summary || ""}`.toLowerCase();
  const desc = (e.description || "").toLowerCase();
  const arrays = [
    ...(e.topics || []), ...(e.people || []), ...(e.companies || []),
    ...(e.tickers || []), ...(e.ingredients || []),
  ].map((x: string) => String(x).toLowerCase());
  return { title, summary, desc, arrays };
}

function termGroupHits(e: any, variants: string[]) {
  const { title, summary, desc, arrays } = episodeFields(e);
  const podTitle = (e.podcasts?.title || "").toLowerCase();
  const podCat = (e.podcasts?.category || "").toLowerCase();
  const lc = variants.map((v) => v.toLowerCase());
  const titleHit = lc.some((v) => hasWord(title, v));
  const entityHit = lc.some((v) => arrays.some((a) => a === v || hasWord(a, v)));
  const bodyHit = lc.some((v) => hasWord(summary, v) || hasWord(desc, v));
  const podHit = lc.some((v) => hasWord(podTitle, v) || hasWord(podCat, v));
  return { hit: titleHit || entityHit || bodyHit || podHit, titleHit, entityHit, bodyHit, podHit };
}

export type MatchType = "exact_title" | "title" | "entity" | "podcast" | "semantic" | "description" | "broader";

export type ScoredEpisode = {
  e: any;
  score: number;
  hitCount: number;
  strongHits: number;
  allHit: boolean;
  semanticOnly: boolean;
  matchType: MatchType;
  inCategory: boolean;
};

function scoreEpisode(
  e: any,
  exactGroups: string[][],
  semanticTerms: string[],
  negatives: string[],
  rawQueryLc: string,
  categoryName: string | null,
): Omit<ScoredEpisode, "inCategory"> & { negativeHit: boolean; bodyOnlyGenericOnly: boolean } {
  let s = 0;
  let hitCount = 0;
  let strongHits = 0;
  let allHit = true;
  let anyNonGenericStrong = false;
  let anyNonGenericBody = false;
  let exactPhraseHit = false;
  let titleHitAny = false;
  let entityHitAny = false;
  let podHitAny = false;
  let bodyHitAny = false;

  const titleLc = (e.title || "").toLowerCase();
  if (rawQueryLc.length >= 4 && titleLc.includes(rawQueryLc)) {
    exactPhraseHit = true;
    s += 400;
  }

  // Track per-term podcast-only hits to demote pure podcast-title matches.
  let podOnlyTermHits = 0;
  exactGroups.forEach((variants) => {
    const h = termGroupHits(e, variants);
    const isGeneric = GENERIC_TERMS.has(variants[0].toLowerCase());
    if (h.hit) hitCount++;
    else allHit = false;
    // "strong" = direct episode evidence. Podcast title alone is supporting only.
    const strong = h.titleHit || h.entityHit;
    if (strong) {
      strongHits++;
      if (!isGeneric) anyNonGenericStrong = true;
    }
    if (h.bodyHit && !isGeneric) anyNonGenericBody = true;
    if (h.titleHit) { s += 180; titleHitAny = true; }
    if (h.entityHit) { s += 90; entityHitAny = true; }
    if (h.podHit) {
      // Podcast/category title is supporting. Boost only if episode also matches.
      const supports = h.titleHit || h.entityHit || h.bodyHit;
      s += supports ? 25 : 8;
      podHitAny = true;
      if (!h.titleHit && !h.entityHit && !h.bodyHit) podOnlyTermHits++;
    }
    if (h.bodyHit) { s += isGeneric ? 8 : 55; bodyHitAny = true; }
    const orig = variants[0].toLowerCase();
    if (titleLc === orig) s += 250;
  });
  // Heavy penalty when the only signal is a podcast-title match (and no episode evidence).
  const podcastOnlyMatch = !titleHitAny && !entityHitAny && !bodyHitAny && podHitAny;
  if (podcastOnlyMatch) s -= 120;
  // For multi-term queries, penalize when most terms only matched via podcast title.
  if (exactGroups.length >= 2 && podOnlyTermHits >= Math.ceil(exactGroups.length / 2) && !titleHitAny && !entityHitAny) {
    s -= 80;
  }
  if (allHit && exactGroups.length > 1) s += 130;
  s += hitCount * 25;

  // Semantic-only terms: lower weight, never alone outranks an exact title hit.
  // In category mode, semantic-only weights are reduced further so direct in-cat matches win.
  const semScale = categoryName ? 0.6 : 1;
  let semanticHit = false;
  if (semanticTerms.length) {
    for (const t of semanticTerms) {
      const h = termGroupHits(e, [t]);
      if (h.titleHit) { s += 35 * semScale; semanticHit = true; }
      else if (h.entityHit) { s += 25 * semScale; semanticHit = true; }
      else if (h.podHit) { s += 10 * semScale; semanticHit = true; }
      else if (h.bodyHit) { s += 6 * semScale; semanticHit = true; }
    }
  }

  const bodyOnlyGenericOnly = strongHits === 0 && !anyNonGenericBody && !anyNonGenericStrong;

  let negativeHit = false;
  if (negatives.length) {
    const { title, summary, desc, arrays } = episodeFields(e);
    const podTitle = (e.podcasts?.title || "").toLowerCase();
    for (const n of negatives) {
      const nl = n.toLowerCase();
      if (hasWord(title, nl) || hasWord(podTitle, nl) || arrays.some((a) => hasWord(a, nl))) {
        negativeHit = true; s -= 400; break;
      }
      if (hasWord(summary, nl) || hasWord(desc, nl)) s -= 80;
    }
  }

  // Freshness — small boost; doesn't dominate.
  if (e.published_at) {
    const ageDays = (Date.now() - new Date(e.published_at).getTime()) / 86400000;
    s += Math.max(0, 30 - ageDays) * 0.6;
    if (ageDays < 7) s += 8;
  }
  // Quality tie-breakers — modest. Tier-aware (Formula C v3) replaces frozen episode_rank.
  const tierMap: Record<string, number> = { S: 12, A: 8, B: 4, C: 2 };
  s += tierMap[e.podcasts?.rank_label as string] ?? 0;
  s += ((e.podcasts?.podiverzum_rank ?? 0)) * 0.35;

  // Category boost — strong only for direct in-category matches (title/entity/body),
  // weak for podcast-only or pure semantic matches.
  if (categoryName && (e.podcasts?.category || "") === categoryName) {
    if (titleHitAny || entityHitAny) s += 90;
    else if (bodyHitAny) s += 45;
    else s += 10;
  }

  let matchType: MatchType = "broader";
  if (exactPhraseHit) matchType = "exact_title";
  else if (titleHitAny) matchType = "title";
  else if (entityHitAny) matchType = "entity";
  else if (bodyHitAny) matchType = "description";
  else if (semanticHit) matchType = "semantic";
  else if (podHitAny) matchType = "podcast";

  return {
    e, score: s, hitCount, strongHits, allHit,
    semanticOnly: !titleHitAny && !entityHitAny && !podHitAny && !bodyHitAny && semanticHit,
    matchType, negativeHit, bodyOnlyGenericOnly,
  };
}

// Run text-OR and array-OR as two parallel queries (see textOrFilter note above)
// then dedupe by id. Each sub-query stays on its index instead of seq-scanning.
async function runSplitOr(
  filterPairs: { text: string; arr: string }[],
  perQueryLimit: number,
): Promise<any[]> {
  const queries = filterPairs.flatMap(({ text, arr }) => {
    const tq = supabase.from("episodes").select(EPISODE_SELECT).or(text).limit(perQueryLimit);
    const aq = supabase.from("episodes").select(EPISODE_SELECT).or(arr).limit(perQueryLimit);
    tq.or("is_hungarian.eq.true,language_decision.eq.accept_hungarian", { foreignTable: "podcasts" });
    aq.or("is_hungarian.eq.true,language_decision.eq.accept_hungarian", { foreignTable: "podcasts" });
    return [tq, aq];
  });
  const results = await Promise.all(queries.map(async (q) => {
    const { data } = await q;
    return data || [];
  }));
  const map = new Map<string, any>();
  results.flat().forEach((e: any) => { if (!map.has(e.id)) map.set(e.id, e); });
  return Array.from(map.values());
}

async function queryByGroups(termGroups: string[][]): Promise<any[]> {
  // One pair per group. Note: each group becomes its own pair of queries; we
  // don't AND them server-side. The scorer enforces multi-term semantics later.
  const pairs = termGroups.map((variants) => ({
    text: textOrFilter(variants),
    arr: arrayOrFilter(variants),
  }));
  return runSplitOr(pairs, 300);
}

async function queryPerTerm(terms: string[]): Promise<any[]> {
  const pairs = terms.map((t) => ({ text: textOrFilter([t]), arr: arrayOrFilter([t]) }));
  return runSplitOr(pairs, 150);
}

export type SearchScope = "all" | "category";

export type SearchResult = {
  inCategory: ScoredEpisode[];
  outsideCategory: ScoredEpisode[];      // strong matches outside category, only when categoryName set
  all: ScoredEpisode[];                  // when categoryName is null, this is the merged ranked list
  semanticUsed: boolean;
  fallbackUsed: boolean;
  suggestion: string | null;
  termsForHighlight: string[];
};

export async function searchEpisodes(opts: {
  rawQuery: string;
  scope?: SearchScope;             // default "all"
  categoryName?: string | null;    // when present and scope="category", category-aware grouping
  limit?: number;
  /** Kept for API compatibility; public search is HU-catalog-only. */
  language?: "hu" | "en" | null;
}): Promise<SearchResult & { detectedLanguage: "hu" | "en" | null }> {
  const { rawQuery } = opts;
  const scope: SearchScope = opts.scope || "all";
  const categoryName = opts.categoryName || null;
  const limit = opts.limit || 80;

  const norm = normalizeQuery(rawQuery);
  const effective = norm.normalized || rawQuery;
  const suggestion = norm.changed ? norm.normalized : null;
  const { terms, strict } = parseQuery(effective);
  // Detection is informational only. Public Podiverzum search always runs on
  // accepted Hungarian podcasts; ASCII Hungarian queries like "fradi" or "444"
  // must not get routed to an English pool.
  const detectedLanguage = opts.language === null
    ? null
    : (opts.language ?? detectQueryLanguage(rawQuery));
  const empty: SearchResult & { detectedLanguage: typeof detectedLanguage } = {
    inCategory: [], outsideCategory: [], all: [],
    semanticUsed: false, fallbackUsed: false, suggestion, termsForHighlight: terms,
    detectedLanguage,
  };
  if (!terms.length) return empty;

  const lcQ = effective.toLowerCase();
  const matchedIntents = INTENT_RULES.filter((r) => r.match(lcQ));
  const intentAliases = uniq(matchedIntents.flatMap((r) => r.aliases));
  const negatives = uniq(matchedIntents.flatMap((r) => r.negatives));

  // Step 1 — primary query: original terms + tiny synonym expansion.
  const exactGroups = terms.map(expandSimple);
  if (intentAliases.length) intentAliases.forEach((a) => { if (!terms.some((t) => t.toLowerCase() === a.toLowerCase())) exactGroups.push([a]); });

  let raw = await queryByGroups(exactGroups);
  let fallbackUsed = false;
  if (raw.length === 0) {
    raw = await queryPerTerm([...terms, ...intentAliases]);
    if (raw.length > 0) fallbackUsed = true;
  } else if (terms.length >= 3 && raw.length < 8) {
    // Broaden candidate pool so the 2-of-N partial fallback has rows to score against.
    const extra = await queryPerTerm([...terms, ...intentAliases]);
    if (extra.length) {
      const map = new Map<string, any>();
      raw.forEach((e: any) => map.set(e.id, e));
      extra.forEach((e: any) => { if (!map.has(e.id)) map.set(e.id, e); });
      raw = Array.from(map.values());
    }
  }

  // Step 2 — semantic expansion if low results or single broad concept.
  const semanticTerms = semanticExpansion(terms, 8);
  let semanticUsed = false;
  const lowResultThreshold = 6;
  const isSingleBroadConcept = terms.length === 1 && !!SEMANTIC_MAP[terms[0].toLowerCase()];
  if (semanticTerms.length && (raw.length < lowResultThreshold || isSingleBroadConcept)) {
    const semGroups = [semanticTerms]; // one OR group of related ideas
    const semRaw = await queryByGroups(semGroups);
    if (semRaw.length) {
      const map = new Map<string, any>();
      raw.forEach((e: any) => map.set(e.id, e));
      semRaw.forEach((e: any) => { if (!map.has(e.id)) map.set(e.id, e); });
      raw = Array.from(map.values());
      semanticUsed = true;
    }
  }

  // Filter dead/inactive feeds.
  raw = raw.filter((e: any) => {
    const st = e.podcasts?.rss_status;
    const decision = String(e.podcasts?.language_decision || "");
    return st !== "failed" && st !== "inactive" && decision !== "reject_foreign" && decision !== "confirmed_foreign" && decision !== "reject_non_hungarian";
  });

  // Step 4/5 — score & sort.
  const rawQueryLc = effective.toLowerCase();
  const scored = raw
    .map((e: any) => scoreEpisode(e, exactGroups, semanticUsed ? semanticTerms : [], negatives, rawQueryLc, scope === "category" ? categoryName : null))
    .filter((x) => !x.negativeHit && (x.hitCount > 0 || (semanticUsed && x.matchType === "semantic")));

  // Relevance gate: at least one strong hit OR semantic hit (when semantic is allowed).
  let chosen = scored.filter((x) => x.strongHits >= 1 || (semanticUsed && x.matchType === "semantic"));

  // Multi-term handling with 2-of-3 partial fallback.
  let partialUsed = false;
  if (exactGroups.length > 1) {
    const allHit = chosen.filter((x) => x.allHit);
    if (strict) {
      chosen = allHit.length ? allHit : chosen;
    } else if (allHit.length >= 5) {
      chosen = allHit;
    } else if (exactGroups.length >= 3) {
      const minHits = Math.max(2, exactGroups.length - 1);
      const partial = chosen.filter((x) => x.hitCount >= minHits);
      if (partial.length > allHit.length) {
        chosen = partial;
        partialUsed = true;
      } else if (allHit.length) {
        chosen = allHit;
      }
    } else if (exactGroups.length === 2) {
      // 2-term fallback: prefer both-term hits; if scarce, allow 1-of-2 with strong signal.
      if (allHit.length >= 3) {
        chosen = allHit;
      } else {
        const strongSingle = chosen.filter(
          (x) => x.hitCount >= 1 &&
            (x.matchType === "exact_title" || x.matchType === "title" || x.matchType === "entity"),
        );
        const merged = new Map<string, typeof chosen[number]>();
        [...allHit, ...strongSingle].forEach((x) => {
          const cur = merged.get(x.e.id);
          if (!cur || x.score > cur.score) merged.set(x.e.id, x);
        });
        const combined = Array.from(merged.values());
        if (combined.length > allHit.length) {
          chosen = combined;
          partialUsed = true;
        } else if (allHit.length) {
          chosen = allHit;
        }
      }
    } else if (allHit.length) {
      chosen = allHit;
    }
  }

  const decorated: ScoredEpisode[] = chosen.map((x) => ({
    e: x.e, score: x.score, hitCount: x.hitCount, strongHits: x.strongHits, allHit: x.allHit,
    semanticOnly: x.semanticOnly, matchType: x.matchType,
    inCategory: !!(categoryName && (x.e.podcasts?.category || "") === categoryName),
  }));
  decorated.sort((a, b) => b.score - a.score);

  // Dedupe: by id; then by normalized title + podcast slug + day. Keep higher score.
  const dedupeKey = (x: ScoredEpisode) => {
    const t = (x.e.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 80);
    const ps = x.e.podcasts?.slug || x.e.podcast_id || "";
    const day = x.e.published_at ? new Date(x.e.published_at).toISOString().slice(0, 10) : "";
    return `${t}|${ps}|${day}`;
  };
  const dedupe = (arr: ScoredEpisode[]) => {
    const byId = new Map<string, ScoredEpisode>();
    for (const x of arr) {
      const cur = byId.get(x.e.id);
      if (!cur || x.score > cur.score) byId.set(x.e.id, x);
    }
    const byKey = new Map<string, ScoredEpisode>();
    for (const x of byId.values()) {
      const k = dedupeKey(x);
      const cur = byKey.get(k);
      if (!cur || x.score > cur.score) byKey.set(k, x);
    }
    return Array.from(byKey.values()).sort((a, b) => b.score - a.score);
  };

  // Per-podcast diversity cap: max 2 in top 10, max 3 in top 20, then unrestricted.
  const diversify = (arr: ScoredEpisode[]) => {
    const counts = new Map<string, number>();
    const deferred: ScoredEpisode[] = [];
    const out: ScoredEpisode[] = [];
    const podKey = (x: ScoredEpisode) => x.e.podcasts?.slug || x.e.podcast_id || "_";
    for (const x of arr) {
      const k = podKey(x);
      const c = counts.get(k) || 0;
      const pos = out.length;
      const cap = pos < 10 ? 2 : pos < 20 ? 3 : Infinity;
      if (c < cap) {
        out.push(x);
        counts.set(k, c + 1);
      } else {
        deferred.push(x);
      }
    }
    return [...out, ...deferred];
  };

  const finalAll = diversify(dedupe(decorated));
  fallbackUsed = fallbackUsed || partialUsed;

  if (categoryName && scope === "category") {
    const inCat = diversify(dedupe(decorated.filter((x) => x.inCategory))).slice(0, limit);
    const outsideRaw = decorated.filter(
      (x) => !x.inCategory && x.score >= 200 &&
        (x.matchType === "exact_title" || x.matchType === "title" || x.matchType === "entity"),
    );
    const outside = diversify(dedupe(outsideRaw)).slice(0, 8);
    return { inCategory: inCat, outsideCategory: outside, all: finalAll.slice(0, limit), semanticUsed, fallbackUsed, suggestion, termsForHighlight: terms, detectedLanguage };
  }

  return { inCategory: [], outsideCategory: [], all: finalAll.slice(0, limit), semanticUsed, fallbackUsed, suggestion, termsForHighlight: terms, detectedLanguage };
}

export const MATCH_LABEL: Record<MatchType, string> = {
  exact_title: "Pontos cím",
  title: "Címben találtuk",
  entity: "Téma vagy szereplő",
  podcast: "Műsoregyezés",
  description: "Leírás alapján",
  semantic: "Kapcsolódó ötlet",
  broader: "Tágabb találat",
};
