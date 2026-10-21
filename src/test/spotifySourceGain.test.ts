import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

Object.defineProperty(globalThis, "Deno", { value: { env: { get: () => "" } }, configurable: true });

const { compareSpotifyGain, spotifyMatchVerified, stripSpotifyBoilerplate, SPOTIFY_RIGHTS_STATUS } = await import("../../supabase/functions/_shared/spotify-source-gain");
const { pickBest } = await import("../../supabase/functions/_shared/best-text-source-policy");
const { planSpotifyReclean, classifyBackups, sha256Hex, SPOTIFY_RECLEAN_METHOD, YOUTUBE_RECLEAN_METHOD, PROTECTED_REPAIR_BATCHES } = await import("../../supabase/functions/_shared/best-text-source-core");
const { laneBudgets, spotifyRecleanAllowance } = await import("../../supabase/functions/_shared/best-text-source-lanes");

function fakeAdmin(tables: Record<string, any[]>) {
  return {
    from(t: string) {
      const rows = tables[t] || [];
      const q: any = { select: () => q, in: () => q, is: () => q, eq: () => q, order: () => q, limit: () => q, then: (res: any, rej: any) => Promise.resolve({ data: rows, error: null }).then(res, rej) };
      return q;
    },
  };
}

// RSS copy cut by the importer; Spotify has the publisher's full show notes.
const RSS = "Ebben az adásban a magyar gazdaság helyzetéről beszélgetünk vendégünkkel, Kovács Péter közgazdásszal. Szóba kerül az infláció alakulása és a költségvetési hiány is.";
const SP_FULL = `${RSS}
A második részben a lakáspiac és a hitelkamatok várható alakulásáról van szó, konkrét számokkal és előrejelzésekkel.
Végül a forint árfolyamáról és a jegybank következő lépéseiről kérdeztük a vendéget, aki szerint az év végéig nem várható fordulat.`;
const DONATION_TAIL = `${RSS}
Legyen a patronálónk, és a támogatása mértékétől függően egyre több előnyhöz juthat: egyszeri vagy rendszeres banki átutalással is segíthet. Számlaszám: OTP Bank 11707062-21446081. Akármilyen formában támogatja munkánkat, köszönjük!
A podcast tartalma kizárólag általános tájékoztatásra szolgál, nem minősül befektetési tanácsadásnak.`;
const ep = (over: any = {}) => ({ id: "e1", podcast_id: "p1", title: "Adás", description: RSS, podcasts: { language_decision: "accept_hungarian", spotify_match_confidence: 1 }, ...over });
const spRow = (desc: string, over: any = {}) => ({ id: "s1", episode_id: "e1", spotify_description: desc, spotify_html_description: null, match_confidence: 0.95, match_method: "name_date", ...over });

