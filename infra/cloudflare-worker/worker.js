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
];

function isBot(ua) {
  if (!ua) return false;
  const s = ua.toLowerCase();
  return BOT_UAS.some((b) => s.includes(b));
}

// Routes we know how to prerender. Anything else falls back to origin.
function shouldPrerender(pathname) {
  if (pathname === "/" || pathname === "") return true;
  // /podcast/:slug  or  /podcast/:slug/:episode
  if (/^\/podcast\/[^/]+(\/[^/]+)?\/?$/.test(pathname)) return true;
  if (/^\/(category|kategoria)\/[^/]+\/?$/.test(pathname)) return true;
  // Entity routes — EN + HU aliases (topic/tema, person/szemely, company/ceg,
  // ticker, ingredient/hozzavalo). Critical for FB/Twitter share previews.
  if (/^\/(topic|tema|person|szemely|company|ceg|ticker|ingredient|hozzavalo)\/[^/]+\/?$/.test(pathname)) return true;
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
