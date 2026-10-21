// Pure policy for the durable clean-text repair queue (clean_text_repair_queue).
// Maps an RSS repair plan (_shared/clean-text-rss-repair.ts) to a finite queue
// status, and adds an automatic-apply safety gate that is stricter than the
// reviewed-canary planner: anything a human reviewer excluded in the phase-1
// canary (English legal notices, short ads, bank details, supporter lists)
// goes to needs_review instead of being written unattended.
import type { RssRepairPlan } from "./clean-text-rss-repair.ts";
import { conservativeRescueClean } from "./clean-text-validation.ts";

export const QUEUE_STATUSES = [
  "pending", "leased", "done", "no_substantive_source", "protected",
  "needs_review", "quarantine", "retry", "dead",
] as const;
export type QueueStatus = typeof QUEUE_STATUSES[number];

export type QueueResolution = {
  status: Exclude<QueueStatus, "pending" | "leased">;
  outcome: string;
  retry_after_seconds?: number;
};

const NO_SOURCE = new Set(["no_rss_source", "show_level_boilerplate_description", "decision_skip_no_content"]);
const GAIN_ONLY = new Set(["no_added_names_or_timecodes", "insufficient_information_gain"]);
const OUTPUT_UNSAFE_RX = /^(?:decision_quarantine|verdict_|residual_url|extract_)/;

/** Final queue state for a plan that will NOT be applied. */
export function resolveRejectedPlan(plan: RssRepairPlan): QueueResolution {
  const r = plan.reasons;
  const has = (x: string) => r.includes(x);
  const prior = plan.prior_len > 0;
  if (r.some((x) => /^clean_text_status_(pending|error)_runner_owns$/.test(x))) {
    return { status: "retry", outcome: "runner_owns", retry_after_seconds: 3600 };
  }
  if (has("protected_prior_repair")) return { status: "protected", outcome: "protected_backup" };
  if (has("prior_alt_source_kept") || r.some((x) => /^best_source_.+_own_lane$/.test(x))) {
    return { status: "protected", outcome: "alt_source_lane" };
  }
  if (r.some((x) => NO_SOURCE.has(x))) return { status: "no_substantive_source", outcome: r.find((x) => NO_SOURCE.has(x))! };
  if (has("would_lose_prior_names") || has("would_lose_prior_content")) return { status: "needs_review", outcome: "would_lose_prior" };
  if (prior) {
    // Current non-empty text is kept: RSS adds nothing informative, or the RSS
    // rescue is not safe. Both are a finished state, not an error.
    if (r.every((x) => GAIN_ONLY.has(x))) return { status: "done", outcome: "kept_prior_no_gain" };
    if (r.every((x) => GAIN_ONLY.has(x) || OUTPUT_UNSAFE_RX.test(x) || x === "too_short" || x.startsWith("decision_") || x.startsWith("v4_") || x.startsWith("rescue_"))) {
      return { status: "done", outcome: "kept_prior_rss_not_safer" };
    }
    return { status: "needs_review", outcome: "prior_kept_unclassified" };
  }
  if (has("too_short")) return { status: "no_substantive_source", outcome: "too_short_after_cleaning" };
  if (r.some((x) => OUTPUT_UNSAFE_RX.test(x) || x.startsWith("decision_"))) return { status: "quarantine", outcome: "cleaner_output_unsafe" };
  return { status: "needs_review", outcome: "unclassified" };
}

const HU_DIACRITIC_RX = /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/g;
const EN_STOP_RX = /(?<!\p{L})(?:the|and|of|to|is|are|this|that|with|for|you|your|our|we|be|by|or|any|all|not|on|in)(?!\p{L})/giu;
const HU_STOP_RX = /(?<!\p{L})(?:a|az|és|hogy|nem|egy|ez|de|meg|mint|már|van|volt|lesz|vagy|csak|még|mi|ki)(?!\p{L})/giu;
const BANK_RX = /\b\d{8}-\d{8}(?:-\d{8})?\b|\bIBAN\b|\bHU\d{2}\s?\d{4}/i;
const AD_RX = /\b(?:kuponk[oó]d\p{L}*|kedvezm[eé]ny\p{L}*|promo(?:ci[oó]s)?\s*k[oó]d\p{L}*|akci[oó]s|hirdet[eé]s|szponzor\p{L}*|discount|promo\s*code|sponsored)\b|\d{1,2}\s?%/iu;
const SUPPORTER_RX = /\b(?:t[aá]mogat[oó]ink|t[aá]mogat[oó]i(?:nk)?|patrons?|k[oö]sz[oö]nj[uü]k\s+t[aá]mogat[oó])\b/iu;

