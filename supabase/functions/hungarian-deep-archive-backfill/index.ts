// HU deep archive backfill orchestrator.
// - HU-strict at SQL level (is_hungarian=true AND language_decision='accept_hungarian').
// - Per-podcast: run RSS exhaustion (fetch-one) if full_backfill_completed_at IS NULL,
//   then PI archive sweep if pi_backfill_completed_at IS NULL.
// - Budget-aware: max podcasts per run, max new episodes per run, per-domain throttle,
//   runtime cap. Respects app_settings.background_jobs incident guard.
// - Dry-run reports what would happen without writing.
//
// POST body (overrides app_settings.hu_deep_archive_controls):
//   { dry_run?: bool, force_refresh?: bool, tier_filter?: string[],
//     max_podcasts_per_run?: number, max_new_episodes_per_run?: number,
//     max_runtime_seconds?: number, per_domain_min_ms?: number }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { fetchOne } from "../_shared/fetch-one.ts";

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

import { slugify as slugifyShared } from "../_shared/slug.ts";
function slugify(s: string) { return slugifyShared(s, "episode"); }

// Pull PI archive episodes and bulk-insert ones we don't have. Mirrors the
// dedupe + upsert logic of pi-episode-backfill but inline so the orchestrator
// can enforce its global new-episode cap mid-flight.
async function runPiPass(
  supabase: any,
  podcast: { id: string; rss_url: string; title: string },
  cap: number,
  dryRun: boolean,
): Promise<{ items: number; new: number; dup: number; error?: string }> {
  let items: any[] = [];
  try {
    items = await piItemsForFeed(podcast.rss_url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "pi_fetch_err";
    return { items: 0, new: 0, dup: 0, error: msg };
  }
  if (items.length === 0) {
    if (!dryRun) {
      await supabase.from("podcasts").update({
        pi_backfill_completed_at: new Date().toISOString(),
        pi_backfill_episode_count: 0, pi_backfill_error: null,
      }).eq("id", podcast.id);
    }
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
    const slice = guids.slice(i, i + 200);
    const { data } = await supabase.from("episodes").select("guid").eq("podcast_id", podcast.id).in("guid", slice);
    (data || []).forEach((r: any) => r.guid && exG.add(r.guid));
  }
  for (let i = 0; i < links.length; i += 200) {
    const slice = links.slice(i, i + 200);
    const { data } = await supabase.from("episodes").select("episode_url").eq("podcast_id", podcast.id).in("episode_url", slice);
    (data || []).forEach((r: any) => r.episode_url && exL.add(r.episode_url));
  }

  let newCount = 0, dupCount = 0;
  const seenSlugs = new Set<string>();
  const rows: any[] = [];
  for (const c of candidates) {
    const dup = (c.guid && exG.has(c.guid)) || (c.link && exL.has(c.link));
    if (dup) { dupCount++; continue; }
    if (seenSlugs.has(c.slug)) continue;
    if (newCount >= cap) break;
    seenSlugs.add(c.slug);
    newCount++;
    rows.push({
      podcast_id: podcast.id, title: c.title, slug: c.slug, description: c.description,
      published_at: c.published, audio_url: c.audio, episode_url: c.link, image_url: c.image, guid: c.guid,
    });
  }

  if (dryRun) return { items: items.length, new: newCount, dup: dupCount };

  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 200) {
      const slice = rows.slice(i, i + 200);
      const { error } = await supabase.from("episodes").upsert(slice, { onConflict: "podcast_id,slug" });
      if (error) {
        await supabase.from("podcasts").update({
          pi_backfill_error: `upsert: ${error.message}`,
        }).eq("id", podcast.id);
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE);

    const guard = await checkBackgroundJobsAllowed(admin, "hungarian-deep-archive-backfill");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));

    const { data: cfgRow } = await admin.from("app_settings").select("value").eq("key", "hu_deep_archive_controls").maybeSingle();
    const cfg: any = (cfgRow?.value as any) || {};
    if (cfg.enabled === false) return json({ ok: true, skipped: true, reason: "controls_disabled" });

    const dryRun = body.dry_run === true || cfg.dry_run === true;
    const forceRefresh = body.force_refresh === true || cfg.force_refresh === true;
    const tierFilter: string[] = Array.isArray(body.tier_filter) ? body.tier_filter
      : Array.isArray(cfg.tier_filter) ? cfg.tier_filter : ["S","A","B"];
    const maxPods = Math.max(1, Math.min(50, Number(body.max_podcasts_per_run ?? cfg.max_podcasts_per_run) || 8));
    const maxNewEps = Math.max(50, Math.min(20000, Number(body.max_new_episodes_per_run ?? cfg.max_new_episodes_per_run) || 1500));
    const runtimeSec = Math.max(20, Math.min(110, Number(body.max_runtime_seconds ?? cfg.max_runtime_seconds) || 110));
    const perDomainMin = Math.max(0, Math.min(10_000, Number(body.per_domain_min_ms ?? cfg.per_domain_min_ms) || 1500));
    const deadline = Date.now() + runtimeSec * 1000;

    // Candidate pool: HU-approved, in tier filter, with pending pass(es).
    let q = admin.from("podcasts")
      .select("id, title, slug, rss_url, rank_label, podiverzum_rank, full_backfill_completed_at, pi_backfill_completed_at, pi_backfill_approved, hydrated_episode_count, pi_backfill_episode_count")
      .eq("is_hungarian", true)
      .eq("language_decision", "accept_hungarian")
      .in("rank_label", tierFilter)
      .eq("rss_status", "active")
      .not("rss_url", "is", null);
    if (!forceRefresh) {
      q = q.or("full_backfill_completed_at.is.null,pi_backfill_completed_at.is.null");
    }
    // Prioritize featured/S/A → B → C. podiverzum_rank desc proxies tier.
    q = q.order("podiverzum_rank", { ascending: false, nullsFirst: false }).limit(maxPods * 3);

    const { data: pool, error: poolErr } = await q;
    if (poolErr) throw poolErr;

    // For B/C we still respect the manual approval flag for the PI sweep
    // (RSS pass is always allowed since it's just the live feed).
    const candidates = (pool || []).slice(0, maxPods);

    const results: any[] = [];
    let totalNewEps = 0, totalDup = 0, processedCount = 0, failed = 0;
    const lastHostHit: Record<string, number> = {};

    for (const p of candidates) {
      if (Date.now() >= deadline) break;
      if (totalNewEps >= maxNewEps) break;

      const host = hostOf(p.rss_url);
      const since = Date.now() - (lastHostHit[host] || 0);
      if (host && since < perDomainMin) {
        await new Promise((r) => setTimeout(r, perDomainMin - since));
      }
      if (host) lastHostHit[host] = Date.now();

      const perPodCap = Math.max(50, Math.min(800, maxNewEps - totalNewEps));
      const podRes: any = { id: p.id, slug: p.slug, title: p.title, tier: p.rank_label, rss: { ran: false }, pi: { ran: false } };

      // 1) RSS exhaustion pass (live feed) — always allowed for HU/tier candidates.
      const rssNeeded = forceRefresh || p.full_backfill_completed_at === null;
      if (rssNeeded) {
        try {
          podRes.rss.ran = true;
          if (dryRun) {
            podRes.rss = { ran: true, dry: true, note: "would call fetchOne up to cap" };
          } else {
            const r = await fetchOne(admin, p, { episodeCap: Math.min(500, perPodCap) });
            podRes.rss = { ran: true, ok: r.ok, items: r.items, new: r.new, dup: r.duplicates, error: r.error || null };
            if (r.ok) {
              totalNewEps += r.new || 0;
              totalDup += r.duplicates || 0;
              const feedExhausted = (r.items ?? 0) < 500 || ((r.new || 0) === 0 && (r.duplicates || 0) > 0);
              if (feedExhausted) {
                await admin.from("podcasts").update({
                  full_backfill_completed_at: new Date().toISOString(),
                  last_deep_hydrated_at: new Date().toISOString(),
                  crawl_state: "incremental_refresh",
                }).eq("id", p.id);
                podRes.rss.marked_complete = true;
              }
            } else {
              failed++;
            }
          }
        } catch (e) {
          failed++;
          podRes.rss = { ran: true, ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }

      if (Date.now() >= deadline || totalNewEps >= maxNewEps) {
        results.push(podRes); processedCount++; continue;
      }

      // 2) PI archive sweep — gated by approval for B/C; S/A always.
      const piEligible = ["S","A"].includes(p.rank_label) || p.pi_backfill_approved === true;
      const piNeeded = piEligible && (forceRefresh || p.pi_backfill_completed_at === null);
      if (piNeeded) {
        const cap = Math.max(0, Math.min(800, maxNewEps - totalNewEps));
        if (cap > 0) {
          podRes.pi.ran = true;
          try {
            const r = await runPiPass(admin, { id: p.id, rss_url: p.rss_url, title: p.title }, cap, dryRun);
            podRes.pi = { ran: true, items: r.items, new: r.new, dup: r.dup, error: r.error || null };
            if (!r.error) {
              totalNewEps += r.new || 0;
              totalDup += r.dup || 0;
            } else {
              failed++;
            }
          } catch (e) {
            failed++;
            podRes.pi = { ran: true, error: e instanceof Error ? e.message : String(e) };
          }
        } else {
          podRes.pi = { ran: false, skipped: "budget_reached" };
        }
      } else if (!piEligible && (p.pi_backfill_completed_at === null)) {
        podRes.pi = { ran: false, skipped: "not_approved" };
      }

      results.push(podRes);
      processedCount++;
    }

    // Remaining work counts (HU-strict).
    const [{ count: rssPending }, { count: piPending }] = await Promise.all([
      admin.from("podcasts").select("id", { count: "exact", head: true })
        .eq("is_hungarian", true).eq("language_decision", "accept_hungarian")
        .in("rank_label", ["S","A","B","C"]).eq("rss_status", "active")
        .is("full_backfill_completed_at", null),
      admin.from("podcasts").select("id", { count: "exact", head: true })
        .eq("is_hungarian", true).eq("language_decision", "accept_hungarian")
        .in("rank_label", ["S","A","B","C"]).eq("rss_status", "active")
        .is("pi_backfill_completed_at", null),
    ]);

    const summary = {
      ok: true,
      dry_run: dryRun,
      force_refresh: forceRefresh,
      tier_filter: tierFilter,
      processed_podcasts: processedCount,
      new_episodes: totalNewEps,
      duplicates: totalDup,
      failed,
      remaining_rss_pending: rssPending ?? 0,
      remaining_pi_pending: piPending ?? 0,
      runtime_ms: Date.now() - (deadline - runtimeSec * 1000),
      per_podcast: results,
      finished_at: new Date().toISOString(),
    };

    // Persist last_run (overwrite, lightweight).
    await admin.from("app_settings").upsert({
      key: "hu_deep_archive_last_run",
      value: summary,
      updated_at: new Date().toISOString(),
    });

    return json(summary);
  } catch (e: any) {
    return json({ ok: false, error: e?.message || "error" }, 500);
  }
});
