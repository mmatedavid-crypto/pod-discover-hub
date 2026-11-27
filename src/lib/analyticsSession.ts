// First-party page and player events share one anonymous, tab-scoped ID.
// Prefer the existing page ID so a play can join to its landing page.
const SESSION_KEY = "pv_sid";
const LEGACY_PLAYER_KEY = "podiverzum_player_session";
const LANDING_PATH_KEY = "pv_landing_path";
let fallbackSession: string | undefined;
let fallbackLandingPath: string | undefined;

function createSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function getAnalyticsSessionId(): string {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) return stored;
    const id = sessionStorage.getItem(LEGACY_PLAYER_KEY) || fallbackSession || createSessionId();
    sessionStorage.setItem(SESSION_KEY, id);
    fallbackSession = id;
    return id;
  } catch {
    fallbackSession ??= createSessionId();
    return fallbackSession;
  }
}

export function recordAnalyticsLandingPath(pathname?: string): string {
  const candidate = pathname || (typeof window !== "undefined" ? window.location.pathname : "/");
  try {
    const existing = sessionStorage.getItem(LANDING_PATH_KEY);
    if (existing) return existing;
    sessionStorage.setItem(LANDING_PATH_KEY, candidate);
    fallbackLandingPath = candidate;
    return candidate;
  } catch {
    fallbackLandingPath ??= candidate;
    return fallbackLandingPath;
  }
}

export function getAnalyticsLandingPath(): string {
  return recordAnalyticsLandingPath();
}