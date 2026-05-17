// HU deep archive backfill orchestrator.
// - HU-strict at SQL level (is_hungarian=true AND language_decision='accept_hungarian').
// - Per-podcast: run RSS exhaustion (fetch-one) if full_backfill_completed_at IS NULL,
//   then PI archive sweep if pi_backfill_completed_at IS NULL.
// - Budget-aware: max podcasts per run, max new episodes per run, per-domain throttle,
//   runtime cap. Respects app_settings.background_jobs incident guard.
// - Backlog-aware: skips if AI/embedding enrichment backlog is too high or previous
//   run still active or recent error rate too high.
// - Tier progression: starts S/A only; after N successful scheduled runs auto-expands
//   to include B-tier (controls.expand_to_b_tier_after_successful_runs).
// - Logs each run to hu_archive_backfill_runs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { fetchOne } from "../_shared/fetch-one.ts";
import { slugify as slugifyShared } from "../_shared/slug.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(b: any, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function hostOf(url: string | null | undefined): string {
  try { return url ? new URL(url).host.toLowerCase() : ""; } catch { return ""; }
}
function slugify(s: string) { return slugifyShared(s, "episode"); }

const PI_API = "https://api.podcastindex.org/api/1.0";
async function sha1Hex(s: string) {
  const buf = new TextEncoder().encode(s);
  const h = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function piHeaders() {
  const key = Deno.env.get("PODCAST_INDEX_API_KEY");
  const sec = Deno.env.get("PODCAST_INDEX_API_SECRET");
  if (!key || !sec) return null;
  const date = Math.floor(Date.now() / 1000).toString();
  return {
    "User-Agent": "Podiverzum/1.0 hu-deep-archive",
    "X-Auth-Date": date,
    "X-Auth-Key": key,
    "Authorization": await sha1Hex(key + sec + date),
  };
}
async function piItemsForFeed(rssUrl: string): Promise<any[]> {
  const headers = await piHeaders();
  if (!headers) return [];
  const url = `${PI_API}/episodes/byfeedurl?url=${encodeURIComponent(rssUrl)}&max=1000&fulltext`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`PI http ${res.status}`);
  const j = await res.json();
  return Array.isArray(j?.items) ? j.items : [];
}
function tsToIso(ts?: number | null) {
  if (!ts || typeof ts !== "number") return null;
  try { return new Date(ts * 1000).toISOString(); } catch { return null; }
}

