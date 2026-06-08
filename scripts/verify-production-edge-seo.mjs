const SITE = process.env.PUBLIC_SITE_URL || "https://podiverzum.hu";
const INDEXNOW_KEY = "cd4aa0ff3daa6bff678ed60d1431affc45fcf9ef72ff14c90613492dc7c32f6a";

const redirectChecks = [
  { url: "https://www.podiverzum.hu/podcast/emazon?utm=test", expectedUrl: "https://podiverzum.hu/podcast/emazon?utm=test", cacheIncludes: "max-age=31536000" },
  ["/search", "/kereses"],
  ["/categories", "/kategoriak"],
  ["/podcastok", "/toplista"],
  ["/toplist", "/toplista"],
  ["/b2b", "/intelligence"],
  ["/mediafigyeles", "/intelligence"],
  ["/heti-valogatas", "/heti"],
  ["/heti-valogatas/2026-06-01", "/heti"],
  ["/szervezetek/fradi", "/ceg/fradi"],
  ["/part/fidesz", "/ceg/fidesz"],
];

const fetchChecks = [
  {
    path: "/sitemap.xml",
    contentType: "application/xml",
    bodyIncludes: ["<sitemapindex", "/sitemaps/pages.xml"],
  },
  {
    path: "/news-sitemap.xml",
    contentType: "application/xml",
    header: ["x-served-by", "worker-sitemap-proxy"],
  },
  {
    path: "/robots.txt",
    contentType: "text/plain",
    bodyIncludes: [
      "Sitemap: https://podiverzum.hu/sitemap.xml",
      "Sitemap: https://podiverzum.hu/news-sitemap.xml",
      "Host: podiverzum.hu",
      "Content-Signal: search=yes,ai-input=yes,ai-train=no",
      "User-agent: GPTBot",
      "User-agent: OAI-SearchBot",
      "User-agent: ClaudeBot",
    ],
    bodyExcludes: [
      "BEGIN Cloudflare Managed",
      "User-agent: GPTBot\nDisallow: /",
      "User-agent: ClaudeBot\nDisallow: /",
      "User-agent: Google-Extended\nDisallow: /",
      "User-agent: Applebot-Extended\nDisallow: /",
    ],
    header: ["x-served-by", "worker-robots-policy"],
  },
  {
    path: "/llms.txt",
    contentType: "text/plain",
    bodyIncludes: [
      "# Podiverzum.hu",
      "Hungarian podcast discovery platform",
      "https://podiverzum.hu/heti",
      "https://podiverzum.hu/heti/rss.xml",
      "https://podiverzum.hu/news-sitemap.xml",
      "https://podiverzum.hu/sitemap.xml",
    ],
  },
  {
    path: `/${INDEXNOW_KEY}.txt`,
    contentType: "text/plain",
    bodyEquals: INDEXNOW_KEY,
    header: ["x-served-by", "worker-indexnow-key"],
  },
];

function absolute(path) {
  return new URL(path, SITE).toString();
}

function sameUrl(actual, expectedPath) {
  const expected = absolute(expectedPath);
  return actual === expected || actual === `${expected}/`;
}

const failures = [];
const results = [];

for (const item of redirectChecks) {
  const [path, expectedPath] = Array.isArray(item) ? item : [item.url, item.expectedUrl];
  const requestUrl = /^https?:\/\//i.test(path) ? path : absolute(path);
  const res = await fetch(requestUrl, { method: "GET", redirect: "manual" });
  const location = res.headers.get("location") || "";
  const cacheControl = res.headers.get("cache-control") || "";
  const locationOk = /^https?:\/\//i.test(expectedPath) ? location === expectedPath : sameUrl(location, expectedPath);
  const cacheOk = !item.cacheIncludes || cacheControl.includes(item.cacheIncludes);
  const ok = res.status === 301 && locationOk && cacheOk;
  results.push({ kind: "redirect", path, status: res.status, location, cache_control: cacheControl, ok });
  if (!ok) failures.push(`redirect ${path} expected 301 -> ${expectedPath}, got ${res.status} ${location}, cache=${cacheControl}`);
}

for (const check of fetchChecks) {
  const res = await fetch(absolute(check.path), { method: "GET" });
  const contentType = res.headers.get("content-type") || "";
  const cacheControl = res.headers.get("cache-control") || "";
  const body = await res.text();
  const missingBody = (check.bodyIncludes || []).filter((needle) => !body.includes(needle));
  const forbiddenBody = (check.bodyExcludes || []).filter((needle) => body.includes(needle));
  const bodyEqualsOk = !("bodyEquals" in check) || body.trim() === check.bodyEquals;
  const headerOk = !check.header || (res.headers.get(check.header[0]) || "") === check.header[1];
  const ok = res.ok && contentType.includes(check.contentType) && missingBody.length === 0 && forbiddenBody.length === 0 && bodyEqualsOk && headerOk;
  results.push({
    kind: "fetch",
    path: check.path,
    status: res.status,
    content_type: contentType,
    cache_control: cacheControl,
    ok,
  });
  if (!ok) {
    failures.push(`fetch ${check.path} failed: status=${res.status}, content-type=${contentType}, missing=${missingBody.join(",")}, forbidden=${forbiddenBody.join(",")}, bodyEqualsOk=${bodyEqualsOk}, headerOk=${headerOk}`);
  }
}

const news = results.find((r) => r.path === "/news-sitemap.xml");
if (news?.cache_control && !/(max-age=300|s-maxage=300)/.test(news.cache_control)) {
  failures.push(`news-sitemap cache should be 300s after worker deploy, got: ${news.cache_control}`);
}

const output = {
  ok: failures.length === 0,
  generated_at: new Date().toISOString(),
  site: SITE,
  results,
  failures,
};

console.log(JSON.stringify(output, null, 2));
if (failures.length) process.exit(1);
