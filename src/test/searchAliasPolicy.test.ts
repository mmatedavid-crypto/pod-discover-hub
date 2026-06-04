import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { expandSimple, MATCH_LABEL, normalizeQuery } from "@/lib/search";
import { canonicalEntityValue, entitySlug, matchesEntitySlug } from "@/lib/entity";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("Hungarian search alias policy", () => {
  it("expands important Hungarian brand, ticker and sports aliases", () => {
    expect(expandSimple("mtel")).toEqual(expect.arrayContaining(["Magyar Telekom", "Telekom", "MTELEKOM"]));
    expect(expandSimple("telekom")).toEqual(expect.arrayContaining(["Magyar Telekom", "MTELEKOM", "MTEL"]));
    expect(expandSimple("fradi")).toEqual(expect.arrayContaining(["FTC", "Ferencváros"]));
    expect(expandSimple("ftc")).toEqual(expect.arrayContaining(["Fradi", "Ferencváros"]));
    expect(expandSimple("foci")).toEqual(expect.arrayContaining(["labdarúgás", "futball"]));
    expect(expandSimple("labdarugas")).toEqual(expect.arrayContaining(["labdarúgás", "foci", "futball"]));
  });

  it("canonicalizes important Hungarian organization aliases for public entity links", () => {
    expect(canonicalEntityValue("company", "MTEL")).toBe("Magyar Telekom");
    expect(canonicalEntityValue("company", "MTELEKOM")).toBe("Magyar Telekom");
    expect(canonicalEntityValue("company", "Fradi")).toBe("Ferencvárosi Torna Club");
    expect(canonicalEntityValue("company", "FTC")).toBe("Ferencvárosi Torna Club");
    expect(canonicalEntityValue("company", "Richter Gedeon")).toBe("Richter Gedeon Nyrt.");
    expect(entitySlug("company", "Fradi")).toBe("ferencvarosi-torna-club");
    expect(matchesEntitySlug("company", "FTC", "ferencvarosi-torna-club")).toBe(true);
    expect(matchesEntitySlug("company", "MTEL", "magyar-telekom")).toBe(true);
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

  it("keeps edge hybrid search on the same built-in Hungarian alias layer", () => {
    const synonyms = read("supabase/functions/_shared/search-synonyms.ts");
    const understand = read("supabase/functions/_shared/search-understand.ts");
    const orgRunner = read("supabase/functions/organizations-backfill-runner/index.ts");
    const personExtractor = read("supabase/functions/person-entity-extractor/index.ts");
    const orgAliasMigration = read("supabase/migrations/20260604204500_extend_high_value_organization_aliases.sql");

    expect(synonyms).toContain('fradi: ["FTC", "Ferencváros", "Ferencvárosi Torna Club", "labdarúgás"]');
    expect(synonyms).toContain('mtel: ["Magyar Telekom", "Telekom", "MTELEKOM"]');
    expect(synonyms).toContain('labdarugas: ["labdarúgás", "foci", "futball", "magyar foci"]');
    expect(synonyms).toContain("builtinExpansions");
    expect(understand).toContain("Fradi / FTC / Ferencváros");
    expect(understand).toContain("MTELEKOM/MTEL");
    expect(orgRunner).toContain("HIGH_VALUE_ORG_ALIASES");
    expect(orgRunner).toContain('aliases: ["telekom", "magyar telekom", "mtelekom", "mtel"');
    expect(orgRunner).toContain('aliases: ["ftc", "fradi", "ferencváros"');
    expect(orgAliasMigration).toContain("'Telekom', 0.99");
    expect(orgAliasMigration).toContain("'MTELEKOM', 0.99");
    expect(orgAliasMigration).toContain("'Fradi', 0.99");
    expect(orgAliasMigration).toContain("'FTC', 0.99");
    expect(orgAliasMigration).toContain("'Richter Gedeon', 1.00");
    expect(orgAliasMigration).toContain("hidden_as_company_eponym_without_podcast_person_evidence");
    expect(personExtractor).toContain("ORG_NAMED_HISTORICAL_PERSON_BLOCKLIST");
    expect(personExtractor).toContain("organizationNameNorms");
    expect(personExtractor).toContain('from("canonical_entity_aliases")');
    expect(personExtractor).toContain('from("organization_aliases")');
    expect(personExtractor).toContain('"richter gedeon"');
  });
});
