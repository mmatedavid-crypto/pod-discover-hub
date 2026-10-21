// Deterministic ($0) comparison of RSS vs. a verified YouTube description.
//
// Only informative content counts: links, handles, hashtag walls, CTA/legal
// lines and hosting/ad boilerplate (AdsWizz, Acast, Megaphone, Anchor …) are
// removed before comparing. A YouTube description is "better" only when it adds
// enough novel sentences/chapters AND the RSS has no substantial content the
// YouTube text lacks, so good RSS text is never dropped. Pure, testable.
import { conservativeRescueClean, htmlToPlain } from "./clean-text-validation.ts";

export const YT_GAIN_POLICY_VERSION = "youtube_gain_v1";

export type YoutubeGainDecision =
  | "youtube_better"
  | "youtube_spam_only"
  | "youtube_no_gain"
  | "rss_has_unique_content"
  | "youtube_language_mismatch";

export type YoutubeGain = {
  version: string;
  decision: YoutubeGainDecision;
  reasons: string[];
  rss_info_len: number;
  yt_info_len: number;
  yt_novel_chars: number;
  yt_novel_units: number;
  yt_chapters: number;
  rss_unique_chars: number;
  rss_boilerplate: boolean;
  yt_hu_ratio: number;
};

const BOILERPLATE_RX: RegExp[] = [
  /\bhosted\s+(?:by|on)\s+(?:simplecast|acast|anchor|megaphone|spreaker|buzzsprout|podbean|libsyn|redcircle|transistor|captivate|podigee)\b/i,
  /\badswizz\b/i,
  /\bcollection\s+and\s+use\s+of\s+personal\s+data\s+for\s+advertising\b/i,
  /\b(?:learn\s+more\s+about\s+your\s+ad\s+choices|ad\s*choices)\b/i,
  /\bsee\s+\S*(?:acast|omny|megaphone|simplecast)\S*\s+for\s+(?:more\s+)?(?:information|privacy)/i,
  /\bacast\.com\/privacy\b|\bfor\s+more\s+information\.?$/i,
  /\bprivacy\s+(?:policy|information)\b/i,
  /\bsupport\s+this\s+podcast\b|\bsend\s+(?:in\s+)?a\s+voice\s+message\b/i,
  /\bpowered\s+by\s+(?:redcircle|spreaker|anchor|podbean|riverside)\b/i,
  /\bget\s+bonus\s+content\s+on\s+patreon\b/i,
  /\bthis\s+episode\s+is\s+(?:brought\s+to\s+you|sponsored)\s+by\b/i,
  /\b(?:a\s+műsor|az\s+adás)\s+(?:támogatója|szponzora)\b/i,
  /\bhirdetés(?:i)?\s+(?:ajánlat|lehetőség)/i,
  /\bonline\s+hallgatás\w*|\bkeresd\s+(?:a\s+)?(?:weboldal|oldal|honlap)\w*|\blátogass\s+el\b|^\s*elérhetőség\w*\s*[:：]/i,
  /\b(?:nézd|hallgasd)\s+meg\s+(?:a\s+)?(?:teljes|többi|korábbi)\b|\bteljes\s+adás\s+(?:hamarosan|elérhető)\b/i,
];
const CHAPTER_LINE_RX = /^\s*[(\[]?\d{1,2}[:.]\d{2}(?:[:.]\d{2})?[)\]]?\s*[-–—|:]?\s*\p{L}/u;
const LABEL_LINE_RX = /^[^\p{L}\p{N}]{0,3}[\p{L}\p{N}][^\n]{0,60}[:：]\s*$/u;
const HU_STOP = new Set(["a", "az", "es", "hogy", "nem", "is", "egy", "de", "meg", "van", "ez", "azt", "mar", "csak", "ki", "mint", "vagy", "mi", "meg", "volt", "lesz", "arrol", "szerint", "mert", "ha", "amikor", "rola", "vele", "kik", "miert", "hogyan", "milyen", "beszel", "vendeg", "vendegunk", "adas", "musor"]);
const EN_STOP = new Set(["the", "and", "of", "to", "is", "in", "for", "with", "on", "this", "that", "you", "we", "our", "about"]);

export function normalizeTokens(s: string): string[] {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/\p{M}+/gu, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 || /\d/.test(t));
}

