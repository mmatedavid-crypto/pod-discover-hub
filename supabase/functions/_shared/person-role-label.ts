// Deterministic role-label rule (role-label-v1): a person counts as an episode participant only when the
// episode's own title / description / original page names them in an explicit role line
// ("Vendég: X", "Vendégünk X és Y", "Műsorvezető: X"). Pure text rule, no AI. Identity anchoring,
// homonym/flag blockers, footer detection and the source-hash CAS are re-checked in
// apply_person_role_label_v1; this module only finds verbatim hits.
//
// Never used fields: AI summaries, SEO text, clean text derived from other sources, transcripts.

export const ROLE_LABEL_RULE_VERSION = "role-label-v1";
export type RoleLabelField = "episode_title" | "episode_description" | "episode_page";
export type RoleLabelRole = "guest" | "host";

export interface RoleLabelHit {
  role: RoleLabelRole;
  label: string;
  field: RoleLabelField;
  quote: string;
  snippet: string;
  matched_name: string;
  /** The person's own list item after the name (e.g. ", a Corvinus egyetemi tanára"); used for identity anchoring only. */
  descriptor: string;
}
export interface RoleLabelOutcome {
  outcome: "hit" | "no_label" | "label_without_name" | "role_conflict" | "no_multi_token_name";
  hits: RoleLabelHit[];
}

/** Same five entities and tag handling as public.person_text_fold_v1 (block tags become line breaks). */
export function cleanRoleField(raw: string | null | undefined): string {
  let s = String(raw ?? "");
  s = s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'");
  s = s.replace(/<\s*(br|\/p|p|\/div|div|li|\/li|hr|\/h[1-6]|h[1-6]|tr|\/tr)\b[^>]*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/[ \t\f\v\u00a0]+/g, " ");
  return s;
}

/** Char-by-char accent fold that keeps offsets (input normalised to NFC first). */
export function foldKeepLength(s: string): string {
  let out = "";
  for (const ch of s) {
    const f = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    out += f.length === ch.length ? f : ch;
  }
  return out;
}

const LABEL_RE =
  /(?<![a-z])(vendeg(?:e|ei|ek|eink|unk|em|eim)?|beszelgetotars(?:a|ai|aink|unk|am)?|interjualany(?:a|ai|unk)?|musorvezeto(?:je|i|ink|nk|k)?|hazigazda(?:ja|i|ink|nk|k)?)(?![a-z])/g;
// The label must be about this episode (not "previous / next guests").
const NOT_THIS_EPISODE_RE = /(korabbi|elozo|kovetkezo|jovo ?heti|multkori|egykori|leendo|eddigi|tavalyi|tavaly|regebbi|visszatekint)\s*\S*\s*$/;
const CREDIT_RE =
  /(?<![a-z])(szerkeszt|riporter|rendez|producer|vago|vagta|vagas|zene|zenei|operator|hangmernok|hangtechnik|programigazgato|foto|design|borito|tamogat|szponzor|kozremukod|keszitette|grafik|technikus|moderal)/;
const HISTORICAL_RE = /\(\s*\d{3,4}\s*[-–—]\s*\d{3,4}\s*\)|(?<![a-z])(nehai|emlekere|in memoriam|halalanak|szuletesenek)(?![a-z])/;
const FILLER_RE = /^(?:\s*(?:[:\-–—]|ma|volt|ezuttal|most|pedig|is|a mai adasban|az adasban|ebben az adasban|ebben a reszben)\s*)*/;
const SEP_BEFORE_RE = /(?:^|,|&|\/|\+|\s(?:es|and|valamint|illetve|meg)\s?)\s*(?:(?:dr|prof|ifj|id|ozv|habil)\.?\s*)*$/;
const ABBREV = new Set(["dr", "prof", "ifj", "id", "ozv", "habil", "stb", "pl", "ill", "kb", "szt", "st"]);
// The word right after the name is a possessive / case form → the name is someone else's attribute
// ("Petőfi Sándor kutatója", "Szabó Anna férje", "Kovács Péterről").
const DEPENDENT_NEXT_WORD_RE = /^\s(\p{Ll}+?(?:ja|je|jai|jei|ai|ei|a|e|nak|nek|rol|tol|bol|val|vel|ert|hoz|hez|ban|ben|ra|re))(?![\p{L}])/u;

