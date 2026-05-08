// formula-c-runner
// Bounded, idempotent Formula C v3 ranker.
//
// Source of truth for tier thresholds: migration
//   supabase/migrations/20260507161722_*.sql
// (function sync_refresh_interval_from_rank — the ladder
//  8.5 / 7.0 / 5.5 / 4.0 / 2.5 mapping podiverzum_rank → S/A/B/C/D/E).
//
// AUTH: requires header `x-internal-runner-secret` === FORMULA_C_RUNNER_SECRET.
// Returns 401 otherwise. Applies to ALL modes (including dry_run / diff_only)
// because this endpoint can read service-role data.
//
// Body (all optional):
//   { ids?: string[], limit?: number, dry_run?: boolean, diff_only?: boolean }
//
// Manual-only for now: NOT scheduled. Respects incident-guard for apply.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-runner-secret",
};

const VALID_TIERS = new Set(["S", "A", "B", "C", "D", "E"]);
const LEGACY_LABELS = new Set([
  "Excellent", "Strong", "Indexed", "Elite", "Medium", "Weak", "Poor", "Broken",
]);

function tierFor(score: number): "S" | "A" | "B" | "C" | "D" | "E" {
  if (score >= 8.5) return "S";
  if (score >= 7.0) return "A";
  if (score >= 5.5) return "B";
  if (score >= 4.0) return "C";
  if (score >= 2.5) return "D";
  return "E";
}

function classifyAction(p: any, computedTier: string, computedShadow: number) {
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

  // Shared-secret guard (applies to all modes)
  const expected = Deno.env.get("FORMULA_C_RUNNER_SECRET");
  const provided = req.headers.get("x-internal-runner-secret");
  if (!expected || !provided || provided !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: any = {};
    try { body = req.method === "POST" ? await req.json() : {}; } catch { /* */ }
    const ids: string[] | undefined = Array.isArray(body.ids) ? body.ids.slice(0, 50) : undefined;
    const diffOnly: boolean = !!body.diff_only;
    const dry: boolean = !!body.dry_run || diffOnly; // diff_only implies dry
    const limit: number = Math.max(1, Math.min(50, Number(body.limit) || 25));

    if (!dry) {
      const guard = await checkBackgroundJobsAllowed(supabase, "formula-c-runner");
      if (guard.blocked) {
        return new Response(JSON.stringify({ ok: false, blocked: true, reason: guard.reason }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    let query = supabase
      .from("podcasts")
      .select("id, title, podiverzum_rank, rank_label, rank_updated_at, shadow_rank, shadow_rank_tier, shadow_rank_components, shadow_computed_at");

    if (ids && ids.length > 0) {
      query = query.in("id", ids);
    } else {
      query = query.or(
        "rank_label.is.null,shadow_rank.is.null,rank_label.not.in.(S,A,B,C,D,E)",
      ).order("podiverzum_rank", { ascending: false, nullsFirst: false }).limit(limit);
    }

    const { data: rows, error: selErr } = await query;
    if (selErr) throw selErr;

    const t0 = Date.now();
    const results: any[] = [];
    let updated = 0, skipped = 0, errors = 0, noChange = 0;

    for (const p of rows || []) {
      const score = Number(p.podiverzum_rank);
      if (!Number.isFinite(score)) {
        skipped++;
        results.push({ id: p.id, title: p.title, skipped: "invalid_podiverzum_rank" });
        continue;
      }
      const tier = tierFor(score);
      const action = classifyAction(p, tier, score);

      if (diffOnly) {
        if (action === "no_change") { noChange++; continue; }
        results.push({
          id: p.id, title: p.title,
          podiverzum_rank: score,
          current_rank_label: p.rank_label,
          computed_tier: tier,
          current_shadow_rank: p.shadow_rank,
          computed_shadow_rank: score,
          action,
        });
        continue;
      }

      const prevComp = (p.shadow_rank_components && typeof p.shadow_rank_components === "object")
        ? { ...(p.shadow_rank_components as Record<string, unknown>) }
        : {};
      const healthState = (typeof prevComp.health_state === "string" && prevComp.health_state)
        ? prevComp.health_state as string
        : "healthy";
      const newComp = {
        ...prevComp,
        formula: "C_v3",
        source: "formula-c-runner-v1",
        health_state: healthState,
      };

      const before = {
        rank_label: p.rank_label, shadow_rank: p.shadow_rank,
        shadow_rank_tier: p.shadow_rank_tier,
        rank_updated_at: p.rank_updated_at, shadow_computed_at: p.shadow_computed_at,
      };
      const after = {
        rank_label: tier, shadow_rank: score, shadow_rank_tier: tier,
        rank_updated_at: "now", shadow_computed_at: "now",
      };

      if (dry) {
        results.push({ id: p.id, title: p.title, podiverzum_rank: score, before, after, action, dry_run: true });
        continue;
      }

      const nowIso = new Date().toISOString();
      const { error: updErr } = await supabase.from("podcasts").update({
        shadow_rank: score,
        shadow_rank_tier: tier,
        shadow_rank_components: newComp,
        shadow_computed_at: nowIso,
        rank_label: tier,
        rank_updated_at: nowIso,
        rank_reason: {
          formula: "C_v3",
          source: "formula-c-runner-v1",
          from: "podiverzum_rank",
          podiverzum_rank: score,
        },
      }).eq("id", p.id);

      if (updErr) {
        errors++;
        results.push({ id: p.id, title: p.title, error: updErr.message });
      } else {
        updated++;
        results.push({ id: p.id, title: p.title, podiverzum_rank: score, before, after, action });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      mode: diffOnly ? "diff_only" : (dry ? "dry_run" : "apply"),
      considered: rows?.length || 0,
      updated, skipped, errors,
      no_change: diffOnly ? noChange : undefined,
      duration_ms: Date.now() - t0,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
