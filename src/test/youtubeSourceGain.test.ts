import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

Object.defineProperty(globalThis, "Deno", { value: { env: { get: () => "" } }, configurable: true });

const { compareYoutubeGain, trimDanglingLabels, youtubeRecleanGate, feedQuotas, stripSponsorSections, recurringUnitCounts, recurringFor, stripRecurringLines } = await import("../../supabase/functions/_shared/youtube-source-gain");
const { pickBest, needsReclean, sourceFingerprint } = await import("../../supabase/functions/_shared/best-text-source-policy");
const { planYoutubeReclean, sha256Hex, YOUTUBE_RECLEAN_METHOD } = await import("../../supabase/functions/_shared/best-text-source-core");

const ADSWIZZ_RSS = "Hosted by Simplecast, an AdsWizz company. See https://pcm.adswizz.com for information about our collection and use of personal data for advertising.";
const DELLA_YT = `A korábbi pénzügyminiszter szerint Ruff Bálint a Tisza-kormány erős embere. Vendégünk arról is beszélt, mi a hiba a kormányzat kiépítésével, valamint arról, hogy a klímaváltozás felperzselheti az euróbevezetési terveket.

00:00:00 Adáskezdés
00.01:59 Hőségpara: mennyit vesz el a gazdaság teljesítményéből?
00:08:23 Örülhetünk, ha idén a 1,5 százalékot eléri a GDP-növekedés?
00:11:07 A klímavédekezésre önálló költségvetési alapot kellene létrehozni?
00:43:32 Kremlinológia: ki most az erős ember a kormányban Magyar Péter mögött?

Hírek, cikkek:
https://24.hu

24 Extra:
https://24.hu/elofizetes

Közösség:
https://www.facebook.com/24ponthu
https://www.instagram.com/24ponthu

#24ponthu #hőség #gdp #euró #lászlócsaba #della`;

const RSS_GOOD = "Ebben az adásban a magyar gazdaság helyzetéről beszélgetünk vendégünkkel. Szóba kerül az infláció alakulása, a forint árfolyama és a költségvetési hiány is.";
const SPAM_YT = `Iratkozz fel a csatornára! https://youtube.com/@valami
Kövess minket Instagramon: https://instagram.com/valami
Facebook: https://facebook.com/valami
TikTok: https://tiktok.com/@valami
Spotify: https://open.spotify.com/show/1234567890abcdefghij
Apple Podcasts: https://podcasts.apple.com/hu/podcast/valami/id1234567890
Támogass minket: https://patreon.com/valami
Hívj meg egy kávéra: https://ko-fi.com/valami
#podcast #magyar #interju #gazdasag #politika #hirek #elemzes #beszelgetes`;

const ep = (description: string) => ({ id: "e1", podcast_id: "p1", title: "T", description });
const ytLink = (desc: string, over: Record<string, unknown> = {}) => ({
  id: "y1", youtube_description: desc, match_score: 0.85, confidence: "high", status: "confirmed",
  validation_reason: { policy: "youtube_episode_match_v3" }, ...over,
});
const CTRL = { youtube_min_confidence: 0.78 };

