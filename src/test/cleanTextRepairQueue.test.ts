import { describe, expect, it } from "vitest";

(globalThis as any).Deno ??= { env: { get: () => "" } };
const { resolveRejectedPlan, autoApplySafetyReasons, backoffSeconds } = await import("../../supabase/functions/_shared/clean-text-repair-queue");
const { planRssRepair } = await import("../../supabase/functions/_shared/clean-text-rss-repair");

const plan = (reasons: string[], prior_len = 0) => ({
  episode_id: "e", outcome: "reject" as const, reasons, prior_len, next_len: 0, prior_method: null, lost_from_source: [], preview: "",
});

describe("repair queue: every rejected plan reaches a finite state", () => {
  it("source-less and show-boilerplate episodes are terminal, not retried", () => {
    expect(resolveRejectedPlan(plan(["no_rss_source"])).status).toBe("no_substantive_source");
    expect(resolveRejectedPlan(plan(["show_level_boilerplate_description"])).status).toBe("no_substantive_source");
    expect(resolveRejectedPlan(plan(["decision_skip_no_content", "no_substantive_source_content"])).status).toBe("no_substantive_source");
  });
  it("reviewed/backed-up rows and other source lanes are protected", () => {
    expect(resolveRejectedPlan(plan(["protected_prior_repair"], 300)).status).toBe("protected");
    expect(resolveRejectedPlan(plan(["prior_alt_source_kept"], 300)).status).toBe("protected");
    expect(resolveRejectedPlan(plan(["best_source_spotify_own_lane"])).status).toBe("protected");
  });
  it("new episodes still owned by the cleaner are retried later, not taken over", () => {
    const r = resolveRejectedPlan(plan(["clean_text_status_pending_runner_owns"]));
    expect(r.status).toBe("retry");
    expect(r.retry_after_seconds).toBe(3600);
  });
  it("existing text with no informative RSS gain is kept and finished", () => {
    expect(resolveRejectedPlan(plan(["no_added_names_or_timecodes", "insufficient_information_gain"], 120))).toEqual({ status: "done", outcome: "kept_prior_no_gain" });
  });
  it("a repair that would drop names already in the text needs a human", () => {
    expect(resolveRejectedPlan(plan(["would_lose_prior_names"], 200)).status).toBe("needs_review");
  });
  it("an unsafe cleaner output on an empty row is quarantined", () => {
    expect(resolveRejectedPlan(plan(["verdict_invalid", "residual_url"])).status).toBe("quarantine");
  });
});

describe("unattended apply gate", () => {
  it("passes ordinary Hungarian episode notes", () => {
    expect(autoApplySafetyReasons("Vendégünk Kiss Péter, akivel a magyar vasút jövőjéről és az uniós pénzekről beszélgettünk, sok érdekes részlettel.")).toEqual([]);
  });
  it("holds back English legal notices, bank details and short ads", () => {
    expect(autoApplySafetyReasons("This podcast is provided for information only and is not investment advice. All opinions are those of the hosts and you should consult your advisor.")).toContain("auto_gate_mostly_english");
    expect(autoApplySafetyReasons("Támogass minket: 11773016-01234567-00000000 számlaszámon, köszönjük a segítséget mindenkinek.")).toContain("auto_gate_bank_details");
    expect(autoApplySafetyReasons("Használd a PODI10 kuponkódot 10% kedvezményért!")).toContain("auto_gate_short_ad");
  });
  it("retry backoff grows and is capped", () => {
    expect(backoffSeconds(1)).toBe(600);
    expect(backoffSeconds(2)).toBe(1800);
    expect(backoffSeconds(20)).toBe(86400);
  });
});

