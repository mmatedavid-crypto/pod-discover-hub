// Episode description cleaner: deterministic heuristics + optional AI fallback.
// Output is hash-cached in episode_clean_text. Never throws on AI failure; falls back to heuristic.
import { chatTokenCostUsd } from "./ai-pricing.ts";

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

// Strong footer markers — once we hit one, EVERYTHING after is footer.
// HU + EN. Case-insensitive, matched against trimmed line.
const FOOTER_MARKER_RX = [
  // social platform handles / "Follow us"
  /^\s*(?:facebook|instagram|tiktok|youtube|spotify|apple\s*podcasts?|x|twitter|linkedin|threads|patreon|discord|telegram|viber|mastodon|bluesky|snapchat|tumblr|pinterest|reddit|twitch|substack|whatsapp|messenger)\s*[:：\-–—|]/i,
  /^\s*(?:kövess|kövessetek|kövessen|kövessétek)\s+(?:minket|bennünket|engem|a\s+műsort)/i,
  /^\s*(?:iratkozz(?:atok)?\s+fel|feliratkozás|értesülj\s+elsőként)/i,
  /^\s*(?:támogasd|támogass(?:atok)?|támogatónk|támogatóink|a\s+műsor\s+támogatója|szponzorunk|szponzoraink)/i,
  /^\s*(?:follow\s+(?:us|me)|subscribe\s+(?:to|on)|support\s+(?:us|the\s+show)|our\s+sponsors?|sponsored\s+by|brought\s+to\s+you\s+by)/i,
  /^\s*(?:közösségi\s+média|elérhetőség(?:eink)?|kapcsolat(?:tartás)?|social\s+media|find\s+us\s+on|contact\s+us)\s*[:：]?/i,
  /^\s*(?:hallgasd|hallgassátok|hallgassa)\s+(?:meg\s+)?(?:a|az)?\s*(?:műsort|adást|podcastot|epizódot).*?(?:spotify|apple|youtube|deezer|pocket\s*casts)/i,
  /^\s*(?:weboldal|honlap|website|web)\s*[:：]\s*https?:\/\//i,
  /^\s*(?:email|e-mail|levelek|levél)\s*[:：]/i,
  /^\s*(?:vágó|hangszerkesztő|producer|szerkesztő|operatőr|rendező|főszerkesztő|grafika)\s*[:：]/i,
  /^\s*#\w+(?:\s+#\w+){2,}/, // hashtag wall (3+)
];

// Soft signals — a single line that "looks like" footer content.
function isFooterishLine(line: string): boolean {
  const s = line.trim();
  if (!s) return false;
  if (URL_RX.test(s)) { URL_RX.lastIndex = 0; return true; }
  if (/^[•\-–—*·]?\s*(?:https?:|www\.)/i.test(s)) return true;
  if (/^\s*#\w+/.test(s)) return true; // starts with hashtag
  if (/^[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]+\s*[:：]\s*$/.test(s)) return true; // "Facebook:" alone
  return false;
}

function isSubstantiveLine(line: string): boolean {
  const s = line.trim();
  if (s.length < 40) return false;
  if (isFooterishLine(s)) return false;
  const words = s.split(/\s+/).filter((w) => w.length > 2);
  return words.length >= 6;
}

function detectFooterStart(lines: string[]): number {
  // Find earliest STRONG footer marker, but only accept it if the tail from there
  // is dominated by footer-like content. Otherwise it's likely an intro plug at the top.
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    let isMarker = false;
    for (const rx of FOOTER_MARKER_RX) {
      if (rx.test(l)) { isMarker = true; break; }
    }
    if (!isMarker) continue;

    const tail = lines.slice(i);
    const nonEmpty = tail.filter((x) => x.trim().length > 0);
    if (nonEmpty.length === 0) continue;
    const substantive = nonEmpty.filter(isSubstantiveLine).length;
    if (substantive / nonEmpty.length < 0.2) return i;
  }
  // Fallback: bottom-up footer-line peel
  let run = 0;
  let runStart = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isFooterishLine(lines[i]) || lines[i].trim() === "") {
      if (run === 0) runStart = i;
      run++;
    } else {
      if (run >= 4) return runStart;
      run = 0;
      runStart = -1;
    }
  }
  if (run >= 4) return runStart;
  return -1;
}

export function heuristicClean(raw: string): { text: string; removed: string[] } {
  if (!raw) return { text: "", removed: [] };
  let t = String(raw);
  const removed: string[] = [];



  // Strip HTML first so footer detection sees real line structure
  if (HTML_RX.test(t)) { t = t.replace(HTML_RX, " "); removed.push("html"); }

  // Convert common inline separators ( | • · ) to newlines so "Facebook: ... | Instagram: ..." splits properly
  t = t.replace(/\s*[|•·]\s+/g, "\n");

  const lines = t.split(/\r?\n/);

  // 1) Detect & cut footer
  const footerStart = detectFooterStart(lines);
  let kept = footerStart >= 0 ? lines.slice(0, footerStart) : lines;
  if (footerStart >= 0) removed.push("footer_cut");

  // 2) Strip dense timestamp lists (chapter markers) when 4+ total
  let body = kept.join("\n");
  const tsMatches = body.match(TIMESTAMP_LINE_RX);
  if (tsMatches && tsMatches.length >= 4) {
    body = body.replace(TIMESTAMP_LINE_RX, "");
    removed.push("timestamps");
  }

  // 3) Strip leftover boilerplate sentences inside the kept body (safety net)
  let boilerHit = false;
  for (const rx of BOILERPLATE_RX) {
    if (rx.test(body)) { boilerHit = true; body = body.replace(rx, ""); }
  }
  if (boilerHit) removed.push("boilerplate_phrases");

  // 4) Strip any remaining inline URLs in the kept body
  if (URL_RX.test(body)) { body = body.replace(URL_RX, ""); removed.push("inline_urls"); }
  URL_RX.lastIndex = 0;

  // 5) Whitespace normalize
  body = body.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").replace(MULTI_WHITESPACE, " ").trim();

  return { text: body, removed };
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
  const outTok = Number(ai.usage?.completion_tokens || Math.ceil(ai.cleaned_text.length / 4)) + Number(ai.usage?.completion_tokens_details?.reasoning_tokens || 0);
  const cost = chatTokenCostUsd(model, inTok, outTok);
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
