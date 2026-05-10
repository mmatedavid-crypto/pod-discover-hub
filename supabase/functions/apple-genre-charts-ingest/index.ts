// Apple iTunes genre top-podcasts ingest.
// Uses legacy iTunes RSS feed which supports per-genre charts:
//   https://itunes.apple.com/{country}/rss/toppodcasts/limit={limit}/genre={id}/json
//
// Body: { countries?: string[], genres?: number[], limit?: number, dryRun?: boolean }
// Defaults: 5 EN countries × 18 top-level Podcasts subgenres × 100 entries
//           = 9,000 chart slots (heavy dedup with 1.a expected).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_COUNTRIES = ["us", "gb", "ca", "au", "ie"];

// Apple top-level Podcasts subgenres (genre ID → label, for logging only)
const GENRES: Record<number, string> = {
  1301: "Arts",
  1303: "Comedy",
  1304: "Education",
  1483: "Fiction",
  1305: "Kids & Family",
  1502: "Leisure",
  1310: "Music",
  1489: "News",
  1314: "Religion & Spirituality",
  1533: "Science",
  1324: "Society & Culture",
  1545: "Sports",
  1318: "Technology",
  1488: "True Crime",
  1309: "TV & Film",
  1321: "Business",
  1512: "Health & Fitness",
  1487: "History",
};

