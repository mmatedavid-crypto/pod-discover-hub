// formula-c-runner
// Bounded, idempotent Formula C v3 ranker.
//
// Source of truth for tier thresholds: migration
//   supabase/migrations/20260507161722_*.sql
// Ladder: 8.5/7.0/5.5/4.0/2.5 → S/A/B/C/D/E.
//
// AUTH: requires header `x-internal-runner-secret` === FORMULA_C_RUNNER_SECRET.
// Returns 401 otherwise. Applies to ALL modes (apply, dry_run, diff_only).
//
// Body (all optional):
//   { ids?: string[], limit?: number, dry_run?: boolean, diff_only?: boolean }
//
// Selection (when no explicit ids): rpc formula_c_candidates(_limit) returns
// rows ordered legacy/null/problem first, then newest, then highest score.
//
// Side effects: writes app_settings.formula_c_runner with last_run summary.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-runner-secret",
};

const VALID_TIERS = new Set(["S", "A", "B", "C", "D", "E"]);

const DEFAULT_THRESHOLDS = { S: 8.5, A: 7.0, B: 5.5, C: 4.0, D: 2.5 };

function tierForWith(score: number, t: { S: number; A: number; B: number; C: number; D: number }): "S" | "A" | "B" | "C" | "D" | "E" {
  if (score >= t.S) return "S";
  if (score >= t.A) return "A";
  if (score >= t.B) return "B";
  if (score >= t.C) return "C";
  if (score >= t.D) return "D";
  return "E";
}

async function loadThresholds(supabase: any): Promise<{ S: number; A: number; B: number; C: number; D: number }> {
  try {
    const { data } = await supabase.from("app_settings").select("value").eq("key", "formula_c_thresholds").maybeSingle();
    const v = data?.value as any;
    if (v && typeof v === "object" && typeof v.S === "number" && typeof v.A === "number" && typeof v.B === "number" && typeof v.C === "number" && typeof v.D === "number") {
      // Guard: monotonically decreasing.
      if (v.S > v.A && v.A > v.B && v.B > v.C && v.C > v.D) return v;
    }
  } catch (_) { /* ignore, fall back */ }
  return DEFAULT_THRESHOLDS;
}

async function isApplyToLiveEnabled(supabase: any): Promise<boolean> {
  try {
    const { data } = await supabase.from("app_settings").select("value").eq("key", "formula_c_apply_to_live_rank").maybeSingle();
    const v = data?.value as any;
    return !!(v && v.enabled === true);
  } catch (_) {
    return false;
  }
}

