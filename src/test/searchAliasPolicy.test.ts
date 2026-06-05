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
    const entityBackfill = read("supabase/functions/entity-backfill-runner/index.ts");
    const orgRunner = read("supabase/functions/organizations-backfill-runner/index.ts");
    const personExtractor = read("supabase/functions/person-entity-extractor/index.ts");
    const searchHybrid = read("supabase/functions/search-hybrid/index.ts");
    const orgAliasMigration = read("supabase/migrations/20260604204500_extend_high_value_organization_aliases.sql");
    const eponymMigration = read("supabase/migrations/20260604211500_company_eponym_person_safety.sql");
    const collisionMigration = read("supabase/migrations/20260605123000_organization_person_name_collision_guard.sql");
    const canonicalReassertMigration = read("supabase/migrations/20260605190000_reassert_canonical_entity_alias_registry.sql");
    const productionVerifier = read("scripts/verify-production-pipeline.mjs");

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
    expect(eponymMigration).toContain("eponym_person_name");
    expect(eponymMigration).toContain("company_eponym_person_policy");
    expect(eponymMigration).toContain("Richter Gedeon -> Richter Gedeon Nyrt.");
    expect(eponymMigration).toContain("COALESCE(p.has_archival_evidence, false) = false");
    expect(eponymMigration).toContain("COALESCE(p.manual_approved, false) = false");
    expect(personExtractor).toContain("ORG_NAMED_HISTORICAL_PERSON_BLOCKLIST");
    expect(personExtractor).toContain("organizationNameNorms");
    expect(personExtractor).toContain('from("canonical_entity_aliases")');
    expect(personExtractor).toContain('from("organization_aliases")');
    expect(personExtractor).toContain('"richter gedeon"');
    expect(entityBackfill).toContain("organizationNameNorms");
    expect(entityBackfill).toContain("Organization, company, team, party and institution names must never go into people or mentioned");
    expect(entityBackfill).toContain('from("canonical_entity_aliases")');
    expect(entityBackfill).toContain('from("organization_aliases")');
    expect(entityBackfill).toContain("organizationNameNorms.has(normalizeForMatch(name))");
    expect(searchHybrid).toContain("function hasAcceptedOrganizationAlias");
    expect(searchHybrid).toContain("function hasStrongPersonEvidence");
    expect(searchHybrid).toContain("if (orgAliasConflict && !hasStrongPersonEvidence(person)) return null");
    expect(searchHybrid).toContain("exactOrganizationAliasHit");
    expect(searchHybrid).toContain("if (exactOrganizationAliasHit && !hasStrongPersonEvidence(row)) continue");
    expect(searchHybrid).toContain("if (exactOrganizationAliasHit && !hasStrongPersonEvidence(p)) continue");
    expect(collisionMigration).toContain("organization_person_name_collision_policy");
    expect(collisionMigration).toContain("Accepted organization aliases take precedence over unapproved person rows");
    expect(collisionMigration).toContain("organization_person_name_collision_guard_v1");
    expect(collisionMigration).toContain("COALESCE(p.manual_approved, false) = false");
    expect(collisionMigration).toContain("COALESCE(p.has_archival_evidence, false) = false");
    expect(collisionMigration).toContain("cp.person_evidence = 0");
    expect(collisionMigration).toContain("cp.person_evidence > 0");
    expect(canonicalReassertMigration).toContain("CREATE OR REPLACE FUNCTION public.normalize_entity_alias");
    expect(canonicalReassertMigration).toContain("CREATE TABLE IF NOT EXISTS public.canonical_entity_aliases");
    expect(canonicalReassertMigration).toContain("organization_aliases_projection");
    expect(canonicalReassertMigration).toContain("topic_aliases_projection");
    expect(canonicalReassertMigration).toContain("canonical_aliases_reassert_20260605");
    expect(productionVerifier).toContain("canonical_alias_table");
    expect(productionVerifier).toContain("canonical_alias_normalizer");
    expect(productionVerifier).toContain("canonical_alias_resolver");
    expect(productionVerifier).toContain("canonical_alias_policy");
  });
});
