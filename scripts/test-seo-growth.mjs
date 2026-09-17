// Run with Node >=22.18: node --test scripts/test-seo-growth.mjs
// Pure behavior checks: no network, database writes or production deployment.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import worker from "../infra/cloudflare-worker/worker.js";
import { categoryHeading, categoryIntro, categoryMetaDescription } from "../supabase/functions/_shared/category-copy.ts";
import { discoveryCategories, DISCOVERY_LINKS } from "../supabase/functions/_shared/discovery-navigation.ts";

async function exerciseWorker({ status = 200, marked = false, networkError = false, path = "/podcast/test/test-episode", ua = "Googlebot" } = {}) {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  const calls = { upstream: 0, origin: 0, cached: [] };
  const pending = [];
  globalThis.caches = { default: {
    match: async () => undefined,
    put: async (key, value) => { calls.cached.push({ key: key.url, status: value.status }); },
  } };
  globalThis.fetch = async (request) => {
    if (typeof request === "string" && request.includes("/functions/v1/prerender")) {
      calls.upstream++;
      if (networkError) throw new Error("synthetic upstream outage");
      return new Response("<h1>prerender fixture</h1>", { status, headers: {
        "Content-Type": "text/html", "X-Prerendered": "1",
        ...(marked ? { "X-Prerender-Missing": "1" } : {}),
      } });
    }
    calls.origin++;
    return new Response("origin fixture", { status: 200 });
  };
  try {
    const response = await worker.fetch(new Request(`https://podiverzum.hu${path}`, { headers: { "User-Agent": ua } }), {}, { waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
    return { response, body: await response.text(), calls };
  } finally { globalThis.fetch = originalFetch; globalThis.caches = originalCaches; }
}

test("Worker mirrors are identical", async () => {
  assert.equal(await readFile(new URL("../infra/cloudflare-worker/worker.js", import.meta.url), "utf8"), await readFile(new URL("../.lovable/cloudflare-worker.js", import.meta.url), "utf8"));
});
for (const status of [404, 410]) test(`Confirmed ${status} reaches crawler without origin fallback`, async () => {
  const { response, body, calls } = await exerciseWorker({ status, marked: true });
  assert.equal(response.status, status);
  assert.match(body, /prerender fixture/);
  assert.equal(calls.origin, 0);
  assert.match(response.headers.get("X-Robots-Tag"), /noindex/);
  assert.match(response.headers.get("Cache-Control"), /max-age=60(?:$|,)/);
  assert.equal(calls.cached[0].status, status);
});
for (const status of [404, 401, 429, 500, 503]) test(`Unconfirmed upstream ${status} keeps origin and is not cached`, async () => {
  const { response, body, calls } = await exerciseWorker({ status });
  assert.equal(response.status, 200);
  assert.equal(body, "origin fixture");
  assert.equal(calls.cached.length, 0);
  assert.equal(calls.origin, 1);
});
test("Network outage is not mistaken for content removal", async () => {
  const { body, calls } = await exerciseWorker({ networkError: true });
  assert.equal(body, "origin fixture"); assert.equal(calls.cached.length, 0);
});
test("Unimplemented hub keeps origin rendering", async () => {
  const { body, calls } = await exerciseWorker({ path: "/napi", status: 404 });
  assert.equal(body, "origin fixture"); assert.equal(calls.cached.length, 0);
});
test("Healthy content uses new cache namespace and retains upstream metadata", async () => {
  const { response, calls } = await exerciseWorker();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Prerendered"), "1");
  assert.equal(response.headers.get("X-Robots-Tag"), null);
  assert.match(calls.cached[0].key, /__podi_prerender=20260916-seo/);
});
test("Human requests keep the interactive application", async () => {
  const { body, calls } = await exerciseWorker({ ua: "Mozilla/5.0" });
  assert.equal(body, "origin fixture"); assert.equal(calls.upstream, 0);
});
test("Category headings, fallback text and metadata are useful and bounded", () => {
  assert.equal(categoryHeading({ name: "Tech", slug: "tech" }), "Tech podcastok");
  assert.equal(categoryHeading({ name: "Tech podcastok", slug: "tech" }), "Tech podcastok");
  assert.match(categoryIntro({ name: "Tech", slug: "tech" }), /mesterséges intelligencia/);
  assert.equal(categoryIntro({ name: "Tech", slug: "tech", description: "<b>Szerkesztett</b> leírás" }), "Szerkesztett leírás");
  assert.equal(categoryMetaDescription({ name: "Tech", slug: "tech", seoDescription: "a".repeat(200) }).length, 160);
});
test("Discovery links only use real active categories, with no duplicates", () => {
  const rows = [ { name: "Tech", slug: "tech", active: true }, { name: "Régi", slug: "uzlet", active: false }, { name: "Tech", slug: "tech", active: true }, { name: "Hibás", slug: "../admin", active: true }, { name: "Sport", slug: "sport", active: true } ];
  assert.deepEqual(discoveryCategories(rows).map((r) => r.slug), ["tech", "sport"]);
  assert.deepEqual(discoveryCategories(rows, "tech").map((r) => r.slug), ["sport"]);
  assert.ok(DISCOVERY_LINKS.some((l) => l.href === "/kategoriak"));
  assert.ok(DISCOVERY_LINKS.some((l) => l.href === "/szemelyek"));
  assert.ok(!DISCOVERY_LINKS.some((l) => l.href === "/podcastok"));
});
