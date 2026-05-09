// Ranked full-backfill deep-hydration runner.
// Processes podcasts by podiverzum_rank desc. Bulk dedupe + bulk upsert via fetch-one.ts.
// MAX_PER_PASS caps episodes per podcast per call so huge feeds resume next run.
// Marks completed + sets full_backfill_completed_at when target reached or feed exhausted.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { fetchOne } from "../_shared/fetch-one.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

function json(b: any, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function targetForTier(tier: string | null, rank: number): number {
  // 48h sprint targets (doubled): S=1000, A=600, B=300, C=100
  if (tier === "S") return 1000;
  if (tier === "A") return 600;
  if (tier === "B") return 300;
  if (tier === "C") return 100;
  // Fallback by numeric rank if tier is missing
  if (rank >= 8.5) return 1000;
  if (rank >= 7.0) return 600;
  if (rank >= 5.5) return 300;
  if (rank >= 4.0) return 100;
  return 0;
}

async function processPool<T, R>(items: T[], concurrency: number, fn: (it: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const __guard = await checkBackgroundJobsAllowed(admin, "deep-hydrate-runner");
    if (__guard.blocked) return new Response(JSON.stringify({ ok: true, skipped: true, reason: __guard.reason }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

    const token = authHeader.slice(7);
    // Accept new sb_secret_... service-role key by direct equality.
    // Fall back to legacy JWT payload check for older keys.
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    let isAdmin = token === SERVICE_KEY;
    if (!isAdmin) {
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
          if (payload.role === "service_role") isAdmin = true;
        }
      } catch { /* not a jwt */ }
    }
    if (!isAdmin) {
      const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
      const userId = userData.user.id;
      isAdmin = userId === TEMP_ADMIN_USER_ID;
      if (!isAdmin) {
        const { data: roleRow } = await admin
          .from("user_roles").select("role")
          .eq("user_id", userId).eq("role", "admin").maybeSingle();
        isAdmin = !!roleRow;
      }
    }
    if (!isAdmin) return json({ error: "Forbidden: admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(100, Number(body.limit) || 10));
    const concurrency = Math.max(1, Math.min(8, Number(body.concurrency) || 1));
    const MAX_PER_PASS = Math.max(20, Math.min(500, Number(body.max_per_pass) || 200));
    const TIME_BUDGET_MS = Math.max(20_000, Math.min(110_000, Number(body.time_budget_ms) || 50_000));
    const trigger = (body.trigger as string) || "manual";
    const LOCK_MS = 3 * 60 * 1000;
    const startedAt = Date.now();

    // Reap stale in_progress podcasts (orphans from previous runs that crashed mid-flight)
    let reaped_stale_in_progress = 0;
    try {
      const { data: r } = await admin.rpc("reap_deep_hydration_stale", { _older_than_minutes: 30 });
      reaped_stale_in_progress = Number(r) || 0;
    } catch { /* noop */ }

    const { data: priorRow } = await admin.from("app_settings").select("value").eq("key", "deep_hydration").maybeSingle();
    const priorVal: any = (priorRow?.value as any) || {};
    const lockUntil = priorVal.lock_until ? new Date(priorVal.lock_until).getTime() : 0;
    if (!body.force && lockUntil > Date.now()) {
      return json({ ok: true, skipped: true, reason: "already_running", lock_until: priorVal.lock_until });
    }
    await admin.from("app_settings").upsert({
      key: "deep_hydration",
      value: { ...priorVal, lock_started_at: new Date().toISOString(), lock_until: new Date(Date.now() + LOCK_MS).toISOString() },
      updated_at: new Date().toISOString(),
    });

    // Rank-priority candidates that are NOT yet fully backfilled.
    // Only S/A/B/C tiers eligible; D/E and unhealthy states excluded.
    const { data: candidates, error: cErr } = await admin
      .from("podcasts")
      .select("id, title, slug, rss_url, image_url, podiverzum_rank, rank_label, shadow_rank_components, rss_status, deep_hydration_status, deep_hydration_target, last_deep_hydrated_at, hydrated_episode_count, full_backfill_completed_at")
      .in("rank_label", ["S", "A", "B", "C"])
      .in("rss_status", ["active", "not_checked"])
      .is("full_backfill_completed_at", null)
      .order("podiverzum_rank", { ascending: false })
      .order("last_deep_hydrated_at", { ascending: true, nullsFirst: true })
      .limit(limit + 10);

    if (cErr) throw cErr;

    // Filter out frozen health states
    const FROZEN = new Set(["rss_url_not_found", "needs_manual_rss_review", "confirmed_dead", "quarantined_spam"]);
    const eligible = (candidates || []).filter((p: any) => {
      const hs = (p.shadow_rank_components as any)?.health_state;
      return !hs || !FROZEN.has(hs);
    }).slice(0, limit);

    const results: any[] = [];
    let processed = 0, completed = 0, failed = 0, newEpisodes = 0, duplicates = 0, throttled = false;

    const work = async (p: any) => {
      if (Date.now() - startedAt > TIME_BUDGET_MS) return;
      const target = p.deep_hydration_target || targetForTier(p.rank_label, Number(p.podiverzum_rank) || 0);

      await admin.from("podcasts").update({
        deep_hydration_status: "in_progress",
        deep_hydration_target: target,
        deep_hydration_error: null,
      }).eq("id", p.id);

      let res: any = null; let err: string | null = null;
      try {
        // Fetch up to MAX_PER_PASS this call. fetch-one.ts already does bulk dedupe + bulk upsert.
        res = await fetchOne(admin, p, { episodeCap: Math.min(MAX_PER_PASS, target || MAX_PER_PASS) });
      } catch (e: any) {
        err = e?.message || String(e);
      }

      processed++;
      const stamp = new Date().toISOString();
      const lower = (err || res?.error || "").toLowerCase();
      if (lower.includes("worker_resource_limit") || lower.includes(" 546") || lower.includes("timeout")) throttled = true;

      if (err || !res?.ok) {
        failed++;
        const reason = err || res?.error || "unknown";
        await admin.from("podcasts").update({
          deep_hydration_status: "failed",
          deep_hydration_error: reason,
          last_deep_hydrated_at: stamp,
        }).eq("id", p.id);
        results.push({ id: p.id, slug: p.slug, title: p.title, rank: p.podiverzum_rank, target, status: "failed", reason });
        return;
      }

      // Skip extra count(*) round-trip; estimate from prior count + new inserts.
      // The exact total is reconciled by incremental-refresh anyway.
      const total = (Number(p.hydrated_episode_count) || 0) + (Number(res.new) || 0);
      newEpisodes += res.new || 0;
      duplicates += res.duplicates || 0;

      const reachedTarget = target > 0 && total >= target;
      const feedExhausted = (res.items ?? 0) < MAX_PER_PASS;
      const isComplete = reachedTarget || feedExhausted;
      const status = isComplete ? "completed" : "in_progress";
      if (isComplete) completed++;

      const update: any = {
        deep_hydration_status: status,
        hydrated_episode_count: total,
        last_deep_hydrated_at: stamp,
        deep_hydration_error: null,
      };
      if (isComplete && !p.full_backfill_completed_at) {
        update.full_backfill_completed_at = stamp;
        update.crawl_state = "incremental_refresh";
      } else if (!isComplete) {
        update.crawl_state = "full_backfill_pending";
      }
      await admin.from("podcasts").update(update).eq("id", p.id);

      results.push({
        id: p.id, slug: p.slug, title: p.title, rank: p.podiverzum_rank, target,
        status, total_episodes: total, new_episodes: res.new, duplicates: res.duplicates, items_in_feed: res.items,
      });
    };

    await processPool(eligible, concurrency, work);

    const { count: remainingPending } = await admin
      .from("podcasts").select("id", { count: "exact", head: true })
      .in("rank_label", ["S", "A", "B", "C"])
      .in("rss_status", ["active", "not_checked"])
      .is("full_backfill_completed_at", null);

    const summary = {
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      trigger, concurrency, max_per_pass: MAX_PER_PASS, limit,
      processed, completed, failed, throttled,
      new_episodes: newEpisodes, duplicates,
      remaining_pending: remainingPending ?? 0,
      reaped_stale_in_progress,
    };
    const { data: prior } = await admin.from("app_settings").select("value").eq("key", "deep_hydration").maybeSingle();
    const prev: any = (prior?.value as any) || {};
    const totals = prev.totals || { processed: 0, completed: 0, failed: 0, new_episodes: 0, duplicates: 0, runs: 0 };
    totals.processed += processed;
    totals.completed += completed;
    totals.failed += failed;
    totals.new_episodes += newEpisodes;
    totals.duplicates += duplicates;
    totals.runs += 1;
    await admin.from("app_settings").upsert({
      key: "deep_hydration",
      value: { ...prev, lock_started_at: null, lock_until: null, last_run: summary, totals },
      updated_at: new Date().toISOString(),
    });

    return json({
      ok: true, ...summary,
      per_podcast_results: results,
    });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
