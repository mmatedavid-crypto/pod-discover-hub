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
  { url: "https://podcasts.apple.com/us/charts", tag: "apple-us-charts", lang_hint: "en" },
  { url: "https://podcasts.apple.com/gb/charts", tag: "apple-gb-charts", lang_hint: "en" },
  { url: "https://en.wikipedia.org/wiki/List_of_most-downloaded_podcasts", tag: "wiki-top", lang_hint: "en" },
  { url: "https://www.theguardian.com/tv-and-radio/series/the-guardians-50-best-podcasts-of-2024", tag: "guardian-2024", lang_hint: "en" },
  { url: "https://www.nytimes.com/interactive/2024/arts/best-podcasts.html", tag: "nyt-2024", lang_hint: "en" },
  { url: "https://www.reddit.com/r/podcasts/top/?t=year", tag: "reddit-podcasts-year", lang_hint: "en" },
  { url: "https://www.reddit.com/r/podcastrecommendations/top/?t=year", tag: "reddit-recs-year", lang_hint: "en" },
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
