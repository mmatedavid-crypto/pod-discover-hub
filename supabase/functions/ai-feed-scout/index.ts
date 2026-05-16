// AI podcast scout: Firecrawl scrape → Gemini extract → PodcastIndex validate → pi_feed_staging.
// Body: { sources?: string[], lang?: 'en'|'hu'|'all', model?: string, max_per_source?: number, dry_run?: boolean }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Curated default seeds. Each source declares its expected language so we
// don't accidentally mix English shows into Hungarian sources (or vice versa).
// lang_hint: ISO-639-1 ("en", "hu") — used in the Gemini prompt and validated
// against the PodcastIndex `language` field.
// EN-only scouting for now. We're not actively hunting HU feeds — if a HU
// podcast accidentally appears in an EN source it will be stored with its
// real language and silently skipped from the EN site (see multilingual plan).
const DEFAULT_SOURCES: { url: string; tag: string; lang_hint: string }[] = [
  // Apple Podcasts HU — overall + genre charts
  { url: "https://podcasts.apple.com/hu/charts", tag: "apple-hu-charts", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-business/id1321", tag: "apple-hu-business", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-news/id1311", tag: "apple-hu-news", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-technology/id1318", tag: "apple-hu-tech", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-sports/id1545", tag: "apple-hu-sports", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-comedy/id1303", tag: "apple-hu-comedy", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-education/id1304", tag: "apple-hu-education", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-health-fitness/id1512", tag: "apple-hu-health", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-society-culture/id1324", tag: "apple-hu-society", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-science/id1533", tag: "apple-hu-science", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-history/id1487", tag: "apple-hu-history", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-tv-film/id1309", tag: "apple-hu-tv-film", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-arts/id1301", tag: "apple-hu-arts", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-music/id1310", tag: "apple-hu-music", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-leisure/id1502", tag: "apple-hu-leisure", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-true-crime/id1488", tag: "apple-hu-true-crime", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-religion-spirituality/id1314", tag: "apple-hu-religion", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-fiction/id1483", tag: "apple-hu-fiction", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-kids-family/id1305", tag: "apple-hu-kids", lang_hint: "hu" },
  // Spotify HU charts (ha elérhető)
  { url: "https://podcastcharts.byspotify.com/hu", tag: "spotify-charts-hu", lang_hint: "hu" },
  // Magyar média podcast oldalak
  { url: "https://hvg.hu/podcastok", tag: "media-hvg", lang_hint: "hu" },
  { url: "https://index.hu/podcast/", tag: "media-index", lang_hint: "hu" },
  { url: "https://telex.hu/podcastok", tag: "media-telex", lang_hint: "hu" },
  { url: "https://444.hu/cimke/podcast", tag: "media-444", lang_hint: "hu" },
  { url: "https://24.hu/podcastok/", tag: "media-24", lang_hint: "hu" },
  { url: "https://nepszava.hu/podcast", tag: "media-nepszava", lang_hint: "hu" },
  { url: "https://magyarnemzet.hu/cimke/podcast", tag: "media-magyarnemzet", lang_hint: "hu" },
  { url: "https://www.portfolio.hu/podcast", tag: "media-portfolio", lang_hint: "hu" },
  { url: "https://hang.hu/podcastok", tag: "media-hang", lang_hint: "hu" },
  { url: "https://atv.hu/podcast", tag: "media-atv", lang_hint: "hu" },
  { url: "https://rtl.hu/podcast", tag: "media-rtl", lang_hint: "hu" },
  { url: "https://www.partizan.hu/podcastok", tag: "media-partizan", lang_hint: "hu" },
  { url: "https://merce.hu/podcast/", tag: "media-merce", lang_hint: "hu" },
  // Magyar közmédia & rádiók
  { url: "https://mediaklikk.hu/musor/podcastok/", tag: "pub-mediaklikk", lang_hint: "hu" },
  { url: "https://radio.hu/podcastok", tag: "pub-radio-hu", lang_hint: "hu" },
  { url: "https://infostart.hu/podcast", tag: "radio-inforadio", lang_hint: "hu" },
  { url: "https://www.klubradio.hu/musorok", tag: "radio-klubradio", lang_hint: "hu" },
  { url: "https://www.spirit.hu/podcastok", tag: "radio-spirit", lang_hint: "hu" },
  // Szakmai / niche magyar média
  { url: "https://g7.hu/cimke/podcast/", tag: "media-g7", lang_hint: "hu" },
  { url: "https://forbes.hu/cimke/podcast/", tag: "media-forbes", lang_hint: "hu" },
  { url: "https://qubit.hu/cimke/podcast", tag: "media-qubit", lang_hint: "hu" },
  { url: "https://valaszonline.hu/category/podcast/", tag: "media-valasz", lang_hint: "hu" },
  { url: "https://mandiner.hu/cimke/podcast", tag: "media-mandiner", lang_hint: "hu" },
  { url: "https://www.azonnali.hu/cimke/podcast", tag: "media-azonnali", lang_hint: "hu" },
  { url: "https://24.hu/szorakozas/podcast/", tag: "media-24-szorakozas", lang_hint: "hu" },
  // Erdélyi magyar nyelvű média
  { url: "https://maszol.ro/podcast", tag: "media-maszol-ro", lang_hint: "hu" },
  { url: "https://transtelex.ro/podcast", tag: "media-transtelex-ro", lang_hint: "hu" },
  // Aggregátorok / podcast directory-k (HU szűrővel)
  { url: "https://podtail.com/hu/top-podcasts/", tag: "agg-podtail-hu", lang_hint: "hu" },
  { url: "https://www.listennotes.com/podcasts/?language=Hungarian", tag: "agg-listennotes-hu", lang_hint: "hu" },
  { url: "https://www.podme.com/hu", tag: "agg-podme-hu", lang_hint: "hu" },
  // Wikipedia HU lista
  { url: "https://hu.wikipedia.org/wiki/Magyar_podcastok_list%C3%A1ja", tag: "wiki-hu-podcasts", lang_hint: "hu" },

  // --- Aggressive HU expansion 2026-05-15 ---
  // Apple sub-genres (granular)
  { url: "https://podcasts.apple.com/hu/genre/podcasts-business-careers/id1410", tag: "apple-hu-careers", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-business-entrepreneurship/id1480", tag: "apple-hu-entrepreneurship", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-business-investing/id1412", tag: "apple-hu-investing", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-business-marketing/id1413", tag: "apple-hu-marketing", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-business-management/id1490", tag: "apple-hu-management", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-news-politics/id1313", tag: "apple-hu-politics", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-news-daily/id1530", tag: "apple-hu-daily-news", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-society-culture-personal-journals/id1417", tag: "apple-hu-personal", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-society-culture-philosophy/id1525", tag: "apple-hu-philosophy", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-society-culture-relationships/id1526", tag: "apple-hu-relationships", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-comedy-improv/id1495", tag: "apple-hu-improv", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-comedy-interviews/id1496", tag: "apple-hu-comedy-iv", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-comedy-stand-up/id1497", tag: "apple-hu-standup", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-education-courses/id1471", tag: "apple-hu-courses", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-education-self-improvement/id1474", tag: "apple-hu-self-improvement", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-education-language-learning/id1469", tag: "apple-hu-language", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-health-fitness-mental-health/id1517", tag: "apple-hu-mental", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-health-fitness-nutrition/id1518", tag: "apple-hu-nutrition", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-sports-football/id1547", tag: "apple-hu-football", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-sports-soccer/id1553", tag: "apple-hu-soccer", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-tech-news/id1448", tag: "apple-hu-technews", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-arts-books/id1482", tag: "apple-hu-books", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-arts-design/id1402", tag: "apple-hu-design", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-arts-food/id1306", tag: "apple-hu-food", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-arts-performing-arts/id1405", tag: "apple-hu-performing", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-arts-visual-arts/id1406", tag: "apple-hu-visual", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-history-documentary-history/id1485", tag: "apple-hu-doc-history", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-leisure-hobbies/id1500", tag: "apple-hu-hobbies", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-leisure-games/id1501", tag: "apple-hu-games", lang_hint: "hu" },
  { url: "https://podcasts.apple.com/hu/genre/podcasts-leisure-video-games/id1545", tag: "apple-hu-videogames", lang_hint: "hu" },

  // Hungarian media sites — additional outlets
  { url: "https://nepszava.hu/cimke/podcast", tag: "media-nepszava-2", lang_hint: "hu" },
  { url: "https://168.hu/podcast", tag: "media-168", lang_hint: "hu" },
  { url: "https://magyarhang.org/podcast", tag: "media-magyarhang", lang_hint: "hu" },
  { url: "https://szabadeuropa.hu/podcasts", tag: "media-szabadeuropa", lang_hint: "hu" },
  { url: "https://24.hu/belfold/podcast/", tag: "media-24-belfold", lang_hint: "hu" },
  { url: "https://24.hu/kulfold/podcast/", tag: "media-24-kulfold", lang_hint: "hu" },
  { url: "https://24.hu/tudomany/podcast/", tag: "media-24-tudomany", lang_hint: "hu" },
  { url: "https://hvg.hu/itthon/podcast", tag: "media-hvg-itthon", lang_hint: "hu" },
  { url: "https://hvg.hu/gazdasag/podcast", tag: "media-hvg-gazdasag", lang_hint: "hu" },
  { url: "https://hvg.hu/tudomany/podcast", tag: "media-hvg-tudomany", lang_hint: "hu" },
  { url: "https://telex.hu/legfrissebb?tag=podcast", tag: "media-telex-tag", lang_hint: "hu" },
  { url: "https://www.napi.hu/cimke/podcast", tag: "media-napi", lang_hint: "hu" },
  { url: "https://www.vg.hu/cimke/podcast", tag: "media-vg", lang_hint: "hu" },
  { url: "https://privatbankar.hu/cimke/podcast", tag: "media-privatbankar", lang_hint: "hu" },
  { url: "https://bitport.hu/podcast", tag: "media-bitport", lang_hint: "hu" },
  { url: "https://hwsw.hu/podcast", tag: "media-hwsw", lang_hint: "hu" },
  { url: "https://itcafe.hu/podcast", tag: "media-itcafe", lang_hint: "hu" },
  { url: "https://www.nemzetisport.hu/podcast", tag: "media-nemzetisport", lang_hint: "hu" },
  { url: "https://m4sport.hu/podcast", tag: "media-m4sport", lang_hint: "hu" },
  { url: "https://nyugat.hu/podcast", tag: "media-nyugat", lang_hint: "hu" },
  { url: "https://magyarnarancs.hu/cimke/podcast", tag: "media-magyarnarancs", lang_hint: "hu" },
  { url: "https://www.es.hu/cimke/podcast", tag: "media-elet-irodalom", lang_hint: "hu" },
  { url: "https://magyarkurir.hu/podcast", tag: "media-magyarkurir", lang_hint: "hu" },
  { url: "https://kreativ.hu/cimke/podcast", tag: "media-kreativ", lang_hint: "hu" },
  { url: "https://marketing.hu/cimke/podcast", tag: "media-marketing", lang_hint: "hu" },
  { url: "https://hellovidek.hu/cimke/podcast", tag: "media-hellovidek", lang_hint: "hu" },
  { url: "https://eduline.hu/cimke/podcast", tag: "media-eduline", lang_hint: "hu" },
  { url: "https://nyest.hu/podcast", tag: "media-nyest", lang_hint: "hu" },
  { url: "https://divany.hu/cimke/podcast", tag: "media-divany", lang_hint: "hu" },
  { url: "https://femina.hu/cimke/podcast", tag: "media-femina", lang_hint: "hu" },
  { url: "https://www.glamour.hu/cimke/podcast", tag: "media-glamour", lang_hint: "hu" },
  { url: "https://www.borsonline.hu/cimke/podcast", tag: "media-bors", lang_hint: "hu" },
  { url: "https://igymukodom.hu", tag: "media-igymukodom", lang_hint: "hu" },

  // Public radio + regional
  { url: "https://mediaklibsklikk.hu/musor/kossuth-radio/", tag: "pub-kossuth", lang_hint: "hu" },
  { url: "https://mediaklikk.hu/musor/petofi-radio/", tag: "pub-petofi", lang_hint: "hu" },
  { url: "https://mediaklikk.hu/musor/dankoradio/", tag: "pub-danko", lang_hint: "hu" },
  { url: "https://mediaklikk.hu/musor/bartok-radio/", tag: "pub-bartok", lang_hint: "hu" },

  // Aggregators / hosting platforms (HU filters)
  { url: "https://www.podchaser.com/lists/best-hungarian-podcasts-1234", tag: "agg-podchaser-hu", lang_hint: "hu" },
  { url: "https://podtail.com/hu/popular-podcasts/", tag: "agg-podtail-hu-pop", lang_hint: "hu" },
  { url: "https://player.fm/featured/hungarian", tag: "agg-playerfm-hu", lang_hint: "hu" },
  { url: "https://podcastaddict.com/language/hu", tag: "agg-podcastaddict-hu", lang_hint: "hu" },
  { url: "https://castbox.fm/language/Hungarian", tag: "agg-castbox-hu", lang_hint: "hu" },
  { url: "https://www.goodpods.com/podcasts/language/hungarian", tag: "agg-goodpods-hu", lang_hint: "hu" },

  // Cross-border HU media (Erdély, Felvidék, Vajdaság)
  { url: "https://kronikaonline.ro/cimke/podcast", tag: "media-kronika-ro", lang_hint: "hu" },
  { url: "https://ujszo.com/cimke/podcast", tag: "media-ujszo-sk", lang_hint: "hu" },
  { url: "https://magyarszo.rs/cimke/podcast", tag: "media-magyarszo-rs", lang_hint: "hu" },
  { url: "https://szabadsag.ro/cimke/podcast", tag: "media-szabadsag-ro", lang_hint: "hu" },

  // Niche / community
  { url: "https://podcast.hu/", tag: "agg-podcast-hu", lang_hint: "hu" },
  { url: "https://magyarpodcast.hu/", tag: "agg-magyarpodcast", lang_hint: "hu" },
  { url: "https://podcastlista.hu/", tag: "agg-podcastlista", lang_hint: "hu" },
];

