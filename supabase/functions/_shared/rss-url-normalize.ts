// Conservative RSS feed URL normalization shared across fetch, import, and lookup.
// Only strips leading/trailing literal or percent-encoded whitespace (%20, %09, %0A, %0D)
// so distinct feed paths or query strings are never conflated.

const LEADING_WS_RE = /^(?:\s|%20|%09|%0[aAdD])+/gi;
const TRAILING_WS_RE = /(?:\s|%20|%09|%0[aAdD])+$/gi;
const TRACKING_KEYS = new Set([
  "fbclid", "gclid", "mc_cid", "mc_eid", "igshid",
  "ref", "ref_src", "source", "referer", "referrer", "_hsenc", "_hsmi",
]);

export function normalizeFeedUrlConservative(raw: string | null | undefined): string {
  if (!raw) return "";
  let cleaned = String(raw).trim()
    .replace(LEADING_WS_RE, "")
    .replace(TRAILING_WS_RE, "");
  if (!cleaned) return "";
  try {
    const parsed = new URL(cleaned);
    const cleanPath = parsed.pathname.replace(TRAILING_WS_RE, "");
    if (cleanPath !== parsed.pathname) {
      parsed.pathname = cleanPath || "/";
    }
    return parsed.toString().replace(TRAILING_WS_RE, "");
  } catch {
    return cleaned;
  }
}

// Mirrors SQL public.normalize_rss_url(_url) for lookup/deduplication.
export function normalizeFeedUrlForLookup(raw: string | null | undefined): string | null {
  const cleaned = normalizeFeedUrlConservative(raw);
  if (!cleaned) return null;
  const withoutScheme = cleaned.replace(/^https?:\/\//i, "");
  if (!withoutScheme) return null;
  const slashIdx = withoutScheme.indexOf("/");
  const rawHost = slashIdx >= 0 ? withoutScheme.slice(0, slashIdx) : withoutScheme;
  const pathAndQuery = slashIdx >= 0 ? withoutScheme.slice(slashIdx) : "/";
  const host = rawHost.toLowerCase().replace(/^www\./, "");
  if (!host) return null;

  const qIdx = pathAndQuery.indexOf("?");
  let pathOnly = qIdx >= 0 ? pathAndQuery.slice(0, qIdx) : pathAndQuery;
  const queryStr = qIdx >= 0 ? pathAndQuery.slice(qIdx + 1) : "";

  pathOnly = pathOnly.replace(TRAILING_WS_RE, "");
  if (pathOnly.length > 1) {
    pathOnly = pathOnly.replace(/\/+$/, "");
  }
  if (!pathOnly) pathOnly = "/";

  if (queryStr) {
    const kept = queryStr
      .split("&")
      .filter((kv) => {
        if (!kv) return false;
        const k = kv.split("=")[0].toLowerCase();
        return !k.startsWith("utm_") && !TRACKING_KEYS.has(k);
      });
    if (kept.length > 0) {
      return `https://${host}${pathOnly}?${kept.join("&")}`;
    }
  }
  return `https://${host}${pathOnly}`;
}