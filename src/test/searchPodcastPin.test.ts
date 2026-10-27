import { describe, expect, it } from "vitest";
import { podcastPinAllowed, podcastTitleCore, wordAlignedMatch } from "../../supabase/functions/_shared/search-podcast-pin";

describe("podcast name pin", () => {
  it("does not pin a show whose title only shares characters with the searched word", () => {
    expect(podcastPinAllowed("AI", "Airbag [Tilos Rádió podcast]", "prefix")).toBe(false);
    expect(podcastPinAllowed("EU", "Eurovíziós Podcast", "prefix")).toBe(false);
    expect(podcastPinAllowed("Gulyás", "Gulyáságyú podcast hivatalos", "prefix")).toBe(false);
    expect(podcastPinAllowed("Tóta", "Totalcar Égéstér: Podcast autókról", "prefix")).toBe(false);
  });

  it("pins a show whose title contains the searched word as a whole word", () => {
    expect(podcastPinAllowed("Telex", "Telex After", "prefix")).toBe(true);
    expect(podcastPinAllowed("egészség", "Itt vagyok – élet és egészség podcast Bánhalmi Katával", "token")).toBe(true);
  });

  it("pins when the visitor typed the show's name, ignoring filler words and brackets", () => {
    expect(podcastPinAllowed("Partizán", "Partizán", "exact")).toBe(true);
    expect(podcastPinAllowed("Qubit", "Qubit Podcast", "prefix")).toBe(true);
    expect(podcastPinAllowed("mindenségit", "A Mindenségit!", "token")).toBe(true);
    expect(podcastPinAllowed("Kibeszélő", "Kibeszélő Show", "prefix")).toBe(true);
    expect(podcastPinAllowed("telex after", "Telex After", "prefix")).toBe(true);
    expect(podcastPinAllowed("anything", "Whatever", "alias")).toBe(true);
  });

  it("never pins fuzzy trigram matches", () => {
    expect(podcastPinAllowed("partizan", "Partizán", "trgm")).toBe(false);
  });

  it("strips publisher tails and bracketed labels from titles", () => {
    expect(podcastTitleCore("Föld/osztás - 24.hu")).toEqual(["fold", "osztas"]);
    expect(podcastTitleCore("Airbag [Tilos Rádió podcast]")).toEqual(["airbag"]);
    expect(podcastTitleCore("Ingatlan.com Podcast")).toEqual(["ingatlan", "com"]);
  });

  it("matches people, organizations and topics only on whole words", () => {
    expect(wordAlignedMatch("alma", "Almási Zsolt")).toBe(false);
    expect(wordAlignedMatch("mák", "Makó Mariann")).toBe(false);
    expect(wordAlignedMatch("mák", "makrogazdaság")).toBe(false);
    expect(wordAlignedMatch("alma", "bántalmazó kapcsolat")).toBe(false);
    expect(wordAlignedMatch("híd", "Hidas Judit")).toBe(false);
    expect(wordAlignedMatch("Bolgár", "Bolgár György")).toBe(true);
    expect(wordAlignedMatch("zelenszkij", "Volodimir Zelenszkij")).toBe(true);
    expect(wordAlignedMatch("mesterséges intelligencia", "Mesterséges intelligencia")).toBe(true);
  });
});
