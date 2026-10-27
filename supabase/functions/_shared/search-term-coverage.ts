// Query-term coverage ordering for search-hybrid (pure; shared with tests).
//
// Measured failure (search-quality-eval, Oct 2026): the dominant off-topic reason was
// "keyword_only" — results matching only one word of a multi-word query ("Mol benzinár"
// → Mol news) or merely mentioning a single-word query deep in a long description.
// This stable re-partition puts results that cover every content word first (multi-word
// queries) or carry a single-word query in the title / show / tags (single-word queries).
// It never drops a result and keeps the incoming order inside each tier.

import { isTemporalToken } from "./search-temporal.ts";

const STOP = new Set((
  "a an the is of in on at to by as or and for with " +
  "az es vagy de hogy mert ez egy van volt lesz csak mar meg most ha sem is ne nem igen " +
  "mi mit mire miert hogyan hol mikor melyik milyen mennyi kinek kell lehet erdemes ami aki " +
  "szet ossze el ki fel le at " +
  "podcast podcastok epizod epizodok musor musorok adas beszelgetes interju resz reszek " +
  "rol rola arrol errol szol szolo beszeltek beszelnek uj jo legjobb"
).split(" "));

export function foldTerm(s: string): string {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

/** Content words of a query (accent-folded), without stopwords, recency words or short numbers. */
export function queryContentTerms(q: string): string[] {
  const out: string[] = [];
  for (const t of foldTerm(q).split(/[^a-z0-9]+/)) {
    if (t.length < 2 || STOP.has(t) || isTemporalToken(t)) continue;
    if (/^\d+$/.test(t) && t.length < 3) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, 8);
}

// Hungarian is agglutinative: "benzinár" must match "benzinárak", "építészet" → "építészeti".
// Common case/plural endings are cut first ("párok" → "pár", "válásról" → "válás").
const SUFFIXES = ["oknak", "eknek", "aknak", "nak", "nek", "rol", "bol", "tol", "ban", "ben", "val", "vel", "hoz", "hez", "ok", "ek", "ak", "ra", "re", "t"];
export function stemOf(term: string): string {
  let t = term;
  if (!/^\d+$/.test(t)) {
    for (const s of SUFFIXES) {
      if (t.length - s.length >= 3 && t.endsWith(s)) { t = t.slice(0, -s.length); break; }
    }
  }
  return t.length <= 4 ? t : t.slice(0, Math.max(4, t.length - 2));
}

function wordsOf(parts: unknown[]): string[] {
  return foldTerm(parts.map((p) => (Array.isArray(p) ? p.join(" ") : String(p ?? ""))).join(" ")).split(/[^a-z0-9]+/).filter(Boolean);
}

function covered(terms: string[], words: string[]): number {
  let n = 0;
  for (const t of terms) {
    const s = stemOf(t);
    if (words.some((w) => w.startsWith(s))) n++;
  }
  return n;
}

const headFields = (e: any) => [e.title, e.display_title, e.podcasts?.title, e.podcasts?.display_title, e.topics];
const allFields = (e: any) => [...headFields(e), e.people, e.companies, String(e.ai_summary || e.summary || e.description || "").slice(0, 1200)];

export type CoverageResult<T> = { list: T[]; applied: "multi" | "single" | null; terms: string[] };

/**
 * Re-partitions the top `window` results by query-term coverage.
 * Multi-word: more covered words first, only when at least one result covers every word.
 * Single-word: title/show/tag hits first, only when at least `minStrong` such results exist.
 */
export function rankByTermCoverage<T>(list: T[], query: string, opts: { window?: number; minStrong?: number } = {}): CoverageResult<T> {
  const terms = queryContentTerms(query);
  const window = opts.window ?? 30;
  const minStrong = opts.minStrong ?? 3;
  if (!terms.length || list.length < 2) return { list, applied: null, terms };
  const head = list.slice(0, window);
  const tail = list.slice(window);
  if (terms.length >= 2) {
    const sc = head.map((e) => covered(terms, wordsOf(allFields(e))));
    if (!sc.some((c) => c === terms.length)) return { list, applied: null, terms };
    const order = head.map((e, i) => ({ e, i, c: sc[i] })).sort((a, b) => b.c - a.c || a.i - b.i);
    return { list: [...order.map((x) => x.e), ...tail], applied: "multi", terms };
  }
  const strong = head.map((e) => covered(terms, wordsOf(headFields(e))) > 0);
  if (strong.filter(Boolean).length < minStrong) return { list, applied: null, terms };
  const order = head.map((e, i) => ({ e, i, s: strong[i] ? 0 : 1 })).sort((a, b) => a.s - b.s || a.i - b.i);
  return { list: [...order.map((x) => x.e), ...tail], applied: "single", terms };
}
