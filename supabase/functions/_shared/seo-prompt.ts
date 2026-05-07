// Shared prompt + schema for Stage 3 SEO/ai_summary enrichment.
// Strictly metadata-grounded. No invented facts.

export const PODCAST_SEO_TOOL = {
  type: "function",
  function: {
    name: "podcast_seo",
    description: "Generate SEO title and description for a podcast based ONLY on supplied metadata. Do not invent facts, hosts, guests, topics or claims.",
    parameters: {
      type: "object",
      properties: {
        seo_title: { type: "string", description: "<=60 chars. Include show name. No clickbait. No emojis." },
        seo_description: { type: "string", description: "<=160 chars. Factual, neutral. Describe what the show covers based ONLY on the provided description/title." },
      },
      required: ["seo_title", "seo_description"],
      additionalProperties: false,
    },
  },
};

export const EPISODE_SEO_TOOL = {
  type: "function",
  function: {
    name: "episode_seo",
    description: "Generate SEO title, SEO description, and a 1-2 sentence neutral summary of a podcast episode based ONLY on the supplied metadata (title + description). Do NOT invent guests, claims, statistics, quotes, or topics not present in the input. If the description is empty or unclear, return short generic outputs based on the title alone.",
    parameters: {
      type: "object",
      properties: {
        seo_title: { type: "string", description: "<=65 chars. Episode topic + show name. No emojis or clickbait." },
        seo_description: { type: "string", description: "<=160 chars. Neutral, factual summary suitable for a Google snippet." },
        ai_summary: { type: "string", description: "1-2 sentences, <=280 chars. Neutral. Only facts present in the input." },
      },
      required: ["seo_title", "seo_description", "ai_summary"],
      additionalProperties: false,
    },
  },
};

export const SYSTEM_PROMPT =
  "You write factual SEO metadata for podcast directory pages. You ONLY use the metadata supplied. " +
  "You never invent guests, hosts, claims, statistics, quotes, topics, or episode contents. " +
  "If the input is sparse, return short, generic, accurate text. No emojis. No clickbait. No marketing fluff.";

export function podcastUserPrompt(p: { display_title?: string|null; title: string; description?: string|null; category?: string|null }) {
  const name = p.display_title || p.title;
  const desc = (p.description || "").replace(/\s+/g, " ").trim().slice(0, 1500);
  return `Podcast: ${name}\nCategory: ${p.category || "(unknown)"}\nDescription: ${desc || "(none)"}\n\nWrite SEO title and description.`;
}

export function episodeUserPrompt(e: { display_title?: string|null; title: string; description?: string|null }, podName: string) {
  const name = e.display_title || e.title;
  const desc = (e.description || "").replace(/\s+/g, " ").trim().slice(0, 2500);
  return `Show: ${podName}\nEpisode: ${name}\nDescription: ${desc || "(none)"}\n\nWrite SEO title, SEO description, and ai_summary.`;
}

// crude stable hash for input dedup
export async function inputHash(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