describe("planner + queue: names and timecodes survive, protected rows untouched", () => {
  const RSS = "Vendégünk Szabó László, a klub elnöke. Ebben a részben a vasútról és az uniós pénzekről beszélgettünk hosszan, sok kérdéssel és még több történettel.\n0:42 Bezzeg a bangkoki vonatok!\n2:30 Mikor jön már a szezonalitás?\n5:30 Mindjárt meglesz az EU pénz?\nKövess minket: https://facebook.com/x";
  const base = { episode_id: "00000000-0000-0000-0000-000000000009", description: RSS, summary: null, clean_text_status: "done", best_source_type: null, current_source_hash: "h", current_cleaned_text: "", current_cleaner_method: "deterministic_v4", has_clean_row: true, active_backups: 0 };
  it("an empty row gets link-free text with the guest and chapter timecodes, passing the gate", async () => {
    const p = await planRssRepair(base);
    expect(p.outcome).toBe("apply");
    const text = String(p.item!.cleaned_text);
    expect(text).toContain("Szabó László");
    expect(text).toContain("2:30");
    expect(text).not.toMatch(/https?:\/\//);
    expect(autoApplySafetyReasons(text)).toEqual([]);
  });
  it("a row with an active backup (reviewed canary) is protected", async () => {
    const p = await planRssRepair({ ...base, active_backups: 1 });
    expect(resolveRejectedPlan(p).status).toBe("protected");
  });
  it("re-planning the same source yields the same hash (idempotent)", async () => {
    const a = await planRssRepair(base), b = await planRssRepair(base);
    expect(a.item!.source_hash).toBe(b.item!.source_hash);
  });
});

describe("tag walls and timecodes", async () => {
  const { stripHashtagWalls, decideCleanText } = await import("../../supabase/functions/_shared/clean-text-validation");
  it("removes a leading hashtag wall and keeps the glued first word", () => {
    expect(stripHashtagWalls("#TudatosTörténetek #Podcast #SajátUtad #ÖnismeretMi történik, amikor rájössz?")).toBe("Mi történik, amikor rájössz?");
  });
  it("keeps a single disclosure tag and an unglued sentence start", () => {
    expect(stripHashtagWalls("#hirdetés A beszélgetés támogatója a SANOFI.")).toBe("#hirdetés A beszélgetés támogatója a SANOFI.");
    expect(stripHashtagWalls("#Yettel #Kibontó #DemjánSándorProgram Mi kell ahhoz?")).toBe("Mi kell ahhoz?");
  });
  it("removes a trailing hashtag wall", () => {
    expect(stripHashtagWalls("Vendégünk Kiss Anna, a témáról beszélgettünk.\n#podcast #interjú #magyar #élet")).toBe("Vendégünk Kiss Anna, a témáról beszélgettünk.");
  });
  it("new-episode cleaning also drops tag walls", () => {
    const d = decideCleanText({ raw: "#a1 #b2 #c3 #d4 Vendégünk Kiss Anna, akivel a magyar vasút jövőjéről és az uniós pénzekről beszélgettünk hosszan, sok érdekes történettel." });
    expect(d.action).toBe("write");
    expect((d as any).text.startsWith("Vendégünk Kiss Anna")).toBe(true);
  });
  it("a repair that loses chapter timecodes waits for review", () => {
    expect(autoApplySafetyReasons("Rendes magyar szöveg a témáról, vendéggel és sok érdekes részlettel.", ["00:19", "Demján"])).toContain("auto_gate_lost_timecodes");
  });
});

describe("link residue and CTA lead-ins", async () => {
  const { stripTrailingLinkLabels, decideCleanText } = await import("../../supabase/functions/_shared/clean-text-validation");
  it("drops trailing labels whose links were removed, keeps the sentence", () => {
    expect(stripTrailingLinkLabels("Végül egy osztálytalálkozó és ráhangolódás az év végére. Jó szórakozást! Instagram : Blog : Facebook : Ezt ittuk : :(")).toBe("Végül egy osztálytalálkozó és ráhangolódás az év végére. Jó szórakozást!");
  });
  it("keeps a single trailing label and real sentences", () => {
    const t = "Ebben a részben a vasútról beszélgettünk hosszan, sok történettel. Vendég:";
    expect(stripTrailingLinkLabels(t)).toBe(t);
  });
  it("keeps the episode content after a short Patreon lead-in", () => {
    const raw = "Patreon támogatóink számára elérhető előzetes tartalmából: Fiat Stilo ablakemelő cserével kezdünk, és körbejárjuk, hogy miért is tud tönkre menni (akár egy Hondán is). A Satuna légterelő jó vagy sem? Szellőző rendszerek hibái, majd Ford Mondeo lökhárító beszerzésének nehézségei. Jó szórakozást! Instagram : https://instagram.com/x Blog : https://x.blog.hu";
    const d = decideCleanText({ raw });
    expect(d.action).toBe("write");
    expect((d as any).text).toContain("Fiat Stilo");
    expect((d as any).text).not.toMatch(/Instagram :|Blog :/);
  });
});

describe("show-level recurring boilerplate", async () => {
  const { recurringSentenceKeys, stripRecurringSentences } = await import("../../supabase/functions/_shared/clean-text-repair-queue");
  const { unitKey } = await import("../../supabase/functions/_shared/youtube-source-gain");
  const tagline = "Valószínűleg az első romániai magyar nyelvű podcast csatorna.";
  const others = [
    `${tagline} Vendég: Nagy Éva. Műsorvezető: Kiss Lóránt. Az erdélyi oktatásról beszélgettünk.`,
    `${tagline} Vendég: Szabó Ádám. Műsorvezető: Kiss Lóránt. A borászat jövőjéről volt szó.`,
    `${tagline} Vendég: Tóth Anna. Műsorvezető: Kiss Lóránt. A kolozsvári színházról meséltünk.`,
  ];
  const rec = recurringSentenceKeys(others, unitKey, 2);
  it("removes the channel tagline but keeps host credit and episode content", () => {
    const out = stripRecurringSentences(`${tagline} Vendég: Maior Enikő. Műsorvezető: Kiss Lóránt. A PKE egyetem alumni programjáról beszélgettünk.`, rec, unitKey);
    expect(out).not.toContain("romániai magyar nyelvű podcast csatorna");
    expect(out).toContain("Műsorvezető: Kiss Lóránt");
    expect(out).toContain("Maior Enikő");
  });
  it("never empties a text that is only boilerplate", () => {
    expect(stripRecurringSentences(tagline, rec, unitKey)).toBe(tagline);
  });
});

describe("cleaning stays fast on separator-heavy notes", async () => {
  const { decideCleanText } = await import("../../supabase/functions/_shared/clean-text-validation");
  it("a description with long dash separators and links is decided in well under a second", () => {
    const raw = "Úgy volt, hogy nem is lesz ma adás, de megjöttek a vendégek, Kollár Kinga is, és a vízügy sem maradt ki a beszélgetésből. " + "-".repeat(49) + " Itt megtaláltok minket: https://example.hu/ IBAN: LT72 3250 " + "-".repeat(49) + " ► Facebook: https://facebook.com/x ► Spotify: https://open.spotify.com/show/x";
    const t = performance.now();
    decideCleanText({ raw });
    expect(performance.now() - t).toBeLessThan(300);
  });
});
