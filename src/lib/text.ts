// Named HTML entities we see in RSS feeds (Latin + Hungarian + common punctuation).
// Keep this in sync with anything new we spot in the wild.
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: "\u00A0", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  // punctuation
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", sbquo: "‚",
  ldquo: "“", rdquo: "”", bdquo: "„", laquo: "«", raquo: "»",
  prime: "′", Prime: "″", trade: "™", copy: "©", reg: "®", deg: "°",
  middot: "·", bull: "•", para: "¶", sect: "§", times: "×", divide: "÷",
  cent: "¢", pound: "£", euro: "€", yen: "¥", plusmn: "±", micro: "µ",
  // Latin-1 + extended (covers Hungarian á é í ó ö ő ú ü ű and friends)
  Agrave: "À", Aacute: "Á", Acirc: "Â", Atilde: "Ã", Auml: "Ä", Aring: "Å", AElig: "Æ",
  agrave: "à", aacute: "á", acirc: "â", atilde: "ã", auml: "ä", aring: "å", aelig: "æ",
  Ccedil: "Ç", ccedil: "ç",
  Egrave: "È", Eacute: "É", Ecirc: "Ê", Euml: "Ë",
  egrave: "è", eacute: "é", ecirc: "ê", euml: "ë",
  Igrave: "Ì", Iacute: "Í", Icirc: "Î", Iuml: "Ï",
  igrave: "ì", iacute: "í", icirc: "î", iuml: "ï",
  Ntilde: "Ñ", ntilde: "ñ",
  Ograve: "Ò", Oacute: "Ó", Ocirc: "Ô", Otilde: "Õ", Ouml: "Ö", Oslash: "Ø",
  ograve: "ò", oacute: "ó", ocirc: "ô", otilde: "õ", ouml: "ö", oslash: "ø",
  Ugrave: "Ù", Uacute: "Ú", Ucirc: "Û", Uuml: "Ü",
  ugrave: "ù", uacute: "ú", ucirc: "û", uuml: "ü",
  Yacute: "Ý", yacute: "ý", yuml: "ÿ", szlig: "ß", THORN: "Þ", thorn: "þ", ETH: "Ð", eth: "ð",
  // Hungarian-specific (not in HTML4 named set, but show up via &#nnn;)
  Odblac: "Ő", odblac: "ő", Udblac: "Ű", udblac: "ű",
};

export function decodeHtmlEntities(input: string): string {
  if (!input) return "";
  return input
    // hex numeric: &#x1F4A9; / &#xE9;
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const cp = parseInt(hex, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : _m;
    })
    // decimal numeric: &#233;
    .replace(/&#(\d+);/g, (_m, dec) => {
      const cp = parseInt(dec, 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : _m;
    })
    // named: &eacute; &nbsp; &amp; ...
    .replace(/&([a-zA-Z][a-zA-Z0-9]+);/g, (m, name) => {
      const v = NAMED_ENTITIES[name as keyof typeof NAMED_ENTITIES];
      return typeof v === "string" ? v : m;
    });
}

// Strip raw HTML and normalise whitespace for any RSS-derived public text.
export function stripHtml(s?: string | null): string {
  if (!s) return "";
  let t = String(s);
  // remove script/style blocks
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  // line-break tags → newlines before tag removal
  t = t.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n");
  t = t.replace(/<[^>]+>/g, " ");
  // decode all entities (numeric + named) — covers á é í ó ö ő ú ü ű etc.
  t = decodeHtmlEntities(t);
  t = t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
  return t;
}

export function snippet(s?: string | null, max = 220, around?: string[]): string {
  const clean = stripHtml(s);
  if (!clean) return "";
  if (!around || !around.length) return clean.length > max ? clean.slice(0, max - 1).trimEnd() + "…" : clean;
  const lower = clean.toLowerCase();
  let bestIdx = -1;
  for (const term of around) {
    const i = lower.indexOf(term.toLowerCase());
    if (i >= 0 && (bestIdx < 0 || i < bestIdx)) bestIdx = i;
  }
  if (bestIdx < 0) return clean.length > max ? clean.slice(0, max - 1).trimEnd() + "…" : clean;
  const start = Math.max(0, bestIdx - Math.floor(max / 3));
  const end = Math.min(clean.length, start + max);
  const out = (start > 0 ? "…" : "") + clean.slice(start, end).trim() + (end < clean.length ? "…" : "");
  return out;
}

// Returns React-friendly array of strings/marks. Simple, case-insensitive, longest-first.
export function highlightParts(text: string, terms: string[]): Array<{ s: string; hit: boolean }> {
  if (!text) return [];
  const uniq = Array.from(new Set(terms.filter(Boolean).map((t) => t.trim()).filter((t) => t.length >= 2)))
    .sort((a, b) => b.length - a.length);
  if (!uniq.length) return [{ s: text, hit: false }];
  const escaped = uniq.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const out: Array<{ s: string; hit: boolean }> = [];
  let last = 0;
  text.replace(re, (m, _g, idx: number) => {
    if (idx > last) out.push({ s: text.slice(last, idx), hit: false });
    out.push({ s: m, hit: true });
    last = idx + m.length;
    return m;
  });
  if (last < text.length) out.push({ s: text.slice(last), hit: false });
  return out;
}
