// Deterministic ($0, no AI) re-evaluation of legacy `deterministic_v4+ytdesc`
// clean texts whose current best source is RSS. Pure apart from hashing.
//
// Every decision is grounded and explainable:
// - provenance: which YouTube video the stored text was made from (exact
//   source-hash match, else ≥0.9 token containment in a linked description);
// - identity: v3 pairing verdict (confirmed, final score ≥0.78, no blockers)
//   plus own title / release date / episode number / channel checks;
// - content: informative-unit comparison of the stored text vs RSS (never length).
//
// Buckets: A verified YouTube kept (attribution aligned, text unchanged);
// B wrong/unverified YouTube replaced by substantive RSS; C needs_review
// (ambiguous identity or risky content loss); D no alternative (kept when
// grounded in the episode title, else quarantined); E already equivalent; P
// protected (backups / other lanes / runner-owned). Writes happen only through
// apply_clean_text_repair_v1 (backup + CAS); Spotify text is never written here.
import { heuristicClean, validateExtractOnlyTrim } from "./episode-text-cleaner.ts";
import { CLEAN_TEXT_QUALITY_VERSION, RESCUE_METHOD_SUFFIX, decideCleanText, htmlToPlain, lostNamedTokens, validateCleanOutput } from "./clean-text-validation.ts";
import { compareYoutubeGain, informativeUnits, normalizeTokens } from "./youtube-source-gain.ts";
import { autoApplySafetyReasons } from "./clean-text-repair-queue.ts";

export const LEGACY_YTDESC_POLICY = "legacy_ytdesc_v1";
export const LEGACY_YTDESC_METHOD = "deterministic_v4+ytdesc";
export const LEGACY_MIN_FINAL_SCORE = 0.78;
export const LEGACY_SPOTIFY_MIN_CONFIDENCE = 0.8;
/**
 * Owner-reviewed batches (RSS 43, YouTube 40, Spotify 15+15, phase-1 RSS 5+17+16,
 * promo fix 3): never rewritten by this lane, even if a backup row says "legacy".
 */
export const LEGACY_PROTECTED_BATCHES = [
  "5f25cffd-e041-4f91-a60f-fd8a953a2009",
  "8e365da4-f9db-4bbc-90f7-4fc6506fb358",
  "f8d5412b-ca9b-44d3-b3df-938bdc74c35c",
  "6af44eed-f0e3-453e-a58f-c4d099c11a1c",
  "96c3a1e6-069a-4190-b163-40d556cc5fb7",
  "7d826b25-66d5-47c9-865f-8fcbb2d39927",
  "8a5784ef-6a0a-4d66-a3a2-e328a9b2a83e",
  "e65d674c-158c-4871-9c82-d359392c5d41",
];

export type LegacyLink = {
  id: string;
  video_id?: string | null;
  channel_id?: string | null;
  status: string;
  confidence?: string | null;
  title?: string | null;
  published_at?: string | null;
  match_score?: number | null;
  vr?: any;
  description?: string | null;
  /** Stored source_hash equals sha256("deterministic_v4+ytdesc::" + this description). */
  prov?: boolean;
  video_confirmed_elsewhere?: number;
  elsewhere_titles?: string[] | null;
};

export type LegacyInput = {
  id: string;
  podcast_id?: string | null;
  title?: string | null;
  podcast_title?: string | null;
  published_at?: string | null;
  description?: string | null;
  summary?: string | null;
  clean_text_status?: string | null;
  cleaned_text?: string | null;
  source_hash?: string | null;
  cleaner_method?: string | null;
  removed_categories?: string[] | null;
  best_type?: string | null;
  backups?: Array<{ batch_id?: string | null; method?: string | null; reasons?: string[] | null }> | null;
  same_desc?: number | null;
  links?: LegacyLink[] | null;
  show_channels?: Record<string, number> | null;
  spotify?: { match_confidence?: number | null; spotify_description?: string | null; spotify_html_description?: string | null } | null;
  show_sp_conf?: number | null;
};

export type LegacyBucket = "A" | "B" | "C" | "D" | "E" | "P";
export type LegacyQueueStatus = "done" | "needs_review" | "quarantine" | "protected" | "retry" | "no_substantive_source";

