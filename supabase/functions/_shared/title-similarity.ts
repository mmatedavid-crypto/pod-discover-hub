// Hungarian-friendly title similarity.
// Combines character-trigram Dice + token Dice with stopword filtering.
// Works much better than plain Jaccard on short HU titles ("Mérce", "Friderikusz").

const STOPWORDS = new Set([
  "podcast", "podcasts", "show", "the", "a", "az", "egy",
  "hu", "magyar", "hungary", "hungarian",
  "official", "hivatalos", "csatorna", "channel",
  "radio", "rádió", "tv",
]);

export function normHu(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return normHu(s).split(" ").filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

function trigrams(s: string): Set<string> {
  const n = normHu(s).replace(/\s+/g, " ");
  const padded = `  ${n}  `;
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
  return set;
}

function dice<T>(A: Set<T>, B: Set<T>): number {
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((t) => { if (B.has(t)) inter++; });
  return (2 * inter) / (A.size + B.size);
}

/** Combined trigram + token Dice. Range 0..1. */
export function titleSim(a: string, b: string): number {
  if (!a || !b) return 0;
  const tg = dice(trigrams(a), trigrams(b));
  const tA = new Set(tokens(a));
  const tB = new Set(tokens(b));
  const tk = tA.size && tB.size ? dice(tA, tB) : tg;
  return 0.6 * tg + 0.4 * tk;
}
