// Incremental refresh for already fully-backfilled podcasts.
// Picks podcasts where full_backfill_completed_at IS NOT NULL, oldest last_fetched_at first.
// Uses fetch-one.ts (bulk dedupe + bulk upsert). episodeCap small — only newest items matter.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fetchOne } from "../_shared/fetch-one.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

function json(b: any, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function processPool<T>(items: T[], concurrency: number, fn: (it: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) return;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
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
    const token = authHeader.slice(7);
    let isAdmin = false;
    try {
      const parts = token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (payload.role === "service_role") isAdmin = true;
      }
    } catch { /* not a jwt */ }
    if (!isAdmin) {
      const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
      const { data: userData, error: userErr } = await userClient.auth.getUser();
      if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
      const userId = userData.user.id;
      isAdmin = userId === TEMP_ADMIN_USER_ID;
      if (!isAdmin) {
        const { data: roleRow } = await admin
          .from("user_roles").select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
        isAdmin = !!roleRow;
      }
    }
    if (!isAdmin) return json({ error: "Forbidden: admin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const requestedLimit = Number(body.limit ?? body.batch);
    const limit = Math.max(1, Math.min(3, Number.isFinite(requestedLimit) ? requestedLimit : 3));
    const concurrency = 1;
    const useTier = body.use_rank_tier !== false; // default: tier-based
    const stale_hours = Math.max(0, Math.min(168, Number(body.stale_hours ?? 6)));
    const episodeCap = Math.max(3, Math.min(10, Number(body.episode_cap) || 5));
    const TIME_BUDGET_MS = Math.max(20_000, Math.min(30_000, Number(body.time_budget_ms) || 25_000));
    const PER_FEED_BUDGET_MS = Math.max(8_000, Math.min(12_000, Number(body.per_feed_timeout_ms) || 10_000));
    const trigger = (body.trigger as string) || "manual";
    const startedAt = Date.now();

    const nowIso = new Date().toISOString();
    const dueOrNull = `next_fetch_at.is.null,next_fetch_at.lte.${nowIso}`;
    let cq = admin
      .from("podcasts")
      .select("id, title, slug, rss_url, image_url, podiverzum_rank, last_fetched_at, full_backfill_completed_at, crawl_state, refresh_interval_minutes, last_etag, last_modified, consecutive_failure_count, next_fetch_at")
      .in("crawl_state", ["full_backfilled", "incremental_refresh"])
      .or("quarantined_until.is.null,quarantined_until.lt." + nowIso)
      .or(dueOrNull)
      .order("last_fetched_at", { ascending: true, nullsFirst: true })
      .limit(limit);

    if (useTier) {
      // Tier-based: pick rows where last_fetched_at < now() - refresh_interval_minutes.
      // Also gate by next_fetch_at backoff (failed feeds).
      cq = admin
        .from("podcasts")
        .select("id, title, slug, rss_url, image_url, podiverzum_rank, last_fetched_at, full_backfill_completed_at, crawl_state, refresh_interval_minutes, last_etag, last_modified, consecutive_failure_count, next_fetch_at")
        .in("crawl_state", ["full_backfilled", "incremental_refresh"])
        .or("quarantined_until.is.null,quarantined_until.lt." + nowIso)
        .or(dueOrNull)
        .order("last_fetched_at", { ascending: true, nullsFirst: true })
        .limit(limit);
    } else {
      const cutoff = new Date(Date.now() - stale_hours * 3600_000).toISOString();
      cq = cq.or(`last_fetched_at.is.null,last_fetched_at.lt.${cutoff}`);
    }

    const { data: prelim, error: cErr } = await cq;
    if (cErr) throw cErr;

    let candidates = prelim || [];
    if (useTier) {
      const now = Date.now();
      candidates = candidates.filter((p: any) => {
        // Respect failure backoff
        if (p.next_fetch_at && new Date(p.next_fetch_at).getTime() > now) return false;
        if (!p.last_fetched_at) return true;
        const interval = (p.refresh_interval_minutes || 360) * 60_000;
        return new Date(p.last_fetched_at).getTime() + interval < now;
      }).slice(0, limit);
    }

    let scanned = 0, refreshed = 0, failed = 0, newEpisodes = 0, throttled = false, notModified = 0;
    const results: any[] = [];

    const work = async (p: any) => {
      if (Date.now() - startedAt > TIME_BUDGET_MS) return;
      scanned++;
      try {
        const r = await fetchOne(admin, p, { episodeCap, fetchTimeoutMs: Math.min(8_000, PER_FEED_BUDGET_MS) });
        const lower = (r?.error || "").toLowerCase();
        if (lower.includes("worker_resource_limit") || lower.includes(" 546") || lower.includes("timeout")) throttled = true;
        if (!r.ok) {
          failed++;
          results.push({ id: p.id, slug: p.slug, ok: false, error: r.error });
          return;
        }
        refreshed++;
        newEpisodes += r.new || 0;
        if ((r as any).not_modified) notModified++;
        results.push({ id: p.id, slug: p.slug, new: r.new, duplicates: r.duplicates, items: r.items, not_modified: !!(r as any).not_modified });
      } catch (e: any) {
        failed++;
        results.push({ id: p.id, slug: p.slug, ok: false, error: e?.message });
      }
    };

    await processPool(candidates || [], concurrency, work);

    // Estimate due count for adaptive scheduling (cap to 4000 for speed)
    let due_count = 0;
    try {
      const { data: sample } = await admin
        .from("podcasts")
        .select("last_fetched_at, refresh_interval_minutes, quarantined_until, next_fetch_at")
        .in("crawl_state", ["full_backfilled", "incremental_refresh"])
        .limit(4000);
      const now = Date.now();
      due_count = (sample || []).filter((p: any) => {
        if (p.quarantined_until && new Date(p.quarantined_until).getTime() > now) return false;
        if (p.next_fetch_at && new Date(p.next_fetch_at).getTime() > now) return false;
        if (!p.last_fetched_at) return true;
        const interval = (p.refresh_interval_minutes || 360) * 60_000;
        return new Date(p.last_fetched_at).getTime() + interval < now;
      }).length;
    } catch { /* noop */ }

    // Adaptive cadence policy
    const errorish = failed > 0 || throttled;
    let recommended = "*/10 * * * *";
    if (errorish) recommended = "*/10 * * * *";
    else if (due_count > 500) recommended = "*/5 * * * *";
    else if (due_count >= 100) recommended = "*/10 * * * *";
    else if (due_count > 0) recommended = "*/30 * * * *";
    else recommended = "0 * * * *";

    let applied: string | null = null;
    try {
      await admin.rpc("set_incremental_refresh_schedule", { _schedule: recommended });
      applied = recommended;
    } catch { /* noop */ }

    const summary = {
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      trigger, concurrency, limit, stale_hours, episode_cap: episodeCap,
      scanned, refreshed, failed, throttled, new_episodes: newEpisodes, not_modified: notModified,
      tier_based: useTier, candidates_considered: (candidates || []).length,
      due_count, recommended_schedule: recommended, applied_schedule: applied,
    };
    await admin.from("app_settings").upsert({
      key: "incremental_refresh",
      value: { last_run: summary } as any,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return json({ ok: true, ...summary, per_podcast_results: results });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
