import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

Object.defineProperty(globalThis, "Deno", { value: { env: { get: () => "" } }, configurable: true });

const { __cleanerInternals, heuristicClean } = await import("../../supabase/functions/_shared/episode-text-cleaner");
const { consecutiveKills, isolationLimit, itemToIsolate, processedPrefix } = await import("../../supabase/functions/_shared/best-text-source-lanes");
const { indexingApiDecision } = await import("../../supabase/functions/_shared/indexing-api-policy");
const { promptUsedCleanHash, derivationSeoJobKey } = await import("../../supabase/functions/_shared/derivation-state");

const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");
const { splitSentences, sentenceWordCount, isFooterishSentence, LEGAL_TAIL_RX, stripSentenceFooterTail } = __cleanerInternals;

// The pre-2026-10-24 implementation (quadratic): re-joins and re-scans the tail per cut point.
function referenceStrip(input: string): { text: string; removed: string[] } {
  const normalized = input.trim();
  if (normalized.length < 500) return { text: input, removed: [] };
  const sentences = splitSentences(normalized);
  if (sentences.length < 3) return { text: input, removed: [] };
  for (let i = 1; i < sentences.length; i++) {
    const before = sentences.slice(0, i).join(" ").trim();
    const tail = sentences.slice(i);
    if (sentenceWordCount(before) < 18) continue;
    if (sentenceWordCount(tail.join(" ").trim()) < 8) continue;
    if (LEGAL_TAIL_RX.test(tail[0])) return { text: before, removed: ["sentence_footer_tail_cut"] };
    const ratio = tail.filter(isFooterishSentence).length / tail.length;
    const firstTwo = tail.slice(0, 2).filter(isFooterishSentence).length;
    if (ratio >= 0.5 && firstTwo >= 1) return { text: before, removed: ["sentence_footer_tail_cut"] };
  }
  return { text: input, removed: [] };
}

// Long, newline-less ASR-style transcript: hundreds of short sentences, no footer.
function asrTranscript(sentences: number, seed = 7): string {
  const words = ["szóval", "akkor", "ugye", "beszélgetünk", "politikáról", "gazdaságról", "Budapest", "kormány", "választás", "érdekes", "kérdés", "persze", "igen"];
  let x = seed;
  const out: string[] = [];
  for (let s = 0; s < sentences; s++) {
    const n = 5 + (s % 9);
    const w: string[] = [];
    for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) % 2147483648; w.push(words[x % words.length]); }
    out.push(w.join(" ") + (s % 5 === 0 ? "?" : "."));
  }
  return out.join(" ");
}

describe("best-source CPU root cause: sentence footer tail cut", () => {
  it("gives identical decisions to the previous implementation", () => {
    const footer = " Kövess minket az Instagramon! Iratkozz fel a YouTube csatornára. Támogasd a podcastot a Patreonon. Hallgasd a Spotify-on is.";
    const legal = " Jogi nyilatkozat: a műsor nem minősül befektetési tanácsadásnak, minden döntés a hallgató felelőssége marad.";
    const inputs = [
      asrTranscript(320),
      asrTranscript(320, 11) + footer,
      asrTranscript(60, 3) + legal,
      asrTranscript(40, 5) + footer + footer,
      asrTranscript(4, 9),
    ];
    for (const t of inputs) expect(stripSentenceFooterTail(t)).toEqual(referenceStrip(t));
    // the footer case is really cut, the clean transcript is untouched
    expect(stripSentenceFooterTail(inputs[1]).removed).toEqual(["sentence_footer_tail_cut"]);
    expect(stripSentenceFooterTail(inputs[0]).removed).toEqual([]);
  });

  it("is far cheaper than the quadratic version on a 12k-char newline-less transcript", () => {
    const t = asrTranscript(400).slice(0, 12000);
    const time = (f: () => unknown, n = 3) => { const s = performance.now(); for (let i = 0; i < n; i++) f(); return (performance.now() - s) / n; };
    time(() => referenceStrip(t), 1); time(() => stripSentenceFooterTail(t), 1); // warm-up
    const oldMs = time(() => referenceStrip(t));
    const newMs = time(() => stripSentenceFooterTail(t));
    expect(newMs * 5).toBeLessThan(oldMs);
    expect(heuristicClean(t).text.length).toBeGreaterThan(10000);
  });
});

