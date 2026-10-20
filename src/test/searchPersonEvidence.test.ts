import { describe, expect, it } from "vitest";
import { cleanTextNameTsQuery, isPersonEvidenceCandidate, personIdentityState, rankPersonEvidence } from "../../supabase/functions/_shared/search-person-evidence";

const ep = (id: string, title: string, published_at = "2025-01-01") => ({ id, title, people: [] as string[], published_at });
const verified = [{ id: "p", name: "Hajós András", slug: "hajos-andras", verified: true }];

describe("person evidence ranking", () => {
  it("orders accepted participant, subject, mention, verified pending, then text-only", () => {
    const ranked = rankPersonEvidence({
      episodes: [ep("text", "Hajós András a címben", "2026-01-01"), ep("pending", "Hajós Andrással", "2026-01-02"),
        ep("mention", "Egy"), ep("subject", "Kettő"), ep("host", "Három"), ep("guest", "Négy", "2025-02-01")],
      names: ["Hajós András"], candidates: verified,
      links: [
        { person_id: "p", episode_id: "mention", relevance_status: "accepted", role_type: "mention" },
        { person_id: "p", episode_id: "subject", relevance_status: "accepted", role_type: "subject" },
        { person_id: "p", episode_id: "host", relevance_status: "accepted", mention_type: "host", role_type: "participant" },
        { person_id: "p", episode_id: "guest", relevance_status: "accepted", mention_type: "guest", role_type: "participant" },
        { person_id: "p", episode_id: "pending", relevance_status: "pending", role_type: "participant" },
      ],
    });
    expect(ranked.map((e) => e.id)).toEqual(["guest", "host", "subject", "mention", "pending", "text"]);
    expect(ranked.map((e) => e.name_evidence.label)).toEqual(["Vendég", "Műsorvezető", "Róla szól", "Említés", "Nem ellenőrzött kapcsolat", "Szöveges találat"]);
    expect(ranked[0].name_evidence.identity_unconfirmed).toBe(false);
  });

  it("uses the judged role over the raw mention type", () => {
    const [row] = rankPersonEvidence({
      episodes: [ep("x", "Valami")], names: ["Hajós András"], candidates: verified,
      links: [{ person_id: "p", episode_id: "x", relevance_status: "accepted", mention_type: "guest", role_type: "mention" }],
    });
    expect(row.name_evidence.kind).toBe("accepted_mention");
  });

  it("drops rejected-only and unverified pending-only episodes", () => {
    const ranked = rankPersonEvidence({
      episodes: [ep("rej", "Valami"), ep("pend", "Más")], names: ["Hajós András"], candidates: verified,
      links: [
        { person_id: "p", episode_id: "rej", relevance_status: "rejected", role_type: "participant" },
        { person_id: "p", episode_id: "pend", relevance_status: "pending", role_type: "participant" },
      ],
    });
    expect(ranked).toEqual([]);
  });

  it("is stable for equal evidence", () => {
    const episodes = [ep("b", "Hajós András 1", "2025-01-01"), ep("a", "Hajós András 2", "2025-01-01")];
    expect(rankPersonEvidence({ episodes, names: ["Hajós András"], candidates: [], links: [] }).map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("reports identity state without merging homonyms", () => {
    expect(personIdentityState([])).toBe("none");
    expect(personIdentityState(verified)).toBe("verified");
    expect(personIdentityState([{ ...verified[0], verified: false }])).toBe("unconfirmed");
    expect(personIdentityState([...verified, { ...verified[0], id: "q" }])).toBe("multiple");
  });

  it("excludes hidden or split catalog rows from evidence", () => {
    const base = { is_public: true, is_indexable: true, activation_status: "active" };
    expect(isPersonEvidenceCandidate({ ...base, identity_ambiguous: true })).toBe(true);
    expect(isPersonEvidenceCandidate({ ...base, ai_recommended_action: "hide" })).toBe(false);
    expect(isPersonEvidenceCandidate({ ...base, identity_status: "split_resolved" })).toBe(false);
    expect(isPersonEvidenceCandidate({ ...base, is_indexable: false })).toBe(false);
  });

  it("builds accent-preserving and folded phrase queries from letters only", () => {
    expect(cleanTextNameTsQuery(["Hajós András"])).toBe("(hajós <-> andrás:*) | (hajos <-> andras:*)");
    expect(cleanTextNameTsQuery(["S. Miller András"])).toBe("(s <-> miller <-> andrás:*) | (s <-> miller <-> andras:*)");
    expect(cleanTextNameTsQuery(["x'); drop table--"])).toBe("(x <-> drop <-> table:*)");
    expect(cleanTextNameTsQuery(["Egyszó"])).toBeNull();
  });
});
