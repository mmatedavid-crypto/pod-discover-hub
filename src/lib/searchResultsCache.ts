const CACHE_PREFIX = "podiverzum:search-results:v1:";
const SCROLL_PREFIX = "podiverzum:search-scroll:v1:";
const CACHE_TTL_MS = 10 * 60 * 1000;

export type SearchResultsCacheEntry = {
  createdAt: number;
  episodes: unknown[];
  podcasts: unknown[];
  categories: string[];
  metadata: Record<string, unknown>;
  aiAnswer?: string;
  scrollY?: number;
};

const memoryCache = new Map<string, SearchResultsCacheEntry>();

function cacheKey(query: string): string {
  return query.trim().toLocaleLowerCase("hu-HU");
}

export function readSearchResultsCache(query: string): SearchResultsCacheEntry | null {
  const key = cacheKey(query);
  const memoryEntry = memoryCache.get(key);
  if (memoryEntry && Date.now() - memoryEntry.createdAt < CACHE_TTL_MS) return memoryEntry;

  try {
    const raw = window.sessionStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as SearchResultsCacheEntry;
    if (!entry.createdAt || Date.now() - entry.createdAt >= CACHE_TTL_MS) {
      window.sessionStorage.removeItem(`${CACHE_PREFIX}${key}`);
      return null;
    }
    memoryCache.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

export function writeSearchResultsCache(query: string, entry: SearchResultsCacheEntry): void {
  const key = cacheKey(query);
  memoryCache.set(key, entry);
  try {
    window.sessionStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(entry));
  } catch {
    // Memory cache still preserves the results for SPA back navigation.
  }
}

export function updateSearchResultsCache(query: string, patch: Partial<SearchResultsCacheEntry>): void {
  const current = readSearchResultsCache(query);
  if (!current) return;
  writeSearchResultsCache(query, { ...current, ...patch });
}

export function readSearchScrollPosition(query: string): number {
  try {
    return Number(window.sessionStorage.getItem(`${SCROLL_PREFIX}${cacheKey(query)}`)) || 0;
  } catch {
    return 0;
  }
}

export function writeSearchScrollPosition(query: string, scrollY: number): void {
  if (scrollY <= 0) return;
  try {
    window.sessionStorage.setItem(`${SCROLL_PREFIX}${cacheKey(query)}`, String(scrollY));
  } catch {
    // Scroll restoration is optional when session storage is unavailable.
  }
}