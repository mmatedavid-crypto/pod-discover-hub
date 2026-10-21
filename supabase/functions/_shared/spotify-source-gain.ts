// Deterministic ($0) comparison of the RSS description vs. a confidently matched
// Spotify episode description. Pure, testable.
//
// Only informative content counts (same unit extraction as the YouTube
// comparison: links, handles, hashtag walls, CTA/sponsor/hosting boilerplate and
// blocks recurring across the show's other Spotify descriptions are removed).
//
// Provenance rule (stricter than YouTube): Spotify text is used only when it is
// the publisher's own show notes for the same episode — it must contain the
// RSS's informative content (a superset, e.g. our RSS copy was cut at 3,000
// chars) or the RSS must be empty. Spotify text that drops RSS facts is never
// preferred, so RSS-only facts are preserved. Internal processing only
// (clean text / search); public display stays off.
import { htmlToPlain } from "./clean-text-validation.ts";
import { informativeUnits, normalizeTokens, recurringUnitCounts } from "./youtube-source-gain.ts";

export const SP_GAIN_POLICY_VERSION = "spotify_gain_v1";
export const SPOTIFY_RIGHTS_STATUS = "spotify_publisher_metadata_internal_only";

export type SpotifyGainDecision =
  | "spotify_better"
  | "spotify_no_gain"
  | "spotify_spam_only"
  | "rss_has_unique_content"
  | "spotify_language_mismatch"
  | "spotify_match_unverified";

export type SpotifyGain = {
  version: string;
  decision: SpotifyGainDecision;
  reasons: string[];
  rss_info_len: number;
  sp_info_len: number;
  sp_novel_chars: number;
  sp_novel_units: number;
  rss_unique_chars: number;
  rss_empty: boolean;
  rss_truncated_copy: boolean;
  sp_hu_ratio: number;
};

const HU_STOP = new Set(["a", "az", "es", "hogy", "nem", "is", "egy", "de", "meg", "van", "ez", "azt", "mar", "csak", "ki", "mint", "vagy", "mi", "volt", "lesz", "arrol", "szerint", "mert", "ha", "amikor", "rola", "vele", "kik", "miert", "hogyan", "milyen", "vendeg", "adas", "musor", "epizod", "ebben"]);
const EN_STOP = new Set(["the", "and", "of", "to", "is", "in", "for", "with", "on", "this", "that", "you", "we", "our", "about"]);

function coverage(unit: string, pool: Set<string>): number {
  const toks = normalizeTokens(unit);
  if (!toks.length) return 1;
  let hit = 0;
  for (const t of toks) if (pool.has(t)) hit++;
  return hit / toks.length;
}

function langRatio(units: string[]) {
  let hu = 0, en = 0, words = 0;
  for (const u of units) for (const t of normalizeTokens(u)) { words++; if (HU_STOP.has(t)) hu++; if (EN_STOP.has(t)) en++; }
  return { hu: words ? hu / words : 0, en: words ? en / words : 0, words };
}

/** Raw Spotify text used as a processing source: the HTML variant keeps paragraph structure. */
export function spotifyRawText(row: { spotify_html_description?: string | null; spotify_description?: string | null } | null): string {
  if (!row) return "";
  const html = String(row.spotify_html_description || "").trim();
  return html || String(row.spotify_description || "").trim();
}

