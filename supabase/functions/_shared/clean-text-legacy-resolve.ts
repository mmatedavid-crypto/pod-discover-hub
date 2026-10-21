// One-time resolution of the legacy `deterministic_v4+ytdesc` rows that the v1
// planner (clean-text-legacy-ytdesc.ts) left in needs_review. Deterministic,
// $0, pure apart from hashing. Policy version: LEGACY_RESOLVE_POLICY.
//
// Three paths:
// 1. merge — the video is verified (v3) and RSS carries facts the stored text
//    lacks: the stored text stays first and byte-identical, RSS-only sentences
//    are appended extract-only (verbatim from the RSS, deduped, no links / CTA /
//    sponsor / social / show boilerplate). Any RSS person name or timecode that
//    could not be carried over keeps the prior text (safe_internal_multi_source).
//    Merged text is internal only (source_type multi_source, never allowlisted).
// 2. identity — unverified video: title (Hungarian-normalised exact + fuzzy),
//    channel dominance, episode number, dates, content overlap with RSS and a
//    verified (≥0.8 show+episode) Spotify match as corroboration only →
//    correct / incorrect / ambiguous. Incorrect text is replaced by the
//    episode's own RSS when safe, otherwise quarantined; ambiguous rows may get
//    one validated AI decision (see validateAiDecision), never a link write.
// 3. other — kept / review with a finite outcome.
import {
  LEGACY_YTDESC_POLICY, containment, cov, identityCheck, infoUnitsOf, linkResidueReasons, lostPersonNames,
  novelChars, planLegacyYtdesc, rssCandidate, sha256Hex, titleTokens, tokenPool, v3Verified,
  type Identity, type LegacyInput, type LegacyLink, type LegacyPlan, type LegacyQueueStatus,
} from "./clean-text-legacy-ytdesc.ts";
import { CLEAN_TEXT_QUALITY_VERSION, htmlToPlain, lostNamedTokens, validateCleanOutput } from "./clean-text-validation.ts";
import { autoApplySafetyReasons } from "./clean-text-repair-queue.ts";
import { isBoilerplateUnit, normalizeTokens, unitKey } from "./youtube-source-gain.ts";
import { titleSim } from "./title-similarity.ts";

export const LEGACY_RESOLVE_POLICY = "legacy_ytdesc_resolve_v2";
export const MULTISRC_METHOD_TAG = "multisrc_v1";
/** Internal-only source types: never in public_clean_text_display.allowed_sources. */
export const MULTISRC_SOURCE_TYPE = "multi_source";
export const CORROBORATED_SOURCE_TYPE = "youtube_corroborated";
export const MERGE_MAX_CHARS = 9000;
export const MIN_MERGE_ADDED_CHARS = 40;
export const AI_MIN_CONFIDENCE = 0.85;

export type ResolveInput = LegacyInput & {
  q_outcome?: string | null;
  spotify?: (LegacyInput["spotify"] & { match_method?: string | null; release_date?: string | null; name?: string | null }) | null;
};

export type Verdict = "correct" | "incorrect" | "ambiguous";

export type AiDecision = {
  same_episode: "yes" | "no" | "uncertain";
  confidence: number;
  evidence: Array<{ source: "rss" | "stored_text" | "video_title" | "episode_title" | "spotify"; quote: string }>;
  facts_from_rss_only: string[];
  facts_from_yt_only: string[];
  overwrite_safe: "yes" | "no";
  reasons: string;
};

export type ResolvePlan = {
  episode_id: string;
  policy: string;
  group: "merge" | "identity" | "other" | "v1";
  status: LegacyQueueStatus;
  outcome: string;
  write: "none" | "apply" | "attribute";
  verdict: Verdict | null;
  reasons: string[];
  fingerprint: string;
  evidence: Record<string, unknown>;
  parts: Array<{ source: "youtube" | "rss"; start: number; end: number; link_id?: string | null }>;
  rss_only_units: string[];
  dropped_units: Array<{ text: string; reasons: string[] }>;
  ai_eligible: boolean;
  prior_len: number;
  next_len: number;
  preview: string;
  item?: Record<string, unknown>;
};

