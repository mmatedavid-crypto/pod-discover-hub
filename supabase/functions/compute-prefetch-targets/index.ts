// Compute prefetch targets — Trends-first version.
//
// Insight (2026-07-14): GSC on podiverzum.hu is still tiny (~500 clicks total),
// so GSC-driven priority is statistically noise. What actually matters:
// **what people search on Google around a given podcast / host**, regardless
// of whether we currently rank for it. Trends is the primary signal; GSC is
// kept only as diagnostic ("do we already catch any of this?").
//
// Scope: S + A tier HU podcasts only (~70 rows), no cadence filter.
// Seeds per podcast: [podcast title, first host name, "{title} {latest ep title}"].
// Priority score weights Trends heavily; GSC contributes at most a small bump.
//
// POST body: { limit?: number (default 80), dry_run?: bool, skip_trends?: bool, skip_gsc?: bool }
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

const TRENDS_ACTOR = "emastra~google-trends-scraper";
const TRENDS_BATCH_SIZE = 30; // seeds per actor run

const SB = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

type Candidate = {
  id: string;
  slug: string;
  title: string;
  rank_label: string | null;
  hosts: string[];
  episodes_last_60d: number;
  cadence_per_week: number;
  cadence_pattern: string;
  latestEpTitle: string | null;
};

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** Fetch S + A HU podcasts with hosts, cadence metadata, and latest episode title. */
async function fetchCandidates(limit: number): Promise<Candidate[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 60);

  const { data: podcasts, error } = await SB
    .from("podcasts")
    .select("id, slug, title, display_title, rank_label, hosts")
    .ilike("language", "hu%")
    .in("rank_label", ["S", "A"])
    .limit(200);
  if (error) throw error;
  if (!podcasts?.length) return [];

  const ids = podcasts.map((p: any) => p.id);
  const { data: eps } = await SB
    .from("episodes")
    .select("podcast_id, published_at, title")
    .in("podcast_id", ids)
    .gte("published_at", since.toISOString())
    .order("published_at", { ascending: false })
    .limit(30000);

  const countByPodcast = new Map<string, number>();
  const weekdays = new Map<string, Set<number>>();
  const latestByPodcast = new Map<string, string>();
  for (const e of eps || []) {
    const pid = (e as any).podcast_id as string;
    countByPodcast.set(pid, (countByPodcast.get(pid) || 0) + 1);
    const dow = new Date((e as any).published_at).getUTCDay();
    if (!weekdays.has(pid)) weekdays.set(pid, new Set());
    weekdays.get(pid)!.add(dow);
    if (!latestByPodcast.has(pid) && (e as any).title) {
      latestByPodcast.set(pid, String((e as any).title));
    }
  }

  const out: Candidate[] = [];
  for (const p of podcasts) {
    const count = countByPodcast.get((p as any).id) || 0;
    const cadence = count / (60 / 7);
    const dows = Array.from(weekdays.get((p as any).id) || []).sort();
    let pattern = "változó";
    if (count === 0) pattern = "inaktív";
    else if (dows.length === 1) pattern = `heti (${["V", "H", "K", "Sze", "Cs", "P", "Szo"][dows[0]]})`;
    else if (dows.length >= 5 && count >= 20) pattern = "napi";
    else if (dows.length <= 3) pattern = "heti több";

    out.push({
      id: (p as any).id,
      slug: (p as any).slug,
      title: (p as any).display_title || (p as any).title,
      rank_label: (p as any).rank_label,
      hosts: Array.isArray((p as any).hosts) ? (p as any).hosts.filter(Boolean).map(String) : [],
      episodes_last_60d: count,
      cadence_per_week: Number(cadence.toFixed(2)),
      cadence_pattern: pattern,
      latestEpTitle: latestByPodcast.get((p as any).id) || null,
    });
  }

  const tierRank: Record<string, number> = { S: 3, A: 2 };
  out.sort((a, b) => {
    const t = (tierRank[b.rank_label || ""] || 0) - (tierRank[a.rank_label || ""] || 0);
    if (t !== 0) return t;
    return b.cadence_per_week - a.cadence_per_week;
  });
  return out.slice(0, limit);
}

