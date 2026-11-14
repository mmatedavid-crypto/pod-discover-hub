import { describe, expect, it } from "vitest";
import { findRoleLabelHits, usableRoleNames } from "../../supabase/functions/_shared/person-role-label";
import { parseEpisodePageMeta } from "../../supabase/functions/_shared/episode-page-meta";

const desc = (d: string, name: string, aliases: string[] = []) => findRoleLabelHits({ episode_description: d }, name, aliases);

describe("role-label-v1 positives", () => {
  it("explicit guest label with descriptor", () => {
    const r = desc("<p>Vendég: Kovács Péter közgazdász</p><p>Beszélgetés az inflációról.</p>", "Kovács Péter");
    expect(r.outcome).toBe("hit");
    expect(r.hits[0]).toMatchObject({ role: "guest", field: "episode_description", matched_name: "Kovács Péter" });
    expect(r.hits[0].snippet).toBe("Vendég: Kovács Péter");
  });
  it("guest list joined with és", () => {
    expect(desc("Vendégeink: Szabó Anna, Nagy Béla és Kiss Csaba.", "Nagy Béla").outcome).toBe("hit");
    expect(desc("Vendégeink: Szabó Anna, Nagy Béla és Kiss Csaba.", "Kiss Csaba").outcome).toBe("hit");
  });
  it("host label gives host role", () => {
    const r = desc("Műsorvezető: Tóth Eszter. Vendég: Horváth Gábor", "Tóth Eszter");
    expect(r.hits[0].role).toBe("host");
  });
  it("title prefix like dr. is allowed", () => {
    expect(desc("Vendégünk dr. Kovács Péter, a Semmelweis Egyetem orvosa.", "Kovács Péter").outcome).toBe("hit");
  });
});

describe("role-label-v1 negatives", () => {
  it("longer name is a different person (homonym prefix)", () => {
    expect(desc("Vendég: Pintér András Gábor történész", "Pintér András").outcome).not.toBe("hit");
  });
  it("editor credit after the guest is not a guest", () => {
    expect(desc("Vendég: Kovács Péter. Szerkesztő: Nagy Béla", "Nagy Béla").outcome).not.toBe("hit");
    expect(desc("Vendég: Kovács Péter Szerkesztő: Nagy Béla, Kiss Csaba", "Kiss Csaba").outcome).not.toBe("hit");
  });
  it("historical or quoted person is not a guest", () => {
    expect(desc("Vendégünk Kovács Péter, aki Petőfi Sándorról írt könyvet.", "Petőfi Sándor").outcome).not.toBe("hit");
    expect(desc("Vendégünk Nagy Anna, Petőfi Sándor kutatója.", "Petőfi Sándor").outcome).not.toBe("hit");
    expect(desc("Vendég: Petőfi Sándor (1823–1849) versei", "Petőfi Sándor").outcome).not.toBe("hit");
  });
  it("global or single-token aliases never count", () => {
    expect(usableRoleNames("Orbán", ["Viktor"])).toEqual([]);
    expect(desc("Vendég: Kovács P. közgazdász", "Kovács Péter", []).outcome).not.toBe("hit");
  });
  it("show host without episode-level text gives nothing", () => {
    expect(findRoleLabelHits({ episode_title: "Infláció 2026", episode_description: "Beszélgetés a gazdaságról." }, "Tóth Eszter").outcome).toBe("no_label");
  });
  it("AI summary is not a usable field", () => {
    const r = findRoleLabelHits({ ai_summary: "Vendég: Kovács Péter" } as never, "Kovács Péter");
    expect(r.outcome).toBe("no_label");
  });
  it("lowercase names are not matched", () => {
    expect(desc("vendégünk ma gróf széchenyi istván", "Széchenyi István").outcome).not.toBe("hit");
  });
  it("previous or next episode guests are not this episode", () => {
    expect(desc("Korábbi vendégeink: Kovács Péter, Nagy Béla", "Kovács Péter").outcome).not.toBe("hit");
    expect(desc("Következő vendégünk: Kovács Péter", "Kovács Péter").outcome).not.toBe("hit");
  });
  it("name as someone's relative is not a guest", () => {
    expect(desc("Vendég: Kovács Péter, Szabó Anna férje", "Szabó Anna").outcome).not.toBe("hit");
  });
  it("host and guest at once is a conflict, not a hit", () => {
    expect(desc("Műsorvezető: Kovács Péter. Vendég: Kovács Péter", "Kovács Péter").outcome).toBe("role_conflict");
  });
});

describe("episode page meta", () => {
  const html = (d: string) => `<html><head><title>Ep</title><meta property="og:description" content="${d}"></head></html>`;
  it("keeps an episode-specific description", () => {
    const r = parseEpisodePageMeta(html("Vendég: Kovács Péter közgazdász, beszélgetés az inflációról és a bérekről."), "Rövid RSS.", "A műsor a gazdaságról szól.");
    expect(r.status).toBe("ok");
  });
  it("show-level page text is never episode evidence", () => {
    const show = "Heti gazdasági műsor Tóth Eszter vezetésével, minden csütörtökön új résszel.";
    expect(parseEpisodePageMeta(html(show), "Valami más.", show).status).toBe("show_level");
  });
  it("same text as RSS adds nothing", () => {
    const rss = "Vendég: Kovács Péter közgazdász, beszélgetés az inflációról és a bérekről.";
    expect(parseEpisodePageMeta(html(rss), rss, "Műsor.").status).toBe("same_as_rss");
  });
});

describe("descriptor window", () => {
  it("keeps only the person's own list item", () => {
    const r = findRoleLabelHits({ episode_description: "Vendégek: Mitrovits Miklós történész, Győrffy Dóra közgazdász, Nagy Béla" }, "Mitrovits Miklós");
    expect(r.hits[0].descriptor).toBe("történész");
    const r2 = findRoleLabelHits({ episode_description: "Vendégek: Mitrovits Miklós történész, Győrffy Dóra" }, "Győrffy Dóra");
    expect(r2.hits[0].descriptor).toBe("");
  });
});

describe("page boilerplate", () => {
  it("drops host-platform filler so it never counts as episode text", async () => {
    const { stripBoilerplate } = await import("../../supabase/functions/_shared/episode-page-meta");
    expect(stripBoilerplate("Stream 20261111 - 06 Görög Zita by Bochkor on desktop and mobile. Play over 320 million tracks for free on SoundCloud.")).toBe("");
  });
});
