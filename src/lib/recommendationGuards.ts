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
  /\b(mese|meseradio|meseradio|meserádió|gyerek|gyermek|gyerekek|ovis|ovodas|óvodás|altato|altató|tunder|tündér|baba|babak|babák|csaladi mese|esti mese)\b/i;

const BUSINESS_RE =
  /\b(uzlet|üzlet|business|gazdasag|gazdaság|penz|pénz|tozsde|tőzsde|befektetes|befektetés|milliardos|milliárdos|ceg|cég|vallalkozas|vállalkozás|ingatlan|karrier|menedzsment)\b/i;

const PUBLIC_AFFAIRS_RE =
  /\b(kozelet|közélet|politika|politics|hirek|hírek|tarsadalom|társadalom|interju|interjú|kozbeszed|közbeszéd|orban|orbán|meszaros|mészáros|fidesz|tisza|kormany|kormány|parlament|part|párt|valasztas|választás|puzser|puzsér)\b/i;

const HEALTH_RE = /\b(egeszseg|egészség|orvos|pszicho|mentalis|mentális|eletmod|életmód|sport)\b/i;
const RELIGION_RE =
  /\b(vallas|vallás|hit|kereszteny|keresztény|isten|biblia|egyhaz|egyház|istentisztelet|igehirdetes|igehirdetés|prédikáció|predikacio|katolikus|reformatus|református|baptista|evangelium|evangélium|ahitat|áhítat)\b/i;

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
  if (BUSINESS_RE.test(text)) return "business";
  if (PUBLIC_AFFAIRS_RE.test(text)) return "public_affairs";
  if (HEALTH_RE.test(text)) return "health";
  if (RELIGION_RE.test(text)) return "religion";
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
    return bridged || similarity >= 0.72;
  }

  if (sourceGroup !== "general" && candidateGroup === "general") {
    return bridged || similarity >= 0.66;
  }

  if (candidateGroup !== "general" && sourceGroup === "general") {
    return bridged || similarity >= 0.66;
  }

  return bridged || similarity >= 0.56 || sourceGroup === candidateGroup;
}

export function filterSafeRelatedEpisodes<T extends RecommendationCandidate>(
  source: RecommendationContext,
  candidates: T[],
  limit: number,
): T[] {
  return candidates.filter((candidate) => isSafeRelatedEpisode(source, candidate)).slice(0, limit);
}