const CHAPTER_RX = /^\s*[(\[]?\d{1,2}[:.]\d{2}(?:[:.]\d{2})?[)\]]?\s*[-–—|:]?\s*\p{L}/u;
const TIMECODE_RX = /\b\d{1,2}:\d{2}(?::\d{2})?\b/g;
const LINKISH_RX = /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:hu|com|org|net|io|ly|me|tv|fm|eu)\b/i;
const CTA_RX = /(creative commons|cc by|free download|music promoted|audio library|royalty|zene:|music:|tetszett|értékeld|értékelj|kérlek|értéket teremt|támogatónk|hetente új|iratkozz|feliratkoz|kövess|kovess|követhetsz|kövessetek|támogass|tamogass|támogatóink|patreon|csatlakozz|lájkol|like-?old|oszd meg|ossza meg|értesítés|harangot|hallgasd meg .{0,30}(spotify|apple|youtube|google)|elérhető .{0,40}(spotify|apple|youtube|google podcast)|szponzor|kuponkód|kedvezménykód|promóciós kód|hirdetés|reklám|subscribe|follow us|support us|írj nekünk|írjatok|e-?mail(?:ben)?:|nyereményjáték)/iu;
const PLATFORM_TOKEN_RX = /^(facebook|instagram|youtube|spotify|tiktok|twitter|linkedin|patreon|discord|apple|google|podcast|podcasts|itunes|x)$/i;

const ws = (s: string) => String(s || "").replace(/\s+/g, " ").trim();

const URL_RX = /https?:\/\/\S+|www\.\S+/gi;
/** Lead-in whose link was removed ("itt olvashattok:", "Facebook csoportunk:"), or a unit ending in a colon. */
const LINK_LEAD_RX = /(?:\bitt|alább|lent|linkek?|linkje\w*|oldal\w*|elérhető\w*|megtalálsz\w*|megtalálod|találjátok|találod|olvashat\w*|megtekint\w*|csatorn\w*|blog\w*|weboldal\w*|honlap\w*|csoport\w*|hírlevél\w*|feliratkoz\w*|keresztül|kapcsolat\w*|elérhetőség\w*|webshop\w*|jegyek?)\s*:/iu;
const SOCIAL_RX = /(?:facebook|instagram|insta\b|tik-?tok|twitter|discord|linkedin|patreon|telegram|threads\b|youtube-?(?:on|csatorn|ra\b)|spotify-?(?:on|ra\b)|apple podcast|google podcast|komment|kérdőív)/iu;
const ABBREV_RX = /(?:\b(?:dr|Dr|prof|Prof|ifj|id|stb|pl|kb|ill|ún|St|Mr|Mrs|Ms|Jr|vs|No|Nr|sz|u|ny|ld|vö)|(?<![\p{L}])\p{Lu})\.$/u;

