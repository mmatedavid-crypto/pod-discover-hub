// Pure rules-based title normalizer. No AI calls.
// Returns { display, changed } — display === title when no safe cleanup applies.
//
// Strategy: apply a stack of conservative regex strips, validate result,
// fall back to the original if cleanup would damage the title.

const MIN_LEN = 8;
const MIN_RATIO = 0.4;

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function cleanTitle(rawTitle: string, podcastTitle?: string | null): { display: string; changed: boolean } {
  if (!rawTitle) return { display: rawTitle, changed: false };
  let t = rawTitle.replace(/\s+/g, " ").trim();
  const original = t;

  // 1) Strip leading episode markers:  "Ep. 142 -", "Episode 45:", "#42 |", "S03E12 —", bare "142 -"
  t = t.replace(
    /^\s*(?:ep(?:isode)?\.?\s*\d+[a-z]?|#\d+|s\d{1,2}\s*[ex]\s*\d{1,3}|\d{1,4})\s*[:\-—|–]\s*/i,
    "",
  );

  // 2) Strip trailing podcast name suffix: " - <Podcast>", " | <Podcast>", " — <Podcast>"
  if (podcastTitle && podcastTitle.length >= 3) {
    const re = new RegExp(`\\s*[\\-\\|—–]\\s*${escapeRe(podcastTitle)}\\s*$`, "i");
    t = t.replace(re, "");
  }

  // 3) Strip leading podcast name prefix: "<Podcast>: " or "<Podcast> - "
  if (podcastTitle && podcastTitle.length >= 3) {
    const re = new RegExp(`^${escapeRe(podcastTitle)}\\s*[:\\-\\|—–]\\s*`, "i");
    t = t.replace(re, "");
  }

  // 4) Strip bracketed cruft anywhere: [FREE PREVIEW], (Audio), [REPLAY], [BONUS]
  t = t.replace(/\s*[\[\(](?:free preview|preview|audio|video|replay|rebroadcast|bonus|encore|teaser|trailer|explicit|clean)[\]\)]\s*/gi, " ");

  // 5) Collapse whitespace + strip leading/trailing punctuation
  t = t.replace(/\s+/g, " ").replace(/^[\s\-:|—–]+|[\s\-:|—–]+$/g, "").trim();

  // Safety: revert if too aggressive
  if (
    t.length < MIN_LEN ||
    t.length / original.length < MIN_RATIO ||
    /^\d+$/.test(t)
  ) {
    return { display: original, changed: false };
  }

  return { display: t, changed: t !== original };
}