async function runPiPass(
  supabase: any,
  podcast: { id: string; rss_url: string; title: string },
  cap: number,
  dryRun: boolean,
): Promise<{ items: number; new: number; dup: number; error?: string }> {
  let items: any[] = [];
  try { items = await piItemsForFeed(podcast.rss_url); }
  catch (e) { return { items: 0, new: 0, dup: 0, error: e instanceof Error ? e.message : "pi_fetch_err" }; }
  if (items.length === 0) {
    if (!dryRun) await supabase.from("podcasts").update({
      pi_backfill_completed_at: new Date().toISOString(),
      pi_backfill_episode_count: 0, pi_backfill_error: null,
    }).eq("id", podcast.id);
    return { items: 0, new: 0, dup: 0 };
  }
  const candidates = items.filter((it) => it && (it.title || "").trim()).map((it) => {
    const guid = (it.guid || it.id || "").toString().trim() || null;
    const link = (it.link || "").toString().trim() || null;
    const audio = (it.enclosureUrl || "").toString().trim() || null;
    const published = tsToIso(it.datePublished);
    const slugBase = slugify(it.title);
    const slugSuffix = guid
      ? guid.replace(/[^a-z0-9]/gi, "").slice(-8).toLowerCase() || "x"
      : (published ? new Date(published).getTime().toString(36) : Math.random().toString(36).slice(2, 8));
    return {
      guid, link, audio, published,
      title: it.title.toString().slice(0, 500),
      description: (it.description || "").toString().slice(0, 12000),
      image: it.image || it.feedImage || null,
      slug: `${slugBase}-${slugSuffix}`,
    };
  });
  const guids = Array.from(new Set(candidates.map((c) => c.guid).filter(Boolean) as string[]));
  const links = Array.from(new Set(candidates.map((c) => c.link).filter(Boolean) as string[]));
  const exG = new Set<string>(), exL = new Set<string>();
  for (let i = 0; i < guids.length; i += 200) {
    const { data } = await supabase.from("episodes").select("guid").eq("podcast_id", podcast.id).in("guid", guids.slice(i, i + 200));
    (data || []).forEach((r: any) => r.guid && exG.add(r.guid));
  }
  for (let i = 0; i < links.length; i += 200) {
    const { data } = await supabase.from("episodes").select("episode_url").eq("podcast_id", podcast.id).in("episode_url", links.slice(i, i + 200));
    (data || []).forEach((r: any) => r.episode_url && exL.add(r.episode_url));
  }
  let newCount = 0, dupCount = 0;
  const seenSlugs = new Set<string>(); const rows: any[] = [];
  for (const c of candidates) {
    const dup = (c.guid && exG.has(c.guid)) || (c.link && exL.has(c.link));
    if (dup) { dupCount++; continue; }
    if (seenSlugs.has(c.slug)) continue;
    if (newCount >= cap) break;
    seenSlugs.add(c.slug); newCount++;
    rows.push({
      podcast_id: podcast.id, title: c.title, slug: c.slug, description: c.description,
      published_at: c.published, audio_url: c.audio, episode_url: c.link, image_url: c.image, guid: c.guid,
    });
  }
  if (dryRun) return { items: items.length, new: newCount, dup: dupCount };
  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabase.from("episodes").upsert(rows.slice(i, i + 200), { onConflict: "podcast_id,slug" });
      if (error) {
        await supabase.from("podcasts").update({ pi_backfill_error: `upsert: ${error.message}` }).eq("id", podcast.id);
        return { items: items.length, new: i, dup: dupCount, error: error.message };
      }
    }
  }
  await supabase.from("podcasts").update({
    pi_backfill_completed_at: new Date().toISOString(),
    pi_backfill_episode_count: items.length, pi_backfill_error: null,
  }).eq("id", podcast.id);
  return { items: items.length, new: newCount, dup: dupCount };
}

async function aiBacklogCount(admin: any): Promise<number> {
  const { count } = await admin.from("ai_enrichment_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");
  return count ?? 0;
}
async function embeddingBacklogCount(admin: any): Promise<number> {
  // Approximate by (episodes total) - (episode_embeddings total). Non-negative.
  const [{ count: eps }, { count: emb }] = await Promise.all([
    admin.from("episodes").select("id", { count: "exact", head: true }),
    admin.from("episode_embeddings").select("episode_id", { count: "exact", head: true }),
  ]);
  return Math.max(0, (eps ?? 0) - (emb ?? 0));
}

