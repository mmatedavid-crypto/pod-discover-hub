// Daily autonomous growth cycle.
// Refreshes feeds, recomputes ranks, runs limited discovery, auto-adds high-rank candidates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fetchOne } from "../_shared/fetch-one.ts";
import { slugify as slugifyShared } from "../_shared/slug.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function slugify(s: string) {
  return slugifyShared(s, "podcast");
}

async function sha1Hex(input: string) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function scoreCandidate(p: any, settings: any) {
  const reasons: { delta: number; note: string }[] = [];
  let s = 1;
  reasons.push({ delta: 1, note: "base" });
  if (p.url) { s += 2; reasons.push({ delta: 2, note: "has RSS" }); }
  if (p.image || p.artwork) { s += 1; reasons.push({ delta: 1, note: "has image" }); }
  if (p.description) { s += 1; reasons.push({ delta: 1, note: "has description" }); }
  const last = p.newestItemPublishTime ? p.newestItemPublishTime * 1000 : 0;
  const ageDays = last ? (Date.now() - last) / 86400000 : 9999;
  if (ageDays <= 14) { s += 2; reasons.push({ delta: 2, note: "fresh ≤14d" }); }
  else if (ageDays <= settings.max_episode_age_days) { s += 1; reasons.push({ delta: 1, note: `≤${settings.max_episode_age_days}d` }); }
  else { s -= 3; reasons.push({ delta: -3, note: `stale >${settings.max_episode_age_days}d` }); }
  if ((p.episodeCount || 0) >= 100) { s += 2; reasons.push({ delta: 2, note: "100+ episodes" }); }
  else if ((p.episodeCount || 0) >= 30) { s += 1; reasons.push({ delta: 1, note: "30+ episodes" }); }
  const lang = (p.language || "").toLowerCase();
  if (lang.startsWith("en")) { s += 1; reasons.push({ delta: 1, note: "English" }); }
  else { s -= 4; reasons.push({ delta: -4, note: "non-English" }); }
  if (p.dead === 1) { s -= 5; reasons.push({ delta: -5, note: "dead" }); }
  if (p.lastHttpStatus === 404) { s -= 5; reasons.push({ delta: -5, note: "HTTP 404" }); }
  const final = Math.max(1, Math.min(10, Math.round(s)));
  return { score: final, reasons };
}

function initialPublicRank(candidateRank: number) {
  // Discovery score is import priority only; it must never create A/S public quality.
  const n = Number(candidateRank);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(3.5, n));
}

function initialRankLabel(score: number) {
  if (score >= 4) return "C";
  if (score >= 2.5) return "D";
  return "E";
}