describe("verified YouTube informative-gain policy", () => {
  it("accepts a v3 confirmed YouTube description that adds topics and chapters over AdsWizz boilerplate", () => {
    const g = compareYoutubeGain(ADSWIZZ_RSS, DELLA_YT);
    expect(g.decision).toBe("youtube_better");
    expect(g.rss_boilerplate).toBe(true);
    expect(g.rss_info_len).toBe(0);
    expect(g.yt_chapters).toBeGreaterThanOrEqual(3);
    const best = pickBest(ep(ADSWIZZ_RSS), null, ytLink(DELLA_YT), null, null, CTRL);
    expect(best?.source_type).toBe("youtube");
    expect(best?.evidence.youtube_gain.decision).toBe("youtube_better");
  });

  it("rejects non-v3, unconfirmed or low-score YouTube matches", () => {
    for (const over of [{ validation_reason: { policy: "youtube_episode_match_v2" } }, { status: "candidate" }, { match_score: 0.7 }]) {
      const best = pickBest(ep(ADSWIZZ_RSS), null, ytLink(DELLA_YT, over), null, null, CTRL);
      expect(best?.source_type).toBe("rss");
    }
  });

  it("treats a link/CTA/hashtag-only YouTube description as spam even when it is much longer", () => {
    expect(SPAM_YT.length).toBeGreaterThan(RSS_GOOD.length + 300);
    expect(compareYoutubeGain(RSS_GOOD, SPAM_YT).decision).toBe("youtube_spam_only");
    const best = pickBest(ep(RSS_GOOD), null, ytLink(SPAM_YT), null, null, CTRL);
    expect(best?.source_type).toBe("rss");
    expect(best?.evidence.youtube_gain.decision).toBe("youtube_spam_only");
  });

  it("does not count a YouTube copy of the RSS text plus links as a gain", () => {
    const yt = `${RSS_GOOD}\n\nKövess minket: https://facebook.com/x\nhttps://instagram.com/x\nhttps://open.spotify.com/show/x\n#gazdasag #inflacio #forint #koltsegvetes`;
    const g = compareYoutubeGain(RSS_GOOD, yt);
    expect(g.decision).toBe("youtube_no_gain");
    expect(g.yt_novel_chars).toBe(0);
  });

  it("keeps RSS when it carries substantial content the YouTube text lacks", () => {
    const rss = "A második részben a lakáspiac jövőjéről, a CSOK Plusz hatásairól és a bérleti díjak emelkedéséről kérdeztük a szakértőt. Elmondta azt is, miért drágulnak tovább a vidéki ingatlanok, és mire számíthatnak az első lakásvásárlók jövőre.";
    const g = compareYoutubeGain(rss, DELLA_YT);
    expect(g.decision).toBe("rss_has_unique_content");
    expect(pickBest(ep(rss), null, ytLink(DELLA_YT), null, null, CTRL)?.source_type).toBe("rss");
  });

  it("rejects an English YouTube description for a Hungarian episode", () => {
    const en = "In this episode we talk about the economy and the future of the region. Our guest explains why the markets are nervous and what this means for you. We also discuss the role of the central bank in the next year and the risks for the currency.";
    expect(compareYoutubeGain(ADSWIZZ_RSS, en).decision).toBe("youtube_language_mismatch");
  });

  it("re-marks a stale YouTube selection when the link is no longer verified", () => {
    const best = pickBest(ep(ADSWIZZ_RSS), null, ytLink(DELLA_YT, { status: "rejected" }), null, null, CTRL);
    expect(best?.source_type).toBe("rss");
    expect(needsReclean({ source_type: "youtube", raw_text: DELLA_YT }, best!)).toBe(true);
  });

  it("prefers a verified YouTube description over a thin-RSS transcript and keeps transcript rights index-only", () => {
    const transcript = { id: "t1", status: "ok", transcript: "szó ".repeat(600) + "beszélgetés a gazdaságról és politikáról, hosszú átirat.", model: "supadata-youtube", rights_status: "rss_public_index_only", content_hash: "h" };
    const best = pickBest(ep(ADSWIZZ_RSS), null, ytLink(DELLA_YT), null, transcript, CTRL);
    expect(best?.source_type).toBe("youtube");
    expect(best?.evidence.transcript_available?.public_display).toBe(false);
  });

  it("produces a stable fingerprint for an unchanged selection (idempotent cron runs)", async () => {
    const a = pickBest(ep(ADSWIZZ_RSS), null, ytLink(DELLA_YT), null, null, CTRL)!;
    const b = pickBest(ep(ADSWIZZ_RSS), null, ytLink(DELLA_YT), null, null, CTRL)!;
    expect(await sourceFingerprint(a)).toBe(await sourceFingerprint(b));
  });
});