/** Diagnostic only: GSC top queries per podcast slug URL. */
async function gscTopQueriesForPodcast(slug: string) {
  const empty = { queries: [] as any[], totalImpressions: 0, totalClicks: 0, avgPosition: null as number | null };
  if (!LOVABLE_API_KEY || !GSC_KEY) return empty;
  const end = new Date(); end.setUTCDate(end.getUTCDate() - 2);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - 28);

  const r = await fetch(
    `${GATEWAY}/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": GSC_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        startDate: isoDate(start), endDate: isoDate(end),
        dimensions: ["query"],
        dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "contains", expression: `/podcast/${slug}` }] }],
        rowLimit: 20,
      }),
    },
  );
  if (!r.ok) {
    console.warn(`GSC ${r.status} for ${slug}:`, await r.text().catch(() => ""));
    return empty;
  }
  const j = await r.json();
  const rows = (j.rows || []) as Array<{ keys: string[]; clicks: number; impressions: number; ctr: number; position: number }>;
  let totalI = 0, totalC = 0, posSum = 0, posW = 0;
  const queries = rows.map((row) => {
    totalI += row.impressions; totalC += row.clicks;
    posSum += row.position * row.impressions; posW += row.impressions;
    return {
      query: row.keys[0],
      clicks: row.clicks, impressions: row.impressions,
      ctr: Number((row.ctr * 100).toFixed(2)),
      position: Number(row.position.toFixed(1)),
    };
  });
  return {
    queries, totalImpressions: totalI, totalClicks: totalC,
    avgPosition: posW ? Number((posSum / posW).toFixed(2)) : null,
  };
}

/** Apify Google Trends: many seeds per run, batched. Returns per-seed related+rising. */
async function fetchTrendsBatched(seeds: string[]): Promise<Map<string, { related: string[]; rising: string[] }>> {
  const result = new Map<string, { related: string[]; rising: string[] }>();
  if (!APIFY_TOKEN || seeds.length === 0) return result;

  const uniqueSeeds = Array.from(new Set(seeds.map((s) => s.trim()).filter(Boolean)));
  for (let i = 0; i < uniqueSeeds.length; i += TRENDS_BATCH_SIZE) {
    const chunk = uniqueSeeds.slice(i, i + TRENDS_BATCH_SIZE);
    const url = `https://api.apify.com/v2/acts/${TRENDS_ACTOR}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&clean=true`;
    const input = {
      searchTerms: chunk,
      geo: "HU",
      category: 0,
      timeRange: "today 3-m",
      isPublicationLimited: true,
      maxItems: chunk.length * 20,
    };
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
      if (!res.ok) {
        console.warn(`[trends] chunk ${i} apify ${res.status}:`, await res.text().catch(() => ""));
        continue;
      }
      const data = await res.json();
      if (!Array.isArray(data)) continue;
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
    } catch (e) {
      console.warn(`[trends] chunk ${i} failed:`, (e as Error).message);
    }
  }
  return result;
}

