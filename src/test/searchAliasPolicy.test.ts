import { describe, expect, it } from "vitest";
import { expandSimple, MATCH_LABEL, normalizeQuery } from "@/lib/search";

describe("Hungarian search alias policy", () => {
  it("expands important Hungarian brand, ticker and sports aliases", () => {
    expect(expandSimple("mtel")).toEqual(expect.arrayContaining(["Magyar Telekom", "Telekom", "MTELEKOM"]));
    expect(expandSimple("telekom")).toEqual(expect.arrayContaining(["Magyar Telekom", "MTELEKOM", "MTEL"]));
    expect(expandSimple("fradi")).toEqual(expect.arrayContaining(["FTC", "Ferencváros"]));
    expect(expandSimple("ftc")).toEqual(expect.arrayContaining(["Fradi", "Ferencváros"]));
    expect(expandSimple("foci")).toEqual(expect.arrayContaining(["labdarúgás", "futball"]));
    expect(expandSimple("labdarugas")).toEqual(expect.arrayContaining(["labdarúgás", "foci", "futball"]));
  });

  it("keeps public match labels Hungarian", () => {
    expect(Object.values(MATCH_LABEL).join(" ")).not.toMatch(/\b(match|related idea|description match|broader match)\b/i);
    expect(MATCH_LABEL.exact_title).toBe("Pontos cím");
    expect(MATCH_LABEL.semantic).toBe("Kapcsolódó ötlet");
  });

  it("keeps known Hungarian ticker-like aliases stable during normalization", () => {
    expect(normalizeQuery("MTEL").normalized).toBe("mtel");
    expect(normalizeQuery("MTELEKOM").normalized).toBe("mtelekom");
  });
});
