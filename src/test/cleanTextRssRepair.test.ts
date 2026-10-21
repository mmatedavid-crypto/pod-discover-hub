import { describe, expect, it } from "vitest";

(globalThis as any).Deno ??= { env: { get: () => "" } };
const { decideCleanText, validateCleanOutput, lostNamedTokens } = await import("../../supabase/functions/_shared/clean-text-validation");
const { planRssRepair, addedNamedEvidence } = await import("../../supabase/functions/_shared/clean-text-rss-repair");

const GUEST_RSS = "#szponzorált_tartalom - A legtöbb cég nagyon nehezen ér el sikerek a Google Ads-ben, A Minner ezért megkeresi azokat a módszereket, amire igazán érdemes fókuszálni, ha sikereket akarsz elérni. A címben leírt stratégia igazán izgalmas és még logikus is lesz, ezt meglátod a mostani témában, illetve meghallod, mert podcastként, hanganyagban dolgoztuk fel a témát. És persze eredményes is. Bartos Dávid volt a vendégem, aki az Adlab PPC ügynökséget vezeti. Már több esettanulmányával is találkozhattál a Minneren, most pedig a Google hirdetésekről, sőt még a Facebook hirdetésekről is beszélgetni fogunk.";

const CHAPTER_RSS = "Vendégünk Szabó László, a klub elnöke. Ebben a részben a vasútról és az uniós pénzekről beszélgettünk hosszan, sok kérdéssel és még több történettel.\n0:42 Bezzeg a bangkoki vonatok!\n2:30 Mikor jön már a szezonalitás?\n5:30 Mindjárt meglesz az EU pénz?\n9:15 Bős-Nagymaros és a kamatok\nKövess minket: https://facebook.com/x";
const PRIOR_SHORT = "Vendégünk Szabó László, a klub elnöke.";

const target = (over: any = {}) => ({
  episode_id: "00000000-0000-0000-0000-000000000001",
  description: CHAPTER_RSS,
  summary: null,
  clean_text_status: "done",
  best_source_type: null,
  current_source_hash: "h1",
  current_cleaned_text: PRIOR_SHORT,
  current_cleaner_method: "deterministic_v4",
  has_clean_row: true,
  active_backups: 0,
  ...over,
});

describe("clean-text decision keeps names", () => {
  it("never drops the guest's name from an RSS description", () => {
    const d = decideCleanText({ raw: GUEST_RSS });
    expect(d.action).toBe("write");
    expect((d as any).text).toContain("Bartos Dávid");
  });
  it("half-removed links are not valid clean text", () => {
    const raw = "Egy hosszú leírás a fenntarthatóságról, a falvakról és a közösségekről, amelyben sok szó esik a jövőről és a megoldásokról, valamint az ökofalvak hálózatáról is.";
    const v = validateCleanOutput(raw, `${raw} Iratkozz fel: . ly/hvg-hirlevelek`);
    expect(v.reasons).toContain("residual_url_fragment");
  });
  it("platform and call-to-action words are not counted as lost names", () => {
    expect(lostNamedTokens("Facebook Instagram Kövess Patreon", "")).toEqual([]);
    expect(lostNamedTokens("Vendég: Kiss Lóránt", "Vendég:")).toEqual(["Kiss", "Lóránt"]);
  });
});

describe("RSS repair planner", () => {
  it("extends an overcut text when every prior name is kept and timecodes are added", async () => {
    const p = await planRssRepair(target());
    expect(p.outcome).toBe("apply");
    expect((p.item as any).cleaned_text).toContain("Szabó László");
    expect((p.item as any).cleaned_text).toContain("0:42");
    expect((p.item as any).expected_source_hash).toBe("h1");
    expect((p.item as any).cleaner_method.startsWith("deterministic_v4")).toBe(true);
    expect((p.item as any).cleaned_text).not.toMatch(/https?:\/\//);
  });
  it("fills an empty or missing clean text from a substantive RSS", async () => {
    const p = await planRssRepair(target({ has_clean_row: false, current_cleaned_text: null, current_source_hash: null, clean_text_status: "skipped" }));
    expect(p.outcome).toBe("apply");
    expect((p.item as any).expected_source_hash).toBeNull();
    expect((p.item as any).expected_cleaned_sha256).toBeNull();
  });
  it("protects reviewed/earlier repairs, other-source text and runner-owned episodes", async () => {
    expect((await planRssRepair(target({ active_backups: 1 }))).reasons).toContain("protected_prior_repair");
    expect((await planRssRepair(target({ current_cleaner_method: "deterministic_v4+ytdesc" }))).reasons).toContain("prior_alt_source_kept");
    expect((await planRssRepair(target({ current_cleaner_method: "deterministic_v4+spotify+rescue_v1" }))).reasons).toContain("prior_alt_source_kept");
    expect((await planRssRepair(target({ clean_text_status: "pending" }))).outcome).toBe("reject");
    expect((await planRssRepair(target({ best_source_type: "youtube" }))).reasons).toContain("best_source_youtube_own_lane");
  });
  it("never replaces prior text that has a name the new text lacks", async () => {
    const p = await planRssRepair(target({ current_cleaned_text: "Vendégünk Kovács Anna, a zenekar alapítója, aki a turnéról mesél." }));
    expect(p.outcome).toBe("reject");
    expect(p.reasons).toContain("would_lose_prior_names");
  });
  it("added promo or call-to-action text does not count as an improvement", () => {
    const prior = "Ebben az adásban a buyer personákról beszélek.";
    const next = `${prior}\n🤓 Rengeteg cikket publikálok a blogon is. 🎤 Alakítsd Te a műsort! Kövess a Facebookon és az Instagramon!`;
    expect(addedNamedEvidence(prior, next).length).toBeLessThan(2);
    expect(addedNamedEvidence(prior, `${prior} A vendég Kovács Anna volt, 12:30 a turné.`)).toEqual(expect.arrayContaining(["Kovács", "Anna", "12:30"]));
  });
  it("a channel blurb repeated on many episodes of the show is never used as episode text", async () => {
    expect((await planRssRepair(target({ same_description_in_show: 64 }))).reasons).toContain("show_level_boilerplate_description");
    expect((await planRssRepair(target({ same_description_in_show: 1 }))).outcome).toBe("apply");
  });
  it("link-only RSS is never written", async () => {
    const p = await planRssRepair(target({ description: "Facebook: https://facebook.com/a Instagram: https://instagram.com/b Kövess minket!", current_cleaned_text: "", has_clean_row: true }));
    expect(p.outcome).toBe("reject");
  });
});
