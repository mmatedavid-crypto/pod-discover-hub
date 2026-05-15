// Live PodcastIndex fallback for the search bar (HU).
// When the local DB has no podcast title matches for a query, the SearchPage
// invokes this function. We:
//   1) call PI /search/byterm
//   2) prefer HU language podcasts
//   3) dedupe against `podcasts` and `pi_feed_staging`
//   4) stage the top N into `pi_feed_staging` so the regular pipeline ingests
//   5) return preview cards to render a "hamarosan elérhető" panel
//
// Public (verify_jwt=false). Cheap: 1 PI call + a few selects + 1 upsert.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

async function sha1Hex(input: string) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function qualityScore(p: any): number {
  let s = 0;
  if (p.url) s += 30;
  if (p.image || p.artwork) s += 20;
  const last = p.newestItemPublishTime ? p.newestItemPublishTime * 1000 : 0;
  if (last && Date.now() - last < 60 * 24 * 3600 * 1000) s += 20;
  if ((p.episodeCount || 0) >= 10) s += 10;
  if (p.description) s += 10;
  if ((p.language || "").toLowerCase().startsWith("hu")) s += 30; // strong HU preference
  if (p.dead === 1) s -= 60;
  if (p.lastHttpStatus === 404) s -= 60;
  return s;
}

function normLang(l: string | null | undefined): string | null {
  if (!l) return null;
  const v = l.toLowerCase().trim();
  if (v.startsWith("hu")) return "hu";
  if (v.startsWith("en")) return "en";
  return v.slice(0, 5);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("PODCAST_INDEX_API_KEY");
    const apiSecret = Deno.env.get("PODCAST_INDEX_API_SECRET");
    if (!apiKey || !apiSecret) {
      return new Response(JSON.stringify({ error: "PodcastIndex creds missing" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const url = new URL(req.url);
    const q = String(body.query || url.searchParams.get("q") || "").trim();
    const maxStage = Math.min(Number(body.maxStage || 5), 10);
    if (q.length < 3) {
      return new Response(JSON.stringify({ ok: true, candidates: [], staged: 0, reason: "too_short" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1) PI byterm
    const date = Math.floor(Date.now() / 1000).toString();
    const auth = await sha1Hex(apiKey + apiSecret + date);
    const params = new URLSearchParams({ q, max: "20" });
    const piRes = await fetch(`https://api.podcastindex.org/api/1.0/search/byterm?${params}`, {
      headers: {
        "User-Agent": "Podiverzum/1.0 (search-fallback)",
        "X-Auth-Date": date, "X-Auth-Key": apiKey, "Authorization": auth,
      },
    });
    if (!piRes.ok) {
      const t = await piRes.text();
      return new Response(JSON.stringify({ error: `PI ${piRes.status}: ${t.slice(0, 160)}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const data = await piRes.json();
    const feeds: any[] = Array.isArray(data.feeds) ? data.feeds : [];

    // 2) prefer HU; allow unknown lang too (AI guard will sort it out later)
    const ranked = feeds
      .filter((p) => p?.url && p.dead !== 1)
      .map((p) => ({ p, score: qualityScore(p) }))
      .filter((x) => x.score >= 50)
      .sort((a, b) => b.score - a.score);

    if (ranked.length === 0) {
      return new Response(JSON.stringify({ ok: true, candidates: [], staged: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) dedupe against existing
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const candidateUrls = ranked.map((x) => x.p.url);
    const [{ data: existPods }, { data: existStg }] = await Promise.all([
      supabase.from("podcasts").select("rss_url,slug,title,display_title,image_url,language").in("rss_url", candidateUrls),
      supabase.from("pi_feed_staging").select("rss_url").in("rss_url", candidateUrls),
    ]);
    const existPodsByUrl = new Map<string, any>((existPods || []).map((r: any) => [r.rss_url, r]));
    const stagedSet = new Set<string>((existStg || []).map((r: any) => r.rss_url));

    const candidates: any[] = [];
    const toStage: any[] = [];
    for (const { p, score } of ranked) {
      const existing = existPodsByUrl.get(p.url);
      if (existing) {
        // Only surface as "indexed" if it's HU (we don't want to send users to EN podcasts on HU site)
        const isHu = (existing.language || "").toLowerCase().startsWith("hu");
        if (isHu) {
          candidates.push({
            status: "indexed",
            title: existing.display_title || existing.title || p.title,
            image_url: existing.image_url || p.image || p.artwork || null,
            author: p.author || p.ownerName || null,
            podcast_slug: existing.slug,
            score,
          });
        }
        continue;
      }
      candidates.push({
        status: stagedSet.has(p.url) ? "staged" : "new",
        title: p.title,
        image_url: p.image || p.artwork || null,
        author: p.author || p.ownerName || null,
        description: p.description || null,
        score,
      });
      if (!stagedSet.has(p.url) && toStage.length < maxStage) {
        toStage.push(p);
      }
    }

    // 4) stage new ones (best-effort)
    let stagedCount = 0;
    if (toStage.length > 0) {
      const { data: imp } = await supabase.from("pi_dump_imports")
        .insert({ source: "search_fallback", status: "ingesting", snapshot_date: new Date().toISOString().slice(0, 10) })
        .select("id").single();
      const importId = imp?.id ?? null;
      const rows = toStage.map((p) => ({
        import_id: importId,
        pi_id: p.id ?? null,
        rss_url: p.url,
        title: p.title || null,
        website_url: p.link || null,
        image_url: p.image || p.artwork || null,
        description: p.description || null,
        language: normLang(p.language),
        author: p.author || p.ownerName || null,
        episode_count: p.episodeCount ?? null,
        newest_item_at: p.newestItemPublishTime ? new Date(p.newestItemPublishTime * 1000).toISOString() : null,
        last_http_status: p.lastHttpStatus ?? null,
        dead: p.dead === 1,
      }));
      const { error, count } = await supabase
        .from("pi_feed_staging")
        .upsert(rows, { onConflict: "rss_url", ignoreDuplicates: true, count: "exact" });
      stagedCount = error ? 0 : (count ?? rows.length);
      if (importId) {
        await supabase.from("pi_dump_imports").update({
          feeds_received: rows.length,
          status: "processing",
          notes: { query: q, source: "search_fallback" },
          updated_at: new Date().toISOString(),
        }).eq("id", importId);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      query: q,
      candidates: candidates.slice(0, 8),
      staged: stagedCount,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
