// Deterministic ($0) quality gate for clean-text writes.
//
// The deterministic_v4 cleaner (heuristicClean) is kept byte-for-byte for rows
// it handles well, so the existing corpus does not drift. This module only
// decides whether a v4 output may be written, and when it may not, offers a
// conservative extract-only rescue (URLs/handles/hashtag walls/CTA sentences
// removed, everything else kept verbatim). Nothing here calls an AI model.
import {
  decodeBasicEntities,
  heuristicClean,
  validateExtractOnlyTrim,
} from "./episode-text-cleaner.ts";

export const CLEAN_TEXT_QUALITY_VERSION = "clean_text_quality_v1";
export const RESCUE_METHOD_SUFFIX = "rescue_v1";
/** Prior clean text shorter than this is not treated as "good" text worth preserving. */
export const MIN_PRIOR_GOOD_CHARS = 40;

export type CleanVerdictStatus = "valid" | "valid_short" | "no_content" | "invalid";

export type CleanVerdict = {
  status: CleanVerdictStatus;
  reasons: string[];
  metrics: {
    raw_len: number;
    content_len: number;
    content_words: number;
    clean_len: number;
    clean_words: number;
    retention_vs_content: number;
  };
};

export type CleanDecision =
  | {
    action: "write";
    text: string;
    removed: string[];
    rescued: boolean;
    verdict: CleanVerdict;
    v4_verdict: CleanVerdict;
  }
  | { action: "keep_prior"; reasons: string[]; verdict: CleanVerdict }
  | { action: "skip_no_content"; reasons: string[]; verdict: CleanVerdict }
  | { action: "quarantine"; reasons: string[]; verdict: CleanVerdict; rescue_len: number };

