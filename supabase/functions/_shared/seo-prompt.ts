// Shared prompt + schema for Stage 3 SEO/ai_summary enrichment.
// Strictly metadata-grounded. No invented facts.

export const PODCAST_SEO_TOOL = {
  type: "function",
  function: {
    name: "podcast_seo",
    description: "Generate SEO title and description for a podcast based ONLY on supplied metadata. Do not invent facts, hosts, guests, topics or claims. Also detect the actual content language.",
    parameters: {
      type: "object",
      properties: {
        seo_title: { type: "string", description: "<=60 chars. Include show name. No clickbait. No emojis." },
        seo_description: { type: "string", description: "<=160 chars. Factual, neutral. Describe what the show covers based ONLY on the provided description/title." },
        detected_language: { type: "string", description: "ISO 639-1 code (e.g. 'en','hu','es','fr','de','yo','fa','ar','zh','hi') of the ACTUAL podcast content language as inferred from title+description. If genuinely mixed/unknown, return 'mul'." },
      },
      required: ["seo_title", "seo_description", "detected_language"],
      additionalProperties: false,
    },
  },
};

export const EPISODE_SEO_TOOL = {
  type: "function",
  function: {
    name: "episode_seo",
    description: "Generate SEO title, SEO description, and a 1-2 sentence neutral summary of a podcast episode based ONLY on the supplied metadata (title + description). Do NOT invent guests, claims, statistics, quotes, or topics not present in the input. If the description is empty or unclear, return short generic outputs based on the title alone. Also detect the actual content language.",
    parameters: {
      type: "object",
      properties: {
        seo_title: { type: "string", description: "<=65 chars. Episode topic + show name. No emojis or clickbait." },
        seo_description: { type: "string", description: "<=160 chars. Neutral, factual summary suitable for a Google snippet." },
        ai_summary: { type: "string", description: "1-2 sentences, <=280 chars. Neutral. Only facts present in the input." },
        detected_language: { type: "string", description: "ISO 639-1 code (e.g. 'en','hu','es','yo','fa','ar','zh','hi') of the ACTUAL episode language inferred from title+description. If genuinely mixed/unknown, return 'mul'." },
      },
      required: ["seo_title", "seo_description", "ai_summary", "detected_language"],
      additionalProperties: false,
    },
  },
};

export const SYSTEM_PROMPT =
  "You write factual SEO metadata for podcast directory pages. You ONLY use the metadata supplied. " +
  "You never invent guests, hosts, claims, statistics, quotes, topics, or episode contents. " +
  "If the input is sparse, return short, generic, accurate text. No emojis. No clickbait. No marketing fluff. " +
  "CRITICAL LANGUAGE RULE: write ALL output fields (seo_title, seo_description, ai_summary) in the same language as the source podcast/episode metadata. " +
  "If the input is Hungarian, write in Hungarian. If English, write in English. Never translate or mix languages.";

// Normalize a BCP-47 / ISO language string to a short ISO-639-1 code ("en-us" -> "en").
function langCode(l?: string | null): string | null {
  if (!l) return null;
  return String(l).toLowerCase().split(/[-_]/)[0] || null;
}
function langName(code: string | null): string {
  switch (code) {
    case "hu": return "Hungarian (magyar)";
    case "en": return "English";
    case "de": return "German (Deutsch)";
    case "es": return "Spanish (español)";
    case "fr": return "French (français)";
    case "it": return "Italian (italiano)";
    case "pt": return "Portuguese (português)";
    case "pl": return "Polish (polski)";
    case "ro": return "Romanian (română)";
    case "sk": return "Slovak (slovenčina)";
    default: return code || "the source language";
  }
}

export function podcastUserPrompt(p: { display_title?: string|null; title: string; description?: string|null; category?: string|null; language?: string|null }) {
  const name = p.display_title || p.title;
  const desc = (p.description || "").replace(/\s+/g, " ").trim().slice(0, 1500);
  const code = langCode(p.language);
  const langLine = code ? `Output language: ${langName(code)} (${code}). Write seo_title and seo_description in this language only.\n` : "";
  return `${langLine}Podcast: ${name}\nCategory: ${p.category || "(unknown)"}\nDescription: ${desc || "(none)"}\n\nWrite SEO title and description.`;
}

export function episodeUserPrompt(e: { display_title?: string|null; title: string; description?: string|null; language?: string|null }, podName: string, podLanguage?: string | null) {
  const name = e.display_title || e.title;
  const desc = (e.description || "").replace(/\s+/g, " ").trim().slice(0, 2500);
  const code = langCode(e.language) || langCode(podLanguage);
  const langLine = code ? `Output language: ${langName(code)} (${code}). Write seo_title, seo_description, and ai_summary in this language only.\n` : "";
  return `${langLine}Show: ${podName}\nEpisode: ${name}\nDescription: ${desc || "(none)"}\n\nWrite SEO title, SEO description, and ai_summary.`;
}

// crude stable hash for input dedup
export async function inputHash(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
