// Compute prefetch targets: for each candidate HU podcast, gather
// - cadence (episodes/week from last 60 days)
// - GSC top queries + impressions/clicks (last 28 days, filtered by podcast slug URL)
// - Apify Google Trends related & rising queries (seeded with podcast title)
// - Gap = trend queries we don't rank for in GSC
//
// POST body: { limit?: number (default 15), dry_run?: bool, skip_trends?: bool, skip_gsc?: bool }
// Env: LOVABLE_API_KEY, GOOGLE_SEARCH_CONSOLE_API_KEY, APIFY_API_TOKEN,
//      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE_URL = "sc-domain:podiverzum.hu";
const GATEWAY = "https://connector-gateway.lovable.dev/google_search_console";
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
const GSC_KEY = Deno.env.get("GOOGLE_SEARCH_CONSOLE_API_KEY") || "";
const APIFY_TOKEN = Deno.env.get("APIFY_API_TOKEN") || "";

// emastra's actor supports keyword-based related+rising queries.
// Input: { searchTerms: [...], geo: "HU", timeRange: "today 3-m", category: 0 }
const TRENDS_ACTOR = "emastra~google-trends-scraper";

const SB = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Candidate = {
  id: string;
  slug: string;
  title: string;
  rank_label: string | null;
  episodes_last_60d: number;
  cadence_per_week: number;
  cadence_pattern: string;
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Fetch weekly-cadence HU podcast candidates. Priority: S/A tier + regular cadence. */
async function fetchCandidates(limit: number): Promise<Candidate[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 60);

  // Grab top-ranked HU podcasts
  const { data: podcasts, error } = await SB
    .from("podcasts")
    .select("id, slug, title, display_title, rank_label")
    .ilike("language", "hu%")
    .in("rank_label", ["S", "A", "B"])
    .eq("is_public", true)
    .limit(limit * 4);
  if (error) throw error;
  if (!podcasts?.length) return [];

  const ids = podcasts.map((p: any) => p.id);
  const { data: eps, error: epsErr } = await SB
    .from("episodes")
    .select("podcast_id, published_at")
    .in("podcast_id", ids)
    .gte("published_at", since.toISOString())
    .limit(20000);
  if (epsErr) throw epsErr;

  const countByPodcast = new Map<string, number>();
  const weekdays = new Map<string, Set<number>>();
  for (const e of eps || []) {
    const pid = (e as any).podcast_id as string;
    countByPodcast.set(pid, (countByPodcast.get(pid) || 0) + 1);
    const dow = new Date((e as any).published_at).getUTCDay();
    if (!weekdays.has(pid)) weekdays.set(pid, new Set());
    weekdays.get(pid)!.add(dow);
  }

  const out: Candidate[] = [];
  for (const p of podcasts) {
    const count = countByPodcast.get((p as any).id) || 0;
    const cadence = count / (60 / 7);
    if (cadence < 0.9) continue; // at least ~1/week
    const dows = Array.from(weekdays.get((p as any).id) || []).sort();
    // Pattern: single-weekday = "heti fix", 3+ days = "napi vagy sűrű"
    let pattern = "változó";
    if (dows.length === 1) pattern = `heti (${["V", "H", "K", "Sze", "Cs", "P", "Szo"][dows[0]]})`;
    else if (dows.length >= 5 && count >= 20) pattern = "napi";
    else if (dows.length <= 3) pattern = "heti több";

    out.push({
      id: (p as any).id,
      slug: (p as any).slug,
      title: (p as any).display_title || (p as any).title,
      rank_label: (p as any).rank_label,
      episodes_last_60d: count,
      cadence_per_week: Number(cadence.toFixed(2)),
      cadence_pattern: pattern,
    });
  }

  // Sort by tier (S>A>B) then cadence desc
  const tierRank: Record<string, number> = { S: 3, A: 2, B: 1 };
  out.sort((a, b) => {
    const t = (tierRank[b.rank_label || ""] || 0) - (tierRank[a.rank_label || ""] || 0);
    if (t !== 0) return t;
    return b.cadence_per_week - a.cadence_per_week;
  });

  return out.slice(0, limit);
}

