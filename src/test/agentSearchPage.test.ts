import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

// Owner decision 2026-10-24: AI assistants get the same full-quality search as
// visitors on /kereses?q= and through the MCP search tool; search result pages
// stay out of the Google index (noindex,follow).
describe("agent search page", () => {
  const worker = read(".lovable/cloudflare-worker.js");

  it("keeps both Cloudflare worker copies identical", () => {
    expect(read("infra/cloudflare-worker/worker.js")).toBe(worker);
  });

  it("gives user-initiated AI assistants the full tier, but not Googlebot or training crawlers", () => {
    const list = worker.match(/const AI_ASSISTANT_UAS = \[([\s\S]*?)\];/)?.[1] ?? "";
    const uas = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const isAi = (ua: string) => uas.some((b) => ua.toLowerCase().includes(b));
    expect(isAi("Mozilla/5.0; compatible; ChatGPT-User/1.0; +https://openai.com/bot")).toBe(true);
    expect(isAi("Mozilla/5.0; compatible; Claude-User/1.0")).toBe(true);
    expect(isAi("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(false);
    expect(isAi("Mozilla/5.0; compatible; GPTBot/1.2")).toBe(false);
    expect(isAi("CCBot/2.0")).toBe(false);
  });

  it("caches search pages per query and tier", () => {
    expect(worker).toContain("tier=${searchTier}&q=${encodeURIComponent(searchQ.toLowerCase())}");
  });

  it("only a valid internal key lifts the bot gate in search-hybrid", () => {
    const hybrid = read("supabase/functions/search-hybrid/index.ts");
    expect(hybrid).toContain("const isBot = botCheck.isBot && !trustedAgent;");
    expect(hybrid).toContain("AGENT_SEARCH_KEY.length < 32");
  });

  it("serves search results noindex,follow with the human search request", () => {
    const prerender = read("supabase/functions/prerender/index.ts");
    expect(prerender).toContain('"X-Robots-Tag": "noindex, follow"');
    expect(prerender).toContain('rerank: true, lang: "hu", latency_mode: "quality", soft_budget_ms: 13500');
  });
});
