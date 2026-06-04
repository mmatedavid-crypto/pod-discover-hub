// Episode duration helpers.
// Storage: episodes.duration_seconds (integer, may be NULL).

/** Human-friendly: "1 ó 12 p", "47 p", "3 p 20 mp". Returns null if invalid. */
export function formatDurationHu(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return m > 0 ? `${h} ó ${m} p` : `${h} ó`;
  if (m > 0) return `${m} p`;
  return `${r} mp`;
}

/** Schema.org / ISO-8601 duration, e.g. "PT1H12M30S". Returns null if invalid. */
export function toIsoDuration(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) return null;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  let out = "PT";
  if (h > 0) out += `${h}H`;
  if (m > 0) out += `${m}M`;
  if (r > 0 || (h === 0 && m === 0)) out += `${r}S`;
  return out;
}
