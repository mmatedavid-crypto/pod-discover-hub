// Single source of truth for client-side crawler/bot detection.
// Used by first-party analytics (PageViewTracker → Supabase `page_events`)
// and by the PostHog product-analytics layer, so both agree on what a
// "human" visitor is.

export const BOT_UA_RX =
  /bot|crawler|spider|slurp|bingpreview|chatgpt|gptbot|claudebot|perplexity|applebot|duckassist|cohere|facebookexternalhit|whatsapp|telegrambot|linkedinbot|twitterbot|discordbot|ia_archiver|headlesschrome|prerender/i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  return BOT_UA_RX.test(ua || "");
}

export function isBotClient(): boolean {
  if (typeof navigator === "undefined") return true;
  try {
    if (isBotUserAgent(navigator.userAgent)) return true;
    if ((navigator as unknown as { webdriver?: boolean }).webdriver === true) return true;
  } catch {
    /* ignore */
  }
  return false;
}