async function sha1Hex(input: string) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function piByItunesId(itunesId: string) {
  const apiKey = Deno.env.get("PODCAST_INDEX_API_KEY")!;
  const apiSecret = Deno.env.get("PODCAST_INDEX_API_SECRET")!;
  const date = Math.floor(Date.now() / 1000).toString();
  const auth = await sha1Hex(apiKey + apiSecret + date);
  const url = `https://api.podcastindex.org/api/1.0/podcasts/byitunesid?id=${encodeURIComponent(itunesId)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Podiverzum/1.0 apple-genre-ingest",
      "X-Auth-Date": date,
      "X-Auth-Key": apiKey,
      "Authorization": auth,
    },
  });
  if (!res.ok) return null;
  const j = await res.json();
  return j?.feed && j.feed.url ? j.feed : null;
}

function normLang(s: string | null | undefined) {
  if (!s) return null;
  return String(s).toLowerCase().split(/[-_]/)[0] || null;
}

async function fetchAppleGenre(country: string, genreId: number, limit: number) {
  const url = `https://itunes.apple.com/${country}/rss/toppodcasts/limit=${limit}/genre=${genreId}/json`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Podiverzum/1.0" } });
    if (!res.ok) return { country, genreId, items: [] as any[], error: `http ${res.status}` };
    const j = await res.json();
    const entries = j?.feed?.entry || [];
    // Each entry: { id: { attributes: { "im:id": "1234" } }, "im:name": { label }, ... }
    const items = entries.map((e: any) => ({
      id: e?.id?.attributes?.["im:id"] || null,
      name: e?.["im:name"]?.label || "",
    })).filter((x: any) => x.id);
    return { country, genreId, items };
  } catch (e) {
    return { country, genreId, items: [] as any[], error: e instanceof Error ? e.message : "fetch error" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const t0 = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const countries: string[] = Array.isArray(body.countries) && body.countries.length > 0
      ? body.countries.map((c: string) => String(c).toLowerCase())
      : DEFAULT_COUNTRIES;
    const genres: number[] = Array.isArray(body.genres) && body.genres.length > 0
      ? body.genres.map((g: any) => Number(g)).filter((n: number) => Number.isFinite(n))
      : Object.keys(GENRES).map((g) => Number(g));
    const limit = Math.min(Math.max(Number(body.limit) || 100, 10), 200);
    const dryRun = !!body.dryRun;

    // 1) Fetch country×genre charts sequentially with throttle
    const charts: { country: string; genreId: number; items: any[]; error?: string }[] = [];
    for (const c of countries) {
      for (const g of genres) {
        const r = await fetchAppleGenre(c, g, limit);
        charts.push(r);
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    // 2) Collect unique iTunes IDs
    const idMap = new Map<string, { id: string; name: string; sources: string[] }>();
    let totalItems = 0;
    const perCountry: Record<string, number> = {};
    const perGenre: Record<string, number> = {};
    for (const ch of charts) {
      perCountry[ch.country] = (perCountry[ch.country] || 0) + ch.items.length;
      const gKey = `${ch.genreId} ${GENRES[ch.genreId] || ""}`.trim();
      perGenre[gKey] = (perGenre[gKey] || 0) + ch.items.length;
      totalItems += ch.items.length;
      for (const item of ch.items) {
        const id = String(item.id || "").trim();
        if (!id) continue;
        const tag = `${ch.country}/${ch.genreId}`;
        const existing = idMap.get(id);
        if (existing) existing.sources.push(tag);
        else idMap.set(id, { id, name: item.name, sources: [tag] });
      }
    }
    const uniqueIds = Array.from(idMap.values());

    // 3) Skip iTunes IDs we already have in podcasts (by source 'apple_*' or rss_url match later)
    //    Pre-filter against pi_feed_staging.pi_id and podcasts source not feasible -> resolve via PI then dedup by rss_url.
    const CONCURRENCY = 10;
    let piHits = 0, piMisses = 0;
    const validated: { feed: any; itunesId: string; sources: string[] }[] = [];
    for (let i = 0; i < uniqueIds.length; i += CONCURRENCY) {
      const batch = uniqueIds.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async (u) => {
        const feed = await piByItunesId(u.id);
        return { feed, itunesId: u.id, sources: u.sources };
      }));
      for (const r of results) {
        if (r.feed) { piHits++; validated.push(r); } else { piMisses++; }
      }
      await new Promise((r) => setTimeout(r, 30));
    }

    // 4) Dedup against podcasts + pi_feed_staging via rss_url
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

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true, dry_run: true, countries, genres,
        per_country: perCountry, per_genre: perGenre,
        total_items: totalItems, unique_itunes_ids: uniqueIds.length,
        pi_hits: piHits, pi_misses: piMisses,
        already_known: validated.length - fresh.length,
        would_insert: fresh.length,
        sample: fresh.slice(0, 10).map((v) => ({
          title: v.feed.title, url: v.feed.url, lang: v.feed.language || null, sources: v.sources.slice(0, 5),
        })),
        elapsed_ms: Date.now() - t0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 5) Insert into pi_feed_staging
    let inserted = 0, importId: string | null = null;
    if (fresh.length > 0) {
      const { data: imp, error: impErr } = await supabase.from("pi_dump_imports")
        .insert({
          source: "apple_genre_charts",
          status: "ingesting",
          snapshot_date: new Date().toISOString().slice(0, 10),
        })
        .select("id").single();
      if (impErr) throw impErr;
      importId = imp.id;

      const rows = fresh.map((v) => ({
        import_id: imp.id,
        pi_id: v.feed.id ?? null,
        rss_url: v.feed.url,
        title: v.feed.title || null,
        website_url: v.feed.link || null,
        image_url: v.feed.image || v.feed.artwork || null,
        description: v.feed.description || null,
        language: normLang(v.feed.language) || "en",
        author: v.feed.author || v.feed.ownerName || null,
        episode_count: v.feed.episodeCount ?? null,
        newest_item_at: (v.feed.newestItemPubdate || v.feed.newestItemPublishTime)
          ? new Date((v.feed.newestItemPubdate || v.feed.newestItemPublishTime) * 1000).toISOString()
          : new Date().toISOString(),
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
        notes: {
          countries, genres, per_country: perCountry, per_genre: perGenre,
          total_items: totalItems, unique_itunes_ids: uniqueIds.length,
          pi_hits: piHits, pi_misses: piMisses, inserted,
        },
        updated_at: new Date().toISOString(),
      }).eq("id", imp.id);
    }

    return new Response(JSON.stringify({
      ok: true, countries, genres,
      per_country: perCountry, per_genre: perGenre,
      total_items: totalItems, unique_itunes_ids: uniqueIds.length,
      pi_hits: piHits, pi_misses: piMisses,
      already_known: validated.length - fresh.length,
      inserted, import_id: importId,
      elapsed_ms: Date.now() - t0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("apple-genre-charts-ingest error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
