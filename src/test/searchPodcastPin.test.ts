import { describe, expect, it } from "vitest";
import { podcastPinAllowed, podcastTitleCore } from "../../supabase/functions/_shared/search-podcast-pin";

describe("podcast name pin", () => {
  it("does not pin a show whose title merely starts with or contains the searched word", () => {
    expect(podcastPinAllowed("AI", "Airbag [Tilos Rádió podcast]", "prefix")).toBe(false);
    expect(podcastPinAllowed("EU", "Eurovíziós Podcast", "prefix")).toBe(false);
    expect(podcastPinAllowed("Gulyás", "Gulyáságyú podcast hivatalos", "prefix")).toBe(false);
    expect(podcastPinAllowed("Budapest", "Budapest Park", "token")).toBe(false);
    expect(podcastPinAllowed("föld", "Föld/osztás - 24.hu", "prefix")).toBe(false);
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
  });
});
