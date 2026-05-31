import { describe, expect, it } from "vitest";

const { canonicalizeHungarianPersonName } = await import("../../supabase/functions/_shared/hu-person-name");

describe("Hungarian person name canonicalization", () => {
  it("removes -val/-vel forms from full names", () => {
    expect(canonicalizeHungarianPersonName("Vigh Vandával")).toMatchObject({
      name: "Vigh Vanda",
      changed: true,
      removed_suffix: "val",
    });
    expect(canonicalizeHungarianPersonName("Vigh Vandaval")).toMatchObject({
      name: "Vigh Vanda",
      changed: true,
      removed_suffix: "val",
    });
    expect(canonicalizeHungarianPersonName("Schmied Andival")).toMatchObject({
      name: "Schmied Andi",
      changed: true,
    });
  });

  it("removes assimilated -val/-vel forms conservatively", () => {
    expect(canonicalizeHungarianPersonName("Vigh Judittal")).toMatchObject({
      name: "Vigh Judit",
      changed: true,
      removed_suffix: "val",
    });
    expect(canonicalizeHungarianPersonName("Nagy Péterrel")).toMatchObject({
      name: "Nagy Péter",
      changed: true,
      removed_suffix: "vel",
    });
  });

  it("does not rewrite single-token or already canonical names", () => {
    expect(canonicalizeHungarianPersonName("Simon Sinek")).toMatchObject({
      name: "Simon Sinek",
      changed: false,
    });
    expect(canonicalizeHungarianPersonName("Vandával")).toMatchObject({
      name: "Vandával",
      changed: false,
    });
  });
});
