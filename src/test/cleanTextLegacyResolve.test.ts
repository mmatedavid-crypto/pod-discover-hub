import { describe, expect, it } from "vitest";

(globalThis as any).Deno ??= { env: { get: () => "" } };
const R = await import("../../supabase/functions/_shared/clean-text-legacy-resolve");
const { planLegacyResolve, identityVerdict, validateAiDecision, rssOnlyAdditions, LEGACY_RESOLVE_POLICY, MULTISRC_SOURCE_TYPE } = R;

const YT_TEXT = "A videóban részletesen bemutatjuk a reformkori Pest utcáit, a korabeli kávéházak életét és a pesti polgárok mindennapjait. "
  + "Megnézzük a régi metszeteket, a városfal maradványait és azt, hogyan alakult át a belváros a nagy árvíz után, rengeteg érdekes részlettel.";
const RSS = "Vendégünk Kovács Péter történész és Tóth Anna levéltáros, a beszélgetést Nagy Gábor vezeti. "
  + "Szó esik a reformkori Pest utcáiról és a korabeli kávéházakról is.\n"
  + "Kövess minket Facebookon és Instagramon is!\n"
  + "Ha szeretnéd támogatni a podcast készítését, akkor patronáld a műsort.";
const vr = { policy: "youtube_episode_match_v3", final_score: 0.93, blockers: [] };
const link = (over: any = {}) => ({
  id: "L1", video_id: "v1", channel_id: "ch1", status: "confirmed", title: "Reformkori Pest utcái",
  published_at: "2024-03-01T10:00:00Z", vr, description: YT_TEXT, prov: true, video_confirmed_elsewhere: 0, elsewhere_titles: [], ...over,
});
const ep = (over: any = {}) => ({
  id: "E1", podcast_id: "P1", title: "Reformkori Pest utcái", podcast_title: "Várostörténet", published_at: "2024-03-01T08:00:00Z",
  description: RSS, clean_text_status: "done", cleaned_text: YT_TEXT, source_hash: "H0", cleaner_method: "deterministic_v4+ytdesc",
  removed_categories: [], best_type: "rss", backups: [], same_desc: 1, links: [link()], show_channels: { ch1: 40 }, spotify: null, show_sp_conf: 0, ...over,
});

describe("legacy ytdesc resolve v2: merge only verified same-episode text, extract-only", () => {
  it("verified v3 video + RSS-only names: stored text stays first and unchanged, RSS facts appended, internal-only source", async () => {
    const p = await planLegacyResolve(ep());
    expect(p.outcome).toBe("legacy_resolve_multi_source_merged");
    const it: any = p.item;
    expect(it.cleaned_text.startsWith(YT_TEXT)).toBe(true);
    expect(it.cleaned_text).toContain("Kovács Péter");
    expect(it.cleaned_text).toContain("Tóth Anna");
    expect(it.cleaned_text).not.toMatch(/Facebook|Instagram|Kövess|patronáld/);
    expect(it.source_type).toBe(MULTISRC_SOURCE_TYPE);
    expect(it.cleaner_method).toBe("deterministic_v4+multisrc_v1");
    expect(it.cleaner_method).not.toMatch(/youtube|ytdesc/);
    expect(it.expected_source_hash).toBe("H0");
    expect(p.parts.map((x: any) => x.source)).toEqual(["youtube", "rss"]);
    expect(p.reasons[0]).toBe(LEGACY_RESOLVE_POLICY);
  });

  it("source fingerprint covers both inputs: a changed YouTube description changes it", async () => {
    const a = await planLegacyResolve(ep());
    const b = await planLegacyResolve(ep({ links: [link({ description: YT_TEXT + " Új mondat a videó leírásában." })] }));
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it("no merge without a v3 confirmation of this exact video", async () => {
    const p = await planLegacyResolve(ep({ links: [link({ vr: { policy: "youtube_episode_match_v2", final_score: 0.95 } })] }));
    expect(p.write).toBe("none");
    expect(p.outcome).not.toBe("legacy_resolve_multi_source_merged");
  });

  it("an RSS name that only appears in a link lead-in keeps the prior text (safe_internal_multi_source)", async () => {
    const rss = RSS.replace("Nagy Gábor vezeti.", "Nagy Gábor vezeti.\nMunkánkról itt olvashattok: Szabó Éva oldalán:");
    const p = await planLegacyResolve(ep({ description: rss }));
    expect(p.outcome).toBe("safe_internal_multi_source");
    expect(p.write).toBe("none");
  });

  it("a sentence that only exists because a link was cut out of it is not extract-only", () => {
    const raw = "Vendégeink: Fuller Bianka https://www.instagram.com/x/Fejes-Vékássy Lili https://y.hu/Varga Gréta beszélget.";
    const add = rssOnlyAdditions("", "Vendégeink: Fuller Bianka Lili Gréta beszélget.", raw);
    expect(add.kept).toEqual([]);
    expect(add.dropped[0].reasons).toContain("not_extract_only");
  });
});

describe("legacy ytdesc resolve v2: identity without a v3 confirmation", () => {
  const ev = (over: any = {}) => ({
    title_cov: 1, date_days: 0, number_conflict: false, channel_ok: true, strong: true, mismatch: false, title_sim: 1,
    channel_dominant: true, rss_overlap: 0.5, prior_in_rss: 0.5, spotify_verified: false, spotify_corroborates: false,
    spotify_title_sim: null, link_status: "candidate", v3_score: null, dup_other_episode: false, provenance_via: "hash", ...over,
  });
  it("episode-number conflict → incorrect", () => expect(identityVerdict(ev({ number_conflict: true })).verdict).toBe("incorrect"));
  it("much later upload with the same title is not incorrect by itself", () => {
    expect(identityVerdict(ev({ date_days: 400, rss_overlap: 0, prior_in_rss: 0, channel_dominant: false })).verdict).toBe("ambiguous");
  });
  it("a rejected pairing is not overruled by title + channel alone", () => {
    expect(identityVerdict(ev({ link_status: "rejected", rss_overlap: 0, prior_in_rss: 0 })).verdict).toBe("ambiguous");
  });
  it("video confirmed for another episode → incorrect", () => expect(identityVerdict(ev({ dup_other_episode: true })).verdict).toBe("incorrect"));
});

describe("legacy ytdesc resolve v2: AI decisions are validated deterministically", () => {
  const inputs = { rss: "Vendégünk Kovács Péter történész.", stored_text: "Kovács Péter a reformkori Pestről mesél.", episode_title: "Reformkori Pest", video_title: "", spotify: "" };
  const base = { same_episode: "yes", confidence: 0.92, facts_from_rss_only: [], facts_from_yt_only: [], overwrite_safe: "no", reasons: "x",
    evidence: [{ source: "stored_text", quote: "Kovács Péter a reformkori" }, { source: "rss", quote: "Kovács Péter történész" }] };
  it("accepts verbatim cross-source evidence above the threshold", () => expect(validateAiDecision(base, inputs).ok).toBe(true));
  it("rejects invented quotes", () => {
    const r = validateAiDecision({ ...base, evidence: [...base.evidence, { source: "rss", quote: "Szabó Éva" }] }, inputs);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("evidence_not_verbatim");
  });
  it("rejects confidence below 0.85", () => expect(validateAiDecision({ ...base, confidence: 0.7 }, inputs).ok).toBe(false));
  it("uncertain is never used", () => expect(validateAiDecision({ ...base, same_episode: "uncertain" }, inputs).ok).toBe(false));
});
