// Podiverzum Heti (weekly editorial) helpers shared by edge functions.
// Slug algorithm mirrors src/lib/hetiSlug.ts exactly (parity is tested), so
// crawler HTML, sitemaps and the SPA resolve the same URL for the same post.

const HU_MAP: Record<string, string> = {
  á: "a", é: "e", í: "i", ó: "o", ö: "o", ő: "o",
  ú: "u", ü: "u", ű: "u",
  Á: "a", É: "e", Í: "i", Ó: "o", Ö: "o", Ő: "o",
  Ú: "u", Ü: "u", Ű: "u",
};

export function slugifyHu(input: string): string {
  const ascii = input
    .split("")
    .map((c) => HU_MAP[c] ?? c)
    .join("")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
  return ascii
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "podiverzum-heti";
}

export function isoWeek(dateStr: string): { year: number; week: number } {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((+target - +yearStart) / 86400000 + 1) / 7);
  return { year: target.getUTCFullYear(), week };
}

export function hetiSlug(post: { week_start: string; title?: string | null }): string {
  const { year, week } = isoWeek(post.week_start);
  const ww = String(week).padStart(2, "0");
  const tail = post.title ? slugifyHu(post.title) : "podiverzum-heti";
  return `${year}-${ww}-${tail}`;
}

export function parseHetiSlug(slug: string): { year: number; week: number } | null {
  const m = /^(\d{4})-(\d{1,2})(?:-|$)/.exec(slug);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (!year || !week || week < 1 || week > 53) return null;
  return { year, week };
}

export function isoWeekToMonday(year: number, week: number): string {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay() || 7;
  const monday = new Date(simple);
  monday.setUTCDate(simple.getUTCDate() - (dow - 1));
  return monday.toISOString().slice(0, 10);
}

/** week_start window the SPA queries for a parsed slug (±10 days around Monday). */
export function hetiLookupWindow(parsed: { year: number; week: number }): { lo: string; hi: string } {
  const monday = isoWeekToMonday(parsed.year, parsed.week);
  const lo = new Date(`${monday}T00:00:00Z`); lo.setUTCDate(lo.getUTCDate() - 10);
  const hi = new Date(`${monday}T00:00:00Z`); hi.setUTCDate(hi.getUTCDate() + 10);
  return { lo: lo.toISOString().slice(0, 10), hi: hi.toISOString().slice(0, 10) };
}

export type HetiRow = {
  week_start: string;
  title?: string | null;
  status?: string | null;
  published_at?: string | null;
};

/** A post is publicly live only when published and its publish time has passed. */
export function isLiveHetiPost(p: HetiRow, nowMs = Date.now()): boolean {
  if (p.status !== "published" || !p.published_at) return false;
  const t = new Date(p.published_at).getTime();
  return Number.isFinite(t) && t <= nowMs;
}

/**
 * Resolve /heti/:slug the same way the SPA does: exact slug match first, then
 * the same ISO week (served as a redirect to the canonical slug). Anything
 * else — malformed, unknown, unpublished — is absent. Never falls back to the
 * latest article.
 */
export function resolveHetiSlug<T extends HetiRow>(
  rows: T[],
  slug: string,
  nowMs = Date.now(),
): { kind: "ok"; post: T } | { kind: "redirect"; post: T; slug: string } | { kind: "missing" } {
  const parsed = parseHetiSlug(slug);
  if (!parsed) return { kind: "missing" };
  const live = rows.filter((r) => isLiveHetiPost(r, nowMs));
  const exact = live.find((r) => hetiSlug(r) === slug);
  if (exact) return { kind: "ok", post: exact };
  const sameWeek = live.find((r) => {
    const w = isoWeek(r.week_start);
    return w.year === parsed.year && w.week === parsed.week;
  });
  if (sameWeek) return { kind: "redirect", post: sameWeek, slug: hetiSlug(sameWeek) };
  return { kind: "missing" };
}

export const NEWS_WINDOW_MS = 48 * 3600 * 1000;

/**
 * Google News sitemap entries: ONLY published Podiverzum Heti editorial
 * articles whose publish time is within the preceding 48h and not in the
 * future. Never the /heti hub, never podcast catalog pages. Empty is valid.
 */
export function selectNewsEditorialEntries(
  rows: Array<HetiRow & { title?: string | null }>,
  site: string,
  nowMs = Date.now(),
): Array<{ loc: string; publishedAt: string; title: string }> {
  const seen = new Set<string>();
  const out: Array<{ loc: string; publishedAt: string; title: string }> = [];
  for (const p of rows) {
    if (!isLiveHetiPost(p, nowMs)) continue;
    const t = new Date(p.published_at as string).getTime();
    if (nowMs - t > NEWS_WINDOW_MS) continue;
    const title = String(p.title || "").trim();
    if (!title) continue;
    const loc = `${site}/heti/${hetiSlug(p)}`;
    if (seen.has(loc)) continue;
    seen.add(loc);
    out.push({ loc, publishedAt: new Date(t).toISOString(), title });
  }
  return out;
}

const xmlEsc = (s: unknown) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function buildNewsSitemapXml(entries: Array<{ loc: string; publishedAt: string; title: string }>): string {
  const body = entries.map((e) => `<url>
  <loc>${xmlEsc(e.loc)}</loc>
  <news:news>
    <news:publication>
      <news:name>Podiverzum</news:name>
      <news:language>hu</news:language>
    </news:publication>
    <news:publication_date>${e.publishedAt}</news:publication_date>
    <news:title>${xmlEsc(e.title)}</news:title>
  </news:news>
</url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${body}
</urlset>
`;
}

/**
 * Search Console submit decision. A failed submission stays pending in state
 * and is retried on every later run until it succeeds, even if no new URLs
 * were added (durable retry, no extra cron).
 */
export function decideNewsSubmit(opts: {
  hasReliableBaseline: boolean;
  newUrlCount: number;
  previousSubmitNeeded: boolean;
}): { submit: boolean; trigger: "new_urls" | "pending_retry" | null } {
  if (opts.hasReliableBaseline && opts.newUrlCount > 0) return { submit: true, trigger: "new_urls" };
  if (opts.previousSubmitNeeded) return { submit: true, trigger: "pending_retry" };
  return { submit: false, trigger: null };
}
