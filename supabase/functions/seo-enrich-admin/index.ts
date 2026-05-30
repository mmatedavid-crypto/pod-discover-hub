// Admin endpoint: status, controls update, scope expansion, manual enqueue/run.
// Requires admin role for any write action; reads are public-safe (no secrets exposed).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function isAdmin(admin: any, authHeader: string | null) {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return false;
  const { data: r } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  return !!r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "status";

  try {
    if (action === "status") {
      const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "ai_seo_controls").maybeSingle();
      const ctrl = (ctrlRow?.value || {}) as any;
      const today = new Date().toISOString().slice(0, 10);
      const { data: spend } = await admin.from("ai_spend_daily").select("*").eq("day", today).maybeSingle();

      // Job counts
      const counts: Record<string, number> = {};
      for (const s of ["pending", "processing", "done", "failed"]) {
        const { count } = await admin.from("ai_enrichment_jobs").select("id", { count: "exact", head: true }).eq("status", s);
        counts[s] = count || 0;
      }

      // Coverage by current scope
      const allowedTiers = ctrl.tiers || ["S", "A", "B", "C", "D"];
      const { count: podsInScope } = await admin.from("podcasts")
        .select("id", { count: "exact", head: true })
        .in("rank_label", allowedTiers)
        .not("full_backfill_completed_at", "is", null);
      const { count: podsDone } = await admin.from("podcasts")
        .select("id", { count: "exact", head: true })
        .in("rank_label", allowedTiers)
        .not("full_backfill_completed_at", "is", null)
        .not("seo_title", "is", null);

      // ETA
      const { data: recent } = await admin.from("ai_enrichment_jobs")
        .select("completed_at, started_at, cost_usd")
        .eq("status", "done")
        .order("completed_at", { ascending: false })
        .limit(50);
      const avgCost = (recent || []).reduce((a, r) => a + Number(r.cost_usd || 0), 0) / Math.max(1, (recent || []).length);
      const dailyBudget = Number(ctrl.daily_budget_usd || 1);
      const remainingBudget = Math.max(0, dailyBudget - Number(spend?.spend_usd || 0));
      const jobsPossibleToday = avgCost > 0 ? Math.floor(remainingBudget / avgCost) : 0;

      return json({
        ok: true,
        controls: ctrl,
        spend: spend || { day: today, spend_usd: 0, calls: 0 },
        jobs: counts,
        scope: { tiers: allowedTiers, podcasts_in_scope: podsInScope || 0, podcasts_done: podsDone || 0 },
        avg_cost_per_job_usd: avgCost,
        jobs_possible_today: jobsPossibleToday,
      });
    }

    // Writes require admin
    const ok = await isAdmin(admin, req.headers.get("Authorization"));
    if (!ok) return json({ error: "forbidden" }, 403);

    const body = await req.json().catch(() => ({}));

    if (action === "set_controls") {
      const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "ai_seo_controls").maybeSingle();
      const ctrl = { ...(ctrlRow?.value || {}), ...body };
      // Manual changes clear auto-pause reason
      if (body.enabled === true) { delete ctrl.auto_paused_reason; delete ctrl.auto_paused_at; }
      await admin.from("app_settings").upsert({ key: "ai_seo_controls", value: ctrl, updated_at: new Date().toISOString() });
      return json({ ok: true, controls: ctrl });
    }

    if (action === "expand_scope") {
      // body.min_rank in {8,6,4,1}
      const next = Number(body.min_rank);
      if (![1,4,6,8].includes(next)) return json({ error: "invalid min_rank" }, 400);
      const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "ai_seo_controls").maybeSingle();
      const ctrl = { ...(ctrlRow?.value || {}), min_rank: next };
      await admin.from("app_settings").upsert({ key: "ai_seo_controls", value: ctrl, updated_at: new Date().toISOString() });
      return json({ ok: true, controls: ctrl });
    }

    if (action === "enqueue") {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/seo-enrich-enqueue`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify(body),
      });
      return new Response(await r.text(), { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (action === "run") {
      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/seo-enrich-runner`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify(body),
      });
      return new Response(await r.text(), { status: r.status, headers: { ...cors, "Content-Type": "application/json" } });
    }

    return json({ error: "unknown action" }, 400);
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