async function logRun(admin: any, row: any): Promise<string | null> {
  const { data, error } = await admin.from("hu_archive_backfill_runs").insert(row).select("id").maybeSingle();
  if (error) return null;
  return (data as any)?.id || null;
}
async function updateRun(admin: any, id: string, patch: any) {
  if (!id) return;
  await admin.from("hu_archive_backfill_runs").update(patch).eq("id", id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE);

    const body = await req.json().catch(() => ({}));
    const triggerSource: string = body.trigger_source === "cron" ? "cron"
      : body.dry_run === true ? "dry_run" : "manual";
    const isCron = triggerSource === "cron";

    // Skipped helper: write a skipped row and return.
    const skipped = async (reason: string, extra: any = {}) => {
      await admin.from("hu_archive_backfill_runs").insert({
        started_at: startedAt, finished_at: new Date().toISOString(),
        status: "skipped", trigger_source: triggerSource,
        tier_filter: [], skipped_reason: reason,
        runtime_ms: Date.now() - t0, details: extra,
      });
      return json({ ok: true, skipped: true, reason, ...extra });
    };

    // Guard 1: incident / global background switch.
    const guard = await checkBackgroundJobsAllowed(admin, "hungarian-deep-archive-backfill");
    if (guard.blocked) return await skipped("skipped_incident_mode", { detail: guard.reason });

    // Load controls.
    const { data: cfgRow } = await admin.from("app_settings").select("value").eq("key", "hu_deep_archive_controls").maybeSingle();
    const cfg: any = (cfgRow?.value as any) || {};

    // Guard 2: enabled flags.
    if (cfg.enabled === false) return await skipped("skipped_disabled", { detail: "controls.enabled=false" });
    if (isCron && cfg.cron_enabled === false) return await skipped("skipped_disabled", { detail: "controls.cron_enabled=false" });

    // Guard 3: previous run still active (>10min ago counts as orphaned).
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    const { data: activeRuns } = await admin.from("hu_archive_backfill_runs")
      .select("id, started_at").eq("status", "running").gte("started_at", tenMinAgo).limit(1);
    if (activeRuns && activeRuns.length > 0) {
      return await skipped("skipped_previous_run_active", { active_run_id: activeRuns[0].id });
    }

    // Guard 4: recent error rate (last 10 cron runs).
    const errThreshold = Number(cfg.pause_if_error_rate_above ?? 0.20);
    const { data: recent } = await admin.from("hu_archive_backfill_runs")
      .select("status").eq("trigger_source", "cron").order("started_at", { ascending: false }).limit(10);
    if (recent && recent.length >= 5) {
      const fails = recent.filter((r: any) => r.status === "failed").length;
      const rate = fails / recent.length;
      if (rate > errThreshold) {
        return await skipped("skipped_error_rate_high", { error_rate: rate, threshold: errThreshold });
      }
    }

    // Guard 5: downstream backlog.
    const aiBefore = await aiBacklogCount(admin);
    const embBefore = await embeddingBacklogCount(admin);
    const aiCap = Number(cfg.pause_if_enrichment_backlog_above ?? 50000);
    const embCap = Number(cfg.pause_if_embedding_backlog_above ?? 50000);
    if (aiBefore > aiCap || embBefore > embCap) {
      return await skipped("skipped_backlog_high", {
        ai_backlog: aiBefore, ai_cap: aiCap,
        embedding_backlog: embBefore, embedding_cap: embCap,
      });
    }

    // Tier progression: cron-driven runs start S/A; auto-expand to B after N successes.
    const cfgTier: string[] = Array.isArray(cfg.tier_filter) ? cfg.tier_filter : ["S","A"];
    const expandAfter = Number(cfg.expand_to_b_tier_after_successful_runs ?? 3);
    const successCount = Number(cfg.successful_scheduled_run_count ?? 0);
    let tierFilter: string[] = Array.isArray(body.tier_filter) ? body.tier_filter : cfgTier;
    if (isCron) {
      tierFilter = successCount >= expandAfter ? Array.from(new Set([...cfgTier, "B"])) : cfgTier.filter((t) => t !== "B");
    }
    // Hard safety: never C/D/E automatically.
    if (isCron) tierFilter = tierFilter.filter((t) => ["S","A","B"].includes(t));

    const dryRun = body.dry_run === true;
    const forceRefresh = body.force_refresh === true || cfg.force_refresh === true;
    const maxPods = Math.max(1, Math.min(50, Number(body.max_podcasts_per_run ?? body.max_podcasts ?? cfg.max_podcasts_per_run) || 8));
    const maxNewEps = Math.max(50, Math.min(20000, Number(body.max_new_episodes_per_run ?? body.max_new_episodes ?? cfg.max_new_episodes_per_run) || 1500));
    const runtimeSec = Math.max(20, Math.min(110, Number(body.max_runtime_seconds ?? cfg.max_runtime_seconds) || 110));
    const perDomainMin = Math.max(0, Math.min(10_000, Number(body.per_domain_min_ms ?? body.per_domain_throttle_ms ?? cfg.per_domain_min_ms ?? cfg.per_domain_throttle_ms) || 1500));
    const deadline = Date.now() + runtimeSec * 1000;

    // Insert running row.
    const runId = await logRun(admin, {
      started_at: startedAt, status: "running", trigger_source: triggerSource,
      tier_filter: tierFilter, ai_backlog_before: aiBefore, embedding_backlog_before: embBefore,
    });

    // Candidate pool.
    let q = admin.from("podcasts")
      .select("id, title, slug, rss_url, rank_label, podiverzum_rank, full_backfill_completed_at, pi_backfill_completed_at, pi_backfill_approved")
      .eq("is_hungarian", true).eq("language_decision", "accept_hungarian")
      .in("rank_label", tierFilter).eq("rss_status", "active").not("rss_url", "is", null);
    if (!forceRefresh) q = q.or("full_backfill_completed_at.is.null,pi_backfill_completed_at.is.null");
    q = q.order("podiverzum_rank", { ascending: false, nullsFirst: false }).limit(maxPods * 3);
    const { data: pool, error: poolErr } = await q;
    if (poolErr) throw poolErr;

    const candidates = (pool || []).slice(0, maxPods);
    const results: any[] = [];
    let totalNewEps = 0, totalDup = 0, processedCount = 0, failed = 0, throttled = false;
    const lastHostHit: Record<string, number> = {};

    for (const p of candidates) {
      if (Date.now() >= deadline) break;
      if (totalNewEps >= maxNewEps) break;
      const host = hostOf(p.rss_url);
      const since = Date.now() - (lastHostHit[host] || 0);
      if (host && since < perDomainMin) { throttled = true; await new Promise((r) => setTimeout(r, perDomainMin - since)); }
      if (host) lastHostHit[host] = Date.now();

      const perPodCap = Math.max(50, Math.min(800, maxNewEps - totalNewEps));
      const podRes: any = { id: p.id, slug: p.slug, title: p.title, tier: p.rank_label, rss: { ran: false }, pi: { ran: false } };
      const rssNeeded = forceRefresh || p.full_backfill_completed_at === null;
      if (rssNeeded) {
        try {
          podRes.rss.ran = true;
          if (dryRun) podRes.rss = { ran: true, dry: true, note: "would call fetchOne up to cap" };
          else {
            const r = await fetchOne(admin, p, { episodeCap: Math.min(500, perPodCap) });
            podRes.rss = { ran: true, ok: r.ok, items: r.items, new: r.new, dup: r.duplicates, error: r.error || null };
            if (r.ok) {
              totalNewEps += r.new || 0; totalDup += r.duplicates || 0;
              const feedExhausted = (r.items ?? 0) < 500 || ((r.new || 0) === 0 && (r.duplicates || 0) > 0);
              if (feedExhausted) {
                await admin.from("podcasts").update({
                  full_backfill_completed_at: new Date().toISOString(),
                  last_deep_hydrated_at: new Date().toISOString(),
                  crawl_state: "incremental_refresh",
                }).eq("id", p.id);
                podRes.rss.marked_complete = true;
              }
            } else failed++;
          }
        } catch (e) { failed++; podRes.rss = { ran: true, ok: false, error: e instanceof Error ? e.message : String(e) }; }
      }
      if (Date.now() >= deadline || totalNewEps >= maxNewEps) { results.push(podRes); processedCount++; continue; }

      const piEligible = ["S","A"].includes(p.rank_label) || p.pi_backfill_approved === true;
      const piNeeded = piEligible && (forceRefresh || p.pi_backfill_completed_at === null);
      if (piNeeded) {
        const cap = Math.max(0, Math.min(800, maxNewEps - totalNewEps));
        if (cap > 0) {
          podRes.pi.ran = true;
          try {
            const r = await runPiPass(admin, { id: p.id, rss_url: p.rss_url, title: p.title }, cap, dryRun);
            podRes.pi = { ran: true, items: r.items, new: r.new, dup: r.dup, error: r.error || null };
            if (!r.error) { totalNewEps += r.new || 0; totalDup += r.dup || 0; } else failed++;
          } catch (e) { failed++; podRes.pi = { ran: true, error: e instanceof Error ? e.message : String(e) }; }
        } else podRes.pi = { ran: false, skipped: "budget_reached" };
      } else if (!piEligible && (p.pi_backfill_completed_at === null)) {
        podRes.pi = { ran: false, skipped: "not_approved" };
      }
      results.push(podRes); processedCount++;
    }

    const [{ count: rssPending }, { count: piPending }] = await Promise.all([
      admin.from("podcasts").select("id", { count: "exact", head: true })
        .eq("is_hungarian", true).eq("language_decision", "accept_hungarian")
        .in("rank_label", ["S","A","B","C"]).eq("rss_status", "active").is("full_backfill_completed_at", null),
      admin.from("podcasts").select("id", { count: "exact", head: true })
        .eq("is_hungarian", true).eq("language_decision", "accept_hungarian")
        .in("rank_label", ["S","A","B","C"]).eq("rss_status", "active").is("pi_backfill_completed_at", null),
    ]);

    const aiAfter = await aiBacklogCount(admin);
    const embAfter = await embeddingBacklogCount(admin);

    const summary = {
      ok: true, dry_run: dryRun, force_refresh: forceRefresh, tier_filter: tierFilter,
      processed_podcasts: processedCount, new_episodes: totalNewEps, duplicates: totalDup, failed,
      remaining_rss_pending: rssPending ?? 0, remaining_pi_pending: piPending ?? 0,
      runtime_ms: Date.now() - t0, per_podcast: results,
      ai_backlog_before: aiBefore, ai_backlog_after: aiAfter,
      embedding_backlog_before: embBefore, embedding_backlog_after: embAfter,
      trigger_source: triggerSource, run_id: runId,
      started_at: startedAt, finished_at: new Date().toISOString(),
    };

    await admin.from("app_settings").upsert({
      key: "hu_deep_archive_last_run", value: summary, updated_at: new Date().toISOString(),
    });
    await updateRun(admin, runId!, {
      finished_at: new Date().toISOString(),
      status: failed > processedCount / 2 && processedCount > 0 ? "failed" : "completed",
      podcasts_processed: processedCount, new_episodes_inserted: totalNewEps,
      duplicates_skipped: totalDup, failed_feeds: failed, throttled,
      runtime_ms: Date.now() - t0,
      ai_backlog_after: aiAfter, embedding_backlog_after: embAfter,
      details: { per_podcast: results, tier_filter: tierFilter },
    });

    // Bump successful scheduled run counter (only for cron-triggered non-dry runs that completed).
    if (isCron && !dryRun && processedCount > 0 && failed <= processedCount / 2) {
      const newCount = successCount + 1;
      await admin.from("app_settings").upsert({
        key: "hu_deep_archive_controls",
        value: { ...cfg, successful_scheduled_run_count: newCount },
        updated_at: new Date().toISOString(),
      });
    }

    return json(summary);
  } catch (e: any) {
    try {
      const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
      await admin.from("hu_archive_backfill_runs").insert({
        started_at: startedAt, finished_at: new Date().toISOString(),
        status: "failed", trigger_source: "unknown", tier_filter: [],
        error_message: e?.message || "error", runtime_ms: Date.now() - t0,
      });
    } catch {}
    return json({ ok: false, error: e?.message || "error" }, 500);
  }
});
