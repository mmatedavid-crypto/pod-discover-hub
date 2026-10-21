import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

Object.defineProperty(globalThis, "Deno", { value: { env: { get: () => "" } }, configurable: true });

const { decideCleanText, validateCleanOutput, conservativeRescueClean } = await import("../../supabase/functions/_shared/clean-text-validation");
const { heuristicClean, validateExtractOnlyTrim } = await import("../../supabase/functions/_shared/episode-text-cleaner");
const { pickBest, needsReclean, sourceFingerprint } = await import("../../supabase/functions/_shared/best-text-source-policy");

const CREDIT_LED =
  "Szerkesztő: Belényi BarbaraMiért álmodunk? Miről álmodunk? Vajon mindig álmodunk, csak nem emlékszünk rá? Miért van az, hogy valaki semmit nem tud felidézni, miközben mások folytatásos történetet szőnek az álmaikból? Mit kezdjünk a rémálmokkal? És mit a visszatérőkkel? Mit üzennek az álmaink? Jó-e ha megpróbáljuk irányítani őket, vagy pont az a lényeg, hogy engedjük szabadon a tudattalanunk eseményeit? A beszélgetés résztvevői: Anna, Nóri, Kata, Róza, Mili, Kristóf és Adorján, valamint Gellért Rita klinikai szakpszichológus.";

describe("clean-text quality gate", () => {
  it("never accepts an empty output for a substantive RSS description and rescues it extract-only", () => {
    const v4 = heuristicClean(CREDIT_LED);
    expect(v4.text.trim()).toBe(""); // the known v4 overcut this fix guards against
    expect(validateCleanOutput(CREDIT_LED, v4.text).status).toBe("invalid");
    const d = decideCleanText({ raw: CREDIT_LED, v4 });
    expect(d.action).toBe("write");
    if (d.action !== "write") return;
    expect(d.rescued).toBe(true);
    expect(d.text).toContain("Gellért Rita klinikai szakpszichológus");
    expect(validateExtractOnlyTrim(CREDIT_LED, d.text, { minOverlap: 0.97, maxAddedTokenRatio: 0.03 }).ok).toBe(true);
  });

  it("flags severe overcut of a long description", () => {
    const raw = "Ebben az adásban a magyar vasúthálózat fejlesztéséről beszélgetünk a meghívott szakértőkkel. ".repeat(12);
    expect(validateCleanOutput(raw, "Vasút.").status).toBe("invalid");
    expect(validateCleanOutput(raw, "Vasút.").reasons).toContain("severe_overcut");
  });

  it("treats a pure link/CTA description as no content instead of a broken result", () => {
    const raw = "Facebook: https://facebook.com/x\nInstagram: https://instagram.com/x\nKövess minket a Spotify-on!\nWeboldal: https://example.hu";
    const d = decideCleanText({ raw });
    expect(d.action).toBe("skip_no_content");
  });

  it("keeps a short valid description as valid_short, not as an error", () => {
    const raw = "Interjú Kovács Annával a könyvtárak jövőjéről.";
    const d = decideCleanText({ raw });
    expect(d.action).toBe("write");
    if (d.action === "write") expect(d.verdict.status).toBe("valid_short");
  });

  it("preserves the prior good text when a new output is invalid and cannot be rescued", () => {
    const raw = "<a href=\"https://x.hu\">" + "https://a.hu/" + "x".repeat(600);
    const d = decideCleanText({ raw, v4: { text: "", removed: [] }, priorCleanedText: "Korábbi, jó minőségű epizódleírás a témáról és a vendégekről." });
    expect(["keep_prior", "skip_no_content"]).toContain(d.action);
    expect(d.action).not.toBe("write");
  });

  it("is idempotent: the same input yields the same decision and text", () => {
    const a = decideCleanText({ raw: CREDIT_LED });
    const b = decideCleanText({ raw: CREDIT_LED });
    expect(a).toEqual(b);
  });

  it("rescue never invents text and keeps dotted tokens intact", () => {
    const raw = "Vendégünk a Podcastle.ai alapítója. 🎧Hol érheted el a podcastet? 🎙facebook - https://facebook.com/x";
    const r = conservativeRescueClean(raw).text;
    expect(r).not.toMatch(/https?:|facebook -/);
    expect(validateExtractOnlyTrim(raw, r, { minOverlap: 0.97, maxAddedTokenRatio: 0.03 }).ok).toBe(true);
  });
});