const SPONSOR_LABEL_RX = /\b(?:támogató(?:ink|nk|ja|i|nk)?|szponzor\w*|partner(?:eink|ünk|einknek)|hirdet(?:és|ő)\w*|sponsor\w*|ajánlat(?:aink|unk)?|kupon\w*|kedvezmény\w*|reklám\w*)\b/i;
// Short YouTube engagement CTA lines ("Likeold a videót", "Írd meg kommentben …").
const YT_CTA_LINE_RX = /(?<![\p{L}\p{N}])(?:like-?ol(?:d|j)\p{L}*|lájkol\p{L}*|nyomj\s+egy\s+like\p{L}*|írd\s+meg\s+(?:kommentben|a\s+kommentek)\p{L}*|kommentel\p{L}*|iratkozz(?:atok)?\s+fel|feliratkoz\p{L}*|kapcsold\s+be\s+a\s+(?:csengő|értesítés)\p{L}*|oszd\s+meg\s+(?:a\s+videót|másokkal)|ha\s+tetszett(?![\p{L}])|subscribe|like\s+and\s+share)/iu;
// Giveaway / purchase-promo lines ("Vegyél bármilyen … terméket", "a játékhoz szükséges link").
const YT_PROMO_LINE_RX = /(?<![\p{L}\p{N}])(?:nyereményjáték\p{L}*|vegyél\s+bármilyen|töltsd\s+fel\s+a\s+(?:vásárlás|száml|blokk)\p{L}*|a\s+játékhoz\s+szükséges|a\s+lenti\s+link\p{L}*|a\s+leírásban\s+található\s+link\p{L}*|kedvezményes\s+áron|vásárolj\s+most)/iu;
const SPONSOR_LINE_RX = /\b(?:kupon\s*kód\w*|kuponkód\w*|kedvezménykód\w*|promóciós\s+kód\w*|\d{1,2}\s*%\s*(?:-os\s+)?kedvezmény\w*|a\s+(?:műsor|podcast|adás|videó)\s+(?:támogatója|szponzora|partnere)|támogatóink\s+ebben\s+az\s+epizódban|ebben\s+az\s+epizódban\s+(?:támogat|szponzor))/i;

/**
 * Removes sponsor/ad sections: a short sponsor label line ("Támogatóink ebben az
 * epizódban:") and the lines under it until a blank line, chapter or next label;
 * plus single coupon/discount/sponsor lines. Removal only (extract-only safe).
 */
