import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

afterEach(() => vi.unstubAllGlobals());

describe("person-page release cache isolation", () => {
  it("uses a new namespace only under /szemelyek/ in both release sources", async () => {
    for (const file of ["infra/cloudflare-worker/worker.js", ".lovable/cloudflare-worker.js"]) {
      const worker = new Function(readFileSync(file, "utf8").replace("export default", "return"))();
      const keys: string[] = [];
      vi.stubGlobal("caches", { default: { match: async (key: Request) => {
        keys.push(key.url);
        return new Response("cached");
      } } });
      for (const path of ["/szemelyek/fabok-gyorgy", "/szemelyek/papai-anita/", "/szemelyek", "/temak/kave", "/podcast/test/episode", "/kereses?q=kave"]) {
        await worker.fetch(new Request(`https://podiverzum.hu${path}`, { headers: { "User-Agent": "Googlebot" } }), {}, { waitUntil: () => {} });
      }
      expect(keys.map(key => new URL(key).searchParams.get("__podi_prerender"))).toEqual([
        "20261127-person-editorial", "20261127-person-editorial",
        "20260916-seo", "20260916-seo", "20261020-episode-nonews", "20261024-search",
      ]);
    }
  });
});