// Deterministic production-credit rule (production-credit-v1). The episode's own text names a person in an
// explicit crew role ("Vágó: X", "Szerkesztő: X", "Vágók, szerkesztők:\nX\nY", "Hangmérnök: X"). Owner decision
// 2026-11-15: such a credit is its own category: not a guest, not a mention, not a spoken appearance, and not
// proof of absence either. It applies only when EVERY occurrence of the person's name in every usable field is
// inside such a crew credit; any other occurrence (host line, guest line, running text, title) leaves the pair open.
// "Zene:", "Mix:", "Tracklista:" are NOT crew labels: on music shows they list the artists the episode is about.
// Pure text rule, no AI. Re-verified in apply_person_production_credit_v1 (source-hash CAS, quote + residual check).

import { cleanRoleField, foldKeepLength, usableRoleNames, ROLE_LABEL_FIELDS, type RoleLabelField } from "./person-role-label.ts";

export const PRODUCTION_CREDIT_RULE_VERSION = "production-credit-v1";

const WORD =
  "(?:vago(?:k|ja)?|vagta|vagas|videovagas|hangvagas|utomunka|studiomunka|szerkeszto(?:k|je|i)?|szerkesztette|producer(?:ek|e)?|produkcio" +
  "|hangmernok(?:ok|e)?|hangtechnika|hangtechnikus|hangkeveres|operator(?:ok)?|kamera" +
  "|feny|fotok?|video|vizual|grafika|grafikus|design|boritokep|borito|diszlet|smink|rendezo|rendezte|technikus|felvetel)";
const PREFIX = "(?:fo|felelos |vezeto |zenei |tartalmi )?";
/** Label phrase: one or more crew words joined by , / & + és — never a speaking role. */
export const PRODUCTION_LABEL_SOURCE = `${PREFIX}${WORD}(?:(?:\\s*[,/&+]\\s*|\\s+es\\s+)${PREFIX}${WORD})*`;
const LABEL_RE = new RegExp(`(?<![a-z])(${PRODUCTION_LABEL_SOURCE})\\s*(?::|\\s[-–—]\\s|[–—]\\s)`, "g");
const LABEL_TEST_RE = new RegExp(LABEL_RE.source);
// A speaking role glued to the crew word ("Műsorvezető és szerkesztő:", "riporter, vágó:") is a mixed role → skip.
const SPEAKING_BEFORE_RE =
  /(musorvezeto|hazigazd|vendeg|riporter|moderator|beszelgetotars|interjualany|narrator|meselo|felolvas|szereplo|eloado)[a-z]*\s*(?:[-,/&+]|\ses)\s*$/;
// Next label in the same line ends this credit's value (any "word:" plus the crew labels themselves).
const NEXT_LABEL_RE = new RegExp(`(?<![a-z])(?:${PRODUCTION_LABEL_SOURCE})\\s*(?::|\\s[-–—]\\s)|(?<![a-z])[a-z]+\\s*:|https?:|www\\.`);
const SENTENCE_END_RE = /(?<!(?:^|\s)(?:dr|prof|ifj|id|ozv|habil|[a-z]))[.!?;|](?:\s|$)/;
const SEP_BEFORE_RE = /(?:^|,|&|\/|\+|\s(?:es|and|valamint|illetve|meg)\s?)\s*(?:(?:dr|prof|ifj|id|ozv|habil)\.?\s*)*$/;
const DEPENDENT_NEXT_WORD_RE = /^\s(\p{Ll}+?(?:ja|je|jai|jei|ai|ei|a|e|nak|nek|rol|tol|bol|val|vel|ert|hoz|hez|ban|ben|ra|re))(?![\p{L}])/u;

export interface ProductionCreditHit {
  field: RoleLabelField;
  label: string;
  quote: string;
  snippet: string;
  matched_name: string;
}
export interface ProductionCreditOutcome {
  outcome: "production_credit" | "production_mixed" | "none";
  hits: ProductionCreditHit[];
}

function listLine(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 70 || /[:!?]|https?:|www\./i.test(t)) return false;
  if (!/^\p{Lu}/u.test(t)) return false;
  return t.split(/\s+/).length <= 8;
}

