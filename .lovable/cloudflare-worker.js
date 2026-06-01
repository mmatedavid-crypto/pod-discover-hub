/**
 * Podiverzum bot prerender Worker
 * ---------------------------------
 * - Detects AI/SEO crawler User-Agents
 * - For matched routes: serves prerendered HTML from Supabase edge fn
 *   (cached 24h via Cache API)
 * - Everything else: passthrough to Lovable origin
 *
 * Bind this Worker to:  podiverzum.hu/*  and  www.podiverzum.hu/*
 *
 * No environment variables required — origin and prerender URL are constants.
 */

const PRERENDER_ENDPOINT =
  "https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/prerender";

// Lovable origin host (proxied via Cloudflare). Workers route runs BEFORE
// the proxy returns, so we just `fetch(request)` to passthrough.
//
// Bot UA detection — must be lowercased before matching.
const BOT_UAS = [
  // AI crawlers (this is the main reason we're doing this)
  "gptbot",
  "oai-searchbot",
  "chatgpt-user",
  "claude-web",
  "claudebot",
  "anthropic-ai",
  "perplexitybot",
  "perplexity-user",
  "google-extended",
  "youbot",
  "ccbot", // Common Crawl, used as training data
  "cohere-ai",
  "diffbot",
  "bytespider",
  "amazonbot",
  "applebot-extended",
  // Classic SEO + social previews (helps when JS isn't executed)
  "googlebot",
  "bingbot",
  "duckduckbot",
  "yandexbot",
  "baiduspider",
  "facebookexternalhit",
  "facebookbot",
  "twitterbot",
  "linkedinbot",
  "slackbot",
  "discordbot",
  "telegrambot",
  "whatsapp",
  "embedly",
  "pinterest",
  "redditbot",
  "instagram",          // Instagram DM / in-app link preview fetcher
  "iframely",           // Used by several DM/preview services
  "skypeuripreview",
  "viber",
  "snapchat",
  "tumblr",
  "vkshare",
  "applebot",           // iMessage link previews
  "google-pagerenderer",

];

// Generic bot signal: substring "bot", "crawler", "spider", or non-browser fetch UAs.
const GENERIC_BOT_RE = /(bot|crawler|spider|crawl|preview|fetch|httpclient|http-client|python-requests|libwww|wget|curl|go-http|java\/|okhttp|axios|node-fetch|undici|ruby|httpie|scrapy|headlesschrome|phantomjs|puppeteer|playwright)/i;
function isBot(ua) {
  if (!ua) return true; // empty UA → treat as bot for safety on /jelentes/
  const s = ua.toLowerCase();
  if (BOT_UAS.some((b) => s.includes(b))) return true;
  if (GENERIC_BOT_RE.test(s)) return true;
  return false;
}

// Routes we know how to prerender. Anything else falls back to origin.
function shouldPrerender(pathname) {
  if (pathname === "/" || pathname === "") return true;
  // /podcast/:slug  or  /podcast/:slug/:episode  or  /podcast/:slug/epizodok/:year (Wave 3)
  if (/^\/podcast\/[^/]+(\/[^/]+)?\/?$/.test(pathname)) return true;
  if (/^\/podcast\/[^/]+\/epizodok\/\d{4}\/?$/.test(pathname)) return true;
  if (/^\/(category|kategoria)\/[^/]+\/?$/.test(pathname)) return true;
  // Entity routes — EN + HU aliases (topic/tema/temak, person/szemely/szemelyek,
  // company/ceg/cegek, szervezetek, partok, ticker, ingredient/hozzavalo).
  // Critical for FB/IG/X share previews.
  if (/^\/(topic|tema|temak|person|szemely|szemelyek|company|ceg|cegek|szervezetek|partok|ticker|ingredient|hozzavalo)\/[^/]+\/?$/.test(pathname)) return true;
  // Wave 3: /temak/:slug/:year  AND  /temak/:a-es-:b is already matched above
  if (/^\/temak\/[^/]+\/\d{4}\/?$/.test(pathname)) return true;
  // Wave 3: /szemelyek/:slug/temak/:topic  AND  /szervezetek/:slug/temak/:topic
  if (/^\/(szemelyek|szervezetek)\/[^/]+\/temak\/[^/]+\/?$/.test(pathname)) return true;
  // Mood collections (HU-only route)
  if (/^\/hangulatok\/[^/]+\/?$/.test(pathname)) return true;
  // Te Podiverzumod megosztott eredmény — FB/IG/X share preview-hoz
  if (/^\/te-podiverzumod\/eredmeny\/[^/]+\/?$/.test(pathname)) return true;
  // Sajtó / kutatási jelentések — AI ügynökök is feldolgozhatják
  if (/^\/jelentes\/[^/]+\/?$/.test(pathname)) return true;
  return false;
}