// Normalize PI/BCP-47 language string to ISO-639-1 prefix ("en-us" → "en").
function normLang(s: string | null | undefined): string | null {
  if (!s) return null;
  return String(s).toLowerCase().split(/[-_]/)[0] || null;
}

async function sha1Hex(input: string) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function piSearch(term: string, lang?: string) {
  const apiKey = Deno.env.get("PODCAST_INDEX_API_KEY")!;
  const apiSecret = Deno.env.get("PODCAST_INDEX_API_SECRET")!;
  const date = Math.floor(Date.now() / 1000).toString();
  const auth = await sha1Hex(apiKey + apiSecret + date);
  const langQ = lang ? `&val=${encodeURIComponent(lang)}` : "";
  const url = `https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(term)}&max=5${langQ}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Podiverzum/1.0 ai-scout",
      "X-Auth-Date": date,
      "X-Auth-Key": apiKey,
      "Authorization": auth,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

// Tier 3: iTunes Search API (HU storefront). Works even when PodcastIndex doesn't
// have the feed indexed yet — common for newer / niche HU podcasts.
async function itunesSearch(term: string, country = "HU") {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=${country}&media=podcast&limit=5&entity=podcast`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Podiverzum/1.0 ai-scout" } });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data?.results) ? data.results : [];
  } catch {
    return [];
  }
}

