import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isUsefulPersonIdentityLabel } from "@/components/PersonCard";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("person detail identity safety", () => {
  it("hides generic machine labels that do not help identify a person", () => {
    expect(isUsefulPersonIdentityLabel("Nemzetközi téma személy")).toBe(false);
    expect(isUsefulPersonIdentityLabel("Személy")).toBe(false);
    expect(isUsefulPersonIdentityLabel("Podcastokban említett személy")).toBe(false);
  });

  it("keeps specific disambiguation labels", () => {
    expect(isUsefulPersonIdentityLabel("Hold Alapkezelő alapítója")).toBe(true);
    expect(isUsefulPersonIdentityLabel("sport- és életmód szakértő")).toBe(true);
  });

  it("keeps person detail pages from presenting generic fallback text as biography", () => {
    const page = read("src/pages/PersonDetailPage.tsx");

    expect(page).toContain("personCollectionIntro");
    expect(page).toContain("Podcastokban");
    expect(page).not.toContain('text-primary">Személy</div>');
    expect(page).not.toContain("(eps.length > 0 ? huFallbackBio(person.name) : null)");
  });
});
