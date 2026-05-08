// Formula C v3-safe episode ordering helper.
// Replaces the frozen legacy `episode_rank` system. Pure frontend composite:
// uses podcast tier (rank_label) + freshness (published_at) + podiverzum_rank.
//
// Do NOT read episodes.episode_rank / episode_rank_label — those are frozen
// outputs of the deprecated `recompute-ranks` function.

export type RankableEpisode = {
  published_at?: string | null;
  podcasts?: {
    rank_label?: string | null;
    podiverzum_rank?: number | null;
  } | null;
};

export function tierWeight(label?: string | null): number {
  switch (label) {
    case "S": return 100;
    case "A": return 70;
    case "B": return 40;
    case "C": return 20;
    case "D":
    case "E": return 5;
    default: return 10;
  }
}

export function freshnessBoost(publishedAt?: string | null): number {
  if (!publishedAt) return 0;
  const t = new Date(publishedAt).getTime();
  if (!Number.isFinite(t)) return 0;
  const ageH = (Date.now() - t) / 3600_000;
  if (ageH < 24) return 60;
  if (ageH < 72) return 40;
  if (ageH < 24 * 7) return 25;
  if (ageH < 24 * 14) return 10;
  return 0;
}

export function episodeScore(e: RankableEpisode): number {
  const tier = tierWeight(e.podcasts?.rank_label);
  const fresh = freshnessBoost(e.published_at);
  const pr = Math.min(Number(e.podcasts?.podiverzum_rank ?? 0), 10);
  return tier + fresh + pr;
}

export function compareByScore(a: RankableEpisode, b: RankableEpisode): number {
  const sb = episodeScore(b), sa = episodeScore(a);
  if (sb !== sa) return sb - sa;
  const at = a.published_at ? new Date(a.published_at).getTime() : 0;
  const bt = b.published_at ? new Date(b.published_at).getTime() : 0;
  return bt - at;
}
