// Pure helpers for the AI-judged search / recommendation quality evaluation.
// No I/O here so the scoring, splitting and parsing rules stay unit-testable.

export const JUDGE_PROMPT_VERSION = "search_quality_judge_v1";

export const QUERY_TYPES = [
  "topic", "person", "organization", "podcast_name", "question", "temporal", "typo", "mood", "gibberish", "other",
] as const;
export type QueryType = typeof QUERY_TYPES[number];

export const SEARCH_FAILURE_REASONS = [
  "synonym_drift",   // matched a loosely related word (gazdaság → infláció → böjt)
  "keyword_only",    // shares a word, not the subject
  "generic_news",    // broad news/bulletin episode that mentions everything
  "wrong_entity",    // a different person/organization/podcast with a similar name
  "stale",           // the query asks for recent content, the episode is old
  "wrong_language",  // not Hungarian content
  "other",
] as const;
export const REC_FAILURE_REASONS = [
  "wrong_genre",     // e.g. science → esoteric, comedy → true crime
  "unrelated_topic", // same genre, unrelated subject
  "generic_news",
  "other",
] as const;

export type Judgment = { idx: number; score: 0 | 1 | 2; reason: string | null };

export type CompactResult = {
  idx: number;
  episode_id: string;
  title: string;
  podcast: string;
  category: string | null;
  published: string | null;
  text: string;
};

