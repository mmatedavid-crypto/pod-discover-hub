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
  // Apple Podcasts — overall charts (proven to scrape well via Firecrawl)
  { url: "https://podcasts.apple.com/us/charts", tag: "apple-us-charts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/charts", tag: "apple-gb-charts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/ca/charts", tag: "apple-ca-charts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/au/charts", tag: "apple-au-charts", lang_hint: "en" },
  // Apple Podcasts — genre charts (US). Each genre returns a top-N for that category.
  { url: "https://podcasts.apple.com/us/genre/podcasts-business/id1321", tag: "apple-us-business", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-news/id1311", tag: "apple-us-news", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-technology/id1318", tag: "apple-us-tech", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports/id1545", tag: "apple-us-sports", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-comedy/id1303", tag: "apple-us-comedy", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-education/id1304", tag: "apple-us-education", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-health-fitness/id1512", tag: "apple-us-health", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-society-culture/id1324", tag: "apple-us-society", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-science/id1533", tag: "apple-us-science", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-history/id1487", tag: "apple-us-history", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-tv-film/id1309", tag: "apple-us-tv-film", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-arts/id1301", tag: "apple-us-arts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-music/id1310", tag: "apple-us-music", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-leisure/id1502", tag: "apple-us-leisure", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-true-crime/id1488", tag: "apple-us-true-crime", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-government/id1511", tag: "apple-us-government", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-religion-spirituality/id1314", tag: "apple-us-religion", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-fiction/id1483", tag: "apple-us-fiction", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-kids-family/id1305", tag: "apple-us-kids", lang_hint: "en" },
  // Apple GB genre charts — slightly different mix from US
  { url: "https://podcasts.apple.com/gb/genre/podcasts-business/id1321", tag: "apple-gb-business", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-news/id1311", tag: "apple-gb-news", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-comedy/id1303", tag: "apple-gb-comedy", lang_hint: "en" },
  // Spotify public top podcasts page (renders server-side enough for Firecrawl)
  { url: "https://podcastcharts.byspotify.com/", tag: "spotify-charts-global", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/us", tag: "spotify-charts-us", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/gb", tag: "spotify-charts-gb", lang_hint: "en" },
  // More Apple country charts (English-speaking markets — broader long tail)
  { url: "https://podcasts.apple.com/ie/charts", tag: "apple-ie-charts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/nz/charts", tag: "apple-nz-charts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/za/charts", tag: "apple-za-charts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/in/charts", tag: "apple-in-charts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/sg/charts", tag: "apple-sg-charts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/ph/charts", tag: "apple-ph-charts", lang_hint: "en" },
  // Apple GB extended genre charts
  { url: "https://podcasts.apple.com/gb/genre/podcasts-technology/id1318", tag: "apple-gb-tech", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-society-culture/id1324", tag: "apple-gb-society", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-history/id1487", tag: "apple-gb-history", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-science/id1533", tag: "apple-gb-science", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-true-crime/id1488", tag: "apple-gb-true-crime", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-health-fitness/id1512", tag: "apple-gb-health", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-education/id1304", tag: "apple-gb-education", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/genre/podcasts-sports/id1545", tag: "apple-gb-sports", lang_hint: "en" },
  // Apple US deeper subgenres (long-tail discovery)
  { url: "https://podcasts.apple.com/us/genre/podcasts-business-entrepreneurship/id1493", tag: "apple-us-entrepreneurship", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-business-investing/id1498", tag: "apple-us-investing", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-business-marketing/id1499", tag: "apple-us-marketing", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-business-management/id1490", tag: "apple-us-management", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-business-careers/id1501", tag: "apple-us-careers", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-news-politics/id1530", tag: "apple-us-politics", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-news-tech-news/id1448", tag: "apple-us-tech-news", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-news-business-news/id1530", tag: "apple-us-business-news", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-health-fitness-mental-health/id1517", tag: "apple-us-mental-health", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-health-fitness-nutrition/id1519", tag: "apple-us-nutrition", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-society-culture-philosophy/id1525", tag: "apple-us-philosophy", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-society-culture-relationships/id1526", tag: "apple-us-relationships", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-science-natural-sciences/id1535", tag: "apple-us-natural-sciences", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-science-social-sciences/id1539", tag: "apple-us-social-sciences", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports-football/id1546", tag: "apple-us-football", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-sports-basketball/id1547", tag: "apple-us-basketball", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-tv-film-after-shows/id1471", tag: "apple-us-aftershows", lang_hint: "en" },
  { url: "https://podcasts.apple.com/us/genre/podcasts-arts-books/id1482", tag: "apple-us-books", lang_hint: "en" },
  // Spotify regional charts
  { url: "https://podcastcharts.byspotify.com/ca", tag: "spotify-charts-ca", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/au", tag: "spotify-charts-au", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/ie", tag: "spotify-charts-ie", lang_hint: "en" },
  { url: "https://podcastcharts.byspotify.com/nz", tag: "spotify-charts-nz", lang_hint: "en" },
  // Curated list sites that publish actual show names
  { url: "https://www.chartable.com/charts/itunes/us-all-podcasts-podcasts", tag: "chartable-us-all", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/gb-all-podcasts-podcasts", tag: "chartable-gb-all", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-business-podcasts", tag: "chartable-us-business", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-technology-podcasts", tag: "chartable-us-tech", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-news-podcasts", tag: "chartable-us-news", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-comedy-podcasts", tag: "chartable-us-comedy", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-society-culture-podcasts", tag: "chartable-us-society", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-health-fitness-podcasts", tag: "chartable-us-health", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-true-crime-podcasts", tag: "chartable-us-true-crime", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-history-podcasts", tag: "chartable-us-history", lang_hint: "en" },
  { url: "https://www.chartable.com/charts/itunes/us-science-podcasts", tag: "chartable-us-science", lang_hint: "en" },
  { url: "https://www.podchaser.com/lists/the-100-best-podcasts-105ZB1NB7K", tag: "podchaser-top100", lang_hint: "en" },
  { url: "https://www.podchaser.com/charts/top-100", tag: "podchaser-top100-live", lang_hint: "en" },
  { url: "https://goodpods.com/leaderboard/top-100-all-time", tag: "goodpods-top100", lang_hint: "en" },
  { url: "https://goodpods.com/leaderboard/top-100-this-week", tag: "goodpods-week", lang_hint: "en" },
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

async function piSearch(term: string) {
  const apiKey = Deno.env.get("PODCAST_INDEX_API_KEY")!;
  const apiSecret = Deno.env.get("PODCAST_INDEX_API_SECRET")!;
  const date = Math.floor(Date.now() / 1000).toString();
  const auth = await sha1Hex(apiKey + apiSecret + date);
  const url = `https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(term)}&max=3`;
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
    const model = body.model || "google/gemini-2.5-flash";
    const maxPerSource = Math.max(5, Math.min(50, Number(body.max_per_source) || 25));
    const dryRun = !!body.dry_run;
    const strictLang = body.strict_lang !== false; // default ON

    const candidates: { title: string; author?: string; reason?: string; sourceTag: string; langHint: string }[] = [];
    const sourceStats: Record<string, { scraped: boolean; extracted: number; lang_hint: string }> = {};

    for (const src of sources) {
      const md = await firecrawlScrape(src.url);
      if (!md) { sourceStats[src.tag] = { scraped: false, extracted: 0, lang_hint: src.lang_hint }; continue; }
      const extracted = await geminiExtract(md, src.tag, src.lang_hint, maxPerSource, model);
      sourceStats[src.tag] = { scraped: true, extracted: extracted.length, lang_hint: src.lang_hint };
      for (const p of extracted) {
        if (p?.title) candidates.push({
          title: String(p.title).trim(), author: p.author, reason: p.reason,
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

    // Validate via PodcastIndex search + language guard
    const validated: any[] = [];
    let piHits = 0, piMisses = 0, langMismatches = 0;
    for (const c of unique) {
      const term = c.author ? `${c.title} ${c.author}` : c.title;
      const result = await piSearch(term);
      const top = result?.feeds?.[0];
      if (!top || !top.url) { piMisses++; continue; }
      // Loose match: title token overlap
      const tNorm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const candTokens = new Set(tNorm(c.title).split(" ").filter((w) => w.length > 2));
      const piTokens = new Set(tNorm(top.title || "").split(" ").filter((w) => w.length > 2));
      let overlap = 0;
      for (const t of candTokens) if (piTokens.has(t)) overlap++;
      const score = candTokens.size ? overlap / candTokens.size : 0;
      if (score < 0.4) { piMisses++; continue; }

      // Script guard: when targeting Latin-script langs (en, es, etc.), reject titles
      // dominated by CJK / Arabic / Cyrillic / Hebrew / Thai / Hangul / Kana glyphs.
      const latinTargets = new Set(["en","es","pt","fr","de","it","nl","sv","da","no","pl","ro","hu"]);
      if (latinTargets.has(c.langHint)) {
        const t = String(top.title || "");
        if (/[\u4e00-\u9fff\u0600-\u06ff\u0400-\u04ff\u0590-\u05ff\u0e00-\u0e7f\uac00-\ud7af\u3040-\u30ff]/.test(t)) {
          langMismatches++;
          continue;
        }
      }

      // Language guard: PI language must match the source's lang_hint when known.
      // If PI has no language set, we trust the AI extract's filter and let it through.
      const piLang = normLang(top.language);
      if (strictLang && piLang && piLang !== c.langHint) {
        langMismatches++;
        continue;
      }


      piHits++;
      validated.push({ feed: top, candidate: c, lang_hint: c.langHint });
    }

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true, dry_run: true, sources: sourceStats,
        candidates: unique.length, pi_hits: piHits, pi_misses: piMisses, lang_mismatches: langMismatches,
        sample: validated.slice(0, 10).map((v) => ({
          title: v.feed.title, url: v.feed.url, lang: v.feed.language || null,
          source: v.candidate.sourceTag, expected_lang: v.lang_hint,
        })),
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
