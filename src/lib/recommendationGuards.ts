export type RecommendationContext = {
  title?: string | null;
  podcastTitle?: string | null;
  category?: string | null;
  topics?: string[] | null;
  /**
   * Raw extracted display names. A matching name is NOT a shared identity (homonyms), so
   * these never bridge, score or explain a recommendation — kept only for callers' context.
   */
  people?: string[] | null;
  /** Canonical person ids with an accepted, reviewed link on this episode (trusted identity). */
  verifiedPersonIds?: string[] | null;
  companies?: string[] | null;
};

export type RecommendationCandidate = RecommendationContext & {
  similarity?: number | null;
  sharedTopics?: string[] | null;
  /** Names of people the server verified as the same identity on both episodes. */
  sharedPeople?: string[] | null;
  sharedCompanies?: string[] | null;
};

export type RecommendationGroup =
  | "children"
  | "religion"
  | "science"
  | "esoteric"
  | "true_crime"
  | "public_affairs"
  | "business"
  | "sports"
  | "health"
  | "entertainment"
  | "general";

// Mirror of public.recommendation_text_group (SQL). Patterns run on accent-stripped,
// lower-cased text; a pattern without a trailing \b is a word-start stem
// ("politik" matches "politikáról"), never a mid-word substring ("Explainer" ≠ "ner").
const CHILDREN_RE =
  /\b(mese|mesek|mesei|meseradio|esti mese|gyerek|gyerekek|gyerekeknek|gyermek|gyermekek|ovis|ovodas|ovodasoknak|altato|tunder|tundermese|baba|babak|kids|children|family)\b/;
const ESOTERIC_RE =
  /\b(ezoteri|paranormal|asztrolog|horoszkop|tarot|numerolog|reiki|csakr|manifesztal|vonzas torveny|energiagyogy|kvantumgyogy|reinkarnaci|elozo elet|tulvilag|halal utani|halalkozeli|ufo\b|osszeeskuves|spiritualis|spiritualitas|angyal|akasha|karma|rezgesszint|medium|joslas|boszorkany|magia|magikus)/;
const SCIENCE_RE =
  /\b(fizika|fizikus|kvantum|csillagasz|asztrofizik|asztronom|kozmolog|reszecskefizik|relativitaselmelet|osrobbanas|nagy bumm|fekete lyuk|sotet anyag|sotetanyag|exobolygo|urkutatas|urtavcso|biolog|biokemi|kemia|kemikus|genetik|evoluci|matematik|idegtudom|neurobiolog|agykutat|tudos\b|tudosok|tudomany\b|tudomanyos|tudomanyrol|tudomanyt)/;
const PUBLIC_AFFAIRS_RE =
  /\b(kozelet|politik|politics|hirek|tarsadalom|kozbeszed|orban|meszaros|fidesz|tisza\b|kormany|parlament|part\b|partok|partja|valasztas|puzser|miniszter|ellenzek|onkormanyzat|hatalom|ner\b|oligarch)/;
const RELIGION_RE =
  /\b(vallas|hit\b|hitrol|hitben|kereszteny|isten|biblia|egyhaz|istentisztelet|igehirdetes|predikacio|katolikus|reformatus|baptista|evangelium|ahitat|religion|spirituality)/;
const BUSINESS_RE =
  /\b(uzlet|business|gazdasag|penz|tozsde|befektet|milliardos|ceg|vallalkoz|ingatlan|karrier|menedzsment|reszveny|arfolyam|bank|startup|finance)/;
const SPORTS_RE =
  /\b(sport|foci|futball|labdarugas|nb1|nb i\b|valogatott|meccs|forma-1|formula-1|kosarlabda|kezilabda|tenisz|bringa|cycling)/;
const HEALTH_RE = /\b(egeszseg|orvos|pszicho|mentalis|eletmod|health|onismeret|onfejlesztes)/;
const ENTERTAINMENT_RE =
  /\b(film|mozi|sorozat|zene|zenei|zenesz|kultura|szinhaz|standup|stand-up|humor|gaming|jatek|bulvar|music|comedy)/;

