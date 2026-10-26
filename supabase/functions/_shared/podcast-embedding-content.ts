// Podcast similarity embedding input (v2). Pure, deterministic, public-safe: podcast
// metadata, RSS episode titles and topic labels only — never transcript or clean text.
// v1 embedded "MODEL:" and "RANK:" lines and an always-empty summary, so podcasts of the
// same rank tier drifted together regardless of what they were about.

export const PODCAST_EMBED_CONTENT_VERSION = 2;

export type PodcastEmbeddingInput = {
  title: string | null;
  category: string | null;
  description: string | null;
  map_topics: string[] | null;
  card_topics: string[] | null;
  recent_titles: string[] | null;
};

const clean = (s: unknown, max: number) =>
  String(s ?? "").replace(/<[^>]+>/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Merged, de-duplicated topic labels (curated topics first), lowercased, max 15. */
export function podcastTopTopics(input: Pick<PodcastEmbeddingInput, "map_topics" | "card_topics">): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of [...(input.map_topics ?? []), ...(input.card_topics ?? [])]) {
    const v = clean(t, 60).toLowerCase();
    if (!v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 15) break;
  }
  return out;
}

/**
 * Topics used for the podcast's editorial group: only the dominant few, because one
 * stray long-tail label (e.g. a single horoscope episode of a business show) must not
 * reclassify the whole podcast.
 */
export function podcastGroupTopics(topTopics: string[]): string[] {
  return topTopics.slice(0, 3);
}

export function buildPodcastEmbeddingContent(input: PodcastEmbeddingInput): string {
  const topics = podcastTopTopics(input);
  const titles = (input.recent_titles ?? []).map((t) => clean(t, 140)).filter(Boolean).slice(0, 15);
  const parts = [`Podcast: ${clean(input.title, 200)}`];
  if (clean(input.category, 80)) parts.push(`Kategória: ${clean(input.category, 80)}`);
  const desc = clean(input.description, 1200);
  if (desc) parts.push(`Leírás: ${desc}`);
  if (topics.length) parts.push(`Témák: ${topics.join(", ")}`);
  if (titles.length) parts.push(`Friss epizódok:\n- ${titles.join("\n- ")}`);
  return parts.join("\n");
}
