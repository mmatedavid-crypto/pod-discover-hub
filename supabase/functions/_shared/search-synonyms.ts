// Curated synonym/typo lookup from search_synonyms table.
// One indexed query: WHERE term = ANY(tokens). Returns flat list of expansion strings.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export function tokenizeForSynonyms(qNorm: string): string[] {
  // qNorm is already lowercase + unaccented + trimmed
  const toks = new Set<string>();
  // single tokens
  for (const t of qNorm.split(/[^a-z0-9]+/).filter((x) => x.length >= 2 && x.length <= 40)) {
    toks.add(t);
  }
  // bigrams (for "real estate", "traditional chinese", ...)
  const words = qNorm.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length - 1; i++) {
    const bg = `${words[i]} ${words[i + 1]}`;
    if (bg.length <= 40) toks.add(bg);
  }
  // full normalized query (covers 3+ word entries)
  if (qNorm.length >= 2 && qNorm.length <= 60) toks.add(qNorm);
  return [...toks].slice(0, 24);
}

export async function loadCuratedSynonyms(
  supa: SupabaseClient,
  qNorm: string,
): Promise<{ matched_terms: string[]; expansions: string[] }> {
  const tokens = tokenizeForSynonyms(qNorm);
  if (!tokens.length) return { matched_terms: [], expansions: [] };
  try {
    const { data, error } = await supa
      .from("search_synonyms")
      .select("term, synonyms")
      .in("term", tokens);
    if (error || !data) return { matched_terms: [], expansions: [] };
    const matched: string[] = [];
    const exp = new Set<string>();
    for (const row of data as Array<{ term: string; synonyms: string[] }>) {
      matched.push(row.term);
      for (const s of row.synonyms || []) {
        const v = String(s).trim();
        if (v) exp.add(v);
      }
    }
    return { matched_terms: matched, expansions: [...exp].slice(0, 24) };
  } catch (e) {
    console.warn("curated synonyms err", e);
    return { matched_terms: [], expansions: [] };
  }
}