export function stripSponsorSections(text: string): string {
  const lines = String(text || "").split(/\r?\n/);
  const out: string[] = [];
  let inSponsor = false;
  for (const line of lines) {
    const l = line.trim();
    if (!l) { inSponsor = false; out.push(line); continue; }
    const words = normalizeTokens(l).length;
    const isLabel = words <= 7 && (/[:：]\s*$/.test(l) || words <= 3);
    if (isLabel && SPONSOR_LABEL_RX.test(l)) { inSponsor = true; continue; }
    if (inSponsor) {
      if (CHAPTER_LINE_RX.test(l) || (isLabel && !SPONSOR_LABEL_RX.test(l) && /[:：]\s*$/.test(l))) inSponsor = false;
      else continue;
    }
    if (SPONSOR_LINE_RX.test(l) && words <= 40) continue;
    if (YT_CTA_LINE_RX.test(l) && words <= 16) continue;
    if (YT_PROMO_LINE_RX.test(l) && words <= 40) continue;
    if (/^(?:#[\p{L}\p{N}_]+[\s,]*)+$/u.test(l)) continue;
    out.push(line);
  }
  return out.join("\n");
}

export function isBoilerplateUnit(unit: string): boolean {
  return BOILERPLATE_RX.some((rx) => rx.test(unit));
}

export function countChapters(raw: string): number {
  return String(raw || "").split(/\r?\n/).filter((l) => CHAPTER_LINE_RX.test(l)).length;
}

export function unitKey(unit: string): string {
  return normalizeTokens(unit).join(" ");
}

/** Line/sentence keys that recur across other YouTube descriptions of the same podcast. */
export function recurringUnitCounts(descriptions: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const d of descriptions) {
    const keys = new Set(informativeUnits(d).units.map(unitKey).filter((k) => k.split(" ").length >= 3));
    for (const k of keys) counts.set(k, (counts.get(k) || 0) + 1);
  }
  return counts;
}

/** Recurring keys for one episode: shared by ≥2 OTHER descriptions of its podcast. */
export function recurringFor(counts: Map<string, number> | null | undefined, ownDescription: string | null, minOthers = 2): Set<string> {
  const out = new Set<string>();
  if (!counts || !counts.size) return out;
  const own = new Set(ownDescription ? informativeUnits(ownDescription).units.map(unitKey) : []);
  for (const [k, n] of counts) if (n - (own.has(k) ? 1 : 0) >= minOthers) out.add(k);
  return out;
}

/** Removes lines whose content recurs across the podcast's descriptions (removal only). */
export function stripRecurringLines(text: string, recurring: Set<string> | null | undefined): string {
  if (!recurring || !recurring.size) return text;
  return String(text || "").split(/\r?\n/).filter((l) => {
    const k = unitKey(l);
    return !(k && k.split(" ").length >= 3 && recurring.has(k));
  }).join("\n");
}

/** Informative units: link/CTA-stripped lines and sentences, boilerplate and empty labels dropped. */
export function informativeUnits(raw: string, recurring?: Set<string> | null): { units: string[]; boilerplate: boolean } {
  const base = conservativeRescueClean(stripSponsorSections(htmlToPlain(String(raw || "")))).text;
  const units: string[] = [];
  let boilerplate = false;
  for (const line of base.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    if (LABEL_LINE_RX.test(l) && normalizeTokens(l).length <= 5) continue;
    const parts = CHAPTER_LINE_RX.test(l) ? [l] : l.split(/(?<=[.!?…])\s+/);
    for (const p of parts) {
      const s = p.trim();
      if (!s) continue;
      if (isBoilerplateUnit(s)) { boilerplate = true; continue; }
      if (normalizeTokens(s).length < 3) continue;
      if (recurring && recurring.size && recurring.has(unitKey(s))) { boilerplate = true; continue; }
      units.push(s);
    }
  }
  return { units, boilerplate };
}

function coverage(unit: string, pool: Set<string>): number {
  const toks = normalizeTokens(unit);
  if (!toks.length) return 1;
  let hit = 0;
  for (const t of toks) if (pool.has(t)) hit++;
  return hit / toks.length;
}

function huRatio(units: string[]): { hu: number; en: number; words: number } {
  let hu = 0, en = 0, words = 0;
  for (const u of units) for (const t of normalizeTokens(u)) { words++; if (HU_STOP.has(t)) hu++; if (EN_STOP.has(t)) en++; }
  return { hu: words ? hu / words : 0, en: words ? en / words : 0, words };
}

export type GainOptions = {
  min_novel_chars?: number;
  min_novel_units?: number;
  min_chapters?: number;
  max_rss_unique_chars?: number;
  novel_unit_max_coverage?: number;
  /** Units recurring across this podcast's other descriptions (sponsor/intro blocks). */
  recurring?: Set<string> | null;
};

/** Informative-content comparison; never decides on raw character counts. */
export function compareYoutubeGain(rssRaw: string, ytRaw: string, opts: GainOptions = {}): YoutubeGain {
  const minNovelChars = Number(opts.min_novel_chars ?? 200);
  const minNovelUnits = Number(opts.min_novel_units ?? 2);
  const minChapters = Number(opts.min_chapters ?? 3);
  const maxRssUnique = Number(opts.max_rss_unique_chars ?? 160);
  const novelMaxCov = Number(opts.novel_unit_max_coverage ?? 0.6);

  const rss = informativeUnits(rssRaw, opts.recurring);
  const yt = informativeUnits(ytRaw, opts.recurring);
  const rssPool = new Set(rss.units.flatMap(normalizeTokens));
  const ytPool = new Set(yt.units.flatMap(normalizeTokens));
  const novel = yt.units.filter((u) => coverage(u, rssPool) < novelMaxCov);
  const rssUnique = rss.units.filter((u) => coverage(u, ytPool) < novelMaxCov);
  const chapters = yt.units.filter((u) => CHAPTER_LINE_RX.test(u)).length;
  const lang = huRatio(yt.units);
  const out: YoutubeGain = {
    version: YT_GAIN_POLICY_VERSION,
    decision: "youtube_no_gain",
    reasons: [],
    rss_info_len: rss.units.join(" ").length,
    yt_info_len: yt.units.join(" ").length,
    yt_novel_chars: novel.join(" ").length,
    yt_novel_units: novel.length,
    yt_chapters: chapters,
    rss_unique_chars: rssUnique.join(" ").length,
    rss_boilerplate: rss.boilerplate,
    yt_hu_ratio: Number(lang.hu.toFixed(3)),
  };

  const ytWords = lang.words;
  if (out.yt_info_len < 120 || ytWords < 15) {
    out.decision = "youtube_spam_only";
    out.reasons.push("youtube_little_informative_text");
    return out;
  }
  if (ytWords >= 30 && lang.en > 0.08 && lang.en > lang.hu * 1.5) {
    out.decision = "youtube_language_mismatch";
    out.reasons.push("youtube_text_not_hungarian");
    return out;
  }
  const enoughNovel = (out.yt_novel_chars >= minNovelChars && out.yt_novel_units >= minNovelUnits)
    || (chapters >= minChapters && out.yt_novel_chars >= Math.round(minNovelChars / 2));
  if (!enoughNovel) {
    out.decision = "youtube_no_gain";
    out.reasons.push(out.yt_novel_chars > 0 ? "youtube_novel_text_below_threshold" : "youtube_duplicates_rss");
    return out;
  }
  if (out.rss_unique_chars > maxRssUnique && out.rss_unique_chars > out.rss_info_len * 0.35) {
    out.decision = "rss_has_unique_content";
    out.reasons.push("rss_content_missing_from_youtube");
    return out;
  }
  out.decision = "youtube_better";
  out.reasons.push(chapters >= minChapters ? "youtube_adds_chapters" : "youtube_adds_sentences");
  if (rss.boilerplate) out.reasons.push("rss_hosting_boilerplate");
  return out;
}

/**
 * Extract-only post-pass for YouTube clean text: drops label-only lines whose
 * section is empty ("Hírek, cikkek:" followed by another label or the end).
 */
export function trimDanglingLabels(cleaned: string): string {
  const lines = String(cleaned || "").split(/\r?\n/);
  const isLabel = (l: string) => /[:：]\s*$/.test(l.trim()) && LABEL_LINE_RX.test(l.trim()) && normalizeTokens(l).length <= 8;
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (isLabel(l)) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim()) j++;
      if (j >= lines.length || isLabel(lines[j])) continue;
    }
    out.push(l);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type RecleanGate = { ok: boolean; reasons: string[]; prior_info_len: number; next_info_len: number; prior_units_lost: number };