export type LegacyPlan = {
  episode_id: string;
  bucket: LegacyBucket;
  status: LegacyQueueStatus;
  outcome: string;
  reasons: string[];
  provenance: { link_id: string | null; link_status: string | null; via: "hash" | "content" | "none"; state: "verified" | "wrong" | "unverified" };
  identity: Identity | null;
  prior_len: number;
  next_len: number;
  /** apply = text change; attribute = same text, source attribution aligned. */
  write: "none" | "apply" | "attribute";
  item?: Record<string, unknown>;
  preview: string;
};

export type Identity = {
  title_cov: number | null;
  date_days: number | null;
  number_conflict: boolean;
  channel_ok: boolean;
  strong: boolean;
  mismatch: boolean;
};

const TITLE_STOP = new Set([
  "podcast", "adas", "resz", "epizod", "episode", "ep", "the", "and", "with", "feat", "interju", "beszelgetes",
  "egy", "hogy", "nem", "van", "volt", "meg", "mint", "csak", "vagy", "arrol", "rola", "vele", "miert", "hogyan", "milyen",
  "kozott", "utan", "elott", "alatt", "mert", "majd", "lesz", "ezt", "azt", "akik", "aki", "ami", "amit", "mit", "mikor",
]);

function titleTokens(title: string, exclude: Set<string>): string[] {
  return Array.from(new Set(normalizeTokens(title).filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !TITLE_STOP.has(t) && !exclude.has(t))));
}

