// Shared episode search: relevance scoring, semantic expansion, category scope.
// Goal: query-time Search Relevance Score, separate from Podiverzum Rank.
import { supabase } from "@/integrations/supabase/client";

export const EPISODE_SELECT =
  "id,title,slug,published_at,summary,description,topics,people,companies,tickers,ingredients,audio_url,episode_rank,podcast_id,podcasts!inner(slug,title,image_url,category,podiverzum_rank,rss_status)";

// High-confidence simple synonyms — small, safe expansion.
const BUILTIN_SYNONYMS: Record<string, string[]> = {
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

function expandSimple(term: string): string[] {
  const t = term.toLowerCase();
  const out: string[] = [term];
  if (BUILTIN_SYNONYMS[t]) BUILTIN_SYNONYMS[t].slice(0, 2).forEach((s) => out.push(s));
  else for (const [k, vs] of Object.entries(BUILTIN_SYNONYMS)) if (vs.includes(t)) { out.push(k); break; }
  return uniq(out).slice(0, 3);
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

function orFilterForVariants(variants: string[]): string {
  const ors: string[] = [];
  variants.forEach((t) => {
    const v = `%${escapeIlike(t)}%`;
    ors.push(`title.ilike.${v}`, `description.ilike.${v}`, `summary.ilike.${v}`);
    ors.push(`topics.cs.{${t}}`, `people.cs.{${t}}`, `companies.cs.{${t}}`, `tickers.cs.{${t}}`, `ingredients.cs.{${t}}`);
  });
  return ors.join(",");
}

function episodeFields(e: any) {
  const title = (e.title || "").toLowerCase();
  const summary = (e.summary || "").toLowerCase();
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

  exactGroups.forEach((variants) => {
    const h = termGroupHits(e, variants);
    const isGeneric = GENERIC_TERMS.has(variants[0].toLowerCase());
    if (h.hit) hitCount++;
    else allHit = false;
    const strong = h.titleHit || h.entityHit || h.podHit;
    if (strong) {
      strongHits++;
      if (!isGeneric) anyNonGenericStrong = true;
    }
    if (h.bodyHit && !isGeneric) anyNonGenericBody = true;
    if (h.titleHit) { s += 180; titleHitAny = true; }
    if (h.entityHit) { s += 90; entityHitAny = true; }
    if (h.podHit) { s += 45; podHitAny = true; }
    if (h.bodyHit) { s += isGeneric ? 8 : 55; bodyHitAny = true; }
    const orig = variants[0].toLowerCase();
    if (titleLc === orig) s += 250;
  });
  if (allHit && exactGroups.length > 1) s += 130;
  s += hitCount * 25;

  // Semantic-only terms: lower weight, never alone outranks an exact title hit.
  let semanticHit = false;
  if (semanticTerms.length) {
    for (const t of semanticTerms) {
      const h = termGroupHits(e, [t]);
      if (h.titleHit) { s += 35; semanticHit = true; }
      else if (h.entityHit) { s += 25; semanticHit = true; }
      else if (h.podHit) { s += 15; semanticHit = true; }
      else if (h.bodyHit) { s += 8; semanticHit = true; }
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
  // Quality tie-breakers — modest.
  s += ((e.episode_rank ?? 0)) * 1.0;
  s += ((e.podcasts?.podiverzum_rank ?? 0)) * 0.35;

  // Category boost (soft).
  if (categoryName && (e.podcasts?.category || "") === categoryName) s += 25;

  let matchType: MatchType = "broader";
  if (exactPhraseHit) matchType = "exact_title";
  else if (titleHitAny) matchType = "title";
  else if (entityHitAny) matchType = "entity";
  else if (podHitAny) matchType = "podcast";
  else if (bodyHitAny) matchType = "description";
  else if (semanticHit) matchType = "semantic";

  return {
    e, score: s, hitCount, strongHits, allHit,
    semanticOnly: !titleHitAny && !entityHitAny && !podHitAny && !bodyHitAny && semanticHit,
    matchType, negativeHit, bodyOnlyGenericOnly,
  };
}

async function queryByGroups(termGroups: string[][]): Promise<any[]> {
  let q = supabase.from("episodes").select(EPISODE_SELECT).limit(300);
  termGroups.forEach((variants) => { q = q.or(orFilterForVariants(variants)); });
  const { data } = await q;
  return data || [];
}

async function queryPerTerm(terms: string[]): Promise<any[]> {
  const results = await Promise.all(terms.map(async (t) => {
    const { data } = await supabase.from("episodes").select(EPISODE_SELECT).or(orFilterForVariants([t])).limit(150);
    return data || [];
  }));
  const map = new Map<string, any>();
  results.flat().forEach((e: any) => { if (!map.has(e.id)) map.set(e.id, e); });
  return Array.from(map.values());
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
}): Promise<SearchResult> {
  const { rawQuery } = opts;
  const scope: SearchScope = opts.scope || "all";
  const categoryName = opts.categoryName || null;
  const limit = opts.limit || 80;

  const norm = normalizeQuery(rawQuery);
  const effective = norm.normalized || rawQuery;
  const suggestion = norm.changed ? norm.normalized : null;
  const { terms, strict } = parseQuery(effective);
  const empty: SearchResult = { inCategory: [], outsideCategory: [], all: [], semanticUsed: false, fallbackUsed: false, suggestion, termsForHighlight: terms };
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
    return st !== "failed" && st !== "inactive";
  });

  // Step 4/5 — score & sort.
  const rawQueryLc = effective.toLowerCase();
  const scored = raw
    .map((e: any) => scoreEpisode(e, exactGroups, semanticUsed ? semanticTerms : [], negatives, rawQueryLc, scope === "category" ? categoryName : null))
    .filter((x) => !x.negativeHit && (x.hitCount > 0 || (semanticUsed && x.matchType === "semantic")));

  // Relevance gate: at least one strong hit OR semantic hit (when semantic is allowed).
  let chosen = scored.filter((x) => x.strongHits >= 1 || (semanticUsed && x.matchType === "semantic"));

  if (exactGroups.length > 1) {
    const allHit = chosen.filter((x) => x.allHit);
    if (strict) chosen = allHit.length ? allHit : chosen;
    else if (allHit.length) chosen = allHit;
  }

  // Decorate with inCategory.
  const decorated: ScoredEpisode[] = chosen.map((x) => ({
    e: x.e, score: x.score, hitCount: x.hitCount, strongHits: x.strongHits, allHit: x.allHit,
    semanticOnly: x.semanticOnly, matchType: x.matchType,
    inCategory: !!(categoryName && (x.e.podcasts?.category || "") === categoryName),
  }));
  decorated.sort((a, b) => b.score - a.score);

  if (categoryName && scope === "category") {
    const inCat = decorated.filter((x) => x.inCategory).slice(0, limit);
    // Outside-category: only "strong" scores (above a threshold) and not semantic-only.
    const outside = decorated
      .filter((x) => !x.inCategory && x.score >= 220 && x.matchType !== "semantic" && x.matchType !== "broader")
      .slice(0, 8);
    return { inCategory: inCat, outsideCategory: outside, all: decorated.slice(0, limit), semanticUsed, fallbackUsed, suggestion, termsForHighlight: terms };
  }

  return { inCategory: [], outsideCategory: [], all: decorated.slice(0, limit), semanticUsed, fallbackUsed, suggestion, termsForHighlight: terms };
}

export const MATCH_LABEL: Record<MatchType, string> = {
  exact_title: "exact match",
  title: "title match",
  entity: "topic match",
  podcast: "podcast match",
  description: "description match",
  semantic: "related idea",
  broader: "broader match",
};
