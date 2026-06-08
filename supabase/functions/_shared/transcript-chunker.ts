export type TimedSegment = {
  idx: number;
  start: number | null;
  end: number | null;
  text: string;
  word_count: number;
  char_start: number;
  char_end: number;
};

export type ChunkSlice = {
  content: string;
  char_start: number;
  char_end: number;
  timestamp_start_seconds: number | null;
  timestamp_end_seconds: number | null;
  segment_start_idx: number | null;
  segment_end_idx: number | null;
  source_transcript_model: string | null;
  chunking_method: "segment_timestamp_v2" | "char_window_v1";
};

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : v != null ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function segmentTime(s: any): { start: number | null; end: number | null } {
  const start = num(s?.start ?? s?.start_seconds ?? s?.startTime ?? s?.startTimeMs ?? s?.start_ms ?? s?.offset);
  const explicitEnd = num(s?.end ?? s?.end_seconds ?? s?.endTime ?? s?.endTimeMs ?? s?.end_ms);
  const duration = num(s?.duration ?? s?.durationMs ?? s?.dur);
  const scale = start != null && start > 10_000 ? 1000 : 1;
  const scaledStart = start == null ? null : start / scale;
  if (explicitEnd != null) return { start: scaledStart, end: explicitEnd / (explicitEnd > 10_000 ? 1000 : 1) };
  if (scaledStart != null && duration != null) {
    const scaledDuration = duration / (duration > 10_000 ? 1000 : 1);
    return { start: scaledStart, end: scaledStart + scaledDuration };
  }
  return { start: scaledStart, end: null };
}

function wordCount(text: string): number {
  return (text.match(/\S+/g) || []).length;
}

const ALIGN_FILLER_WORDS = new Set([
  "hat",
  "igen",
  "igazabol",
  "na",
  "oke",
  "szoval",
  "tehat",
  "ugye",
  "um",
  "umm",
  "uh",
]);

function normalizeForAlign(text: string, removeFillers = false): string {
  const normalized = String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!removeFillers) return normalized;
  return normalized
    .split(" ")
    .filter((token) => {
      if (!token) return false;
      if (/^o{2,}$/.test(token)) return false;
      return !ALIGN_FILLER_WORDS.has(token);
    })
    .join(" ");
}

export function parseTimedSegments(raw: unknown, cleanedText: string): TimedSegment[] {
  if (!Array.isArray(raw)) return [];
  const cleanedNorm = normalizeForAlign(cleanedText);
  const cleanedNormWithoutFillers = normalizeForAlign(cleanedText, true);
  if (cleanedNorm.length < 80) return [];
  let cursor = 0;
  let fillerCursor = 0;
  let charCursor = 0;
  let aligned = 0;
  const out: TimedSegment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] as any;
    const text = String(row?.text ?? row?.body ?? row?.transcript ?? row?.content ?? row?.line ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const wc = wordCount(text);
    if (wc === 0) continue;
    const norm = normalizeForAlign(text);
    if (norm.length < 4) continue;
    const found = cleanedNorm.indexOf(norm, cursor);
    if (found >= 0) {
      cursor = found + norm.length;
      aligned++;
    } else {
      const compactNorm = normalizeForAlign(text, true);
      const compactFound = compactNorm.length >= 4 ? cleanedNormWithoutFillers.indexOf(compactNorm, fillerCursor) : -1;
      if (compactFound >= 0) {
        fillerCursor = compactFound + compactNorm.length;
        aligned++;
      } else {
        const loose = cleanedNorm.indexOf(norm);
        if (loose === -1) continue;
        aligned++;
      }
    }
    const { start, end } = segmentTime(row);
    const charStart = charCursor;
    charCursor += text.length + 1;
    out.push({
      idx: i,
      start,
      end,
      text,
      word_count: wc,
      char_start: charStart,
      char_end: Math.max(charStart, charCursor - 1),
    });
  }
  const timed = out.filter((s) => s.start != null).length;
  return timed >= 3 && aligned >= 3 ? out : [];
}

function buildTimedChunk(
  segments: TimedSegment[],
  transcriptModel: string | null,
): ChunkSlice {
  const content = segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
  const timed = segments.filter((s) => s.start != null || s.end != null);
  const first = segments[0];
  const last = segments[segments.length - 1];
  return {
    content,
    char_start: first?.char_start ?? 0,
    char_end: last?.char_end ?? 0,
    timestamp_start_seconds: timed.length ? Math.round(Number(timed[0].start ?? timed[0].end ?? 0)) : null,
    timestamp_end_seconds: timed.length ? Math.round(Number((timed[timed.length - 1].end ?? timed[timed.length - 1].start) ?? 0)) : null,
    segment_start_idx: first?.idx ?? null,
    segment_end_idx: last?.idx ?? null,
    source_transcript_model: transcriptModel,
    chunking_method: "segment_timestamp_v2",
  };
}

function suffixOverlap(segments: TimedSegment[], overlapWords: number): TimedSegment[] {
  const out: TimedSegment[] = [];
  let words = 0;
  for (let i = segments.length - 1; i >= 0; i--) {
    out.unshift(segments[i]);
    words += segments[i].word_count;
    if (words >= overlapWords) break;
  }
  return out;
}

export function chunkTimedSegments(raw: unknown, cleanedText: string, transcriptModel: string | null): ChunkSlice[] {
  const segments = parseTimedSegments(raw, cleanedText);
  if (segments.length < 3) return [];
  const minWords = 150;
  const maxWords = 250;
  const overlapWords = 50;
  const slices: ChunkSlice[] = [];
  let current: TimedSegment[] = [];
  let words = 0;
  let hasNewContentSinceClose = false;

  const closeCurrent = () => {
    if (current.length === 0 || !hasNewContentSinceClose) return;
    slices.push(buildTimedChunk(current, transcriptModel));
    current = suffixOverlap(current, overlapWords);
    words = current.reduce((sum, s) => sum + s.word_count, 0);
    hasNewContentSinceClose = false;
  };

  for (const seg of segments) {
    const prev = current[current.length - 1];
    const gap = prev?.end != null && seg.start != null ? seg.start - prev.end : 0;
    if (current.length > 0 && words >= minWords && gap >= 3) closeCurrent();
    if (current.length > 0 && words >= minWords && words + seg.word_count > maxWords) closeCurrent();
    current.push(seg);
    words += seg.word_count;
    hasNewContentSinceClose = true;
    if (words >= maxWords) closeCurrent();
  }

  if (current.length > 0 && hasNewContentSinceClose) {
    const lastWords = current.reduce((sum, s) => sum + s.word_count, 0);
    if (lastWords >= 40 || slices.length === 0) slices.push(buildTimedChunk(current, transcriptModel));
  }

  return slices
    .filter((s) => s.content.length >= 80)
    .slice(0, 120);
}
