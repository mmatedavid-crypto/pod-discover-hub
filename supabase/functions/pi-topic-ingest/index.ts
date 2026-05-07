// Cloud-only PI search-by-term ingest into pi_feed_staging.
// Body: { terms: string[], max?: number (per term, ≤40), lang?: "en" }
// Bounded: max 8 terms per call, max 40 results per term.
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

async function piFetch(path: string, params: Record<string, string>) {
  const apiKey = Deno.env.get("PODCAST_INDEX_API_KEY")!;
  const apiSecret = Deno.env.get("PODCAST_INDEX_API_SECRET")!;
  const date = Math.floor(Date.now() / 1000).toString();
  const auth = await sha1Hex(apiKey + apiSecret + date);
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`https://api.podcastindex.org/api/1.0${path}?${qs}`, {
    headers: {
      "User-Agent": "Podiverzum/1.0",
      "X-Auth-Date": date,
      "X-Auth-Key": apiKey,
      "Authorization": auth,
    },
  });
  if (!res.ok) throw new Error(`PI ${path} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const rawTerms: string[] = Array.isArray(body.terms) ? body.terms : [];
    const terms = rawTerms.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 8);
    if (!terms.length) {
      return new Response(JSON.stringify({ error: "terms required (1–8)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const perTerm = String(Math.min(40, Math.max(5, Number(body.max) || 20)));
    const lang = (body.lang || "en").toLowerCase();

    // Open import row
    const { data: imp, error: impErr } = await supabase.from("pi_dump_imports")
      .insert({ source: "pi_topic", status: "ingesting", snapshot_date: new Date().toISOString().slice(0, 10) })
      .select("id").single();
    if (impErr) throw impErr;

    const errors: string[] = [];
    const all: any[] = [];
    for (const term of terms) {
      try {
        const r = await piFetch("/search/byterm", { q: term, max: perTerm });
        for (const f of (r.feeds || [])) all.push({ ...f, _term: term });
      } catch (e) {
        errors.push(`${term}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Filter: language en, dedup by url within batch
    const seen = new Set<string>();
    const feeds = all.filter((f: any) => {
      const u = f.url; if (!u || seen.has(u)) return false;
      const fl = String(f.language || "").toLowerCase();
      if (lang === "en" && fl && !fl.startsWith("en")) return false;
      seen.add(u); return true;
    });

    // Skip URLs already in podcasts
    const urls = feeds.map((f: any) => f.url);
    const exSet = new Set<string>();
    for (let i = 0; i < urls.length; i += 200) {
      const slice = urls.slice(i, i + 200);
      const { data } = await supabase.from("podcasts").select("rss_url").in("rss_url", slice);
      (data || []).forEach((r: any) => exSet.add(r.rss_url));
    }

    const rows = feeds.filter((f: any) => !exSet.has(f.url)).map((f: any) => ({
      import_id: imp.id,
      pi_id: f.id ?? null,
      rss_url: f.url,
      title: f.title || null,
      website_url: f.link || null,
      image_url: f.image || f.artwork || null,
      description: f.description || null,
      language: f.language || null,
      author: f.author || f.ownerName || null,
      episode_count: f.episodeCount ?? null,
      newest_item_at: f.newestItemPublishTime ? new Date(f.newestItemPublishTime * 1000).toISOString() : null,
      last_http_status: f.lastHttpStatus ?? null,
      dead: f.dead === 1,
    }));
    const alreadyImported = feeds.length - rows.length;

    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const slice = rows.slice(i, i + 500);
      const { error, count } = await supabase
        .from("pi_feed_staging")
        .upsert(slice, { onConflict: "rss_url", ignoreDuplicates: true, count: "exact" });
      if (error) throw error;
      inserted += count ?? slice.length;
    }
    const dupInBatch = rows.length - inserted;

    await supabase.from("pi_dump_imports").update({
      feeds_received: feeds.length,
      skipped_duplicates: alreadyImported + dupInBatch,
      status: "processing",
      notes: { errors, terms, lang, per_term: perTerm },
      updated_at: new Date().toISOString(),
    }).eq("id", imp.id);

    return new Response(JSON.stringify({
      ok: true, import_id: imp.id, terms, fetched: feeds.length,
      inserted, duplicates_in_batch: dupInBatch, already_in_podcasts: alreadyImported, errors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