/** Trends-first priority. GSC provides only a small "already-in-play" bonus. */
function computePriorityAndActions(c: {
  cadence: number;
  gscImpressions: number;
  avgPos: number | null;
  trendsRelated: number;
  trendsRising: number;
  gapCount: number;
  hasHostSeedHits: boolean;
}): { score: number; actions: string[] } {
  // Trends dominates (max ~120): rising 2x weight
  const trendsScore = Math.min(60, c.trendsRelated * 3) + Math.min(60, c.trendsRising * 6);
  // Gap (Trends query not covered by a local page) — actionable
  const gapScore = Math.min(40, c.gapCount * 5);
  // Cadence: prefetch value only when podcast publishes regularly
  const cadenceScore = Math.min(15, c.cadence * 3);
  // GSC diagnostic bonus — capped low, so it doesn't dominate on a sparse GSC dataset
  const gscBonus = Math.min(10, c.gscImpressions / 100);
  const score = Math.round(trendsScore + gapScore + cadenceScore + gscBonus);

  const actions: string[] = [];
  if (c.trendsRising >= 3) {
    actions.push(`${c.trendsRising} felfutó Trends query — sürgős cím/landing igazítás`);
  }
  if (c.gapCount >= 3) {
    actions.push(`${c.gapCount} gap query (Trends van, nálunk nincs oldal) — új landing / episode-cím`);
  }
  if (c.hasHostSeedHits) {
    actions.push("Host-név alapú keresés aktív — host landing page + host-név a title-be");
  }
  if (c.cadence >= 4) {
    actions.push("Napi vagy sűrű publikáció — prefetch placeholder Fábry-mintára");
  } else if (c.cadence >= 0.9 && c.trendsRelated + c.trendsRising >= 5) {
    actions.push("Heti fix + valódi Trends kereslet — cím-optimalizálás minden új epizódra");
  }
  if (c.gscImpressions > 0 && c.avgPos && c.avgPos > 5) {
    actions.push(`GSC diag: ${c.gscImpressions} impr., átlagpoz. ${c.avgPos} — CTR/cím fixálandó`);
  }
  if (actions.length === 0) actions.push("Alacsony jel — figyelni, ne priorizálni");
  return { score, actions };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.min(120, Math.max(1, Number(body.limit) || 80));
    const dryRun = body.dry_run === true;
    const skipTrends = body.skip_trends === true;
    const skipGsc = body.skip_gsc === true;

    console.log(`[prefetch-targets] limit=${limit} dry=${dryRun} skipTrends=${skipTrends} skipGsc=${skipGsc}`);

    const candidates = await fetchCandidates(limit);
    console.log(`[prefetch-targets] ${candidates.length} S+A candidates`);

    // Build seeds: title + first host + "{title} {latest ep title}"
    // Also track which seed belongs to which podcast + which type.
    type SeedRef = { podcastId: string; kind: "title" | "host" | "titleEp"; seed: string };
    const seedRefs: SeedRef[] = [];
    for (const c of candidates) {
      seedRefs.push({ podcastId: c.id, kind: "title", seed: c.title });
      const host = (c.hosts || [])[0];
      if (host && norm(host) !== norm(c.title)) {
        seedRefs.push({ podcastId: c.id, kind: "host", seed: host });
      }
      if (c.latestEpTitle) {
        // Combine title + latest ep short topic (first 6 words)
        const topic = c.latestEpTitle.split(/\s+/).slice(0, 6).join(" ");
        seedRefs.push({ podcastId: c.id, kind: "titleEp", seed: `${c.title} ${topic}` });
      }
    }
    console.log(`[prefetch-targets] ${seedRefs.length} seeds across ${candidates.length} podcasts`);

    // Trends batch
    let trendsMap = new Map<string, { related: string[]; rising: string[] }>();
    if (!skipTrends) {
      try {
        trendsMap = await fetchTrendsBatched(seedRefs.map((s) => s.seed));
      } catch (e) {
        console.warn("[prefetch-targets] trends failed:", (e as Error).message);
      }
    }

    // GSC (sequential, per-podcast — diagnostic)
    const gscByPodcast = new Map<string, Awaited<ReturnType<typeof gscTopQueriesForPodcast>>>();
    if (!skipGsc) {
      for (const c of candidates) {
        try {
          gscByPodcast.set(c.id, await gscTopQueriesForPodcast(c.slug));
        } catch (e) {
          console.warn(`GSC fail ${c.slug}:`, (e as Error).message);
          gscByPodcast.set(c.id, { queries: [], totalImpressions: 0, totalClicks: 0, avgPosition: null });
        }
      }
    }

    // Aggregate per podcast
    const rows = candidates.map((c) => {
      const related = new Set<string>();
      const rising = new Set<string>();
      let hostSeedHits = false;
      for (const ref of seedRefs) {
        if (ref.podcastId !== c.id) continue;
        const t = trendsMap.get(ref.seed);
        if (!t) continue;
        for (const q of t.related) related.add(q);
        for (const q of t.rising) rising.add(q);
        if (ref.kind === "host" && (t.related.length + t.rising.length) > 0) hostSeedHits = true;
      }
      const relatedArr = Array.from(related).slice(0, 15);
      const risingArr = Array.from(rising).slice(0, 15);

      const gsc = gscByPodcast.get(c.id) || { queries: [], totalImpressions: 0, totalClicks: 0, avgPosition: null };

      // Gap = Trends queries whose normalized form doesn't appear in the podcast
      // title, host, or latest ep title (proxy for "we probably don't have a
      // dedicated page for this yet"). GSC is NOT used for gap detection.
      const localTokens = new Set<string>();
      for (const s of [c.title, ...(c.hosts || []), c.latestEpTitle || ""]) {
        for (const t of norm(s).split(" ")) if (t.length >= 3) localTokens.add(t);
      }
      const gap = [...risingArr, ...relatedArr]
        .filter((q) => {
          const toks = norm(q).split(" ").filter((t) => t.length >= 3);
          // "not covered" if fewer than half the query tokens appear locally
          const hits = toks.filter((t) => localTokens.has(t)).length;
          return toks.length > 0 && hits / toks.length < 0.5;
        })
        .slice(0, 10);

      const { score, actions } = computePriorityAndActions({
        cadence: c.cadence_per_week,
        gscImpressions: gsc.totalImpressions,
        avgPos: gsc.avgPosition,
        trendsRelated: relatedArr.length,
        trendsRising: risingArr.length,
        gapCount: gap.length,
        hasHostSeedHits: hostSeedHits,
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
        trend_related_queries: relatedArr,
        trend_rising_queries: risingArr,
        gap_queries: gap,
        priority_score: score,
        suggested_actions: actions,
        last_computed_at: new Date().toISOString(),
      };
    });

    if (dryRun) return json({ ok: true, dry_run: true, count: rows.length, rows });

    const { error: upErr } = await SB.from("prefetch_targets").upsert(rows, { onConflict: "podcast_id" });
    if (upErr) throw upErr;

    return json({ ok: true, count: rows.length });
  } catch (e) {
    console.error("[prefetch-targets] error:", e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