// Lightweight RSS validation: fetch first ~16KB, confirm it's an RSS/Atom feed,
// and extract the declared language (<language> or <itunes:language>) if present.
// Returns { ok, language } so callers can do strict per-language gating.
async function validateRss(url: string): Promise<{ ok: boolean; language: string | null }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: { "User-Agent": "Podiverzum/1.0 ai-scout", "Accept": "application/rss+xml,application/xml,text/xml,*/*" },
      signal: ctrl.signal, redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok || !res.body) return { ok: false, language: null };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    // Pull 16KB — channel metadata (incl. <language>) is almost always within that.
    while (total < 16384) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value); total += value.length;
    }
    try { await reader.cancel(); } catch { /* ignore */ }
    const text = new TextDecoder().decode(new Uint8Array(chunks.flatMap((c) => Array.from(c)))).slice(0, 16384);
    const ok = /<rss[\s>]/i.test(text) || /<feed[\s>]/i.test(text);
    if (!ok) return { ok: false, language: null };
    // <language>hu</language>, <itunes:language>hu-HU</itunes:language>, or Atom <feed xml:lang="hu">
    const m =
      text.match(/<language>\s*([^<\s]+)\s*<\/language>/i) ||
      text.match(/<itunes:language>\s*([^<\s]+)\s*<\/itunes:language>/i) ||
      text.match(/<feed[^>]*xml:lang=["']([^"']+)["']/i);
    return { ok: true, language: m ? normLang(m[1]) : null };
  } catch {
    return { ok: false, language: null };
  }
}

