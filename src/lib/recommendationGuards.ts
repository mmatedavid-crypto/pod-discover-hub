export type RecommendationContext = {
  title?: string | null;
  podcastTitle?: string | null;
  category?: string | null;
  topics?: string[] | null;
  people?: string[] | null;
  companies?: string[] | null;
};

export type RecommendationCandidate = RecommendationContext & {
  similarity?: number | null;
  sharedTopics?: string[] | null;
  sharedPeople?: string[] | null;
  sharedCompanies?: string[] | null;
};

const CHILDREN_RE =
  /\b(kids|family|children|child|bedtime|story|stories|mese|meseradio|meseradio|meserádió|gyerek|gyermek|gyerekek|ovis|ovodas|óvodás|altato|altató|tunder|tündér|baba|babak|babák|csaladi mese|esti mese)\b/i;

const BUSINESS_RE =
  /\b(uzlet|üzlet|business|gazdasag|gazdaság|penz|pénz|tozsde|tőzsde|befektetes|befektetés|milliardos|milliárdos|ceg|cég|vallalkozas|vállalkozás|ingatlan|karrier|menedzsment|reszveny|részvény|arfolyam|árfolyam|bank|startup)\b/i;

const PUBLIC_AFFAIRS_RE =
  /\b(kozelet|közélet|politika|politics|hirek|hírek|tarsadalom|társadalom|interju|interjú|kozbeszed|közbeszéd|orban|orbán|meszaros|mészáros|fidesz|tisza|kormany|kormány|parlament|part|párt|valasztas|választás|puzser|puzsér|miniszter|ellenzek|ellenzék|onkormanyzat|önkormányzat|hatalom|ner|oligarcha)\b/i;

const HEALTH_RE = /\b(egeszseg|egészség|orvos|pszicho|mentalis|mentális|eletmod|életmód|sport)\b/i;
const RELIGION_RE =
  /\b(religion|spirituality|spiritual|faith|christian|church|sermon|prayer|gospel|vallas|vallás|hit|kereszteny|keresztény|isten|biblia|egyhaz|egyház|istentisztelet|igehirdetes|igehirdetés|prédikáció|predikacio|katolikus|reformatus|református|baptista|evangelium|evangélium|ahitat|áhítat)\b/i;
const SPORTS_RE = /\b(sport|foci|futball|labdarugas|labdarúgás|nb1|valogatott|válogatott|meccs|bl|forma-1|formula|kosar|kézilabda|kezilabda|tenisz|cycling|bringa)\b/i;
const ENTERTAINMENT_RE = /\b(film|mozi|sorozat|zene|kultura|kultúra|szinhaz|színház|standup|stand-up|humor|gaming|jatek|játék|celebrity|bulvar|bulvár)\b/i;

function normalizeText(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function haystack(ctx: RecommendationContext): string {
  return normalizeText(
    [
      ctx.title,
      ctx.podcastTitle,
      ctx.category,
      ...(ctx.topics || []),
      ...(ctx.people || []),
      ...(ctx.companies || []),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function group(ctx: RecommendationContext): string {
  const text = haystack(ctx);
  if (CHILDREN_RE.test(text)) return "children";
  // Public-affairs has to win over words like "Isten" or "részvény" when the
  // episode is about power, politics or public figures.
  if (PUBLIC_AFFAIRS_RE.test(text)) return "public_affairs";
  if (RELIGION_RE.test(text)) return "religion";
  if (BUSINESS_RE.test(text)) return "business";
  if (SPORTS_RE.test(text)) return "sports";
  if (HEALTH_RE.test(text)) return "health";
  if (ENTERTAINMENT_RE.test(text)) return "entertainment";
  return "general";
}

function overlaps(a?: string[] | null, b?: string[] | null): boolean {
  if (!a?.length || !b?.length) return false;
  const left = new Set(a.map(normalizeText).filter(Boolean));
  return b.some((item) => left.has(normalizeText(item)));
}

function hasExplicitBridge(source: RecommendationContext, candidate: RecommendationCandidate): boolean {
  return (
    overlaps(source.topics, candidate.topics) ||
    overlaps(source.people, candidate.people) ||
    overlaps(source.companies, candidate.companies) ||
    overlaps(source.topics, candidate.sharedTopics) ||
    overlaps(source.people, candidate.sharedPeople) ||
    overlaps(source.companies, candidate.sharedCompanies)
  );
}

function overlapCount(a?: string[] | null, b?: string[] | null): number {
  if (!a?.length || !b?.length) return 0;
  const left = new Set(a.map(normalizeText).filter(Boolean));
  return b.reduce((count, item) => count + (left.has(normalizeText(item)) ? 1 : 0), 0);
}

function bridgeStrength(source: RecommendationContext, candidate: RecommendationCandidate): number {
  return (
    overlapCount(source.people, candidate.people) * 4 +
    overlapCount(source.people, candidate.sharedPeople) * 4 +
    overlapCount(source.companies, candidate.companies) * 3 +
    overlapCount(source.companies, candidate.sharedCompanies) * 3 +
    overlapCount(source.topics, candidate.topics) * 2 +
    overlapCount(source.topics, candidate.sharedTopics) * 2
  );
}

function safetyRank(source: RecommendationContext, candidate: RecommendationCandidate): number {
  const sourceGroup = group(source);
  const candidateGroup = group(candidate);
  const similarity = candidate.similarity ?? 0;
  const strength = bridgeStrength(source, candidate);
  const sameSpecificGroup = sourceGroup !== "general" && sourceGroup === candidateGroup;
  return strength * 10 + (sameSpecificGroup ? 3 : 0) + similarity;
}

export function isSafeRelatedEpisode(
  source: RecommendationContext,
  candidate: RecommendationCandidate,
): boolean {
  const sourceGroup = group(source);
  const candidateGroup = group(candidate);
  const similarity = candidate.similarity ?? 0;
  const bridged = hasExplicitBridge(source, candidate);

  if (candidateGroup === "children" && sourceGroup !== "children") return false;
  if (sourceGroup === "children" && candidateGroup !== "children" && !bridged) return false;

  // Religion is a high-risk semantic false positive: words like "Isten" can
  // occur in public-affairs titles while the target is actually worship/sermon
  // content. Never bridge it from/to non-religious episodes by vector score.
  if ((sourceGroup === "religion") !== (candidateGroup === "religion")) return false;

  if (sourceGroup !== "general" && candidateGroup !== "general" && sourceGroup !== candidateGroup) {
    // Different editorial worlds need an explicit topic/person/company bridge.
    // Pure vector score is not trusted enough here: bad descriptions and shared
    // generic words can otherwise connect politics, sermons, sport and kids.
    return bridged;
  }

  if (sourceGroup !== "general" && candidateGroup === "general") {
    return bridged || similarity >= 0.74;
  }

  if (candidateGroup !== "general" && sourceGroup === "general") {
    return bridged || similarity >= 0.74;
  }

  if (sourceGroup !== "general" && sourceGroup === candidateGroup) {
    return bridged || similarity >= 0.58;
  }

  return bridged || similarity >= 0.62;
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
