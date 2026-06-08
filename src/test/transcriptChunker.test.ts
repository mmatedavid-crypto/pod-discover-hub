import { describe, expect, it } from "vitest";

const { chunkTimedSegments, parseTimedSegments } = await import("../../supabase/functions/_shared/transcript-chunker");

function segment(idx: number, words: number, start: number, gapAfter = 1) {
  const text = Array.from({ length: words }, (_, i) => `s${idx}w${i}`).join(" ");
  return { text, start, end: start + words, _nextStart: start + words + gapAfter };
}

function buildSegments(wordGroups: number[], gapAfter: (idx: number) => number = () => 1) {
  let start = 0;
  return wordGroups.map((words, idx) => {
    const row = segment(idx, words, start, gapAfter(idx));
    start = row._nextStart;
    return { text: row.text, start: row.start, end: row.end };
  });
}

function words(text: string) {
  return (text.match(/\S+/g) || []).length;
}

describe("transcript chunker", () => {
  it("builds timestamped 150-250 word chunks with overlap from transcript segments", () => {
    const raw = buildSegments([55, 55, 55, 55, 55, 55, 55]);
    const cleaned = raw.map((s) => s.text).join(" ");

    const chunks = chunkTimedSegments(raw, cleaned, "spotify-native");

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toMatchObject({
      chunking_method: "segment_timestamp_v2",
      source_transcript_model: "spotify-native",
      timestamp_start_seconds: 0,
      segment_start_idx: 0,
    });
    expect(words(chunks[0].content)).toBeGreaterThanOrEqual(150);
    expect(words(chunks[0].content)).toBeLessThanOrEqual(250);
    expect(words(chunks[1].content)).toBeGreaterThanOrEqual(150);
    expect(chunks[1].content).toContain("s3w0");
    expect(chunks[1].segment_start_idx).toBeLessThanOrEqual(chunks[0].segment_end_idx as number);
  });

  it("cuts at natural pause boundaries after the minimum word count", () => {
    const raw = buildSegments([50, 50, 50, 40, 40], (idx) => (idx === 2 ? 4 : 1));
    const cleaned = raw.map((s) => s.text).join(" ");

    const chunks = chunkTimedSegments(raw, cleaned, "spotify-native");

    expect(chunks.length).toBe(2);
    expect(chunks[0].segment_end_idx).toBe(2);
    expect(chunks[1].segment_start_idx).toBeLessThanOrEqual(2);
    expect(chunks[1].timestamp_start_seconds).toBeLessThanOrEqual(raw[2].start);
  });

  it("keeps timestamped chunks when cleaned text removed Hungarian filler words", () => {
    let startMs = 0;
    const raw = Array.from({ length: 7 }, (_, idx) => {
      const body = Array.from({ length: 32 }, (_, i) => `ööö tehát igazából fontos${idx}w${i}`).join(" ");
      const row = { body, startTimeMs: startMs, endTimeMs: startMs + 8_000 };
      startMs += 9_000;
      return row;
    });
    const cleaned = raw
      .map((s) => String(s.body).replace(/\b(ööö|tehát|igazából)\b/g, ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const chunks = chunkTimedSegments(raw, cleaned, "spotify-native");

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toMatchObject({
      timestamp_start_seconds: 0,
      timestamp_end_seconds: 17,
      segment_start_idx: 0,
      source_transcript_model: "spotify-native",
      chunking_method: "segment_timestamp_v2",
    });
    expect(chunks[0].content).toContain("fontos0w0");
  });

  it("refuses timestamp chunking when segments cannot be aligned to the cleaned text", () => {
    const raw = buildSegments([60, 60, 60]);
    const cleaned = "egeszen mas tisztitott szoveg ".repeat(30);

    expect(parseTimedSegments(raw, cleaned)).toEqual([]);
    expect(chunkTimedSegments(raw, cleaned, "spotify-native")).toEqual([]);
  });
});
