// Fetch HU Google Trends via Apify and match top podcast episodes for each trend.
// Trigger: pg_cron (twice daily) or manual POST.
//
// Required env:
//   APIFY_API_TOKEN          - Apify token (workspace secret)
//   SUPABASE_URL             - injected
//   SUPABASE_SERVICE_ROLE_KEY - injected
//
// Optional body: { limit?: number (default 8), actor?: string, dryRun?: boolean }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const APIFY_TOKEN = Deno.env.get("APIFY_API_TOKEN");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Apify "Google Trends Scraper" actor. The community actor id used here:
//   emastra/google-trends-scraper (alias: emastra~google-trends-scraper)
// Override via body.actor if you license a different actor.
const DEFAULT_ACTOR = "emastra~google-trends-scraper";

type TrendItem = {
  keyword: string;
  rank: number;
  traffic?: string | null;
  related?: string[];
};

async function runApifyActor(actor: string): Promise<TrendItem[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_API_TOKEN missing");

  // Synchronous run-and-get-dataset endpoint — Apify waits up to ~5 min.
  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&clean=true`;

  const input = {
    geo: "HU",
    country: "HU",
    region: "HU",
    timeRange: "now 1-d",
    category: "",
    maxItems: 20,
    type: "daily",
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Apify ${res.status}: ${txt.slice(0, 400)}`);
  }

  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("Apify returned non-array");

  // Normalize across actor shapes.
  const items: TrendItem[] = [];
  for (let i = 0; i < data.length; i++) {
    const row: any = data[i];
    const keyword =
      row.title?.query ||
      row.title ||
      row.query ||
      row.keyword ||
      row.term ||
      row.name;
    if (!keyword || typeof keyword !== "string") continue;
    const traffic =
      row.formattedTraffic ||
      row.traffic ||
      row.searchVolume ||
      null;
    const related: string[] = [];
    const relatedSrc = row.relatedQueries || row.related || row.articles || [];
    if (Array.isArray(relatedSrc)) {
      for (const r of relatedSrc.slice(0, 5)) {
        if (typeof r === "string") related.push(r);
        else if (r?.query) related.push(String(r.query));
        else if (r?.title) related.push(String(r.title));
      }
    }
    items.push({ keyword: keyword.trim(), rank: items.length + 1, traffic, related });
  }
  return items;
}

async function matchEpisodesFor(keyword: string): Promise<
  { episode_id: string; score: number; source: string }[]
> {
  // Use existing internal search-hybrid edge function (bot path returns lexical).
  // We call it server-side with service auth — fast and avoids re-implementing FTS.
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/search-hybrid`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SERVICE_KEY}`,
        apikey: SERVICE_KEY,
        "User-Agent": "podiverzum-trends-matcher/1.0",
      },
      body: JSON.stringify({ q: keyword, limit: 8, rerank: false }),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const rows = json?.episodes || json?.results || json?.items || [];
    const out: { episode_id: string; score: number; source: string }[] = [];
    for (const r of rows.slice(0, 3)) {
      const id = r.id || r.episode_id;
      if (!id) continue;
      out.push({
        episode_id: id,
        score: Number(r.score ?? r.hybrid_score ?? r.rank ?? 0),
        source: "search-hybrid",
      });
    }
    return out;
  } catch (e) {
    console.warn("search-hybrid call failed for", keyword, e);
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const limit = Math.max(3, Math.min(20, Number(body.limit) || 8));
  const actor = String(body.actor || DEFAULT_ACTOR);
  const dryRun = !!body.dryRun;

  try {
    const trends = (await runApifyActor(actor)).slice(0, limit);
    if (trends.length === 0) {
      return new Response(JSON.stringify({ ok: false, error: "no trends" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 502,
      });
    }

    if (dryRun) {
      return new Response(JSON.stringify({ ok: true, dryRun: true, trends }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const batchId = crypto.randomUUID();
    const rows = trends.map((t) => ({
      keyword: t.keyword,
      rank: t.rank,
      traffic: t.traffic ?? null,
      related_queries: t.related ?? [],
      batch_id: batchId,
      region: "HU",
      source: "apify_google_trends",
      is_active: true,
    }));

    // Deactivate previous snapshot, then insert new batch.
    await supabase.from("daily_trends").update({ is_active: false }).eq("is_active", true);
    const { data: inserted, error: insErr } = await supabase
      .from("daily_trends")
      .insert(rows)
      .select("id,keyword");
    if (insErr) throw insErr;

    // Match episodes for each trend (sequential — keeps load gentle).
    let matched = 0;
    for (const t of inserted || []) {
      const matches = await matchEpisodesFor(t.keyword);
      if (!matches.length) continue;
      const mapRows = matches.map((m, i) => ({
        trend_id: t.id,
        episode_id: m.episode_id,
        rank: i + 1,
        score: m.score,
        match_source: m.source,
      }));
      const { error: mErr } = await supabase
        .from("daily_trend_episodes")
        .upsert(mapRows, { onConflict: "trend_id,episode_id" });
      if (mErr) console.warn("upsert match failed", t.keyword, mErr);
      else matched += mapRows.length;
    }

    return new Response(
      JSON.stringify({ ok: true, batchId, trends: inserted?.length || 0, episodeLinks: matched }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("fetch-daily-trends error", e);
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
