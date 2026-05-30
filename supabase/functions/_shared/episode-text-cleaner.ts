// Episode description cleaner: deterministic heuristics + optional AI fallback.
// Output is hash-cached in episode_clean_text. Never throws on AI failure; falls back to heuristic.
import { chatTokenCostUsd } from "./ai-pricing.ts";
import { callLovableAI } from "./lovable-ai.ts";

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
  /kövess(?:etek|étek|en| minket| bennünket)? [^.\n]*/gi,
  /(?:támogasd|támogass(?:atok)?) (?:a műsort|minket|a csatornát|a podcastot)[^.\n]*/gi,
  /(?:támogatás|tamogatas|patreon|donate|adomány|adomany)[^.\n]*(?:https?:\/\/|www\.|@)[^.\n]*/gi,
  /(?:linkek|show notes|shownotes|elérhetőség(?:eink)?|elerhetoseg(?:eink)?)[^.\n]*(?:https?:\/\/|www\.|@)[^.\n]*/gi,
  /(?:hallgasd|hallgassa) (?:meg )?(?:a|az) [^.\n]{0,40} (?:spotify|apple|youtube)[^.\n]*/gi,
];

const URL_RX = /https?:\/\/\S+/gi;
const BARE_URL_RX = /\b(?:www\.|(?:open\.)?spotify\.com|podcasts\.apple\.com|music\.apple\.com|youtube\.com|youtu\.be|instagram\.com|facebook\.com|fb\.com|tiktok\.com|patreon\.com|discord\.gg|discord\.com|linktr\.ee|bio\.link|substack\.com)\/?\S*/gi;
const EMAIL_RX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const HANDLE_RX = /(^|[\s([{"'„“])@[A-Za-z0-9._-]{2,}/g;
const TIMESTAMP_LINE_RX = /^\s*\d{1,2}:\d{2}(?::\d{2})?\s+.+$/gm;
const MULTI_WHITESPACE = /\s{3,}/g;
const HTML_RX = /<[^>]+>/g;

// Strong footer markers — once we hit one (and the rest of the doc is footer-dominated),
// EVERYTHING from that line on is dropped.
// HU + EN. Case-insensitive, matched against trimmed line.
const FOOTER_MARKER_RX = [
  // social platform names at line start (with or without separator)
  /^\s*(?:facebook|instagram|insta|tiktok|tik\s*tok|youtube|yt|spotify|apple\s*podcasts?|apple|twitter|linkedin|threads|patreon|discord|telegram|viber|mastodon|bluesky|snapchat|tumblr|pinterest|reddit|twitch|substack|whatsapp|messenger|deezer|pocket\s*casts|google\s*podcasts?|soundcloud|rumble|odysee|locals|buzzsprout|anchor|rss|fb|ig|tw)\b\s*[:：\-–—|@/]?/i,
  // "Follow us / Subscribe / Like" HU + EN
  /^\s*(?:kövess|kövessetek|kövessen|kövessétek|kövesd)\s+(?:minket|bennünket|engem|a\s+műsort|a\s+csatornát|a\s+podcastot|a\s+podcastunkat|az\s+oldalunkat)/i,
  /^\s*(?:iratkozz(?:atok)?\s+fel|feliratkoz(?:ás|hatsz|hattok)|értesülj\s+elsőként|like[- ]?old|lájkold|kedveld|oszd\s+meg|nyomj\s+egy\s+lájkot)/i,
  /^\s*(?:támogasd|támogass(?:atok)?|támogatónk|támogatóink|a\s+műsor\s+támogatója|szponzorunk|szponzoraink|szponzorált|szponzorálta|reklám|hirdetés)/i,
  /^\s*(?:follow\s+(?:us|me)|subscribe\s+(?:to|on)|support\s+(?:us|the\s+show)|our\s+sponsors?|sponsored\s+by|brought\s+to\s+you\s+by|listen\s+(?:on|to)|available\s+(?:on|now)|watch\s+on)/i,
  // "social media / contact" headings
  /^\s*(?:közösségi\s+média|elérhetőség(?:eink)?|kapcsolat(?:tartás|fel(?:vétel)?)?|social\s+(?:media|links?|channels?)|find\s+us\s+on|contact\s+us|kapcsolódj|csatlakozz)\s*[:：]?/i,
  // "listen / watch on …" HU
  /^\s*(?:hallgasd|hallgassátok|hallgassa|nézd|nézzétek|nézze)\s+(?:meg\s+)?(?:a|az)?\s*(?:műsort|adást|podcastot|epizódot|csatornát|videót|interjút)/i,
  /^\s*(?:meg(?:talál(?:hatsz|hattok|sz)?|hallgath(?:atsz|attok)?|nézh(?:etsz|etitek)?))\s+(?:minket|bennünket|a\s+műsort|a\s+podcastot)/i,
  /^\s*(?:elérhető|megtalálható|hallgatható|nézhető|követhető)\s+(?:a|az)?\s*(?:spotify|apple|youtube|deezer|facebook|instagram|tiktok)/i,
  // labelled link lines
  /^\s*(?:weboldal|honlap|website|web|link|linkek|forrás(?:ok)?)\s*[:：]/i,
  /^\s*(?:e-?mail|levél|leveleitek?|írj\s+nek[üi]nk|kérdés(?:eitek)?)\s*[:：@]/i,
  // production credits
  /^\s*(?:vágó|hangszerkesztő|hangmérnök|producer|szerkesztő|operatőr|rendező|főszerkesztő|grafika|design|zene|főcím(?:zene)?|intro|outro|narrátor|műsorvezető)\s*[:：]/i,
  // hashtag walls
  /^\s*#\w+(?:\s+#\w+)+/,
  /^\s*(?:#[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű0-9_]+\s*){2,}$/,
];

// Lines that look like a social/platform list item, URL, or labelled-link.
function isFooterishLine(line: string): boolean {
  const s = line.trim();
  if (!s) return false;
  // URLs
  if (/https?:\/\//i.test(s)) return true;
  if (/^[•\-–—*·]?\s*www\./i.test(s)) return true;
  // hashtag(s)
  if (/^#\w+/.test(s)) return true;
  // platform name at start
  if (/^(?:facebook|instagram|insta|tiktok|youtube|yt|spotify|apple\s*podcasts?|apple|twitter|linkedin|threads|patreon|discord|telegram|mastodon|bluesky|snapchat|whatsapp|messenger|deezer|pocket\s*casts|google\s*podcasts?|soundcloud|substack|rumble|odysee|locals|rss|fb|ig)\b/i.test(s)) return true;
  // @handle
  if (/^@[A-Za-z0-9._-]{2,}/.test(s)) return true;
  if (/^[•\-–—*·]?\s*(?:https?:\/\/|www\.|(?:open\.)?spotify\.com|podcasts\.apple\.com|youtube\.com|youtu\.be|instagram\.com|facebook\.com|tiktok\.com|patreon\.com|linktr\.ee)\b/i.test(s)) return true;
  // "Label:" alone or "Label: <link/handle>"
  if (/^[A-ZÁÉÍÓÖŐÚÜŰ][A-Za-záéíóöőúüű\s]{0,25}\s*[:：]\s*(?:https?:\/\/|www\.|@|$)/.test(s)) return true;
  // production credit line
  if (/^(?:vágó|hangszerkesztő|hangmérnök|producer|szerkesztő|operatőr|rendező|főszerkesztő|grafika|design|zene|narrátor|műsorvezető)\s*[:：]/i.test(s)) return true;
  return false;
}

function isSubstantiveLine(line: string): boolean {
  const s = line.trim();
  if (s.length < 40) return false;
  if (isFooterishLine(s)) return false;
  const words = s.split(/\s+/).filter((w) => w.length > 2);
  return words.length >= 6;
}

function stripInlineNoise(input: string): { text: string; removed: string[] } {
  let body = input;
  const removed: string[] = [];

  if (URL_RX.test(body)) {
    body = body.replace(URL_RX, "");
    removed.push("inline_urls");
  }
  URL_RX.lastIndex = 0;

  if (BARE_URL_RX.test(body)) {
    body = body.replace(BARE_URL_RX, "");
    removed.push("bare_urls");
  }
  BARE_URL_RX.lastIndex = 0;

  if (EMAIL_RX.test(body)) {
    body = body.replace(EMAIL_RX, "");
    removed.push("email");
  }
  EMAIL_RX.lastIndex = 0;

  if (HANDLE_RX.test(body)) {
    body = body.replace(HANDLE_RX, "$1");
    removed.push("social_handles");
  }
  HANDLE_RX.lastIndex = 0;

  const cleanedLines = body.split(/\r?\n/).filter((line) => {
    const s = line.trim();
    if (!s) return true;
    if (isFooterishLine(s)) {
      removed.push("footer_lines");
      return false;
    }
    if (/^(?:facebook|instagram|insta|tiktok|youtube|yt|spotify|apple podcasts?|patreon|discord|linkek|links?)\s*[:：]?\s*$/i.test(s)) {
      removed.push("orphan_link_labels");
      return false;
    }
    return true;
  });

  return { text: cleanedLines.join("\n"), removed: Array.from(new Set(removed)) };
}

function detectFooterStart(lines: string[]): number {
  // Find earliest STRONG footer marker; accept the cut if the tail from there
  // is dominated by footer-like content. Otherwise it's likely an intro plug.
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
    // v3: bumped from 0.20 -> 0.40 so mixed footers (with one stray sponsor sentence) still cut.
    if (substantive / nonEmpty.length < 0.4) return i;
  }
  // Bottom-up footer-line peel (v3: 4 -> 3 consecutive footer lines).
  let run = 0;
  let runStart = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isFooterishLine(lines[i]) || lines[i].trim() === "") {
      if (run === 0) runStart = i;
      run++;
    } else {
      if (run >= 3) return runStart;
      run = 0;
      runStart = -1;
    }
  }
  if (run >= 3) return runStart;
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
  const kept = footerStart >= 0 ? lines.slice(0, footerStart) : lines;
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
    rx.lastIndex = 0;
    if (rx.test(body)) { boilerHit = true; body = body.replace(rx, ""); }
    rx.lastIndex = 0;
  }
  if (boilerHit) removed.push("boilerplate_phrases");

  // 4) Strip any remaining inline links, bare platform URLs, emails and handles.
  const stripped = stripInlineNoise(body);
  body = stripped.text;
  removed.push(...stripped.removed);

  // 5) Whitespace normalize
  body = body.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").replace(MULTI_WHITESPACE, " ").trim();

  // Guardrail: do not let a false-positive footer marker erase a substantive
  // description. This happens in RSS feeds where the first line is a platform,
  // sponsor, or production-credit-like phrase but the rest still contains the
  // actual episode content. Keep URL/social stripping, but skip the footer cut.
  if (String(raw).trim().length > 500 && body.length < 80) {
    let fallback = String(raw);
    const fallbackRemoved: string[] = [];

    if (HTML_RX.test(fallback)) {
      fallback = fallback.replace(HTML_RX, " ");
      fallbackRemoved.push("html");
    }
    HTML_RX.lastIndex = 0;

    fallback = fallback.replace(/\s*[|•·]\s+/g, "\n");

    let boilerHit = false;
    for (const rx of BOILERPLATE_RX) {
      rx.lastIndex = 0;
      if (rx.test(fallback)) {
        boilerHit = true;
        fallback = fallback.replace(rx, "");
      }
    }
    if (boilerHit) fallbackRemoved.push("boilerplate_phrases");

    const strippedFallback = stripInlineNoise(fallback);
    fallback = strippedFallback.text;
    fallbackRemoved.push(...strippedFallback.removed);

    fallback = fallback.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").replace(MULTI_WHITESPACE, " ").trim();

    if (fallback.length >= 80) {
      return {
        text: fallback,
        removed: Array.from(new Set([...removed, ...fallbackRemoved, "footer_cut_reverted"])),
      };
    }
  }

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

type AiUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  completion_tokens_details?: { reasoning_tokens?: number };
};

async function callAICleaner(model: string, text: string): Promise<{ cleaned_text: string; removed_categories: string[]; usage?: AiUsage } | null> {
  try {
    const ai = await callLovableAI({
      model,
      job_type: "episode_text_cleaner",
      target_type: "episode",
      prompt_version: "episode-cleaner-v2",
      input_text: text,
      min_input_chars: 250,
      messages: [
        { role: "system", content: CLEANER_SYSTEM },
        { role: "user", content: text.slice(0, 14000) },
      ],
      tools: [AI_TOOL],
      tool_choice: { type: "function", function: { name: "clean_episode_description" } },
    });
    if (!ai.ok) return null;
    const j = ai.data;
    const call = j.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) return null;
    const args = JSON.parse(call.function?.arguments || "{}");
    if (typeof args.cleaned_text !== "string") return null;
    return {
      cleaned_text: args.cleaned_text,
      removed_categories: Array.isArray(args.removed_categories) ? args.removed_categories : [],
      usage: {
        prompt_tokens: ai.input_tokens || j.usage?.prompt_tokens || 0,
        completion_tokens: ai.output_tokens || j.usage?.completion_tokens || 0,
        completion_tokens_details: j.usage?.completion_tokens_details || {},
      },
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

  const model = String(ctrl.ai_model || "google/gemini-2.5-flash-lite");
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
