// Bulk-pull all Hungarian feeds from PodcastIndex into pi_feed_staging.
// Uses /recent/feeds?lang=hu&max=1000 paginated by `since` (unix sec) walking backwards.
// POST { months_back?: number (default 36), max_pages?: number (default 60) }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha1Hex(input: string) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("PODCAST_INDEX_API_KEY");
    const apiSecret = Deno.env.get("PODCAST_INDEX_API_SECRET");
    if (!apiKey || !apiSecret) {
      return new Response(JSON.stringify({ error: "missing PI credentials" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const monthsBack = Math.max(1, Math.min(120, Number(body.months_back) || 36));
    const maxPages = Math.max(1, Math.min(120, Number(body.max_pages) || 60));

    // Create import row
    const { data: imp } = await supabase.from("pi_dump_imports")
      .insert({ status: "ingesting", source: "pi_hu_bulk_pull" })
      .select("id").single();
    const importId = imp?.id;

    const startedMs = Date.now();
    const TIME_BUDGET = 110_000;
    const nowSec = Math.floor(Date.now() / 1000);
    const oldestSec = nowSec - monthsBack * 30 * 86400;

    let cursor = nowSec; // walk backwards
    let pages = 0;
    let totalSeen = 0;
    let totalInserted = 0;
    const allUrls = new Set<string>();
    const errors: any[] = [];

    while (pages < maxPages && cursor > oldestSec && (Date.now() - startedMs) < TIME_BUDGET) {
      const date = Math.floor(Date.now() / 1000).toString();
      const auth = await sha1Hex(apiKey + apiSecret + date);
      // PI /recent/feeds: max=1000, lang=hu, since=unix sec (returns feeds with newest item ≥ since? actually feeds added since)
      // Using `since` as createdOn cutoff; we walk back by the oldest createdOn we saw.
      const params = new URLSearchParams({ max: "1000", lang: "hu" });
      if (cursor < nowSec) params.set("since", String(cursor));
      const url = `https://api.podcastindex.org/api/1.0/recent/feeds?${params}`;
      let feeds: any[] = [];
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": "Podiverzum/1.0",
            "X-Auth-Date": date,
            "X-Auth-Key": apiKey,
            "Authorization": auth,
          },
        });
        if (!res.ok) {
          errors.push({ page: pages, status: res.status, body: (await res.text()).slice(0, 200) });
          break;
        }
        const data = await res.json();
        feeds = Array.isArray(data.feeds) ? data.feeds : [];
      } catch (e) {
        errors.push({ page: pages, error: e instanceof Error ? e.message : "fetch_err" });
        break;
      }
      pages++;
      totalSeen += feeds.length;
      if (feeds.length === 0) break;

      // Track oldest createdOn to advance cursor
      let minCreated = cursor;
      const fresh: any[] = [];
      for (const f of feeds) {
        const created = Number(f.createdOn || 0);
        if (created && created < minCreated) minCreated = created;
        if (!f.url || allUrls.has(f.url)) continue;
        allUrls.add(f.url);
        fresh.push(f);
      }

      if (fresh.length) {
        // Skip URLs already in podcasts
        const urls = fresh.map((f) => f.url);
        const CHUNK_LOOKUP = 500;
        const existing = new Set<string>();
        for (let i = 0; i < urls.length; i += CHUNK_LOOKUP) {
          const slice = urls.slice(i, i + CHUNK_LOOKUP);
          const { data: ex } = await supabase.from("podcasts").select("rss_url").in("rss_url", slice);
          (ex || []).forEach((r: any) => existing.add(r.rss_url));
        }
        const rows = fresh.filter((f) => !existing.has(f.url)).map((f) => ({
          import_id: importId,
          pi_id: f.id ?? null,
          rss_url: f.url,
          title: f.title || null,
          website_url: f.link || null,
          image_url: f.image || f.artwork || null,
          description: f.description || null,
          language: f.language || "hu",
          author: f.itunesAuthor || f.author || null,
          episode_count: f.episodeCount ?? null,
          newest_item_at: f.newestItemPubdate ? new Date(Number(f.newestItemPubdate) * 1000).toISOString() : null,
          last_http_status: f.lastHttpStatus ?? null,
          dead: f.dead === 1 || f.dead === true,
        }));
        const CHUNK = 500;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const slice = rows.slice(i, i + CHUNK);
          const { error, count } = await supabase.from("pi_feed_staging")
            .upsert(slice, { onConflict: "rss_url", ignoreDuplicates: true, count: "exact" });
          if (error) errors.push({ insert_err: error.message });
          else totalInserted += count ?? slice.length;
        }
      }

      // Advance cursor; if no progress, break
      if (minCreated >= cursor) break;
      cursor = minCreated - 1;
      // small pause to be nice to PI
      await new Promise((r) => setTimeout(r, 200));
    }

    if (importId) {
      await supabase.from("pi_dump_imports").update({
        feeds_received: totalSeen,
        status: "processing",
        notes: { pages, errors, unique_urls: allUrls.size },
        updated_at: new Date().toISOString(),
      }).eq("id", importId);
    }

    return new Response(JSON.stringify({
      ok: true, import_id: importId, pages, total_seen: totalSeen,
      unique_urls: allUrls.size, inserted: totalInserted,
      cursor_reached: cursor, oldest_target: oldestSec, errors,
      elapsed_ms: Date.now() - startedMs,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
