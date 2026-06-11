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

// Apify "Google Trends Daily Scraper" actor (vnx0/google-trends-scraper).
// Returns daily trending search terms per geo. Override via body.actor if needed.
const DEFAULT_ACTOR = "vnx0~google-trends-scraper";

type TrendItem = {
  keyword: string;
  rank: number;
  traffic?: string | null;
  related?: string[];
};

async function runApifyActor(actor: string): Promise<TrendItem[]> {
  if (!APIFY_TOKEN) throw new Error("APIFY_API_TOKEN missing");

  const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${APIFY_TOKEN}&clean=true`;

  const input = {
    geo: "HU",
    language: "hu-HU",
    timezone: 60,
    daysBack: 1,
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

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

type ResolvedEntity = { kind: "person" | "organization"; id: string; score: number };

async function resolveEntity(
  supabase: ReturnType<typeof createClient>,
  keyword: string,
  episodeIds: string[],
): Promise<ResolvedEntity | null> {
  if (!episodeIds.length) return null;
  const norm = normalizeName(keyword);
  if (norm.length < 3) return null;

  // 1) Candidate people: exact normalized_name OR accepted alias match, public only.
  const candidateIds = new Set<string>();
  try {
    const { data: byName } = await supabase
      .from("people")
      .select("id")
      .eq("normalized_name", norm)
      .eq("is_public", true)
      .limit(20);
    for (const r of byName || []) candidateIds.add(r.id);

    const { data: byAlias } = await supabase
      .from("person_aliases")
      .select("person_id")
      .eq("normalized_alias", norm)
      .eq("status", "accepted")
      .limit(50);
    for (const r of byAlias || []) candidateIds.add(r.person_id);
  } catch (e) {
    console.warn("person candidate lookup failed", keyword, e);
  }

  let bestPerson: { id: string; count: number; latest: string | null } | null = null;
  if (candidateIds.size) {
    const { data: mentions } = await supabase
      .from("person_episode_mentions")
      .select("person_id, episode_id")
      .in("person_id", Array.from(candidateIds))
      .in("episode_id", episodeIds)
      .eq("relevance_status", "accepted");
    const counts = new Map<string, number>();
    for (const m of (mentions || []) as { person_id: string }[]) {
      counts.set(m.person_id, (counts.get(m.person_id) || 0) + 1);
    }
    if (counts.size) {
      // Tie-break by latest_episode_at.
      const ids = Array.from(counts.keys());
      const { data: peopleMeta } = await supabase
        .from("people")
        .select("id, latest_episode_at")
        .in("id", ids);
      const latestMap = new Map<string, string | null>();
      for (const p of (peopleMeta || []) as { id: string; latest_episode_at: string | null }[]) {
        latestMap.set(p.id, p.latest_episode_at);
      }
      for (const [id, count] of counts) {
        const latest = latestMap.get(id) || null;
        if (
          !bestPerson ||
          count > bestPerson.count ||
          (count === bestPerson.count && (latest || "") > (bestPerson.latest || ""))
        ) {
          bestPerson = { id, count, latest };
        }
      }
    }
  }

  if (bestPerson && bestPerson.count >= 2) {
    return { kind: "person", id: bestPerson.id, score: bestPerson.count };
  }

  // 2) Organization fallback: exact normalized_name match + appears in episode_organization_map.
  try {
    const { data: orgs } = await supabase
      .from("organizations")
      .select("id, normalized_name")
      .eq("normalized_name", norm)
      .eq("is_public", true)
      .limit(10);
    const orgIds = (orgs || []).map((o: any) => o.id);
    if (orgIds.length) {
      const { data: orgMap } = await supabase
        .from("episode_organization_map")
        .select("organization_id, episode_id")
        .in("organization_id", orgIds)
        .in("episode_id", episodeIds);
      const counts = new Map<string, number>();
      for (const r of (orgMap || []) as { organization_id: string }[]) {
        counts.set(r.organization_id, (counts.get(r.organization_id) || 0) + 1);
      }
      let bestOrg: { id: string; count: number } | null = null;
      for (const [id, count] of counts) {
        if (!bestOrg || count > bestOrg.count) bestOrg = { id, count };
      }
      if (bestOrg && bestOrg.count >= 2) {
        return { kind: "organization", id: bestOrg.id, score: bestOrg.count };
      }
    }
  } catch (e) {
    console.warn("org resolve failed", keyword, e);
  }

  // Single-mention fallback: only person, only if we have exactly one candidate.
  if (bestPerson && candidateIds.size === 1) {
    return { kind: "person", id: bestPerson.id, score: bestPerson.count };
  }

  return null;
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
    let resolvedPeople = 0;
    let resolvedOrgs = 0;
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

      // Auto-resolve to a Person / Organization entity using the matched episodes.
      const episodeIds = matches.map((m) => m.episode_id);
      const resolved = await resolveEntity(supabase, t.keyword, episodeIds);
      if (resolved) {
        await supabase
          .from("daily_trends")
          .update({
            resolved_kind: resolved.kind,
            resolved_person_id: resolved.kind === "person" ? resolved.id : null,
            resolved_organization_id: resolved.kind === "organization" ? resolved.id : null,
          })
          .eq("id", t.id);
        if (resolved.kind === "person") resolvedPeople++;
        else resolvedOrgs++;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        batchId,
        trends: inserted?.length || 0,
        episodeLinks: matched,
        resolvedPeople,
        resolvedOrgs,
      }),
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
