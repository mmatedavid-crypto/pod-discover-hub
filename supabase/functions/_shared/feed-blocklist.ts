// Key used by podcast_feed_blocklist; must match SQL public.feed_url_key_v1
// (lower(btrim(url)) with trailing slashes removed).
export function feedBlocklistKey(url: string | null | undefined): string | null {
  const k = String(url ?? "").trim().toLowerCase().replace(/\/+$/, "");
  return k || null;
}