// True if `lang` is HU or unknown/multi (so we don't reject feeds that just omit the tag).
function isHuOrUnknown(lang: string | null): boolean {
  if (!lang) return true;
  const l = lang.toLowerCase();
  return l.startsWith("hu") || l === "mul" || l === "und";
}

async function firecrawlScrape(url: string): Promise<string | null> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY not configured");
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
  });
  if (!res.ok) {
    console.warn(`firecrawl ${url} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return null;
  }
  const data = await res.json();
  return data?.data?.markdown || data?.markdown || null;
}

async function geminiExtract(markdown: string, sourceTag: string, langHint: string, max: number, model: string) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY")!;
  const langName = langHint === "hu" ? "Hungarian" : langHint === "en" ? "English" : langHint;
  const prompt = `You are an expert podcast curator. Given the markdown of a webpage that lists or recommends podcasts, extract distinct podcasts.

STRICT LANGUAGE FILTER: Only return podcasts whose primary spoken language is ${langName} (${langHint}).
Skip any show in another language even if it appears on the page (e.g. cross-listed international shows).
If unsure about a podcast's language, omit it.

Return at most ${max} of the highest-quality, real podcasts (skip generic mentions, ads, blog posts).
For each podcast, provide:
- title: exact show name
- author: host or publisher (best guess if implied)
- reason: 1 short sentence why this is a notable podcast (from the page context)
- rss_url: ONLY if the page explicitly contains a direct RSS/feed URL (ends in .xml, /feed, /rss, or labeled "RSS"). Otherwise omit.

Source tag: ${sourceTag}

PAGE MARKDOWN (truncated):
${markdown.slice(0, 50000)}`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      tools: [{
        type: "function",
        function: {
          name: "submit_podcasts",
          description: "Submit the extracted podcast list",
          parameters: {
            type: "object",
            properties: {
              podcasts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    author: { type: "string" },
                    reason: { type: "string" },
                    rss_url: { type: "string" },
                  },
                  required: ["title"],
                },
              },
            },
            required: ["podcasts"],
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "submit_podcasts" } },
    }),
  });
  if (!res.ok) {
    console.warn(`gemini extract failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return [];
  }
  const data = await res.json();
  const args = data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return [];
  try {
    const parsed = typeof args === "string" ? JSON.parse(args) : args;
    return Array.isArray(parsed.podcasts) ? parsed.podcasts : [];
  } catch {
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const t0 = Date.now();
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const sources: { url: string; tag: string; lang_hint: string }[] = Array.isArray(body.sources) && body.sources.length
      ? body.sources.map((s: any) => {
          if (typeof s === "string") return { url: s, tag: new URL(s).hostname, lang_hint: body.lang_hint || "en" };
          return { url: s.url, tag: s.tag || new URL(s.url).hostname, lang_hint: s.lang_hint || body.lang_hint || "en" };
        })
      : DEFAULT_SOURCES;
    const model = body.model || "google/gemini-2.5-pro";
    const maxPerSource = Math.max(5, Math.min(50, Number(body.max_per_source) || 25));
    const dryRun = !!body.dry_run;
    const strictLang = body.strict_lang !== false; // default ON

    const candidates: { title: string; author?: string; reason?: string; rss_url?: string; sourceTag: string; langHint: string }[] = [];
    const sourceStats: Record<string, { scraped: boolean; extracted: number; lang_hint: string }> = {};

    // Time budget: keep total work under 130s so we always have time to insert+respond
    // before Lovable's 150s edge-function idle timeout. Sources are shuffled per run
    // so different ones get processed first across cron invocations.
    const TIME_BUDGET_MS = 130_000;
    const SCRAPE_PHASE_MS = 80_000; // leave ~50s for PI/iTunes validation + insert
    const shuffled = sources.slice().sort(() => Math.random() - 0.5);
    let scrapeAborted = false;

    for (const src of shuffled) {
      if (Date.now() - t0 > SCRAPE_PHASE_MS) { scrapeAborted = true; break; }
      const md = await firecrawlScrape(src.url);
      if (!md) { sourceStats[src.tag] = { scraped: false, extracted: 0, lang_hint: src.lang_hint }; continue; }
      const extracted = await geminiExtract(md, src.tag, src.lang_hint, maxPerSource, model);
      sourceStats[src.tag] = { scraped: true, extracted: extracted.length, lang_hint: src.lang_hint };
      for (const p of extracted) {
        if (p?.title) candidates.push({
          title: String(p.title).trim(), author: p.author, reason: p.reason,
          rss_url: typeof p.rss_url === "string" ? p.rss_url.trim() : undefined,
          sourceTag: src.tag, langHint: src.lang_hint,
        });
      }
    }

    // Dedupe candidates by title+author
    const seen = new Set<string>();
    const unique = candidates.filter((c) => {
      const key = `${c.title.toLowerCase()}|${(c.author || "").toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // 3-tier validation: (1) RSS direct from page, (2) PodcastIndex w/ lang filter, (3) iTunes HU storefront.
    const validated: any[] = [];
    const debugMisses: any[] = [];
    let piHits = 0, piMisses = 0, langMismatches = 0, piEmpty = 0;
    let tier1 = 0, tier2 = 0, tier3 = 0;
    const tNorm = (s: string) =>
      s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
       .replace(/[^a-z0-9]+/g, " ").trim();

    for (const c of unique) {
      if (Date.now() - t0 > TIME_BUDGET_MS) { scrapeAborted = true; break; }
      // ---------- TIER 1: direct RSS URL extracted from page ----------
      if (c.rss_url && /^https?:\/\//i.test(c.rss_url)) {
        const v = await validateRss(c.rss_url);
        if (v.ok) {
          // STRICT language gate: only HU or unknown/und/mul. Cross-listed
          // Spanish/English shows on HU pages were leaking through before.
          if (!isHuOrUnknown(v.language)) {
            langMismatches++;
          } else {
            tier1++; piHits++;
            // Carry the *actual* detected language (or null) — never fall back
            // to the page-level lang_hint, that's what poisoned the DB before.
            validated.push({
              feed: { url: c.rss_url, title: c.title, author: c.author, description: c.reason, language: v.language },
              candidate: c, lang_hint: c.langHint, tier: "rss_direct",
            });
            continue;
          }
        }
      }

      // ---------- TIER 2: PodcastIndex search (lang-filtered) ----------
      let result = await piSearch(c.title, c.langHint);
      let feeds: any[] = Array.isArray(result?.feeds) ? result.feeds : [];
      if (!feeds.length) {
        // Retry without lang filter — PI's val= can be overly strict for sparse HU data
        result = await piSearch(c.title);
        feeds = Array.isArray(result?.feeds) ? result.feeds : [];
      }
      if (!feeds.length && c.author) {
        result = await piSearch(`${c.title} ${c.author}`);
        feeds = Array.isArray(result?.feeds) ? result.feeds : [];
      }

      const candNorm = tNorm(c.title);
      const candTokens = new Set(candNorm.split(" ").filter((w) => w.length > 2));
      let best: any = null;
      let bestScore = 0;
      for (const f of feeds) {
        if (!f?.url) continue;
        const piNorm = tNorm(f.title || "");
        const piTokens = new Set(piNorm.split(" ").filter((w) => w.length > 2));
        let overlap = 0;
        for (const t of candTokens) if (piTokens.has(t)) overlap++;
        let sc = candTokens.size ? overlap / candTokens.size : 0;
        if (candNorm.length >= 6 && (piNorm.includes(candNorm) || candNorm.includes(piNorm))) {
          sc = Math.max(sc, 0.9);
        }
        if (sc > bestScore) { bestScore = sc; best = f; }
      }

      if (best && bestScore >= 0.34) {
        const top = best;
        const piLang = normLang(top.language);
        // STRICT gate: PI's language must be HU or unknown. Previously when
        // `piLang` was falsy we accepted blindly — that's how non-HU leaked in.
        if (!isHuOrUnknown(piLang)) {
          langMismatches++;
        } else {
          // If PI didn't report a language, confirm by fetching the RSS itself.
          let confirmedLang = piLang;
          if (!confirmedLang && top.url) {
            const v = await validateRss(top.url);
            if (!v.ok || !isHuOrUnknown(v.language)) {
              langMismatches++;
              continue;
            }
            confirmedLang = v.language;
          }
          tier2++; piHits++;
          validated.push({
            feed: { ...top, language: confirmedLang },
            candidate: c, lang_hint: c.langHint, tier: "podcast_index",
          });
          continue;
        }
      }

      // ---------- TIER 3: iTunes Search (HU storefront) — catches feeds PI doesn't index ----------
      const itunesResults = await itunesSearch(c.title, "HU");
      let itBest: any = null;
      let itScore = 0;
      for (const r of itunesResults) {
        if (!r?.feedUrl) continue;
        const itNorm = tNorm(r.collectionName || r.trackName || "");
        const itTokens = new Set(itNorm.split(" ").filter((w) => w.length > 2));
        let overlap = 0;
        for (const t of candTokens) if (itTokens.has(t)) overlap++;
        let sc = candTokens.size ? overlap / candTokens.size : 0;
        if (candNorm.length >= 6 && (itNorm.includes(candNorm) || candNorm.includes(itNorm))) {
          sc = Math.max(sc, 0.9);
        }
        if (sc > itScore) { itScore = sc; itBest = r; }
      }
      if (itBest && itScore >= 0.34) {
        const v = await validateRss(itBest.feedUrl);
        if (v.ok) {
          // STRICT language gate — iTunes HU storefront still lists foreign shows.
          if (!isHuOrUnknown(v.language)) {
            langMismatches++;
          } else {
            tier3++; piHits++;
            validated.push({
              feed: {
                url: itBest.feedUrl,
                title: itBest.collectionName || c.title,
                author: itBest.artistName || c.author,
                image: itBest.artworkUrl600 || itBest.artworkUrl100,
                link: itBest.collectionViewUrl,
                language: v.language,
                description: c.reason,
              },
              candidate: c, lang_hint: c.langHint, tier: "itunes_hu",
            });
            continue;
          }
        }
      }

      // All tiers exhausted
      piMisses++; if (!feeds.length) piEmpty++;
      if (debugMisses.length < 15) debugMisses.push({
        title: c.title, author: c.author,
        pi_score: bestScore, itunes_score: itScore,
        pi_top: feeds.slice(0, 3).map((f: any) => f.title),
      });
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true, dry_run: true, sources: sourceStats,
        candidates: unique.length, pi_hits: piHits, pi_misses: piMisses, pi_empty: piEmpty, lang_mismatches: langMismatches,
        tiers: { rss_direct: tier1, podcast_index: tier2, itunes_hu: tier3 },
        sample: validated.slice(0, 15).map((v) => ({
          title: v.feed.title, url: v.feed.url, lang: v.feed.language || null,
          source: v.candidate.sourceTag, expected_lang: v.lang_hint, tier: v.tier,
        })),
        debug_misses: debugMisses,
        elapsed_ms: Date.now() - t0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Skip rows already in podcasts or staging
    const urls = validated.map((v) => v.feed.url);
    const exSet = new Set<string>();
    for (let i = 0; i < urls.length; i += 200) {
      const slice = urls.slice(i, i + 200);
      const [{ data: p }, { data: s }] = await Promise.all([
        supabase.from("podcasts").select("rss_url").in("rss_url", slice),
        supabase.from("pi_feed_staging").select("rss_url").in("rss_url", slice),
      ]);
      (p || []).forEach((r: any) => exSet.add(r.rss_url));
      (s || []).forEach((r: any) => exSet.add(r.rss_url));
    }
    const fresh = validated.filter((v) => !exSet.has(v.feed.url));

    let inserted = 0, importId: string | null = null;
    if (fresh.length > 0) {
      const { data: imp, error: impErr } = await supabase.from("pi_dump_imports")
        .insert({ source: "ai_scout", status: "ingesting", snapshot_date: new Date().toISOString().slice(0, 10) })
        .select("id").single();
      if (impErr) throw impErr;
      importId = imp.id;

      const rows = fresh.map((v) => ({
        import_id: imp.id,
        pi_id: v.feed.id ?? null,
        rss_url: v.feed.url,
        title: v.feed.title || v.candidate.title || null,
        website_url: v.feed.link || null,
        image_url: v.feed.image || v.feed.artwork || null,
        description: v.feed.description || v.candidate.reason || null,
        // Always populate language: prefer PI value, fall back to source's lang_hint
        // so downstream filters (homepage, categories, search) never treat it as English-by-default.
        language: normLang(v.feed.language) || v.lang_hint,
        author: v.feed.author || v.feed.ownerName || v.candidate.author || null,
        episode_count: v.feed.episodeCount ?? null,
        newest_item_at: v.feed.newestItemPublishTime ? new Date(v.feed.newestItemPublishTime * 1000).toISOString() : null,
        last_http_status: v.feed.lastHttpStatus ?? null,
        dead: v.feed.dead === 1,
      }));

      const { error: upErr, count } = await supabase
        .from("pi_feed_staging")
        .upsert(rows, { onConflict: "rss_url", ignoreDuplicates: true, count: "exact" });
      if (upErr) throw upErr;
      inserted = count ?? rows.length;

      await supabase.from("pi_dump_imports").update({
        feeds_received: validated.length,
        skipped_duplicates: validated.length - fresh.length,
        status: "processing",
        notes: { sources: sourceStats, candidates: unique.length, pi_hits: piHits, pi_misses: piMisses, lang_mismatches: langMismatches },
        updated_at: new Date().toISOString(),
      }).eq("id", imp.id);
    }

    return new Response(JSON.stringify({
      ok: true,
      sources: sourceStats,
      candidates: unique.length,
      pi_hits: piHits,
      pi_misses: piMisses,
      lang_mismatches: langMismatches,
      tiers: { rss_direct: tier1, podcast_index: tier2, itunes_hu: tier3 },
      already_known: validated.length - fresh.length,
      inserted,
      import_id: importId,
      elapsed_ms: Date.now() - t0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("ai-feed-scout error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
