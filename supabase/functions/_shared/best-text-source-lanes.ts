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

export function laneBudgets(limit: number, ctrl: any, maxTargets = 60) {
  const max = Math.max(1, Math.min(60, maxTargets));
  const lim = Math.max(1, Math.min(max, Math.floor(limit)));
  const fast = ctrl?.fast_lane_enabled === false ? 0 : Math.min(lim, clamp(ctrl?.fast_lane_per_run, 0, 40, 20));
  const feedMin = Math.min(FEED_MIN_PER_RUN, Math.max(0, max - fast));
  const backfill = Math.max(0, Math.min(clamp(ctrl?.youtube_backfill_per_run, 0, 40, 20), max - fast - feedMin));
  return { limit: lim, max, fast, backfill, feedMin };
}

export function recleanAllowances(ctrl: any, usedToday: number) {
  const cap = clamp(ctrl?.youtube_reclean_daily_cap, 0, 500, 0);
  const perRun = clamp(ctrl?.youtube_reclean_per_run, 0, 25, 10);
  const reserve = Math.min(cap, clamp(ctrl?.youtube_reclean_fast_reserve, 0, 500, 30));
  const remaining = Math.max(0, cap - Math.max(0, Number(usedToday) || 0));
  return {
    cap,
    perRun,
    reserve,
    fast: Math.min(perRun, remaining),
    archive: Math.min(perRun, Math.max(0, remaining - reserve)),
  };
}