export function foldQuery(q: string): string {
  return String(q || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[„”"“]/g, '"').replace(/\s+/g, " ").trim();
}

/** Stable 32-bit FNV-1a hash. */
export function stableHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic split: ~30% of queries are held out and never used for tuning. */
export function splitFor(key: string): "dev" | "holdout" {
  return stableHash(foldQuery(key)) % 10 < 3 ? "holdout" : "dev";
}

/** Deterministic calibration sample (~share of items also judged by the stronger model). */
export function shouldCalibrate(key: string, share: number): boolean {
  const s = Math.max(0, Math.min(1, share));
  return (stableHash("cal:" + foldQuery(key)) % 1000) < Math.round(s * 1000);
}

export function cleanQuery(raw: unknown): string | null {
  const q = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (q.length < 2 || q.length > 120) return null;
  return q;
}

export function stripText(s: unknown, max = 280): string {
  const t = String(s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max).replace(/\s+\S*$/, "") + "…" : t;
}

function dcg(gains: number[]) {
  return gains.reduce((s, g, i) => s + (Math.pow(2, g) - 1) / Math.log2(i + 2), 0);
}

/**
 * Per-item metrics from ordered 0/1/2 scores. Missing slots count as 0 for precision
 * (an empty top-3 is not a good top-3). nDCG uses the ideal of an all-2 list of the same
 * length so a list of only "1" results cannot score 1.0.
 */
export function itemMetrics(scores: number[]) {
  const s = scores.map((v) => (v === 2 ? 2 : v === 1 ? 1 : 0));
  const top3 = s.slice(0, 3);
  const top10 = s.slice(0, 10);
  const good = (arr: number[]) => arr.filter((v) => v === 2).length;
  const ideal = dcg(new Array(Math.max(1, top10.length)).fill(2));
  return {
    n: s.length,
    empty: s.length === 0,
    p_at_1: s.length ? (s[0] === 2 ? 1 : 0) : 0,
    p_at_3: good(top3) / 3,
    p_at_10: good(top10) / 10,
    ndcg_at_10: top10.length ? dcg(top10) / ideal : 0,
    top1_off_topic: s.length > 0 && s[0] === 0,
    top3_has_off_topic: top3.includes(0),
    off_topic_share_10: top10.length ? top10.filter((v) => v === 0).length / top10.length : 0,
  };
}

type MetricRow = ReturnType<typeof itemMetrics>;

export function aggregateMetrics(rows: MetricRow[]) {
  const n = rows.length;
  const avg = (f: (r: MetricRow) => number) => (n ? rows.reduce((a, r) => a + f(r), 0) / n : null);
  const round = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000);
  return {
    queries: n,
    p_at_1: round(avg((r) => r.p_at_1)),
    p_at_3: round(avg((r) => r.p_at_3)),
    p_at_10: round(avg((r) => r.p_at_10)),
    ndcg_at_10: round(avg((r) => r.ndcg_at_10)),
    top1_off_topic_rate: round(avg((r) => (r.top1_off_topic ? 1 : 0))),
    top3_off_topic_rate: round(avg((r) => (r.top3_has_off_topic ? 1 : 0))),
    off_topic_share_10: round(avg((r) => r.off_topic_share_10)),
    empty_rate: round(avg((r) => (r.empty ? 1 : 0))),
  };
}

export function buildSearchJudgeMessages(query: string, today: string, results: CompactResult[], recencyWindowDays: number | null = null) {
  const system = [
    "You grade search results of Podiverzum, a Hungarian podcast search engine. Be strict and literal.",
    "For each result give score: 2 = the episode is clearly about what the searcher wants;",
    "1 = partially or tangentially related (useful but not on target); 0 = not about it (shares only a word, a loose synonym, or a different subject).",
    "Rules: a podcast or person name query → episodes of that podcast / featuring that person score 2, a different person or show with a similar name scores 0 (reason wrong_entity).",
    recencyWindowDays
      ? `This query asks for RECENT content: an on-topic episode published more than ${recencyWindowDays} days before today scores at most 1 (reason stale).`
      : "This query does NOT ask for recent content: ignore publication dates completely and never use reason stale.",
    "A broad daily news bulletin that merely lists the topic among many scores at most 1 (reason generic_news).",
    "For every score below 2 give a reason from: " + SEARCH_FAILURE_REASONS.join(", ") + ".",
    "Also classify the query into one query_type from: " + QUERY_TYPES.join(", ") + ".",
    "Judge only from the given title, show, category, date and public description.",
  ].join(" ");
  const user = `Today: ${today}\nQuery: ${query}\nResults:\n` + results.map((r) =>
    `[${r.idx}] ${r.title} — ${r.podcast}${r.category ? ` (${r.category})` : ""}${r.published ? `, ${r.published}` : ""}\n    ${r.text}`
  ).join("\n");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

export function buildRecJudgeMessages(seed: CompactResult, results: CompactResult[]) {
  const system = [
    "You grade 'similar episodes' recommendations of Podiverzum, a Hungarian podcast site.",
    "The listener has just listened to the SEED episode. For each recommendation give score:",
    "2 = a listener of the seed would plausibly want it (same subject, or clearly related subject in a compatible genre);",
    "1 = loosely related; 0 = mismatched.",
    "A genre clash (science ↔ esoteric/paranormal, serious news ↔ comedy, children ↔ true crime) is always 0 with reason wrong_genre.",
    "For every score below 2 give a reason from: " + REC_FAILURE_REASONS.join(", ") + ".",
    "Set query_type to \"other\".",
  ].join(" ");
  const user = `SEED: ${seed.title} — ${seed.podcast}${seed.category ? ` (${seed.category})` : ""}\n    ${seed.text}\nRecommendations:\n` +
    results.map((r) => `[${r.idx}] ${r.title} — ${r.podcast}${r.category ? ` (${r.category})` : ""}\n    ${r.text}`).join("\n");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

export const JUDGE_TOOL = {
  type: "function",
  function: {
    name: "grade",
    description: "Return one grade per result index.",
    parameters: {
      type: "object",
      properties: {
        query_type: { type: "string", enum: [...QUERY_TYPES] },
        grades: {
          type: "array",
          items: {
            type: "object",
            properties: {
              idx: { type: "integer" },
              score: { type: "integer", enum: [0, 1, 2] },
              reason: { type: "string" },
            },
            required: ["idx", "score"],
            additionalProperties: false,
          },
        },
      },
      required: ["query_type", "grades"],
      additionalProperties: false,
    },
  },
} as const;

/**
 * Validate a judge reply. Every result index must be graded exactly once with 0/1/2,
 * otherwise the reply is rejected (null) instead of silently filling gaps.
 */
export function parseJudgment(
  raw: unknown,
  n: number,
  allowedReasons: readonly string[],
  allowStale = true,
): { query_type: QueryType; grades: Judgment[] } | null {
  let obj: any = raw;
  if (typeof raw === "string") {
    try { obj = JSON.parse(raw); } catch { return null; }
  }
  if (!obj || !Array.isArray(obj.grades)) return null;
  const byIdx = new Map<number, Judgment>();
  // Accept a consistently 1-based reply (1..n) by shifting it; anything else must be 0..n-1.
  const rawIdx = obj.grades.map((g: any) => Number(g?.idx));
  const oneBased = n > 0 && !rawIdx.includes(0) && rawIdx.includes(n);
  for (const g of obj.grades) {
    const idx = Number(g?.idx) - (oneBased ? 1 : 0);
    const score = Number(g?.score);
    // Extra out-of-range rows or repeated rows are ignored (first one wins);
    // every index 0..n-1 must still be graded exactly once with 0/1/2.
    if (!Number.isInteger(idx) || idx < 0 || idx >= n) continue;
    if (byIdx.has(idx)) continue;
    if (![0, 1, 2].includes(score)) return null;
    const reasonRaw = typeof g?.reason === "string" ? g.reason.trim() : "";
    let reason = score === 2 ? null : (allowedReasons.includes(reasonRaw) ? reasonRaw : "other");
    if (reason === "stale" && !allowStale) reason = "other";
    byIdx.set(idx, { idx, score: score as 0 | 1 | 2, reason });
  }
  if (byIdx.size !== n) return null;
  const qt = QUERY_TYPES.includes(obj.query_type) ? obj.query_type as QueryType : "other";
  return { query_type: qt, grades: [...byIdx.values()].sort((a, b) => a.idx - b.idx) };
}

/** Agreement between primary and calibration judges on the same items. */
export function judgeAgreement(a: Judgment[], b: Judgment[]) {
  const m = new Map(b.map((g) => [g.idx, g.score]));
  let exact = 0, within1 = 0, binary = 0, total = 0;
  for (const g of a) {
    const o = m.get(g.idx);
    if (o === undefined) continue;
    total++;
    if (o === g.score) exact++;
    if (Math.abs(o - g.score) <= 1) within1++;
    if ((o === 2) === (g.score === 2)) binary++;
  }
  return { total, exact, within1, binary };
}
