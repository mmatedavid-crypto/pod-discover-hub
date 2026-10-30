/**
 * Share-link attribution: every outgoing share link carries
 * utm_source=<platform>&utm_medium=share so visitors arriving from a share
 * are counted per platform instead of as "direct" traffic.
 *
 * Any utm_* the sharer arrived with is replaced, so a link shared on
 * WhatsApp is never credited to the source that brought the sharer.
 * Canonical tags use the path only, so the extra query does not create
 * duplicate pages.
 */
export type SharePlatform =
  | "facebook"
  | "messenger"
  | "whatsapp"
  | "x"
  | "copy"
  | "share_sheet";

export function withShareUtm(url: string, platform: SharePlatform): string {
  if (!url) return url;
  try {
    const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "https://podiverzum.hu");
    for (const key of Array.from(u.searchParams.keys())) {
      if (key.toLowerCase().startsWith("utm_")) u.searchParams.delete(key);
    }
    u.searchParams.set("utm_source", platform);
    u.searchParams.set("utm_medium", "share");
    return u.toString();
  } catch {
    return url;
  }
}
