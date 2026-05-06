// Daily autonomous growth cycle.
// Refreshes feeds, recomputes ranks, runs limited discovery, auto-adds high-rank candidates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fetchOne } from "../_shared/fetch-one.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "podcast";
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

  try {
    // Load settings
    const { data: settingsRow } = await supabase.from("app_settings").select("value").eq("key", "growth").maybeSingle();
    const settings = settingsRow?.value || {};
    if (!force && !settings.autonomous_growth_enabled) {
      const out = { ok: true, skipped: true, reason: "autonomous_growth disabled", stats };
      if (runId) await supabase.from("growth_runs").update({ ok: true, finished_at: new Date().toISOString(), stats: out }).eq("id", runId);
      return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1) Refresh active + failed feeds (time-budgeted)
    const { data: pods } = await supabase.from("podcasts").select("*")
      .not("rss_url", "is", null)
      .in("rss_status", ["active", "not_checked", "failed"])
      .order("last_fetched_at", { ascending: true, nullsFirst: true })
      .limit(40);
    const startTs = Date.now();
    const TIME_BUDGET = 90_000;
    for (const p of pods || []) {
      if (Date.now() - startTs > TIME_BUDGET) break;
      try {
        const r = await fetchOne(supabase, p);
        if (r.ok) { stats.refreshed++; stats.new_episodes += r.new || 0; }
        else stats.refresh_failed++;
      } catch { stats.refresh_failed++; }
    }

    // 2) Discovery (Podcast Index) — STRICT LIMITS, no full-index crawling.
    // Hard caps regardless of settings: 3 categories, 50 candidates, 5 auto-adds per run.
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

    if (apiKey && apiSecret && cats.length) {
      // Rotate: at most HARD_MAX_CATS_PER_RUN categories per run
      const perRun = Math.max(1, Math.min(cats.length, HARD_MAX_CATS_PER_RUN, settings.categories_per_run || HARD_MAX_CATS_PER_RUN));
      const startIdx = Math.max(0, Number(settings.category_rotation_index || 0)) % cats.length;
      const rotated: string[] = [];
      for (let i = 0; i < perRun; i++) rotated.push(cats[(startIdx + i) % cats.length]);
      const nextIdx = (startIdx + perRun) % cats.length;
      stats.categories_processed = rotated;
      stats.api_call_caps = { max_categories: HARD_MAX_CATS_PER_RUN, max_candidates: HARD_MAX_DISCOVERY, max_auto_add: HARD_MAX_AUTO_ADD };

      // Targeted keyword search only — single page per category, no pagination.
      const perCat = Math.max(5, Math.min(25, Math.floor(maxDiscovery / rotated.length)));
      const seen = new Set<string>();
      const candidates: any[] = [];
      for (const cat of rotated) {
        if (candidates.length >= maxDiscovery) break;
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

      // Filter out already-imported feeds
      const urls = candidates.map((c) => c.url);
      const { data: existing } = await supabase.from("podcasts").select("rss_url").in("rss_url", urls);
      const existingSet = new Set((existing || []).map((r: any) => r.rss_url));

      let autoAddedCount = 0;
      for (const c of candidates) {
        if (existingSet.has(c.url)) continue;
        const { score, reasons } = scoreCandidate(c, settings);

        // Auto-add gate: rank>=min, English, fresh, has RSS
        const last = c.newestItemPublishTime ? c.newestItemPublishTime * 1000 : 0;
        const ageDays = last ? (Date.now() - last) / 86400000 : 9999;
        const lang = (c.language || "").toLowerCase();
        const ok = score >= minRank
          && settings.auto_add_enabled
          && lang.startsWith("en")
          && ageDays <= (settings.max_episode_age_days || 90)
          && !!c.url;

        if (ok && autoAddedCount < maxAutoAdd) {
          // Insert podcast
          const slugBase = slugify(c.title || "podcast");
          let slug = slugBase;
          let attempt = 0;
          while (attempt < 5) {
            const { data: dup } = await supabase.from("podcasts").select("id").eq("slug", slug).maybeSingle();
            if (!dup) break;
            attempt++;
            slug = `${slugBase}-${attempt}`;
          }
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
            podiverzum_rank: score,
            rank_label: score >= 8 ? "Excellent" : "Strong",
            rank_reason: { factors: reasons, source: "discovery" },
            rank_updated_at: new Date().toISOString(),
          }).select("id").maybeSingle();
          if (!insErr && inserted) {
            autoAddedCount++;
            stats.auto_added++;
            // Initial fetch
            try { await fetchOne(supabase, { ...c, id: inserted.id, rss_url: c.url, image_url: c.image || c.artwork }); } catch { /* */ }
          }
        } else if (score >= 4 && score < minRank) {
          // Queue for approval
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
      // Persist rotation index for next run
      try {
        await supabase.from("app_settings").update({
          value: { ...settings, category_rotation_index: nextIdx },
          updated_at: new Date().toISOString(),
        }).eq("key", "growth");
      } catch { /* */ }
    } else {
      stats.discovery_skipped = !apiKey || !apiSecret ? "missing_credentials" : "no_categories";
    }

    // 3) Recompute ranks via the existing function (call internally)
    try {
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/recompute-ranks`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({ episodes: true }),
      });
      const j = await r.json().catch(() => ({}));
      stats.ranks_recomputed = j.podcasts || 0;
      stats.episode_ranks_recomputed = j.episodes || 0;
    } catch (e) {
      stats.rank_recompute_error = e instanceof Error ? e.message : "error";
    }

    if (runId) await supabase.from("growth_runs").update({ ok: true, finished_at: new Date().toISOString(), stats }).eq("id", runId);
    return new Response(JSON.stringify({ ok: true, stats }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (runId) await supabase.from("growth_runs").update({ ok: false, finished_at: new Date().toISOString(), stats, error: msg }).eq("id", runId);
    return new Response(JSON.stringify({ error: msg, stats }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
