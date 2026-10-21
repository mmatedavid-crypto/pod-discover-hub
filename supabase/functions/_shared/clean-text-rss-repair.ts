// Deterministic ($0) planner for repairing existing clean text from the
// episode's own RSS description. Pure apart from hashing; no DB writes here.
//
// Never worsens confirmed good text:
// - prior text from another source (YouTube/Spotify/article/transcript) is kept,
// - any active repair backup (reviewed canaries, earlier repairs) protects the row,
// - episodes owned by the clean-text runner (pending/error) are left alone,
// - a non-empty prior is replaced only when every prior name/topic/timecode is
//   kept and real information is added,
// - output must be extract-only, link-free, and pass the clean-text validator.
import { heuristicClean, validateExtractOnlyTrim } from "./episode-text-cleaner.ts";
import {
  CLEAN_TEXT_QUALITY_VERSION,
  RESCUE_METHOD_SUFFIX,
  decideCleanText,
  htmlToPlain,
  lostNamedTokens,
} from "./clean-text-validation.ts";
import { youtubeRecleanGate } from "./youtube-source-gain.ts";

export const RSS_REPAIR_KINDS = ["empty_substantive", "empty_any", "overcut", "missing_rss"] as const;
export const RSS_REPAIR_MAX_CANARY = 50;
/** A non-empty prior is replaced only when the new text adds at least this many names/timecodes. */
export const MIN_ADDED_NAMED_EVIDENCE = 2;
/** The same description on this many episodes of one show is a channel blurb, not episode content. */
export const SHOW_BOILERPLATE_MIN_REPEATS = 3;
const ALT_SOURCE_METHOD_RX = /youtube|ytdesc|multisrc|spotify|transcript|article/i;
const EVIDENCE_TOKEN_RX = /\d{1,2}:\d{2}(?::\d{2})?|\p{Lu}[\p{L}'’-]{2,}/gu;
const NON_EVIDENCE_RX = /^(?:(?:facebook|instagram|insta|tiktok|youtube|spotify|apple|google|patreon|discord|telegram|linkedin|threads|twitter|twitch|soundcloud|deezer|itunes)\p{L}*|weboldal|honlap|hírlevél|web|e-?mail|podcast\p{L}*|adószám|számlaszám|bankszámla|paypal|donably|revolut|visit|learn|ön\p{L}*)$/iu;

/**
 * Timecodes and mid-sentence capitalised words (names, titles, places) in `next`
 * that `prior` does not contain. Sentence-initial words and platform/CTA words do
 * not count, so added promo or call-to-action sentences are not "information".
 */
export function addedNamedEvidence(prior: string, next: string): string[] {
  const p = String(prior || "");
  const out = new Set<string>();
  const text = String(next || "");
  for (const m of text.matchAll(EVIDENCE_TOKEN_RX)) {
    const tok = m[0];
    if (p.includes(tok) || NON_EVIDENCE_RX.test(tok)) continue;
    if (!/^\d/.test(tok)) {
      const rawBefore = text.slice(Math.max(0, (m.index ?? 0) - 4), m.index ?? 0);
      if (/\n\s*$/.test(rawBefore)) continue; // line start
      const prev = Array.from(rawBefore.replace(/\s+$/, "")).pop() || "";
      if (!prev || /[.!?…\n"„“»«(\[\p{Extended_Pictographic}•·|-]/u.test(prev)) continue;
    }
    out.add(tok);
  }
  return Array.from(out);
}

export type RssRepairTarget = {
  episode_id: string;
  description: string | null;
  summary: string | null;
  clean_text_status: string | null;
  best_source_type?: string | null;
  current_source_hash?: string | null;
  current_cleaned_text?: string | null;
  current_cleaner_method?: string | null;
  has_clean_row?: boolean | null;
  active_backups?: number | null;
  /** Episodes of the same show with this exact description (show-level boilerplate when ≥3). */
  same_description_in_show?: number | null;
};

export type RssRepairPlan = {
  episode_id: string;
  outcome: "apply" | "reject";
  reasons: string[];
  prior_len: number;
  next_len: number;
  prior_method: string | null;
  lost_from_source: string[];
  preview: string;
  item?: Record<string, unknown>;
};

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function planRssRepair(t: RssRepairTarget, opts: { method?: string } = {}): Promise<RssRepairPlan> {
  const baseMethod = String(opts.method || "deterministic_v4");
  const prior = String(t.current_cleaned_text || "").trim();
  const priorMethod = t.current_cleaner_method ?? null;
  const base = { episode_id: String(t.episode_id), prior_len: prior.length, prior_method: priorMethod, lost_from_source: [] as string[] };
  const reject = (reasons: string[], next = ""): RssRepairPlan => ({ ...base, outcome: "reject", reasons, next_len: next.length, preview: next.slice(0, 400) });

  const status = String(t.clean_text_status || "");
  if (status === "pending" || status === "error") return reject([`clean_text_status_${status}_runner_owns`]);
  if (Number(t.active_backups || 0) > 0) return reject(["protected_prior_repair"]);
  if (prior && ALT_SOURCE_METHOD_RX.test(String(priorMethod || ""))) return reject(["prior_alt_source_kept"]);
  if (t.best_source_type && t.best_source_type !== "rss") return reject([`best_source_${t.best_source_type}_own_lane`]);
  if (Number(t.same_description_in_show || 0) >= SHOW_BOILERPLATE_MIN_REPEATS) return reject(["show_level_boilerplate_description"]);

  const raw = String(t.description || t.summary || "").trim();
  if (!raw) return reject(["no_rss_source"]);
  const decision = decideCleanText({ raw, v4: heuristicClean(raw), priorCleanedText: null });
  if (decision.action !== "write") return reject([`decision_${decision.action}`, ...((decision as any).reasons || [])]);
  const text = decision.text.trim();
  const reasons: string[] = [];
  if (decision.verdict.status !== "valid" && decision.verdict.status !== "valid_short") reasons.push(`verdict_${decision.verdict.status}`);
  if (/https?:\/\/|<a\s|www\./i.test(text)) reasons.push("residual_url");
  if (text.length < 40) reasons.push("too_short");
  const extract = validateExtractOnlyTrim(htmlToPlain(raw), text, { minOverlap: 0.98, maxAddedTokenRatio: 0.03, minCompressionRatio: 0 });
  if (!extract.ok) reasons.push(...extract.reasons.map((r: string) => `extract_${r}`));
  if (prior) {
    if (lostNamedTokens(prior, text).length) reasons.push("would_lose_prior_names");
    if (addedNamedEvidence(prior, text).length < MIN_ADDED_NAMED_EVIDENCE) reasons.push("no_added_names_or_timecodes");
    const gate = youtubeRecleanGate(prior, text, { min_info_gain_chars: 40 });
    reasons.push(...gate.reasons.filter((r) => r !== "residual_url"));
  }
  if (reasons.length) return reject(reasons, text);

  const method = `${baseMethod}${decision.rescued ? `+${RESCUE_METHOD_SUFFIX}` : ""}`;
  const plan: RssRepairPlan = {
    ...base,
    outcome: "apply",
    reasons: [decision.rescued ? "rss_rescue_extract_only" : "rss_v4_valid", prior ? "prior_kept_and_extended" : "prior_empty_or_missing"],
    next_len: text.length,
    lost_from_source: (() => {
      const lost = lostNamedTokens(htmlToPlain(raw), text);
      const tc = lost.filter((x) => /^\d{1,2}:\d{2}/.test(x));
      return [...tc, ...lost.filter((x) => !tc.includes(x)).slice(0, 20)];
    })(),
    preview: text.slice(0, 400),
    item: {
      episode_id: String(t.episode_id),
      cleaned_text: text,
      source_hash: await sha256Hex(`${method}::${raw}`),
      cleaner_method: method,
      removed_categories: Array.from(new Set([...decision.removed, "source_rss", "rss_repair_v1"])),
      quality_status: decision.verdict.status,
      quality_reasons: ["rss_repair_v1", `prior_method_${priorMethod ?? "none"}`],
      quality_version: CLEAN_TEXT_QUALITY_VERSION,
      source_type: "rss",
      expected_source_hash: t.has_clean_row ? (t.current_source_hash ?? null) : null,
      expected_cleaned_sha256: t.has_clean_row ? await sha256Hex(String(t.current_cleaned_text || "")) : null,
    },
  };
  return plan;
}