/** GSC top queries for pages containing the podcast slug URL. */
async function gscTopQueriesForPodcast(slug: string): Promise<{
  queries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
  totalImpressions: number;
  totalClicks: number;
  avgPosition: number | null;
}> {
  if (!LOVABLE_API_KEY || !GSC_KEY) {
    return { queries: [], totalImpressions: 0, totalClicks: 0, avgPosition: null };
  }
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2); // GSC data lag
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 28);

  const body = {
    startDate: isoDate(start),
    endDate: isoDate(end),
    dimensions: ["query"],
    dimensionFilterGroups: [
      {
        filters: [
          { dimension: "page", operator: "contains", expression: `/podcast/${slug}` },
        ],
      },
    ],
    rowLimit: 20,
  };

  const r = await fetch(
    `${GATEWAY}/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GSC_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) {
    console.warn(`GSC ${r.status} for ${slug}:`, await r.text().catch(() => ""));
    return { queries: [], totalImpressions: 0, totalClicks: 0, avgPosition: null };
  }
  const j = await r.json();
  const rows = (j.rows || []) as Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }>;
  let totalI = 0, totalC = 0, posSum = 0, posW = 0;
  const queries = rows.map((row) => {
    totalI += row.impressions;
    totalC += row.clicks;
    posSum += row.position * row.impressions;
    posW += row.impressions;
    return {
      query: row.keys[0],
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: Number((row.ctr * 100).toFixed(2)),
      position: Number(row.position.toFixed(1)),
    };
  });
  return {
    queries,
    totalImpressions: totalI,
    totalClicks: totalC,
    avgPosition: posW ? Number((posSum / posW).toFixed(2)) : null,
  };
}

/** Apify Google Trends for a list of keywords — returns related + rising queries per term. */
async function fetchTrendsForKeywords(keywords: string[]): Promise<
  Map<string, { related: string[]; rising: string[] }>
> {
  const result = new Map<string, { related: string[]; rising: string[] }>();
  if (!APIFY_TOKEN || keywords.length === 0) return result;

  const url = `https://api.apify.com/v2/acts/${TRENDS_ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&clean=true`;
  const input = {
    searchTerms: keywords,
    geo: "HU",
    category: 0,
    timeRange: "today 3-m",
    isPublicationLimited: true,
    maxItems: keywords.length * 20,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    console.warn(`Apify trends ${res.status}:`, await res.text().catch(() => ""));
    return result;
  }
  const data = await res.json();
  if (!Array.isArray(data)) return result;

  // Normalize: actor rows may look like { searchTerm, relatedQueries: {top:[], rising:[]} }
  for (const row of data as any[]) {
    const term = String(row.searchTerm || row.keyword || row.query || "").trim();
    if (!term) continue;
    const bucket = result.get(term) || { related: [], rising: [] };
    const rq = row.relatedQueries || row.related_queries || {};
    const top = Array.isArray(rq.top) ? rq.top : Array.isArray(rq.rankedList?.[0]?.rankedKeyword) ? rq.rankedList[0].rankedKeyword : [];
    const rising = Array.isArray(rq.rising) ? rq.rising : Array.isArray(rq.rankedList?.[1]?.rankedKeyword) ? rq.rankedList[1].rankedKeyword : [];
    for (const t of top.slice(0, 10)) {
      const q = String(t.query || t.topic?.title || t.keyword || "").trim();
      if (q && !bucket.related.includes(q)) bucket.related.push(q);
    }
    for (const t of rising.slice(0, 10)) {
      const q = String(t.query || t.topic?.title || t.keyword || "").trim();
      if (q && !bucket.rising.includes(q)) bucket.rising.push(q);
    }
    result.set(term, bucket);
  }
  return result;
}

