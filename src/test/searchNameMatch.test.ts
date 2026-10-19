import { describe, expect, it, vi, beforeEach } from "vitest";
import { createFullNameMatcher, fullNameTsQuery, nameEvidenceTier, rankFullNameMatches } from "../../supabase/functions/_shared/search-name-match";

const state = vi.hoisted(() => ({ rows: [] as any[] }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => {
    const builder: any = {};
    for (const method of ["select", "or", "eq", "limit", "textSearch", "order"]) builder[method] = () => builder;
    builder.then = (resolve: any) => Promise.resolve({ data: state.rows }).then(resolve);
    return builder;
  } },
}));
import { searchEpisodes } from "@/lib/search";

const collision = {
  id: "split", title: "Hajós Szilárd és S. Miller András a Sláger KULT-ban",
  description: "Hajós Szilárd színművész. Műsorvezető: S. Miller András.",
  people: ["Hajós Szilárd", "S. Miller András"], published_at: "2026-02-08",
  podcasts: { slug: "slager-fm", language_decision: "accept_hungarian", rank_label: "S", podiverzum_rank: 10 },
};
const interview = {
  id: "interview", title: "Hajós András - egy modern apa kreativitással fűszerezve - Apaidő Podcast 23. adás",
  people: ["Hajós András"], published_at: "2023-12-03",
  podcasts: { slug: "apaido", language_decision: "accept_hungarian", rank_label: "C", podiverzum_rank: 3.15 },
};

describe("full name evidence", () => {
  it.each(["Hajós András", "hajós andrás", "HAJÓS ANDRÁS", "hajos andras", "  Hajós   András "])("rejects split identities for %s", (query) => {
    const match = createFullNameMatcher([query]);
    expect(nameEvidenceTier(collision, match)).toBe(0);
    expect(nameEvidenceTier(interview, match)).toBe(3);
  });

  it.each([
    ["Kovács András", "Kovács Péter és Szabó András"],
    ["Nagy Péter", "Nagy Anna és Kiss Péter"],
    ["Rónai Egon", "Rónai Péter és Egon története"],
    ["Schmied Andi", "Schmied családja és Szilvási András"],
    ["Hajós András", "Hajós Andrási"],
    ["Hajós András", "Űrhajós András"],
    ["Hajós András", "Hajós, András"],
  ])("does not combine fragments: %s / %s", (query, source) => {
    expect(createFullNameMatcher([query])(source)).toBe(false);
  });

  it.each([
    ["Hajós András", "Beszélgetés Hajós Andrással"],
    ["Rónai Egon", "Rónai Egonnal beszélgetünk"],
    ["Orbán Viktor", "Orbán Viktorról"],
    ["Szabó Magda", "Szabó Magdával"],
    ["Schmied Andi", "Schmied Andival"],
    ["S. Miller András", "S. Miller Andrással"],
    ["S. Miller András", "S Miller András"],
    ["Kiss Balázs", "Kiss Balázzsal"],
    ["Kiss Kovács", "Kiss Kováccsal"],
    ["Hajós András", "<p>Hajós <strong>András</strong> a vendégünk.</p>"],
    ["Hajós András", "Hajós&nbsp;András"],
    ["Hajós András", "Hajós\nAndrás"],
  ])("preserves a complete name: %s / %s", (query, source) => {
    expect(createFullNameMatcher([query])(source)).toBe(true);
  });

  it("keeps field and entity boundaries, including HTML paragraphs", () => {
    const match = createFullNameMatcher(["Hajós András"]);
    expect(nameEvidenceTier({ title: "Hajós", description: "András", people: ["Hajós", "András"] }, match)).toBe(0);
    expect(match("<p>Hajós</p><p>András</p>")).toBe(false);
  });

  it("does not allow a recent split-name result above old interviews after other ordering", () => {
    expect(rankFullNameMatches([collision, interview], ["Hajós András"]).map((e) => e.id)).toEqual(["interview", "split"]);
    expect(rankFullNameMatches([collision, interview], ["Hajós András"], { strict: true }).map((e) => e.id)).toEqual(["interview"]);
  });

  it("admits accepted identity links and verified full clean-text evidence without padding", () => {
    const rows = [collision, { id: "linked" }, { id: "transcript" }];
    expect(rankFullNameMatches(rows, ["Hajós András"], {
      strict: true, acceptedEpisodeIds: new Set(["linked"]), cleanTextEpisodeIds: new Set(["transcript"]),
    }).map((e) => e.id)).toEqual(["linked", "transcript"]);
    expect(rankFullNameMatches([collision], ["Hajós András"], { strict: true })).toEqual([]);
  });

  it("does not truncate evidence at 1800/5000 characters or invent reversed-name aliases", () => {
    const match = createFullNameMatcher(["Hajós András"]);
    expect(nameEvidenceTier({ description: "előszó ".repeat(1000) + "Hajós András a vendég" }, match)).toBe(1);
    expect(match("András Hajós")).toBe(false);
    expect(createFullNameMatcher(["Hajós András", "András Hajós"])("András Hajós")).toBe(true);
  });

  it("uses folded adjacent tokens for indexed retrieval, then verifies suffixes", () => {
    expect(fullNameTsQuery("Hajós András")).toBe("hajos <-> andras:*");
    expect(fullNameTsQuery("S. Miller András")).toBe("s <-> miller <-> andras:*");
    expect(fullNameTsQuery("podcast")).toBeNull();
  });
});

describe("browser fallback search", () => {
  beforeEach(() => { state.rows = [collision, interview]; });
  it.each(["Hajós András", "hajós andrás", "hajos andras", "HAJÓS ANDRÁS"])("returns the actual person for %s", async (rawQuery) => {
    const result = await searchEpisodes({ rawQuery });
    expect(result.all.map((x) => x.e.id)).toEqual(["interview"]);
  });

  it("keeps an untagged inflected interview and a description-only full-name match", async () => {
    state.rows = [collision,
      { ...interview, id: "inflected", title: "Médiatudatosság Hajós Andrással", people: [] },
      { ...interview, id: "body", title: "Beszélgetés az apaságról", people: [], description: "Vendégünk Hajós András." },
    ];
    const result = await searchEpisodes({ rawQuery: "hajos andras" });
    expect(result.all.slice(0, 2).map((x) => x.e.id)).toEqual(["inflected", "body"]);
  });

  it("does not let diversity push exact names behind a split match", async () => {
    state.rows = [collision, ...[1, 2, 3, 4].map((n) => ({ ...interview, id: `same-${n}`, title: `${interview.title} ${n}` }))];
    const result = await searchEpisodes({ rawQuery: "Hajós András" });
    expect(result.all).toHaveLength(4);
    expect(result.all.every((x) => x.e.id.startsWith("same-"))).toBe(true);
  });

  it("preserves general topic search and category grouping", async () => {
    state.rows = [
      { ...interview, id: "topic", title: "Mesterséges intelligencia az iskolában", people: [], podcasts: { ...interview.podcasts, category: "education" } },
      { ...interview, id: "broad", title: "Intelligencia és mesterséges rendszerek", people: [], podcasts: { ...interview.podcasts, category: "technology" } },
    ];
    const result = await searchEpisodes({ rawQuery: "mesterséges intelligencia", scope: "category", categoryName: "education" });
    expect(result.all.map((x) => x.e.id)).toEqual(["topic", "broad"]);
    expect(result.inCategory.map((x) => x.e.id)).toEqual(["topic"]);
    expect(result.outsideCategory.map((x) => x.e.id)).toEqual(["broad"]);
  });
});
