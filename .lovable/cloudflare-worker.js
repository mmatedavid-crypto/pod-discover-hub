// Podiverzum bot prerender Worker
// - Bot UA detection → fetch from Supabase prerender edge function
// - Human UA → passthrough to Lovable origin
// - Cloudflare Cache API: 1h TTL on prerendered responses
// - Fail-safe: any prerender error or non-2xx → passthrough (never break the site)

const PRERENDER_ENDPOINT =
  "https://iqzkayoqqagowvxeaphe.supabase.co/functions/v1/prerender";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxemtheW9xcWFnb3d2eGVhcGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDA3NzAsImV4cCI6MjA5MzU3Njc3MH0.KaeRcYcljGjrP_OAcTp_lapPSRsAYRq6gPJ2vYV7fz4";

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

    // Non-GET / non-HEAD: never prerender
    if (request.method !== "GET" && request.method !== "HEAD") {
      return passthrough(request);
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
