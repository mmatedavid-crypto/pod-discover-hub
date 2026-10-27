// Recency intent for Hungarian search queries ("mostanában", "a héten", "idén").
// Pure helpers shared by search-hybrid and tests. A query with recency words
// gets a bounded publication window; results inside it are placed first.

export type TemporalIntent = {
  windowDays: number;
  sinceIso: string;
  matched: string[];
  /** Query tokens (accent-folded) with the recency words removed. */
  coreTokens: string[];
};

export function foldHu(s: string): string {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

const DAY_MS = 24 * 3600 * 1000;

// Order does not matter: the shortest matching window wins.
const RULES: Array<{ re: RegExp; days: number | "year" }> = [
  { re: /\b(tegnap|tegnapi|(?:a |ezen a )?heten|mult heten|multheti|(?:az )?(?:elmult|utobbi) (?:par )?napokban)\b/g, days: 14 },
  {
    re: /\b(mostanaban|mostansag|manapsag|napjainkban|legutobb|legutobbi|nemreg|nemregiben|nemregen|legfrissebb|legujabb|friss|frissen|aktualis|aktualisan|jelenleg|mostani|(?:az )?(?:utobbi|elmult) (?:idoben|idoszakban|hetekben|honapokban))\b/g,
    days: 90,
  },
  { re: /\b(iden|idei|ebben az evben)\b/g, days: "year" },
];

const TEMPORAL_TOKENS = new Set([
  "tegnap", "tegnapi", "heten", "mult", "multheti", "elmult", "utobbi", "par", "napokban",
  "mostanaban", "mostansag", "manapsag", "napjainkban", "legutobb", "legutobbi", "nemreg",
  "nemregiben", "nemregen", "legfrissebb", "legujabb", "friss", "frissen", "aktualis",
  "aktualisan", "jelenleg", "mostani", "idoben", "idoszakban", "hetekben", "honapokban",
  "iden", "idei", "evben",
]);

/** True for an accent-folded token that only expresses "when", not "what". */
export function isTemporalToken(token: string): boolean {
  return TEMPORAL_TOKENS.has(foldHu(token));
}

export function detectTemporalIntent(query: string, nowMs: number = Date.now()): TemporalIntent | null {
  const qn = foldHu(query);
  if (!qn) return null;
  // Quoted searches are exact-phrase only; never reinterpret their words.
  if (/["„”“]/.test(query)) return null;
  let windowDays = Infinity;
  const matched: string[] = [];
  for (const rule of RULES) {
    for (const m of qn.matchAll(rule.re)) {
      matched.push(m[0]);
      let days: number;
      if (rule.days === "year") {
        const jan1 = Date.UTC(new Date(nowMs).getUTCFullYear(), 0, 1);
        days = Math.max(14, Math.ceil((nowMs - jan1) / DAY_MS));
      } else days = rule.days;
      windowDays = Math.min(windowDays, days);
    }
  }
  if (!matched.length || !Number.isFinite(windowDays)) return null;
  const coreTokens = qn.split(/[^a-z0-9]+/).filter((t) => t && !TEMPORAL_TOKENS.has(t));
  return {
    windowDays,
    sinceIso: new Date(nowMs - windowDays * DAY_MS).toISOString(),
    matched,
    coreTokens,
  };
}

/** Stable partition: items published inside the window first, order otherwise kept. */
export function preferWithinWindow<T extends { published_at?: string | null }>(items: T[], sinceIso: string): T[] {
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return items;
  const inside: T[] = [];
  const outside: T[] = [];
  for (const it of items) {
    const ts = it?.published_at ? Date.parse(it.published_at) : NaN;
    (Number.isFinite(ts) && ts >= since ? inside : outside).push(it);
  }
  return [...inside, ...outside];
}
