// Freshness helpers — turn a published_at into trust signals for the UI.
export type Freshness = "new" | "recent" | "fresh" | "stale" | "unknown";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

export function freshnessOf(publishedAt?: string | null): Freshness {
  if (!publishedAt) return "unknown";
  const t = new Date(publishedAt).getTime();
  if (!Number.isFinite(t)) return "unknown";
  const age = Date.now() - t;
  if (age < 0) return "new";
  if (age < 24 * HOUR) return "new";
  if (age < 14 * DAY) return "recent";
  if (age < 30 * DAY) return "fresh";
  return "stale";
}

export function relativeTime(date?: string | null): string {
  if (!date) return "";
  const t = new Date(date).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  if (diff < 60 * 1000) return "just now";
  if (diff < HOUR) return `${Math.floor(diff / (60 * 1000))} min ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  if (diff < 30 * DAY) return `${Math.floor(diff / (7 * DAY))}w ago`;
  if (diff < 365 * DAY) return `${Math.floor(diff / (30 * DAY))}mo ago`;
  return `${Math.floor(diff / (365 * DAY))}y ago`;
}
