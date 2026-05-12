// Broad iTunes HU storefront enumeration → pi_feed_staging.
// Runs ~80 generic Hungarian queries, dedups, looks up RSS via iTunes lookup, inserts.
// POST { extra_terms?: string[] }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HU_TERMS = [
  // generic
  "podcast", "magyar", "magyarország", "beszélgetés", "interjú", "műsor", "rádió",
  // topics
  "gazdaság", "pénzügy", "tőzsde", "befektetés", "vállalkozás", "üzlet", "marketing",
  "politika", "közélet", "hírek", "vélemény", "elemzés",
  "sport", "foci", "labdarúgás", "futball", "kosárlabda", "olimpia", "forma 1",
  "humor", "vicc", "stand up", "kabaré", "szórakozás",
  "tudomány", "technológia", "innováció", "ai", "mesterséges intelligencia",
  "történelem", "irodalom", "könyv", "film", "sorozat", "kultúra", "művészet", "zene",
  "egészség", "pszichológia", "életmód", "mindfulness", "önfejlesztés", "coaching",
  "család", "gyerek", "szülő", "kapcsolat", "párkapcsolat",
  "utazás", "gasztronómia", "főzés", "recept", "étterem", "bor",
  "vallás", "spiritualitás", "filozófia",
  "egyetem", "oktatás", "tanulás", "diák", "kutatás",
  "építészet", "design", "divat",
  "auto", "motor", "tech",
  // hosts/networks (kiegészítő, alacsony zaj)
  "telex", "partizán", "444", "index", "hvg", "portfolio", "24.hu", "mandiner",
  "youtube podcast magyar",
];

async function itunesSearch(term: string, errorsOut: any[]) {
  // Hungarian storefront, podcast media
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=hu&media=podcast&entity=podcast&limit=200`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Podiverzum/1.0" } });
    if (!res.ok) {
      errorsOut.push({ term, status: res.status });
      return [];
    }
    const data = await res.json();
    return Array.isArray(data.results) ? data.results : [];
  } catch (e) {
    errorsOut.push({ term, error: e instanceof Error ? e.message : "fetch_err" });
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const extra: string[] = Array.isArray(body.extra_terms) ? body.extra_terms : [];
    const terms = [...HU_TERMS, ...extra];

    const { data: imp } = await supabase.from("pi_dump_imports")
      .insert({ status: "ingesting", source: "itunes_hu_enumerate" })
      .select("id").single();
    const importId = imp?.id;

    const startedMs = Date.now();
    const TIME_BUDGET = 110_000;
    const errors: any[] = [];
    const byTrackId = new Map<number, any>();
    let totalResults = 0;
    let termsProcessed = 0;

    for (const term of terms) {
      if ((Date.now() - startedMs) > TIME_BUDGET - 15_000) { errors.push({ truncated: true, after: termsProcessed }); break; }
      const results = await itunesSearch(term, errors);
      totalResults += results.length;
      termsProcessed++;
      for (const r of results) {
        if (!r.feedUrl || !r.trackId) continue;
        if (!byTrackId.has(r.trackId)) byTrackId.set(r.trackId, r);
      }
      // gentle throttle
      await new Promise((rs) => setTimeout(rs, 80));
    }

    const all = Array.from(byTrackId.values());
    const urls = all.map((r) => r.feedUrl).filter(Boolean);
    const existing = new Set<string>();
    const CHUNK_LOOKUP = 500;
    for (let i = 0; i < urls.length; i += CHUNK_LOOKUP) {
      const slice = urls.slice(i, i + CHUNK_LOOKUP);
      const { data: ex } = await supabase.from("podcasts").select("rss_url").in("rss_url", slice);
      (ex || []).forEach((r: any) => existing.add(r.rss_url));
    }

    const rows = all.filter((r) => !existing.has(r.feedUrl)).map((r) => ({
      import_id: importId,
      pi_id: null,
      rss_url: r.feedUrl,
      title: r.collectionName || r.trackName || null,
      website_url: r.collectionViewUrl || r.trackViewUrl || null,
      image_url: r.artworkUrl600 || r.artworkUrl100 || null,
      description: null,
      language: "hu", // iTunes HU storefront → assume HU; pipeline language guard verifies
      author: r.artistName || null,
      episode_count: r.trackCount ?? null,
      newest_item_at: r.releaseDate ? new Date(r.releaseDate).toISOString() : null,
      last_http_status: null,
      dead: false,
    }));

    let inserted = 0;
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const { error, count } = await supabase.from("pi_feed_staging")
        .upsert(slice, { onConflict: "rss_url", ignoreDuplicates: true, count: "exact" });
      if (error) errors.push({ insert_err: error.message });
      else inserted += count ?? slice.length;
    }

    if (importId) {
      await supabase.from("pi_dump_imports").update({
        feeds_received: totalResults,
        status: "processing",
        notes: { terms: termsProcessed, unique_track_ids: all.length, errors_sample: errors.slice(0, 20) },
        updated_at: new Date().toISOString(),
      }).eq("id", importId);
    }

    return new Response(JSON.stringify({
      ok: true, import_id: importId, terms_processed: termsProcessed,
      total_results: totalResults, unique_podcasts: all.length, inserted,
      already_in_podcasts: all.length - rows.length,
      errors: errors.slice(0, 30),
      elapsed_ms: Date.now() - startedMs,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
