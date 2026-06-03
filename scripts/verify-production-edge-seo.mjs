const SITE = process.env.PUBLIC_SITE_URL || "https://podiverzum.hu";

const redirectChecks = [
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
    bodyIncludes: ["Magyar podcastkereső", "Forrás: podiverzum.hu", "https://podiverzum.hu/uj-podcastok"],
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

for (const [path, expectedPath] of redirectChecks) {
  const res = await fetch(absolute(path), { method: "GET", redirect: "manual" });
  const location = res.headers.get("location") || "";
  const ok = res.status === 301 && sameUrl(location, expectedPath);
  results.push({ kind: "redirect", path, status: res.status, location, ok });
  if (!ok) failures.push(`redirect ${path} expected 301 -> ${expectedPath}, got ${res.status} ${location}`);
}

for (const check of fetchChecks) {
  const res = await fetch(absolute(check.path), { method: "GET" });
  const contentType = res.headers.get("content-type") || "";
  const cacheControl = res.headers.get("cache-control") || "";
  const body = await res.text();
  const missingBody = (check.bodyIncludes || []).filter((needle) => !body.includes(needle));
  const forbiddenBody = (check.bodyExcludes || []).filter((needle) => body.includes(needle));
  const headerOk = !check.header || (res.headers.get(check.header[0]) || "") === check.header[1];
  const ok = res.ok && contentType.includes(check.contentType) && missingBody.length === 0 && forbiddenBody.length === 0 && headerOk;
  results.push({
    kind: "fetch",
    path: check.path,
    status: res.status,
    content_type: contentType,
    cache_control: cacheControl,
    ok,
  });
  if (!ok) {
    failures.push(`fetch ${check.path} failed: status=${res.status}, content-type=${contentType}, missing=${missingBody.join(",")}, forbidden=${forbiddenBody.join(",")}, headerOk=${headerOk}`);
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
