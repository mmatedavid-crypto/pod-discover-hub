// Shared slugify — handles diacritics (NFKD + combining mark strip) and Hungarian characters.
// Also trims trailing dashes after the 80-char truncation so we never emit "...-" slugs.
export function slugify(s: string, fallback = "podcast"): string {
  const out = (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return out || fallback;
}
