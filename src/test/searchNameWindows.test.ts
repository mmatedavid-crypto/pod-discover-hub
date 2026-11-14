import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { nameWindows } from "../../supabase/functions/_shared/search-name-windows";

describe("search: catalog names inside longer queries", () => {
  it("finds a two-word name inside a topic + name search", () => {
    expect(nameWindows("onismeret kadar annamaria")).toContain("kadar annamaria");
  });
  it("never offers the whole query or a two-word query (exact-name path handles those)", () => {
    expect(nameWindows("kadar annamaria")).toEqual([]);
    expect(nameWindows("a b c")).toEqual([]);
    expect(nameWindows("onismeret kadar annamaria")).not.toContain("onismeret kadar annamaria");
  });
  it("an embedded name never becomes a pin or a strict full-name filter", () => {
    const src = readFileSync("supabase/functions/search-hybrid/index.ts", "utf8");
    expect(src).toContain('anchors.find((a) => a.kind === "person" && a.id && !a.embedded)');
    expect(src).toContain("(isNameShapedQuery(q) && !embeddedPersonAnchor)");
  });
  it("catalog word completion only suggests words that occur in the index", () => {
    const sql = readFileSync("drizzle/migrations/0151_search_unknown_token_completion.sql", "utf8");
    expect(sql).toContain("search_tsv @@ to_tsquery('simple', t || ':*')");
    expect(sql).toContain("sim >= 0.45");
  });
});
