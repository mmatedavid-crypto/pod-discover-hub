// Contiguous 2–3 word windows of a 3–8 word (normalised) query, for exact, indexed catalog-name
// lookups inside a longer search ("onismeret kadar annamaria" -> "kadar annamaria").
// The whole query is never a window: a full-query name is handled by the exact-name path.
export function nameWindows(qNorm: string): string[] {
  const toks = qNorm.split(/\s+/).filter(Boolean);
  if (toks.length < 3 || toks.length > 8) return [];
  const out = new Set<string>();
  for (const n of [2, 3]) for (let i = 0; i + n <= toks.length; i++) {
    const w = toks.slice(i, i + n);
    if (w.join(" ") !== qNorm && w.every((t) => t.length >= 2)) out.add(w.join(" "));
  }
  return [...out].slice(0, 16);
}