describe("best text source policy", () => {
  const ep = { id: "e1", podcast_id: "p1", title: "t", description: "Hosszú, érdemi RSS leírás a beszélgetésről és a vendégekről. ".repeat(10) };
  const transcript = { id: "t1", status: "ok", model: "supadata-youtube", transcript: "szó ".repeat(15000), content_hash: "h1", rights_status: "rss_public_index_only", segments: [] };

  it("does not replace a substantive RSS description with a full transcript; records availability", () => {
    const best = pickBest(ep, null, null, null, transcript, {});
    expect(best.source_type).toBe("rss");
    expect(best.evidence.transcript_available.content_hash).toBe("h1");
    expect(best.evidence.transcript_available.public_display).toBe(false);
  });

  it("uses a newly arrived transcript for an already-done episode only when RSS is thin", async () => {
    const thin = { ...ep, description: "Új adás! https://spotify.com/x" };
    const best = pickBest(thin, null, null, null, transcript, {});
    expect(best.source_type).toBe("transcript");
    expect(best.reasons).toContain("transcript_rss_thin_fallback");
    expect(needsReclean({ source_type: "rss", raw_text: thin.description }, best)).toBe(true);
    expect(await sourceFingerprint(best)).toBe(await sourceFingerprint(best));
  });

  it("rejects transcripts with unknown rights", () => {
    const thin = { ...ep, description: "Rövid." };
    const best = pickBest(thin, null, null, null, { ...transcript, rights_status: "restricted" }, {});
    expect(best.source_type).toBe("rss");
  });

  it("keeps a short RSS when the confirmed article adds no text", () => {
    const short = { ...ep, description: "Beszélgetés a hét fontos híreiről és a háttérről." };
    const article = { id: "a1", status: "confirmed", match_score: 0.9, article_text: short.description };
    expect(pickBest(short, null, null, article, null, {}).source_type).toBe("rss");
    const longer = { ...article, article_text: `${short.description} A cikk további részleteket is közöl a témáról.` };
    expect(pickBest(short, null, null, longer, null, {}).source_type).toBe("article");
  });

  it("works without loaded transcript segments (runner omits them)", () => {
    const thin = { ...ep, description: "Rövid." };
    const { segments: _s, ...noSeg } = transcript;
    const best = pickBest(thin, null, null, null, noSeg, {});
    expect(best.source_type).toBe("transcript");
    expect(best.evidence.has_segments).toBeNull();
  });
});

describe("runner safety (static)", () => {
  const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");
  it("clean-text runner never marks quarantined/invalid output done and gates paid AI on approval", () => {
    const runner = read("supabase/functions/episode-clean-text-runner/index.ts");
    expect(runner).toContain("decideCleanText(");
    expect(runner).toContain('"quarantined"');
    expect(runner).toContain('ctrl.ai_trim_enabled === true && typeof ctrl.ai_trim_spend_approved_at === "string"');
  });
  it("best-source runner uses bounded keyset feeds and no full-table scans", () => {
    const runner = read("supabase/functions/episode-best-text-source-runner/index.ts");
    expect(runner).toContain("Math.min(MAX_TARGETS,");
    expect(runner).toContain("const MAX_TARGETS = 60;");
    expect(runner).not.toMatch(/offset < 500000/);
    // No blind "flip to pending" requeue; only the backed-up, capped YouTube re-clean.
    expect(runner).not.toContain('clean_text_status: "pending"');
    expect(runner).toContain("ctrl.youtube_reclean_enabled === true");
  });
  it("repair apply is capped at 100 items with backup and CAS", () => {
    const sql = read("drizzle/migrations/0065_clean_text_quality_repair.sql");
    expect(sql).toContain("at most 100 items per repair batch");
    expect(sql).toContain("INSERT INTO public.episode_clean_text_repair_backups");
    expect(sql).toContain("skipped_changed_after_repair");
  });
});
