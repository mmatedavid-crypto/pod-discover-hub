// Episode search-vector input (episode_embeddings, read by search_episodes_hybrid).
// Kept byte-compatible with the format of the ~133k vectors written before 2026-05-21, so old and
// new vectors stay comparable in one index. Clean text is the verified deterministic_v4 row only.
export const EPISODE_EMBED_MODEL = "google/gemini-embedding-001";
export const EPISODE_EMBED_VERSION = "episode-embed-v2";

export type EpisodeEmbedInput = {
  title?: string | null; display_title?: string | null; seo_description?: string | null; ai_summary?: string | null;
  topics?: string[] | null; people?: string[] | null; companies?: string[] | null; tickers?: string[] | null;
  ingredients?: string[] | null; podcast_title?: string | null; podcast_display_title?: string | null;
  podcast_category?: string | null; clean_text?: string | null;
};

const list = (a: unknown, sep: string) => (Array.isArray(a) ? a.slice(0, 10).join(sep) : "");

export function buildEpisodeEmbeddingContent(e: EpisodeEmbedInput, model = EPISODE_EMBED_MODEL): string {
  const parts = [
    `MODEL: ${model}`,
    `PODCAST: ${e.podcast_display_title || e.podcast_title || ""}`,
    `CATEGORY: ${e.podcast_category || ""}`,
    `EPISODE: ${e.display_title || e.title || ""}`,
  ];
  if (e.ai_summary) parts.push(`AI_SUMMARY: ${String(e.ai_summary).slice(0, 600)}`);
  if (e.seo_description) parts.push(`SEO: ${String(e.seo_description).slice(0, 400)}`);
  if (e.clean_text) parts.push(`DESCRIPTION: ${String(e.clean_text).slice(0, 1600)}`);
  for (const [label, key] of [["TOPICS", "topics"], ["PEOPLE", "people"], ["COMPANIES", "companies"], ["TICKERS", "tickers"], ["INGREDIENTS", "ingredients"]] as const) {
    const v = list(e[key], ", ");
    if (v) parts.push(`${label}: ${v}`);
  }
  return parts.join("\n");
}

// Returns a skip reason when the episode has too little real text to embed, else null.
export function embeddingSkipReason(e: EpisodeEmbedInput): string | null {
  const useful = [e.ai_summary, e.seo_description, e.clean_text, list(e.topics, " "), list(e.people, " "),
    list(e.companies, " "), list(e.tickers, " "), list(e.ingredients, " ")].map((v) => String(v || "")).join(" ")
    .replace(/https?:\/\/\S+/g, " ").replace(/@[A-Za-z0-9_.-]+/g, " ")
    .replace(/\b(undefined|null|\[object Object\])\b/gi, " ").replace(/\s+/g, " ").trim();
  if (!useful) return "embedding_input_empty";
  if (useful.length < 80) return "embedding_input_too_short";
  return null;
}

// Backoff before an episode is claimed again: short text waits for new text, errors retry soon,
// repeated errors back off further so a broken row never blocks the head of the queue.
export function nextAttemptDelayMs(reason: string, attempts: number): number {
  if (reason.startsWith("embedding_input")) return 30 * 864e5;
  if (attempts >= 5) return 7 * 864e5;
  return Math.min(24, 2 ** Math.max(0, attempts - 1)) * 3600e3;
}
