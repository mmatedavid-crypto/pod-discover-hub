// Centralized bot detection for AI-cost gating on user-facing edge functions.
// Goal: never spend LLM / Cohere / Gemini tokens on requests from crawlers,
// scrapers, link-preview bots, AI training crawlers, headless browsers, or
// monitoring agents. Real users get the full quality-first path; bots get a
// cheap deterministic fallback.
//
// Strategy: user-agent regex is the primary signal. We err on the side of
// classifying as bot — false positives only mean "no AI summary", which is
// graceful. False negatives mean wasted spend.
//
// We INTENTIONALLY include common AI training crawlers (GPTBot, ClaudeBot,
// PerplexityBot, CCBot, Anthropic, Google-Extended) so they cannot drain the
// AI budget by hammering /search. They can still index static prerendered
// pages via the prerender pipeline.

const BOT_RX =
  /bot|crawler|spider|crawling|googlebot|bingbot|yandex|baidu|duckduckbot|slurp|sogou|exabot|facebookexternalhit|facebookbot|twitterbot|linkedinbot|whatsapp|telegrambot|skypeuripreview|discordbot|slackbot|vkshare|tumblr|pinterest|redditbot|applebot|petalbot|semrushbot|ahrefsbot|mj12bot|dotbot|seznambot|bytespider|amazonbot|google-extended|gptbot|chatgpt-user|oai-searchbot|claudebot|claude-web|anthropic-ai|perplexitybot|perplexity|youbot|ccbot|cohere-ai|diffbot|screaming frog|sitebulb|lighthouse|chrome-lighthouse|pagespeed|gtmetrix|pingdom|uptimerobot|statuscake|monitis|datadog|newrelic|prerender|headless|phantomjs|puppeteer|playwright|selenium|httrack|wget|curl\/|python-requests|node-fetch|axios|go-http-client|scrapy/i;

// Hint-only check: real browsers omit these. Some scrapers spoof UA but still
// send no Accept-Language or no Sec-Fetch-* headers.
function hasBrowserShape(req: Request): boolean {
  const accept = req.headers.get("accept") || "";
  const accLang = req.headers.get("accept-language") || "";
  // SSR / prerender requests obviously don't have these, but they're served by
  // the prerender pipeline, not user-facing search.
  return accept.length > 0 && accLang.length > 0;
}

export type BotCheck = {
  isBot: boolean;
  reason: "ua" | "ai_crawler" | "no_browser_shape" | "user";
  ua: string;
};

const AI_CRAWLER_RX =
  /gptbot|chatgpt-user|oai-searchbot|claudebot|claude-web|anthropic-ai|perplexitybot|perplexity|youbot|ccbot|cohere-ai|google-extended|bytespider|amazonbot/i;

export function detectBot(req: Request): BotCheck {
  const ua = (req.headers.get("user-agent") || "").toLowerCase();
  if (!ua) return { isBot: true, reason: "ua", ua };
  if (AI_CRAWLER_RX.test(ua)) return { isBot: true, reason: "ai_crawler", ua };
  if (BOT_RX.test(ua)) return { isBot: true, reason: "ua", ua };
  if (!hasBrowserShape(req)) return { isBot: true, reason: "no_browser_shape", ua };
  return { isBot: false, reason: "user", ua };
}

export function isBotRequest(req: Request): boolean {
  return detectBot(req).isBot;
}
