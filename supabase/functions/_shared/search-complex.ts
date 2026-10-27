// Complex (natural-language) search: pure helpers shared by search-hybrid and tests.
//
// Simple searches — a name ("Friderikusz"), a show title, one or two topic words —
// keep the existing fast path untouched. Only longer, sentence-like requests get:
//   1. AI concepts instead of the hand-written synonym list,
//   2. meaning-first retrieval (lower lexical weight),
//   3. a final AI check of the top candidates (does the episode really cover it?),
//   4. an honest empty answer when nothing passes that check.

export type ComplexShapeInput = {
  qNorm: string;
  isQuestion: boolean;
  isStopword: (t: string) => boolean;
  isTemporal: (t: string) => boolean;
};

export function meaningfulTokens(input: ComplexShapeInput): string[] {
  return input.qNorm
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t) && !input.isStopword(t) && !input.isTemporal(t));
}

// Shape-only decision, made before any lookup so the AI step can start early.
export function looksComplex(input: ComplexShapeInput): boolean {
  if (input.isQuestion) return true;
  return meaningfulTokens(input).length >= 4;
}

export type AnchorLike = { kind: string; name: string };

// After the catalog lookups: a query made only of known names (one or two people,
// a show, an organization) is a simple name search, however many words it has.
export function isNameOnlyQuery(tokens: string[], anchors: AnchorLike[], fold: (s: string) => string): boolean {
  if (!tokens.length) return false;
  const nameTokens = new Set<string>();
  for (const a of anchors) {
    if (a.kind !== "person" && a.kind !== "organization" && a.kind !== "podcast") continue;
    for (const t of fold(a.name).split(/[^a-z0-9]+/)) if (t.length >= 2) nameTokens.add(t);
  }
  return tokens.every((t) => nameTokens.has(t));
}

export type ComplexDecisionInput = {
  shapeComplex: boolean;
  isBot: boolean;
  isTicker: boolean;
  isPersonNameQuery: boolean;
  hardPodcastPin: boolean;
  nameOnly: boolean;
  enabled: boolean;
};

export function useComplexPath(i: ComplexDecisionInput): boolean {
  return i.enabled && i.shapeComplex && !i.isBot && !i.isTicker && !i.isPersonNameQuery && !i.hardPodcastPin && !i.nameOnly;
}