const URL_RX = /https?:\/\/\s?\S*/gi;
const DOMAIN_RX = /\b(?:[a-z0-9-]+\.)+(?:hu|com|org|net|io|ai|me|fm|tv|co|ro|sk|rs|at|de|eu|uk|app|link|ee|gg|ly|info|store|shop|blog|page|site)\b(?:\/[^\s]*)?/gi;
const BARE_URL_RX = /\b(?:www\.|(?:open\.)?spotify\.com|podcasts\.apple\.com|music\.apple\.com|youtube\.com|youtu\.be|instagram\.com|facebook\.com|fb\.com|tiktok\.com|patreon\.com|discord\.gg|discord\.com|linktr\.ee|bio\.link|substack\.com|ko-fi\.com)\/?\S*/gi;
const GLUED_WWW_RX = /www\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*?\.(?:hu|com|org|net|io|ai|me|fm|tv|co|ro|de|eu|app|link|info|shop|blog)(?![a-z0-9])(?:\/[^\s]*)?/g;
const EMAIL_RX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const HANDLE_RX = /(^|[\s([{"'„“])@[A-Za-z0-9._-]{2,}/g;
const ZERO_WIDTH_RX = /[\u200B-\u200D\u2060\uFEFF]/g;
const HASHTAG_RUN_RX = /(?:^|\s)(?:#[\p{L}\p{N}_]+(?:[\s,]+|$)){2,}/gu;
const PLATFORM_WORDS = "facebook|instagram|insta|tiktok|youtube|yt|spotify|apple\\s*podcasts?|patreon|discord|telegram|linkedin|threads|twitter|x|bluesky|weboldal|honlap|website|web|e-?mail|email|honlap|podcast|rss|deezer|google\\s*podcasts?|soundcloud";
const DANGLING_LABEL_RX = new RegExp(
  `(?:^|\\s)[^\\p{L}\\p{N}\\s]{0,3}\\s*(?:${PLATFORM_WORDS})\\s*[-–—:：]\\s*(?=$|\\n|[^\\p{L}\\p{N}\\s]{0,3}\\s*(?:${PLATFORM_WORDS})\\s*[-–—:：])`,
  "giu",
);
const SHORT_FOOTER_LINE_RX = new RegExp(
  `^[^\\p{L}\\p{N}]{0,4}(?:${PLATFORM_WORDS}|linkek|links?|elérhetőség(?:eink)?|kapcsolat|kövess(?:etek|en)?(?:\\s+minket)?|iratkozz\\s+fel|támogatóink|hol\\s+érheted\\s+el[^:]{0,40})\\b[^\\p{L}\\p{N}]{0,4}(?:[:：-]|$)`,
  "iu",
);
const CTA_SENTENCE_RX =
  /(?:\b(?:kövesd|kövess(?:etek|en|étek)?|iratkozz(?:atok)?\s+fel|feliratkoz\w*|támogasd|támogass(?:atok)?|támogatni\s+szeretn\w+|hívj\s+meg\s+egy\s+kávéra|meghívnál\s+minket|adomány\w*|bankszámla\w*|közleménybe\s+kérjük|patreon|ko-fi|subscribe|follow\s+us|support\s+(?:us|the\s+show)|learn\s+more\s+about\s+your\s+ad\s+choices|hol\s+érheted\s+el|minden\s+jog\s+fenntartva|all\s+rights\s+reserved)\b|©)/i;

const RESIDUAL_URL_FRAGMENT_RX = /(?:^|[\s.])(?:ly|hu|com|net|org|io)\/[\p{L}\p{N}_-]|\.\s(?:hu|com|ly)\/(?:\s|$)/iu;

// Names, topics and timecodes: capitalised words and mm:ss stamps.
const NAMED_TOKEN_RX = /\d{1,2}:\d{2}(?::\d{2})?|\p{Lu}[\p{L}'’-]{2,}/gu;
const NON_CONTENT_TOKEN_RX = new RegExp(
  `^(?:${PLATFORM_WORDS}|linkek?|links?|kövess\\p{L}*|kövesd|iratkozz\\p{L}*|támogass\\p{L}*|támogasd|támogatni|köszönjük|köszönöm|kapcsolódj|csatlakozz\\p{L}*|hallgasd|nézd|hírlevél\\p{L}*|hírlevel\\p{L}*|webshop|weboldal\\p{L}*|honlap\\p{L}*|podcast\\p{L}*|adomány\\p{L}*|bankszámla\\p{L}*|paypal|donably|ko-fi|revolut|learn|visit|support|subscribe|follow)$`,
  "iu",
);

/**
 * Names / topics / timecodes present in `from` but absent from `to`
 * (platform, link and call-to-action words are not counted as content).
 */
export function lostNamedTokens(from: string, to: string): string[] {
  const target = String(to || "");
  const out = new Set<string>();
  for (const t of String(from || "").match(NAMED_TOKEN_RX) || []) {
    if (NON_CONTENT_TOKEN_RX.test(t)) continue;
    if (!target.includes(t)) out.add(t);
  }
  return Array.from(out);
}

function wordCount(input: string): number {
  return (String(input || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]+/gu) || []).length;
}


/** Split only where whitespace follows sentence punctuation, so "Podcastle.ai" or "1.5" stay intact. */
function splitSentencesKeep(input: string): string[] {
  return input.split(/(?<=[.!?…]["”»)]?)\s+/).map((s) => s.trim()).filter(Boolean);
}

/**
 * Drop a call-to-action/legal sentence when it is short or starts with the CTA;
 * when the CTA appears late in a long run-on sentence, keep the text before it.
 */
function stripCtaFromSentence(sentence: string): string | null {
  const m = CTA_SENTENCE_RX.exec(sentence);
  if (!m) return sentence;
  const words = wordCount(sentence);
  const before = sentence.slice(0, m.index).replace(/[\s\p{P}\p{S}]+$/u, "").trim();
  if (words <= 14 || wordCount(before) < 6) return null;
  return before;
}

/** Decode entities and turn HTML block tags into line breaks without inventing text. */
export function htmlToPlain(raw: string): string {
  let t = String(raw || "");
  t = t.replace(/<\s*br\s*\/?\s*>/gi, "\n").replace(/<\/\s*(?:p|div|li|h[1-6]|tr)\s*>/gi, "\n").replace(/<[^>]+>/g, " ");
  // Descriptions truncated mid-tag (e.g. at 3000 chars) leave an unclosed "<a href=..." tail.
  t = t.replace(/<[A-Za-z\/][^>]*$/, " ");
  t = decodeBasicEntities(t);
  return t.replace(ZERO_WIDTH_RX, "");
}

/**
 * Conservative extract-only rescue. Removes only link/handle/hashtag noise,
 * short footer label lines and short call-to-action/legal sentences; keeps all
 * other wording verbatim and in order.
 */
export function conservativeRescueClean(raw: string): { text: string; removed: string[] } {
  const removed = new Set<string>();
  let t = htmlToPlain(raw);
  const before = t;
  t = t.replace(URL_RX, " ").replace(EMAIL_RX, " ").replace(GLUED_WWW_RX, " ").replace(BARE_URL_RX, " ").replace(DOMAIN_RX, " ").replace(HANDLE_RX, "$1");
  if (t !== before) removed.add("links_handles");
  URL_RX.lastIndex = 0; BARE_URL_RX.lastIndex = 0; DOMAIN_RX.lastIndex = 0; GLUED_WWW_RX.lastIndex = 0; EMAIL_RX.lastIndex = 0; HANDLE_RX.lastIndex = 0;
  t = t.replace(/\s*[|•·]\s+/g, "\n");

  const keptLines: string[] = [];
  for (const rawLine of t.split(/\r?\n/)) {
    let line = rawLine.replace(HASHTAG_RUN_RX, (m) => { removed.add("hashtag_wall"); return m.startsWith(" ") ? " " : ""; });
    for (let i = 0; i < 4; i++) {
      DANGLING_LABEL_RX.lastIndex = 0;
      const next = line.replace(DANGLING_LABEL_RX, " ");
      if (next === line) break;
      removed.add("dangling_labels");
      line = next;
    }
    line = line.replace(/[ \t]+/g, " ").trim();
    if (!line) continue;
    if (wordCount(line) === 0) { removed.add("symbol_lines"); continue; }
    if (line.length < 80 && SHORT_FOOTER_LINE_RX.test(line)) { removed.add("footer_label_lines"); continue; }
    const sentences = splitSentencesKeep(line);
    const keptSentences: string[] = [];
    for (const s of sentences) {
      const kept = stripCtaFromSentence(s);
      if (kept !== s) removed.add("cta_sentences");
      if (kept) keptSentences.push(kept);
    }
    const joined = keptSentences.join(" ").trim();
    if (joined && wordCount(joined) > 0) keptLines.push(joined);
  }
  const text = keptLines.join("\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  return { text, removed: Array.from(removed) };
}

/** Validate a cleaned text against its source. Never compares against raw link noise. */
export function validateCleanOutput(raw: string, cleaned: string): CleanVerdict {
  const rawLen = String(raw || "").trim().length;
  const content = conservativeRescueClean(raw).text;
  const contentLen = content.length;
  const contentWords = wordCount(content);
  const clean = String(cleaned || "").trim();
  const cleanLen = clean.length;
  const cleanWords = wordCount(clean);
  const retention = contentLen > 0 ? cleanLen / contentLen : 0;
  const metrics = {
    raw_len: rawLen,
    content_len: contentLen,
    content_words: contentWords,
    clean_len: cleanLen,
    clean_words: cleanWords,
    retention_vs_content: Number(retention.toFixed(4)),
  };
  const reasons: string[] = [];

  if (/https?:\/\/|www\.[a-z0-9-]+\./i.test(clean)) reasons.push("residual_url");
  // Half-removed links such as "bit. ly/x" → "ly/x" or ". hvg. hu/".
  else if (RESIDUAL_URL_FRAGMENT_RX.test(clean)) reasons.push("residual_url_fragment");
  if (/(^|\s)@[A-Za-z0-9._-]{2,}/.test(clean)) reasons.push("residual_handle");
  if (/\b(?:undefined|null|\[object Object\])\b/.test(clean)) reasons.push("placeholder_text");
  if (/<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>|<a\s+href/i.test(clean)) reasons.push("residual_html");
  const malformed = reasons.length > 0;

  const substantive = contentLen >= 160 && contentWords >= 25;
  if (!substantive) {
    if (!clean) {
      if (contentLen >= 60 && contentWords >= 8) {
        return { status: "invalid", reasons: [...reasons, "empty_for_nonempty_content"], metrics };
      }
      return { status: "no_content", reasons: [...reasons, "no_substantive_source_content"], metrics };
    }
    if (malformed) return { status: "invalid", reasons, metrics };
    return { status: cleanLen < 100 ? "valid_short" : "valid", reasons: cleanLen < 100 ? ["short_source"] : [], metrics };
  }

  if (!clean) return { status: "invalid", reasons: [...reasons, "empty_for_substantive_source"], metrics };
  if (((cleanLen < 80 || cleanWords < 12) && retention < 0.25) || retention < 0.10) {
    reasons.push("severe_overcut");
  }
  if (reasons.length) return { status: "invalid", reasons, metrics };
  return { status: cleanLen < 100 ? "valid_short" : "valid", reasons: cleanLen < 100 ? ["short_but_proportional"] : [], metrics };
}

export function isPriorGood(prior: string | null | undefined): boolean {
  const s = String(prior || "").trim();
  return s.length >= MIN_PRIOR_GOOD_CHARS && !/https?:\/\//i.test(s);
}

/**
 * Decide what the runner may persist for one episode.
 * - valid v4 output → write as-is (no corpus drift)
 * - invalid v4 → extract-only rescue if it validates
 * - otherwise preserve prior good text, or skip/quarantine; never write empty/overcut text as done
 */
export function decideCleanText(input: {
  raw: string;
  v4?: { text: string; removed: string[] };
  priorCleanedText?: string | null;
}): CleanDecision {
  const raw = String(input.raw || "");
  const v4 = input.v4 ?? heuristicClean(raw);
  const v4Text = String(v4.text || "").trim();
  const v4Verdict = validateCleanOutput(raw, v4Text);
  const hasPrior = isPriorGood(input.priorCleanedText);

  if (v4Verdict.status === "valid" || v4Verdict.status === "valid_short") {
    // v4 sometimes drops guest/host credit lines, topic lists or timecodes. When the
    // extract-only rescue keeps them (and loses nothing v4 kept), prefer the rescue.
    const rescueAlt = conservativeRescueClean(raw);
    const lost = lostNamedTokens(rescueAlt.text, v4Text);
    if (lost.length >= MIN_LOST_NAMED_TOKENS && lostNamedTokens(v4Text, rescueAlt.text).length === 0) {
      const altVerdict = validateCleanOutput(raw, rescueAlt.text);
      const altExtract = validateExtractOnlyTrim(htmlToPlain(raw), rescueAlt.text, { minOverlap: 0.97, maxAddedTokenRatio: 0.03, minCompressionRatio: 0 });
      if ((altVerdict.status === "valid" || altVerdict.status === "valid_short") && altExtract.ok) {
        return {
          action: "write",
          text: rescueAlt.text,
          removed: Array.from(new Set([...rescueAlt.removed, RESCUE_METHOD_SUFFIX, "v4_dropped_named_content"])),
          rescued: true,
          verdict: altVerdict,
          v4_verdict: v4Verdict,
        };
      }
    }
    return { action: "write", text: v4Text, removed: [...v4.removed], rescued: false, verdict: v4Verdict, v4_verdict: v4Verdict };
  }
  if (v4Verdict.status === "no_content") {
    return hasPrior
      ? { action: "keep_prior", reasons: v4Verdict.reasons, verdict: v4Verdict }
      : { action: "skip_no_content", reasons: v4Verdict.reasons, verdict: v4Verdict };
  }

  const rescue = conservativeRescueClean(raw);
  const rescueVerdict = validateCleanOutput(raw, rescue.text);
  const extract = validateExtractOnlyTrim(htmlToPlain(raw), rescue.text, { minOverlap: 0.97, maxAddedTokenRatio: 0.03, minCompressionRatio: 0 });
  if ((rescueVerdict.status === "valid" || rescueVerdict.status === "valid_short") && extract.ok) {
    return {
      action: "write",
      text: rescue.text,
      removed: Array.from(new Set([...rescue.removed, RESCUE_METHOD_SUFFIX, ...v4Verdict.reasons.map((r) => `v4_${r}`)])),
      rescued: true,
      verdict: rescueVerdict,
      v4_verdict: v4Verdict,
    };
  }
  const reasons = Array.from(new Set([
    ...v4Verdict.reasons.map((r) => `v4_${r}`),
    ...rescueVerdict.reasons.map((r) => `rescue_${r}`),
    ...extract.reasons.map((r) => `rescue_${r}`),
  ]));
  if (hasPrior) return { action: "keep_prior", reasons, verdict: v4Verdict };
  return { action: "quarantine", reasons, verdict: v4Verdict, rescue_len: rescue.text.length };
}

export const MAX_QUARANTINE_ATTEMPTS = 3;