function normalizeText(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Editorial world of an episode; same rules as public.recommendation_text_group. */
export function recommendationGroup(ctx: RecommendationContext): RecommendationGroup {
  const category = ctx.category || "";
  const topics = (ctx.topics || []).filter(Boolean);
  const head = normalizeText([ctx.title, ctx.podcastTitle].filter(Boolean).join(" "));
  const text = normalizeText([ctx.title, ctx.podcastTitle, category, ...topics].filter(Boolean).join(" "));

  if (category === "Kids & Family" || CHILDREN_RE.test(text)) return "children";
  if (category === "Religion & Spirituality") return "religion";
  if (category === "Science & Ideas") return "science";
  // Category labels are English; "True Crime & Paranormal" must stay true_crime, not esoteric.
  if (ESOTERIC_RE.test(normalizeText([ctx.title, ctx.podcastTitle, ...topics].filter(Boolean).join(" ")))) return "esoteric";
  if (category === "True Crime & Paranormal") return "true_crime";
  if (category === "Self-Improvement") return "health";
  // One stray science tag on a grab-bag episode is not enough: the title says so,
  // or science topics dominate the topic list.
  const scienceTopics = topics.filter((t) => SCIENCE_RE.test(normalizeText(t))).length;
  if (SCIENCE_RE.test(head) || scienceTopics >= 2 || (scienceTopics >= 1 && scienceTopics * 2 >= topics.length)) {
    return "science";
  }
  if (PUBLIC_AFFAIRS_RE.test(text)) return "public_affairs";
  if (RELIGION_RE.test(text)) return "religion";
  if (BUSINESS_RE.test(text)) return "business";
  if (SPORTS_RE.test(text)) return "sports";
  if (HEALTH_RE.test(text)) return "health";
  if (ENTERTAINMENT_RE.test(text)) return "entertainment";
  return "general";
}

function normalizedSet(values?: string[] | null): Set<string> {
  return new Set((values || []).map((v) => normalizeText(v).trim()).filter(Boolean));
}

/** Shared person identities: canonical ids verified on both sides, or server-verified names. */
export function verifiedSharedPersonCount(source: RecommendationContext, candidate: RecommendationCandidate): number {
  const left = new Set((source.verifiedPersonIds || []).filter(Boolean));
  const byId = left.size ? (candidate.verifiedPersonIds || []).filter((id) => left.has(id)).length : 0;
  return Math.max(byId, (candidate.sharedPeople || []).filter(Boolean).length);
}

/** Distinct source values found on the candidate (own list or server-computed shared list). */
function sharedCount(source?: string[] | null, ...candidateLists: Array<string[] | null | undefined>): number {
  const left = normalizedSet(source);
  if (!left.size) return 0;
  const right = new Set<string>();
  for (const list of candidateLists) normalizedSet(list).forEach((v) => right.add(v));
  let count = 0;
  left.forEach((v) => {
    if (right.has(v)) count++;
  });
  return count;
}

function sharedTopicCount(source: RecommendationContext, candidate: RecommendationCandidate): number {
  return sharedCount(source.topics, candidate.topics, candidate.sharedTopics);
}

function hasEntityBridge(source: RecommendationContext, candidate: RecommendationCandidate): boolean {
  return (
    verifiedSharedPersonCount(source, candidate) > 0 ||
    sharedCount(source.companies, candidate.companies, candidate.sharedCompanies) > 0
  );
}

/**
 * Mirror of public.recommendation_is_compatible_v2. Crossing editorial worlds needs a
 * strong bridge (verified person, shared organisation, or ≥2 shared topics); science never
 * bridges to esoteric / true-crime content, and reaches general episodes by vector only
 * when the match is very close.
 */
export function isCompatibleGroup(
  sourceGroup: RecommendationGroup,
  candidateGroup: RecommendationGroup,
  similarity: number,
  sharedTopics: number,
  entityBridge: boolean,
): boolean {
  const s = sourceGroup;
  const c = candidateGroup;
  const bridge = entityBridge || sharedTopics > 0;
  const strong = entityBridge || sharedTopics >= 2;

  if ((s === "religion") !== (c === "religion")) return false;
  if (c === "children" && s !== "children") return false;
  if (s === "children" && c !== "children") return strong;
  if (s === "science" && (c === "esoteric" || c === "true_crime")) return false;
  if (c === "science" && (s === "esoteric" || s === "true_crime")) return false;
  if (s !== c && (s === "science" || c === "science") && (s === "general" || c === "general")) {
    return strong || similarity >= 0.87;
  }
  if (s !== c) return strong;
  if (s !== "general") return bridge || similarity >= 0.7;
  return bridge || similarity >= 0.82;
}

function bridgeStrength(source: RecommendationContext, candidate: RecommendationCandidate): number {
  return (
    verifiedSharedPersonCount(source, candidate) * 4 +
    sharedCount(source.companies, candidate.companies, candidate.sharedCompanies) * 3 +
    sharedTopicCount(source, candidate) * 2
  );
}

function safetyRank(source: RecommendationContext, candidate: RecommendationCandidate): number {
  const sourceGroup = recommendationGroup(source);
  const candidateGroup = recommendationGroup(candidate);
  const similarity = candidate.similarity ?? 0;
  const strength = bridgeStrength(source, candidate);
  const sameSpecificGroup = sourceGroup !== "general" && sourceGroup === candidateGroup;
  return strength * 10 + (sameSpecificGroup ? 3 : 0) + similarity;
}

export function isSafeRelatedEpisode(
  source: RecommendationContext,
  candidate: RecommendationCandidate,
): boolean {
  return isCompatibleGroup(
    recommendationGroup(source),
    recommendationGroup(candidate),
    candidate.similarity ?? 0,
    sharedTopicCount(source, candidate),
    hasEntityBridge(source, candidate),
  );
}

export function filterSafeRelatedEpisodes<T extends RecommendationCandidate>(
  source: RecommendationContext,
  candidates: T[],
  limit: number,
): T[] {
  return candidates
    .filter((candidate) => isSafeRelatedEpisode(source, candidate))
    .sort((a, b) => safetyRank(source, b) - safetyRank(source, a))
    .slice(0, limit);
}
