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
    description:
      "Generate SEO title, SEO description, a 1-2 sentence neutral summary, AND extract structured entities (people, mentioned, companies, tickers, topics) of a podcast episode based ONLY on the supplied metadata (title + description). Do NOT invent guests, claims, statistics, quotes, or topics not present in the input. Also detect the actual content language.\n\nCRITICAL DISTINCTION between `people` and `mentioned`:\n- `people` = persons who actually SPEAK in the episode (guests, interviewees, panelists). The metadata must clearly indicate presence: words like 'vendég', 'vendégünk', 'interjú', 'beszélgetés vele', 'guest', 'interview', 'with [name]', '[name] mesél/elmondja', or a Q&A format.\n- `mentioned` = persons only TALKED ABOUT, not present. This is the DEFAULT for famous people, politicians (e.g. Orbán Viktor, Magyar Péter), business figures, athletes — they go to `mentioned` unless the metadata unambiguously says they speak in the episode.\n- NEVER put the show's own host(s) in either list. Hosts are excluded from entity extraction. The host name list is provided in the user message; do not output those names.\n- If unsure whether a person speaks or is just talked about, put them in `mentioned` (the conservative choice).",
    parameters: {
      type: "object",
      properties: {
        seo_title: { type: "string", description: "<=65 chars. Episode topic + show name. No emojis or clickbait." },
        seo_description: { type: "string", description: "<=160 chars. Neutral, factual summary suitable for a Google snippet." },
        ai_summary: { type: "string", description: "1-2 sentences, <=280 chars. Neutral. Only facts present in the input." },
        people: { type: "array", items: { type: "string" }, description: "Up to 6 named people who SPEAK in the episode (guests, interviewees). NOT hosts. NOT people only mentioned. Use full names in original form (do not translate). Empty if none." },
        mentioned: { type: "array", items: { type: "string" }, description: "Up to 6 named people TALKED ABOUT but NOT PRESENT in the episode. Politicians, public figures, business leaders go here by default unless the metadata clearly states they speak. Original form. Empty if none." },
        companies: { type: "array", items: { type: "string" }, description: "Up to 6 named organizations or companies explicitly mentioned. Original form. Empty if none." },
        tickers: { type: "array", items: { type: "string" }, description: "Up to 6 stock ticker symbols (uppercase, e.g. 'AAPL', 'OTP'). Empty if none." },
        topics: { type: "array", items: { type: "string" }, description: "Up to 6 short topic tags (1-3 words each, lowercase) in the source language. Empty if none." },
        detected_language: { type: "string", description: "ISO 639-1 code (e.g. 'en','hu','es','yo','fa','ar','zh','hi') of the ACTUAL episode language inferred from title+description. If genuinely mixed/unknown, return 'mul'." },
      },
      required: ["seo_title", "seo_description", "ai_summary", "people", "mentioned", "companies", "tickers", "topics", "detected_language"],
      additionalProperties: false,
    },
  },
};

export const SYSTEM_PROMPT =
  "You write factual SEO metadata for podcast directory pages. You ONLY use the metadata supplied. " +
  "You never invent guests, hosts, claims, statistics, quotes, topics, or episode contents. " +
  "If the input is sparse, return short, generic, accurate text. No emojis. No clickbait. No marketing fluff. " +
  "CRITICAL LANGUAGE RULE: write ALL output fields (seo_title, seo_description, ai_summary) in the same language as the source podcast/episode metadata. " +
  "If the input is Hungarian, write in Hungarian. If English, write in English. Never translate or mix languages. " +
  "CRITICAL PERSON RULE: distinguish between people who SPEAK in the episode (`people`) and people only TALKED ABOUT (`mentioned`). Politicians and public figures default to `mentioned`. Never include show hosts (a list is provided in the user message) in either list. " +
  "TRANSCRIPT RULE: if a 'Transcript excerpt' block is provided in the user message, treat it as the PRIMARY source of truth for ai_summary, topics, people, mentioned, companies and tickers. The Description is then only supplementary context. People who are quoted/speaking in the transcript belong in `people`; people referenced by name but not speaking belong in `mentioned`.";

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

export function episodeUserPrompt(
  e: { display_title?: string|null; title: string; description?: string|null; language?: string|null },
  podName: string,
  podLanguage?: string | null,
  hosts?: string[] | null,
) {
  const name = e.display_title || e.title;
  const desc = (e.description || "").replace(/\s+/g, " ").trim().slice(0, 2500);
  const code = langCode(e.language) || langCode(podLanguage);
  const langLine = code ? `Output language: ${langName(code)} (${code}). Write seo_title, seo_description, and ai_summary in this language only.\n` : "";
  const hostList = Array.isArray(hosts) && hosts.length > 0
    ? `Show hosts (DO NOT include any of these names in 'people' or 'mentioned' — they are the show creators, not episode subjects): ${hosts.join(", ")}\n`
    : "";
  return `${langLine}${hostList}Show: ${podName}\nEpisode: ${name}\nDescription: ${desc || "(none)"}\n\nWrite SEO title, SEO description, ai_summary, and extract entities. Remember: people = speakers, mentioned = talked-about-but-absent.`;
}

// Case-insensitive, accent-insensitive host filter helper.
// Removes any value from `arr` that matches a host name (after Unicode normalization).
export function filterHosts(arr: string[] | null | undefined, hosts: string[] | null | undefined): string[] {
  if (!Array.isArray(arr) || arr.length === 0) return [];
  if (!Array.isArray(hosts) || hosts.length === 0) return arr;
  const norm = (s: string) =>
    s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const hostSet = new Set(hosts.map(norm).filter(Boolean));
  return arr.filter((v) => !hostSet.has(norm(v)));
}

// crude stable hash for input dedup
export async function inputHash(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}
