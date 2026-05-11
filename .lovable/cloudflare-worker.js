// Podiverzum bot prerender Worker
// - Bot UA detection → fetch from Supabase prerender edge function
// - Human UA → passthrough to Lovable origin
// - Cloudflare Cache API: 1h TTL on prerendered responses
// - Fail-safe: any prerender error or non-2xx → passthrough (never break the site)

const PRERENDER_ENDPOINT =
  "https://iqzkayoqqagowvxeaphe.supabase.co/functions/v1/prerender";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxemtheW9xcWFnb3d2eGVhcGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDA3NzAsImV4cCI6MjA5MzU3Njc3MH0.KaeRcYcljGjrP_OAcTp_lapPSRsAYRq6gPJ2vYV7fz4";

// Known malicious-scanner paths. We return a hard 404 (no body, no SPA shell)
// so analytics/scanners stop seeing 200s for /wp-admin etc.
// IMPORTANT: tested against real routes — none of these collide with app routes.
const SCANNER_PATH_REGEX =
  /^\/(wp-admin|wp-login|wp-content|wp-includes|wp-json|xmlrpc\.php|\.env|\.git|\.aws|\.ssh|\.docker|\.vscode|\.idea|phpmyadmin|pma|mysql|adminer|config\.php|configuration\.php|\.well-known\/security\.txt$|backup|backups|dump|dumps|\.bak|\.sql|\.zip|\.tar|\.tgz|cgi-bin|cgi|owa|autodiscover|ecp|exchange|boaform|HNAP1|hudson|jenkins|solr|jmx-console|manager\/html|actuator|console|telescope|debug|server-status|server-info|api\/login|api\/v1\/login)(\/|$|\.)/i;

// Bot UAs that don't execute JS (or benefit from instant HTML)
const BOT_UA_REGEX =
  /(GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-Web|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|Applebot-Extended|Bytespider|Meta-ExternalAgent|Meta-ExternalFetcher|facebookexternalhit|DuckAssistBot|CCBot|YouBot|Diffbot|Googlebot|Bingbot|DuckDuckBot|YandexBot|Twitterbot|LinkedInBot|Slackbot|WhatsApp|TelegramBot|Discordbot|SemrushBot|AhrefsBot|MJ12bot)/i;

// Only prerender these path patterns (anything else passes through even for bots)
function isPrerenderablePath(pathname) {
  if (pathname === "/" || pathname === "") return true;
  if (/^\/podcast\/[^\/]+\/?$/.test(pathname)) return true;
  if (/^\/podcast\/[^\/]+\/[^\/]+\/?$/.test(pathname)) return true;
  if (/^\/category\/[^\/]+\/?$/.test(pathname)) return true;
  if (/^\/(topic|person|company|ticker|ingredient)\/[^\/]+\/?$/.test(pathname))
    return true;
  return false;
}

async function passthrough(request) {
  const res = await fetch(request);
  const headers = new Headers(res.headers);
  headers.set("X-Worker", "podiverzum-bot-prerender");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function fetchPrerender(pathname, controller) {
  const url = `${PRERENDER_ENDPOINT}?path=${encodeURIComponent(pathname)}`;
  const res = await fetch(url, {
    headers: {
      apikey: SUPABASE_ANON,
      Authorization: `Bearer ${SUPABASE_ANON}`,
    },
    signal: controller.signal,
    cf: { cacheTtl: 0 }, // we manage cache ourselves
  });
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const ua = request.headers.get("User-Agent") || "";
    const isBot = BOT_UA_REGEX.test(ua);

    // Hard-404 known scanner paths BEFORE anything else (cheap, no origin hit).
    // Regex is conservative — verified no real app route matches.
    if (SCANNER_PATH_REGEX.test(url.pathname)) {
      return new Response("Not Found", {
        status: 404,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "public, max-age=86400",
          "X-Worker": "podiverzum-bot-prerender",
          "X-Blocked": "scanner-path",
        },
      });
    }

    // Non-GET / non-HEAD: never prerender
    if (request.method !== "GET" && request.method !== "HEAD") {
      return passthrough(request);
    }

    // Proxy /sitemap.xml and /feed.xml to Supabase edge functions.
    // /sitemap.xml → dynamic sitemap-index (core + podcasts + per-month episodes)
    // /feed.xml    → recent-episodes RSS
    // Both are cached at the edge (1h sitemap, 15m feed) so origin hits are minimal.
    if (url.pathname === "/sitemap.xml" || url.pathname === "/feed.xml") {
      const upstream =
        url.pathname === "/sitemap.xml"
          ? "https://iqzkayoqqagowvxeaphe.supabase.co/functions/v1/sitemap"
          : "https://iqzkayoqqagowvxeaphe.supabase.co/functions/v1/feed-xml";
      const cacheKey = new Request(`https://proxy-cache.podiverzum.com${url.pathname}`, { method: "GET" });
      const cache = caches.default;
      const hit = await cache.match(cacheKey);
      if (hit) {
        const h = new Headers(hit.headers);
        h.set("X-Worker", "podiverzum-bot-prerender");
        h.set("X-Proxy-Cache", "HIT");
        return new Response(hit.body, { status: hit.status, headers: h });
      }
      try {
        const res = await fetch(upstream, {
          headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
          cf: { cacheTtl: 0 },
        });
        if (!res.ok) return passthrough(request);
        const body = await res.text();
        const ttl = url.pathname === "/sitemap.xml" ? 3600 : 900;
        const ct =
          url.pathname === "/sitemap.xml"
            ? "application/xml; charset=utf-8"
            : "application/rss+xml; charset=utf-8";
        const headers = new Headers({
          "Content-Type": ct,
          "Cache-Control": `public, max-age=${ttl}`,
          "X-Worker": "podiverzum-bot-prerender",
          "X-Proxy-Cache": "MISS",
        });
        const response = new Response(body, { status: 200, headers });
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
      } catch {
        return passthrough(request);
      }
    }

    // Not a bot, or path not prerenderable → straight to origin
    if (!isBot || !isPrerenderablePath(url.pathname)) {
      return passthrough(request);
    }

    // Bot + prerenderable path: try cache → prerender → fallback origin
    const cacheKey = new Request(
      `https://prerender-cache.podiverzum.com${url.pathname}`,
      { method: "GET" },
    );
    const cache = caches.default;

    let cached = await cache.match(cacheKey);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("X-Prerender-Cache", "HIT");
      return new Response(cached.body, {
        status: cached.status,
        headers,
      });
    }

    // Cache miss → call prerender with 4s timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    try {
      const res = await fetchPrerender(url.pathname, controller);
      clearTimeout(timeout);

      if (!res.ok) {
        // 404 / 5xx from prerender → passthrough origin
        return passthrough(request);
      }

      const body = await res.text();
      const headers = new Headers({
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        Vary: "User-Agent",
        "X-Prerendered": "1",
        "X-Prerender-Cache": "MISS",
      });

      const response = new Response(body, { status: 200, headers });

      // Cache for 1h (clone before returning)
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    } catch (err) {
      clearTimeout(timeout);
      // Timeout / network error → passthrough
      return passthrough(request);
    }
  },
};
