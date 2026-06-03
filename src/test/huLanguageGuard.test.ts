import { describe, expect, it } from "vitest";

const {
  assertHungarianPublicFields,
  nonHungarianPublicFields,
} = await import("../../supabase/functions/_shared/hu-language-guard");

describe("Hungarian public output guard", () => {
  it("rejects an English ai_summary even when other public fields are Hungarian", () => {
    expect(() => assertHungarianPublicFields({
      seo_title: "Gazdasági kilátások magyar podcastban",
      seo_description: "Az epizód a forint, az infláció és a befektetések helyzetét foglalja össze.",
      ai_summary: "This episode discusses the latest market trends and what investors should watch next.",
    })).toThrow(/hu_language_guard_failed:ai_summary/);
  });

  it("rejects English public text even when it contains a Hungarian proper noun", () => {
    expect(nonHungarianPublicFields({
      ai_summary: "This episode features Friderikusz Sándor and explores why the interview became an important public conversation.",
    })).toEqual(["ai_summary"]);
  });

  it("does not over-block short Hungarian titles", () => {
    expect(nonHungarianPublicFields({
      seo_title: "Friderikusz podcast",
      seo_description: "Friss magyar beszélgetés közéleti és társadalmi témákról.",
    })).toEqual([]);
  });

  it("accepts natural Hungarian public SEO fields", () => {
    expect(nonHungarianPublicFields({
      seo_title: "Friss közéleti beszélgetés",
      seo_description: "Az epizód magyar közéleti témákat jár körül, vendégekkel és háttérmagyarázattal.",
      ai_summary: "A beszélgetés a hazai politikai helyzetet és a legfontosabb társadalmi kérdéseket foglalja össze.",
    })).toEqual([]);
  });
});