describe("Spotify vs RSS informative-content comparison", () => {
  it("prefers publisher show notes that contain all RSS facts and add real information", () => {
    const g = compareSpotifyGain(RSS, SP_FULL);
    expect(g.decision).toBe("spotify_better");
    expect(g.reasons).toContain("spotify_superset_of_rss");
  });
  it("does not count donation, bank details or legal disclaimers as information", () => {
    expect(compareSpotifyGain(RSS, DONATION_TAIL).decision).toBe("spotify_no_gain");
    expect(stripSpotifyBoilerplate(DONATION_TAIL)).not.toMatch(/Számlaszám|tanácsadásnak|patronálónk/);
  });
  it("drops listening CTAs, back-catalogue lists, sponsor thanks and registration promos", () => {
    const promo = [
      "A műsor meghallgatható a 444 Spotify - és Apple Podcast -csatornáján is, az eddigi részek:",
      "#1 Kedvenc könyveink korábbi életszakaszainkból #2 Miért szeretjük annyira a skandináv irodalmat?",
      "#3 Mit tud kezdeni az irodalom a magyar politikával?",
      "🎧 Hallgass Átlátszót!",
      "Addig is további könyves tartalmakért ajánljuk Anna Instagramját.",
      "Köszönet a napszemüvegért a cégnek. Köszönjük a Primus Labor támogatását.",
      "Primus Labor - természetes immunerősítés és tanácsok a -n történő bejelentkezéssel.",
      "Részletek és regisztráció: Jelentkezzen május 29-i képzésünkre!",
    ].join("\n");
    const kept = "A vendég Szabó Magda életművéről és a Für Elise születéséről beszélt.";
    const out = stripSpotifyBoilerplate(`${kept}\n${promo}`);
    expect(out).toBe(kept);
    expect(stripSpotifyBoilerplate(`${kept}\nIratkozzon fel a csatornánkra Spotify-on!A HVG podcastjait külön is megtalálja.`)).toBe(`${kept}\nA HVG podcastjait külön is megtalálja.`);
    // Topic sentences that merely contain such words stay.
    const topic = "35:07 Miért állt le nyáron négy hónapra a regisztráció? N. Kósa Judit új sorozattal jelentkezik.";
    expect(stripSpotifyBoilerplate(topic)).toBe(topic);
  });
  it("keeps RSS when Spotify drops facts the RSS has", () => {
    const sp = "A lakáspiac és a hitelkamatok várható alakulásáról van szó, konkrét számokkal és előrejelzésekkel. Végül a forint árfolyamáról és a jegybank következő lépéseiről kérdeztük a vendéget, aki szerint az év végéig nem várható fordulat.";
    expect(compareSpotifyGain(RSS, sp).decision).toBe("rss_has_unique_content");
  });
  it("ignores blocks that recur across the show's other descriptions", () => {
    const tail = "A második részben a lakáspiac és a hitelkamatok várható alakulásáról van szó, konkrét számokkal és előrejelzésekkel.";
    const recurring = new Set([tail].map((u) => u.toLowerCase().normalize("NFD").replace(/\p{M}+/gu, "").split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1 || /\d/.test(t)).join(" ")));
    expect(compareSpotifyGain(RSS, `${RSS}\n${tail}`, { recurring }).decision).not.toBe("spotify_better");
  });
  it("accepts real notes when the RSS is empty, rejects English notes", () => {
    const guests = "Bátonyi Péter művészettörténész – a műemlékvédelmi bírságról. Tóth Zoltán választási szakértő – a törvényelőkészítő egyeztetésekről. Tanács Zoltán miniszter – a feljelentésről a Gondosóra program ügyében.";
    expect(compareSpotifyGain("", guests).decision).toBe("spotify_better");
    const en = "In this episode we talk about the evolving IT labor market in Central and Eastern Europe with the founders of two recruitment companies and the CMO of a job board, and we discuss what this means for you and for the future of our work.";
    expect(compareSpotifyGain("", en).decision).toBe("spotify_language_mismatch");
  });
  it("compares only confident episode AND show matches", () => {
    expect(spotifyMatchVerified(spRow(SP_FULL), 1).ok).toBe(true);
    expect(spotifyMatchVerified(spRow(SP_FULL, { match_confidence: 0.6 }), 1).ok).toBe(false);
    expect(spotifyMatchVerified(spRow(SP_FULL), 0.6).ok).toBe(false);
    expect(spotifyMatchVerified(spRow(SP_FULL, { match_method: "title_only" }), 1).ok).toBe(false);
  });
});

describe("best-source selection with Spotify", () => {
  const YT = { id: "y1", youtube_description: `${RSS}\n\n00:00 Bevezetés\n05:12 Infláció és kamatdöntések a jegybanknál\n21:40 A forint árfolyama és a költségvetés tervezete\n35:10 Lakáspiac, hitelek és a fiatalok helyzete\nA vendég részletesen elemezte a régiós versenytársak helyzetét is, sok konkrét adattal.`, match_score: 0.9, confidence: "strict_auto", status: "confirmed", validation_reason: { policy: "youtube_episode_match_v3" } };
  it("selects verified Spotify notes over RSS, internal-only", () => {
    const b = pickBest(ep(), spRow(SP_FULL), null, null, null, {});
    expect(b?.source_type).toBe("spotify");
    expect(b?.evidence.rights_status).toBe(SPOTIFY_RIGHTS_STATUS);
    expect(b?.evidence.public_display).toBe(false);
  });
  it("never selects Spotify on raw length alone", () => {
    const b = pickBest(ep(), spRow(DONATION_TAIL + "\n" + "Kövess minket! ".repeat(40)), null, null, null, {});
    expect(b?.source_type).toBe("rss");
    expect(b?.evidence.spotify_gain.decision).not.toBe("spotify_better");
  });
  it("does not use Spotify when the show match is weak", () => {
    expect(pickBest(ep({ podcasts: { spotify_match_confidence: 0.6 } }), spRow(SP_FULL), null, null, null, {})?.source_type).toBe("rss");
  });
  it("a verified informative YouTube source still wins over Spotify", () => {
    expect(pickBest(ep(), spRow(SP_FULL), YT, null, null, {})?.source_type).toBe("youtube");
  });
});

