// Extract timestamp-based "key moments" from an episode description.
// Looks for patterns like "(00:00) Intro", "00:00 Intro", "[1:23:45] Topic".
// Returns up to N moments.

export type KeyMoment = { timeSec: number; label: string; raw: string };

const LINE_RE = /(?:^|\n)\s*[\(\[]?(\d{1,2}:\d{2}(?::\d{2})?)[\)\]]?\s*[-–—:]?\s*([^\n]{2,120})/g;

function toSec(ts: string): number {
  const parts = ts.split(":").map((n) => parseInt(n, 10));
  if (parts.some(isNaN)) return -1;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return -1;
}

function fmt(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function extractKeyMoments(description?: string | null, max = 8): KeyMoment[] {
  if (!description) return [];
  const text = description.replace(/<[^>]+>/g, "\n");
  const out: KeyMoment[] = [];
  const seen = new Set<number>();
  let match: RegExpExecArray | null;
  LINE_RE.lastIndex = 0;
  while ((match = LINE_RE.exec(text)) !== null) {
    const sec = toSec(match[1]);
    if (sec < 0 || seen.has(sec)) continue;
    const label = match[2].trim().replace(/\s+/g, " ").replace(/^[-–—:]+\s*/, "");
    if (!label || /^https?:\/\//i.test(label)) continue;
    seen.add(sec);
    out.push({ timeSec: sec, label: label.slice(0, 110), raw: fmt(sec) });
    if (out.length >= max) break;
  }
  // Require at least 2 moments AND first one near start (<5min) to look like real chapters
  if (out.length < 2) return [];
  if (out[0].timeSec > 600) return [];
  return out;
}

export { fmt as formatTimestamp };
