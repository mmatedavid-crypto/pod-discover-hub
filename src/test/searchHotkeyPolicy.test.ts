import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("search hotkey policy", () => {
  it("targets the Hungarian visible search input instead of an obsolete English placeholder", () => {
    const hotkey = read("src/components/SearchHotkey.tsx");

    expect(hotkey).toContain('input[aria-label="Keresés"]');
    expect(hotkey).toContain("getBoundingClientRect");
    expect(hotkey).toContain("window.getComputedStyle");
    expect(hotkey).not.toContain('placeholder^="Search"');
  });
});
