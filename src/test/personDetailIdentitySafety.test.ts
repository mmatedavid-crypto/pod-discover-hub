import { describe, expect, it } from "vitest";
import { isUsefulPersonIdentityLabel } from "@/pages/PersonDetailPage";

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
});