/** Sentence units of one line: chapter lines whole, abbreviations ("Dr.") not split, missing spaces repaired. */
function splitUnits(line: string): string[] {
  const l = line.replace(/(?<![\d:.])\s*(?=\(?\b\d{1,2}:\d{2}(?::\d{2})?\)?\s*[-–—])/g, "\n").replace(/(?<=[.!?…)])\s*(?=\(?\d{1,2}:\d{2})/g, "\n").replace(/(?<=\p{Ll}[.!?…])(?=\p{Lu}\p{Ll})/gu, " ");
  const out: string[] = [];
  for (const sub of l.split("\n")) {
    const t = sub.trim();
    if (!t) continue;
    if (CHAPTER_RX.test(t)) { out.push(t); continue; }
    let buf = "";
    for (const pc of t.split(/(?<=[.!?…])\s+/)) {
      buf = buf ? `${buf} ${pc}` : pc;
      if (ABBREV_RX.test(buf)) continue;
      out.push(buf.trim());
      buf = "";
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

/** Extract-only: the unit's normalised token sequence occurs contiguously in the link-stripped RSS. */
function extractOnly(s: string, rawTokSeq: string): boolean {
  const toks = normalizeTokens(s);
  return toks.length > 0 && ` ${rawTokSeq} `.includes(` ${toks.join(" ")} `);
}

function unitRejectReasons(s: string, rawSeq: string, recurring?: Set<string> | null): string[] {
  const r: string[] = [];
  const chapterList = (s.match(TIMECODE_RX) || []).length >= 3;
  const chapter = CHAPTER_RX.test(s) || chapterList;
  if (LINKISH_RX.test(s)) r.push("link");
  if (/(^|\s)@[A-Za-z0-9._-]{2,}/.test(s)) r.push("handle");
  r.push(...linkResidueReasons(s));
  if (LINK_LEAD_RX.test(s) || /[:：]\s*[-–—]?\s*$/.test(s) || /[:：]\s*(?:\.{2,}|…)/.test(s) || /\b(?:rss|feed)\s*:/i.test(s)) r.push("link_lead_in");
  if (/[\u2060\u200B\u200C\u200D\uFEFF]/.test(s)) r.push("removed_link_marker");
  if (isBoilerplateUnit(s)) r.push("boilerplate");
  if (!chapter && (CTA_RX.test(s) || SOCIAL_RX.test(s))) r.push("cta_social_sponsor");
  if (recurring && recurring.size && recurring.has(unitKey(s))) r.push("show_recurring");
  r.push(...autoApplySafetyReasons(s, [], { priorLen: 1 }).filter((x) =>
    (x !== "auto_gate_mostly_english" || normalizeTokens(s).length >= 12) && !(chapterList && x === "auto_gate_supporter_list")));
  if (!extractOnly(s, rawSeq)) r.push("not_extract_only");
  return Array.from(new Set(r));
}

/**
 * RSS sentences not already covered by `prior` (token coverage <0.6 and no
 * missing name/timecode), extract-only from the RSS, in RSS order, line
 * structure kept, each passing the unit gate.
 */
export function rssOnlyAdditions(prior: string, rssText: string, rawRss: string, recurring?: Set<string> | null) {
  const priorPool = tokenPool(prior);
  const priorTc = timecodes(prior);
  // Links become a barrier token: a unit that only exists because a link was cut out of the middle is not extract-only.
  const rawSeq = normalizeTokens(htmlToPlain(rawRss).replace(URL_RX, " zzlinkzz ")).join(" ");
  const seen = new Set<string>();
  const lines: string[] = [];
  const kept: string[] = [];
  const dropped: Array<{ text: string; reasons: string[] }> = [];
  for (const line of String(rssText || "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const keep: string[] = [];
    for (const s of splitUnits(line)) {
      const toks = normalizeTokens(s);
      // Covered by the stored text — unless it carries a name or timecode the stored text lacks.
      if (prior && cov(toks, priorPool) >= 0.6 && !missingNames(s, prior).length && [...timecodes(s)].every((t) => priorTc.has(t))) continue;
      const k = unitKey(s);
      if (seen.has(k)) continue;
      seen.add(k);
      if (toks.length < 3 && !CHAPTER_RX.test(s)) {
        if (missingNames(s, prior).length) dropped.push({ text: s, reasons: ["fragment_with_name"] });
        continue;
      }
      const reasons = unitRejectReasons(s, rawSeq, recurring);
      if (reasons.length) { dropped.push({ text: s, reasons }); continue; }
      keep.push(s);
      kept.push(s);
    }
    if (keep.length) lines.push(keep.join(" "));
  }
  return { section: lines.join("\n"), kept, dropped };
}

/** Two-word capitalised names in `from` missing from `to` (word-bounded; platform references ignored). */
export function missingNames(from: string, to: string): string[] {
  const pool = ` ${normalizeTokens(to).join(" ")} `;
  const out = new Set<string>();
  for (const m of String(from || "").matchAll(/(?<![\p{L}\p{N}])\p{Lu}\p{Ll}+(?:-\p{Lu}\p{Ll}+)?\s+\p{Lu}\p{Ll}+(?![\p{L}])/gu)) {
    const toks = normalizeTokens(m[0]);
    if (!toks.length || toks.some((t) => PLATFORM_TOKEN_RX.test(t))) continue;
    if (!pool.includes(` ${toks.join(" ")} `)) out.add(m[0]);
  }
  return Array.from(out);
}

function timecodes(s: string): Set<string> { return new Set(String(s || "").match(TIMECODE_RX) || []); }

/** Content-identity hash of every input the decision depends on. */
export async function resolveFingerprint(x: ResolveInput, link: LegacyLink | null): Promise<string> {
  const rss = await sha256Hex(String(x.description || x.summary || ""));
  const yt = await sha256Hex(String(link?.description || ""));
  const prior = await sha256Hex(String(x.cleaned_text || ""));
  const sp = await sha256Hex(String(x.spotify?.spotify_html_description || x.spotify?.spotify_description || ""));
  return sha256Hex(`${LEGACY_RESOLVE_POLICY}|rss:${rss}|yt:${yt}|prior:${prior}|sp:${sp}`);
}

function provenanceLink(x: ResolveInput, plan: LegacyPlan): LegacyLink | null {
  const id = plan.provenance.link_id;
  return id ? ((x.links || []).find((l) => l.id === id) || null) : null;
}

export type IdentityEvidence = Identity & {
  title_sim: number | null;
  channel_dominant: boolean;
  rss_overlap: number;
  prior_in_rss: number;
  spotify_verified: boolean;
  spotify_corroborates: boolean;
  spotify_title_sim: number | null;
  link_status: string | null;
  v3_score: number | null;
  dup_other_episode: boolean;
  provenance_via: string;
};

const stripNo = (t: string) => String(t || "").replace(/#?\b\d{1,4}\.?\s*(?:rész|adás|epizód)?\b/giu, " ");

export function identityEvidence(x: ResolveInput, plan: LegacyPlan): IdentityEvidence | null {
  const link = provenanceLink(x, plan);
  if (!link) return null;
  const id = identityCheck(x, link);
  const showTitle = String(x.podcast_title || "");
  const epTitle = String(x.title || "").replace(showTitle, " ");
  const ytTitle = String(link.title || "").replace(showTitle, " ");
  const title_sim = epTitle.trim() && ytTitle.trim() ? Number(titleSim(stripNo(epTitle), stripNo(ytTitle)).toFixed(3)) : null;
  const ch = x.show_channels || {};
  const total = Object.values(ch).reduce((s, n) => s + Number(n || 0), 0);
  const top = Object.entries(ch).sort((a, b) => Number(b[1]) - Number(a[1]))[0];
  const channel_dominant = !!link.channel_id && !!top && top[0] === String(link.channel_id) && Number(top[1]) >= 3 && Number(top[1]) >= total * 0.6;
  const prior = String(x.cleaned_text || "");
  const rssPlain = htmlToPlain(String(x.description || x.summary || ""));
  const rss_overlap = Number(containment(rssPlain, prior).toFixed(3));
  const prior_in_rss = Number(containment(prior, rssPlain).toFixed(3));
  const sp = x.spotify || null;
  const spotify_verified = !!sp && ["name_date", "name_neardate"].includes(String(sp.match_method || ""))
    && Number(sp.match_confidence || 0) >= 0.8 && Number(x.show_sp_conf || 0) >= 0.8;
  const spText = htmlToPlain(String(sp?.spotify_html_description || sp?.spotify_description || ""));
  const spotify_title_sim = spotify_verified && sp?.name ? Number(titleSim(stripNo(String(sp.name)), stripNo(ytTitle)).toFixed(3)) : null;
  const spotify_corroborates = spotify_verified && ((spText.length >= 120 && containment(prior, spText) >= 0.5) || (spotify_title_sim !== null && spotify_title_sim >= 0.85));
  const fs = Number((link.vr || {}).final_score ?? NaN);
  const elsewhere = Number(link.video_confirmed_elsewhere || 0) > 0;
  const epTok = titleTokens(String(x.title || ""), new Set(normalizeTokens(showTitle)));
  const dup_other_episode = elsewhere && !(link.elsewhere_titles || []).every((t) => cov(epTok, tokenPool(String(t || ""))) >= 0.8);
  return {
    ...id, title_sim, channel_dominant, rss_overlap, prior_in_rss, spotify_verified, spotify_corroborates, spotify_title_sim,
    link_status: link.status, v3_score: Number.isFinite(fs) ? fs : null, dup_other_episode, provenance_via: plan.provenance.via,
  };
}

/** Deterministic identity verdict for an unverified pairing. */
export function identityVerdict(ev: IdentityEvidence | null): { verdict: Verdict; why: string[] } {
  if (!ev) return { verdict: "ambiguous", why: ["no_provenance_link"] };
  const why: string[] = [];
  const titleOk = (ev.title_sim ?? 0) >= 0.7 || (ev.title_cov ?? 0) >= 0.75;
  const titleBad = (ev.title_sim ?? 1) < 0.3 && (ev.title_cov ?? 1) < 0.3;
  const contentLinked = ev.rss_overlap >= 0.3 || ev.prior_in_rss >= 0.3;
  if (ev.number_conflict) why.push("episode_number_conflict");
  if (ev.date_days !== null && ev.date_days > 120) why.push("release_dates_far_apart");
  if (ev.dup_other_episode) why.push("video_confirmed_for_other_episode");
  if (!ev.channel_ok && !contentLinked) why.push("channel_not_show_channel");
  if (titleBad && !contentLinked && !ev.spotify_corroborates) why.push("title_and_content_unrelated");
  if (why.length) return { verdict: "incorrect", why };
  if (titleOk && ev.channel_ok && ev.date_days !== null && ev.date_days <= 14
    && (contentLinked || ev.spotify_corroborates || (ev.channel_dominant && ev.date_days <= 3 && (ev.title_sim ?? 0) >= 0.85))) {
    return { verdict: "correct", why: ["title_match", "channel_ok", `date_${ev.date_days}d`, contentLinked ? "content_overlaps_rss" : ev.spotify_corroborates ? "spotify_corroborates" : "dominant_channel_same_days"] };
  }
  return { verdict: "ambiguous", why: ["insufficient_deterministic_evidence"] };
}

/** Deterministic validation of an AI decision: schema, cited spans verbatim, threshold. */
export function validateAiDecision(raw: unknown, inputs: Record<string, string>): { ok: boolean; reasons: string[]; decision: AiDecision | null } {
  const r = raw as AiDecision | null;
  const reasons: string[] = [];
  if (!r || typeof r !== "object") return { ok: false, reasons: ["not_object"], decision: null };
  if (!["yes", "no", "uncertain"].includes(r.same_episode)) reasons.push("bad_same_episode");
  if (typeof r.confidence !== "number" || !(r.confidence >= 0 && r.confidence <= 1)) reasons.push("bad_confidence");
  if (!Array.isArray(r.evidence) || !r.evidence.length) reasons.push("no_evidence");
  const norm = (s: string) => ws(s).toLowerCase();
  const verbatim = (Array.isArray(r.evidence) ? r.evidence : []).filter((e) => {
    const src = inputs[String(e?.source || "")];
    const q = norm(String(e?.quote || ""));
    return !!src && q.length >= 4 && norm(src).includes(q);
  });
  if (Array.isArray(r.evidence) && verbatim.length < r.evidence.length) reasons.push("evidence_not_verbatim");
  if (verbatim.length < 2) reasons.push("too_little_verbatim_evidence");
  const sources = new Set(verbatim.map((e) => e.source));
  if (r.same_episode === "yes" && !(sources.has("stored_text") && (sources.has("rss") || sources.has("episode_title") || sources.has("spotify")))) reasons.push("yes_without_cross_source_evidence");
  if (r.same_episode !== "uncertain" && Number(r.confidence) < AI_MIN_CONFIDENCE) reasons.push("below_confidence_threshold");
  if (r.same_episode === "uncertain") reasons.push("model_uncertain");
  return { ok: reasons.length === 0, reasons, decision: r };
}

function baseItemFields(x: ResolveInput, fp: string) {
  return { episode_id: String(x.id), expected_source_hash: x.source_hash ?? null, quality_version: CLEAN_TEXT_QUALITY_VERSION, _fp: fp };
}

export type ResolveOptions = { method?: string; protectedBatches?: string[]; recurring?: Set<string> | null; ai?: { decision: AiDecision; validated: boolean } | null };

export async function planLegacyResolve(x: ResolveInput, opts: ResolveOptions = {}): Promise<ResolvePlan> {
  const baseMethod = String(opts.method || "deterministic_v4");
  const v1 = await planLegacyYtdesc(x, { method: baseMethod, protectedBatches: opts.protectedBatches });
  const link = provenanceLink(x, v1);
  const fp = await resolveFingerprint(x, link);
  const prior = String(x.cleaned_text || "").trim();
  const priorSha = await sha256Hex(String(x.cleaned_text || ""));
  const base = {
    episode_id: String(x.id), policy: LEGACY_RESOLVE_POLICY, fingerprint: fp, parts: [] as ResolvePlan["parts"],
    rss_only_units: [] as string[], dropped_units: [] as ResolvePlan["dropped_units"], ai_eligible: false,
    prior_len: prior.length, next_len: prior.length, preview: "", verdict: null as Verdict | null,
  };
  const res = (group: ResolvePlan["group"], status: LegacyQueueStatus, outcome: string, reasons: string[], extra: Partial<ResolvePlan> = {}): ResolvePlan =>
    ({ ...base, group, status, outcome, write: "none", reasons: [LEGACY_RESOLVE_POLICY, ...reasons], evidence: {}, ...extra });

  // Anything the v1 planner no longer routes to review (protected, runner-owned, changed) keeps v1's decision.
  if (v1.status !== "needs_review") {
    return res("v1", v1.status, v1.outcome, v1.reasons.slice(0, 10), { write: v1.write, item: v1.item ? { ...v1.item, _fp: fp } : undefined, next_len: v1.next_len });
  }

  const rss = rssCandidate(x, baseMethod);
  const evidence: Record<string, unknown> = { v1_outcome: v1.outcome, provenance: v1.provenance, rss_reasons: rss.reasons.slice(0, 8) };

  // Text built from RSS sentences only (dropped units excluded) — the safe replacement for wrong videos.
  const rssFiltered = () => {
    const f = rssOnlyAdditions("", rss.text, rss.raw, opts.recurring);
    const text = f.section.trim();
    const why: string[] = [];
    if (!rss.text) why.push("no_rss_text");
    if (text.length < 40) why.push("rss_filtered_too_short");
    if (LINKISH_RX.test(text)) why.push("rss_link");
    if (missingNames(rss.text, text).length) why.push("rss_names_in_dropped_units");
    if ([...timecodes(rss.text)].some((t) => !timecodes(text).has(t))) why.push("rss_timecodes_dropped");
    const verdict = validateCleanOutput(rss.raw, text);
    if (!["valid", "valid_short"].includes(verdict.status)) why.push(`rss_verdict_${verdict.status}`);
    return { text, why, dropped: f.dropped, verdict: verdict.status };
  };
  const rssReplaceItem = async (text: string, verdict: string, reason: string) => ({
    ...baseItemFields(x, fp),
    cleaned_text: text,
    source_hash: await sha256Hex(`${baseMethod}::${rss.raw}`),
    cleaner_method: baseMethod,
    removed_categories: Array.from(new Set([...rss.removed, "source_rss", "legacy_ytdesc_replaced"])),
    quality_status: verdict,
    quality_reasons: [LEGACY_RESOLVE_POLICY, reason, `prior_method_${x.cleaner_method}`, ...(link ? [`yt_link:${link.id}`] : []), `fp:${fp.slice(0, 16)}`],
    source_type: "rss",
    expected_cleaned_sha256: priorSha,
  });
  const replaceWithRss = async (outcomeOk: string, outcomeNone: string, why: string[]): Promise<ResolvePlan> => {
    if (rss.ok) {
      return res("identity", "done", outcomeOk, [...why, "rss_v1_safe"], { write: "apply", evidence, next_len: rss.text.length, preview: rss.text.slice(0, 400), item: await rssReplaceItem(rss.text, rss.verdict, outcomeOk) });
    }
    const f = rssFiltered();
    if (!f.why.length) {
      return res("identity", "done", outcomeOk, [...why, "rss_filtered_safe"], { write: "apply", evidence, dropped_units: f.dropped, next_len: f.text.length, preview: f.text.slice(0, 400), item: await rssReplaceItem(f.text, f.verdict, outcomeOk) });
    }
    return res("identity", "quarantine", outcomeNone, [...why, ...f.why], { evidence, dropped_units: f.dropped });
  };

  // Merge: stored (verified) text first and unchanged, RSS-only sentences appended.
  const mergePlan = async (identityBasis: string): Promise<ResolvePlan> => {
    if (!rss.text) return res("merge", "done", "legacy_resolve_kept_no_rss_text", [identityBasis], { evidence });
    const add = rssOnlyAdditions(prior, rss.text, rss.raw, opts.recurring);
    const merged = add.section ? `${prior}\n\n${add.section}` : prior;
    const why: string[] = [];
    const namesMissing = missingNames(rss.text, merged);
    const tokensMissing = lostNamedTokens(rss.text, merged).filter((t) => !/^\d/.test(t) && !PLATFORM_TOKEN_RX.test(t) && t !== t.toUpperCase());
    const tcMissing = [...timecodes(rss.text)].filter((t) => !timecodes(merged).has(t));
    if (namesMissing.length) why.push(`rss_names_not_carried_${namesMissing.length}`);
    if (tokensMissing.length > 2) why.push(`rss_named_tokens_not_carried_${tokensMissing.length}`);
    if (tcMissing.length) why.push(`rss_timecodes_not_carried_${tcMissing.length}`);
    if (merged.length > MERGE_MAX_CHARS) why.push("merged_too_long");
    if (LINKISH_RX.test(add.section) || /https?:\/\//i.test(merged)) why.push("merged_link");
    const verdict = validateCleanOutput(`${htmlToPlain(rss.raw)}\n\n${prior}`, merged);
    if (!["valid", "valid_short"].includes(verdict.status)) why.push(`merged_verdict_${verdict.status}`);
    const meta = { evidence: { ...evidence, names_missing: namesMissing.slice(0, 6), tokens_missing: tokensMissing.slice(0, 6), timecodes_missing: tcMissing.slice(0, 6) }, rss_only_units: add.kept, dropped_units: add.dropped };
    if (why.length) return res("merge", "done", "safe_internal_multi_source", [identityBasis, ...why], meta);
    if (add.section.length < MIN_MERGE_ADDED_CHARS) return res("merge", "done", "legacy_resolve_rss_already_covered", [identityBasis, `added_${add.section.length}`], meta);
    const parts: ResolvePlan["parts"] = [
      { source: "youtube", start: 0, end: prior.length, link_id: link?.id ?? null },
      { source: "rss", start: prior.length + 2, end: merged.length },
    ];
    return res("merge", "done", "legacy_resolve_multi_source_merged", [identityBasis, `added_${add.section.length}`, `units_${add.kept.length}`], {
      ...meta, write: "apply", parts, next_len: merged.length, preview: add.section.slice(0, 400),
      item: {
        ...baseItemFields(x, fp),
        cleaned_text: merged,
        source_hash: fp,
        cleaner_method: `${baseMethod}+${MULTISRC_METHOD_TAG}`,
        removed_categories: Array.from(new Set([...(x.removed_categories || []), "source_youtube_description", "source_rss", "multi_source_merge"])),
        quality_status: verdict.status,
        quality_reasons: [LEGACY_RESOLVE_POLICY, "legacy_multi_source_merge", identityBasis, ...(link ? [`yt_link:${link.id}`] : []), `fp:${fp.slice(0, 16)}`],
        source_type: MULTISRC_SOURCE_TYPE,
        expected_cleaned_sha256: priorSha,
      },
    });
  };

  const attributePlan = async (basis: string): Promise<ResolvePlan> => res("identity", "done", "legacy_resolve_corroborated_attributed", [basis], {
    write: "attribute", evidence, parts: [{ source: "youtube", start: 0, end: prior.length, link_id: link?.id ?? null }],
    item: {
      ...baseItemFields(x, fp),
      cleaned_text: prior,
      source_hash: x.source_hash,
      cleaner_method: x.cleaner_method,
      removed_categories: Array.from(new Set([...(x.removed_categories || []), "source_youtube_description", "legacy_ytdesc_identity_corroborated"])),
      quality_status: "valid",
      quality_reasons: [LEGACY_RESOLVE_POLICY, "legacy_identity_corroborated", basis, ...(link ? [`yt_link:${link.id}`] : []), `fp:${fp.slice(0, 16)}`],
      source_type: CORROBORATED_SOURCE_TYPE,
      expected_cleaned_sha256: priorSha,
    },
  });

  // Correct identity without a v3 confirmation: align attribution only, never rewrite or merge.
  const correctPlan = async (basis: string): Promise<ResolvePlan> => {
    const safety = autoApplySafetyReasons(prior, [], { priorLen: 0 });
    const verdict = validateCleanOutput(String(link?.description || prior), prior);
    if (safety.length || verdict.status === "invalid" || LINKISH_RX.test(prior)) return res("identity", "needs_review", "legacy_resolve_correct_text_needs_reclean", [basis, ...safety, ...verdict.reasons], { evidence });
    const rssNames = rss.text ? missingNames(rss.text, prior) : [];
    const p = await attributePlan(basis);
    if (rssNames.length) p.reasons.push(`rss_names_not_in_text_${rssNames.length}_rss_kept_on_page`);
    return p;
  };

  const o = v1.outcome;
  // ---- Path 1: verified video with RSS-only facts.
  if (o === "legacy_verified_rss_unique_facts" || (o === "legacy_rss_unique_facts_review" && v1.provenance.state === "verified")) {
    // Merging needs a high-confidence v3 confirmation of this exact video for this episode.
    if (!link || !v3Verified(link)) return res("merge", "done", "safe_internal_multi_source", ["identity_not_v3_confirmed_no_merge"], { evidence });
    return mergePlan(o === "legacy_verified_rss_unique_facts" ? "identity_v3_verified" : "identity_v3_verified_prior_within_rss");
  }
  // Prior adds <40 chars over RSS but the video is not verified: never combine; use RSS alone.
  if (o === "legacy_rss_unique_facts_review") {
    const namesLost = lostPersonNames(prior, rss.text || "");
    if (namesLost.length) return res("identity", "needs_review", "legacy_resolve_unverified_names_review", [`names_lost_${namesLost.length}`], { evidence, ai_eligible: true });
    return replaceWithRss("legacy_resolve_unverified_rss_replaced", "legacy_resolve_unverified_no_safe_rss", ["prior_within_rss_unverified_video"]);
  }
  if (o === "legacy_verified_uninformative_no_rss") {
    const safety = autoApplySafetyReasons(prior, [], { priorLen: 0 });
    if (!safety.length && !LINKISH_RX.test(prior) && infoUnitsOf(prior).join(" ").length >= 80) {
      return res("other", "done", "legacy_resolve_verified_kept_no_better_source", ["identity_v3_verified", "rss_not_substantive"], { evidence });
    }
    return res("other", "needs_review", "legacy_resolve_verified_low_info_review", safety, { evidence });
  }
  if (o === "legacy_verified_text_needs_reclean" || o === "legacy_verified_auto_gate") {
    return res("other", "needs_review", "legacy_resolve_verified_needs_reclean", ["verified_youtube_lane_reclean_required"], { evidence });
  }

  // ---- Path 2: unverified / wrong identity.
  const ev = identityEvidence(x, v1);
  const det = identityVerdict(ev);
  evidence.identity = ev;
  let verdict: Verdict = det.verdict;
  const why = [...det.why];
  if (verdict === "ambiguous" && opts.ai) {
    if (!opts.ai.validated) why.push("ai_decision_not_validated");
    else if (opts.ai.decision.same_episode === "yes") { verdict = "correct"; why.push("ai_same_episode_validated"); }
    else if (opts.ai.decision.same_episode === "no") { verdict = "incorrect"; why.push("ai_different_episode_validated"); }
    evidence.ai = { same_episode: opts.ai.decision.same_episode, confidence: opts.ai.decision.confidence, validated: opts.ai.validated };
  }
  base.verdict = verdict;
  if (verdict === "correct") return { ...(await correctPlan(`identity_${why.join("+")}`.slice(0, 120))), verdict };
  if (verdict === "incorrect") return { ...(await replaceWithRss("legacy_resolve_wrong_video_rss_replaced", "legacy_resolve_wrong_video_no_safe_source", why)), verdict };
  const priorNovel = novelChars(infoUnitsOf(prior), tokenPool(rss.text || htmlToPlain(String(x.description || ""))));
  return res("identity", "needs_review", opts.ai ? "legacy_resolve_ambiguous_after_ai" : "legacy_resolve_identity_ambiguous", [...why, `prior_novel_${priorNovel}`], { evidence, verdict, ai_eligible: !opts.ai });
}

/** Bounded AI input for one ambiguous row (previews only). */
export function aiReviewInputs(x: ResolveInput, link: LegacyLink | null): Record<string, string> {
  const cut = (s: string, n: number) => ws(s).slice(0, n);
  return {
    episode_title: cut(String(x.title || ""), 300),
    show_title: cut(String(x.podcast_title || ""), 200),
    episode_date: String(x.published_at || "").slice(0, 10),
    rss: cut(htmlToPlain(String(x.description || x.summary || "")), 1800),
    stored_text: cut(String(x.cleaned_text || ""), 1800),
    video_title: cut(String(link?.title || ""), 300),
    video_date: String(link?.published_at || "").slice(0, 10),
    spotify: x.spotify && Number(x.spotify.match_confidence || 0) >= 0.8
      ? cut(`${x.spotify.name || ""} — ${htmlToPlain(String(x.spotify.spotify_html_description || x.spotify.spotify_description || ""))}`, 800) : "",
  };
}

export const AI_REVIEW_PROMPT_VERSION = "legacy_ytdesc_ai_review_v1";
export const AI_REVIEW_INSTRUCTIONS = [
  "You check whether a stored episode description (taken from a YouTube video description) belongs to the SAME podcast episode as the episode's own RSS description.",
  "Use only the given inputs. Do not invent facts or names. Same show but a different episode = no. If you cannot tell, answer uncertain.",
  "evidence: 2-6 short quotes copied character-for-character from the inputs (source = which input). For yes, cite matching specifics found in both stored_text and rss/episode_title/spotify.",
  "facts_from_rss_only / facts_from_yt_only: short verbatim phrases present in only one of rss / stored_text.",
  "overwrite_safe: yes only if replacing stored_text with the RSS text would lose no real episode facts.",
  "reasons: one short sentence in English.",
].join("\n");
export const AI_REVIEW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["same_episode", "confidence", "evidence", "facts_from_rss_only", "facts_from_yt_only", "overwrite_safe", "reasons"],
  properties: {
    same_episode: { type: "string", enum: ["yes", "no", "uncertain"] },
    confidence: { type: "number" },
    evidence: { type: "array", items: { type: "object", additionalProperties: false, required: ["source", "quote"], properties: { source: { type: "string", enum: ["rss", "stored_text", "video_title", "episode_title", "spotify"] }, quote: { type: "string" } } } },
    facts_from_rss_only: { type: "array", items: { type: "string" } },
    facts_from_yt_only: { type: "array", items: { type: "string" } },
    overwrite_safe: { type: "string", enum: ["yes", "no"] },
    reasons: { type: "string" },
  },
} as const;
