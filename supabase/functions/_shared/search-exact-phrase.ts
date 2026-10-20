// Google-style exact phrase search ("..." / „...”).
// Pure helpers shared by the search-hybrid edge function and the frontend.
// Quoted text must appear as a contiguous word sequence (case- and
// accent-insensitive) inside ONE field; unquoted words must all appear; words
// prefixed with "-" must not appear. No synonyms, no semantic expansion.

export type ExactPhraseQuery = {
  hasExact: boolean;
  /** Folded (lowercase, accentless) tokens per quoted phrase. */
  phrases: string[][];
  /** Lowercase tokens with original accents per quoted phrase. */
  phrasesRaw: string[][];
  /** Human-readable quoted phrases as typed. */
  labels: string[];
  freeTerms: string[];
  freeTermsRaw: string[];
  excluded: string[];
  excludedRaw: string[];
  /** Query without quote characters (for podcast / person lookups). */
  plainText: string;
};

const QUOTE_CHARS = /["„“”‟″«»]/g;
const TOKEN_RE = /[\p{L}\p{N}]+/gu;

export function foldExact(s: string): string {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function rawTokens(s: string): string[] {
  return (String(s || "").toLowerCase().normalize("NFC").match(TOKEN_RE) || []);
}

export function stripSearchQuotes(q: string): string {
  return String(q || "").replace(QUOTE_CHARS, " ").replace(/\s+/g, " ").trim();
}

export function parseExactPhraseQuery(q: string): ExactPhraseQuery {
  const input = String(q || "").slice(0, 300).replace(QUOTE_CHARS, '"');
  const parts = input.split('"');
  const phrases: string[][] = [];
  const phrasesRaw: string[][] = [];
  const labels: string[] = [];
  const freeTerms: string[] = [];
  const freeTermsRaw: string[] = [];
  const excluded: string[] = [];
  const excludedRaw: string[] = [];
  const seenPhrase = new Set<string>();
  const seenTerm = new Set<string>();

  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      // Quoted segment (an unterminated trailing quote also counts, like Google).
      const raw = rawTokens(part).slice(0, 12);
      if (!raw.length) return;
      const folded = raw.map(foldExact);
      const key = folded.join(" ");
      if (seenPhrase.has(key) || phrases.length >= 4) return;
      seenPhrase.add(key);
      phrases.push(folded);
      phrasesRaw.push(raw);
      labels.push(part.replace(/\s+/g, " ").trim());
      return;
    }
    for (const word of part.split(/\s+/)) {
      if (!word) continue;
      const negative = word.startsWith("-");
      for (const rawTok of rawTokens(word)) {
        const tok = foldExact(rawTok);
        if (tok.length < 2 || seenTerm.has(`${negative}:${tok}`)) continue;
        seenTerm.add(`${negative}:${tok}`);
        if (negative) { if (excluded.length < 6) { excluded.push(tok); excludedRaw.push(rawTok); } }
        else if (freeTerms.length < 8) { freeTerms.push(tok); freeTermsRaw.push(rawTok); }
      }
    }
  });

  return {
    hasExact: phrases.length > 0,
    phrases, phrasesRaw, labels, freeTerms, freeTermsRaw, excluded, excludedRaw,
    plainText: stripSearchQuotes(q),
  };
}

/** websearch_to_tsquery input for the unaccented episodes.search_tsv. Tokens are letters/digits only. */
export function exactWebsearchQuery(p: ExactPhraseQuery): string {
  return [
    ...p.phrases.map((t) => `"${t.join(" ")}"`),
    ...p.freeTerms,
    ...p.excluded.map((t) => `-${t}`),
  ].join(" ");
}

function variants(raw: string[], folded: string[]): string[][] {
  const a = raw.join(" ");
  const b = folded.join(" ");
  return a === b ? [folded] : [raw, folded];
}

