// Episode description cleaner: deterministic heuristics + optional AI fallback.
// Output is hash-cached in episode_clean_text. Never throws on AI failure; falls back to heuristic.

export type CleanerCtrl = {
  enabled?: boolean;
  ai_enabled?: boolean;
  ai_model?: string;
  daily_budget_usd?: number;
  min_chars_for_ai?: number;
  always_heuristic?: boolean;
};

export type CleanResult = {
  cleaned_text: string;
  removed_categories: string[];
  cleaner_method: "heuristic" | "ai" | "ai+heuristic" | "none";
  model?: string;
  cost_usd?: number;
};

// Common boilerplate substrings (case-insensitive, HU + EN). Kept short and conservative.
const BOILERPLATE_RX = [
  /subscribe (?:to|on) [^.\n]+/gi,
  /follow us on [^.\n]+/gi,
  /support (?:us|the show) on patreon[^.\n]*/gi,
  /iratkozz fel[^.\n]*/gi,
  /kövess (?:minket|bennünket) [^.\n]*/gi,
  /támogasd (?:a műsort|minket)[^.\n]*/gi,
  /(?:hallgasd|hallgassa) (?:meg )?(?:a|az) [^.\n]{0,40} (?:spotify|apple|youtube)[^.\n]*/gi,
];

const URL_RX = /https?:\/\/\S+/gi;
const TIMESTAMP_LINE_RX = /^\s*\d{1,2}:\d{2}(?::\d{2})?\s+.+$/gm;
const MULTI_WHITESPACE = /\s{3,}/g;
const HTML_RX = /<[^>]+>/g;

export function heuristicClean(raw: string): { text: string; removed: string[] } {
  if (!raw) return { text: "", removed: [] };
  let t = String(raw);
  const removed: string[] = [];

  // Strip HTML
  if (HTML_RX.test(t)) { t = t.replace(HTML_RX, " "); removed.push("html"); }

  // Strip dense URL blocks: count urls per line, drop lines with >2 urls
  const lines = t.split(/\r?\n/);
  let urlLines = 0;
  const keptLines: string[] = [];
  for (const l of lines) {
    const m = l.match(URL_RX);
    if (m && m.length > 2) { urlLines++; continue; }
    keptLines.push(l);
  }
  if (urlLines > 0) removed.push("url_blocks");
  t = keptLines.join("\n");

  // Strip dense timestamp lists (chapter markers) when 4+ consecutive
  const tsMatches = t.match(TIMESTAMP_LINE_RX);
  if (tsMatches && tsMatches.length >= 4) {
    t = t.replace(TIMESTAMP_LINE_RX, "");
    removed.push("timestamps");
  }

  // Strip boilerplate sentences
  let boilerHit = false;
  for (const rx of BOILERPLATE_RX) {
    if (rx.test(t)) { boilerHit = true; t = t.replace(rx, ""); }
  }
  if (boilerHit) removed.push("boilerplate_phrases");

  // Strip remaining inline URLs (keep host text removed)
  t = t.replace(URL_RX, "");

  // Whitespace normalize
  t = t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").replace(MULTI_WHITESPACE, " ").trim();

  return { text: t, removed };
}

const AI_TOOL = {
  type: "function",
  function: {
    name: "clean_episode_description",
    description: "Return only the substantive editorial content of a podcast episode description.",
    parameters: {
      type: "object",
      properties: {
        cleaned_text: { type: "string", description: "Editorial content only — no ads, sponsors, social plugs, repeated intros/outros, link lists, calls to action." },
        removed_categories: { type: "array", items: { type: "string", enum: ["sponsor", "ad", "intro_outro", "links", "cta", "social", "repetitive", "other"] } },
      },
      required: ["cleaned_text", "removed_categories"],
      additionalProperties: false,
    },
  },
};

const CLEANER_SYSTEM = `You clean podcast episode descriptions for a semantic search index.
Keep: topic discussion, guest bios, names, factual claims, key takeaways.
Remove: sponsor reads, ad copy, recurring podcast intro/outro boilerplate, link lists, calls to action, "subscribe / follow / patreon" plugs, social media handles.
Preserve original language. Do not translate. Do not paraphrase substantive content. If the entire input is boilerplate, return an empty string.`;

async function callAICleaner(model: string, text: string): Promise<{ cleaned_text: string; removed_categories: string[]; usage?: any } | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: CLEANER_SYSTEM },
          { role: "user", content: text.slice(0, 14000) },
        ],
        tools: [AI_TOOL],
        tool_choice: { type: "function", function: { name: "clean_episode_description" } },
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const call = j.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) return null;
    const args = JSON.parse(call.function?.arguments || "{}");
    if (typeof args.cleaned_text !== "string") return null;
    return {
      cleaned_text: args.cleaned_text,
      removed_categories: Array.isArray(args.removed_categories) ? args.removed_categories : [],
      usage: j.usage,
    };
  } catch {
    return null;
  }
}

// Lovable AI Flash-Lite rough pricing per 1k tokens
const AI_PRICE_IN_PER_1K = 0.000019;
const AI_PRICE_OUT_PER_1K = 0.000076;

export async function cleanEpisodeText(
  raw: string,
  ctrl: CleanerCtrl,
  opts: { aiBudgetRemainingUsd: number }
): Promise<CleanResult> {
  if (!raw || !raw.trim()) {
    return { cleaned_text: "", removed_categories: [], cleaner_method: "none" };
  }

  const h = heuristicClean(raw);
  const minForAi = Number(ctrl.min_chars_for_ai ?? 2500);
  const aiAllowed = ctrl.enabled !== false && ctrl.ai_enabled !== false && opts.aiBudgetRemainingUsd > 0;

  // If heuristic already short enough, return as-is
  if (h.text.length < minForAi || !aiAllowed) {
    return { cleaned_text: h.text, removed_categories: h.removed, cleaner_method: "heuristic" };
  }

  const model = String(ctrl.ai_model || "google/gemini-3.1-flash-lite-preview");
  const ai = await callAICleaner(model, h.text);
  if (!ai) {
    return { cleaned_text: h.text, removed_categories: h.removed, cleaner_method: "heuristic" };
  }
  const inTok = Number(ai.usage?.prompt_tokens || Math.ceil(h.text.length / 4));
  const outTok = Number(ai.usage?.completion_tokens || Math.ceil(ai.cleaned_text.length / 4));
  const cost = (inTok / 1000) * AI_PRICE_IN_PER_1K + (outTok / 1000) * AI_PRICE_OUT_PER_1K;
  return {
    cleaned_text: ai.cleaned_text,
    removed_categories: Array.from(new Set([...h.removed, ...ai.removed_categories])),
    cleaner_method: "ai+heuristic",
    model,
    cost_usd: cost,
  };
}

// Chunker: split text into ~chunkChars windows with overlap; respect word boundaries.
export function chunkText(text: string, chunkChars: number, overlap: number): Array<{ content: string; char_start: number; char_end: number }> {
  if (!text || text.length === 0) return [];
  const out: Array<{ content: string; char_start: number; char_end: number }> = [];
  const n = text.length;
  let start = 0;
  while (start < n) {
    let end = Math.min(n, start + chunkChars);
    if (end < n) {
      // back off to nearest whitespace within last 200 chars
      const back = text.lastIndexOf(" ", end);
      if (back > start + chunkChars - 200) end = back;
    }
    const slice = text.slice(start, end).trim();
    if (slice.length > 0) out.push({ content: slice, char_start: start, char_end: end });
    if (end >= n) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
}
