// Ingest a batch of Podcast Index dump rows into pi_feed_staging.
// Operator runs a local script that streams NDJSON batches here.
// Body: { import_id?, snapshot_date?, finalize?: bool, feeds: [{ pi_id, url, title, link, description, language, image, episodeCount, newestItemPubdate (unix sec), lastHttpStatus, dead, itunesAuthor }] }
// Auth: requires Bearer service-role key (set verify_jwt=false on this function).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("authorization") || "";
    const expected = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!auth.toLowerCase().startsWith("bearer ") || auth.slice(7) !== expected) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, expected);
    const body = await req.json();
    let importId: string | undefined = body.import_id;
    const snapshotDate: string | undefined = body.snapshot_date;
    const finalize: boolean = !!body.finalize;
    const feeds: any[] = Array.isArray(body.feeds) ? body.feeds : [];

    if (!importId) {
      const { data, error } = await supabase.from("pi_dump_imports")
        .insert({ snapshot_date: snapshotDate || null, status: "ingesting" })
        .select("id").single();
      if (error) throw error;
      importId = data.id;
    }

    let inserted = 0, dupInBatch = 0, alreadyImported = 0;
    if (feeds.length) {
      // Skip rows whose rss_url already exists in podcasts
      const urls = feeds.map((f) => f.url).filter(Boolean);
      const { data: existing } = await supabase.from("podcasts").select("rss_url").in("rss_url", urls);
      const exSet = new Set((existing || []).map((r: any) => r.rss_url));

      const rows = feeds
        .filter((f) => f.url && !exSet.has(f.url))
        .map((f) => ({
          import_id: importId,
          pi_id: f.pi_id ?? f.id ?? null,
          rss_url: f.url,
          title: f.title || null,
          website_url: f.link || null,
          image_url: f.image || f.artwork || null,
          description: f.description || null,
          language: f.language || null,
          author: f.itunesAuthor || f.author || null,
          episode_count: f.episodeCount ?? null,
          newest_item_at: f.newestItemPubdate ? new Date(Number(f.newestItemPubdate) * 1000).toISOString() : null,
          last_http_status: f.lastHttpStatus ?? null,
          dead: f.dead === 1 || f.dead === true,
        }));
      alreadyImported = feeds.length - rows.length;

      // Chunk upserts (Postgres limit + edge memory)
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const slice = rows.slice(i, i + CHUNK);
        const { error, count } = await supabase
          .from("pi_feed_staging")
          .upsert(slice, { onConflict: "rss_url", ignoreDuplicates: true, count: "exact" });
        if (error) throw error;
        inserted += count ?? slice.length;
      }
      dupInBatch = rows.length - inserted;
    }

    // Update totals
    const { data: cur } = await supabase.from("pi_dump_imports").select("feeds_received, skipped_duplicates").eq("id", importId).single();
    await supabase.from("pi_dump_imports").update({
      feeds_received: (cur?.feeds_received || 0) + feeds.length,
      skipped_duplicates: (cur?.skipped_duplicates || 0) + alreadyImported + dupInBatch,
      status: finalize ? "processing" : "ingesting",
      updated_at: new Date().toISOString(),
    }).eq("id", importId);

    return new Response(JSON.stringify({
      ok: true, import_id: importId, batch_size: feeds.length,
      inserted, duplicates_in_batch: dupInBatch, already_in_podcasts: alreadyImported,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