describe("YouTube clean-text helpers", () => {
  it("drops empty section labels but keeps labels that introduce content", () => {
    const t = trimDanglingLabels("Bevezető mondat a témáról.\nTémák:\nInfláció és forint.\nHírek, cikkek:\n\n24 Extra:");
    expect(t).toBe("Bevezető mondat a témáról.\nTémák:\nInfláció és forint.");
  });

  it("blocks a re-clean that would lose prior content and allows one that replaces boilerplate", () => {
    const prior = "A második részben a lakáspiac jövőjéről, a CSOK Plusz hatásairól és a bérleti díjak emelkedéséről kérdeztük a szakértőt részletesen.";
    expect(youtubeRecleanGate(prior, DELLA_YT.split("\n\nHírek")[0]).reasons).toContain("would_lose_prior_content");
    const ok = youtubeRecleanGate("Hosted by Simplecast, an AdsWizz company. See for information about our collection and use of personal data for advertising.", DELLA_YT.split("\n\nHírek")[0]);
    expect(ok.ok).toBe(true);
  });

  it("removes sponsor sections and coupon lines and does not count them as information", () => {
    const yt = "Itt van a szépségipar legjobb névjegykártyája!\nTámogatóink ebben az epizódban:\nPierrederm\nA PierreDerm a Biofor kozmetikai márka kizárólagos magyar forgalmazója.\n\nA beszélgetésben a szalonok digitalizációjáról, az árazásról és a vendégmegtartásról is szó esik.\nKuponkód: SZALON10 – 10% kedvezmény";
    const out = stripSponsorSections(yt);
    expect(out).not.toMatch(/PierreDerm|Kuponkód|Támogatóink/);
    expect(out).toContain("szalonok digitalizációjáról");
    const promo = stripSponsorSections("A túlgondolást és a masterclasst csak egy hajszál választja el.\nVegyél bármilyen SodaStream terméket és töltsd fel a vásárlást igazoló számlát a lenti linkre:\nMég egyszer a játékhoz szükséges link:\n#ingatlan");
    expect(promo).toBe("A túlgondolást és a masterclasst csak egy hajszál választja el.");
    const g = compareYoutubeGain("Rövid leírás.", "Támogatóink:\nA PierreDerm a Biofor kozmetikai márka kizárólagos magyar forgalmazója, a PierreWax szakmai termékek tulajdonosa, kérd a szalonodban, és nézd meg a teljes kínálatot.");
    expect(g.decision).toBe("youtube_spam_only");
  });

  it("does not count a sponsor block repeated across the podcast's other episodes as new information", () => {
    const ad = "A PierreDerm a Biofor kozmetikai márka kizárólagos magyar forgalmazója, a PierreWax szakmai szőrtelenítési termékek tulajdonosa.";
    const other = (i: number) => `Ebben a részben a ${i}. vendégünkkel a szalonvezetésről beszélgetünk.\n${ad}`;
    const counts = recurringUnitCounts([other(1), other(2), other(3), other(4)]);
    const yt = `Rövid bevezető a mai adásról és a vendégről.\n${ad}`;
    const rec = recurringFor(counts, yt);
    expect(compareYoutubeGain("Rövid bevezető.", yt, { recurring: rec }).decision).not.toBe("youtube_better");
    expect(stripRecurringLines(yt, rec)).not.toContain("PierreDerm");
    // A unit only this episode has is never treated as recurring.
    expect(recurringFor(counts, yt).has("rovid bevezeto a mai adasrol es a vendegrol")).toBe(false);
  });

  it("does not drop informative sentences that merely mention availability", () => {
    const yt = "Szó esik a gyógyszerek elérhetőségéről a vidéki patikákban, a hiány okairól és arról, mit tehetnek a betegek. A szakértő szerint a következő hónapokban javulhat a helyzet, de a kis települések továbbra is hátrányban maradnak.";
    expect(compareYoutubeGain("Rövid.", yt).yt_info_len).toBeGreaterThan(150);
  });

  it("gives the YouTube feed the largest share and stays within the batch limit", () => {
    const q = feedQuotas(40, null, ["transcript", "youtube", "article", "spotify"]);
    expect(q.youtube).toBe(20);
    expect(Object.values(q).reduce((s, n) => s + n, 0)).toBeLessThanOrEqual(40);
  });
});

function fakeAdmin(tables: Record<string, any[]>) {
  return {
    from(t: string) {
      const rows = tables[t] || [];
      const q: any = { select: () => q, in: () => q, is: () => q, eq: () => q, then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej) };
      return q;
    },
  };
}