// Show-note boilerplate that is never episode information: donation / bank
// details, legal disclaimers, follow/subscribe and hosting-privacy lines.
const SPOTIFY_BOILERPLATE_RAW: RegExp[] = [
  /\btámogat(?:hat|ás|ni|j|ja|hatj)\p{L}*\b[^.!?]{0,80}\b(?:munkánkat|munkájukat|műsorunkat|minket|bennünket|csatornánkat|a\s+podcastot)/iu,
  /\b(?:patronál\p{L}*|donably|patreon|buymeacoffee|ko-fi|számlaszám\p{L}*|iban\b|swift\b|bic\b|közlemény\s*[:：]|banki\s+átutalás\p{L}*|egyszeri\s+vagy\s+rendszeres)/iu,
  /\bnem\s+minősül\s+(?:befektetési\s+)?(?:tanácsadás|ajánlat|ajánlás)\p{L}*|\bsaját\s+felelősségére\b|\bnem\s+vállal(?:nak|unk)?\s+felelősséget\b|\bkizárólag\s+(?:általános\s+)?tájékoztató\b/iu,
  /\bkövess(?:enek|etek|en|él)?\s+(?:minket|bennünket)\b|\biratkozz\p{L}*\s+fel\b|\bértékel(?:j|jétek|jen)\s+(?:minket|bennünket)\b|\bcsatlakozz(?:atok|on|anak)?\s+hozzánk\b/iu,
  /\b(?:nézd|nézze|hallgasd|hallgassa)\s+meg\s+(?:az\s+epizódot|a\s+videót|a\s+teljes)\b|\b(?:meg)?hallgatható\p{L}*\b[^.!?]{0,80}\b(?:spotify|apple|google\s+podcast|youtube)/iu,
  /\bhallgass(?:atok|on|anak)?\s+\p{L}+(?:t|ot|et|öt|at)\s*!/iu,
  /\b(?:ajánljuk|kövesd|kövessétek|kövessen|keress(?:etek|en)?)\b[^.!?]{0,80}\b(?:instagram|facebook|tiktok|linkedin|youtube)\p{L}*/iu,
  // Back-catalogue lists ("az eddigi részek: #1 … #2 …") describe other episodes.
  /\b(?:az\s+)?(?:eddigi|korábbi|további)\s+(?:részek|epizódok|adások)\p{L}*\s*:|^\s*#\d{1,4}\s+\p{L}/iu,
  // Sponsor thanks and event/registration promotion.
  /\bköszön(?:et|jük|öm|jük\s+szépen)\s+(?:a|az)\b[^.!?]{0,60}(?:\p{L}+ért\b|\btámogatás\p{L}*)|\bszponzor\p{L}*/iu,
  /\b(?:jelentkez(?:z|zen|zetek|hetsz|het)|regisztr(?:álj|áljon|áljatok))\b|\b(?:jelentkezés|regisztráció)\s*:|\brészletek\s+és\s+(?:regisztráció|jelentkezés)/iu,
  // A dangling suffix where a link was removed ("a -n történő bejelentkezéssel") marks a promo line.
  /(?:^|\s)-(?:n|on|en|ön|nak|nek|ra|re|ról|ről|ba|be)\b/u,
  /\bfor\s+privacy\s+information\b|\bprivacy\s+policy\b|\bad\s*choices\b|\bhosted\s+(?:by|on)\s+\p{L}+/iu,
];
// JS `\b` is ASCII-only even with the `u` flag ("regisztráció\b" never matches),
// so every boundary is rewritten to a Unicode letter/digit boundary.
const UNICODE_BOUNDARY = "(?:(?<=[\\p{L}\\p{N}])(?![\\p{L}\\p{N}])|(?<![\\p{L}\\p{N}])(?=[\\p{L}\\p{N}]))";
const SPOTIFY_BOILERPLATE_RX: RegExp[] = SPOTIFY_BOILERPLATE_RAW.map((rx) => new RegExp(rx.source.split("\\b").join(UNICODE_BOUNDARY), rx.flags));