function computePriorityAndActions(c: {
  cadence: number;
  gscImpressions: number;
  gscClicks: number;
  avgPos: number | null;
  trendsRising: number;
  gapCount: number;
}): { score: number; actions: string[] } {
  // Score: mix of demand (GSC impressions), gap opportunity, cadence weight
  const demandScore = Math.min(100, c.gscImpressions / 10);
  const gapScore = Math.min(50, c.gapCount * 5);
  const risingScore = Math.min(30, c.trendsRising * 3);
  const cadenceScore = Math.min(20, c.cadence * 4);
  const score = Math.round(demandScore + gapScore + risingScore + cadenceScore);

  const actions: string[] = [];
  if (c.avgPos && c.avgPos > 3 && c.gscImpressions > 100) {
    actions.push(`CTR/cím-opt: átlagpozíció ${c.avgPos}, ${c.gscImpressions} impresszió`);
  }
  if (c.gapCount >= 3) {
    actions.push(`${c.gapCount} gap query — új landing page vagy epizód-cím módosítás`);
  }
  if (c.cadence >= 4 && c.avgPos !== null && c.avgPos < 5) {
    actions.push("Prefetch placeholder — Fábry-minta, publikálás előtt 6h-val");
  }
  if (c.trendsRising >= 3) {
    actions.push(`${c.trendsRising} felfutó Trends query — sürgős tartalom-igazítás`);
  }
  if (actions.length === 0) actions.push("Nincs sürgős akció — figyelni");
  return { score, actions };
}

function normalizeQ(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.min(50, Math.max(1, Number(body.limit) || 15));
    const dryRun = body.dry_run === true;
    const skipTrends = body.skip_trends === true;
    const skipGsc = body.skip_gsc === true;

    console.log(`[prefetch-targets] limit=${limit} dry_run=${dryRun} skip_trends=${skipTrends} skip_gsc=${skipGsc}`);

    const candidates = await fetchCandidates(limit);
    console.log(`[prefetch-targets] ${candidates.length} candidates`);

    // GSC (sequential; per-call fast)
    const gscByPodcast = new Map<string, Awaited<ReturnType<typeof gscTopQueriesForPodcast>>>();
    if (!skipGsc) {
      for (const c of candidates) {
        try {
          gscByPodcast.set(c.id, await gscTopQueriesForPodcast(c.slug));
        } catch (e) {
          console.warn(`[prefetch-targets] GSC fail ${c.slug}:`, (e as Error).message);
          gscByPodcast.set(c.id, { queries: [], totalImpressions: 0, totalClicks: 0, avgPosition: null });
        }
      }
    }

    // Apify Trends: batch all keywords in one actor run
    let trendsMap = new Map<string, { related: string[]; rising: string[] }>();
    if (!skipTrends) {
      const keywords = candidates.map((c) => c.title);
      try {
        trendsMap = await fetchTrendsForKeywords(keywords);
      } catch (e) {
        console.warn("[prefetch-targets] trends batch failed:", (e as Error).message);
      }
    }

    const rows = candidates.map((c) => {
      const gsc = gscByPodcast.get(c.id) || { queries: [], totalImpressions: 0, totalClicks: 0, avgPosition: null };
      const trends = trendsMap.get(c.title) || { related: [], rising: [] };
      const gscQNorms = new Set(gsc.queries.map((q) => normalizeQ(q.query)));
      const gap = [...trends.related, ...trends.rising]
        .filter((q) => !gscQNorms.has(normalizeQ(q)))
        .slice(0, 10);
      const { score, actions } = computePriorityAndActions({
        cadence: c.cadence_per_week,
        gscImpressions: gsc.totalImpressions,
        gscClicks: gsc.totalClicks,
        avgPos: gsc.avgPosition,
        trendsRising: trends.rising.length,
        gapCount: gap.length,
      });
      return {
        podcast_id: c.id,
        podcast_slug: c.slug,
        podcast_title: c.title,
        rank_label: c.rank_label,
        cadence_per_week: c.cadence_per_week,
        cadence_pattern: c.cadence_pattern,
        episodes_last_60d: c.episodes_last_60d,
        gsc_impressions_28d: gsc.totalImpressions,
        gsc_clicks_28d: gsc.totalClicks,
        gsc_avg_position: gsc.avgPosition,
        gsc_top_queries: gsc.queries,
        trend_related_queries: trends.related,
        trend_rising_queries: trends.rising,
        gap_queries: gap,
        priority_score: score,
        suggested_actions: actions,
        last_computed_at: new Date().toISOString(),
      };
    });

    if (dryRun) return json({ ok: true, dry_run: true, rows });

    // Upsert
    const { error: upErr } = await SB.from("prefetch_targets").upsert(rows, {
      onConflict: "podcast_id",
    });
    if (upErr) throw upErr;

    return json({ ok: true, count: rows.length });
  } catch (e) {
    console.error("[prefetch-targets] error:", e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
