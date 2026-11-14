import { describe, expect, it } from "vitest";
import {
  buildPack, evaluateGate, goldenToReference, nameVariants, packFingerprint, usableAliases, validateEvidenceDecision,
  buildEvidenceRequest, requestUpperBoundUsd, type EvidenceSource, type GateItem, type Reference,
} from "../../supabase/functions/_shared/person-evidence";

const P = "11111111-1111-1111-1111-111111111111";
const E = "22222222-2222-2222-2222-222222222222";
const POD = "33333333-3333-3333-3333-333333333333";
const src = (over: Partial<EvidenceSource> = {}): EvidenceSource => ({
  person: { id: P, name: "Minta Anna", disambiguation_label: "kertész", identity_risk: false },
  aliases: [
    { alias: "Dr. Minta Anna", status: "accepted", scope: "global" },
    { alias: "Annuska", status: "rejected", scope: "global" },
    { alias: "Anna néni", status: "accepted", scope: "podcast", scope_podcast_id: "other-podcast" },
  ],
  episode: { id: E, podcast_id: POD, title: "Városi kertek", description: "Ebben a részben vendégünk Minta Annával beszélgetünk a közösségi kertekről.", summary: "" },
  podcast: { title: "Kitalált podcast", description: "A műsort Példa Béla vezeti." },
  clean_text: { text: "Hosszú szöveg. ".repeat(50) + "A végén Minta Anna elmondja, hogyan indult a kert." },
  transcript: null, external: [],
  ...over,
});