describe("best-source run isolation", () => {
  it("counts consecutive killed runs until the last completed run", () => {
    expect(consecutiveKills([{ id: "a", outcome: "killed" }, { id: "b", outcome: "killed" }, { id: "c", outcome: "ok" }, { id: "d", outcome: "killed" }])).toBe(2);
    expect(consecutiveKills([{ id: "a", outcome: "error" }, { id: "b", outcome: "killed" }])).toBe(0);
  });

  it("divides the batch by 4 per kill down to one item", () => {
    expect([0, 1, 2, 3, 4].map((k) => isolationLimit(40, k))).toEqual([40, 10, 2, 1, 1]);
  });

  it("isolates only an item a killed run was processing alone", () => {
    expect(itemToIsolate({ id: "r", outcome: "killed", target_ids: ["ep1"] })).toBe("ep1");
    expect(itemToIsolate({ id: "r", outcome: "killed", target_ids: ["ep1", "ep2"] })).toBeNull();
    expect(itemToIsolate({ id: "r", outcome: "ok", target_ids: ["ep1"] })).toBeNull();
  });

  it("stops a lane's cursor before the first deferred item", () => {
    const rows = ["a", "b", "c", "d"];
    expect(processedPrefix(rows, (x) => x, new Set(["c", "d"]))).toEqual({ done: ["a", "b"], stoppedEarly: true });
    expect(processedPrefix(rows, (x) => x, new Set())).toEqual({ done: rows, stoppedEarly: false });
  });
});

describe("clean-text version used by SEO", () => {
  const clean = "Ebben az epizódban Kovács Anna közgazdász a magyar lakáspiacról beszél, a kamatokról és a bérleti díjak alakulásáról az elmúlt két évben.";
  it("counts a pre-built prompt only when it contains the live clean text", () => {
    expect(promptUsedCleanHash(`Description: ${clean}`, clean, "h1")).toBe("h1");
    expect(promptUsedCleanHash("Description: régi, más szöveg ami már nem az aktuális tisztított leírás, hanem egy korábbi változat.", clean, "h1")).toBeNull();
    expect(promptUsedCleanHash(`Description: ${clean}`, "rövid", "h1")).toBeNull();
  });
  it("one SEO job per clean-text version", () => {
    expect(derivationSeoJobKey("abc")).toBe(derivationSeoJobKey("abc"));
    expect(derivationSeoJobKey("abc")).not.toBe(derivationSeoJobKey("abd"));
  });
});

describe("Google Indexing API is a no-op for podcast pages", () => {
  it("never submits episode, podcast or hub URLs", () => {
    const d = indexingApiDecision([
      "https://podiverzum.hu/podcast/konyha-naplo/kb022",
      "https://podiverzum.hu/podcast/konyha-naplo",
      "https://podiverzum.hu/szemelyek/valaki",
    ]);
    expect(d.submit).toEqual([]);
    expect(d.unsupported).toBe(3);
  });
  it("the endpoint never calls Google or marks anything indexed", () => {
    const src = read("supabase/functions/google-indexing-submit/index.ts");
    expect(src).not.toContain("indexing.googleapis.com");
    expect(src).not.toMatch(/indexed\s*[:=]\s*true/);
  });
});

describe("crawler HTML never carries transcript text", () => {
  it("prerender does not fetch the transcript excerpt", () => {
    const src = read("supabase/functions/prerender/index.ts");
    expect(src).not.toMatch(/rpc\(\s*["']get_episode_index_text/);
    expect(src).not.toContain("transcriptText");
  });
});