async function piSearch(term: string, apiKey: string, apiSecret: string, max: number, errorsOut: any[]) {
  const date = Math.floor(Date.now() / 1000).toString();
  const auth = await sha1Hex(apiKey + apiSecret + date);
  // Hard cap per call: never request more than 25 from PI per keyword
  const safeMax = Math.max(1, Math.min(25, max));
  const params = new URLSearchParams({ q: term, max: String(safeMax), val: "en" });
  try {
    const res = await fetch(`https://api.podcastindex.org/api/1.0/search/byterm?${params}`, {
      headers: {
        "User-Agent": "Podiverzum/1.0",
        "X-Auth-Date": date,
        "X-Auth-Key": apiKey,
        "Authorization": auth,
      },
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const entry = { term, status: res.status, body: txt.slice(0, 200), rate_limited: res.status === 429 };
      console.error("[daily-growth-run] PodcastIndex error", entry);
      errorsOut.push(entry);
      return [];
    }
    const data = await res.json();
    return Array.isArray(data.feeds) ? data.feeds : [];
  } catch (e) {
    const entry = { term, error: e instanceof Error ? e.message : "fetch_error" };
    console.error("[daily-growth-run] PodcastIndex fetch failed", entry);
    errorsOut.push(entry);
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const startedAt = new Date().toISOString();
  const stats: any = {
    refreshed: 0, refresh_failed: 0, new_episodes: 0,
    candidates_seen: 0, candidates_queued: 0, auto_added: 0, skipped_low_rank: 0,
    ranks_recomputed: 0,
  };

  let body: any = {};
  try { body = req.method === "POST" ? await req.json() : {}; } catch { /* */ }
  const trigger = body.trigger || "manual";
  const force = body.force === true; // ignore autonomous flag

  // Mark stuck runs (no finished_at after 10 minutes) as timed_out before checking concurrency
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  try {
    const { data: stuck } = await supabase.from("growth_runs")
      .select("id, stats")
      .is("finished_at", null)
      .lt("started_at", tenMinAgo);
    for (const s of stuck || []) {
      await supabase.from("growth_runs").update({
        ok: false,
        finished_at: new Date().toISOString(),
        error: "Growth run timed out",
        trigger: "timed_out",
        stats: { ...(s.stats || {}), timed_out: true },
      }).eq("id", s.id);
    }
  } catch { /* */ }

  // Concurrency guard: refuse if another run is in-flight (started <10min ago, no finished_at)
  const { data: inflight } = await supabase.from("growth_runs")
    .select("id, started_at")
    .is("finished_at", null)
    .gte("started_at", tenMinAgo)
    .limit(1);
  if (inflight && inflight.length > 0) {
    return new Response(JSON.stringify({
      ok: false, skipped: true, reason: "already_running",
      in_flight_run_id: inflight[0].id, started_at: inflight[0].started_at,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // Insert run row
  const { data: runRow } = await supabase.from("growth_runs").insert({ started_at: startedAt, trigger, stats: {} }).select("id").single();
  const runId = runRow?.id;

  // Total wall-clock budget for this invocation. Edge runtime cap ~150s; we stop early.
  const RUN_BUDGET_MS = 110_000;
  const runStartedMs = Date.now();
  const remaining = () => RUN_BUDGET_MS - (Date.now() - runStartedMs);

  // Run status — written by the finally block so we never orphan a row.
  let runStatus: "completed" | "partial" | "failed" | "timed_out_prevented" | "skipped" = "completed";
  let runError: string | null = null;
  let runOk = true;
  let responsePayload: any = null;
  let responseStatus = 200;

  try {
    // Load settings
    const { data: settingsRow } = await supabase.from("app_settings").select("value").eq("key", "growth").maybeSingle();
    const settings = settingsRow?.value || {};
    if (!force && !settings.autonomous_growth_enabled) {
      runStatus = "skipped";
      stats.reason = "autonomous_growth disabled";
      responsePayload = { ok: true, skipped: true, reason: "autonomous_growth disabled", stats };
      return new Response(JSON.stringify(responsePayload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1) Refresh active + failed feeds (time-budgeted)
    const REFRESH_BUDGET_MS = 60_000;
    if (remaining() > 20_000) {
      const { data: pods } = await supabase.from("podcasts").select("*")
        .not("rss_url", "is", null)
        .in("rss_status", ["active", "not_checked", "failed"])
        .order("last_fetched_at", { ascending: true, nullsFirst: true })
        .limit(40);
      const startTs = Date.now();
      const stageBudget = Math.min(REFRESH_BUDGET_MS, remaining() - 15_000);
      for (const p of pods || []) {
        if (Date.now() - startTs > stageBudget) { stats.refresh_truncated = true; break; }
        try {
          const r = await fetchOne(supabase, p);
          if (r.ok) { stats.refreshed++; stats.new_episodes += r.new || 0; }
          else stats.refresh_failed++;
        } catch { stats.refresh_failed++; }
      }
    } else {
      stats.refresh_skipped = "low_time_budget";
    }

    // 2) Discovery (Podcast Index) — STRICT LIMITS, no full-index crawling.
    const apiKey = Deno.env.get("PODCAST_INDEX_API_KEY");
    const apiSecret = Deno.env.get("PODCAST_INDEX_API_SECRET");
    const cats: string[] = settings.discovery_categories || [];
    const HARD_MAX_CATS_PER_RUN = 3;
    const HARD_MAX_DISCOVERY = 50;
    const HARD_MAX_AUTO_ADD = 5;
    const maxDiscovery = Math.min(HARD_MAX_DISCOVERY, settings.max_discovery_per_run || HARD_MAX_DISCOVERY);
    const maxAutoAdd = Math.min(HARD_MAX_AUTO_ADD, settings.max_auto_add_per_run || HARD_MAX_AUTO_ADD);
    const minRank = settings.min_rank_for_auto_add || 8;
    const piErrors: any[] = [];

    if (remaining() < 15_000) {
      stats.discovery_skipped = "low_time_budget";
      runStatus = "partial";
    } else if (apiKey && apiSecret && cats.length) {
      const perRun = Math.max(1, Math.min(cats.length, HARD_MAX_CATS_PER_RUN, settings.categories_per_run || HARD_MAX_CATS_PER_RUN));
      const startIdx = Math.max(0, Number(settings.category_rotation_index || 0)) % cats.length;
      const rotated: string[] = [];
      for (let i = 0; i < perRun; i++) rotated.push(cats[(startIdx + i) % cats.length]);
      const nextIdx = (startIdx + perRun) % cats.length;
      stats.categories_processed = rotated;
      stats.api_call_caps = { max_categories: HARD_MAX_CATS_PER_RUN, max_candidates: HARD_MAX_DISCOVERY, max_auto_add: HARD_MAX_AUTO_ADD };

      const perCat = Math.max(5, Math.min(25, Math.floor(maxDiscovery / rotated.length)));
      const seen = new Set<string>();
      const candidates: any[] = [];
      for (const cat of rotated) {
        if (candidates.length >= maxDiscovery) break;
        if (remaining() < 10_000) { stats.discovery_truncated = true; break; }
        const feeds = await piSearch(cat, apiKey, apiSecret, perCat, piErrors);
        for (const f of feeds) {
          if (!f.url || seen.has(f.url)) continue;
          seen.add(f.url);
          candidates.push({ ...f, _cat: cat });
          if (candidates.length >= maxDiscovery) break;
        }
      }
      stats.candidates_seen = candidates.length;
      if (piErrors.length) {
        stats.podcast_index_errors = piErrors;
        stats.podcast_index_rate_limited = piErrors.some((e) => e.rate_limited);
      }

      const urls = candidates.map((c) => c.url);
      const { data: existing } = await supabase.from("podcasts").select("rss_url").in("rss_url", urls);
      const existingSet = new Set((existing || []).map((r: any) => r.rss_url));

      let autoAddedCount = 0;
      for (const c of candidates) {
        if (remaining() < 8_000) { stats.auto_add_truncated = true; break; }
        if (existingSet.has(c.url)) continue;
        const { score, reasons } = scoreCandidate(c, settings);

        const last = c.newestItemPublishTime ? c.newestItemPublishTime * 1000 : 0;
        const ageDays = last ? (Date.now() - last) / 86400000 : 9999;
        const lang = (c.language || "").toLowerCase();
        const ok = score >= minRank
          && settings.auto_add_enabled
          && lang.startsWith("en")
          && ageDays <= (settings.max_episode_age_days || 90)
          && !!c.url;

        if (ok && autoAddedCount < maxAutoAdd) {
          const slugBase = slugify(c.title || "podcast");
          let slug = slugBase;
          let attempt = 0;
          while (attempt < 5) {
            const { data: dup } = await supabase.from("podcasts").select("id").eq("slug", slug).maybeSingle();
            if (!dup) break;
            attempt++;
            slug = `${slugBase}-${attempt}`;
          }
          const publicRank = initialPublicRank(score);
          const { data: inserted, error: insErr } = await supabase.from("podcasts").insert({
            title: c.title,
            slug,
            description: c.description,
            rss_url: c.url,
            website_url: c.link,
            image_url: c.image || c.artwork,
            language: c.language || "en",
            category: c._cat,
            source: "discovery_auto",
            rss_status: "not_checked",
            podiverzum_rank: publicRank,
            rank_label: initialRankLabel(publicRank),
            rank_reason: {
              formula: "import_public_rank_v1",
              source: "discovery_auto",
              candidate_rank: score,
              candidate_rank_reason: { factors: reasons, source: "discovery_seed" },
              note: "Discovery score is import priority only; HU_v1/editorial quality must promote this podcast.",
            },
            rank_updated_at: new Date().toISOString(),
          }).select("id").maybeSingle();
          if (!insErr && inserted) {
            autoAddedCount++;
            stats.auto_added++;
            try { await fetchOne(supabase, { ...c, id: inserted.id, rss_url: c.url, image_url: c.image || c.artwork }); } catch { /* */ }
          }
        } else if (score >= 4 && score < minRank) {
          await supabase.from("discovery_queue").upsert({
            pi_id: c.id,
            title: c.title,
            rss_url: c.url,
            website_url: c.link,
            image_url: c.image || c.artwork,
            description: c.description,
            language: c.language,
            author: c.author || c.ownerName,
            episode_count: c.episodeCount,
            last_episode_at: c.newestItemPublishTime ? new Date(c.newestItemPublishTime * 1000).toISOString() : null,
            candidate_rank: score,
            rank_reason: { factors: reasons },
            status: "pending",
            source: "discovery",
            category: c._cat,
            updated_at: new Date().toISOString(),
          }, { onConflict: "rss_url" });
          stats.candidates_queued++;
        } else {
          stats.skipped_low_rank++;
        }
      }
      try {
        await supabase.from("app_settings").update({
          value: { ...settings, category_rotation_index: nextIdx },
          updated_at: new Date().toISOString(),
        }).eq("key", "growth");
      } catch { /* */ }
    } else {
      stats.discovery_skipped = !apiKey || !apiSecret ? "missing_credentials" : "no_categories";
    }

    // 3) Rank recompute is INTENTIONALLY DISABLED here.
    // The legacy recompute-ranks function uses an integer 1-10 scorer with
    // labels Elite/Excellent/Strong/... and would overwrite the live
    // Formula C v3 (S/A/B/C) ranking. Live ranking is maintained by the
    // dedicated pipeline. Do not re-add a recompute-ranks call here.
    stats.rank_recompute = "skipped_legacy_scorer_incompatible_with_formula_c_v3";

    if (stats.refresh_truncated || stats.discovery_truncated || stats.auto_add_truncated || stats.discovery_skipped === "low_time_budget" || stats.refresh_skipped === "low_time_budget") {
      runStatus = "partial";
    }

    if (remaining() < 5_000) {
      runStatus = "timed_out_prevented";
    }

    responsePayload = { ok: true, status: runStatus, stats, elapsed_ms: Date.now() - runStartedMs };
    return new Response(JSON.stringify(responsePayload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    runOk = false;
    runStatus = "failed";
    runError = e instanceof Error ? e.message : "error";
    responsePayload = { error: runError, stats, status: runStatus };
    responseStatus = 500;
    return new Response(JSON.stringify(responsePayload), { status: responseStatus, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } finally {
    // ALWAYS write finished_at — prevents orphan rows being reaped as timed_out.
    if (runId) {
      try {
        await supabase.from("growth_runs").update({
          ok: runOk && runStatus !== "failed",
          finished_at: new Date().toISOString(),
          stats: { ...stats, status: runStatus, elapsed_ms: Date.now() - runStartedMs },
          error: runError,
        }).eq("id", runId);
      } catch { /* swallow — response already sent */ }
    }
  }
});
