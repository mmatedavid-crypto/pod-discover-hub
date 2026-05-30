// Entity Quality Autopilot.
// Cron-safe orchestrator: measures entity data quality continuously and, when
// explicitly enabled, applies only no-AI, non-destructive repairs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type Controls = {
  enabled?: boolean;
  dry_run?: boolean;
  snapshot_limit?: number;
  apply_limit?: number;
  auto_stop_at_errors?: number;
  consecutive_errors?: number;
  allowed_apply_actions?: string[];
};

const DEFAULT_CONTROLS: Required<Controls> = {
  enabled: true,
  dry_run: true,
  snapshot_limit: 100,
  apply_limit: 100,
  auto_stop_at_errors: 5,
  consecutive_errors: 0,
  allowed_apply_actions: ["hide_low_confidence_organization"],
};

async function callFunction(name: string, body: Record<string, unknown>) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${name}`;
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
    const guard = await checkBackgroundJobsAllowed(admin, "entity-quality-autopilot");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));
    const trigger = String(body.trigger || "cron");

    const { data: row } = await admin.from("app_settings").select("value").eq("key", "entity_quality_controls").maybeSingle();
    const controls: Controls = { ...DEFAULT_CONTROLS, ...(row?.value || {}) };

    if (controls.enabled === false) {
      return json({ ok: true, skipped: true, trigger, reason: "disabled" });
    }

    const dryRun = controls.dry_run !== false;
    const snapshotLimit = Math.max(1, Math.min(500, Number(controls.snapshot_limit || DEFAULT_CONTROLS.snapshot_limit)));
    const applyLimit = Math.max(1, Math.min(500, Number(controls.apply_limit || DEFAULT_CONTROLS.apply_limit)));
    const allowedActions = Array.isArray(controls.allowed_apply_actions) && controls.allowed_apply_actions.length
      ? controls.allowed_apply_actions.map(String)
      : DEFAULT_CONTROLS.allowed_apply_actions;

    let snapshot: any = null;
    let applyResults: any[] = [];
    let error: string | null = null;

    try {
      const { data, error: snapshotErr } = await admin.rpc("get_entity_quality_snapshot_v1", { _limit: snapshotLimit });
      if (snapshotErr) throw snapshotErr;
      snapshot = data;

      for (const action of allowedActions) {
        const result = await callFunction("entity-quality-apply-runner", {
          action,
          limit: applyLimit,
          dry_run: dryRun,
        });
        applyResults.push(result);
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
      last_dry_run: dryRun,
      last_snapshot: snapshot,
      last_apply_results: applyResults,
      processed: applyResults.reduce((sum, r) => sum + Number(r?.planned || 0), 0),
      applied: applyResults.reduce((sum, r) => sum + Number(r?.applied || 0), 0),
      errors_last_run: error ? 1 : 0,
      last_error: error,
    };

    await admin.from("app_settings").upsert({
      key: "entity_quality_controls",
      value: state,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return json({
      ok: !error,
      trigger,
      dry_run: dryRun,
      total_issue_rows: Number(snapshot?.total_issue_rows || 0),
      action_counts: snapshot?.action_counts || {},
      apply_results: applyResults,
      error,
      enabled: state.enabled,
      consecutive_errors: state.consecutive_errors,
      runtime_ms: state.last_runtime_ms,
    }, error ? 500 : 200);
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "error" }, 500);
  }
});
