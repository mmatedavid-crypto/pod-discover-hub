// Episode duration helpers.
// Storage: episodes.duration_seconds (integer, may be NULL).

/**
 * Some RSS feeds put MINUTES into <itunes:duration> where the spec asks for
 * seconds, which surfaced as "1 p" next to a 1:33:42 long audio file. Values
 * under 90 seconds are therefore treated as unreliable and simply not shown;
 * the player writes the measured duration back once the episode is played.
 */
const MIN_TRUSTED_SECONDS = 120;

function trustedSeconds(sec: number | null | undefined): number | null {
  if (sec == null || !Number.isFinite(sec) || sec < MIN_TRUSTED_SECONDS) return null;
  return sec;
}

/** Human-friendly: "1 ó 12 p", "47 p". Returns null if missing or unreliable. */
export function formatDurationHu(input: number | null | undefined): string | null {
  const sec = trustedSeconds(input);
  if (sec == null) return null;
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return m > 0 ? `${h} ó ${m} p` : `${h} ó`;
  if (m > 0) return `${m} p`;
  return `${r} mp`;
}

/** Schema.org / ISO-8601 duration, e.g. "PT1H12M30S". Null if missing or unreliable. */
export function toIsoDuration(input: number | null | undefined): string | null {
  const sec = trustedSeconds(input);
  if (sec == null) return null;
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
