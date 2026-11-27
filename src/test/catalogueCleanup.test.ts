import { describe, expect, it } from "vitest";
import { episodeIsExcluded } from "../../supabase/functions/_shared/episode-ingest-exclusion";
import { formatPersonPage } from "../../supabase/functions/_shared/person-page-copy";

const show = "2ebf836e-eaa3-40b2-8feb-0323295dba3b";
const guid = "02e72bdf-103f-5c74-8611-ec5c4a4d1228";
const rules = [{ podcast_id: show, guid, asset_id: "RJb9HPpnlPY", old_slug: "valtozas-es-batorsag-coming-out-szelsokozep-produkcio" }];
describe("one-item durable exclusion", () => {
  it("blocks the exact GUID even when a refreshed feed changes its title or URLs", () => expect(episodeIsExcluded(rules, show, { guid })).toBe(true));
  it("blocks the stable asset when GUID changes", () => expect(episodeIsExcluded(rules, show, { audio_url: "https://media.example/RJb9HPpnlPY.mp3" })).toBe(true));
  it("blocks the old slug for sitemap regeneration", () => expect(episodeIsExcluded(rules, show, { slug: rules[0].old_slug })).toBe(true));
  it("does not block another show", () => expect(episodeIsExcluded(rules, "other-show", { guid })).toBe(false));
  it("does not block unrelated items or asset substrings", () => expect(episodeIsExcluded(rules, show, { guid: "other", audio_url: "https://media.example/RJb9HPpnlPY-other.mp3" })).toBe(false));
});
describe("public-evidence person classification", () => {
  const e = { title: "Tudatos kávézás és mindfulness", podcast_title: "KÁVÉKALANDOK", topics: ["mindfulness"], verified: true };
  it("identifies the reviewed Pápai guest, not a host", () => expect(formatPersonPage({ name: "Pápai Anita", count: 1, episodes: [{ ...e, role_type: "participant", mention_type: "guest" }] }).relation).toBe("guest"));
  it("keeps the two Veréb archive episodes as subject evidence", () => expect(formatPersonPage({ name: "Veréb István", count: 2, episodes: [{ ...e, role_type: "subject" }, { ...e, role_type: "subject" }] }).relation).toBe("subject"));
  it("distinguishes an explicit host from a guest", () => expect(formatPersonPage({ name: "Test", count: 1, episodes: [{ ...e, role_type: "participant", mention_type: "host" }] }).relation).toBe("host"));
  it("never turns mention-only evidence into attendance", () => expect(formatPersonPage({ name: "Test", count: 1, episodes: [{ ...e, role_type: "mention" }] }).relation).toBe("mention"));
  it("distinguishes mixed roles", () => expect(formatPersonPage({ name: "Test", count: 2, episodes: [{ ...e, role_type: "subject" }, { ...e, role_type: "participant", mention_type: "guest" }] }).relation).toBe("mixed"));
  it("does not assert identity from unverified name matches", () => expect(formatPersonPage({ name: "Test", count: 1, episodes: [{ ...e, verified: false, role_type: "participant" }] }).relation).toBe("unverified"));
  it("keeps empty evidence honest", () => expect(formatPersonPage({ name: "Test", count: 0, episodes: [] }).relation).toBe("empty"));
  it("uses supported specific Fabók topics and ignores unrelated generic topics", () => {
    const copy = formatPersonPage({ name: "Fabók György", count: 3, episodes: [{ title: "Bankkártyás fizetés és készpénz", topics: ["gazdaság", "bankkártyás fizetés", "asztrológia"], podcast_title: "Portfolio Business", verified: true, role_type: "participant", mention_type: "guest" }] });
    expect(copy.topics).toEqual(["bankkártyás fizetés"]);
    expect(copy.shows).toEqual(["Portfolio Business"]);
  });
  it("never promotes unverified topics", () => expect(formatPersonPage({ name: "Test", count: 1, episodes: [{ ...e, verified: false }] }).topics).toEqual([]));
  it("retains both supported Fabók subjects without adding an unsupported second one", () => {
    const input = { name: "Fabók György", count: 2, episodes: [{ title: "Bankkártyás fizetés és készpénzhasználat", topics: ["bankkártyás fizetés", "készpénzhasználat", "mindfulness"], verified: true, role_type: "participant", mention_type: "guest" }] };
    expect(formatPersonPage(input).topics).toEqual(["bankkártyás fizetés", "készpénzhasználat"]);
    expect(formatPersonPage({ ...input, episodes: [{ ...input.episodes[0], title: "Bankkártyás fizetés" }] }).topics).toEqual(["bankkártyás fizetés"]);
  });
  it("keeps Rapinec's mixed guest and mention evidence distinct", () => {
    expect(formatPersonPage({ name: "Rapinec Valéria", count: 2, episodes: [
      { ...e, role_type: "participant", mention_type: "guest" },
      { ...e, role_type: "mention" },
    ] }).relation).toBe("mixed");
  });
  it("does not turn a historical panel subject into a personal appearance", () => {
    expect(formatPersonPage({ name: "Test", count: 1, historical: true, episodes: [{ ...e, role_type: "participant", mention_type: "guest" }] }).relation).toBe("subject");
  });
  it("keeps material identity in the standalone snippet, not beside the visible subtitle", () => {
    for (const [name, identityLabel, role_type, podcast_title] of [
      ["Pápai Anita", "A Tejhabos mindenit szerzője, a KÁVÉKALANDOK vendége", "participant", "KÁVÉKALANDOK"],
      ["Veréb István", "A Friderikusz Archív 1991-es és 1992-es riportjainak szereplője", "subject", "Friderikusz Podcast"],
    ]) {
      const copy = formatPersonPage({ name, identityLabel, count: 2, episodes: [{ ...e, podcast_title, role_type, mention_type: "guest" }] });
      const visibleHeader = `${identityLabel}\n${copy.intro}`;
      expect(visibleHeader.split(identityLabel)).toHaveLength(2);
      expect(copy.description).toContain(identityLabel);
      expect(copy.intro).not.toContain("2");
      expect(copy.intro).not.toContain(podcast_title);
      expect(copy.relation).toBe(role_type === "subject" ? "subject" : "guest");
    }
  });
  it("never promotes a one-word category to prose or standalone identity metadata", () => {
    const copy = formatPersonPage({ name: "Varga Dorottya", identityLabel: "kultúra", count: 0, episodes: [] });
    expect(copy.intro).not.toContain("kultúra");
    expect(copy.description).not.toContain("kultúra");
    expect(copy.relation).toBe("empty");
  });
  it("does not let a guest subtitle hide mixed or unverified evidence", () => {
    const input = { name: "Test", identityLabel: "A műsor vendége", count: 2, episodes: [{ ...e, role_type: "participant", mention_type: "guest" }, { ...e, role_type: "mention" }] };
    expect(formatPersonPage(input).relation).toBe("mixed");
    expect(formatPersonPage({ ...input, episodes: input.episodes.map(row => ({ ...row, verified: false })) }).relation).toBe("unverified");
  });
});