/** Episode numbers in a title ("687.", "#12", "S2E5", "12. rész"); years excluded. */
export function titleNumbers(title: string): Set<string> {
  const out = new Set<string>();
  const t = String(title || "");
  for (const m of t.matchAll(/(?:^|[\s#(\[|–-])(?:ep\.?\s*|e)?(\d{1,4})(?=[.)\]:|\s–-]|$)/giu)) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || (n >= 1950 && n <= 2100)) continue;
    out.add(String(n));
  }
  return out;
}

/** Platform/link labels left without their link ("web: facebook: Youtube csatornám:"). */
const LABEL_RESIDUE_RX = /[\p{L})]{2,}\s*:(?=\s*(?:[\p{L}()\s]{0,25}:|$))/gmu;
/** Half-removed domain (".wordpress.com"). */
const DOMAIN_FRAGMENT_RX = /(?:^|\s)\.[a-z0-9-]{2,}\.[a-z]{2,4}\b/i;
/** A single platform label left dangling ("Tiktok: Timeline:"). */
const PLATFORM_DANGLING_RX = /(?:tik-?tok|instagram|facebook|youtube|spotify|weboldal|honlap|twitter|linkedin|discord|patreon|itunes|podomatic|timeline|apple\s*podcasts?|google\s*podcasts?)\s*:(?=\s*(?:[\p{L}()\s]{0,25}:|$))/imu;
/** Handle left after its link was removed ("/ zsofi_kotelvero"). */
const HANDLE_FRAGMENT_RX = /(?:^|\s)\/\s*[a-z0-9_.]{3,}(?=[\s.,;!?]|$)/i;
export function linkResidueReasons(text: string): string[] {
  const t = String(text || "");
  const out: string[] = [];
  if ((t.match(LABEL_RESIDUE_RX) || []).length >= 2 || PLATFORM_DANGLING_RX.test(t)) out.push("link_label_residue");
  if (DOMAIN_FRAGMENT_RX.test(t)) out.push("domain_fragment");
  if (HANDLE_FRAGMENT_RX.test(t)) out.push("handle_fragment");
  return out;
}

/** Person-like names (two capitalised words) in `from` that `to` lacks (accent/case-insensitive). */
export function lostPersonNames(from: string, to: string): string[] {
  const pool = ` ${normalizeTokens(to).join(" ")} `;
  const out = new Set<string>();
  for (const m of String(from || "").matchAll(/\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?\s+\p{Lu}\p{Ll}+/gu)) {
    const key = normalizeTokens(m[0]).join(" ");
    if (key && !pool.includes(` ${key} `)) out.add(m[0]);
  }
  return Array.from(out);
}

function tokenPool(s: string): Set<string> { return new Set(normalizeTokens(s)); }
function cov(tokens: string[], pool: Set<string>): number {
  if (!tokens.length) return 1;
  let hit = 0;
  for (const t of tokens) if (pool.has(t)) hit++;
  return hit / tokens.length;
}

/** Title / release date / episode number / channel check of one link against the episode. */
export function identityCheck(ep: LegacyInput, link: LegacyLink): Identity {
  const showTok = new Set(normalizeTokens(String(ep.podcast_title || "")));
  const epT = titleTokens(String(ep.title || ""), showTok);
  const ytPool = tokenPool(String(link.title || ""));
  const title_cov = epT.length >= 2 ? Number(cov(epT, ytPool).toFixed(3)) : null;
  const d1 = Date.parse(String(ep.published_at || "")), d2 = Date.parse(String(link.published_at || ""));
  const date_days = Number.isFinite(d1) && Number.isFinite(d2) ? Math.round(Math.abs(d1 - d2) / 86400_000) : null;
  const vr = link.vr || {};
  let number_conflict = vr.sequence_mismatch === true;
  if (vr.sequence_mismatch === undefined) {
    const a = titleNumbers(String(ep.title || "")), b = titleNumbers(String(link.title || ""));
    number_conflict = a.size > 0 && b.size > 0 && ![...a].some((x) => b.has(x));
  }
  const channels = ep.show_channels || {};
  const total = Object.values(channels).reduce((s, n) => s + Number(n || 0), 0);
  const channel_ok = !link.channel_id || total < 3 || Number(channels[String(link.channel_id)] || 0) >= 2;
  const strong = title_cov !== null && title_cov >= 0.6 && date_days !== null && date_days <= 7 && !number_conflict && channel_ok;
  const mismatch = number_conflict || (date_days !== null && date_days > 120) || (title_cov !== null && title_cov < 0.2 && !channel_ok);
  return { title_cov, date_days, number_conflict, channel_ok, strong, mismatch };
}

function v3Verified(l: LegacyLink): boolean {
  const vr = l.vr || {};
  const fs = Number(vr.final_score ?? NaN);
  return l.status === "confirmed" && vr.policy === "youtube_episode_match_v3" && Number.isFinite(fs) && fs >= LEGACY_MIN_FINAL_SCORE
    && !(Array.isArray(vr.blockers) && vr.blockers.length);
}

/** Share of the stored text's tokens found in a description (content provenance). */
function containment(text: string, desc: string): number {
  const toks = normalizeTokens(text);
  if (toks.length < 8) return 0;
  return cov(toks, tokenPool(desc));
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function infoUnitsOf(text: string): string[] { return informativeUnits(text).units; }
function novelChars(units: string[], pool: Set<string>): number {
  return units.filter((u) => cov(normalizeTokens(u), pool) < 0.6).join(" ").length;
}

type RssCandidate = { ok: boolean; substantive: boolean; text: string; method: string; raw: string; reasons: string[]; removed: string[]; verdict: string; lost: string[] };

function rssCandidate(ep: LegacyInput, baseMethod: string): RssCandidate {
  const raw = String(ep.description || ep.summary || "").trim();
  const none = (reasons: string[]): RssCandidate => ({ ok: false, substantive: false, text: "", method: baseMethod, raw, reasons, removed: [], verdict: "none", lost: [] });
  if (!raw) return none(["no_rss_source"]);
  if (Number(ep.same_desc || 0) >= 3) return none(["show_level_boilerplate_description"]);
  const decision = decideCleanText({ raw, v4: heuristicClean(raw), priorCleanedText: null });
  if (decision.action !== "write") return none([`rss_decision_${decision.action}`]);
  const text = decision.text.trim();
  const reasons: string[] = [];
  const verdict = decision.verdict.status;
  if (verdict !== "valid" && verdict !== "valid_short") reasons.push(`rss_verdict_${verdict}`);
  if (/https?:\/\/|<a\s|www\./i.test(text)) reasons.push("rss_residual_url");
  if (text.length < 40) reasons.push("rss_too_short");
  const extract = validateExtractOnlyTrim(htmlToPlain(raw), text, { minOverlap: 0.98, maxAddedTokenRatio: 0.03, minCompressionRatio: 0 });
  if (!extract.ok) reasons.push(...extract.reasons.map((r: string) => `rss_extract_${r}`));
  const lost = lostNamedTokens(htmlToPlain(raw), text);
  reasons.push(...autoApplySafetyReasons(text, lost, { priorLen: 1 }).map((r) => `rss_${r}`));
  reasons.push(...linkResidueReasons(text).map((r) => `rss_${r}`));
  const method = `${baseMethod}${decision.rescued ? `+${RESCUE_METHOD_SUFFIX}` : ""}`;
  const info = infoUnitsOf(text).join(" ").length;
  return { ok: reasons.length === 0, substantive: reasons.length === 0 && verdict === "valid" && info >= 120, text, method, raw, reasons, removed: decision.removed, verdict, lost };
}

/** One explainable decision per legacy row. No I/O except hashing. */
export async function planLegacyYtdesc(ep: LegacyInput, opts: { method?: string; protectedBatches?: string[] } = {}): Promise<LegacyPlan> {
  const prior = String(ep.cleaned_text || "").trim();
  const baseMethod = String(opts.method || "deterministic_v4");
  const links = (ep.links || []) as LegacyLink[];
  const base = { episode_id: String(ep.id), prior_len: prior.length, next_len: prior.length, preview: "" };
  const prov0 = { link_id: null, link_status: null, via: "none" as const, state: "unverified" as const };
  const out = (bucket: LegacyBucket, status: LegacyQueueStatus, outcome: string, reasons: string[], extra: Partial<LegacyPlan> = {}): LegacyPlan =>
    ({ ...base, bucket, status, outcome, reasons: [LEGACY_YTDESC_POLICY, ...reasons], provenance: prov0, identity: null, write: "none", ...extra });

  const st = String(ep.clean_text_status || "");
  if (st === "pending" || st === "error") return out("P", "retry", "legacy_runner_owns", [`clean_text_status_${st}`]);
  // Reviewed canaries, manual edits and every other repair protect the row; this
  // lane's own earlier backups do not (a real RSS change may be re-evaluated).
  const prot = new Set((opts.protectedBatches || []).map(String));
  const protecting = (ep.backups || []).filter((b) => prot.has(String(b.batch_id || "")) || !(b.reasons || []).includes(LEGACY_YTDESC_POLICY));
  if (protecting.length) return out("P", "protected", "legacy_protected_backup", ["active_repair_backup", ...protecting.slice(0, 3).map((b) => `batch:${b.batch_id}`)]);
  if (!String(ep.cleaner_method || "").startsWith(LEGACY_YTDESC_METHOD)) return out("E", "done", "legacy_no_longer_ytdesc", [`method_${ep.cleaner_method || "none"}`]);
  if (ep.best_type && ep.best_type !== "rss") return out("P", "protected", "legacy_alt_source_lane", [`best_source_${ep.best_type}`]);
  if (!prior) return out("E", "done", "legacy_empty_prior_other_lane", ["empty_prior"]);

  // Provenance.
  let link: LegacyLink | null = links.find((l) => l.prov) || null;
  let via: "hash" | "content" | "none" = link ? "hash" : "none";
  if (!link) {
    let best = 0;
    for (const l of links) {
      const c = containment(prior, String(l.description || ""));
      if (c >= 0.9 && c > best) { best = c; link = l; }
    }
    if (link) via = "content";
  }
  const identity = link ? identityCheck(ep, link) : null;
  const currentConfirmed = links.filter((l) => l.status === "confirmed" && v3Verified(l));
  const confirmedOther = link ? currentConfirmed.some((l) => l.video_id && l.video_id !== link!.video_id) : false;
  const dupElsewhere = !!link && Number(link.video_confirmed_elsewhere || 0) > 0;
  const showTok = new Set(normalizeTokens(String(ep.podcast_title || "")));
  const epTitleTok = titleTokens(String(ep.title || ""), showTok);
  const dupSameEpisode = dupElsewhere && (link!.elsewhere_titles || []).every((t) => cov(epTitleTok, tokenPool(String(t || ""))) >= 0.8);

  let state: "verified" | "wrong" | "unverified" = "unverified";
  const why: string[] = [];
  if (link) {
    why.push(`provenance_${via}`, `link_${link.status}`);
    if (confirmedOther) { state = "wrong"; why.push("episode_confirmed_to_other_video"); }
    else if (identity?.number_conflict) { state = "wrong"; why.push("episode_number_conflict"); }
    else if (link.status === "rejected" && identity?.strong) { why.push("rejected_but_identity_strong"); }
    else if (link.status === "rejected") { state = "wrong"; why.push("provenance_link_rejected"); }
    else if (identity?.mismatch) { why.push("identity_weak_mismatch"); }
    else if (dupElsewhere && !dupSameEpisode) { state = "unverified"; why.push("video_confirmed_for_other_episode"); }
    else if (v3Verified(link) && !identity?.number_conflict) { state = "verified"; why.push("v3_confirmed_high_score"); }
    else if (link.status === "confirmed" && identity?.strong) { state = "verified"; why.push("legacy_confirmed_strong_identity"); }
    else why.push(link.status === "confirmed" ? "confirmed_without_v3_strong_identity" : "link_not_confirmed");
  } else {
    why.push("provenance_unknown");
    if (currentConfirmed.length) why.push("text_not_from_current_confirmed_video");
  }
  const provenance = { link_id: link?.id ?? null, link_status: link?.status ?? null, via, state };
  const ex = { provenance, identity };

  // Content comparison (informative units, not length).
  const rss = rssCandidate(ep, baseMethod);
  const rssPool = tokenPool(rss.text || htmlToPlain(String(ep.description || "")));
  const priorUnits = infoUnitsOf(prior);
  const priorNovel = novelChars(priorUnits, rssPool);
  const priorPool = tokenPool(prior);
  const rssUnits = rss.text ? infoUnitsOf(rss.text) : [];
  const rssUnique = novelChars(rssUnits, priorPool);
  const rssInfo = rssUnits.join(" ").length;
  const rssNamesMissing = rss.text ? lostNamedTokens(rss.text, prior).filter((t) => !/^\d/.test(t)) : [];
  const priorInfo = priorUnits.join(" ").length;
  const namesLost = rss.text ? lostPersonNames(prior, rss.text) : [];
  // Shouting headers ("ADÁSA") and show-name tokens are not episode facts.
  const tokensLost = rss.text ? lostNamedTokens(prior, rss.text).filter((t) => !/^\d/.test(t) && t !== t.toUpperCase() && !showTok.has(normalizeTokens(t)[0] || "")) : [];
  const metrics = [`prior_novel_vs_rss_${priorNovel}`, `rss_unique_vs_prior_${rssUnique}`, `prior_names_lost_${namesLost.length}`];

  const rssItem = async (reason: string) => ({
    episode_id: String(ep.id),
    cleaned_text: rss.text,
    source_hash: await sha256Hex(`${rss.method}::${rss.raw}`),
    cleaner_method: rss.method,
    removed_categories: Array.from(new Set([...rss.removed, "source_rss", "legacy_ytdesc_replaced"])),
    quality_status: rss.verdict,
    quality_reasons: [LEGACY_YTDESC_POLICY, reason, `prior_method_${ep.cleaner_method}`, ...(link ? [`yt_link:${link.id}`] : [])],
    quality_version: CLEAN_TEXT_QUALITY_VERSION,
    source_type: "rss",
    expected_source_hash: ep.source_hash ?? null,
    expected_cleaned_sha256: await sha256Hex(String(ep.cleaned_text || "")),
  });
  const applyRss = async (bucket: LegacyBucket, outcome: string, reasons: string[]): Promise<LegacyPlan> => ({
    ...base, ...ex, bucket, status: "done", outcome, write: "apply", reasons: [LEGACY_YTDESC_POLICY, ...why, ...metrics, ...reasons],
    next_len: rss.text.length, preview: rss.text.slice(0, 400), item: await rssItem(outcome),
  });

  // E: the stored text adds nothing beyond RSS.
  if (priorNovel < 40 || (priorNovel < 100 && priorNovel < priorInfo * 0.15)) {
    if (rss.ok && rssUnique >= 120 && !namesLost.length && tokensLost.length <= 1) return applyRss("B", "legacy_rss_superset_applied", ["rss_adds_information"]);
    // RSS carries names the stored text lacks, but cannot replace it safely: a human merges.
    if (rssNamesMissing.length >= 3 && rssUnique >= 120) return out("C", "needs_review", "legacy_rss_unique_facts_review", [...why, ...metrics, `rss_names_missing_${rssNamesMissing.length}`, ...rss.reasons], ex);
    return out("E", "done", "legacy_equivalent_to_rss", [...why, ...metrics], ex);
  }

  if (state === "verified") {
    const ytRaw = String(link!.description || "");
    const gain = ytRaw ? compareYoutubeGain(String(ep.description || ""), ytRaw) : null;
    if (gain && (gain.decision === "youtube_spam_only" || gain.decision === "youtube_language_mismatch")) {
      if (rss.substantive && !namesLost.length && tokensLost.length <= 1) return applyRss("B", "legacy_verified_but_uninformative_rss_applied", [`yt_gain_${gain.decision}`]);
      return out("C", "needs_review", "legacy_verified_uninformative_no_rss", [...why, ...metrics, `yt_gain_${gain.decision}`], ex);
    }
    if (rssNamesMissing.length >= 3 || (rssUnique > 160 && rssUnique > rssInfo * 0.35)) {
      return out("C", "needs_review", "legacy_verified_rss_unique_facts", [...why, ...metrics, `rss_names_missing_${rssNamesMissing.length}`], ex);
    }
    const verdict = validateCleanOutput(ytRaw || prior, prior);
    if (verdict.status === "invalid" || /https?:\/\/|www\.[a-z0-9-]+\./i.test(prior)) {
      return out("C", "needs_review", "legacy_verified_text_needs_reclean", [...why, ...metrics, ...verdict.reasons], ex);
    }
    const safety = autoApplySafetyReasons(prior, [], { priorLen: 0 });
    if (safety.length) return out("C", "needs_review", "legacy_verified_auto_gate", [...why, ...metrics, ...safety], ex);
    // A: keep the text; align attribution (same text, same source hash, backed up).
    return {
      ...base, ...ex, bucket: "A", status: "done", outcome: "legacy_verified_youtube_kept", write: "attribute",
      reasons: [LEGACY_YTDESC_POLICY, ...why, ...metrics, ...(gain ? [`yt_gain_${gain.decision}`] : [])],
      preview: prior.slice(0, 400),
      item: {
        episode_id: String(ep.id),
        cleaned_text: prior,
        source_hash: ep.source_hash,
        cleaner_method: ep.cleaner_method,
        removed_categories: Array.from(new Set([...(ep.removed_categories || []), "source_youtube_description", "legacy_ytdesc_attribution_aligned"])),
        quality_status: verdict.status,
        quality_reasons: [LEGACY_YTDESC_POLICY, "legacy_verified_youtube", `yt_link:${link!.id}`, `provenance_${via}`],
        quality_version: CLEAN_TEXT_QUALITY_VERSION,
        source_type: "youtube",
        expected_source_hash: ep.source_hash ?? null,
        expected_cleaned_sha256: await sha256Hex(String(ep.cleaned_text || "")),
      },
    };
  }

  const spotifyOk = !!ep.spotify && Number(ep.spotify.match_confidence || 0) >= LEGACY_SPOTIFY_MIN_CONFIDENCE
    && Number(ep.show_sp_conf || 0) >= LEGACY_SPOTIFY_MIN_CONFIDENCE
    && infoUnitsOf(String(ep.spotify.spotify_html_description || ep.spotify.spotify_description || "")).join(" ").length >= 120;
  const grounded = epTitleTok.length >= 2 && cov(epTitleTok, priorPool) >= 0.5;

  if (state === "wrong") {
    // A rejected pairing alone is weak evidence when the stored text matches this episode's title.
    if (link?.status === "rejected" && !confirmedOther && !identity?.number_conflict && grounded && namesLost.length) {
      return out("C", "needs_review", "legacy_rejected_link_but_grounded_review", [...why, ...metrics, "prior_matches_episode_title"], ex);
    }
    if (rss.ok) return applyRss("B", "legacy_wrong_video_rss_applied", rss.substantive ? ["rss_substantive"] : ["rss_valid_short"]);
    if (spotifyOk) return out("C", "needs_review", "legacy_wrong_video_spotify_review", [...why, ...metrics, ...rss.reasons], ex);
    return out("D", "quarantine", "legacy_wrong_video_no_alternative", [...why, ...metrics, ...rss.reasons], ex);
  }

  // Unverified identity.
  const plausible = !!identity && (identity.strong || (identity.title_cov !== null && identity.title_cov >= 0.6 && (identity.date_days ?? 999) <= 14 && !identity.number_conflict));
  if (plausible) return out("C", "needs_review", "legacy_unverified_plausible_review", [...why, ...metrics], ex);
  if (rss.substantive && namesLost.length) return out("C", "needs_review", "legacy_unverified_names_review", [...why, ...metrics, ...namesLost.slice(0, 5).map((n) => `name:${n}`)], ex);
  if (rss.substantive && priorNovel >= 200) return out("C", "needs_review", "legacy_unverified_content_loss_review", [...why, ...metrics], ex);
  if (rss.substantive) return applyRss("B", "legacy_unverified_rss_applied", ["rss_substantive"]);
  if (spotifyOk) return out("C", "needs_review", "legacy_unverified_spotify_review", [...why, ...metrics, ...rss.reasons], ex);
  if (grounded) return out("D", "done", "legacy_unverified_kept_grounded", [...why, ...metrics, "prior_matches_episode_title", ...rss.reasons], ex);
  if (rss.ok) return out("C", "needs_review", "legacy_unverified_rss_short_review", [...why, ...metrics], ex);
  return out("D", "quarantine", "legacy_unverified_ungrounded_no_alternative", [...why, ...metrics, ...rss.reasons], ex);
}