export function findProductionCreditHits(
  fields: Partial<Record<RoleLabelField, string | null | undefined>>,
  name: string,
  scopedAliases: string[] = [],
): ProductionCreditOutcome {
  const names = usableRoleNames(name, scopedAliases);
  if (!names.length) return { outcome: "none", hits: [] };
  const hits: ProductionCreditHit[] = [];
  let uncovered = false;
  for (const field of ROLE_LABEL_FIELDS) {
    const raw = fields[field];
    if (!raw) continue;
    const text = cleanRoleField(raw).normalize("NFC");
    const folded = foldKeepLength(text);
    const low = folded.toLowerCase();
    const covered = new Set<number>(); // absolute start offsets of name hits inside crew credits
    const fieldHits: ProductionCreditHit[] = [];
    // Line table (offsets into text).
    const lines: Array<{ start: number; end: number }> = [];
    for (let s = 0, i = 0; i <= text.length; i++) if (i === text.length || text[i] === "\n") { lines.push({ start: s, end: i }); s = i + 1; }
    for (let li = 0; li < lines.length; li++) {
      const L = lines[li];
      const lineLow = low.slice(L.start, L.end);
      LABEL_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = LABEL_RE.exec(lineLow))) {
        if (SPEAKING_BEFORE_RE.test(lineLow.slice(Math.max(0, m.index - 30), m.index))) continue;
        const labelAbs = L.start + m.index;
        const label = m[1];
        const vStartRel = m.index + m[0].length;
        let vEndRel = lineLow.length;
        const restLow = lineLow.slice(vStartRel);
        for (const re of [NEXT_LABEL_RE, SENTENCE_END_RE]) { const c = restLow.search(re); if (c >= 0) vEndRel = Math.min(vEndRel, vStartRel + c); }
        // Value regions: the rest of this line, or (label alone on its line) the following name-list lines.
        const regions: Array<{ start: number; end: number }> = [];
        if (folded.slice(L.start + vStartRel, L.start + vEndRel).replace(/[\s.,;–—-]+/g, "") !== "") {
          regions.push({ start: L.start + vStartRel, end: L.start + vEndRel });
        } else if (vEndRel === lineLow.length) {
          for (let k = li + 1, taken = 0; k < lines.length && taken < 10; k++) {
            const t = text.slice(lines[k].start, lines[k].end);
            if (!t.trim()) continue;
            if (!listLine(t)) break;
            if (LABEL_TEST_RE.test(low.slice(lines[k].start, lines[k].end))) break;
            regions.push({ start: lines[k].start, end: lines[k].end });
            taken++;
          }
        }
        for (const R of regions) {
          const rest = folded.slice(R.start, R.end).replace(/^\s+/, "");
          const lead = R.end - R.start - rest.length;
          for (const n of names) {
            const fn = foldKeepLength(n);
            let from = 0;
            let at: number;
            while ((at = rest.indexOf(fn, from)) >= 0) {
              from = at + 1;
              if (!SEP_BEFORE_RE.test(rest.slice(0, at).toLowerCase())) continue;
              const after = rest.slice(at + fn.length);
              if (/^[\p{L}\p{N}-]/u.test(after) || /^\s\p{Lu}/u.test(after) || DEPENDENT_NEXT_WORD_RE.test(after)) continue;
              const absStart = R.start + lead + at;
              const absEnd = absStart + fn.length;
              const snippet = text.slice(labelAbs, absEnd).replace(/\s+/g, " ").trim().slice(0, 400);
              let quote = text.slice(L.start, Math.min(R.end, absEnd + 120)).replace(/\s+/g, " ").trim();
              if (quote.length > 400 || !quote.includes(snippet)) quote = snippet;
              covered.add(absStart);
              fieldHits.push({ field, label, quote, snippet, matched_name: n });
              break;
            }
          }
        }
      }
    }
    // Exclusivity: every occurrence of any usable name form in this field must be one of the crew hits.
    for (const n of names) {
      const nl = foldKeepLength(n).toLowerCase();
      for (let at = low.indexOf(nl); at >= 0; at = low.indexOf(nl, at + 1)) if (!covered.has(at)) uncovered = true;
    }
    hits.push(...fieldHits);
  }
  if (!hits.length) return { outcome: "none", hits: [] };
  if (uncovered) return { outcome: "production_mixed", hits: [] };
  return { outcome: "production_credit", hits };
}
