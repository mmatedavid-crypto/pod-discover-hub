// Deep hydration runner: re-fetch RSS for accepted podcasts with higher episode caps.
// Service-role writes; admin verified via user_roles (no has_role RPC).
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

function targetForRank(rank: number): number {
  if (rank >= 9) return 150;
  if (rank >= 8) return 100;
  if (rank >= 6) return 75;
  if (rank >= 4) return 40;
  return 0;
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

    // Allow service-role calls (cron/admin internal) to bypass user check
    const token = authHeader.slice(7);
    let isAdmin = token === SERVICE;
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
    const limit = Math.max(1, Math.min(20, Number(body.limit) || 5));
    const trigger = (body.trigger as string) || "manual";
    const TIME_BUDGET_MS = 110_000;
    const LOCK_MS = 10 * 60 * 1000;
    const startedAt = Date.now();

    // Lock check (skip if forced)
    const { data: priorRow } = await admin.from("app_settings").select("value").eq("key", "deep_hydration").maybeSingle();
    const priorVal: any = (priorRow?.value as any) || {};
    const lockUntil = priorVal.lock_until ? new Date(priorVal.lock_until).getTime() : 0;
    if (!body.force && lockUntil > Date.now()) {
      return json({ ok: true, skipped: true, reason: "already_running", lock_until: priorVal.lock_until });
    }
    // Acquire lock
    await admin.from("app_settings").upsert({
      key: "deep_hydration",
      value: { ...priorVal, lock_started_at: new Date().toISOString(), lock_until: new Date(Date.now() + LOCK_MS).toISOString() },
      updated_at: new Date().toISOString(),
    });

    // Select eligible podcasts: rank >= 4, rss_status active or not_checked,
    // status in (not_started, failed), or null. Prioritize by rank desc, then never-hydrated first.
    const { data: candidates, error: cErr } = await admin
      .from("podcasts")
      .select("id, title, rss_url, podiverzum_rank, rss_status, deep_hydration_status, last_deep_hydrated_at, hydrated_episode_count")
      .gte("podiverzum_rank", 4)
      .in("rss_status", ["active", "not_checked"])
      .in("deep_hydration_status", ["not_started", "failed"])
      .order("podiverzum_rank", { ascending: false })
      .order("last_deep_hydrated_at", { ascending: true, nullsFirst: true })
      .limit(limit);

    if (cErr) throw cErr;

    const results: any[] = [];
    let processed = 0, active = 0, failed = 0, newEpisodes = 0, duplicates = 0;

    for (const p of candidates || []) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      const target = targetForRank(p.podiverzum_rank || 0);

      await admin.from("podcasts").update({
        deep_hydration_status: "in_progress",
        deep_hydration_target: target,
        deep_hydration_error: null,
      }).eq("id", p.id);

      let res: any = null; let err: string | null = null;
      try {
        res = await fetchOne(admin, p, { episodeCap: target });
      } catch (e: any) {
        err = e?.message || String(e);
      }

      processed++;
      const stamp = new Date().toISOString();

      if (err || !res?.ok) {
        failed++;
        const reason = err || res?.error || "unknown";
        await admin.from("podcasts").update({
          deep_hydration_status: "failed",
          deep_hydration_error: reason,
          last_deep_hydrated_at: stamp,
        }).eq("id", p.id);
        results.push({ id: p.id, title: p.title, rank: p.podiverzum_rank, target, status: "failed", reason });
        continue;
      }

      const { count: epCount } = await admin
        .from("episodes").select("id", { count: "exact", head: true })
        .eq("podcast_id", p.id);
      const total = epCount || 0;
      newEpisodes += res.new || 0;
      duplicates += res.duplicates || 0;

      // completed if we hit the target OR the feed returned fewer items than target
      const reachedTarget = total >= target;
      const feedExhausted = (res.items ?? 0) < target;
      const status = (reachedTarget || feedExhausted) ? "completed" : "in_progress";
      if (status === "completed") active++;

      await admin.from("podcasts").update({
        deep_hydration_status: status,
        hydrated_episode_count: total,
        last_deep_hydrated_at: stamp,
        deep_hydration_error: null,
      }).eq("id", p.id);

      results.push({
        id: p.id, title: p.title, rank: p.podiverzum_rank, target,
        status, total_episodes: total, new_episodes: res.new, duplicates: res.duplicates, items_in_feed: res.items,
      });
    }

    const { count: remainingEligible } = await admin
      .from("podcasts").select("id", { count: "exact", head: true })
      .gte("podiverzum_rank", 4)
      .in("rss_status", ["active", "not_checked"])
      .in("deep_hydration_status", ["not_started", "failed"]);

    // Persist last-run summary (preserve config, clear lock)
    const summary = {
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
      trigger,
      processed, completed: active, failed,
      new_episodes: newEpisodes, duplicates,
      remaining_eligible: remainingEligible ?? 0,
    };
    const { data: prior } = await admin.from("app_settings").select("value").eq("key", "deep_hydration").maybeSingle();
    const prev: any = (prior?.value as any) || {};
    const totals = prev.totals || { processed: 0, completed: 0, failed: 0, new_episodes: 0, duplicates: 0, runs: 0 };
    totals.processed += processed;
    totals.completed += active;
    totals.failed += failed;
    totals.new_episodes += newEpisodes;
    totals.duplicates += duplicates;
    totals.runs += 1;
    await admin.from("app_settings").upsert({
      key: "deep_hydration",
      value: {
        ...prev,
        lock_started_at: null,
        lock_until: null,
        last_run: summary,
        totals,
      },
      updated_at: new Date().toISOString(),
    });

    return json({
      ok: true,
      processed, active, failed,
      new_episodes: newEpisodes, duplicates,
      remaining_eligible: remainingEligible ?? 0,
      per_podcast_results: results,
      elapsed_ms: Date.now() - startedAt,
    });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
