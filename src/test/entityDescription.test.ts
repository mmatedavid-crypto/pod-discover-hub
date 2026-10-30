import { describe, expect, it } from "vitest";
import { buildCustomId, verifyDescription, type EntitySource } from "../../supabase/functions/_shared/entity-description";

const org: EntitySource = {
  entity_id: "11111111-1111-1111-1111-111111111111", name: "Magyar Nemzeti Bank",
  episodes: [
    { i: 1, podcast: "Pénzügyi Percek", title: "Kamatdöntés 2026 októberében", summary: "A Magyar Nemzeti Bank monetáris tanácsa változatlanul hagyta az alapkamatot." },
    { i: 2, podcast: "Gazdasági Heti", title: "Infláció és forint", summary: "Szó esik a jegybank inflációs céljáról." },
  ],
};
const good = {
  insufficient: false, confidence: 0.9,
  description_hu: "A Magyar Nemzeti Bank a magyar podcastokban főként kamatdöntései és inflációs célja kapcsán kerül szóba.",
  evidence: [{ i: 1, quote: "monetáris tanácsa változatlanul hagyta az alapkamatot" }, { i: 2, quote: "a jegybank inflációs céljáról" }],
};

describe("entity description acceptance gate", () => {
  it("accepts a description backed by verbatim quotes", () => {
    expect(verifyDescription(good, "organization", org).ok).toBe(true);
  });
  it("rejects a quote that is not in the sources", () => {
    const r = verifyDescription({ ...good, evidence: [{ i: 1, quote: "a jegybank 1924-ben alakult" }] }, "organization", org);
    expect(r).toEqual({ ok: false, reason: "evidence_not_verbatim" });
  });
  it("rejects a year that no source mentions", () => {
    const r = verifyDescription({ ...good, description_hu: "A Magyar Nemzeti Bank 1924-ben alakult, a podcastokban kamatdöntései kapcsán kerül szóba." }, "organization", org);
    expect(r).toEqual({ ok: false, reason: "unsupported_number" });
  });
  it("rejects when the model says the sources are insufficient", () => {
    expect(verifyDescription({ ...good, insufficient: true }, "organization", org)).toEqual({ ok: false, reason: "insufficient_evidence" });
  });
  it("rejects confidence below 0.7", () => {
    expect(verifyDescription({ ...good, confidence: 0.6 }, "organization", org)).toEqual({ ok: false, reason: "low_confidence" });
  });
  it("does not call a merely mentioned person a guest", () => {
    const person: EntitySource = { entity_id: org.entity_id, name: "Kovács Anna", episodes: org.episodes.map((e) => ({ ...e, role: "mention" })) };
    const r = verifyDescription({ ...good, description_hu: "Kovács Anna közgazdász, a Pénzügyi Percek vendégeként a kamatdöntésekről beszélt." }, "person", person);
    expect(r).toEqual({ ok: false, reason: "unsupported_participation" });
  });
  it("gives each retry its own request id", () => {
    expect(buildCustomId("organization", org.entity_id, 1)).not.toBe(buildCustomId("organization", org.entity_id, 2));
  });
});
