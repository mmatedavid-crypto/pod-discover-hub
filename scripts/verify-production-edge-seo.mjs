const SITE = process.env.PUBLIC_SITE_URL || "https://podiverzum.hu";
const INDEXNOW_KEY = "cd4aa0ff3daa6bff678ed60d1431affc45fcf9ef72ff14c90613492dc7c32f6a";

const redirectChecks = [
  { url: "https://www.podiverzum.hu/podcast/emazon?utm=test", expectedUrl: "https://podiverzum.hu/podcast/emazon?utm=test", cacheIncludes: "max-age=31536000" },
  ["/search", "/kereses"],
  ["/categories", "/kategoriak"],
  { url: "/category/technologia?utm=test", expectedUrl: "https://podiverzum.hu/kategoria/technologia?utm=test", cacheIncludes: "max-age=31536000" },
  ["/topic/keresztenyseg", "/temak/keresztenyseg"],
  ["/tema/keresztenyseg", "/temak/keresztenyseg"],
  ["/topic/keresztenyseg/2026", "/temak/keresztenyseg/2026"],
  ["/tema/keresztenyseg/2026", "/temak/keresztenyseg/2026"],
  ["/person/feledy-botond", "/szemelyek/feledy-botond"],
  ["/szemely/feledy-botond", "/szemelyek/feledy-botond"],
  ["/person/feledy-botond/temak/kulpolitika", "/szemelyek/feledy-botond/temak/kulpolitika"],
  ["/szemely/feledy-botond/temak/kulpolitika", "/szemelyek/feledy-botond/temak/kulpolitika"],
  ["/company/klubradio", "/ceg/klubradio"],
  ["/company/klubradio/temak/kozelet", "/ceg/klubradio/temak/kozelet"],
  ["/szervezetek", "/cegek"],
  ["/entitasok", "/cegek"],
  ["/szervezetek/klubradio/temak/kozelet", "/ceg/klubradio/temak/kozelet"],
  ["/cegek/klubradio", "/ceg/klubradio"],
  ["/partok/fidesz", "/ceg/fidesz"],
  ["/ingredient/paradicsom", "/hozzavalo/paradicsom"],
  ["/moods", "/hangulatok"],
  ["/moods/reggeli-radio", "/hangulatok/reggeli-radio"],
  ["/mood/reggeli-radio", "/hangulatok/reggeli-radio"],
  ["/hangulat/reggeli-radio", "/hangulatok/reggeli-radio"],
  ["/privacy", "/adatvedelem"],
  ["/terms", "/feltetelek"],
  ["/about", "/rolunk"],
  ["/methodology", "/modszertan"],
  ["/contact", "/kapcsolat"],
  ["/uj", "/uj-podcastok"],
  ["/new", "/uj-podcastok"],
  ["/mai-valogatas", "/napi"],
  ["/daily", "/napi"],
  ["/podcastok", "/toplista"],
  ["/toplist", "/toplista"],
  ["/vibe", "/te-podiverzumod"],
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
      "User-agent: DuckDuckBot",
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
    optionalHeader: ["x-served-by", "worker-indexnow-key"],
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
  const optionalHeaderOk = !check.optionalHeader || (res.headers.get(check.optionalHeader[0]) || "") === check.optionalHeader[1];
  const ok = res.ok && contentType.includes(check.contentType) && missingBody.length === 0 && forbiddenBody.length === 0 && bodyEqualsOk && headerOk;
  results.push({
    kind: "fetch",
    path: check.path,
    status: res.status,
    content_type: contentType,
    cache_control: cacheControl,
    optional_header_ok: optionalHeaderOk,
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

// Prerender checks: verify the Cloudflare Worker + Supabase prerender edge fn
// actually return page-specific <title>/<meta description>/<link canonical>
// for real entity pages when hit with a bot UA. If the prerender fn errors,
// the worker falls through to origin (generic SPA shell) and this catches it.
const GENERIC_TITLE = "Podiverzum — magyar podcast kereső és ajánló";
const BOT_UAS = [
  ["googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
  ["gptbot", "Mozilla/5.0 (compatible; GPTBot/1.0; +https://openai.com/gptbot)"],
];
const prerenderPages = [
  { path: "/podcast/sztoriban", nameHints: ["sztoriban"] },
  { path: "/temak/kulpolitika", nameHints: ["külpolitika", "kulpolitika"] },
  { path: "/szemelyek/feledy-botond", nameHints: ["feledy"] },
];

function extractTag(html, re) {
  const m = html.match(re);
  return m ? m[1].trim() : "";
}

let genericHomepageDescription = "";
try {
  const homeRes = await fetch(absolute("/"), {
    method: "GET",
    headers: { "user-agent": BOT_UAS[0][1], "accept": "text/html" },
  });
  const homeHtml = await homeRes.text();
  genericHomepageDescription = (extractTag(homeHtml, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
    || extractTag(homeHtml, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)).trim();
} catch (_e) {
  // if homepage fetch fails, fall back to only comparing against generic title
}

for (const page of prerenderPages) {
  for (const [uaLabel, ua] of BOT_UAS) {
    const url = absolute(page.path);
    let res, html = "", errorMsg = "";
    try {
      res = await fetch(url, { method: "GET", headers: { "user-agent": ua, "accept": "text/html" } });
      html = await res.text();
    } catch (err) {
      errorMsg = String(err?.message || err);
    }
    const status = res?.status ?? 0;
    const contentType = res?.headers.get("content-type") || "";
    const title = extractTag(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const description = extractTag(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)
      || extractTag(html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
    const canonical = extractTag(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i)
      || extractTag(html, /<link[^>]+href=["']([^"']*)["'][^>]+rel=["']canonical["']/i);

    const expectedCanonical = url;
    const titleLower = title.toLowerCase();
    const titleSpecific = !!title && title !== GENERIC_TITLE
      && page.nameHints.some((h) => titleLower.includes(h.toLowerCase()));
    const descSpecific = !!description
      && (!genericHomepageDescription || description !== genericHomepageDescription);
    const canonicalOk = !!canonical
      && (canonical === expectedCanonical || canonical === `${expectedCanonical}/`)
      && canonical !== "https://podiverzum.hu/"
      && canonical !== "https://podiverzum.hu";

    const ok = !errorMsg && status === 200 && contentType.includes("text/html")
      && titleSpecific && descSpecific && canonicalOk;

    results.push({
      kind: "prerender",
      path: page.path,
      ua: uaLabel,
      status,
      title,
      description,
      canonical,
      ok,
    });
    if (!ok) {
      failures.push(
        `prerender ${page.path} (ua=${uaLabel}) failed: status=${status}, err=${errorMsg}, `
        + `titleSpecific=${titleSpecific} (title="${title}"), descSpecific=${descSpecific} `
        + `(description="${description}"), canonicalOk=${canonicalOk} `
        + `(canonical="${canonical}", expected="${expectedCanonical}")`
      );
    }
  }
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
