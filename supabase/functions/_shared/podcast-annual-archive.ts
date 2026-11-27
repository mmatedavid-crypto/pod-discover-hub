// Shared annual archive pagination & URL rules used by both React UI and crawler prerender.

export const ANNUAL_ARCHIVE_PAGE_SIZE = 100;
export const ANNUAL_ARCHIVE_MIN_EPISODES = 3;
export const ANNUAL_ARCHIVE_MIN_YEAR = 2000;
export const ANNUAL_ARCHIVE_MAX_YEAR = 2100;

export function parseStrictArchiveYear(raw: string | undefined | null): number | null {
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  if (!Number.isInteger(year) || year < ANNUAL_ARCHIVE_MIN_YEAR || year > ANNUAL_ARCHIVE_MAX_YEAR) {
    return null;
  }
  return year;
}

// Strict positive integer without leading zeros (rejects "0", "01", "-2", "1.5", "abc").
export function parseStrictArchivePage(raw: string | undefined | null): number | null {
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const page = Number(raw);
  if (!Number.isSafeInteger(page) || page < 1) return null;
  return page;
}

export function podcastYearArchivePath(podcastSlug: string, year: number, page = 1): string {
  if (page <= 1) return `/podcast/${podcastSlug}/epizodok/${year}`;
  return `/podcast/${podcastSlug}/epizodok/${year}/oldal/${page}`;
}

export function podcastYearArchiveCanonicalUrl(
  site: string,
  podcastSlug: string,
  year: number,
  page = 1,
): string {
  return `${site.replace(/\/+$/, "")}${podcastYearArchivePath(podcastSlug, year, page)}`;
}

export type ArchivePaginationMeta = {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
  prevPath: string | null;
  nextPath: string | null;
  pageNumbers: Array<number | "ellipsis">;
};

export function buildArchivePaginationMeta(
  podcastSlug: string,
  year: number,
  page: number,
  totalCount: number,
  pageSize = ANNUAL_ARCHIVE_PAGE_SIZE,
): ArchivePaginationMeta {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const startIndex = totalCount === 0 ? 0 : (page - 1) * pageSize + 1;
  const endIndex = Math.min(totalCount, page * pageSize);
  const prevPath = page > 1 ? podcastYearArchivePath(podcastSlug, year, page - 1) : null;
  const nextPath = page < totalPages ? podcastYearArchivePath(podcastSlug, year, page + 1) : null;

  const pages = new Set<number>([1, totalPages]);
  for (let p = Math.max(1, page - 2); p <= Math.min(totalPages, page + 2); p++) {
    pages.add(p);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const pageNumbers: Array<number | "ellipsis"> = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) pageNumbers.push("ellipsis");
    pageNumbers.push(sorted[i]);
  }

  return {
    page,
    pageSize,
    totalCount,
    totalPages,
    startIndex,
    endIndex,
    prevPath,
    nextPath,
    pageNumbers,
  };
}

export function huYearAdjective(year: number): string {
  const mod100 = year % 100;
  const last = year % 10;
  if (mod100 === 0) return `${year}-as`;
  if (last === 0) return [10, 40, 50, 70, 90].includes(mod100) ? `${year}-es` : `${year}-as`;
  if (last === 3 || last === 8) return `${year}-as`;
  if (last === 5) return `${year}-ös`;
  if (last === 6) return `${year}-os`;
  return `${year}-es`;
}

export function formatAnnualArchiveCopy(input: {
  podcastTitle: string;
  year: number;
  page: number;
  totalCount: number;
  totalPages: number;
  startIndex: number;
  endIndex: number;
}): { title: string; description: string; heading: string; intro: string } {
  const { podcastTitle, year, page, totalCount, totalPages, startIndex, endIndex } = input;
  const countLabel = `${totalCount} epizód`;
  const yearAdj = huYearAdjective(year);
  const pageSuffix = page > 1 ? ` · ${page}/${totalPages}. oldal` : "";
  const title = `${podcastTitle} – ${year} (${countLabel})${pageSuffix} | Podiverzum`;
  const heading = page > 1
    ? `${podcastTitle} — ${year} epizódok (${page}. oldal)`
    : `${podcastTitle} — ${year} epizódok`;
  const description = (page > 1
    ? `${podcastTitle} ${yearAdj} archívuma (${countLabel}, ${startIndex}–${endIndex}. epizód, ${page}/${totalPages}. oldal) időrendi listában a Podiverzumon.`
    : `${podcastTitle} ${yearAdj} teljes archívuma (${countLabel}) időrendi listában, dátumokkal és összefoglalókkal a Podiverzumon.`).slice(0, 160);
  const intro = totalPages > 1
    ? `A ${podcastTitle} ${year}-ben összesen ${countLabel}ot tett közzé. Ezen az oldalon a ${startIndex}–${endIndex}. epizód látható (${page}/${totalPages}. oldal).`
    : `A ${podcastTitle} ${year}-ben összesen ${countLabel}ot tett közzé.`;
  return { title, description, heading, intro };
}