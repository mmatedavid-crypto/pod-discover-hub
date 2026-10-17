// First-party page and player events share one anonymous, tab-scoped ID.
// Prefer the existing page ID so a play can join to its landing page.
const SESSION_KEY = "pv_sid";
const LEGACY_PLAYER_KEY = "podiverzum_player_session";
let fallbackSession: string | undefined;

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