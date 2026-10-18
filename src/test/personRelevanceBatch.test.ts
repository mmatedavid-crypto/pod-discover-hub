import { describe, expect, it } from "vitest";
import { buildBatchPrompt, inputGuard, MAX_BATCH_CHARS, packBatches, parseBatch, validateDecision,
  type Source } from "../../supabase/functions/_shared/person-relevance-batch";

const source = (): Source => ({
  person: { name: "Minta Anna", aliases: ["Anna Példa"] },
  episode: { id: "episode-one", title: "Beszélgetés Minta Annával", summary: "", clean_text:
    "Vendégünk Minta Anna, akivel a városi kertekről és a helyi közösségek kialakulásáról beszélgetünk. A beszélgetés műsorvezetője Példa Béla." },
  podcast: { title: "Kitalált podcast", description: "" },
  mentions: [{ id: "mention-one", mention_type: "mentioned", confidence: 0.9, evidence: "Vendégünk Minta Anna" }],
});
const decision = () => ({ key: "a", status: "accepted", score: 0.95, mention_type: "guest", identity_match: "same_person",
  reason: "A forrás vendégként nevezi meg.", evidence_phrases: ["Vendégünk Minta Anna"] });

describe("batched person review", () => {
  it("accepts an exact name and source quote", () => {
    expect(validateDecision(decision(), source()).status).toBe("accepted");
  });
  it.each([
    { score: 0.84 }, { score: "0.99" }, { score: Number.NaN }, { score: 1.1 },
    { mention_type: "none" }, { identity_match: "uncertain" }, { evidence_phrases: [] },
    { evidence_phrases: ["Ez az idézet nem szerepel a forrásban."] },
  ])("never auto-accepts unsafe evidence: %s", patch => {
    expect(validateDecision({ ...decision(), ...patch }, source()).status).toBe("needs_review");
  });
  it("does not accept substring name matches", () => {
    const s = source(); s.person = { name: "Anna", aliases: [] };
    s.episode.clean_text = "A szavanna állatvilágáról beszélgetünk, ahol a szavannai élőhelyek megőrzése és a fenntarthatóság a fő témánk.";
    s.episode.title = "Szavanna";
    expect(validateDecision({ ...decision(), evidence_phrases: ["szavanna állatvilágáról"] }, s).status).toBe("needs_review");
  });
  it("does not accept extraction-only evidence", () => {
    const s = source(); s.episode.clean_text = "Más témáról szóló leírás."; s.episode.title = "Kertészkedés";
    expect(validateDecision(decision(), s).status).toBe("needs_review");
  });
  it("does not reject uncertain or ungrounded matches", () => {
    expect(validateDecision({ ...decision(), status: "rejected", identity_match: "uncertain" }, source()).status).toBe("needs_review");
    expect(validateDecision({ ...decision(), status: "rejected", evidence_phrases: [] }, source()).status).toBe("needs_review");
  });
  it("routes missing and duplicate response IDs to review without a paid retry", () => {
    const items = [{ key: "a", input: source() }, { key: "b", input: source() }];
    const parsed = parseBatch({ decisions: [decision(), decision(), { ...decision(), key: "unknown" }] }, items);
    expect([...parsed.values()].map(d => d.status)).toEqual(["needs_review", "needs_review"]);
  });
  it("handles malformed batch bodies without accepting rows", () => {
    expect(parseBatch(null, [{ key: "a", input: source() }]).get("a")?.status).toBe("needs_review");
  });
  it("rejects URL-only input before paid work and protects human review", () => {
    const s = source(); s.episode.title = "https://example.org/a"; s.episode.clean_text = "https://example.org/".repeat(20);
    expect(inputGuard(s)?.status).toBe("waiting_clean_text");
    const manual = source(); manual.mentions[0].validation_source = "manual_admin";
    expect(inputGuard(manual)?.status).toBe("needs_review");
  });
  it("sends shared episode text only once", () => {
    const s = source();
    const prompt = buildBatchPrompt([{ key: "a", input: s }, { key: "b", input: { ...s, person: { name: "Példa Béla", aliases: [] } } }]);
    expect(prompt.split(s.episode.clean_text).length - 1).toBe(1);
  });
  it("bounds both count and context size", () => {
    const items = Array.from({ length: 15 }, (_, i) => {
      const s = source(); s.episode.id = String(i); s.episode.clean_text = "Forrásszöveg ".repeat(450);
      return { key: String(i), input: s };
    });
    const batches = packBatches(items);
    expect(batches.flat()).toHaveLength(15);
    expect(batches.every(b => b.length <= 6 && buildBatchPrompt(b).length <= MAX_BATCH_CHARS)).toBe(true);
  });
});