/** to_tsquery input for the accented episode_clean_text FTS index (simple config). */
export function exactCleanTextTsQuery(p: ExactPhraseQuery): string | null {
  if (!p.hasExact) return null;
  const groups: string[] = [];
  p.phrases.forEach((folded, i) => {
    const alts = variants(p.phrasesRaw[i], folded).map((tokens) => `(${tokens.join(" <-> ")})`);
    groups.push(alts.length > 1 ? `(${alts.join(" | ")})` : alts[0]);
  });
  p.freeTerms.forEach((t, i) => {
    const alts = variants([p.freeTermsRaw[i]], [t]).map((x) => x[0]);
    groups.push(alts.length > 1 ? `(${alts.join(" | ")})` : alts[0]);
  });
  p.excluded.forEach((t, i) => {
    for (const alt of variants([p.excludedRaw[i]], [t]).map((x) => x[0])) groups.push(`!${alt}`);
  });
  return groups.join(" & ");
}

function stripTags(s: string): string {
  return String(s || "").replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
}

export function foldedTokens(text: string): string[] {
  return foldExact(stripTags(text)).match(TOKEN_RE) || [];
}

export function tokensContainPhrase(tokens: string[], phrase: string[]): boolean {
  if (!phrase.length || tokens.length < phrase.length) return false;
  outer: for (let i = 0; i <= tokens.length - phrase.length; i++) {
    for (let j = 0; j < phrase.length; j++) if (tokens[i + j] !== phrase[j]) continue outer;
    return true;
  }
  return false;
}

export type ExactField = { key: string; text: string | null | undefined };
export type ExactMatchResult = { ok: boolean; fields: string[] };

/**
 * Every quoted phrase must appear contiguously inside a single field; free
 * terms must appear somewhere; excluded terms must not appear anywhere.
 */
export function exactPhraseMatch(fields: ExactField[], p: ExactPhraseQuery): ExactMatchResult {
  const tokenized = fields
    .filter((f) => f.text)
    .map((f) => ({ key: f.key, tokens: foldedTokens(String(f.text)) }));
  const all = new Set<string>();
  for (const f of tokenized) for (const t of f.tokens) all.add(t);
  if (p.excluded.some((t) => all.has(t))) return { ok: false, fields: [] };
  if (p.freeTerms.some((t) => !all.has(t))) return { ok: false, fields: [] };
  const matched = new Set<string>();
  for (const phrase of p.phrases) {
    const hits = tokenized.filter((f) => tokensContainPhrase(f.tokens, phrase)).map((f) => f.key);
    if (!hits.length) return { ok: false, fields: [] };
    hits.forEach((k) => matched.add(k));
  }
  return { ok: true, fields: [...matched] };
}

export function exactMatchLabel(fields: string[]): string {
  if (fields.some((f) => f === "title")) return "Pontos egyezés a címben";
  if (fields.some((f) => f === "description")) return "Pontos egyezés a leírásban";
  if (fields.some((f) => f === "tag")) return "Pontos egyezés a címkékben";
  if (fields.some((f) => f === "podcast")) return "Pontos egyezés a műsor nevében";
  return "Pontos egyezés";
}

/** Field list for an episode row (search-hybrid EPISODE_SELECT shape). */
export function episodeExactFields(e: any, cleanedText?: string | null): ExactField[] {
  const tags: ExactField[] = [
    ...(Array.isArray(e?.topics) ? e.topics : []),
    ...(Array.isArray(e?.people) ? e.people : []),
    ...(Array.isArray(e?.companies) ? e.companies : []),
    ...(Array.isArray(e?.tickers) ? e.tickers : []),
    ...(Array.isArray(e?.ingredients) ? e.ingredients : []),
  ].map((t) => ({ key: "tag", text: String(t || "") }));
  return [
    { key: "title", text: e?.title },
    { key: "title", text: e?.display_title },
    { key: "description", text: e?.ai_summary },
    { key: "description", text: e?.summary },
    { key: "description", text: e?.description },
    { key: "description", text: cleanedText || null },
    { key: "podcast", text: e?.podcasts?.title },
    { key: "podcast", text: e?.podcasts?.display_title },
    ...tags,
  ];
}
