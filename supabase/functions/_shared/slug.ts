// Central Hungarian-safe slugify for ALL edge function ingestion paths.
// Keep in sync with src/lib/slug.ts (same logic, same output).
//
// Why an explicit HU map AND NFKD?
//   - NFKD + combining-mark strip handles á/é/í/ó/ú/ü/ö correctly in every modern
//     runtime, BUT ő (U+0151) and ű (U+0171) decompose to o/u + COMBINING DOUBLE
//     ACUTE ACCENT (U+030B) which some Deno releases on edge workers have dropped
//     before the strip pass. The explicit map below makes the output deterministic.
//   - We map FIRST, then NFKD as a defense-in-depth pass for any other accented
//     character that slips through from foreign-language guests / titles.

const HU_MAP: Record<string, string> = {
  "á": "a", "à": "a", "â": "a", "ä": "a", "ã": "a", "å": "a",
  "é": "e", "è": "e", "ê": "e", "ë": "e",
  "í": "i", "ì": "i", "î": "i", "ï": "i",
  "ó": "o", "ò": "o", "ô": "o", "õ": "o",
  "ö": "o", "ő": "o", "ø": "o",
  "ú": "u", "ù": "u", "û": "u",
  "ü": "u", "ű": "u",
  "ñ": "n", "ç": "c", "ß": "ss",
};

function mapHu(input: string): string {
  let out = "";
  for (const ch of input) {
    const lower = ch.toLowerCase();
    out += HU_MAP[lower] ?? lower;
  }
  return out;
}

export function slugify(s: string, fallback = "podcast"): string {
  if (!s) return fallback;
  const mapped = mapHu(s);
  const out = mapped
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return out || fallback;
}
