// Per-run budgets for the best-text-source runner. Pure functions (unit-tested).
//
// Lanes, in priority order, all inside one ≤60-episode call:
//   fast     — durable source-change queue (new / really changed verified YouTube pairs)
//   backfill — staged verified-YouTube archive targets (keyset)
//   feeds    — archival change feeds (keyset cursors); always keep a minimum share
// Re-clean: per-run limit and daily cap; part of the cap is reserved for fast-lane
// episodes so archive work can never starve new episodes for the rest of the day.

const clamp = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Number(v ?? dflt);
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? Math.floor(n) : dflt));
};

export const FEED_MIN_PER_RUN = 8;
// Hard upper bounds for the daily re-clean caps (stored controls can only lower these).
// Raised 2026-10-24 for the owner-approved, time-limited catch-up (pipeline_catchup_v1).
export const YOUTUBE_RECLEAN_DAILY_MAX = 1000;
export const SPOTIFY_RECLEAN_DAILY_MAX = 500;

export function laneBudgets(limit: number, ctrl: any, maxTargets = 60) {
  const max = Math.max(1, Math.min(60, maxTargets));
  const lim = Math.max(1, Math.min(max, Math.floor(limit)));
  const fast = ctrl?.fast_lane_enabled === false ? 0 : Math.min(lim, clamp(ctrl?.fast_lane_per_run, 0, 40, 20));
  const feedMin = Math.min(FEED_MIN_PER_RUN, Math.max(0, max - fast));
  const backfill = Math.max(0, Math.min(clamp(ctrl?.youtube_backfill_per_run, 0, 40, 20), max - fast - feedMin));
  // Staged Spotify set: only when enabled, after the YouTube lanes, within the hard max.
  const spotifyBackfill = ctrl?.spotify_backfill_enabled === true
    ? Math.max(0, Math.min(clamp(ctrl?.spotify_backfill_per_run, 0, 20, 10), max - fast - feedMin - backfill))
    : 0;
  return { limit: lim, max, fast, backfill, spotifyBackfill, feedMin };
}

/** Spotify re-clean: own small per-run limit and daily cap (default 0 = off). */
export function spotifyRecleanAllowance(ctrl: any, usedToday: number) {
  const cap = clamp(ctrl?.spotify_reclean_daily_cap, 0, SPOTIFY_RECLEAN_DAILY_MAX, 0);
  const perRun = clamp(ctrl?.spotify_reclean_per_run, 0, 20, 5);
  const remaining = Math.max(0, cap - Math.max(0, Number(usedToday) || 0));
  return { cap, perRun, allowed: ctrl?.spotify_reclean_enabled === true ? Math.min(perRun, remaining) : 0 };
}

export function recleanAllowances(ctrl: any, usedToday: number) {
  const cap = clamp(ctrl?.youtube_reclean_daily_cap, 0, YOUTUBE_RECLEAN_DAILY_MAX, 0);
  const perRun = clamp(ctrl?.youtube_reclean_per_run, 0, 25, 10);
  const reserve = Math.min(cap, clamp(ctrl?.youtube_reclean_fast_reserve, 0, YOUTUBE_RECLEAN_DAILY_MAX, 30));
  const remaining = Math.max(0, cap - Math.max(0, Number(usedToday) || 0));
  return {
    cap,
    perRun,
    reserve,
    fast: Math.min(perRun, remaining),
    archive: Math.min(perRun, Math.max(0, remaining - reserve)),
  };
}

// ---- Isolation after killed runs (edge CPU / wall limit kills the worker: no catch runs) ----
// A run is "killed" when its run-log row is still `running` with a stale heartbeat.
// Each consecutive kill divides the per-run target count by 4 (40 → 10 → 2 → 1);
// a kill while working on exactly one item isolates (blocks) that item so the rest
// of the pipeline moves on. Blocks are visible and cleared only by an admin.

export type RunLogRow = { id: string; outcome: string; stage?: string | null; target_ids?: string[] | null; meta?: any };

/** Consecutive killed runs, newest first, stopping at the first completed (ok/error) run. */
export function consecutiveKills(runs: RunLogRow[]): number {
  let n = 0;
  for (const r of runs) {
    if (r.outcome === "killed") n++;
    else if (r.outcome === "ok" || r.outcome === "error") break;
  }
  return n;
}

export function isolationLimit(baseLimit: number, kills: number): number {
  const base = Math.max(1, Math.floor(Number(baseLimit) || 1));
  const k = Math.max(0, Math.min(8, Math.floor(Number(kills) || 0)));
  return Math.max(1, Math.floor(base / Math.pow(4, k)));
}

/** The single item a killed run was working on, if it was working on exactly one. */
export function itemToIsolate(lastKilled: RunLogRow | null | undefined): string | null {
  if (!lastKilled || lastKilled.outcome !== "killed") return null;
  const ids = Array.isArray(lastKilled.target_ids) ? lastKilled.target_ids.filter(Boolean) : [];
  return ids.length === 1 ? String(ids[0]) : null;
}

/**
 * Split a lane's ids (in processing order) at the first deferred one: everything before
 * is processed, the first deferred id and all after it wait for the next run.
 */
export function processedPrefix<T>(items: T[], idOf: (t: T) => string, deferred: Set<string>): { done: T[]; stoppedEarly: boolean } {
  const done: T[] = [];
  for (const it of items) {
    if (deferred.has(idOf(it))) return { done, stoppedEarly: true };
    done.push(it);
  }
  return { done, stoppedEarly: false };
}