/** Removes boilerplate sentences (≤45 words) from Spotify show notes. Removal only (extract-only safe). */
export function stripSpotifyBoilerplate(raw: string): string {
  const plain = htmlToPlain(String(raw || ""));
  return plain.split(/\r?\n/).map((line) => {
    // Also split "…csatornánkra!A HVG…" (no space after the sentence end).
    const parts = line.split(/(?<=[.!?…])\s+|(?<=[a-zà-ž][.!?])(?=\p{Lu})/u);
    const kept = parts.filter((s) => !(normalizeTokens(s).length <= 45 && SPOTIFY_BOILERPLATE_RX.some((rx) => rx.test(s))));
    return kept.join(" ");
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Recurrence counts over a show's Spotify descriptions sampled across its history (≥4 needed). */
export function spotifyRecurringCounts(descriptions: string[]): Map<string, number> | null {
  const d = descriptions.map((x) => String(x || "")).filter((x) => x.length > 40);
  return d.length >= 4 ? recurringUnitCounts(d) : null;
}

export type SpotifyGainOptions = {
  min_novel_chars?: number;
  min_novel_units?: number;
  max_rss_unique_chars?: number;
  max_rss_unique_ratio?: number;
  recurring?: Set<string> | null;
};

/** Informative-content comparison; never decides on raw character counts. */
export function compareSpotifyGain(rssRaw: string, spRaw: string, opts: SpotifyGainOptions = {}): SpotifyGain {
  const minNovelChars = Number(opts.min_novel_chars ?? 200);
  const minNovelUnits = Number(opts.min_novel_units ?? 2);
  const maxRssUnique = Number(opts.max_rss_unique_chars ?? 60);
  const maxRssUniqueRatio = Number(opts.max_rss_unique_ratio ?? 0.1);
  const rss = informativeUnits(stripSpotifyBoilerplate(rssRaw), opts.recurring);
  const sp = informativeUnits(stripSpotifyBoilerplate(spRaw), opts.recurring);
  const rssPool = new Set(rss.units.flatMap(normalizeTokens));
  const spPool = new Set(sp.units.flatMap(normalizeTokens));
  const novel = sp.units.filter((u) => coverage(u, rssPool) < 0.6);
  const rssUnique = rss.units.filter((u) => coverage(u, spPool) < 0.6);
  const lang = langRatio(sp.units);
  const rssPlain = htmlToPlain(String(rssRaw || "")).replace(/\s+/g, " ").trim();
  const out: SpotifyGain = {
    version: SP_GAIN_POLICY_VERSION,
    decision: "spotify_no_gain",
    reasons: [],
    rss_info_len: rss.units.join(" ").length,
    sp_info_len: sp.units.join(" ").length,
    sp_novel_chars: novel.join(" ").length,
    sp_novel_units: novel.length,
    rss_unique_chars: rssUnique.join(" ").length,
    rss_empty: false,
    // Our stored RSS copy was cut by an importer limit (3,000 / 12,000 chars).
    rss_truncated_copy: [3000, 12000].includes(String(rssRaw || "").length),
    sp_hu_ratio: Number(lang.hu.toFixed(3)),
  };
  out.rss_empty = out.rss_info_len < 40;
  if (out.sp_info_len < 120 || lang.words < 15) {
    out.decision = "spotify_spam_only";
    out.reasons.push("spotify_little_informative_text");
    return out;
  }
  if (lang.words >= 30 && lang.en > 0.08 && lang.en > lang.hu * 1.5) {
    out.decision = "spotify_language_mismatch";
    out.reasons.push("spotify_text_not_hungarian");
    return out;
  }
  // Provenance: RSS facts must all be present in the Spotify text.
  if (!out.rss_empty && out.rss_unique_chars > Math.max(maxRssUnique, out.rss_info_len * maxRssUniqueRatio)) {
    out.decision = "rss_has_unique_content";
    out.reasons.push("rss_content_missing_from_spotify");
    return out;
  }
  const enough = (out.sp_novel_chars >= minNovelChars && out.sp_novel_units >= minNovelUnits)
    || (out.rss_info_len < 80 && out.sp_novel_chars >= 150);
  if (!enough) {
    out.decision = "spotify_no_gain";
    out.reasons.push(out.sp_novel_chars > 0 ? "spotify_novel_text_below_threshold" : "spotify_duplicates_rss");
    return out;
  }
  out.decision = "spotify_better";
  out.reasons.push(out.rss_empty ? "rss_empty_publisher_notes_on_spotify" : "spotify_superset_of_rss");
  if (out.rss_truncated_copy) out.reasons.push("rss_copy_truncated");
  if (rssPlain && String(htmlToPlain(spRaw)).replace(/\s+/g, " ").trim().startsWith(rssPlain.slice(0, 120))) out.reasons.push("same_opening_as_rss");
  return out;
}

/** Episode + show level match must both be confident before Spotify text is compared at all. */
export function spotifyMatchVerified(row: any, showConfidence: number | null | undefined, opts: { min_episode_confidence?: number; min_show_confidence?: number } = {}): { ok: boolean; reason?: string } {
  const minEp = Number(opts.min_episode_confidence ?? 0.8);
  const minShow = Number(opts.min_show_confidence ?? 0.8);
  if (!row) return { ok: false, reason: "no_spotify_row" };
  if (!["name_date", "name_neardate"].includes(String(row.match_method || ""))) return { ok: false, reason: "spotify_match_method_unknown" };
  if (Number(row.match_confidence || 0) < minEp) return { ok: false, reason: "spotify_episode_match_below_threshold" };
  if (Number(showConfidence ?? 0) < minShow) return { ok: false, reason: "spotify_show_match_below_threshold" };
  return { ok: true };
}
