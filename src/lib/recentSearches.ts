// Lightweight recent-search history in localStorage (anonymous, client-only).
const KEY = "podiverzum:recent_searches";
const MAX = 20;

export function getRecentSearches(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecentSearch(q: string) {
  if (typeof localStorage === "undefined") return;
  const v = (q || "").trim().toLowerCase();
  if (v.length < 2) return;
  try {
    const cur = getRecentSearches().filter((x) => x.toLowerCase() !== v);
    cur.unshift(v);
    localStorage.setItem(KEY, JSON.stringify(cur.slice(0, MAX)));
  } catch {
    /* noop */
  }
}
