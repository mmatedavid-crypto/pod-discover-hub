import { describe, expect, it } from "vitest";
import { personEpisodeInputs, isProtectedPersonPair } from "../../supabase/functions/_shared/person-extractor-inputs";
import { personExtractorInputFingerprint } from "../../supabase/functions/_shared/person-extractor-fingerprint";

describe("show roster provenance and episode evidence", () => {
  const host = "Sebestyén Balázs";
  it.each(["website_ai", "ai_mentions", "scrape_failed", "", null])("does not fan out %s rosters", (source) => {
    expect(personEpisodeInputs({}, { hosts: [host], hosts_source: source }).hosts).toEqual([]);
  });
  it("preserves the episode's speaking and subject evidence even for a listed host", () => {
    const inputs = personEpisodeInputs({ entity_extraction_evidence: { person_mentions: [
      { name: host, role: "speaker", evidence: "Műsorvezető: Sebestyén Balázs" },
      { name: "Orbán Viktor", role: "subject", evidence: "Orbán Viktor beszédéről beszélgetünk" },
    ] } }, { hosts: [host, "Orbán Viktor"], hosts_source: "website_ai" });
    expect(inputs.hosts).toEqual([]);
    expect(inputs.speakers).toEqual([host]);
    expect(inputs.mentioned).toEqual(["Orbán Viktor"]);
    expect(inputs.evidence[1].role).toBe("subject");
  });
  it("preserves legacy episode data, independently of the roster", () => {
    const inputs = personEpisodeInputs({ people: [host, host], mentioned: ["Puzsér Róbert"] },
      { hosts: [host, "Puzsér Róbert"], hosts_source: "ai_mentions" });
    expect(inputs.speakers).toEqual([host]);
    expect(inputs.mentioned).toEqual(["Puzsér Róbert"]);
  });
  it("labels only actual RSS rosters as RSS", () => {
    expect(personEpisodeInputs({}, { hosts: [host], hosts_source: "rss_author" }).hostSource).toBe("rss_author");
    expect(personEpisodeInputs({}, { hosts: [host], hosts_source: "manual_excel" }).hostSource).toBe("podcast_host_list");
  });
  it("reprocesses changed roster provenance even when names are unchanged", async () => {
    const ep = { id: "episode" };
    const pod = { id: "show", hosts: [host], hosts_source: "website_ai" };
    const before = await personExtractorInputFingerprint(ep, pod, "aliases");
    expect(await personExtractorInputFingerprint(ep, { ...pod, hosts_source: "rss_author" }, "aliases")).not.toBe(before);
    expect(await personExtractorInputFingerprint(ep, pod, "aliases")).toBe(before);
  });
  it("a new mention type cannot bypass a protected pair", () => {
    expect(isProtectedPersonPair({ relevance_status: "accepted", validation_source: null })).toBe(true);
    expect(isProtectedPersonPair({ relevance_status: "needs_review", validation_source: "chatgpt_direct_review_v2" })).toBe(true);
    expect(isProtectedPersonPair({ disposition: "decided_rejected" })).toBe(true);
    expect(isProtectedPersonPair({ disposition: "resolved_show_host" })).toBe(true);
    expect(isProtectedPersonPair({ relevance_status: "needs_review", validation_source: "person_openai_batch_v1" })).toBe(false);
  });
});
