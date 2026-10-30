import { denyUntrustedCaller } from "../_shared/internal-auth.ts";
// Entity Quality Autopilot v2 — organization quality hold.
// No AI calls, no cost. Keeps ambiguous / non-entity organizations (e.g. "Toronto", "Pride")
// out of search indexing and hub lists, while their pages, chips and episode links stay.
// The whole decision and write lives in apply_org_quality_holds_v1 (two opinions required,
// protected types skipped, CAS + before-state log, rollback via release_org_quality_holds_v1,
// a confident second opinion releases a hold automatically). recompute_org_gated_counts
// respects the hold, so recounts no longer undo it.
// Starts only from the scheduler (per-job token), the service role, or a signed-in admin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { runLog } from "../_shared/runner-run-log.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const JOB = "entity-quality-autopilot";
const CONTROLS_KEY = "entity_quality_controls";

function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object" && "message" in e) return String((e as { message: unknown }).message);
  return String(e);
}

function sameToken(a: string, b: string) {
  if (a.length < 32 || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function authorized(admin: ReturnType<typeof createClient>, req: Request) {
  const given = req.headers.get("x-internal-token") || "";
  if (given) {
    const { data } = await admin.from("internal_job_tokens").select("token").eq("job", JOB).maybeSingle();
    if (sameToken(String(data?.token || ""), given)) return true;
  }
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  if (jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const { data: u } = await admin.auth.getUser(jwt).catch(() => ({ data: null as any }));
  if (!u?.user?.id) return false;
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  return !!role;
}

async function readControls(admin: ReturnType<typeof createClient>) {
  const { data } = await admin.from("app_settings").select("value").eq("key", CONTROLS_KEY).maybeSingle();
  return ((data?.value as Record<string, unknown>) || {}) as Record<string, any>;
}

Deno.serve(async (req) => {
  { const denied = await denyUntrustedCaller(req, "entity-quality-autopilot"); if (denied) return denied; }
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await authorized(admin, req))) return json({ error: "forbidden" }, 403);

  const guard = await checkBackgroundJobsAllowed(admin, JOB);
  if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

  const body = await req.json().catch(() => ({}));
  const trigger = String(body.trigger || "cron");
  const controls = await readControls(admin);
  if (controls.enabled === false) return json({ ok: true, skipped: true, trigger, reason: "disabled" });

  const dryRun = body.dry_run !== undefined ? body.dry_run === true : controls.dry_run === true;
  const limit = Math.max(1, Math.min(500, Number(body.limit || controls.apply_limit || 100)));
  const log = runLog(admin, "entity_quality_autopilot");
  await log.start({ trigger, dry_run: dryRun, limit });

  let result: Record<string, unknown> | null = null;
  let error: string | null = null;
  try {
    const { data, error: rpcErr } = await admin.rpc("apply_org_quality_holds_v1", {
      _limit: limit, _dry_run: dryRun, _run_id: log.id,
    });
    if (rpcErr) throw rpcErr;
    result = data as Record<string, unknown>;
  } catch (e) {
    error = errText(e);
  }
  await log.finish(error ? "error" : "ok", { trigger, dry_run: dryRun, ...(result || {}) }, error);

  // Telemetry: re-read controls so an owner pause made during the run is never overwritten.
  const fresh = await readControls(admin);
  const consecutive = error ? Number(fresh.consecutive_errors || 0) + 1 : 0;
  const stopAt = Number(fresh.auto_stop_at_errors || 5);
  const next: Record<string, unknown> = {
    ...fresh,
    consecutive_errors: consecutive,
    last_run_at: new Date().toISOString(),
    last_trigger: trigger,
    last_runtime_ms: Date.now() - startedAt,
    last_dry_run: dryRun,
    last_result: result,
    processed: Number(result?.held || 0) + Number(result?.released || 0),
    applied: dryRun ? 0 : Number(result?.held || 0) + Number(result?.released || 0),
    errors_last_run: error ? 1 : 0,
    last_error: error,
  };
  for (const k of ["last_snapshot", "last_apply_results", "last_apply_run", "last_apply_run_at"]) delete next[k];
  if (error && consecutive >= stopAt) {
    next.enabled = false;
    next.paused_reason = `auto_stop_after_${consecutive}_errors`;
  }
  await admin.from("app_settings").upsert({ key: CONTROLS_KEY, value: next, updated_at: new Date().toISOString() }, { onConflict: "key" });

  return json({ ok: !error, trigger, dry_run: dryRun, result, error, runtime_ms: Date.now() - startedAt }, error ? 500 : 200);
});
