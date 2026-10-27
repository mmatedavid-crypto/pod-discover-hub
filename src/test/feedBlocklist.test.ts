import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { feedBlocklistKey } from "../../supabase/functions/_shared/feed-blocklist";

describe("permanent foreign feed blocklist", () => {
  it("normalises feed URLs the same way as the database key", () => {
    expect(feedBlocklistKey("  HTTPS://Feeds.Example.com/Show/ ")).toBe("https://feeds.example.com/show");
    expect(feedBlocklistKey("https://a.b/rss//")).toBe("https://a.b/rss");
    expect(feedBlocklistKey("")).toBeNull();
    expect(feedBlocklistKey(null)).toBeNull();
  });

  it("blocks the feed before deleting when the owner confirms permanent deletion", () => {
    const src = readFileSync("supabase/functions/language-cleanup-runner/index.ts", "utf8");
    const block = src.indexOf('from("podcast_feed_blocklist").upsert');
    const del = src.indexOf('from("podcasts").delete');
    expect(block).toBeGreaterThan(0);
    expect(block).toBeLessThan(del);
    expect(src).toContain("body?.block_feed === true");
  });

  it("refuses unauthenticated deletion calls", () => {
    const src = readFileSync("supabase/functions/language-cleanup-runner/index.ts", "utf8");
    expect(src).toMatch(/if \(!\(await authorized\(admin, req\)\)\)/);
  });
});