function classifyAction(p: any, computedTier: string) {
  const cur = p.rank_label;
  const isLegacy = cur && !VALID_TIERS.has(cur);
  if (isLegacy) return "legacy_fix";
  if (cur == null) return "relabel";
  if (p.shadow_rank == null) return "fill_shadow";
  if (cur !== computedTier) return "relabel";
  return "no_change";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth: function is idempotent (recomputes tier from existing podiverzum_rank)
  // and gated by app_settings.background_jobs kill switch. Open to anon key
  // callers (cron, admin UI). No destructive side effects beyond tier relabel.

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: any = {};
    try { body = req.method === "POST" ? await req.json() : {}; } catch { /* */ }
    const ids: string[] | undefined = Array.isArray(body.ids) ? body.ids.slice(0, 200) : undefined;
    const diffOnly: boolean = !!body.diff_only;
    const dry: boolean = !!body.dry_run || diffOnly;
    const limit: number = Math.max(1, Math.min(200, Number(body.limit) || 50));

    if (!dry) {
      const guard = await checkBackgroundJobsAllowed(supabase, "formula-c-runner");
      if (guard.blocked) {
        return new Response(JSON.stringify({ ok: false, blocked: true, reason: guard.reason }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const thresholds = await loadThresholds(supabase);
    const applyToLive = await isApplyToLiveEnabled(supabase);

    // Resolve target ids
    let targetIds: string[] = [];
    if (ids && ids.length > 0) {
      targetIds = ids;
    } else {
      const { data: cand, error: candErr } = await supabase
        .rpc("formula_c_candidates", { _limit: limit });
      if (candErr) throw candErr;
      targetIds = (cand || []).map((r: any) => r.id);
    }

    if (targetIds.length === 0) {
      // Still write a heartbeat
      const status = await supabase.rpc("formula_c_status");
      const summary = {
        ts: new Date().toISOString(), considered: 0, updated: 0, skipped: 0, errors: 0,
        no_change: 0, mode: diffOnly ? "diff_only" : (dry ? "dry_run" : "apply"),
        duration_ms: 0,
        remaining_needing_change: status.data?.remaining_needing_change ?? null,
        remaining_legacy_labels: status.data?.legacy_label_count ?? null,
        null_rank_label_count: status.data?.null_rank_label ?? null,
        mismatch_count: status.data?.mismatch_count ?? null,
      };
      if (!dry) {
        await supabase.from("app_settings").upsert({ key: "formula_c_runner", value: { last_run: summary } });
      }
      return new Response(JSON.stringify({ ok: true, ...summary, results: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: rows, error: selErr } = await supabase
      .from("podcasts")
      .select("id, title, language, rss_status, hydrated_episode_count, podiverzum_rank, rank_label, rank_updated_at, shadow_rank, shadow_rank_tier, shadow_rank_components, shadow_computed_at")
      .in("id", targetIds);
    if (selErr) throw selErr;

    // Freshness gate: fetch last episode date per podcast in this batch.
    // S retained only if active RSS + last episode within 90 days + >=20 hydrated episodes.
    // A retained only if last episode within 180 days. Otherwise demoted one notch.
    const lastEpByPodcast = new Map<string, number>();
    try {
      const { data: lastEps } = await supabase
        .from("episodes")
        .select("podcast_id, published_at")
        .in("podcast_id", targetIds)
        .order("published_at", { ascending: false })
        .limit(50000);
      for (const e of lastEps || []) {
        const pid = (e as any).podcast_id;
        const ts = (e as any).published_at ? new Date((e as any).published_at).getTime() : 0;
        const cur = lastEpByPodcast.get(pid) || 0;
        if (ts > cur) lastEpByPodcast.set(pid, ts);
      }
    } catch (_) { /* freshness optional */ }

    const NOW = Date.now();
    const D90 = 90 * 24 * 3600_000;
    const D180 = 180 * 24 * 3600_000;
    function applyFreshnessGate(baseTier: string, podcast: any): { tier: string; demoted: boolean; reason?: string } {
      const lastEp = lastEpByPodcast.get(podcast.id) || 0;
      const ageMs = lastEp ? NOW - lastEp : Number.POSITIVE_INFINITY;
      const hydrated = Number(podcast.hydrated_episode_count) || 0;
      const rss = String(podcast.rss_status || "");
      if (baseTier === "S") {
        const keep = rss === "active" && ageMs <= D90 && hydrated >= 20;
        if (!keep) {
          const reasons: string[] = [];
          if (rss !== "active") reasons.push("rss_not_active");
          if (ageMs > D90) reasons.push("stale_gt_90d");
          if (hydrated < 20) reasons.push("low_episodes_lt_20");
          return { tier: "A", demoted: true, reason: reasons.join(",") };
        }
      }
      if (baseTier === "A") {
        if (ageMs > D180) {
          return { tier: "B", demoted: true, reason: "stale_gt_180d" };
        }
      }
      return { tier: baseTier, demoted: false };
    }

    const t0 = Date.now();
    const results: any[] = [];
    let updated = 0, skipped = 0, errors = 0, noChange = 0, demoted = 0;

    for (const p of rows || []) {
      const score = Number(p.podiverzum_rank);
      if (!Number.isFinite(score)) {
        skipped++;
        results.push({ id: p.id, title: p.title, skipped: "invalid_podiverzum_rank" });
        continue;
      }
      const baseTier = tierForWith(score, thresholds);
      const gate = applyFreshnessGate(baseTier, p);
      const tier = gate.tier;
      if (gate.demoted) demoted++;
      const action = classifyAction(p, tier);

      if (diffOnly) {
        if (action === "no_change") { noChange++; continue; }
        results.push({
          id: p.id, title: p.title, podiverzum_rank: score,
          current_rank_label: p.rank_label, computed_tier: tier,
          current_shadow_rank: p.shadow_rank, computed_shadow_rank: score, action,
        });
        continue;
      }

      const prevComp = (p.shadow_rank_components && typeof p.shadow_rank_components === "object")
        ? { ...(p.shadow_rank_components as Record<string, unknown>) } : {};
      const healthState = (typeof prevComp.health_state === "string" && prevComp.health_state)
        ? prevComp.health_state as string : "healthy";
      const newComp = {
        ...prevComp, formula: "C_v3", source: "formula-c-runner-v1", health_state: healthState,
        base_tier: baseTier,
        freshness_demotion: gate.demoted ? gate.reason || "demoted" : null,
      };

      if (dry) {
        results.push({ id: p.id, title: p.title, podiverzum_rank: score, action, base_tier: baseTier, new_tier: tier, freshness_demotion: gate.demoted ? gate.reason : null, dry_run: true });
        continue;
      }

      const nowIso = new Date().toISOString();
      // Phase A kill-switch: when formula_c_apply_to_live_rank.enabled !== true,
      // we MUST NOT write live rank_label or podiverzum_rank. Shadow fields only.
      const updatePayload: Record<string, unknown> = {
        shadow_rank: score,
        shadow_rank_tier: tier,
        shadow_rank_components: newComp,
        shadow_computed_at: nowIso,
      };
      if (applyToLive) {
        updatePayload.rank_label = tier;
        updatePayload.rank_updated_at = nowIso;
        updatePayload.rank_reason = {
          formula: "C_v3", source: "formula-c-runner-v1", from: "podiverzum_rank",
          podiverzum_rank: score, base_tier: baseTier,
          freshness_demotion: gate.demoted ? gate.reason || "demoted" : null,
        };
      }
      // NOTE: podiverzum_rank is never written by this runner (input, not output).
      const { error: updErr } = await supabase.from("podcasts").update(updatePayload).eq("id", p.id);

      if (updErr) {
        errors++;
        results.push({ id: p.id, title: p.title, error: updErr.message });
      } else {
        updated++;
        results.push({ id: p.id, title: p.title, podiverzum_rank: score, action, base_tier: baseTier, new_tier: tier, freshness_demotion: gate.demoted ? gate.reason : null });
      }
    }

    const duration_ms = Date.now() - t0;
    const mode = diffOnly ? "diff_only" : (dry ? "dry_run" : "apply");

    // Post-run status snapshot
    let remaining: any = {};
    try {
      const { data: st } = await supabase.rpc("formula_c_status");
      remaining = {
        remaining_needing_change: st?.remaining_needing_change ?? null,
        remaining_legacy_labels: st?.legacy_label_count ?? null,
        null_rank_label_count: st?.null_rank_label ?? null,
        mismatch_count: st?.mismatch_count ?? null,
      };
    } catch (_) { /* ignore */ }

    const summary = {
      ts: new Date().toISOString(),
      mode, considered: rows?.length || 0, updated, skipped, errors, demoted,
      no_change: diffOnly ? noChange : undefined,
      duration_ms, ...remaining,
    };

    if (!dry) {
      // Append to recent_runs (cap 5) and compute lightweight health signal
      const { data: prevSetting } = await supabase
        .from("app_settings").select("value").eq("key", "formula_c_runner").maybeSingle();
      const prev = (prevSetting?.value as any) || {};
      const recent = Array.isArray(prev.recent_runs) ? prev.recent_runs.slice(-4) : [];
      const trimmedSummary = {
        ts: summary.ts, updated: summary.updated, errors: summary.errors,
        duration_ms: summary.duration_ms,
        remaining_needing_change: (summary as any).remaining_needing_change ?? null,
      };
      const recent_runs = [...recent, trimmedSummary];

      // Stuck detection: 3 consecutive runs with remaining>0 and no decrease
      let health: "healthy" | "idle" | "stuck" | "error" = "healthy";
      if (summary.errors > 0) health = "error";
      else if ((summary as any).remaining_needing_change === 0) health = "idle";
      else if (recent_runs.length >= 3) {
        const tail = recent_runs.slice(-3).map((r: any) => r.remaining_needing_change);
        if (tail.every((v: any) => typeof v === "number" && v > 0)
            && tail[0] <= tail[1] && tail[1] <= tail[2]
            && !(tail[0] === tail[1] && tail[1] === tail[2] && tail[0] === 0)) {
          // non-decreasing across 3 runs while >0
          if (tail[2] >= tail[0]) health = "stuck";
        }
      }

      await supabase.from("app_settings").upsert({
        key: "formula_c_runner",
        value: { last_run: summary, recent_runs, health, updated_at: new Date().toISOString() },
      });
    }

    console.log("[formula-c-runner]", JSON.stringify(summary));

    return new Response(JSON.stringify({ ok: true, ...summary, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[formula-c-runner] error:", e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