describe("Spotify re-clean planner (backed up, never overwrites protected text)", () => {
  const cand = { episode_id: "e1", podcast_id: "p1", raw_text: SP_FULL, source_fingerprint: "fp", evidence: {} };
  const base = (over: any = {}) => fakeAdmin({
    episode_clean_text: [{ episode_id: "e1", cleaned_text: RSS, source_hash: "rss", cleaner_method: "deterministic_v4" }],
    episodes: [{ id: "e1", clean_text_status: "done" }],
    episode_clean_text_repair_backups: [],
    episode_spotify_meta: [],
    ...over,
  });
  it("applies when the prior text is kept and information is added", async () => {
    const [p] = await planSpotifyReclean(base(), [cand]);
    expect(p.outcome).toBe("apply");
    expect(p.item.source_type).toBe("spotify");
    expect(p.item.cleaner_method.startsWith(SPOTIFY_RECLEAN_METHOD)).toBe(true);
    expect(p.item.expected_source_hash).toBe("rss");
    expect(p.item.cleaned_text).toContain("Kovács Péter");
    expect(p.item.cleaned_text).toContain("jegybank");
  });
  it("is idempotent on the same source", async () => {
    const [first] = await planSpotifyReclean(base(), [cand]);
    const hash = await sha256Hex(`${first.item.cleaner_method}::${SP_FULL}`);
    const admin = base({ episode_clean_text: [{ episode_id: "e1", cleaned_text: first.item.cleaned_text, source_hash: hash, cleaner_method: first.item.cleaner_method }] });
    expect((await planSpotifyReclean(admin, [cand]))[0].outcome).toBe("noop_same");
  });
  it("never touches the reviewed canaries, YouTube-derived or runner-owned text", async () => {
    const canary = base({ episode_clean_text_repair_backups: [{ episode_id: "e1", batch_id: PROTECTED_REPAIR_BATCHES[0], new_cleaner_method: "deterministic_v4" }] });
    expect((await planSpotifyReclean(canary, [cand]))[0].reasons).toContain("protected_prior_repair_batch");
    const yt = base({ episode_clean_text: [{ episode_id: "e1", cleaned_text: RSS, source_hash: "y", cleaner_method: `${YOUTUBE_RECLEAN_METHOD}+rescue_v1` }] });
    expect((await planSpotifyReclean(yt, [cand]))[0].reasons).toContain("prior_youtube_derived_kept");
    const ytAuto = base({ episode_clean_text_repair_backups: [{ episode_id: "e1", batch_id: "b", new_cleaner_method: YOUTUBE_RECLEAN_METHOD }] });
    expect((await planSpotifyReclean(ytAuto, [cand]))[0].outcome).toBe("reject");
    const pending = base({ episodes: [{ id: "e1", clean_text_status: "pending" }] });
    expect((await planSpotifyReclean(pending, [cand]))[0].reasons).toContain("clean_text_status_pending_runner_owns");
  });
  it("rejects a Spotify text that would lose prior clean-text content", async () => {
    const prior = `${RSS}\nA műsor végén a hallgatói kérdésekre válaszolt a vendég a nyugdíjrendszerről és az egészségügyről, hosszan és részletesen kifejtve.`;
    const admin = base({ episode_clean_text: [{ episode_id: "e1", cleaned_text: prior, source_hash: "rss", cleaner_method: "deterministic_v4" }] });
    expect((await planSpotifyReclean(admin, [cand]))[0].outcome).toBe("reject");
  });
  it("Spotify automatic backups do not block a later verified YouTube re-clean", () => {
    const c = classifyBackups([{ episode_id: "e1", batch_id: "auto", new_cleaner_method: SPOTIFY_RECLEAN_METHOD }]);
    expect(c.get("e1")).toEqual({ protected: false, autoYoutube: false, autoSpotify: true });
  });
});

describe("Spotify lanes and caps", () => {
  it("staged Spotify backfill is off by default and bounded inside the 60-episode call", () => {
    expect(laneBudgets(40, {}).spotifyBackfill).toBe(0);
    const b = laneBudgets(40, { spotify_backfill_enabled: true });
    expect(b.spotifyBackfill).toBe(10);
    expect(b.fast + b.backfill + b.feedMin + b.spotifyBackfill).toBeLessThanOrEqual(60);
  });
  it("Spotify re-clean has its own per-run limit and daily cap (default off)", () => {
    expect(spotifyRecleanAllowance({}, 0).allowed).toBe(0);
    expect(spotifyRecleanAllowance({ spotify_reclean_enabled: true }, 0).allowed).toBe(0);
    const ctrl = { spotify_reclean_enabled: true, spotify_reclean_daily_cap: 60, spotify_reclean_per_run: 5 };
    expect(spotifyRecleanAllowance(ctrl, 0).allowed).toBe(5);
    expect(spotifyRecleanAllowance(ctrl, 58).allowed).toBe(2);
    expect(spotifyRecleanAllowance(ctrl, 60).allowed).toBe(0);
  });
});

describe("Spotify ingestion wiring", () => {
  const show = readFileSync("supabase/functions/spotify-show-enricher/index.ts", "utf8");
  const matcher = readFileSync("supabase/functions/spotify-episode-matcher/index.ts", "utf8");
  it("records duplicate shows instead of silently re-searching them every run", () => {
    expect(show).toContain('upErr.code === "23505"');
    expect(show).toContain('spotify_match_status: "duplicate_show"');
    expect(show).toContain("not.in.(no_match,duplicate_show)");
  });
  it("backs off failed show fetches and keeps cooldown state when writing telemetry", () => {
    expect(show).toContain("retryCutoff");
    expect(show).toContain("patchState(supabase, { last_show_run");
    expect(matcher).toContain("patchState(supabase, { last_episode_run");
  });
  it("syncs episodes incrementally (stops after already-paired pages)", () => {
    expect(matcher).toContain("KNOWN_PAGES_STOP");
    expect(matcher).toContain("summary.early_stops++");
  });
});
