import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

Object.defineProperty(globalThis, "Deno", { value: { env: { get: () => "" } }, configurable: true });

const { __cleanerInternals, heuristicClean } = await import("../../supabase/functions/_shared/episode-text-cleaner");
const { consecutiveKills, isolationLimit, itemToIsolate, processedPrefix } = await import("../../supabase/functions/_shared/best-text-source-lanes");
const { indexingApiDecision } = await import("../../supabase/functions/_shared/indexing-api-policy");
const derivation = await import("../../supabase/functions/_shared/derivation-state");
const { derivationSeoJobKey, seoInputProvenance, prebuiltPromptDecision, seoUsedCleanHash, seoPrimary, SEO_INPUT_POLICY } = derivation;
const { personExtractorInputFingerprint, aliasSetFingerprint, isReviewedMention } = await import("../../supabase/functions/_shared/person-extractor-fingerprint");

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

describe("clean-text version used by SEO: exact provenance, never inferred", () => {
  const prefix = "Ebben az epizódban Kovács Anna közgazdász a magyar lakáspiacról beszél, a kamatokról és a bérleti díjak alakulásáról az elmúlt két évben. ".repeat(2);
  const oldText = prefix + "A végén a hitelfelvétel kockázatairól is szó esik.";
  const newText = prefix + "A végén Szabó Péter a csok plusz programot elemzi.";

  it("no prefix-based inference helper exists any more", () => {
    expect((derivation as any).promptUsedCleanHash).toBeUndefined();
    expect(read("supabase/functions/seo-enrich-runner/index.ts")).not.toContain("promptUsedCleanHash");
  });

  it("same first 200 chars, different end: an old prompt never marks the new version current", () => {
    expect(oldText.slice(0, 200)).toBe(newText.slice(0, 200));
    const oldProv = seoInputProvenance({ cleanText: oldText, cleanHash: "hash-old", cleanMethod: "deterministic_v4" });
    // the live version is the new one: the pre-built prompt must be rebuilt before any paid call
    expect(prebuiltPromptDecision(oldProv, { hash: "hash-new", usable: true })).toBe("rebuild");
    // and if it were sent anyway, it is recorded against the OLD version only
    expect(seoUsedCleanHash(oldProv)).toBe("hash-old");
    expect(prebuiltPromptDecision(oldProv, { hash: "hash-old", usable: true })).toBe("use");
  });

  it("legacy prompts without provenance keep unknown freshness", () => {
    expect(prebuiltPromptDecision(undefined, { hash: "h", usable: true })).toBe("use_unknown");
    expect(prebuiltPromptDecision({ policy: "other" }, { hash: "h", usable: true })).toBe("use_unknown");
    expect(seoUsedCleanHash(null)).toBeNull();
    expect(seoPrimary(null)).toBe("unknown");
  });

  it("a description-only prompt is rebuilt once usable clean text exists", () => {
    const prov = seoInputProvenance({ cleanText: "", description: "RSS leírás" });
    expect(prov.primary).toBe("description");
    expect(prebuiltPromptDecision(prov, { hash: "h", usable: true })).toBe("rebuild");
    expect(prebuiltPromptDecision(prov, { hash: null, usable: false })).toBe("use");
  });

  it("transcript-primary: clean text is a dependency only when it actually went into the prompt", () => {
    const transcript = "átirat ".repeat(60);
    const withClean = seoInputProvenance({ transcript, cleanText: newText, cleanHash: "hash-new" });
    expect(withClean.primary).toBe("transcript");
    expect(seoUsedCleanHash(withClean)).toBe("hash-new");
    const noClean = seoInputProvenance({ transcript, cleanText: "rövid", cleanHash: "hash-short" });
    expect(noClean.clean_used).toBe(false);
    expect(seoUsedCleanHash(noClean)).toBeNull();
    expect(noClean.policy).toBe(SEO_INPUT_POLICY);
  });

  it("one SEO job per clean-text version", () => {
    expect(derivationSeoJobKey("abc")).toBe(derivationSeoJobKey("abc"));
    expect(derivationSeoJobKey("abc")).not.toBe(derivationSeoJobKey("abd"));
  });

  it("results are persisted only through the atomic apply RPCs", () => {
    const seo = read("supabase/functions/seo-enrich-runner/index.ts");
    expect(seo).toContain("apply_episode_seo_result_v1");
    expect(seo).toMatch(/if \(applyErr\) throw/);
    const ent = read("supabase/functions/entity-backfill-runner/index.ts");
    expect(ent).toContain("apply_episode_entities_v1");
    expect(ent).not.toMatch(/from\("episodes"\)\.update\(/);
    const top = read("supabase/functions/episode-topic-extractor/index.ts");
    expect(top).toContain("apply_episode_topics_v1");
    expect(top).not.toMatch(/from\("episode_extracted_topics"\)\.(insert|delete)/);
  });
});

describe("person extractor: no-op on unchanged inputs, reviewed rows protected", () => {
  const ep = { id: "e1", title: "Cím", ai_summary: "Összefoglaló", clean_text: "Tiszta  szöveg", people: ["Kovács Anna"], mentioned: [], topics: ["lakás"], published_at: "2026-10-01", entity_extraction_evidence: { person_mentions: [{ name: "Kovács Anna", role: "speaker", confidence: 0.8, evidence: "Kovács Anna", source: "v5" }] } };
  const pod = { id: "p1", hosts: ["Host Béla"], language_decision: "accept_hungarian", title: "Pod" };
  it("same inputs give the same fingerprint (second sweep skips), any real change differs", async () => {
    const a = await personExtractorInputFingerprint(ep, pod, "al1");
    expect(await personExtractorInputFingerprint({ ...ep, clean_text: "Tiszta szöveg " }, pod, "al1")).toBe(a);
    expect(await personExtractorInputFingerprint({ ...ep, clean_text: "Más szöveg" }, pod, "al1")).not.toBe(a);
    expect(await personExtractorInputFingerprint(ep, { ...pod, hosts: ["Más Host"] }, "al1")).not.toBe(a);
    expect(await personExtractorInputFingerprint(ep, pod, "al2")).not.toBe(a);
  });
  it("alias-set fingerprint is order independent", async () => {
    const r = [{ topic_id: "t1", normalized_alias: "a", weight: 1 }, { topic_id: "t2", normalized_alias: "b", weight: 2 }];
    expect(await aliasSetFingerprint(r)).toBe(await aliasSetFingerprint([...r].reverse()));
  });
  it("judged/manual mention rows are never rewritten", () => {
    expect(isReviewedMention({ validation_source: "manual" })).toBe(true);
    expect(isReviewedMention({ validation_source: "person_openai_batch_v1" })).toBe(true);
    expect(isReviewedMention({ validation_source: null })).toBe(false);
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