// AI concepts are short subject phrases; drop question words, recency words and junk.
export function cleanConcepts(raw: unknown, fold: (s: string) => string, isTemporal: (t: string) => boolean, max = 6): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of raw) {
    const s = String(v ?? "").replace(/["„“”]/g, " ").replace(/\s+/g, " ").trim();
    if (s.length < 3 || s.length > 48) continue;
    const words = s.split(" ");
    if (words.length > 4) continue;
    const f = fold(s);
    if (!f || seen.has(f)) continue;
    if (f.split(/[^a-z0-9]+/).every((t) => !t || isTemporal(t))) continue;
    seen.add(f);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const quoteTerm = (t: string) => (t.includes(" ") ? `"${t.replace(/"/g, " ").trim()}"` : t);

export function complexLexicalQuery(q: string, isQuestion: boolean, concepts: string[], coreTerms: string[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    const k = t.toLowerCase();
    if (!t || seen.has(k)) return;
    seen.add(k);
    parts.push(t);
  };
  // Statements keep the literal phrase so an exact episode title still matches first.
  if (!isQuestion) push(quoteTerm(q));
  for (const c of concepts) push(quoteTerm(c));
  for (const t of coreTerms) push(t);
  return parts.slice(0, 14).join(" OR ") || q;
}

export function complexSemanticText(q: string, concepts: string[]): string {
  return `Magyar podcast epizód erről: ${q}. Témák: ${concepts.join(", ")}.`;
}

// ---------- Final AI check ----------

export type VerifyCandidate = {
  id: string;
  title: string;
  podcast: string;
  published: string | null;
  text: string;
};

export type VerifyGrade = { g: 0 | 1 | 2; w?: string };

export const VERIFY_PROMPT_VERSION = "search-complex-verify-v1";
// Bump to invalidate cached grades when the prompt or inputs change.
export const VERIFY_CACHE_VERSION = 1;
export const VERIFY_MAX_CANDIDATES = 30;

export function buildVerifyMessages(q: string, today: string, cands: VerifyCandidate[], recentDays: number | null) {
  const system = [
    "Egy magyar podcastkereső találatait ellenőrzöd. A kereső saját szavaival írta le, mit keres.",
    "Minden epizódra adj pontszámot: 2 = az epizód kifejezetten arról szól, amit a kereső keres (fő témája, vagy érdemben válaszol a kérdésre);",
    "1 = részben kapcsolódik, érinti a témát, de nem erről szól; 0 = nem erről szól (csak egy szó egyezik, más jelentésben, vagy más a téma).",
    "Ha a kérés egy konkrét személyre, műsorra vagy szervezetre vonatkozik, más, hasonló nevű szereplő 0.",
    recentDays
      ? `A kereső friss tartalmat kér: az utóbbi ${recentDays} napnál régebbi epizód legfeljebb 1.`
      : "A megjelenés dátuma nem számít.",
    "Csak a megadott cím, műsor, dátum és leírás alapján dönts, ne találgass.",
    "A 2 és 1 pontos epizódokhoz írj egy legfeljebb 12 szavas magyar indoklást (w), hogy miért illik a kereséshez.",
  ].join(" ");
  const user = `Ma: ${today}\nKeresés: ${q}\nEpizódok:\n` + cands.map((c, i) =>
    `[${i}] ${c.title} — ${c.podcast}${c.published ? `, ${c.published}` : ""}\n    ${c.text}`
  ).join("\n");
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

export const VERIFY_TOOL = {
  type: "function",
  function: {
    name: "grade",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        grades: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: { i: { type: "integer" }, g: { type: "integer" }, w: { type: "string" } },
            required: ["i", "g"],
          },
        },
      },
      required: ["grades"],
    },
  },
};

// Only fully valid answers count: every candidate graded exactly once, grades 0..2.
export function parseVerifyGrades(args: unknown, cands: VerifyCandidate[]): Map<string, VerifyGrade> | null {
  let parsed: any = args;
  if (typeof args === "string") {
    try { parsed = JSON.parse(args); } catch { return null; }
  }
  const rows = Array.isArray(parsed?.grades) ? parsed.grades : null;
  if (!rows) return null;
  const out = new Map<string, VerifyGrade>();
  for (const r of rows) {
    const i = Number(r?.i);
    const g = Number(r?.g);
    if (!Number.isInteger(i) || i < 0 || i >= cands.length) continue;
    if (g !== 0 && g !== 1 && g !== 2) continue;
    const id = cands[i].id;
    if (out.has(id)) continue;
    const w = typeof r?.w === "string" ? r.w.replace(/\s+/g, " ").trim().slice(0, 140) : "";
    out.set(id, w && g > 0 ? { g, w } : { g });
  }
  return out.size === cands.length ? out : null;
}

// Relevant episodes first, then partial ones, both in their earlier order.
// Off-topic and unchecked episodes are dropped: no padding with weak results.
export function applyVerification<T extends { id: string }>(list: T[], grades: Map<string, VerifyGrade>, checkedIds: string[]) {
  const checked = new Set(checkedIds);
  const relevant: Array<T & { why_matched?: string }> = [];
  const partial: Array<T & { why_matched?: string }> = [];
  let dropped = 0;
  for (const e of list) {
    if (!checked.has(e.id)) { dropped++; continue; }
    const v = grades.get(e.id);
    if (!v || v.g === 0) { dropped++; continue; }
    const item = v.w ? { ...e, why_matched: v.w } : e;
    (v.g === 2 ? relevant : partial).push(item);
  }
  return { list: [...relevant, ...partial], relevant: relevant.length, partial: partial.length, dropped };
}
