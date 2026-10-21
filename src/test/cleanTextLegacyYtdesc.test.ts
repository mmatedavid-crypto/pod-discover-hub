import { describe, expect, it } from "vitest";

(globalThis as any).Deno ??= { env: { get: () => "" } };
const { planLegacyYtdesc, identityCheck, linkResidueReasons, lostPersonNames, LEGACY_YTDESC_POLICY } = await import("../../supabase/functions/_shared/clean-text-legacy-ytdesc");

const RSS = "Ebben az adásban Kovács Péter történésszel beszélgetünk a budapesti hidak építéséről és a reformkor mérnökeiről. "
  + "Szó esik a Lánchíd tervezéséről, Clark Ádám munkásságáról és arról, hogyan változott meg a város élete a folyami átkelés után. "
  + "A beszélgetés végén a hallgatói kérdésekre is válaszolunk.";
const YT_EXTRA = "A videóban részletesen bemutatjuk Széchenyi István szerepét és a hídpénz körüli vitákat. "
  + "Megnézzük a korabeli metszeteket, a pesti és budai polgárok leveleit, valamint a hídépítés pénzügyi hátterét is.";
const PRIOR_YT = `${RSS}\n\n${YT_EXTRA}`;

const vr = { policy: "youtube_episode_match_v3", final_score: 0.91, blockers: [] };
const link = (over: any = {}) => ({
  id: "L1", video_id: "v1", channel_id: "ch1", status: "confirmed", title: "Hidak és mérnökök a reformkorban",
  published_at: "2024-03-01T10:00:00Z", vr, description: PRIOR_YT, prov: true, video_confirmed_elsewhere: 0, elsewhere_titles: [], ...over,
});
const ep = (over: any = {}) => ({
  id: "E1", podcast_id: "P1", title: "Hidak és mérnökök a reformkorban", podcast_title: "Várostörténet",
  published_at: "2024-03-01T08:00:00Z", description: RSS, clean_text_status: "done",
  cleaned_text: PRIOR_YT, source_hash: "H0", cleaner_method: "deterministic_v4+ytdesc", removed_categories: ["x"],
  best_type: "rss", backups: [], same_desc: 1, links: [link()], show_channels: { ch1: 40 }, spotify: null, show_sp_conf: 0, ...over,
});