// Next list item that starts with a Capitalised two-word name ends this person's descriptor.
const NEXT_ITEM_RE = /(?:,|&|\/|\s(?:és|es|and|valamint|illetve|meg)\s)\s*(?:(?:dr|prof|ifj|id)\.?\s*)*\p{Lu}[\p{Ll}'’-]+\s\p{Lu}/u;
export function descriptorWindow(after: string): string {
  const cut = after.search(NEXT_ITEM_RE);
  const w = (cut >= 0 ? after.slice(0, cut) : after).replace(/\s+/g, " ");
  return w.replace(/^[\s,:–—-]+/, "").trim().slice(0, 160);
}

function segments(text: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const low = foldKeepLength(text).toLowerCase();
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    let boundary = c === "\n" || c === "!" || c === "?" || c === ";" || c === "|";
    if (c === ".") {
      const next = text[i + 1];
      if (next === undefined || /\s/.test(next)) {
        const m = low.slice(Math.max(0, i - 12), i).match(/([a-z]+)$/);
        const word = m ? m[1] : "";
        boundary = !(word.length === 1 || ABBREV.has(word));
      }
    }
    if (boundary) { if (i > start) out.push({ start, end: i }); start = i + 1; }
  }
  if (start < text.length) out.push({ start, end: text.length });
  return out;
}

/** Names usable by the rule: canonical name plus podcast/episode-scoped aliases; ≥2 tokens only. */
export function usableRoleNames(name: string, scopedAliases: string[] = []): string[] {
  const all = [name, ...scopedAliases].map((n) => String(n || "").normalize("NFC").replace(/\s+/g, " ").trim());
  return [...new Set(all.filter((n) => n.split(" ").filter(Boolean).length >= 2))];
}

export function findRoleLabelHits(
  fields: Partial<Record<RoleLabelField, string | null | undefined>>,
  name: string,
  scopedAliases: string[] = [],
): RoleLabelOutcome {
  const names = usableRoleNames(name, scopedAliases);
  if (!names.length) return { outcome: "no_multi_token_name", hits: [] };
  const hits: RoleLabelHit[] = [];
  let sawLabel = false;
  for (const field of ["episode_title", "episode_description", "episode_page"] as RoleLabelField[]) {
    const raw = fields[field];
    if (!raw) continue;
    const text = cleanRoleField(raw).normalize("NFC");
    const folded = foldKeepLength(text);
    const low = folded.toLowerCase();
    for (const seg of segments(text)) {
      const segLow = low.slice(seg.start, seg.end);
      if (HISTORICAL_RE.test(segLow)) continue;
      LABEL_RE.lastIndex = 0;
      let lm: RegExpExecArray | null;
      while ((lm = LABEL_RE.exec(segLow))) {
        sawLabel = true;
        if (NOT_THIS_EPISODE_RE.test(segLow.slice(0, lm.index))) continue;
        const label = lm[1];
        const role: RoleLabelRole = /^(musorvezeto|hazigazda)/.test(label) ? "host" : "guest";
        let restStart = seg.start + lm.index + label.length;
        const filler = low.slice(restStart, seg.end).match(FILLER_RE);
        restStart += filler ? filler[0].length : 0;
        let restEnd = seg.end;
        const restLow = low.slice(restStart, restEnd);
        const colon = restLow.indexOf(":");
        const credit = restLow.search(CREDIT_RE);
        const nextLabel = restLow.slice(1).search(LABEL_RE);
        for (const cut of [colon, credit, nextLabel >= 0 ? nextLabel + 1 : -1]) if (cut >= 0) restEnd = Math.min(restEnd, restStart + cut);
        const rest = folded.slice(restStart, restEnd);
        for (const n of names) {
          const fn = foldKeepLength(n);
          let from = 0;
          let at: number;
          while ((at = rest.indexOf(fn, from)) >= 0) {
            from = at + 1;
            const before = rest.slice(0, at).toLowerCase();
            if (!SEP_BEFORE_RE.test(before)) continue;
            const after = rest.slice(at + fn.length);
            if (/^[\p{L}\p{N}-]/u.test(after)) continue;
            if (/^\s\p{Lu}/u.test(after)) continue;
            if (DEPENDENT_NEXT_WORD_RE.test(after)) continue;
            const absEnd = restStart + at + fn.length;
            const quote = text.slice(seg.start, seg.end).replace(/\s+/g, " ").trim().slice(0, 400);
            const snippet = text.slice(seg.start + lm.index, absEnd).replace(/\s+/g, " ").trim();
            if (!quote.includes(snippet)) continue;
            const descriptor = descriptorWindow(text.slice(absEnd, seg.end));
            hits.push({ role, label, field, quote, snippet, matched_name: n, descriptor });
            break;
          }
        }
      }
    }
  }
  if (!hits.length) return { outcome: sawLabel ? "label_without_name" : "no_label", hits: [] };
  const roles = new Set(hits.map((h) => h.role));
  if (roles.size > 1) return { outcome: "role_conflict", hits: [] };
  return { outcome: "hit", hits };
}
