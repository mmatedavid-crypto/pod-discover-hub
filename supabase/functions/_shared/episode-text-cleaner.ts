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
  /(?:amennyiben\s+szeretn[ée]\s+támogatni|ha\s+meghívnál\s+minket\s+egy\s+kávéra|patreon\s+támogatás|adomány(?:aikat)?|bankszámla(?:szám)?|közleménybe\s+kérjük)[^.\n]*/gi,
  /learn more about your ad choices\.?\s*visit\s+megaphone\.fm\/adchoices/gi,
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
const HTML_ENTITY_RX = /&(amp|nbsp|quot|apos|lt|gt);/gi;
const EXTENDED_HTML_ENTITY_RX = /&([a-zA-Z]+|#\d+|#x[0-9a-fA-F]+);/g;
const INLINE_FOOTER_START_RX =
  /\s(?:--+|—|–)?\s*(?:hasznos\s+linkek|linkek|additional\s+resources|contact\s+information|jogi\s+(?:nyilatkozat|figyelmeztetés)|disclaimer|legal\s+(?:notice|disclaimer)|támogatóink|tamogatoink|támogatók|tamogatok|money\s+mentoring|(?:a\s+)?podcast(?:\s+műsor)?\s+támogatója|(?:a\s+)?műsor\s+partnerei|közösségi\s+média|social\s+(?:links?|media)|show\s+notes|shownotes|get\s+full\s+access)\s*[:：]?/i;
const CTA_LABEL_RX =
  /(?:^|\s)(?:kövesd|kövess(?:etek|en)?|iratkozz(?:atok)?\s+fel|köszönjük,\s+ha|koszonjuk,\s+ha|támogasd|támogass(?:atok)?|töltsd\s+le|nézz(?:étek)?|hallgass(?:átok)?|hallgasd|foglalj|jelentkezz|jelentkezzen|regisztrálj|regisztráljon|rendeld\s+meg|részletek(?:\s+és\s+regisztráció)?|reszletek(?:\s+es\s+regisztracio)?|jogi\s+(?:nyilatkozat|figyelmeztetés)|disclaimer|legal|watch|listen|subscribe|follow|support|download|register|book\s+a\s+call|apply\s+for)\b[^:\n.!?]{0,180}[:：]\s*/gi;
const CTA_SENTENCE_RX = [
  /(?:^|[.!?]\s+)(?:kövesd|kövess(?:etek|en)?|iratkozz(?:atok)?\s+fel|támogasd|támogass(?:atok)?|töltsd\s+le|nézz(?:étek)?|hallgass(?:átok)?|hallgasd|foglalj|jelentkezz|jelentkezzen|regisztrálj|regisztráljon|rendeld\s+meg|vegye\s+kézbe|vedd\s+kézbe|watch|listen|subscribe|follow|support|download|register(?:\s+(?:now|here|today))?|book\s+a\s+call|apply\s+for)\b[^.!?\n]{0,260}(?:\.|!|\?|$)/gi,
  /(?:^|[.!?]\s+)(?:ne\s+felejts(?:etek)?\s+el\s+értékelni|ne\s+felejts(?:etek)?\s+el\s+ertekelni|részletek(?:\s+és\s+regisztráció)?|reszletek(?:\s+es\s+regisztracio)?|weboldalunkon|webinár|webinar|mentoring\s+nap|konzultáció|bestseller\s+könyv|jogi\s+(?:nyilatkozat|figyelmeztetés)|disclaimer|legal\s+(?:notice|disclaimer)?|email|e-?mail|website|weboldal|honlap|headshots|shoot\s+footage|edit\s+footage|patreon|discord|telegram|x\s+\(ex-twitter\)|bluesky|get\s+full\s+access)\b[^.!?\n]{0,300}(?:\.|!|\?|$)/gi,
];
const LEGAL_TAIL_RX = /\b(?:jogi\s+(?:nyilatkozat|figyelmeztetés)|disclaimer|legal\s+(?:notice|disclaimer)?|nem\s+minős(?:ül|íthető)[^.!?\n]{0,120}(?:befektetési|befektetésre|tanácsadás|ösztönzés)|not\s+(?:financial|investment|legal)\s+advice)\b/i;
const PROMO_SENTENCE_RX = /\b(?:foglalj|foglaljon|jelentkezz|jelentkezzen|regisztrálj|regisztráljon|rendeld\s+meg|rendelje\s+meg|vegye\s+kézbe|vedd\s+kézbe|részletek(?:\s+és\s+regisztráció)?|reszletek(?:\s+es\s+regisztracio)?|weboldalunkon|webinár|webinar|money\s+mentoring|mentoring\s+nap|konzultáció|bestseller\s+könyv|book\s+a\s+call|register(?:\s+(?:now|here|today))?|apply\s+for)\b/i;

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
  /^\s*(?:(?:a\s+)?podcast(?:\s+műsor)?\s+támogatója|(?:a\s+)?műsor\s+partnerei|get\s+full\s+access|this\s+is\s+a\s+free\s+preview\s+of\s+a\s+paid\s+episode)/i,
  /^\s*(?:amennyiben\s+szeretn[ée]\s+támogatni|ha\s+meghívnál\s+minket\s+egy\s+kávéra|adomány(?:aikat)?|bankszámla(?:szám)?|közleménybe\s+kérjük)/i,
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
  // Hashtag walls are footer noise; a single leading disclosure like
  // "#hirdetés ..." can be substantive and must not delete the whole line.
  if (/^(?:#[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű0-9_]+\s*){2,}$/.test(s)) return true;
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

function decodeBasicEntities(input: string): string {
  const basic = input.replace(HTML_ENTITY_RX, (_, entity: string) => {
    switch (entity.toLowerCase()) {
      case "amp": return "&";
      case "nbsp": return " ";
      case "quot": return "\"";
      case "apos": return "'";
      case "lt": return "<";
      case "gt": return ">";
      default: return "";
    }
  });
  const named: Record<string, string> = {
    aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
    Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
    ouml: "ö", uuml: "ü", Ouml: "Ö", Uuml: "Ü",
    ocirc: "ő", ucirc: "ű", Ocirc: "Ő", Ucirc: "Ű",
    otilde: "ő", utilde: "ű", Otilde: "Ő", Utilde: "Ű",
    ndash: "–", mdash: "—", hellip: "…", rsquo: "'", lsquo: "'", rdquo: "\"", ldquo: "\"",
  };
  return basic.replace(EXTENDED_HTML_ENTITY_RX, (match, entity: string) => {
    if (entity.startsWith("#x")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    }
    return named[entity] ?? match;
  });
}

function stripInlineFooterBlocks(input: string): { text: string; removed: string[] } {
  const marker = input.search(INLINE_FOOTER_START_RX);
  if (marker < 0) return { text: input, removed: [] };

  const before = input.slice(0, marker).trim();
  const after = input.slice(marker).trim();
  const beforeWords = before.split(/\s+/).filter((w) => w.length > 2).length;
  const afterHasTopicList = /\b(?:tartalom|téma|temak|témák|fejezetek)\s*[:：]/i.test(after);
  if (beforeWords >= 18 && !afterHasTopicList) {
    return { text: before, removed: ["inline_footer_cut"] };
  }
  return { text: input, removed: [] };
}

function stripCtaSentences(input: string): { text: string; removed: string[] } {
  let body = input;
  let hit = false;
  for (let i = 0; i < 3; i++) {
    CTA_LABEL_RX.lastIndex = 0;
    if (!CTA_LABEL_RX.test(body)) break;
    CTA_LABEL_RX.lastIndex = 0;
    hit = true;
    body = body.replace(CTA_LABEL_RX, " ");
  }
  CTA_LABEL_RX.lastIndex = 0;
  for (const rx of CTA_SENTENCE_RX) {
    rx.lastIndex = 0;
    if (rx.test(body)) {
      hit = true;
      body = body.replace(rx, (match) => (/^[.!?]\s+/.test(match) ? match.slice(0, 1) : ""));
    }
    rx.lastIndex = 0;
  }
  return { text: body, removed: hit ? ["cta_sentences"] : [] };
}

function sentenceWordCount(input: string): number {
  return input.split(/\s+/).filter((w) => /[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű0-9]{3,}/.test(w)).length;
}

function splitSentences(input: string): string[] {
  return input.match(/[^.!?\n]+(?:[.!?]+|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
}

function isFooterishSentence(sentence: string): boolean {
  const s = sentence.trim();
  if (!s) return false;
  if (LEGAL_TAIL_RX.test(s)) return true;
  if (PROMO_SENTENCE_RX.test(s)) return true;
  if (/(?:https?:\/\/|www\.|@|spotify|apple\s+podcasts?|youtube|instagram|facebook|tiktok|patreon|discord|telegram|linktr\.ee)/i.test(s)) return true;
  if (/(?:kövesd|kövess|iratkozz|feliratkoz|támogasd|támogass|támogatni|adomány|bankszámla|meghívnál\s+minket\s+egy\s+kávéra|hallgasd|nézd|nézzétek|learn\s+more\s+about\s+your\s+ad\s+choices|megaphone\.fm\/adchoices|listen|subscribe|follow|support|download)\b/i.test(s)) return true;
  if (/^(?:email|e-?mail|website|weboldal|honlap|additional\s+resources|contact\s+information|headshots|x\s+\(ex-twitter\)|bluesky)\s*[:：]/i.test(s)) return true;
  return false;
}

function stripSentenceFooterTail(input: string): { text: string; removed: string[] } {
  const normalized = input.trim();
  if (normalized.length < 500) return { text: input, removed: [] };

  const sentences = splitSentences(normalized);
  if (sentences.length < 3) return { text: input, removed: [] };

  for (let i = 1; i < sentences.length; i++) {
    const before = sentences.slice(0, i).join(" ").trim();
    const tail = sentences.slice(i);
    const beforeWords = sentenceWordCount(before);
    if (beforeWords < 18) continue;

    const tailText = tail.join(" ").trim();
    const tailWords = sentenceWordCount(tailText);
    if (tailWords < 8) continue;

    if (LEGAL_TAIL_RX.test(tail[0])) {
      return { text: before, removed: ["sentence_footer_tail_cut"] };
    }

    const footerish = tail.filter(isFooterishSentence).length;
    const ratio = footerish / tail.length;
    const firstTwoFooterish = tail.slice(0, 2).filter(isFooterishSentence).length;
    if (ratio >= 0.5 && firstTwoFooterish >= 1) {
      return { text: before, removed: ["sentence_footer_tail_cut"] };
    }
  }

  return { text: input, removed: [] };
}

function stripDanglingLabels(input: string): { text: string; removed: string[] } {
  const labels =
    /(?:^|\n|\s)(?:facebook|instagram|insta|tiktok|youtube|yt|spotify|apple\s*podcasts?|patreon|discord|telegram|linkedin|threads|twitter|x \(ex-twitter\)|bluesky|email|e-?mail|website|weboldal|honlap|headshots|additional resources|contact information|work with [^:\n]{1,40}|apply for a consultation|shoot footage for your reel|edit footage into a reel|telegram csatornánk|discord szerverünk|patreon oldalunk|támogatóink|tamogatoink|kövesd|köszönjük, ha|töltsd le és hallgasd|biblia egy év alatt kihívás|részletek(?:\s+és\s+regisztráció)?|reszletek(?:\s+es\s+regisztracio)?|jogi\s+(?:nyilatkozat|figyelmeztetés)|disclaimer|legal)\s*[:：]\s*(?=$|\n|[A-ZÁÉÍÓÖŐÚÜŰ])/gi;
  if (!labels.test(input)) return { text: input, removed: [] };
  labels.lastIndex = 0;
  let text = input;
  for (let i = 0; i < 5; i++) {
    labels.lastIndex = 0;
    if (!labels.test(text)) break;
    labels.lastIndex = 0;
    text = text.replace(labels, " ");
  }
  return { text, removed: ["dangling_labels"] };
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
  let t = decodeBasicEntities(String(raw));
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

  const inlineFooter = stripInlineFooterBlocks(body);
  body = inlineFooter.text;
  removed.push(...inlineFooter.removed);

  const preCtaStripped = stripInlineNoise(body);
  body = preCtaStripped.text;
  removed.push(...preCtaStripped.removed);

  const sentenceFooterBeforeCta = stripSentenceFooterTail(body);
  body = sentenceFooterBeforeCta.text;
  removed.push(...sentenceFooterBeforeCta.removed);

  const ctaStripped = stripCtaSentences(body);
  body = ctaStripped.text;
  removed.push(...ctaStripped.removed);

  const sentenceFooter = stripSentenceFooterTail(body);
  body = sentenceFooter.text;
  removed.push(...sentenceFooter.removed);

  // 4) Strip any remaining inline links, bare platform URLs, emails and handles.
  const stripped = stripInlineNoise(body);
  body = stripped.text;
  removed.push(...stripped.removed);

  const dangling = stripDanglingLabels(body);
  body = dangling.text;
  removed.push(...dangling.removed);

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

    const fallbackSentenceFooter = stripSentenceFooterTail(fallback);
    fallback = fallbackSentenceFooter.text;
    fallbackRemoved.push(...fallbackSentenceFooter.removed);

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

export type CleanTextQuality = {
  ok: boolean;
  needs_ai_trim: boolean;
  overcut_risk: boolean;
  dirty_signals: string[];
  reasons: string[];
  raw_len: number;
  clean_len: number;
  clean_ratio: number;
};

export type CleanTextRouteBucket =
  | "short_rss"
  | "radio_bulletin"
  | "long_narrative"
  | "yt_dominant"
  | "sponsor_heavy"
  | "over_trimmed_v3"
  | "paid_preview"
  | "non_hungarian"
  | "junk_no_content"
  | "transcript_or_article_like";

export type CleanTextRoute = {
  bucket: CleanTextRouteBucket;
  action: "deterministic" | "ai_trim" | "exclude" | "review";
  ai_policy: "none" | "flash_zero_shot" | "flash_lite_fewshot";
  reasons: string[];
};

const HU_SIGNAL_WORDS = new Set([
  "a", "az", "és", "hogy", "nem", "van", "egy", "két", "milyen", "miért", "hogyan",
  "adás", "epizód", "műsor", "beszélget", "beszélgetünk", "vendég", "magyar",
  "szerint", "közben", "után", "előtt", "erről", "arról", "témában",
]);
const FOREIGN_SIGNAL_WORDS = new Set([
  "the", "and", "with", "this", "that", "from", "about", "episode", "show", "song",
  "part", "track", "music", "library", "translation", "free", "preview", "paid",
  "visit", "more", "children", "introduction", "recorded", "narrated", "break",
  "asunder", "must", "liberation", "blue", "green", "white", "red",
  "le", "la", "les", "des", "avec", "pour", "dans", "émission", "esta", "uma",
]);

function wordTokens(input: string): string[] {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKC")
    .match(/[a-záéíóöőúüűàâäçèêëìîïñòôöùûÿß'-]+/giu) || [];
}

function countSignals(tokens: string[], set: Set<string>): number {
  return tokens.reduce((sum, token) => sum + (set.has(token) ? 1 : 0), 0);
}

function isLikelyNonHungarianEpisodeText(raw: string): boolean {
  const text = String(raw || "");
  const tokens = wordTokens(text);
  if (tokens.length < 8) return false;
  const hu = countSignals(tokens, HU_SIGNAL_WORDS);
  const foreign = countSignals(tokens, FOREIGN_SIGNAL_WORDS);
  const huAccentCount = (text.match(/[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/g) || []).length;
  const cyrillicOrCjk = /[\u0400-\u04FF\u3040-\u30FF\u3400-\u9FFF]/u.test(text);
  if (cyrillicOrCjk && hu < 3) return true;
  if (/^\s*translation\s*:/i.test(text) && hu === 0) return true;
  return hu <= 1 && huAccentCount <= 1 && foreign >= 4;
}

function isPaidPreviewText(raw: string): boolean {
  return /\b(?:this\s+is\s+a\s+free\s+preview\s+of\s+a\s+paid\s+episode|free\s+preview\s+of\s+a\s+paid\s+episode|ingyenes\s+részlet|fizetős\s+epizód|előfizetőknek|teljes\s+adás\s+előfizetőknek)\b/i.test(String(raw || ""));
}

function isPromoOnlyJunk(raw: string, cleaned: string): boolean {
  const text = String(raw || "");
  const clean = String(cleaned || "");
  const urlHits = (text.match(/https?:\/\/|www\.|bit\.ly|linktr\.ee|facebook|instagram|spotify|youtube|patreon|donably|subscribe|iratkozz|támogass|támogasd|weboldal|hírlevél|klubkártya/gi) || []).length;
  const cleanWords = wordTokens(clean).filter((token) => token.length >= 4);
  const topicWords = cleanWords.filter((token) => !FOREIGN_SIGNAL_WORDS.has(token) && !HU_SIGNAL_WORDS.has(token));
  return urlHits >= 5 && topicWords.length < 12;
}

function isTranscriptOrArticleLike(raw: string, cleaned: string): boolean {
  const text = String(cleaned || raw || "");
  const len = text.trim().length;
  if (len < 4500) return false;
  const sentenceCount = splitSentences(text).length;
  const timestampCount = (text.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g) || []).length;
  const firstPersonCount = (text.match(/\b(?:én|engem|nekem|szerintem|mesélek|beszéltem|gondolom)\b/gi) || []).length;
  return timestampCount >= 6 || sentenceCount >= 28 || firstPersonCount >= 8;
}

export type ExtractOnlyValidation = {
  ok: boolean;
  overlap: number;
  added_token_ratio: number;
  compression_ratio: number;
  reasons: string[];
};

function hasRadioBulletinShape(raw: string): boolean {
  const text = String(raw || "").trim();
  if (text.length > 1400) return false;
  if (/^\s*\d{4}[./-]\d{1,2}[./-]\d{1,2}\.?/.test(text)) return true;
  if (/\b(?:hírek|hirek|krónika|kronika|lapszemle|infórádió|inforádió|kossuth rádió|rádió|percről percre)\b/i.test(text) && text.length < 900) return true;
  const questions = (text.match(/\?/g) || []).length;
  return questions >= 3 && text.length < 700;
}

function hasSponsorHeavyShape(raw: string, cleaned: string, quality: CleanTextQuality): boolean {
  const joined = `${raw}\n${cleaned}`;
  if (quality.dirty_signals.some((signal) => ["cta", "legal", "url_or_platform", "hashtag_wall", "dangling_label"].includes(signal))) return true;
  return /\b(?:szponzor|támogató|támogasd|támogass|patreon|kuponkód|kedvezménykód|promóció|hirdetés|reklám|adomány|bankszámla|weboldalunkon|regisztráció|konzultáció|book\s+a\s+call|sponsored\s+by|support\s+us)\b/i.test(joined);
}

export function classifyCleanTextRoute(
  raw: string,
  deterministicCleaned: string,
  opts: { sourceType?: string | null; previousCleanedText?: string | null } = {},
): CleanTextRoute {
  const rawText = String(raw || "");
  const cleanText = String(deterministicCleaned || "");
  const quality = assessCleanTextQuality(rawText, cleanText);
  const rawLen = rawText.trim().length;
  const cleanLen = cleanText.trim().length;
  const sourceType = String(opts.sourceType || "").toLowerCase();
  const previousLen = String(opts.previousCleanedText || "").trim().length;
  const previousRatio = rawLen > 0 && previousLen > 0 ? previousLen / rawLen : null;
  const reasons: string[] = [];

  if (isPaidPreviewText(rawText)) {
    return { bucket: "paid_preview", action: "exclude", ai_policy: "none", reasons: ["paid_preview_or_free_excerpt"] };
  }

  if (isLikelyNonHungarianEpisodeText(rawText)) {
    return { bucket: "non_hungarian", action: "exclude", ai_policy: "none", reasons: ["non_hungarian_episode_text"] };
  }

  if (isPromoOnlyJunk(rawText, cleanText)) {
    return { bucket: "junk_no_content", action: "exclude", ai_policy: "none", reasons: ["promo_link_only_no_substantive_description"] };
  }

  if (quality.overcut_risk || (previousRatio != null && rawLen >= 500 && previousRatio < 0.20)) {
    reasons.push(...quality.reasons, "overtrim_risk");
    return { bucket: "over_trimmed_v3", action: "ai_trim", ai_policy: "flash_zero_shot", reasons: Array.from(new Set(reasons)) };
  }

  if (sourceType === "youtube" && rawLen >= 80) {
    reasons.push("youtube_best_source", ...quality.reasons, ...quality.dirty_signals.map((s) => `dirty_${s}`));
    return { bucket: "yt_dominant", action: "ai_trim", ai_policy: "flash_zero_shot", reasons: Array.from(new Set(reasons)) };
  }

  if (hasSponsorHeavyShape(rawText, cleanText, quality)) {
    reasons.push("sponsor_or_cta_heavy", ...quality.reasons, ...quality.dirty_signals.map((s) => `dirty_${s}`));
    return { bucket: "sponsor_heavy", action: "ai_trim", ai_policy: "flash_lite_fewshot", reasons: Array.from(new Set(reasons)) };
  }

  if (hasRadioBulletinShape(rawText)) {
    return { bucket: "radio_bulletin", action: "deterministic", ai_policy: "none", reasons: ["radio_bulletin_shape"] };
  }

  if (rawLen >= 2500) {
    if (isTranscriptOrArticleLike(rawText, cleanText)) {
      return { bucket: "transcript_or_article_like", action: "review", ai_policy: "none", reasons: ["long_text_transcript_or_article_like"] };
    }
    return { bucket: "long_narrative", action: "deterministic", ai_policy: "none", reasons: ["long_narrative_keep_deterministic"] };
  }

  return { bucket: "short_rss", action: "deterministic", ai_policy: "none", reasons: ["short_or_clean_enough"] };
}

function comparableTokens(input: string): string[] {
  return String(input || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

export function validateExtractOnlyTrim(
  original: string,
  candidate: string,
  opts: { minOverlap?: number; maxAddedTokenRatio?: number; minCompressionRatio?: number } = {},
): ExtractOnlyValidation {
  const minOverlap = Number(opts.minOverlap ?? 0.90);
  const maxAddedTokenRatio = Number(opts.maxAddedTokenRatio ?? 0.08);
  const minCompressionRatio = Number(opts.minCompressionRatio ?? 0.05);
  const originalText = String(original || "").trim();
  const candidateText = String(candidate || "").trim();
  const reasons: string[] = [];

  if (!candidateText) reasons.push("empty_candidate");
  if (candidateText.length > originalText.length * 1.05) reasons.push("candidate_longer_than_original");

  const originalCounts = new Map<string, number>();
  for (const token of comparableTokens(originalText)) {
    originalCounts.set(token, (originalCounts.get(token) || 0) + 1);
  }
  const candidateTokens = comparableTokens(candidateText);
  let matched = 0;
  let added = 0;
  for (const token of candidateTokens) {
    const count = originalCounts.get(token) || 0;
    if (count > 0) {
      matched += 1;
      originalCounts.set(token, count - 1);
    } else {
      added += 1;
    }
  }

  const overlap = candidateTokens.length === 0 ? 0 : matched / candidateTokens.length;
  const addedTokenRatio = candidateTokens.length === 0 ? 1 : added / candidateTokens.length;
  const compressionRatio = originalText.length === 0 ? 0 : candidateText.length / originalText.length;

  if (overlap < minOverlap) reasons.push("low_original_overlap");
  if (addedTokenRatio > maxAddedTokenRatio) reasons.push("too_many_added_tokens");
  if (compressionRatio < minCompressionRatio && originalText.length >= 500) reasons.push("suspiciously_small_candidate");

  return {
    ok: reasons.length === 0,
    overlap: Number(overlap.toFixed(4)),
    added_token_ratio: Number(addedTokenRatio.toFixed(4)),
    compression_ratio: Number(compressionRatio.toFixed(4)),
    reasons: Array.from(new Set(reasons)),
  };
}

export function assessCleanTextQuality(raw: string, cleaned: string): CleanTextQuality {
  const rawText = String(raw || "");
  const cleanText = String(cleaned || "");
  const rawLen = rawText.trim().length;
  const cleanLen = cleanText.trim().length;
  const cleanRatio = rawLen > 0 ? cleanLen / rawLen : 0;
  const dirtySignals: string[] = [];
  const reasons: string[] = [];

  if (/https?:\/\/|www\.|(?:open\.)?spotify\.com|podcasts\.apple\.com|youtube\.com|youtu\.be|instagram\.com|facebook\.com|tiktok\.com|patreon\.com|linktr\.ee|megaphone\.fm|omnystudio\.com/i.test(cleanText)) {
    dirtySignals.push("url_or_platform");
  }
  if (/@[A-Za-z0-9_.-]+/.test(cleanText)) dirtySignals.push("handle");
  if (/\b(?:kövesd|kövess|iratkozz|feliratkoz|támogasd|támogass|adomány|bankszámla|hallgasd|nézd|nézzétek|listen|subscribe|follow|support|learn more about your ad choices)\b/i.test(cleanText)) {
    dirtySignals.push("cta");
  }
  if (/\b(?:jogi\s+(?:nyilatkozat|figyelmeztetés)|disclaimer|legal|not\s+(?:financial|investment|legal)\s+advice)\b/i.test(cleanText)) {
    dirtySignals.push("legal");
  }
  if (/(?:#[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű0-9_]+\s*){2,}/.test(cleanText)) dirtySignals.push("hashtag_wall");
  if (/\b(?:facebook|instagram|youtube|spotify|patreon|weboldal|honlap|e-?mail)\s*[:：]\s*(?:$|[A-ZÁÉÍÓÖŐÚÜŰ]|#)/i.test(cleanText)) {
    dirtySignals.push("dangling_label");
  }

  if (dirtySignals.length > 0) reasons.push("dirty_signals");
  if (rawLen >= 500 && cleanLen < 100) reasons.push("near_empty_after_long_input");
  if (rawLen >= 500 && cleanRatio < 0.35 && dirtySignals.length === 0) reasons.push("possible_overcut");
  if (rawLen >= 1500 && cleanRatio > 0.92 && /https?:\/\/|www\.|facebook|instagram|spotify|youtube|patreon|discord|kövesd|iratkozz|támogasd/i.test(rawText)) {
    reasons.push("possibly_undercleaned");
  }

  const overcutRisk = reasons.includes("near_empty_after_long_input") || reasons.includes("possible_overcut");
  const needsAiTrim = dirtySignals.length > 0 || reasons.includes("possibly_undercleaned");
  return {
    ok: !overcutRisk && !needsAiTrim,
    needs_ai_trim: needsAiTrim,
    overcut_risk: overcutRisk,
    dirty_signals: Array.from(new Set(dirtySignals)),
    reasons: Array.from(new Set(reasons)),
    raw_len: rawLen,
    clean_len: cleanLen,
    clean_ratio: Number(cleanRatio.toFixed(4)),
  };
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
