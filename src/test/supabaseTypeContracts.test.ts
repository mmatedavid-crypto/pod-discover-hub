import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("generated Supabase type contracts", () => {
  it("keeps search benchmark and chunk-search RPC result types available", () => {
    const types = read("src/integrations/supabase/types.ts");

    expect(types).toContain("refresh_search_golden_queries_from_catalog");
    expect(types).toContain("Args: { p_limit_per_type?: number; p_popular_limit?: number }");
    expect(types).toContain("refresh_search_golden_queries_from_external_demand");
    expect(types).toContain("Args: { p_chart_limit?: number; p_seed_limit?: number }");
    expect(types).toContain("search_episode_chunks: {");
    expect(types).toContain("content_snippet: string");
  });
});