describe("evidence pack", () => {
  it("never uses rejected or out-of-scope aliases as evidence", () => {
    expect(usableAliases(src())).toEqual(["Dr. Minta Anna"]);
  });
  it("finds Hungarian inflected names (Anna → Annával) and cuts windows with their source", () => {
    expect(nameVariants(["Minta Anna"])).toContain("minta anna");
    const { pack, precheck } = buildPack(src());
    expect(precheck).toBeNull();
    expect(pack.windows.map((w) => w.source)).toEqual(["episode_description", "clean_text"]);
    expect(pack.windows[0].text).toContain("Minta Annával");
  });
  it("matches accent variants and doubled final digraphs (Biró/Bíró, Balázs → Balázzsal)", () => {
    const s = src({ person: { id: P, name: "Stumpf-Bíró Balázs" }, aliases: [],
      episode: { id: E, podcast_id: POD, title: "#31 - Stumpf-Biró Balázs: a vég", description: "Beszélgetés Stumpf-Bíró Balázzsal a rendszerekről." } });
    const { pack, precheck } = buildPack(s);
    expect(precheck).toBeNull();
    expect(pack.windows.map((w) => w.source)).toEqual(["episode_title", "episode_description"]);
  });
  it("marks a name that appears only in the show description as show-level only (no assumed host presence)", () => {
    const s = src({ person: { id: P, name: "Példa Béla" }, aliases: [] });
    expect(buildPack(s).precheck).toBe("show_level_only");
  });
  it("marks pairs with no name in any source so no paid call is made", () => {
    expect(buildPack(src({ person: { id: P, name: "Senki Sándor" }, aliases: [] })).precheck).toBe("no_name_in_episode_sources");
  });
  it("fingerprint depends only on the evidence, not on time or output", async () => {
    const a = await packFingerprint(buildPack(src()).pack);
    const b = await packFingerprint(buildPack(src()).pack);
    const c = await packFingerprint(buildPack(src({ episode: { ...src().episode, description: "Más leírás Minta Annával." } })).pack);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
  it("prices a request with a finite upper bound for known models and refuses unknown models", () => {
    const { pack } = buildPack(src());
    expect(Number.isFinite(requestUpperBoundUsd(buildEvidenceRequest("x", pack, "gpt-6-luna", 900)))).toBe(true);
    expect(requestUpperBoundUsd(buildEvidenceRequest("x", pack, "unknown-model", 900))).toBe(Infinity);
  });
});

describe("evidence answer validation", () => {
  const { pack } = buildPack(src());
  const w1 = pack.windows[0];
  const ans = (o: Record<string, unknown>) => ({ identity: "same_person", role: "guest", quotes: [{ window_id: w1.id, text: "vendégünk Minta Annával" }], reason: "Vendég.", ...o });
  it("accepts a positive role only with a verbatim episode-level quote containing the name", () => {
    expect(validateEvidenceDecision(ans({}), pack, { identityRisk: false }).verdict).toBe("auto_accept_candidate");
    expect(validateEvidenceDecision(ans({ quotes: [{ window_id: w1.id, text: "vendégünk Minta Annával a Holdon" }] }), pack, { identityRisk: false }).verdict).toBe("needs_more_evidence");
    expect(validateEvidenceDecision(ans({ quotes: [] }), pack, { identityRisk: false }).verdict).toBe("needs_more_evidence");
  });
  it("keeps identity-risk persons out of automatic acceptance", () => {
    expect(validateEvidenceDecision(ans({}), pack, { identityRisk: true }).verdict).toBe("identity_review");
  });
  it("does not accept an uncertain identity", () => {
    expect(validateEvidenceDecision(ans({ identity: "uncertain" }), pack, { identityRisk: false }).verdict).toBe("needs_more_evidence");
  });
  it("treats editor/author credits separately from participation", () => {
    expect(validateEvidenceDecision(ans({ role: "credit_only" }), pack, { identityRisk: false }).verdict).toBe("credit_candidate");
  });
  it("closes 'cannot determine' as insufficient evidence without demanding a quote", () => {
    expect(validateEvidenceDecision(ans({ role: "cannot_determine", quotes: [] }), pack, { identityRisk: false }).verdict).toBe("insufficient_evidence");
  });
  it("never turns a negative AI answer into a decided rejection", () => {
    expect(validateEvidenceDecision(ans({ role: "not_present", quotes: [] }), pack, { identityRisk: false }).verdict).toBe("ai_negative_candidate");
  });
  it("host proven only from the show description is show-level only", () => {
    const s = buildPack(src({ person: { id: P, name: "Példa Béla" }, aliases: [] })).pack;
    const r = validateEvidenceDecision({ identity: "same_person", role: "host", quotes: [{ window_id: s.windows[0].id, text: "A műsort Példa Béla vezeti." }], reason: "x" }, s, { identityRisk: false });
    expect(r.verdict).toBe("show_level_only");
  });
  it("rejects malformed output", () => {
    expect(validateEvidenceDecision({ role: "guest" }, pack, { identityRisk: false }).verdict).toBe("invalid_output");
  });
});

describe("quality gate", () => {
  const item = (i: number, o: Partial<GateItem> = {}): GateItem => ({ person_id: `p${i}`, episode_id: `e${i}`, model: "m", status: "succeeded",
    verdict: "auto_accept_candidate", role: "guest", stratum: "primary_only", cost_usd: 0.001, ...o });
  const ref = (i: number, label_role = "guest"): Reference => ({ person_id: `p${i}`, episode_id: `e${i}`, label_role, source: "human_reference" });
  const items = Array.from({ length: 150 }, (_, i) => item(i));
  it("stays closed with fewer than 100 human references in the auto-accept class", () => {
    const g = evaluateGate(items, Array.from({ length: 31 }, (_, i) => ref(i)));
    expect(g.status).toBe("insufficient_references");
    expect(g.passed_models).toEqual([]);
  });
  it("passes only at ≥99% precision on ≥100 references with zero critical errors", () => {
    expect(evaluateGate(items, Array.from({ length: 120 }, (_, i) => ref(i))).status).toBe("passed");
    const refs = Array.from({ length: 120 }, (_, i) => ref(i, i < 2 ? "mentioned" : "guest"));
    expect(evaluateGate(items, refs).status).toBe("failed");
  });
  it("one false guest or wrong identity on a reference stops the gate", () => {
    const refs = Array.from({ length: 120 }, (_, i) => ref(i, i === 0 ? "different_person" : "guest"));
    const g = evaluateGate(items, refs);
    expect(g.status).toBe("failed");
    expect(g.per_model[0].critical).toBe(1);
  });
  it("model agreement is not a reference: no human labels means no pass", () => {
    expect(evaluateGate(items, []).status).toBe("insufficient_references");
  });
  it("stops on a high invalid-output rate", () => {
    const bad = items.map((x, i) => i < 40 ? { ...x, status: "invalid", verdict: "invalid_output" } : x);
    expect(evaluateGate(bad, []).status).toBe("failed");
  });
  it("maps legacy human goldens but ignores 'needs_review' labels", () => {
    expect(goldenToReference({ person_id: "p", episode_id: "e", label_status: "accepted", label_mention_type: "host" })?.label_role).toBe("host");
    expect(goldenToReference({ person_id: "p", episode_id: "e", label_status: "rejected", label_identity: "different_person_same_name" })?.label_role).toBe("different_person");
    expect(goldenToReference({ person_id: "p", episode_id: "e", label_status: "needs_review" })).toBeNull();
  });
});
