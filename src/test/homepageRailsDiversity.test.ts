import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const sql = readFileSync("drizzle/migrations/0153_homepage_fresh_rail_one_per_show.sql", "utf8");

describe("homepage rails: show and category spread (owner 2026-11-14)", () => {
  it("fresh rail: one episode per show before any repeat", () => {
    expect(sql).toContain("AND podcast_pick_rank = 1");
  });
  it("fresh rail: one category holds at most a quarter of the rail (min 2)", () => {
    expect(sql).toContain("AND category_pick_rank <= greatest(2, ceil(_trending_limit / 4.0)::integer)");
  });
  it("timeless rail: one pick per category first, news-moment titles excluded", () => {
    expect(sql).toContain("WHERE timeless_category_rank = 1");
    expect(sql).toContain("WHERE NOT p.time_bound");
  });
  it("no party or person names in the timeless filter (not an ideology filter)", () => {
    const filter = sql.slice(sql.indexOf("AS time_bound") - 400, sql.indexOf("AS time_bound"));
    expect(filter).not.toMatch(/fidesz|tisza|orb[aá]n|magyar p[eé]ter|mszp|dk\b/i);
  });
});