/** A re-clean may replace prior text only if it keeps the prior's information and adds more. */
export function youtubeRecleanGate(priorCleaned: string | null | undefined, nextCleaned: string, opts: { min_info_gain_chars?: number; max_lost_chars?: number; recurring?: Set<string> | null } = {}): RecleanGate {
  const minGain = Number(opts.min_info_gain_chars ?? 100);
  const maxLost = Number(opts.max_lost_chars ?? 80);
  const prior = informativeUnits(String(priorCleaned || ""), opts.recurring);
  const next = informativeUnits(nextCleaned, opts.recurring);
  const nextPool = new Set(next.units.flatMap(normalizeTokens));
  const lost = prior.units.filter((u) => coverage(u, nextPool) < 0.6);
  const priorLen = prior.units.join(" ").length;
  const nextLen = next.units.join(" ").length;
  const lostLen = lost.join(" ").length;
  const reasons: string[] = [];
  if (nextLen < priorLen + minGain) reasons.push("insufficient_information_gain");
  if (lostLen > maxLost && lostLen > priorLen * 0.2) reasons.push("would_lose_prior_content");
  if (/https?:\/\/|www\.[a-z0-9-]+\./i.test(nextCleaned)) reasons.push("residual_url");
  return { ok: reasons.length === 0, reasons, prior_info_len: priorLen, next_info_len: nextLen, prior_units_lost: lost.length };
}

/** Per-feed quotas for one runner call; the YouTube feed gets the largest share. */
export function feedQuotas(limit: number, weights: Record<string, number> | null | undefined, feeds: readonly string[]): Record<string, number> {
  const w: Record<string, number> = { youtube: 0.5, transcript: 0.2, article: 0.15, spotify: 0.15, ...(weights || {}) };
  const total = feeds.reduce((s, f) => s + Math.max(0, Number(w[f] || 0)), 0) || 1;
  const out: Record<string, number> = {};
  for (const f of feeds) out[f] = Math.max(Number(w[f] || 0) > 0 ? 2 : 0, Math.floor((limit * Math.max(0, Number(w[f] || 0))) / total));
  return out;
}
