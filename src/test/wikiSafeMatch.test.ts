import { describe, expect, it } from "vitest";
import { contextOverlap, orgDecision, personDecision, pickUnique, resolveTitles, reusableLicense, titleCarriesName } from "../../supabase/functions/_shared/wiki-safe-match";

const human = (extra: Record<string, unknown> = {}) => ({ exists: true, title: "Szalay Dániel", p31: ["Q5"],
  description: "magyar újságíró", extract: "Szalay Dániel magyar újságíró, podcaster, a Media1 híroldal alapítója.", ...extra });

describe("safe Wikipedia matching — people", () => {
  it("accepts an exact human article backed by two context words", () => {
    const d = personDecision({ name: "Szalay Dániel", context: ["Media1 podcast", "Vendégünk Szalay Dániel újságíró"] }, human());
    expect(d.decision).toBe("accept");
  });
  it("sends name-only matches to review", () => {
    expect(personDecision({ name: "Szalay Dániel", context: ["Heti beszélgetés"] }, human()).decision).toBe("review");
  });
  it("sends disambiguation pages and same-name people to review", () => {
    expect(personDecision({ name: "Király István", context: [] }, { exists: true, disambiguation: true }).reason).toBe("disambiguation_page");
    expect(personDecision({ name: "Szalay Dániel", context: ["Media1 újságíró"], sameNamePublic: true }, human()).reason).toBe("same_name_in_catalog");
  });
  it("rejects a person who died long before appearing as a guest", () => {
    const d = personDecision({ name: "Ghyczy András", context: ["Media1 újságíró"], participantRoles: 3, firstParticipantAt: "2024-05-01T00:00:00Z" },
      human({ title: "Ghyczy András", death: "1614-01-01" }));
    expect(d.reason).toBe("died_before_appearing_as_participant");
  });
  it("ignores the entity's own name words as evidence", () => {
    expect(contextOverlap(["Szalay Dániel podcast"], "Szalay Dániel magyar újságíró", ["Szalay Dániel"])).toEqual([]);
  });
});

describe("safe Wikipedia matching — organizations", () => {
  it("accepts a typed organization with a matching Wikidata class", () => {
    expect(orgDecision({ name: "Real Madrid", orgType: "sport_team", context: [] }, { exists: true, title: "Real Madrid CF", p31: ["Q476028"], typeOk: true }).decision).toBe("accept");
  });
  it("sends a city found for a sports team to review", () => {
    expect(orgDecision({ name: "Kecskemét", orgType: "sport_team", context: [] }, { exists: true, title: "Kecskemét", p31: ["Q515"], typeOk: false }).reason).toBe("type_mismatch");
  });
  it("sends the telex machine found for the Telex news site to review", () => {
    expect(orgDecision({ name: "Telex", orgType: "media", context: [] }, { exists: true, title: "Telex", p31: ["Q11019"], typeOk: false }).decision).toBe("review");
  });
  it("requires context for the catch-all type", () => {
    expect(orgDecision({ name: "NATO", orgType: "other", context: ["Ukrajna háború"] }, { exists: true, title: "Észak-atlanti Szerződés Szervezete", p31: ["Q484652"], typeOk: true, extract: "katonai szövetség" }).reason).toBe("other_type_without_context");
  });
});

describe("image licences", () => {
  it("accepts free licences and refuses non-free files", () => {
    expect(reusableLicense("CC BY-SA 4.0", null)).toBe(true);
    expect(reusableLicense("Public domain", null)).toBe(true);
    expect(reusableLicense("Fair use", null)).toBe(false);
    expect(reusableLicense(null, null)).toBe(false);
  });
});

describe("second pass for wrong-thing and disambiguation articles", () => {
  it("tries the news-site titles for Telex and 444, never the rejected article", () => {
    expect(resolveTitles("Telex", "media", "Telex", ["Telex.hu", "Ducsay Zsuzsanna", "Mandiner"])).toContain("Telex.hu");
    expect(resolveTitles("Telex", "media", "Telex", ["Telex"])).not.toContain("Telex");
    expect(resolveTitles("444", "media", "444", [])).toContain("444.hu");
  });
  it("ignores disambiguation links that do not carry the name", () => {
    const t = resolveTitles("Telex", "media", "Telex", ["Ducsay Zsuzsanna", "Munk Veronika", "Mandiner", "Telex (egyértelműsítő lap)"]);
    expect(t.some((x) => /Ducsay|Munk|Mandiner|egyértelműsítő/.test(x))).toBe(false);
    expect(titleCarriesName("Ferencvárosi TC (labdarúgás)", "Ferencváros")).toBe(true);
    expect(titleCarriesName("Nápoly", "Napoli")).toBe(false);
  });
  it("applies only when exactly one Wikidata item passes", () => {
    const acc = { decision: "accept" as const, reason: "x" };
    const rev = { decision: "review" as const, reason: "type_mismatch" };
    expect(pickUnique([{ qid: "Q98924172", decision: acc }, { qid: "Q1", decision: rev }]).pick?.qid).toBe("Q98924172");
    expect(pickUnique([{ qid: "Q1422", decision: acc }, { qid: "Q2", decision: acc }]).pick).toBeNull();
    expect(pickUnique([{ qid: "Q1", decision: rev }]).reason).toBe("no_typed_candidate");
  });
});
