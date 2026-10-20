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

const URL_RX = /https?:\/\/\S+/gi;
const BARE_URL_RX = /\b(?:www\.|(?:open\.)?spotify\.com|podcasts\.apple\.com|music\.apple\.com|youtube\.com|youtu\.be|instagram\.com|facebook\.com|fb\.com|tiktok\.com|patreon\.com|discord\.gg|discord\.com|linktr\.ee|bio\.link|substack\.com|ko-fi\.com)\/?\S*/gi;
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

function wordCount(input: string): number {
  return (String(input || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]+/gu) || []).length;
}

function splitSentencesKeep(input: string): string[] {
  return input.match(/[^.!?\n]+(?:[.!?]+["”»)]?|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

/** Decode entities and turn HTML block tags into line breaks without inventing text. */
export function htmlToPlain(raw: string): string {
  let t = String(raw || "");
  t = t.replace(/<\s*br\s*\/?\s*>/gi, "\n").replace(/<\/\s*(?:p|div|li|h[1-6]|tr)\s*>/gi, "\n").replace(/<[^>]+>/g, " ");
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
  t = t.replace(URL_RX, " ").replace(BARE_URL_RX, " ").replace(EMAIL_RX, " ").replace(HANDLE_RX, "$1");
  if (t !== before) removed.add("links_handles");
  URL_RX.lastIndex = 0; BARE_URL_RX.lastIndex = 0; EMAIL_RX.lastIndex = 0; HANDLE_RX.lastIndex = 0;
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
    const keptSentences = sentences.filter((s) => {
      if (CTA_SENTENCE_RX.test(s) && wordCount(s) <= 30) { removed.add("cta_sentences"); return false; }
      return true;
    });
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
  if (/(^|\s)@[A-Za-z0-9._-]{2,}/.test(clean)) reasons.push("residual_handle");
  if (/\b(?:undefined|null|\[object Object\])\b/.test(clean)) reasons.push("placeholder_text");
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