/** Extra gate for unattended writes. Returns reasons; empty means safe. */
const PLATFORM_LABEL_RX = /(?:facebook|instagram|youtube|spotify|tiktok|apple\s*podcasts?|google\s*podcasts?|podcast\s*szolgáltató|linkedin|twitter|discord|patreon|telegram|threads|weboldal|honlap)\p{L}*\s*:/giu;

export function autoApplySafetyReasons(text: string, lostFromSource: string[] = [], opts: { priorLen?: number } = {}): string[] {
  const t = String(text || "");
  const reasons: string[] = [];
  // Replacing existing text: link-label leftovers ("YouTube: … Instagram:") are not an improvement.
  if (Number(opts.priorLen || 0) > 0 && (t.match(PLATFORM_LABEL_RX) || []).length >= 2) reasons.push("auto_gate_link_label_residue");
  // Chapter timecodes present in the RSS but not in the output: a human decides.
  if (lostFromSource.some((x) => /^\d{1,2}:\d{2}/.test(x))) reasons.push("auto_gate_lost_timecodes");
  const words = (t.match(/[\p{L}]+/gu) || []).length;
  const hu = (t.match(HU_STOP_RX) || []).length + (t.match(HU_DIACRITIC_RX) || []).length;
  const en = (t.match(EN_STOP_RX) || []).length;
  if (words >= 12 && en >= 4 && en > hu) reasons.push("auto_gate_mostly_english");
  if (BANK_RX.test(t)) reasons.push("auto_gate_bank_details");
  if (t.length < 120 && AD_RX.test(t)) reasons.push("auto_gate_short_ad");
  if (SUPPORTER_RX.test(t)) {
    const caps = (t.match(/\p{Lu}[\p{Ll}'’-]{2,}/gu) || []).length;
    if (caps >= 12 && caps / Math.max(1, words) > 0.4) reasons.push("auto_gate_supporter_list");
  }
  return reasons;
}

/** Retry backoff for CAS conflicts: 10 min, 30 min, 90 min … capped at 24 h. */
export function backoffSeconds(attempts: number): number {
  return Math.min(24 * 3600, 600 * Math.pow(3, Math.max(0, attempts - 1)));
}

const CREDIT_RX = /(?<![\p{L}])(?:műsorvezető|házigazda|vendég\p{L}*|szerkesztő\p{L}*|riporter|beszélgetőtárs\p{L}*|host|guest|közreműköd\p{L}*)(?![\p{L}])/iu;
const TIMECODE_RX = /\d{1,2}:\d{2}/;

/**
 * Removal-only: drops sentences/lines that recur across the show's other RSS
 * descriptions (channel taglines, paywall/subscription notes, music credits,
 * platform lists). Host/guest credits and timecodes are always kept. Returns the
 * input unchanged when the result would be under 40 characters.
 */
export function stripRecurringSentences(text: string, recurring: Set<string> | null | undefined, unitKey: (s: string) => string): string {
  const t = String(text || "");
  if (!recurring || !recurring.size) return t;
  const lines = t.split("\n").map((line) => {
    const parts = line.split(/(?<=[.!?…])\s+/);
    const kept = parts.filter((p) => {
      const k = unitKey(p);
      if (!k || k.split(" ").length < 3 || !recurring.has(k)) return true;
      return CREDIT_RX.test(p) || TIMECODE_RX.test(p);
    });
    return kept.join(" ").trim();
  }).filter(Boolean);
  const out = lines.join("\n").trim();
  return out.length >= 40 ? out : t;
}

/** Sentence keys (≥3 tokens) that appear in at least `minCount` of the given RSS descriptions. */
export function recurringSentenceKeys(descriptions: string[], unitKey: (s: string) => string, minCount = 2): Set<string> {
  const counts = new Map<string, number>();
  for (const d of descriptions) {
    const keys = new Set<string>();
    for (const line of conservativeRescueClean(d).text.split("\n")) {
      for (const p of line.split(/(?<=[.!?…])\s+/)) {
        const k = unitKey(p);
        if (k && k.split(" ").length >= 3) keys.add(k);
      }
    }
    for (const k of keys) counts.set(k, (counts.get(k) || 0) + 1);
  }
  const out = new Set<string>();
  for (const [k, n] of counts) if (n >= minCount) out.add(k);
  return out;
}
