// Apple Marketing top podcasts JSON ingest.
// Fetches https://rss.applemarketingtools.com/api/v2/{country}/podcasts/top/{limit}/podcasts.json
// for each country, resolves each item by iTunes ID via PodcastIndex,
// then inserts validated feeds into pi_feed_staging (foundation pipeline).
//
// Body: { countries?: string[], limit?: number, dryRun?: boolean }
// Default countries: 14 EN-primary markets. Default limit: 200 (max Apple supports).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_COUNTRIES = [
  "us", "gb", "ca", "au", "ie", "nz", "in", "za",
  "sg", "ph", "ng", "ke", "jm", "tt",
];

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
      "User-Agent": "Podiverzum/1.0 apple-rss-ingest",
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

async function fetchAppleTop(country: string, limit: number) {
  const url = `https://rss.applemarketingtools.com/api/v2/${country}/podcasts/top/${limit}/podcasts.json`;
  const res = await fetch(url, { headers: { "User-Agent": "Podiverzum/1.0" } });
  if (!res.ok) return { country, items: [] as any[], error: `http ${res.status}` };
  const j = await res.json();
  const results = j?.feed?.results || [];
  return { country, items: results as any[] };
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
    const limit = Math.min(Math.max(Number(body.limit) || 100, 10), 100);
    const dryRun = !!body.dryRun;

    // 1) Fetch country charts sequentially (Apple rate-limits parallel hits to 0 items)
    const charts: { country: string; items: any[]; error?: string }[] = [];
    for (const c of countries) {
      const r = await fetchAppleTop(c, limit);
      charts.push(r);
      await new Promise((r) => setTimeout(r, 250));
    }

    // 2) Collect unique iTunes IDs across all countries
    const idMap = new Map<string, { id: string; name: string; sources: string[] }>();
    let totalItems = 0;
    const perCountry: Record<string, number> = {};
    for (const ch of charts) {
      perCountry[ch.country] = ch.items.length;
      totalItems += ch.items.length;
      for (const item of ch.items) {
        const id = String(item?.id || "").trim();
        if (!id) continue;
        const existing = idMap.get(id);
        if (existing) {
          existing.sources.push(ch.country);
        } else {
          idMap.set(id, { id, name: String(item?.name || ""), sources: [ch.country] });
        }
      }
    }
    const uniqueIds = Array.from(idMap.values());

    // 3) Skip iTunes IDs we have already staged or imported (by pi_id later)
    //    First, resolve all via PodcastIndex (gives us rss_url + pi_id)
    let piHits = 0, piMisses = 0;
    const validated: { feed: any; itunesId: string; sources: string[] }[] = [];
    const CONCURRENCY = 4; // PI rate-limit-friendly
    for (let i = 0; i < uniqueIds.length; i += CONCURRENCY) {
      const batch = uniqueIds.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async (u) => {
        const feed = await piByItunesId(u.id);
        return { feed, itunesId: u.id, sources: u.sources };
      }));
      for (const r of results) {
        if (r.feed) { piHits++; validated.push(r); } else { piMisses++; }
      }
      // tiny throttle
      await new Promise((r) => setTimeout(r, 60));
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
        ok: true, dry_run: true, countries, per_country: perCountry,
        total_items: totalItems, unique_itunes_ids: uniqueIds.length,
        pi_hits: piHits, pi_misses: piMisses,
        already_known: validated.length - fresh.length,
        would_insert: fresh.length,
        sample: fresh.slice(0, 10).map((v) => ({
          title: v.feed.title, url: v.feed.url, lang: v.feed.language || null, sources: v.sources,
        })),
        elapsed_ms: Date.now() - t0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 5) Insert into pi_feed_staging
    let inserted = 0, importId: string | null = null;
    if (fresh.length > 0) {
      const { data: imp, error: impErr } = await supabase.from("pi_dump_imports")
        .insert({
          source: "apple_rss_charts",
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
        language: normLang(v.feed.language) || "en", // Apple charts -> EN markets
        author: v.feed.author || v.feed.ownerName || null,
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
        notes: {
          countries, per_country: perCountry,
          total_items: totalItems, unique_itunes_ids: uniqueIds.length,
          pi_hits: piHits, pi_misses: piMisses, inserted,
        },
        updated_at: new Date().toISOString(),
      }).eq("id", imp.id);
    }

    return new Response(JSON.stringify({
      ok: true, countries, per_country: perCountry,
      total_items: totalItems, unique_itunes_ids: uniqueIds.length,
      pi_hits: piHits, pi_misses: piMisses,
      already_known: validated.length - fresh.length,
      inserted, import_id: importId,
      elapsed_ms: Date.now() - t0,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("apple-rss-charts-ingest error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