describe("legacy ytdesc planner: grounded, explainable decisions", () => {
  it("A: verified YouTube source with extra content is kept; only attribution is aligned (same text, same hash)", async () => {
    const p = await planLegacyYtdesc(ep());
    expect(p.bucket).toBe("A");
    expect(p.outcome).toBe("legacy_verified_youtube_kept");
    expect(p.write).toBe("attribute");
    const it: any = p.item;
    expect(it.cleaned_text).toBe(PRIOR_YT);
    expect(it.source_hash).toBe("H0");
    expect(it.expected_source_hash).toBe("H0");
    expect(it.source_type).toBe("youtube");
    expect(it.removed_categories).toContain("x");
    expect(p.reasons[0]).toBe(LEGACY_YTDESC_POLICY);
  });

  it("B: text from a rejected video that does not match the episode is replaced by the episode's own RSS", async () => {
    const wrong = "Ez a videó a balatoni vitorlázásról szól, Nagy Ilona edzővel és a tavaszi versenyekről, rengeteg érdekes részlettel, régi felvételekkel és a klub történetével.";
    const p = await planLegacyYtdesc(ep({ cleaned_text: wrong, links: [link({ status: "rejected", description: wrong, title: "Vitorlás klub", published_at: "2021-01-01T00:00:00Z" })] }));
    expect(p.bucket).toBe("B");
    expect(p.write).toBe("apply");
    expect((p.item as any).source_type).toBe("rss");
    expect((p.item as any).cleaned_text).toContain("Kovács Péter");
    expect((p.item as any).expected_source_hash).toBe("H0");
  });

  it("C: a rejected pairing is not enough when the stored text matches the title and names would be lost", async () => {
    const grounded = "Hidak és mérnökök a reformkorban: Tóth Gergely mérnök meséli el a reformkori hidak titkait, a mérnökök mindennapjait és a korabeli építkezések nehézségeit részletesen.";
    const p = await planLegacyYtdesc(ep({ cleaned_text: grounded, links: [link({ status: "rejected", description: grounded, published_at: "2024-01-01T00:00:00Z" })] }));
    expect(p.status).toBe("needs_review");
    expect(p.outcome).toBe("legacy_rejected_link_but_grounded_review");
    expect(p.write).toBe("none");
  });

  it("C: an unconfirmed but plausible video (same title, same day) goes to review, never auto-replaced", async () => {
    const p = await planLegacyYtdesc(ep({ links: [link({ status: "candidate", vr: { policy: "youtube_episode_match_v3", final_score: 0.7 } })] }));
    expect(p.bucket).toBe("C");
    expect(p.outcome).toBe("legacy_unverified_plausible_review");
  });

  it("wrong: the episode is confirmed to another video → the stored text's video is wrong", async () => {
    const other = link({ id: "L2", video_id: "v2", prov: false, description: "más" });
    const wrong = "Ez a videó a balatoni vitorlázásról szól, Nagy Ilona edzővel és a tavaszi versenyekről, rengeteg érdekes részlettel, régi felvételekkel és a klub történetével.";
    const p = await planLegacyYtdesc(ep({ cleaned_text: wrong, links: [link({ status: "candidate", description: wrong }), other] }));
    expect(p.provenance.state).toBe("wrong");
    expect(p.write).toBe("apply");
  });

  it("E: stored text adds nothing beyond RSS → no write", async () => {
    const p = await planLegacyYtdesc(ep({ cleaned_text: RSS }));
    expect(p.bucket).toBe("E");
    expect(p.write).toBe("none");
  });

  it("P: reviewed/manual backups protect the row; this lane's own earlier backups do not", async () => {
    const prot = await planLegacyYtdesc(ep({ backups: [{ batch_id: "b-manual", method: "deterministic_v4", reasons: ["rss_repair_v1"] }] }));
    expect(prot.status).toBe("protected");
    const reviewed = await planLegacyYtdesc(ep({ backups: [{ batch_id: "8e365da4-f9db-4bbc-90f7-4fc6506fb358", reasons: [LEGACY_YTDESC_POLICY] }] }), { protectedBatches: ["8e365da4-f9db-4bbc-90f7-4fc6506fb358"] });
    expect(reviewed.status).toBe("protected");
    const own = await planLegacyYtdesc(ep({ backups: [{ batch_id: "b-own", reasons: [LEGACY_YTDESC_POLICY, "legacy_verified_youtube"] }] }));
    expect(own.status).not.toBe("protected");
  });

  it("runner-owned episodes are retried later, other source lanes are protected", async () => {
    expect((await planLegacyYtdesc(ep({ clean_text_status: "pending" }))).status).toBe("retry");
    expect((await planLegacyYtdesc(ep({ best_type: "spotify" }))).status).toBe("protected");
  });

  it("RSS output with link-label leftovers is never used as a replacement", () => {
    expect(linkResidueReasons("Kövess minket: web: facebook csoport: x (twitter): podcast: vagy")).toContain("link_label_residue");
    expect(linkResidueReasons("Köszönöm! .wordpress.com iTunes:")).toContain("domain_fragment");
    expect(linkResidueReasons("Kérdésed van? Tiktok: Timeline: 00:00 bevezető")).toContain("link_label_residue");
    expect(linkResidueReasons("Instagrammon is: / zsofi_kotelvero. Ha tetszett")).toContain("handle_fragment");
    expect(linkResidueReasons("Vendégünk: Szakonyi Eszter, a Vintage Beauty alapítója. 0:00 Beköszöntő 1:09 Pályaváltás")).toEqual([]);
  });

  it("identity: episode-number conflict and far release dates are detected; names compared accent-insensitively", () => {
    const id = identityCheck(ep({ title: "#41 Migráció" }), link({ title: "#53 Űrtávcső", vr: {} }));
    expect(id.number_conflict).toBe(true);
    const far = identityCheck(ep(), link({ published_at: "2023-01-01T00:00:00Z" }));
    expect(far.date_days).toBeGreaterThan(120);
    expect(far.strong).toBe(false);
    expect(lostPersonNames("ma Kovács Péter és Tóth Anna beszélget", "TOTH ANNA és mások")).toEqual(["Kovács Péter"]);
  });
});
