// formula-c-runner
// Bounded, idempotent Formula C v3 ranker.
//
// Source of truth for tier thresholds: migration
//   supabase/migrations/20260507161722_*.sql
// (function sync_refresh_interval_from_rank — the ladder
//  8.5 / 7.0 / 5.5 / 4.0 / 2.5 mapping podiverzum_rank → S/A/B/C/D/E).
//
// What it writes (per podcast in the batch):
//   shadow_rank             := podiverzum_rank (preserve scale 0–10)
//   shadow_rank_tier        := tier from ladder
//   shadow_rank_components  := preserve existing keys, set
//                              { formula: 'C_v3', source: 'formula-c-runner-v1',
//                                health_state: <preserved or 'healthy'> }
//   shadow_computed_at      := now()
//   rank_label              := shadow_rank_tier
//   rank_updated_at         := now()
//   rank_reason             := { formula: 'C_v3', source: 'formula-c-runner-v1',
//                                from: 'podiverzum_rank', podiverzum_rank }
//
// Selection (when no explicit ids): podcasts that need ranking, ordered by
// podiverzum_rank DESC so the highest-impact rows are fixed first. Default
// limit = 25 (hard cap 50).
//
// Body (all optional):
//   { ids?: string[], limit?: number, dry_run?: boolean }
//
// Manual-only for now: NOT scheduled. Respects incident-guard.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_TIERS = new Set(["S", "A", "B", "C", "D", "E"]);

function tierFor(score: number): "S" | "A" | "B" | "C" | "D" | "E" {
  if (score >= 8.5) return "S";
  if (score >= 7.0) return "A";
  if (score >= 5.5) return "B";
  if (score >= 4.0) return "C";
  if (score >= 2.5) return "D";
  return "E";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: any = {};
    try { body = req.method === "POST" ? await req.json() : {}; } catch { /* */ }
    const ids: string[] | undefined = Array.isArray(body.ids) ? body.ids.slice(0, 50) : undefined;
    const dry: boolean = !!body.dry_run;
    const limit: number = Math.max(1, Math.min(50, Number(body.limit) || 25));

    // Incident guard (skip for dry-run so we can always inspect)
    if (!dry) {
      const guard = await checkBackgroundJobsAllowed(supabase, "formula-c-runner");
      if (guard.blocked) {
        return new Response(JSON.stringify({ ok: false, blocked: true, reason: guard.reason }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Select target rows
    let query = supabase
      .from("podcasts")
      .select("id, title, podiverzum_rank, rank_label, rank_updated_at, shadow_rank, shadow_rank_tier, shadow_rank_components, shadow_computed_at, rss_status, consecutive_failure_count, quarantined_until");

    if (ids && ids.length > 0) {
      query = query.in("id", ids);
    } else {
      // needs ranking: missing/invalid label OR missing shadow_rank
      query = query.or(
        "rank_label.is.null,shadow_rank.is.null,rank_label.not.in.(S,A,B,C,D,E)",
      ).order("podiverzum_rank", { ascending: false, nullsFirst: false }).limit(limit);
    }

    const { data: rows, error: selErr } = await query;
    if (selErr) throw selErr;

    const t0 = Date.now();
    const results: any[] = [];
    let updated = 0, skipped = 0, errors = 0;

    for (const p of rows || []) {
      const score = Number(p.podiverzum_rank);
      if (!Number.isFinite(score)) {
        skipped++;
        results.push({ id: p.id, title: p.title, skipped: "invalid_podiverzum_rank" });
        continue;
      }
      const tier = tierFor(score);

      // Preserve existing components; do not invent fields.
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
        rank_label: p.rank_label,
        shadow_rank: p.shadow_rank,
        shadow_rank_tier: p.shadow_rank_tier,
        rank_updated_at: p.rank_updated_at,
        shadow_computed_at: p.shadow_computed_at,
      };
      const after = {
        rank_label: tier,
        shadow_rank: score,
        shadow_rank_tier: tier,
        rank_updated_at: "now",
        shadow_computed_at: "now",
      };

      if (dry) {
        results.push({ id: p.id, title: p.title, podiverzum_rank: score, before, after, dry_run: true });
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
        results.push({ id: p.id, title: p.title, podiverzum_rank: score, before, after });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      mode: dry ? "dry_run" : "apply",
      considered: rows?.length || 0,
      updated,
      skipped,
      errors,
      duration_ms: Date.now() - t0,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