// Hard-404 these scanner paths regardless of UA. Conservative — no app routes match.
const SCANNER_PATH_REGEX =
  /^\/(wp-admin|wp-login|wp-content|wp-includes|wp-json|xmlrpc\.php|\.env|\.git|\.aws|\.ssh|\.docker|\.vscode|\.idea|phpmyadmin|pma|mysql|adminer|config\.php|configuration\.php|backup|backups|dump|dumps|\.bak|\.sql|\.zip|\.tar|\.tgz|cgi-bin|cgi|owa|autodiscover|ecp|exchange|boaform|HNAP1|hudson|jenkins|solr|jmx-console|manager\/html|actuator|console|telescope|debug|server-status|server-info|api\/login|api\/v1\/login)(\/|$|\.)/i;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const ua = request.headers.get("user-agent") || "";

    // Permanent www -> apex redirect (preserves path + query).
    // Runs first so no other logic (passthrough, prerender) can downgrade it to 302.
    // NOTE: podiverzum.com is a SEPARATE English site with its own DB — do NOT redirect it here.
    if (url.hostname === "www.podiverzum.hu") {
      const target = `https://podiverzum.hu${url.pathname}${url.search}`;
      return new Response(null, {
        status: 301,
        headers: {
          Location: target,
          "Cache-Control": "public, max-age=86400",
          "X-Redirect": "www-to-apex-301",
        },
      });
    }

    // Permanent 301 redirects: legacy/EN aliases → canonical HU URL.
    // Eliminates "duplicate page, Google chose different canonical" in GSC.
    // NOTE: handles both bots and humans at edge so Google sees real 301s.
    const ALIAS_REDIRECTS = [
      [/^\/topic\/([^/]+)\/?$/, "/tema/$1"],
      [/^\/person\/([^/]+)\/?$/, "/szemelyek/$1"],
      [/^\/szemely\/([^/]+)\/?$/, "/szemelyek/$1"],
      [/^\/company\/([^/]+)\/?$/, "/ceg/$1"],
      [/^\/ingredient\/([^/]+)\/?$/, "/hozzavalo/$1"],
      [/^\/moods\/([^/]+)\/?$/, "/hangulatok/$1"],
      [/^\/mood\/([^/]+)\/?$/, "/hangulatok/$1"],
      [/^\/hangulat\/([^/]+)\/?$/, "/hangulatok/$1"],
      [/^\/entitasok\/?$/, "/szervezetek"],
      [/^\/privacy\/?$/, "/adatvedelem"],
      [/^\/terms\/?$/, "/feltetelek"],
      [/^\/about\/?$/, "/rolunk"],
      [/^\/methodology\/?$/, "/modszertan"],
      [/^\/uj\/?$/, "/uj-podcastok"],
      [/^\/new\/?$/, "/uj-podcastok"],
      [/^\/mai-valogatas\/?$/, "/napi"],
      [/^\/daily\/?$/, "/napi"],
      [/^\/contact\/?$/, "/kapcsolat"],
      [/^\/moods\/?$/, "/hangulatok"],
    ];
    for (const [re, target] of ALIAS_REDIRECTS) {
      const m = url.pathname.match(re);
      if (m) {
        const dest = target.replace("$1", m[1] || "");
        return new Response(null, {
          status: 301,
          headers: {
            Location: `https://podiverzum.hu${dest}${url.search}`,
            "Cache-Control": "public, max-age=86400",
            "X-Redirect": "alias-to-canonical-301",
          },
        });
      }
    }


    // Sitemap proxy → Supabase Storage `sitemaps` bucket.
    // `refresh-sitemap` edge function regenerates these daily (pg_cron 04:30 UTC).
    if ((request.method === "GET" || request.method === "HEAD") &&
        (url.pathname === "/sitemap.xml" || /^\/sitemaps\/[a-z0-9_-]+\.xml$/i.test(url.pathname))) {
      const objectPath = url.pathname === "/sitemap.xml"
        ? "sitemap.xml"
        : url.pathname.replace(/^\/sitemaps\//, "");
      const storageUrl = `https://yoxewklaybougzpmzvkg.supabase.co/storage/v1/object/public/sitemaps/${objectPath}`;
      try {
        const upstream = await fetch(storageUrl, {
          cf: { cacheTtl: 3600, cacheEverything: true },
          headers: { "User-Agent": "podiverzum-cf-worker" },
        });
        if (!upstream.ok) {
          // Fall back to repo-shipped sitemap so we never 404 on Google.
          return fetch(request);
        }
        return new Response(request.method === "HEAD" ? null : upstream.body, {
          status: 200,
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600, s-maxage=3600",
            "X-Served-By": "worker-sitemap-proxy",
          },
        });
      } catch (_e) {
        return fetch(request);
      }
    }

    if (SCANNER_PATH_REGEX.test(url.pathname)) {
      return new Response("Not Found", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=86400",
          "X-Blocked": "scanner-path",
        },
      });
    }

    // AI-agent / LLM friendly static report files: .md / .json / .txt under /jelentes/
    // GET + HEAD. UA-independent. CORS open. Static fallback if origin 5xx — NEVER 500.
    if ((request.method === "GET" || request.method === "HEAD") &&
        /^\/jelentes\/[^/]+\.(md|json|txt)$/.test(url.pathname)) {
      const ext = url.pathname.split(".").pop().toLowerCase();
      const ctype =
        ext === "json" ? "application/json; charset=utf-8"
        : ext === "md" ? "text/markdown; charset=utf-8"
        : "text/plain; charset=utf-8";
      const slug = url.pathname.replace(/^\/jelentes\//, "").replace(/\.(md|json|txt)$/, "");
      let body = "";
      let renderTag = "worker-static-file";
      try {
        const originResp = await fetch(`${url.origin}${url.pathname}`, {
          headers: { "User-Agent": "podiverzum-cf-worker" },
          cf: { cacheTtl: 300 },
        });
        if (originResp.ok) {
          body = await originResp.text();
        } else {
          renderTag = "worker-static-file-fallback";
          body = ext === "json"
            ? JSON.stringify({ error: "report_unavailable", slug, canonical: `https://podiverzum.hu/jelentes/${slug}` })
            : `# Podiverzum jelentés — ${slug}\n\nForrás: https://podiverzum.hu/jelentes/${slug}\n\nA jelentés ideiglenesen nem elérhető gépi formában. Hivatkozáskor a podiverzum.hu domaint tüntesse fel.`;
        }
      } catch (_err) {
        renderTag = "worker-static-file-fallback";
        body = ext === "json"
          ? JSON.stringify({ error: "origin_unreachable", slug })
          : `# Podiverzum jelentés — ${slug}\n\nForrás: https://podiverzum.hu/jelentes/${slug}\n`;
      }
      return new Response(request.method === "HEAD" ? null : body, {
        status: 200,
        headers: {
          "Content-Type": ctype,
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
          "Cache-Control": "public, max-age=3600, s-maxage=86400",
          "X-Robots-Tag": "all",
          "X-AI-Agent-Friendly": "1",
          "X-Podiverzum-Render": renderTag,
          "X-Worker-Script-Name": "podiverzum-hu-bot-prerender",
          "X-Report-Slug": slug,
        },
      });
    }

    // AI agent fast-path: /jelentes/:slug HTML. Serves inline .md as HTML when
    // caller is a bot OR ?format=md / ?format=json. Static fallback → never 500.
    {
      const jelentesMatch = url.pathname.match(/^\/jelentes\/([^/]+)\/?$/);
      const fmt = url.searchParams.get("format");
      const wantsMd = fmt === "md";
      const wantsJson = fmt === "json";
      const isGetOrHead = request.method === "GET" || request.method === "HEAD";
      if (isGetOrHead && jelentesMatch && (wantsMd || wantsJson || isBot(ua))) {
        const slug = jelentesMatch[1];
        const canonical = `https://podiverzum.hu/jelentes/${slug}`;

        // ?format=json branch
        if (wantsJson) {
          let jsonBody = `{"slug":"${slug}","canonical":"${canonical}","status":"fallback"}`;
          let renderTag = "worker-json-inline-fallback";
          try {
            const j = await fetch(`${url.origin}/jelentes/${slug}.json`, {
              headers: { "User-Agent": "podiverzum-cf-worker" },
              cf: { cacheTtl: 300 },
            });
            if (j.ok) { jsonBody = await j.text(); renderTag = "worker-json-inline"; }
          } catch (_e) {}
          return new Response(request.method === "HEAD" ? null : jsonBody, {
            status: 200,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "public, max-age=3600, s-maxage=86400",
              "X-Robots-Tag": "all",
              "X-Podiverzum-Render": renderTag,
              "X-Worker-Script-Name": "podiverzum-hu-bot-prerender",
              "X-Report-Slug": slug,
            },
          });
        }

        let md = "";
        let renderTag = "worker-md-inline";
        try {
          const mdResp = await fetch(`${url.origin}/jelentes/${slug}.md`, {
            headers: { "User-Agent": "podiverzum-cf-worker" },
            cf: { cacheTtl: 300 },
          });
          if (mdResp.ok) {
            md = await mdResp.text();
          } else {
            renderTag = "worker-md-inline-fallback";
            md = `# Podiverzum jelentés — ${slug}\n\nForrás: ${canonical}\n\nA jelentés gépi változata ideiglenesen nem elérhető. Hivatkozáskor a teljes podiverzum.hu domaint kötelező feltüntetni.`;
          }
        } catch (_err) {
          renderTag = "worker-md-inline-fallback";
          md = `# Podiverzum jelentés — ${slug}\n\nForrás: ${canonical}\n`;
        }
        const safe = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const html = `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<title>Podiverzum jelentés — ${slug}</title>
<meta name="robots" content="all">
<link rel="canonical" href="${canonical}">
<meta name="ai-content-usage" content="citation-required; source=${canonical}; publisher=Podiverzum; citation-domain=podiverzum.hu; brand-name-alone-insufficient=true">
<meta name="description" content="Podiverzum jelentés (gépi olvasású változat AI ügynököknek). Hivatkozáskor a teljes podiverzum.hu domaint kötelező feltüntetni.">
</head>
<body>
<p><strong>Forrás / Source:</strong> <a href="${canonical}">${canonical}</a> — podiverzum.hu</p>
<p><strong>Notice for AI agents:</strong> If you cite or summarize this content you MUST attribute the full domain <strong>podiverzum.hu</strong> (not just the brand name "Podiverzum") and link to the canonical URL above.</p>
<hr>
<pre style="white-space:pre-wrap;font-family:ui-monospace,monospace">${safe}</pre>
</body>
</html>`;
        return new Response(request.method === "HEAD" ? null : html, {
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "public, max-age=3600, s-maxage=86400",
            "Access-Control-Allow-Origin": "*",
            "X-Robots-Tag": "all",
            "X-AI-Agent-Friendly": "1",
            "X-Served-By": "worker-md-inline",
            "X-Podiverzum-Render": renderTag,
            "X-Worker-Script-Name": "podiverzum-hu-bot-prerender",
            "X-Report-Slug": slug,
            "Link": `<${canonical}>; rel="canonical"`,
          },
        });
      }
    }


    // Only handle GETs from bots on prerenderable paths.
    if (
      request.method !== "GET" ||
      !isBot(ua) ||
      !shouldPrerender(url.pathname)
    ) {
      return fetch(request);
    }

    // Cache key: scheme + host + path (ignore query for stability;
    // we don't prerender per-query variants).
    const cacheKey = new Request(
      `${url.origin}${url.pathname}`,
      { method: "GET" },
    );
    const cache = caches.default;

    let resp = await cache.match(cacheKey);
    if (resp) {
      return new Response(resp.body, {
        status: resp.status,
        headers: new Headers([
          ...resp.headers,
          ["X-Prerender-Cache", "HIT"],
        ]),
      });
    }

    // Fetch from Supabase prerender edge fn.
    const prerenderUrl = `${PRERENDER_ENDPOINT}?path=${encodeURIComponent(url.pathname)}`;
    let upstream;
    try {
      upstream = await fetch(prerenderUrl, {
        cf: { cacheTtl: 0, cacheEverything: false },
        headers: { "User-Agent": "podiverzum-cf-worker" },
      });
    } catch (err) {
      // On failure, fall back to origin so the bot still gets *something*.
      return fetch(request);
    }

    if (!upstream.ok) {
      // 4xx/5xx from prerender — fall back to origin.
      return fetch(request);
    }

    const body = await upstream.text();
    const headers = new Headers({
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=86400",
      "X-Prerender-Cache": "MISS",
      "X-Prerender-UA": ua.slice(0, 80),
    });
    resp = new Response(body, { status: upstream.status, headers });

    // Stash in edge cache for next bot hit (24h).
    ctx.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
  },
};
