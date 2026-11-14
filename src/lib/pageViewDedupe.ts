// Pure decision logic for first-party page views (testable without a browser).
export type PageViewState = { lastKey: string | null; lastAt: number; prevUrl: string | null };

/** Same route key again within this window is a re-render/remount copy, not a new view. */
export const PAGE_VIEW_DEDUPE_MS = 5000;

export function pageViewDecision(
  state: PageViewState,
  key: string,
  href: string,
  documentReferrer: string | null,
  now: number,
): { log: boolean; referrer: string | null } {
  if (state.lastKey === key && now - state.lastAt < PAGE_VIEW_DEDUPE_MS) {
    return { log: false, referrer: null };
  }
  const referrer = state.prevUrl ?? documentReferrer;
  state.lastKey = key;
  state.lastAt = now;
  state.prevUrl = href;
  return { log: true, referrer };
}

export function resetPageViewStateForTests(state: PageViewState) {
  state.lastKey = null;
  state.lastAt = 0;
  state.prevUrl = null;
}
