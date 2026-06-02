// Slug helpers for the "Podiverzum Heti" weekly column.
// Format: `${YYYY}-${WW}-${kebab-ascii}` — e.g. 2026-23-podiverzum-heti.
// The YYYY-WW prefix is deterministic from week_start (ISO week),
// so we can map slug → week_start without a DB migration.

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

/** ISO 8601 week number for a `YYYY-MM-DD` date string. Returns {year, week}. */
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

/** Extract { year, week } from a slug. Returns null if malformed. */
export function parseHetiSlug(slug: string): { year: number; week: number } | null {
  const m = /^(\d{4})-(\d{1,2})(?:-|$)/.exec(slug);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (!year || !week || week < 1 || week > 53) return null;
  return { year, week };
}

/** Convert ISO {year, week} back to the Monday of that week as YYYY-MM-DD. */
export function isoWeekToMonday(year: number, week: number): string {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay() || 7;
  const monday = new Date(simple);
  monday.setUTCDate(simple.getUTCDate() - (dow - 1));
  return monday.toISOString().slice(0, 10);
}