describe("verified YouTube re-clean planner", () => {
  const cand = { episode_id: "e1", raw_text: DELLA_YT, source_fingerprint: "fp1", evidence: {} };
  const boiler = "Hosted by Simplecast, an AdsWizz company. See for information about our collection and use of personal data for advertising.";

  it("plans a backed-up CAS item whose expected hashes match the current row", async () => {
    const admin = fakeAdmin({
      episode_clean_text: [{ episode_id: "e1", cleaned_text: boiler, source_hash: "old", cleaner_method: "deterministic_v4" }],
      episodes: [{ id: "e1", clean_text_status: "done" }],
    });
    const [p] = await planYoutubeReclean(admin, [cand]);
    expect(p.outcome).toBe("apply");
    // deterministic_v4 drops timestamp lines; the extract-only path keeps chapter topics.
    expect(p.item.cleaner_method).toBe(`${YOUTUBE_RECLEAN_METHOD}+rescue_v1`);
    expect(p.item.expected_source_hash).toBe("old");
    expect(p.item.expected_cleaned_sha256).toBe(await sha256Hex(boiler));
    expect(p.item.cleaned_text).not.toMatch(/https?:\/\/|Hírek, cikkek:/);
    expect(p.item.cleaned_text).toContain("00:43:32 Kremlinológia");
  });

  it("is a no-op when the same source hash is already live (idempotent retry)", async () => {
    const hash = await sha256Hex(`${YOUTUBE_RECLEAN_METHOD}+rescue_v1::${DELLA_YT}`);
    const admin = fakeAdmin({
      episode_clean_text: [{ episode_id: "e1", cleaned_text: "x", source_hash: hash, cleaner_method: `${YOUTUBE_RECLEAN_METHOD}+rescue_v1` }],
      episodes: [{ id: "e1", clean_text_status: "done" }],
    });
    expect((await planYoutubeReclean(admin, [cand]))[0].outcome).toBe("noop_same");
  });

  it("leaves episodes the clean-text runner is processing and protects earlier repair batches", async () => {
    const pending = fakeAdmin({ episode_clean_text: [], episodes: [{ id: "e1", clean_text_status: "pending" }] });
    expect((await planYoutubeReclean(pending, [cand]))[0].reasons[0]).toMatch(/runner_owns/);
    const repaired = fakeAdmin({ episode_clean_text: [], episodes: [{ id: "e1", clean_text_status: "done" }], episode_clean_text_repair_backups: [{ episode_id: "e1" }] });
    expect((await planYoutubeReclean(repaired, [cand]))[0].reasons).toContain("protected_prior_repair_batch");
  });

  it("rejects a spam-only YouTube text instead of writing it", async () => {
    const admin = fakeAdmin({ episode_clean_text: [{ episode_id: "e1", cleaned_text: RSS_GOOD, source_hash: "old" }], episodes: [{ id: "e1", clean_text_status: "done" }] });
    expect((await planYoutubeReclean(admin, [{ ...cand, raw_text: SPAM_YT }]))[0].outcome).toBe("reject");
  });
});

describe("best-source runner progress", () => {
  it("copies explicit ids so incremental runs advance their cursors", () => {
    const src = readFileSync("supabase/functions/episode-best-text-source-runner/index.ts", "utf8");
    expect(src).toContain("const targetIds: string[] = [...explicitIds];");
    expect(src).not.toMatch(/let targetIds: string\[\] = ids;/);
    expect(src).toContain("runs_failed");
  });
});

describe("YouTube engagement CTA and empty link labels", () => {
  it("drops like/comment/subscribe lines and labels whose links were removed", async () => {
    const { cleanYoutubeDescription } = await import("../../supabase/functions/_shared/best-text-source-core");
    const raw = "A filmes év legfontosabb trendjeit és kedvenceinket beszéltük át részletesen, a mozis és a streaminges premierekkel együtt, egyéni ötös listákkal.\n\nBővebben a Mickey 17-ről (és más sci-fikről): https://example.hu/a\nBővebben az F1-ről: https://example.hu/b\n\n👍 Likeold a videót\n💬 Írd meg kommentben, mit gondolsz\nÍrd meg kommentben, te hogyan látod a témát.\n🔔 Iratkozz fel a csatornára!";
    const r = cleanYoutubeDescription(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.text).toContain("egyéni ötös listákkal");
    expect(r.text).not.toMatch(/Likeold|kommentben|Iratkozz|Bővebben az F1-ről:/i);
  });
});
