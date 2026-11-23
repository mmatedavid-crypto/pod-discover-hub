// Small helpers shared by the curated landing pages (/anantara, /byd).

/** True when `token` appears as a standalone word (not inside a longer word, e.g. "Bydgoszcz"). */
export function hasStandaloneToken(text: string | null | undefined, token: string): boolean {
  if (!text) return false;
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${esc}(?![\\p{L}\\p{N}_])`, "iu").test(text);
}

/** How many failing episodes in a row the curated player skips before it stops. */
export const MAX_CONSECUTIVE_SKIPS = 3;

/** Next index to play after `current`, skipping known-failed ones; null at the end of the list. */
export function nextPlayableIndex(current: number, length: number, failed: ReadonlySet<number>): number | null {
  for (let i = current + 1; i < length; i++) if (!failed.has(i)) return i;
  return null;
}
