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

function isBot(ua) {
  if (!ua) return false;
  const s = ua.toLowerCase();
  return BOT_UAS.some((b) => s.includes(b));
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

    // AI-agent / LLM friendly static report files: .md and .json under /jelentes/
    // Force correct Content-Type + permissive CORS so ChatGPT / Claude / Perplexity
    // / Gemini agents (and any third-party script) can fetch them cross-origin.
    // Bypasses bot-prerender entirely — these are already machine-readable.
    if (request.method === "GET" && /^\/jelentes\/[^/]+\.(md|json|txt)$/.test(url.pathname)) {
      const originResp = await fetch(request);
      const ext = url.pathname.split(".").pop().toLowerCase();
      const ctype =
        ext === "json" ? "application/json; charset=utf-8"
        : ext === "md" ? "text/markdown; charset=utf-8"
        : "text/plain; charset=utf-8";
      const headers = new Headers(originResp.headers);
      headers.set("Content-Type", ctype);
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
      headers.set("X-Robots-Tag", "all");
      headers.set("X-AI-Agent-Friendly", "1");
      return new Response(originResp.body, {
        status: originResp.status,
        headers,
      });
    }

    // AI agent fast-path: for /jelentes/:slug HTML requests, if the caller is
    // a bot OR explicitly asks via ?format=md, serve the .md content inline
    // wrapped in minimal HTML. This bypasses the SPA + any origin/CF challenge
    // that may block non-browser UAs from getting real content.
    {
      const jelentesMatch = url.pathname.match(/^\/jelentes\/([^/]+)\/?$/);
      const wantsMd = url.searchParams.get("format") === "md";
      if (
        request.method === "GET" &&
        jelentesMatch &&
        (wantsMd || isBot(ua))
      ) {
        const slug = jelentesMatch[1];
        const mdUrl = `${url.origin}/jelentes/${slug}.md`;
        try {
          const mdResp = await fetch(mdUrl, {
            headers: { "User-Agent": "podiverzum-cf-worker" },
          });
          if (mdResp.ok) {
            const md = await mdResp.text();
            const safe = md
              .replace(/&/g, "&amp;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
            const canonical = `https://podiverzum.hu/jelentes/${slug}`;
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
            return new Response(html, {
              status: 200,
              headers: {
                "Content-Type": "text/html; charset=utf-8",
                "Cache-Control": "public, max-age=3600, s-maxage=86400",
                "Access-Control-Allow-Origin": "*",
                "X-Robots-Tag": "all",
                "X-AI-Agent-Friendly": "1",
                "X-Served-By": "worker-md-inline",
                "Link": `<${canonical}>; rel="canonical"`,
              },
            });
          }
        } catch (_err) {
          // Fall through to normal prerender / passthrough.
        }
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
