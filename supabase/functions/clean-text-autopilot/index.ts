// Clean Text Autopilot.
// Cron-safe orchestrator for large catalogs: plans a safe refresh, generates
// candidates, and promotes only changed candidates that passed quality gates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type Controls = {
  enabled?: boolean;
  mode?: string;
  tiers?: string[];
  stage_limit?: number;
  candidate_batch?: number;
  promote_limit?: number;
  auto_stop_at_errors?: number;
  consecutive_errors?: number;
};

const DEFAULT_CONTROLS: Required<Pick<Controls, "enabled" | "mode" | "tiers" | "stage_limit" | "candidate_batch" | "promote_limit" | "auto_stop_at_errors" | "consecutive_errors">> = {
  enabled: true,
  mode: "bad_or_old",
  tiers: ["S", "A", "B", "C"],
  stage_limit: 250,
  candidate_batch: 100,
  promote_limit: 100,
  auto_stop_at_errors: 5,
  consecutive_errors: 0,
};

async function callFunction(name: string, body: Record<string, unknown>, query = "") {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${name}${query}`;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${name} ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "clean-text-autopilot");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));
    const trigger = String(body.trigger || "cron");
    const { data: row } = await admin.from("app_settings").select("value").eq("key", "clean_text_autopilot").maybeSingle();
    const controls: Controls = { ...DEFAULT_CONTROLS, ...(row?.value || {}) };

    if (controls.enabled === false) {
      return json({ ok: true, skipped: true, trigger, reason: "disabled" });
    }

    const stageLimit = Math.max(1, Math.min(1000, Number(controls.stage_limit || DEFAULT_CONTROLS.stage_limit)));
    const candidateBatch = Math.max(1, Math.min(500, Number(controls.candidate_batch || DEFAULT_CONTROLS.candidate_batch)));
    const promoteLimit = Math.max(1, Math.min(500, Number(controls.promote_limit || DEFAULT_CONTROLS.promote_limit)));
    const tiers = Array.isArray(controls.tiers) && controls.tiers.length ? controls.tiers.map(String) : DEFAULT_CONTROLS.tiers;
    const mode = String(controls.mode || DEFAULT_CONTROLS.mode);

    let plan: any = null;
    let stage: any = null;
    let candidates: any = null;
    let promote: any = null;
    let error: string | null = null;

    try {
      plan = await callFunction("intelligence-reprocess-admin", {
        mode,
        limit: stageLimit,
        tiers,
        dry_run: true,
      }, "?action=plan");

      if (Number(plan?.candidate_count || 0) > 0) {
        stage = await callFunction("intelligence-reprocess-admin", {
          mode,
          limit: stageLimit,
          tiers,
        }, "?action=stage");
        candidates = await callFunction("episode-clean-text-candidate-runner", { batch: candidateBatch });
        promote = await callFunction("episode-clean-text-candidate-promoter", { limit: promoteLimit });
      }

      controls.consecutive_errors = 0;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      controls.consecutive_errors = Number(controls.consecutive_errors || 0) + 1;
      if (controls.consecutive_errors >= Number(controls.auto_stop_at_errors || DEFAULT_CONTROLS.auto_stop_at_errors)) {
        controls.enabled = false;
      }
    }

    const state = {
      ...controls,
      last_run_at: new Date().toISOString(),
      last_trigger: trigger,
      last_runtime_ms: Date.now() - startedAt,
      last_plan: plan,
      last_stage: stage,
      last_candidates: candidates,
      last_promotion: promote,
      last_error: error,
    };

    await admin.from("app_settings").upsert({
      key: "clean_text_autopilot",
      value: state,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return json({
      ok: !error,
      trigger,
      planned: Number(plan?.candidate_count || 0),
      staged: Number(stage?.staged || 0),
      candidates,
      promotion: promote,
      error,
      enabled: state.enabled,
      consecutive_errors: state.consecutive_errors,
    }, error ? 500 : 200);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "error" }, 500);
  }
});
