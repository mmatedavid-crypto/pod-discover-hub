// Strip raw HTML and normalise whitespace for any RSS-derived public text.
export function stripHtml(s?: string | null): string {
  if (!s) return "";
  let t = String(s);
  // remove script/style blocks
  t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  // common entities
  t = t.replace(/<br\s*\/?>(?=)/gi, "\n").replace(/<\/p>/gi, "\n\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/&nbsp;/g, " ")
       .replace(/&amp;/g, "&")
       .replace(/&lt;/g, "<")
       .replace(/&gt;/g, ">")
       .replace(/&quot;/g, '"')
       .replace(/&#39;/g, "'")
       .replace(/&apos;/g, "'");
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
